# Business Logic — Restaurant Finance Module

Owner module: `app/restaurant-orders/` (balance reads) + `app/admin/` (payout writes)

Covers the restaurant's financial view: how their balance accumulates from order settlements, how they view their payout history, and how admins execute payouts.

---

## 1. Balance Model

### What the Balance Represents

`restaurant_balances` holds a single running balance per (restaurant, currency). It is an **aggregate view** maintained by UPSERT — not a ledger itself. The authoritative ledger is `transactions`.

```
balance = Σ (subtotal - commission) for every delivered order belonging to the restaurant
        - Σ payout.amount         for every released payout
        - Σ refund.amount         for every successful refund (capped at the original credit)
```

`delivery_fee` and `service_fee` are **excluded** from the restaurant's balance — `delivery_fee` is the courier's earning (booked to `agent_earnings`) and `service_fee` is the platform's revenue (currently 0).

If the balance ever drifts (due to a bug), it can be fully recomputed by replaying `transactions` for the restaurant. A reconciliation job (out of scope for v1) compares the running balance to the recomputed value daily and alerts on any mismatch greater than 1 minor unit.

### Balance Lifecycle

| Event | Effect on balance |
|---|---|
| Online order: Kashier webhook `captured` | `balance += subtotal - commission` |
| COD order: agent marks `delivered` | `balance += subtotal - commission` |
| Order cancelled / rejected (after settlement) | `balance -= refundedAmount` (capped at current balance; any surplus is recorded as a `transactions(type='adjustment')` row instead of forcing the balance negative) |
| Admin records payout | `balance -= payoutAmount` (validated ≥ amount before write) |

> The `CHECK (balance >= 0)` DB constraint on `restaurant_balances` is the last line of defense — the service layer must validate before issuing the decrement. A failed CHECK would surface as a 500 to the admin; the service should never let it get that far.

### Commission (v1)

Platform commission is 0 in v1 — restaurants receive 100% of `subtotal`. Delivery fee goes entirely to the platform. When the commission rate is introduced, change the settlement formula in `deliveries.md §5`:

```typescript
// v1
const commission = 0;

// future
const commission = Math.floor(subtotal * branch.commissionRate);
```

The `commission` column on `orders` and the `transactions(type='commission')` row are already in the schema so the migration to a non-zero rate requires only a config change, not a schema change.

---

## 2. GET /restaurant/balance

Returns the current balance for the authenticated restaurant member's restaurant.

**Auth**: `restaurant_user` with `finance:read` permission.

**Implementation**: single lookup by `(restaurant_id, currency)` — PK lookup, no index needed.

**Response**:
```ts
class RestaurantBalanceResponseDTO {
  restaurantId: number;
  currency: string;
  balance: number;        // minor units
  updatedAt: string;      // ISO 8601
}
```

> The balance may be slightly stale if a delivery was just settled and Redis hasn't invalidated yet — TTL on the balance cache is 5s (no aggressive caching; balance is high-stakes).

---

## 3. GET /restaurant/payouts?from=&to=

Returns payout history for the authenticated restaurant.

**Auth**: `restaurant_user` with `finance:read`.

**Query params**: `from` (ISO date), `to` (ISO date), cursor, limit.

**Implementation**: query `transactions` where `type='payout'` and `dst_acc_id = restaurantOwnerId`.

Uses `idx_transactions_dst_acc_type` index.

**Response** (paginated):
```ts
class PayoutResponseDTO {
  id: number;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed' | 'reversed';
  providerReferenceId?: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## 4. POST /restaurant/payouts (Admin)

Admin-initiated restaurant payout. Moves money from the restaurant's `balance` to their bank account via an external transfer (bank transfer reference stored in the transaction).

**Auth**: `system_admin`.  
**Header**: `Idempotency-Key` (strict).

**Request**:
```ts
class CreatePayoutRequestDTO {
  restaurantId: number;
  amount: number;         // minor units; must be ≤ current balance
  currency: 'EGP' | 'SAR';
  providerReferenceId: string;  // bank transfer reference number
  note?: string;
}
```

**Algorithm** (all in one DB transaction):
1. `SELECT * FROM restaurant_balances WHERE (restaurant_id, currency) = (:id, :currency) FOR UPDATE`.
2. Validate `balance >= amount` → else 409 `InsufficientBalanceError`.
3. Insert `transactions(type='payout', method='bank_transfer', status='succeeded', amount, currency, src_acc_id=NULL, dst_acc_id=restaurantOwnerId, provider_reference_id, idempotency_key=<header>)`.
   - `UNIQUE (idempotency_key)` on `transactions` makes this idempotent on admin retries.
4. Decrement `restaurant_balances.balance -= amount`.
5. Commit.

**Response 201**: `PayoutResponseDTO`.

**Errors**:

| Status | Error | When |
|---|---|---|
| 409 | `InsufficientBalanceError` | Requested amount > current balance |
| 409 | `IdempotencyConflictError` | Same idempotency key, different request body |

> v1 treats the payout as immediately `succeeded` once the admin records the bank transfer reference. A future enhancement would keep it `pending` until the bank confirms settlement.

---

## 5. RBAC

| Action | Role |
|---|---|
| `GET /restaurant/balance` | `restaurant_user` (`finance:read`) |
| `GET /restaurant/payouts` | `restaurant_user` (`finance:read`) |
| `POST /restaurant/payouts` | `system_admin` |

Permission seed: `finance:read`. Mapped to `owner` role only (branch managers and staff cannot view financial data).

---

## 6. Invariants

1. `balance >= 0` enforced by DB `CHECK (balance >= 0)` — a payout that would put balance negative is rejected at the service layer before it reaches the DB.
2. Every payout has a `providerReferenceId` — no payout row can exist without an external reference (enforced by `NOT NULL` validation in the DTO).
3. `transactions` is the source of truth — `restaurant_balances.balance` is derived and recomputable.
4. A payout is never tied to a single order — it draws from the aggregate balance.

---

## 7. Error Catalogue

| Error constant | HTTP | Thrown when |
|---|---|---|
| `InsufficientBalanceError` | 409 | Payout amount exceeds current balance |
| `RestaurantBalanceNotFoundError` | 404 | No balance record exists for this (restaurant, currency) pair |
| `IdempotencyConflictError` | 409 | Same idempotency key, different request body |
