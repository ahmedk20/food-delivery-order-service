# Business Logic — Orders Module

Owner module: `app/order/`

Responsible for the customer-facing order placement, the order header lifecycle, and the read paths used by customers, restaurants, and admins.

---

## 1. Status Machine

```
        ┌──── pending_payment ────── (online orders only)
        │            │
        │            │  Kashier webhook: payment captured
        │            ▼
        └────────► placed ────► accepted ────► preparing ────► ready ────► assigned ────► picked ────► delivered
                     │              │               │              │           │             │
                     │              │               │              │           │             │
                     │              ▼               ▼              ▼           ▼        (terminal)
                     │           rejected        cancelled      cancelled   cancelled
                     │              │
                     └──► cancelled │
                  (customer cancel) ▼
                               (triggers refund for online; void for COD)
```

### State definitions

| Status | Meaning | Who can write it |
|---|---|---|
| `pending_payment` | Online order created; awaiting Kashier payment confirmation | system (webhook), customer (cancel within window) |
| `placed` | In restaurant queue — payment confirmed (online) or COD placed | system (transition only) |
| `accepted` | Restaurant accepted; cooking scheduled | restaurant (manager / staff / owner) |
| `rejected` | Restaurant declined — terminal; triggers refund for online, void for COD | restaurant |
| `preparing` | Active cooking | restaurant |
| `ready` | Food ready; eligible for delivery agent assignment | restaurant |
| `assigned` | Delivery row created; agent notified | system (auto-assignment) / system_admin (manual) |
| `picked` | Agent confirmed pickup at branch | delivery agent |
| `delivered` | Customer received order; money settles — terminal | delivery agent |
| `cancelled` | Cancelled before delivery — terminal | customer (within window) / restaurant / system / admin |

### Transition rules

- The service layer validates that the requested `(from, to)` pair is in the matrix below before any DB write.
- Forbidden transitions return **409 `InvalidStatusTransition`**.
- Each allowed transition stamps the corresponding `<verb>_at` column inside the same transaction.
- Each transition publishes a WebSocket event to all parties subscribed to the affected channels.

### Allowed transitions matrix

| from \ to | placed | accepted | rejected | preparing | ready | assigned | picked | delivered | cancelled |
|---|---|---|---|---|---|---|---|---|---|
| `pending_payment` | ✅ system | | | | | | | | ✅ cust* / admin |
| `placed` | | ✅ rest | ✅ rest | | | | | | ✅ cust** / rest / admin |
| `accepted` | | | | ✅ rest | | | | | ✅ rest / admin |
| `preparing` | | | | | ✅ rest | | | | ✅ rest / admin |
| `ready` | | | | | | ✅ system | | | ✅ admin |
| `assigned` | | | | | | | ✅ agent | | ✅ admin |
| `picked` | | | | | | | | ✅ agent | |

\* Customer cancel of `pending_payment`: allowed at any time before the Kashier session expires (15-minute window); after that the sweep job cancels it automatically.

\*\* Customer cancel of `placed`: allowed only within 60 seconds of `placed_at` and before `accepted_at` is set.

---

## 2. POST /orders — Placement (the most critical path)

### Inputs

```ts
class CreateOrderRequestDTO {
  branchId: number;                                // validated against core-cached branch metadata
  customerAddressId: number;                       // validated via core-client
  paymentMethod: 'online' | 'cod';
  items: Array<{ productId: number; quantity: number }>;  // non-empty
  notes?: string;
}
```

Header: `Idempotency-Key` (strict — required on every call; enforced by `idempotency({ strict: true })` middleware).

### Algorithm

1. **Resolve region.** From `X-Region` header, or derived from `branchId` via cached branch metadata (`core:branch:{branchId}`, TTL 60s). The order goes to the branch's region shard. If neither yields a region → 400 `RegionNotResolvedError`.

2. **Idempotency check.** If `Idempotency-Key` exists in Redis → replay cached response immediately. Redis miss → check `idempotency_keys` DB table. If fingerprint mismatch → 409 `IdempotencyConflict`.

3. **Validate branch** via cache then `core-client`. If `accept_orders = false` or restaurant `status != 'active'` → 409 `BranchNotAcceptingOrders`.

4. **Validate address** via `core-client`. Capture `lat`, `lng`, and full address text for the snapshot. Fail with 422 if not found or not owned by this customer.

5. **Fetch product prices and stock** in a **single batch call** to `core-client.getBranchProducts(branchId, productIds)`. If any product is missing, unavailable, or `stock < quantity` → 409 with the offending product list.

6. **Compute money** (all in minor units):
   ```
   currency     = currencyForCountry(branchMetadata.countryCode)
   line_total   = unit_price_snapshot × quantity   (per item)
   subtotal     = Σ line_total
   delivery_fee = branch.deliveryFee               (from branch metadata snapshot)
   service_fee  = floor(subtotal × platform_service_rate)   (config-driven, currently 0)
   discount     = 0                                (no promotions in v1)
   total        = subtotal + delivery_fee + service_fee - discount
   ```

7. **In one DB transaction on `db(region)`:**
   - Insert `orders` with `status = paymentMethod === 'online' ? 'pending_payment' : 'placed'`.
   - Insert `order_items` (one multi-row INSERT).
   - For COD only: insert `transactions(type='cod_collection', status='pending', amount=total, src_acc_id=customerId, dst_acc_id=NULL)`.

8. **Commit.**

9. **After commit — stock reservation (out-of-trx):** call `core-client.reserveStock(branchId, items)`. If this fails (rare — stock was last verified seconds ago), mark order `cancelled` with `reason='out_of_stock_post_commit'` in a new transaction.

10. **WebSocket:** For COD orders only, emit `order.created` to `branch:{branchId}`. Online orders wait — the restaurant sees the order only after payment is confirmed (step 11).

11. **For online orders:** client calls `POST /payments/init { orderId }` immediately after. If Kashier session creation fails, the order remains `pending_payment`; the client can retry. After 15 minutes, the sweep worker auto-cancels it.

### Concurrency / race conditions

- **Stock race**: two simultaneous orders competing for the last unit of stock — handled by `core-client.reserveStock` (atomic decrement in core; returns 409 if any item underflows).
- **Idempotency race**: same key + same body within 24h → returns the original response. Same key + different body → 409 `IdempotencyConflict` (we hash the request body for the fingerprint).

---

## 3. Pending Payment Auto-Cancellation

A background sweep worker runs every 5 minutes and cancels `pending_payment` orders older than `PAYMENT_SESSION_TIMEOUT_MIN` (env, default 15 minutes):

```sql
SELECT id, region FROM orders
WHERE status = 'pending_payment'
  AND created_at < NOW() - INTERVAL '15 minutes';
```

For each found order:
- Update `status = 'cancelled'`, `cancelled_at = NOW()`, `cancellation_reason = 'payment_timeout'`.
- Emit WebSocket `order.status_changed` to `order:{publicId}`.

This prevents orphaned unpaid orders from accumulating in the restaurant's queue.

---

## 4. GET /orders/{publicId}

- Lookup is by `public_id` (UUID) via `idx_orders_public_id`.
- Region must be supplied via `X-Region` header (the service cannot derive region from a UUID alone).
- Authorization: customer must be `order.customer_id`; restaurant user must be a member of `branch_id` or owner; admin sees all.
- Response includes: order header, items, latest delivery summary (if any), and `payment_summary` with `is_refunded` and `refunded_amount` so the client can show the post-refund state without a separate transactions call.
- Backed by the per-order Redis cache `{region}:os:order:{publicId}` (TTL 300s). On cache miss: two queries (orders + order_items via `WHERE order_id = $1`), build DTO, populate cache.

---

## 5. GET /customer/orders?year=YYYY

- Cursor-paginated by the tuple `(created_at DESC, id DESC)` — the `id` tie-breaker keeps pages stable when two orders share the same `created_at`. The opaque cursor base64-encodes `{ createdAt, id }`.
- Defaults `year` to the current year if omitted.
- Current year → hot cluster via `idx_orders_customer_id_created_at` (already ordered by `(customer_id, created_at DESC, id DESC)`).
- Historical years → archive cluster for the same region (Phase 7).
- Returns `OrderSummaryResponseDTO[]` — no full items array (prevents N+1 on the list).

---

## 6. GET /restaurant/orders

- Filters: `branchId` (required unless owner), `status`, `from`, `to`.
- Cursor pagination by the tuple `(created_at DESC, id DESC)` — same scheme as `GET /customer/orders`.
- Authorization: `requireRestaurantMember()` middleware + service-layer `canAccessBranch(user, branchId)` check (owners see all branches; managers only their assigned `branchIds`; staff inherit their parent membership).
- Hot endpoint → backed by `idx_orders_branch_id_status` + `withCache(10s)` for the typical "pending/placed orders for this branch" page.
- Cache invalidated on every status transition: `DEL {region}:os:orders:branch:{branchId}:*`.

---

## 7. PATCH /orders/{publicId}/status

Single endpoint for all order status transitions. The server inspects `currentStatus` and the actor's role to validate the requested transition.

Header: `Idempotency-Key` (strict) — required. A client retrying after a network blip with the same key + body replays the cached response; a different body yields 409 `IdempotencyConflict`.

```ts
class UpdateOrderStatusRequestDTO {
  status: 'accepted' | 'rejected' | 'preparing' | 'ready' | 'cancelled';
  reason?: string;  // required when status = 'rejected' | 'cancelled'
}
```

Side effects per transition:

| Transition | Side effects |
|---|---|
| `→ accepted` | Stamp `accepted_at`; WS `order.status_changed` to customer + branch |
| `→ rejected` | Stamp `rejected_at`; trigger refund (online) or void COD transaction; WS to customer + branch |
| `→ preparing` | Stamp; WS |
| `→ ready` | Stamp `ready_at`; **trigger auto-assignment** (delivery service scans for nearby agents); WS |
| `→ cancelled` | Stamp `cancelled_at` + `cancellation_reason`; if online & captured → trigger refund; if COD → flip `cod_collection` to `failed`; WS to all parties |

---

## 8. Cancellation Policy

| Actor | Cancellable from statuses | Time restriction |
|---|---|---|
| Customer | `pending_payment`, `placed` | `placed` only within 60s of `placed_at` and before `accepted_at` is set |
| Restaurant | `placed`, `accepted`, `preparing` | No time restriction |
| System (sweep) | `pending_payment` | After 15-minute session timeout |
| Admin | Any non-terminal status | No restriction |

Attempting to cancel a terminal status (`delivered`, `rejected`, `cancelled`) throws 409 `OrderAlreadyFinalizedError`.

> The restaurant **cannot** cancel an order that has already reached `ready`. Once the food is plated and waiting for a courier, a cancel would either waste the food or leave the customer with an order that was paid for and cooked but not delivered. Only `system_admin` can cancel from `ready` (refund/void is then handled manually). The transition matrix in §1 enforces this.

---

## 9. Refund Handling on Cancellation / Rejection

- If `payment_method = 'online'` and a `transactions(type='charge', status='succeeded')` exists:
  → Call `paymentService.refund(orderId, amount=total)`. This is async — Kashier processes it and sends a webhook.
- If `payment_method = 'cod'` and no cash has moved (order still `placed` or `accepted`):
  → Flip the `cod_collection` transaction from `pending` → `failed`. Write a `transactions(type='adjustment', amount=0)` for the audit trail. No money moves.
- If `payment_method = 'cod'` and cash was collected (order at `picked` or later):
  → Admin-only cancel. Requires manual reconciliation (out of scope for v1).

---

## 10. Order Detail Caching

### Cache Key
`{region}:os:order:{publicId}` — TTL 300 seconds. Keyed on the UUID the API exposes so the controller can hit the cache without a publicId→id translation round trip.

### What is cached
The full serialised `OrderDetailResponseDTO` including items, latest delivery, and payment summary. Returned directly on cache hit, skipping all DB reads.

### Cache invalidation
Any write to an order (status change, assignment, cancellation, payment confirmation, refund) must call:
```typescript
await cache.delete(`${region}:os:order:${order.publicId}`);
```

The list-page caches (`{region}:os:orders:branch:{branchId}:*` and `{region}:os:orders:customer:{customerId}:*`) are also pattern-deleted on every status transition so the dashboards never serve a stale row.

---

## 11. N+1 Prevention

- The order list endpoints (`GET /customer/orders`, `GET /restaurant/orders`) return `OrderSummaryResponseDTO` which has `itemsCount` (integer) rather than the full items array. No join needed.
- The order detail endpoint (`GET /orders/{publicId}`) fetches items in a single batched query:
  ```typescript
  const items = await findItemsByOrderId(order.id, region);
  ```
- Admin list endpoints that need items for multiple orders use:
  ```typescript
  const orderIds = orders.map(o => o.id);
  const allItems = await findItemsByOrderIds(orderIds, region);  // WHERE order_id = ANY($1)
  const itemsMap = groupBy(allItems, 'orderId');
  ```

---

## 12. RBAC

| Action | Roles allowed |
|---|---|
| `POST /orders` | `customer` |
| `GET /orders/{id}` | `customer` (own), `restaurant_user` (member of branch), `system_admin` |
| `GET /customer/orders` | `customer` |
| `GET /restaurant/orders` | `restaurant_user` (`orders:read`), `system_admin` |
| `PATCH /orders/{id}/status → accepted/rejected` | `restaurant_user` with `orders:accept` |
| `PATCH /orders/{id}/status → preparing/ready` | `restaurant_user` with `orders:update` |
| `PATCH /orders/{id}/status → cancelled` | `customer` (own, window), `restaurant_user` (`orders:cancel`), `system_admin` |

Permission seed (in core's RBAC seed migration): `orders:read`, `orders:accept`, `orders:update`, `orders:cancel`.

Role mappings:
- `owner` → all four.
- `branch_manager` → all four.
- `staff` → `orders:read`, `orders:update`, `orders:accept` (no cancel).

---

## 13. WebSocket Events Emitted

| Event | Channel(s) | Payload |
|---|---|---|
| `order.created` | `branch:{branchId}` | `OrderSummaryResponseDTO` — emitted when order enters restaurant queue (`placed`) |
| `order.status_changed` | `customer:{userId}`, `branch:{branchId}`, `order:{publicId}` | `{ orderPublicId, status, updatedAt }` |
| `order.cancelled` | `customer:{userId}`, `branch:{branchId}`, `order:{publicId}` | `{ orderPublicId, reason, updatedAt }` |

Notes:
- `order.created` is emitted when status becomes `placed` — not at order creation for online orders (which start as `pending_payment`). The restaurant sees the order only after payment is confirmed.
- Every event also goes to `order:{publicId}` so a single client app subscribed to that one room sees the full lifecycle without juggling multiple channels.
- Field naming: `orderPublicId` (UUID string) — never the internal bigint `id`.

---

## 14. Error Catalogue

| Error constant | HTTP | Thrown when |
|---|---|---|
| `OrderNotFoundError` | 404 | No order with that public_id in the given region |
| `OrderAccessDeniedError` | 403 | Actor trying to access an order they don't own |
| `OrderAlreadyFinalizedError` | 409 | Action on a terminal status (delivered, rejected, cancelled) |
| `InvalidStatusTransitionError` | 409 | Requested (from, to) pair is not in the allowed matrix |
| `CancellationWindowExpiredError` | 409 | Customer tries to cancel after the 60-second window |
| `BranchNotAcceptingOrdersError` | 409 | Branch is closed or restaurant is inactive |
| `OutOfStockError` | 409 | One or more products unavailable or quantity exceeds stock |
| `IdempotencyConflictError` | 409 | Same idempotency key, different request body |
| `ProductNotFoundError` | 422 | Product does not exist in that branch |
| `AddressNotFoundError` | 422 | Address not found or not owned by customer |
| `RegionNotResolvedError` | 400 | X-Region header absent and branchId fallback failed |
| `CoreServiceUnavailableError` | 503 | HTTP call to core service failed |
