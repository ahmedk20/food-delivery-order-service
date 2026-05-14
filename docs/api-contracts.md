# API Contracts — Order & Payment Service

Base URL: `/api`

Auth: JWT via `access_token` httpOnly cookie (issued by core service).
All protected endpoints return `401` if token is missing/invalid, `403` if role insufficient.

---

## 0. Conventions

### Headers (in)

| Header | Required where | Notes |
|---|---|---|
| `Cookie: access_token` | All authenticated endpoints | Issued by core-service `/api/auth/login` |
| `Idempotency-Key` | All `POST` / `PATCH` write endpoints | Strict on order create, payment init, payouts, refunds, order cancellation |
| `X-Region` | Required on every request (admin may pass `all` for fan-out reads) | `eg`, `ksa`, ... `POST /api/orders` is the only endpoint that can also derive the region from `branch_id` in the body if the header is absent. |
| `X-CorrelationId` | Propagated; auto-generated if absent | Returned on all responses |

> **Clients must remember the region for an order.** The service has no global UUID→region index, so once an order is created the frontend MUST send the same `X-Region` value on every follow-up call (`GET /orders/{publicId}`, `POST /payments/init`, `PATCH /orders/{publicId}/status`, etc.). Lose the region and the only recovery is a system-admin fan-out read.

### Headers (out)

| Header | Always present |
|---|---|
| `X-CorrelationId` | Request id (echoed if provided, generated otherwise) |
| `X-Cache: HIT\|MISS` | Endpoints behind `withCache` |

### Response Envelope

```jsonc
// success (single)
{ "success": true, "data": <DTO> }

// success (paginated)
{ "success": true, "data": [<DTO>, ...], "meta": { "nextCursor": "...", "hasMore": true, "count": 20 } }

// error
{ "error": "<message>" }
```

### IDs

- Public order/delivery IDs: **UUID string** (`publicId`). Internal bigint `id` never leaves this service.
- Other cross-service IDs (customer, restaurant, branch, product): bigint serialized as JSON number.

### Money

Always integer minor units, with a sibling `currency` field (`"EGP"`, `"SAR"`). Divide by 100 only for display.

### Timestamps

ISO 8601 UTC strings, e.g. `"2026-04-22T10:00:00.000Z"`.

### Pagination

Query: `?cursor=<opaque>&limit=20`  
Response meta: `{ nextCursor, hasMore, count }`.

---

## 1. Orders

### POST /api/orders
Place a new order.

**Auth**: customer  
**Header**: `Idempotency-Key` (strict)

**Request Body**
```json
{
  "branch_id": 2,
  "customer_address_id": 5,
  "payment_method": "online",
  "notes": "No onions please",
  "items": [
    { "product_id": 10, "quantity": 2 },
    { "product_id": 15, "quantity": 1 }
  ]
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `branch_id` | integer | yes | positive int |
| `customer_address_id` | integer | yes | must belong to requesting customer |
| `payment_method` | `"online"` \| `"cod"` | yes | |
| `notes` | string | no | max 500 chars |
| `items` | array | yes | non-empty, max 50 items |
| `items[].product_id` | integer | yes | |
| `items[].quantity` | integer | yes | 1–99 |

**Response 201**
```json
{
  "success": true,
  "data": {
    "public_id": "a1b2c3d4-...",
    "status": "pending_payment",
    "payment_method": "online",
    "subtotal": 5000,
    "delivery_fee": 1000,
    "service_fee": 0,
    "discount": 0,
    "total": 6000,
    "currency": "EGP",
    "items": [
      {
        "product_id": 10,
        "name": "Classic Burger",
        "image_url": "https://cdn.example.com/burger.jpg",
        "unit_price": 2500,
        "quantity": 2,
        "line_total": 5000
      }
    ],
    "created_at": "2026-04-22T10:00:00.000Z"
  }
}
```

For online orders: call `POST /api/payments/init` immediately to obtain the Kashier redirect URL. Cash orders skip that step.

**Error Responses**

| Status | Error | When |
|---|---|---|
| 400 | `ValidationError` | Invalid body fields |
| 409 | `BranchNotAcceptingOrders` | Branch is closed or restaurant is inactive |
| 409 | `OutOfStock` | A product is out of stock — includes `details[{productId, requested, available}]` |
| 409 | `IdempotencyConflict` | Same key, different request body |
| 422 | `ProductNotFound` | Product does not exist in that branch |
| 422 | `AddressNotFound` | Address does not belong to customer |
| 503 | `CoreServiceUnavailable` | Could not reach core service for validation |

---

### GET /api/orders/{publicId}
Get full order detail including items, latest delivery, and payment summary.

**Auth**: customer (own order) | restaurant member (their branch) | system_admin  
**Params**: `publicId` — UUID

**Response 200**
```json
{
  "success": true,
  "data": {
    "public_id": "a1b2c3d4-...",
    "status": "assigned",
    "payment_method": "online",
    "subtotal": 5000,
    "delivery_fee": 1000,
    "service_fee": 0,
    "discount": 0,
    "total": 6000,
    "currency": "EGP",
    "notes": "No onions please",
    "delivery_address_snapshot": {
      "label": "Home",
      "address_text": "12 Tahrir Square, Cairo",
      "lat": 30.0444,
      "lng": 31.2357
    },
    "items": [
      {
        "product_id": 10,
        "name": "Classic Burger",
        "image_url": "https://cdn.example.com/burger.jpg",
        "unit_price": 2500,
        "quantity": 2,
        "line_total": 5000
      }
    ],
    "delivery": {
      "id": 8,
      "status": "accepted",
      "agent": { "id": 77, "name": "Ahmed", "phone": "+20..." },
      "assigned_at": "2026-04-22T10:25:00.000Z",
      "accepted_at": "2026-04-22T10:26:00.000Z",
      "picked_at": null,
      "delivered_at": null
    },
    "payment_summary": {
      "method": "online",
      "status": "captured",
      "amount": 6000,
      "currency": "EGP",
      "is_refunded": false,
      "refunded_amount": 0
    },
    "accepted_at": "2026-04-22T10:05:00.000Z",
    "ready_at": "2026-04-22T10:20:00.000Z",
    "assigned_at": "2026-04-22T10:25:00.000Z",
    "created_at": "2026-04-22T10:00:00.000Z",
    "updated_at": "2026-04-22T10:26:00.000Z"
  }
}
```

---

### GET /api/customer/orders?year=YYYY
List the authenticated customer's own orders.

**Auth**: customer

**Query Params**

| Param | Type | Default | Notes |
|---|---|---|---|
| `year` | integer | current year | Routes to archive cluster for past years |
| `status` | order_status | — | Filter by status |
| `cursor` | string | — | Opaque pagination cursor |
| `limit` | integer | 20 | 1–100 |

**Response 200** — paginated list of `OrderSummaryResponseDTO`:
```json
{
  "success": true,
  "data": [
    {
      "public_id": "a1b2c3d4-...",
      "status": "delivered",
      "payment_method": "online",
      "subtotal": 5000,
      "total": 6000,
      "currency": "EGP",
      "items_count": 2,
      "restaurant_id": 1,
      "branch_id": 2,
      "created_at": "2026-04-22T10:00:00.000Z",
      "delivered_at": "2026-04-22T10:45:00.000Z"
    }
  ],
  "meta": { "nextCursor": "...", "hasMore": true, "count": 20 }
}
```

---

### PATCH /api/orders/{publicId}/status
Update order status. Single endpoint for all restaurant-side and admin transitions.

**Auth**: restaurant member (accepted/rejected/preparing/ready/cancelled) | customer (cancelled within window) | system_admin (all)  
**Header**: `Idempotency-Key` (strict)

**Request Body**
```json
{
  "status": "accepted",
  "reason": "optional — required for rejected or cancelled"
}
```

| Field | Type | Required | Valid values |
|---|---|---|---|
| `status` | string | yes | `accepted`, `rejected`, `preparing`, `ready`, `cancelled` |
| `reason` | string | conditional | required when `status = rejected` or `cancelled` |

**Response 200**
```json
{
  "success": true,
  "data": {
    "public_id": "a1b2c3d4-...",
    "status": "accepted",
    "accepted_at": "2026-04-22T10:05:00.000Z",
    "updated_at": "2026-04-22T10:05:00.000Z"
  }
}
```

**Error Responses**

| Status | Error | When |
|---|---|---|
| 409 | `InvalidStatusTransition` | `(from, to)` pair not in allowed matrix |
| 409 | `OrderAlreadyFinalized` | Order is already in a terminal state |
| 409 | `CancellationWindowExpired` | Customer tries to cancel after 60-second window |

---

## 2. Restaurant Orders

### GET /api/restaurant/orders
List orders for the authenticated restaurant member's branch(es).

**Auth**: restaurant member with `orders:read`

**Query Params**

| Param | Type | Default | Notes |
|---|---|---|---|
| `branch_id` | integer | — | Required unless user is owner |
| `status` | order_status | — | Filter by status |
| `from` | ISO date | — | |
| `to` | ISO date | — | |
| `cursor` | string | — | |
| `limit` | integer | 20 | 1–100 |

**Response 200** — same paginated `OrderSummaryResponseDTO[]` shape as `GET /customer/orders`.

---

## 3. Payments

### POST /api/payments/init
Create a Kashier payment session for an online order.

**Auth**: customer (must own the order)  
**Header**: `Idempotency-Key` (strict)

**Request Body**
```json
{
  "order_id": "a1b2c3d4-..."
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `order_id` | UUID string | yes | Must be `status = 'pending_payment'` |

**Response 200**
```json
{
  "success": true,
  "data": {
    "session_id": 12,
    "provider_session_id": "ks_sess_abc123",
    "redirect_url": "https://checkout.kashier.io/pay/ks_sess_abc123",
    "expires_at": "2026-04-22T10:15:00.000Z",
    "amount": 6000,
    "currency": "EGP"
  }
}
```

**Error Responses**

| Status | Error | When |
|---|---|---|
| 404 | `OrderNotFound` | Order does not exist |
| 403 | `OrderNotOwnedByCustomer` | Order belongs to a different customer |
| 409 | `OrderNotPendingPayment` | Order is not in `pending_payment` status |
| 503 | `PaymentProviderUnavailable` | Kashier unreachable after retries |

---

### POST /api/payments/webhook/{provider}
Kashier webhook callback. **No JWT auth** — verified by HMAC signature.

**Path**: `provider` ∈ `{ "kashier" }`

**Headers**
```
Content-Type: application/json
x-kashier-signature: <hmac_hex>
```

**Processing Logic** (see `business-logic/payments.md §3` for full algorithm)
1. Verify HMAC using `KASHIER_WEBHOOK_SECRET` — reject with **401** if invalid.
2. Idempotency: `INSERT INTO payment_webhook_events ... ON CONFLICT DO NOTHING` — return 200 immediately on conflict.
3. Look up `payment_sessions` by `provider_session_id`.
4. If `payment.captured`: update session, insert `charge` transaction, advance order to `placed`, credit restaurant balance, emit WebSocket events.
5. If `payment.failed`: update session, insert failed `charge` row (audit), leave order as `pending_payment` (customer may retry or sweep cancels after 15 min).
6. If `refund.succeeded`: flip refund transaction to `succeeded`, mark original charge `is_refunded=true`, adjust balance.

**Response 200**
```json
{ "received": true }
```

Always return 200 to Kashier after signature validation. Kashier retries on non-200.

---

### GET /api/payments/{paymentId}
Get a payment (charge or cod_collection) transaction.

**Auth**: system_admin | restaurant owner (`payments:read`)

**Response 200**
```json
{
  "success": true,
  "data": {
    "id": 55,
    "order_public_id": "a1b2c3d4-...",
    "type": "charge",
    "method": "online",
    "provider": "kashier",
    "provider_reference_id": "ks_txn_abc",
    "status": "succeeded",
    "amount": 6000,
    "currency": "EGP",
    "is_refunded": false,
    "refunded_payment_id": null,
    "created_at": "2026-04-22T10:10:00.000Z",
    "updated_at": "2026-04-22T10:10:00.000Z"
  }
}
```

---

### POST /api/payments/{paymentId}/refund
Initiate a refund on a succeeded charge.

**Auth**: system_admin  
**Header**: `Idempotency-Key` (strict)

**Request Body**
```json
{
  "amount": 3000,
  "reason": "Customer request — item missing"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `amount` | integer | no | Minor units; omit → full refund |
| `reason` | string | yes | max 500 chars |

**Response 202** (final state comes via webhook)
```json
{
  "success": true,
  "data": {
    "refund_id": 60,
    "status": "pending",
    "amount": 3000,
    "currency": "EGP"
  }
}
```

**Error Responses**

| Status | Error | When |
|---|---|---|
| 404 | `PaymentNotFound` | Transaction does not exist |
| 409 | `TransactionNotRefundable` | Already fully refunded |
| 409 | `InsufficientRefundAmount` | `amount` > original charge amount |
| 409 | `TransactionTerminalState` | Transaction is not `succeeded` |

---

## 4. Deliveries

### POST /api/deliveries/assign/{orderId}
Assign a delivery agent to a ready order.

**Auth**: system_admin  
**Path**: `orderId` — UUID

**Request Body**
```json
{
  "agent_id": 77
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `agent_id` | integer | no | Omit → auto-assignment using Redis geo scan |

**Response 201**
```json
{
  "success": true,
  "data": {
    "id": 8,
    "order_public_id": "a1b2c3d4-...",
    "agent": { "id": 77, "name": "Ahmed", "phone": "+20..." },
    "status": "assigned",
    "pickup": { "lat": 30.0500, "lng": 31.2300 },
    "dropoff": { "lat": 30.0444, "lng": 31.2357 },
    "distance_meters": null,
    "assigned_at": "2026-04-22T10:25:00.000Z"
  }
}
```

**Error Responses**

| Status | Error | When |
|---|---|---|
| 409 | `OrderNotReady` | Order is not in `ready` status |
| 409 | `OrderAlreadyHasActiveDelivery` | An active delivery row already exists |
| 409 | `AgentInActiveDelivery` | Specified agent is already busy |
| 409 | `NoEligibleAgents` | Auto-assignment: no online available agents within radius |

---

### POST /api/deliveries/reassign/{orderId}
Reassign a delivery to a different agent.

**Auth**: system_admin  
**Path**: `orderId` — UUID

**Response 201** — same `DeliveryResponseDTO` shape (the new delivery row).

**Error Responses**

| Status | Error | When |
|---|---|---|
| 409 | `MaxReassignmentAttemptsReached` | Reassignment chain exceeded configured limit |

---

### PATCH /api/deliveries/{deliveryId}/status
Update delivery status (agent actions).

**Auth**: delivery_agent (must be assigned to this delivery)

**Request Body**
```json
{
  "status": "accepted"
}
```

Valid transitions for agent: `assigned → accepted`, `assigned → rejected`, `accepted → picked`, `picked → delivered`.

**Response 200**
```json
{
  "success": true,
  "data": {
    "id": 8,
    "status": "accepted",
    "accepted_at": "2026-04-22T10:26:00.000Z",
    "updated_at": "2026-04-22T10:26:00.000Z"
  }
}
```

---

## 5. Agents

### POST /api/agents/presence/online
Signal start of shift.

**Auth**: delivery_agent

**Request Body**
```json
{ "lat": 30.0444, "lng": 31.2357 }
```

**Response 200**: `{ "success": true, "data": { "ok": true } }`

---

### POST /api/agents/presence/offline
Signal end of shift.

**Auth**: delivery_agent

**Pre-condition**: agent must not have an active delivery.

**Response 200**: `{ "success": true, "data": { "ok": true } }`

**Error**: 409 `AgentInActiveDelivery`

---

### POST /api/agents/presence/ping
Heartbeat — update location and refresh online TTL.

**Auth**: delivery_agent

**Request Body**
```json
{ "lat": 30.0444, "lng": 31.2357 }
```

**Response 200**: `{ "success": true, "data": { "ok": true } }`

**Error**: 409 `AgentNotOnline`

---

### GET /api/agents/tasks?status=
Get the agent's delivery task list.

**Auth**: delivery_agent

**Query Params**

| Param | Type | Notes |
|---|---|---|
| `status` | delivery_status | optional filter |
| `cursor` | string | |
| `limit` | integer | default 20 |

**Response 200**
```json
{
  "success": true,
  "data": [
    {
      "delivery_id": 8,
      "order_public_id": "a1b2c3d4-...",
      "status": "accepted",
      "pickup": { "branch_name": "Cairo Branch", "lat": 30.0500, "lng": 31.2300, "address": "..." },
      "dropoff": { "lat": 30.0444, "lng": 31.2357, "address": "..." },
      "items_count": 2,
      "total": 6000,
      "currency": "EGP",
      "payment_method": "online",
      "earning_estimate": 1000,
      "assigned_at": "2026-04-22T10:25:00.000Z"
    }
  ],
  "meta": { "nextCursor": null, "hasMore": false, "count": 1 }
}
```

---

### GET /api/agents/earnings?from=&to=
Get the agent's earnings history.

**Auth**: delivery_agent

**Query Params**

| Param | Type | Notes |
|---|---|---|
| `from` | ISO date | |
| `to` | ISO date | |
| `status` | `"pending"` \| `"paid"` | optional |
| `cursor` | string | |
| `limit` | integer | default 20 |

**Response 200**
```json
{
  "success": true,
  "data": [
    {
      "id": 10,
      "order_public_id": "a1b2c3d4-...",
      "delivery_id": 8,
      "amount": 1000,
      "currency": "EGP",
      "status": "pending",
      "created_at": "2026-04-22T10:45:00.000Z",
      "paid_at": null
    }
  ],
  "meta": {
    "nextCursor": null,
    "hasMore": false,
    "count": 1,
    "total_pending": 1000,
    "total_paid": 15000
  }
}
```

---

## 6. Restaurant Finance

### GET /api/restaurant/balance
Get the current restaurant balance.

**Auth**: restaurant_user with `finance:read`

**Response 200**
```json
{
  "success": true,
  "data": {
    "restaurant_id": 5,
    "currency": "EGP",
    "balance": 250000,
    "updated_at": "2026-04-22T10:00:00.000Z"
  }
}
```

---

### GET /api/restaurant/payouts?from=&to=
Get payout history for the authenticated restaurant.

**Auth**: restaurant_user with `finance:read`

**Response 200** — paginated list of `PayoutResponseDTO`:
```json
{
  "success": true,
  "data": [
    {
      "id": 20,
      "amount": 100000,
      "currency": "EGP",
      "status": "succeeded",
      "provider_reference_id": "BANK-REF-001",
      "created_at": "2026-04-20T12:00:00.000Z"
    }
  ],
  "meta": { "nextCursor": null, "hasMore": false, "count": 1 }
}
```

---

### POST /api/restaurant/payouts
Admin-initiated restaurant payout.

**Auth**: system_admin  
**Header**: `Idempotency-Key` (strict)

**Request Body**
```json
{
  "restaurant_id": 5,
  "amount": 100000,
  "currency": "EGP",
  "provider_reference_id": "BANK-REF-001",
  "note": "April settlement"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `restaurant_id` | integer | yes | |
| `amount` | integer | yes | Minor units; must be ≤ balance |
| `currency` | string | yes | `EGP`, `SAR` |
| `provider_reference_id` | string | yes | Bank transfer reference |
| `note` | string | no | max 500 chars |

**Response 201** — `PayoutResponseDTO`.

**Error Responses**

| Status | Error | When |
|---|---|---|
| 409 | `InsufficientBalance` | Amount exceeds current balance |
| 409 | `IdempotencyConflict` | Same key, different request body |

---

## 7. Admin

### GET /api/admin/orders
List all orders across the deployment region with full filters.

**Auth**: system_admin  
**Query Params**: `status`, `customer_id`, `restaurant_id`, `branch_id`, `delivery_agent_id`, `cursor`, `limit`

**Response 200** — paginated `OrderSummaryResponseDTO[]`

---

### GET /api/admin/transactions
List all transactions.

**Auth**: system_admin  
**Query Params**: `type`, `status`, `order_id`, `src_acc_id`, `dst_acc_id`, `cursor`, `limit`

**Response 200** — paginated transaction list

---

### POST /api/admin/orders/{publicId}/cancel
Force-cancel any non-terminal order.

**Auth**: system_admin

**Request Body**
```json
{ "reason": "Fraud detection — manual override" }
```

**Response 200** — same shape as `PATCH /orders/{id}/status` response.

---

### GET /api/admin/restaurant-balances
List all restaurant balances.

**Auth**: system_admin  
**Query Params**: `restaurant_id`, `cursor`, `limit`

**Response 200**
```json
{
  "success": true,
  "data": [
    {
      "restaurant_id": 5,
      "currency": "EGP",
      "balance": 250000,
      "updated_at": "2026-04-22T10:00:00.000Z"
    }
  ]
}
```

---

### GET /api/admin/agents
List all delivery agents with presence info.

**Auth**: system_admin  
**Query Params**: `is_online`, `is_available`, `cursor`, `limit`

**Response 200**
```json
{
  "success": true,
  "data": [
    {
      "agent_id": 77,
      "lat": 30.0444,
      "lng": 31.2357,
      "is_online": true,
      "is_available": false,
      "last_seen_at": "2026-04-22T10:20:00.000Z"
    }
  ]
}
```

---

## 8. WebSocket Protocol (socket.io)

### Connect

```ts
const socket = io("wss://<host>", {
  path: "/ws",
  auth: { token: "<jwt>" },
  transports: ["websocket"],
});
```

Connection middleware validates the JWT. Rejected handshakes receive `connect_error` with reason `"Unauthorized"`.

### Client → Server Events

```ts
socket.emit("subscribe",   "branch:42", (ack) => { /* { ok: true } | { ok: false, error } */ });
socket.emit("unsubscribe", "branch:42");
socket.emit("agent:location", { lat: 30.0444, lng: 31.2357 });  // delivery_agent only
```

### Server → Client Events

```ts
socket.on("hello", ({ allowedChannels }) => { /* list of rooms the user may join */ });

socket.on("order.status_changed", ({ orderPublicId, status, updatedAt }) => { /* ... */ });
socket.on("delivery.status_changed", ({ orderPublicId, deliveryId, status, agent, updatedAt }) => { /* ... */ });
socket.on("agent.location_updated", ({ agentId, lat, lng }) => { /* ... */ });
socket.on("payment.completed", ({ orderPublicId, transactionId }) => { /* ... */ });
socket.on("payment.failed", ({ orderPublicId, reason }) => { /* ... */ });
socket.on("task.assigned", ({ deliveryId, orderPublicId, ... }) => { /* DeliveryTaskResponseDTO */ });
socket.on("task.cancelled", ({ deliveryId, reason }) => { /* ... */ });
```

### Channels & Permitted Events

| Channel format | Subscriber | Events |
|---|---|---|
| `customer:{userId}` | the customer | `order.status_changed`, `delivery.status_changed`, `payment.completed`, `payment.failed` |
| `restaurant:{restId}` | restaurant owner | `order.created`, `order.cancelled` |
| `branch:{branchId}` | restaurant manager / staff | `order.created`, `order.status_changed`, `order.cancelled`, `delivery.assigned`, `delivery.status_changed` |
| `agent:{agentId}` | the agent | `task.assigned`, `task.cancelled` |
| `order:{publicId}` | customer + restaurant member + assigned agent | `order.status_changed`, `delivery.status_changed`, `agent.location_updated`, `payment.completed`, `payment.failed` |

> `delivery.assigned` is fired once when the delivery row is first created (signals "a courier has been chosen" to the branch). `delivery.status_changed` covers every transition after that — including the same initial assignment, so a client subscribed only to `delivery.status_changed` still gets the full lifecycle.

---

## 9. Health

### GET /api/health
**Auth**: none

**Response 200**
```json
{
  "status": "ok",
  "service": "order-service",
  "timestamp": "2026-04-22T10:00:00.000Z"
}
```

---

## 10. Error Code Catalogue

All errors are thrown via `errors.ts` files in each module — no ad-hoc strings.

| Code | HTTP | Module |
|---|---|---|
| `OrderNotFound` | 404 | orders |
| `OrderNotPendingPayment` | 409 | orders |
| `OrderAlreadyFinalized` | 409 | orders |
| `InvalidStatusTransition` | 409 | orders |
| `CancellationWindowExpired` | 409 | orders |
| `BranchNotAcceptingOrders` | 409 | orders |
| `OutOfStock` | 409 | orders |
| `IdempotencyConflict` | 409 | shared |
| `ProductNotFound` | 422 | orders |
| `AddressNotFound` | 422 | orders |
| `OrderNotReady` | 409 | deliveries |
| `OrderAlreadyHasActiveDelivery` | 409 | deliveries |
| `MaxReassignmentAttemptsReached` | 409 | deliveries |
| `NoEligibleAgents` | 409 | deliveries |
| `InvalidDeliveryStatusTransition` | 409 | deliveries |
| `DeliveryNotOwnedByAgent` | 403 | deliveries |
| `AgentInActiveDelivery` | 409 | agents |
| `AgentNotOnline` | 409 | agents |
| `InvalidWebhookSignature` | 401 | payments |
| `PaymentProviderUnavailable` | 503 | payments |
| `TransactionNotRefundable` | 409 | payments |
| `TransactionTerminalState` | 409 | payments |
| `InsufficientBalance` | 409 | finance |
| `RestaurantBalanceNotFound` | 404 | finance |
| `CoreServiceUnavailable` | 503 | shared |
| `RegionNotResolved` | 400 | shared |
| `Unauthorized` | 401 | shared |
| `Forbidden` | 403 | shared |

---

## 11. Status Transition Matrix

```
Order status machine:

  [pending_payment] ──── Kashier webhook captured ────────────────────► [placed]
  [pending_payment] ──── customer cancel / sweep (15 min) ────────────► [cancelled]

  [placed] ──── restaurant accept ─────────────────────────────────────► [accepted]
  [placed] ──── restaurant reject ─────────────────────────────────────► [rejected]
  [placed] ──── customer cancel (within 60s) ──────────────────────────► [cancelled]
  [placed] ──── restaurant / admin cancel ─────────────────────────────► [cancelled]

  [accepted] ─── restaurant prepare ──────────────────────────────────► [preparing]
  [accepted] ─── restaurant / admin cancel ────────────────────────────► [cancelled]

  [preparing] ─── restaurant ready ───────────────────────────────────► [ready]
  [preparing] ─── restaurant / admin cancel ───────────────────────────► [cancelled]

  [ready] ─── system assigns agent ───────────────────────────────────► [assigned]
  [ready] ─── admin cancel ────────────────────────────────────────────► [cancelled]

  [assigned] ─── agent picks up ──────────────────────────────────────► [picked]
  [assigned] ─── admin cancel ─────────────────────────────────────────► [cancelled]

  [picked] ─── agent delivers ────────────────────────────────────────► [delivered]

  [rejected]  ─── terminal (no transitions out)
  [delivered] ─── terminal
  [cancelled] ─── terminal
```
