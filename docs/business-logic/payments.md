# Business Logic — Payments Module

Owner module: `app/payment/`

Responsible for online payment initiation (Kashier v3 sessions), webhook handling, transactions ledger writes, restaurant balance crediting, and refund execution.

References:
- Kashier Payment Sessions: https://developers.kashier.io/payment/payment-sessions
- Kashier Webhooks: https://developers.kashier.io/webhooks/setup

---

## 1. Endpoints

| Endpoint | Auth |
|---|---|
| `POST /payments/init` | customer (idempotent, strict) |
| `POST /payments/webhook/{provider}` | none (HMAC-verified) |
| `GET /payments/{paymentId}` | system_admin or restaurant owner |
| `POST /payments/{paymentId}/refund` | system_admin |

`{paymentId}` is the `transactions.id` of a `charge` or `cod_collection` row (called "payment" in the public API to avoid leaking ledger internals).

---

## 2. POST /payments/init

### Request

```ts
class InitPaymentRequestDTO {
  orderId: string;  // public_id (UUID)
}
```

Header: `Idempotency-Key` (strict).

### Algorithm

1. Resolve region via `X-Region`; load order via `public_id`.
2. Authorize: caller must be the order's customer; order must be `status = 'pending_payment'`.
3. If a `payment_sessions` row already exists for this order with `status IN ('initialized', 'pending')` → return its `redirectUrl` immediately (domain-level idempotency — no duplicate Kashier call).
4. Build the Kashier session payload:
   ```typescript
   {
     amount:           order.total,          // already in minor units — send as-is
     currency:         order.currency,       // 'EGP', 'SAR'
     orderId:          order.publicId,       // UUID echoed back in webhook
     merchantRedirect: env.kashier.returnUrl,
     serverWebhook:    `${env.appBaseUrl}/api/payments/webhook/kashier`,
     customer:         { name, email },      // from coreClient.getUserById(order.customerId)
     expireAt:         new Date(Date.now() + PAYMENT_SESSION_TIMEOUT_MIN * 60_000).toISOString()
   }
   ```
5. `POST` to `${KASHIER_BASE_URL}/sessions` with `Authorization: ${KASHIER_API_KEY}` header.
6. On success: insert `payment_sessions` row with `status='initialized'`, `provider_session_id`, `redirect_url`, `expires_at = NOW() + PAYMENT_SESSION_TIMEOUT_MIN minutes`, and `raw_init_payload`. The `expires_at` column drives the sweep worker — without it, an abandoned session would never expire on our side even if Kashier honored its own timeout.
7. Return `{ redirectUrl, sessionId: payment_sessions.id, providerSessionId, expiresAt }`.

### Failure modes

- Kashier 5xx or timeout (3 retries with exponential backoff in `pkg/payment/kashier.ts`): return 503. Order stays `pending_payment`; client may retry this endpoint (idempotent).
- Kashier 4xx (e.g., invalid currency): return 502 with provider message; raise an alert.

---

## 3. POST /payments/webhook/{provider}

### Security

- `{provider}` path param: only `kashier` accepted today.
- **HMAC verification using `KASHIER_WEBHOOK_SECRET`** (not the API key — these are separate secrets):

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyKashierSignature(
  payload: Record<string, any>,
  signatureHeader: string,
): boolean {
  const signatureKeys: string[] = payload.signatureKeys ?? [];
  const data: Record<string, any> = payload.data ?? {};
  const qs = [...signatureKeys]
    .sort()
    .map(k => `${k}=${data[k]}`)
    .join('&');
  const expected = createHmac('sha256', env.kashier.webhookSecret)
    .update(qs)
    .digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;  // length mismatch
  }
}
```

Signature invalid → return **401** + log alert + drop. Never trust the payload before verification.

> `KASHIER_WEBHOOK_SECRET` is distinct from `KASHIER_API_KEY`. The API key authenticates session-creation calls *to* Kashier. The webhook secret is used by Kashier to sign events it sends *to us*. Both are in env and never logged.

### Idempotency

Two layers protect the webhook handler:

1. **Event dedup** via `payment_webhook_events.UNIQUE (provider_id, provider_event_id)` — drops every Kashier re-delivery before any side effect runs:

   ```typescript
   const inserted = await db(region).raw(`
     INSERT INTO payment_webhook_events (region, provider_id, provider_event_id, signature, payload)
     VALUES (:region, :providerId, :eventId, :signature, :payload)
     ON CONFLICT (provider_id, provider_event_id) DO NOTHING
     RETURNING id
   `, { ... });

   if (inserted.rowCount === 0) {
     return res.status(200).json({ received: true });  // already processed; Kashier stops retrying
   }
   ```

2. **Transaction dedup** via `transactions.UNIQUE (idempotency_key)` — the `charge` insert below uses the Kashier `eventId` as `idempotency_key`. Belt-and-braces: if a bug ever lets layer (1) through, layer (2) prevents a duplicate ledger entry.

### Processing (in one DB transaction on the order's region)

1. Look up `payment_sessions` by `provider_session_id` (from webhook payload). If not found → log warning + return 200 (unknown session; already cleaned up).
2. Reconcile based on Kashier event type:

**`payment.captured` / `payment.succeeded`:**
- Update `payment_sessions.status = 'captured'`, `raw_last_payload = payload`.
- Insert `transactions(type='charge', method='online', provider_id=kashier_id, provider_reference_id=kashierTxnId, status='succeeded', amount=order.total, currency=order.currency, src_acc_id=customerId, dst_acc_id=NULL, idempotency_key=eventId)`.
- Update `orders.status = 'placed'`, stamp `placed_at = NOW()`.
- Upsert `restaurant_balances`: `balance += subtotal - commission` (commission = 0 in v1; update this formula when platform commission is introduced).

**`payment.failed`:**
- Update `payment_sessions.status = 'failed'`, `raw_last_payload = payload`.
- Insert `transactions(type='charge', status='failed', amount, ...)` (audit only — no money moved).
- **Leave `orders.status` as `pending_payment`** — the customer can retry `POST /payments/init`. The sweep worker cancels after 15 minutes if not retried.
- Emit WS `payment.failed` to `customer:{customerId}` with failure reason.

**`refund.succeeded`:**
- Locate the original `transactions(type='refund', status='pending')` by `provider_reference_id`.
- Update its `status = 'succeeded'`.
- Mark the original charge: `is_refunded = true`, `refunded_payment_id = refundTxn.id`.
- Adjust `restaurant_balances.balance -= refundedAmount` (capped at current balance; surplus becomes `transactions(type='adjustment')`).

3. Stamp `payment_webhook_events.processed_at = NOW()`. If processing throws, stamp `process_error` and rethrow → 500 → Kashier retries.

### After commit (all event types)

- Invalidate order cache: `DEL {region}:os:order:{id}`.
- Emit appropriate WebSocket events:
  - `payment.captured` → `payment.completed` to `order:{publicId}`; `order.status_changed` to `order:{publicId}`; `order.created` to `branch:{branchId}` (restaurant now sees the order).
  - `payment.failed` → `payment.failed` to `customer:{customerId}`.
  - `refund.succeeded` → notify customer via `customer:{customerId}`.

---

## 4. GET /payments/{paymentId}

- `paymentId` = `transactions.id` of a `charge` or `cod_collection` row.
- Authorization: `system_admin` always; restaurant owner only if the transaction belongs to one of their orders.
- Returns `PaymentResponseDTO` with: id, orderPublicId, type, method, provider, amount, currency, status, providerReferenceId, isRefunded, timestamps.

---

## 5. POST /payments/{paymentId}/refund

- **Admin-only.**
- Body: `{ amount?: number, reason: string }`. Omitting `amount` → full refund.
- Validates:
  1. Transaction is type `charge` or `cod_collection`.
  2. `status = 'succeeded'`.
  3. Not already fully refunded (`is_refunded = false`).
  4. `amount <= original charge amount minus already-refunded amount` (handles partial-then-partial chains correctly).
- Inserts `transactions(type='refund', method=originalMethod, provider_id=originalProvider, status='pending', amount, currency, src_acc_id=NULL, dst_acc_id=customerId, refunded_payment_id=originalCharge.id, idempotency_key=<idempotency-key header>)`. The `refunded_payment_id` link is required so the original charge can be summed against its refund chain on read; the original charge is also marked `is_refunded=true` only when the chain reaches the original amount.
- For online orders: calls Kashier refund API. On Kashier 2xx → keep `status='pending'`, await webhook to flip to `succeeded`.
- For COD: refund is a bookkeeping operation (no Kashier call). Insert the refund row and an `adjustment` row for audit. Adjust `restaurant_balances` if the order was already settled.

Response **202** (accepted; final state via webhook):
```json
{ "refundId": 1, "status": "pending", "amount": 6000, "currency": "EGP" }
```

---

## 6. Money Model

- All amounts are integer minor units (piasters for EGP, halalas for SAR).
- `transactions.amount` is always **positive**. Direction is encoded by `(type, src_acc_id, dst_acc_id)`.
- A delivered online order generates two rows in `transactions`:
  1. `charge` — customer pays platform (created inside webhook handler).
  2. `commission` — platform deducts its cut from restaurant's share (created inside delivery settlement, see deliveries.md §5). In v1 this row is **only inserted when commission > 0**; with `commissionRate = 0` no commission row is written.
- A delivered COD order generates:
  1. `cod_collection` — created at order placement (`status='pending'`); flipped to `succeeded` on delivery.
  2. `commission` — same as above (skipped while rate is 0).
- A `refund` is platform → customer for online; an audit entry with no money movement for COD.
- A `payout` is platform → restaurant owner (separate admin-initiated flow).

### Money split summary (v1)

| Cash flow | Where it goes |
|---|---|
| `subtotal` | Restaurant (100%) — credited to `restaurant_balances` on delivery / capture |
| `commission` | Platform — deducted from restaurant's share. Currently 0. |
| `delivery_fee` | **Delivery agent** (100%) — booked to `agent_earnings` on delivery (see deliveries.md §5). The platform does NOT keep the delivery fee in v1. |
| `service_fee` | Platform — currently 0 |

When the platform introduces a non-zero commission or a non-1.0 `agentShareRate`, only the env vars change — the schema is already shaped for it.

---

## 7. COD Flow

COD orders bypass Kashier entirely.

1. Order placed with `payment_method = 'cod'` → `status = 'placed'` directly (no `pending_payment`).
2. `transactions(type='cod_collection', status='pending', amount=total, src_acc_id=customerId, dst_acc_id=NULL)` inserted in the same transaction as the order.
3. Restaurant accepts → preparing → ready → agent assigned → picked → delivered.
4. On `delivered` (inside the delivery settlement transaction, see deliveries.md §5):
   - `cod_collection` transaction flipped from `pending` → `succeeded`.
   - `commission` transaction inserted.
   - `restaurant_balances.balance += subtotal - commission`.
   - `agent_earnings` row inserted.

---

## 8. Restaurant Balance Crediting

`restaurant_balances` is an aggregate view maintained by UPSERT on every payment event. It is **not** the source of truth — `transactions` are. If balance drifts (bug), it can be recomputed from `transactions`.

**v1 formula (no platform commission):**
```typescript
const commission = 0;  // floor(subtotal * commissionRate) when introduced
const restaurantCredit = subtotal - commission;
// delivery_fee → agent (see deliveries.md §5), NOT the restaurant.
// service_fee  → platform (currently 0).
```

Update this formula when the platform commission rate is introduced. Note that the `delivery_fee` is intentionally excluded from the restaurant credit — it is the agent's earning, not platform revenue.

---

## 9. Transaction Immutability

Once a transaction reaches `succeeded` or `failed`, it cannot be updated. The service layer guards:

```typescript
if (['succeeded', 'failed', 'reversed'].includes(existing.status)) {
  throw new TransactionTerminalStateError();
}
```

The only allowed post-terminal operation is marking `is_refunded = true` on a `succeeded` `charge` — which happens alongside a new `refund` transaction, not as a mutation of the original.

---

## 10. RBAC

| Action | Role |
|---|---|
| `POST /payments/init` | `customer` (own order) |
| `POST /payments/webhook/{provider}` | none (HMAC-verified) |
| `GET /payments/{id}` | `system_admin`, `restaurant_user` (`payments:read`) |
| `POST /payments/{id}/refund` | `system_admin` |

Permission seed: `payments:read`. Mapped to `owner` role only.

---

## 11. Invariants

1. Every `charge` row has at most one matching `refund` chain whose summed amount ≤ charge amount.
2. Webhooks are processed at-most-once effectively via `UNIQUE (provider_id, provider_event_id)` on `payment_webhook_events`.
3. A `charge` with `status='succeeded'` implies the matching `payment_sessions.status='captured'`.
4. COD orders never have a `charge` row — only `cod_collection`.
5. `payment.failed` does not move the order to a terminal state — it stays `pending_payment` to allow retry.

---

## 12. Failure Modes & Operator Playbook

| Symptom | Likely cause | Action |
|---|---|---|
| `payment_sessions.status='initialized'` for >15 min | Customer abandoned; Kashier never confirmed | Sweep worker auto-cancels the order |
| Spike of duplicate webhooks | Kashier retrying on slow handler | Check handler latency; HMAC + unique constraint already de-dup |
| Webhook signature mismatch | `KASHIER_WEBHOOK_SECRET` rotation drift | Update env secret; replay unprocessed rows in `payment_webhook_events` |
| `transactions` insert blocks | Row lock contention on `restaurant_balances` | Investigate concurrent payouts vs deliveries for the same restaurant |
| `payment.failed` event but order stuck `pending_payment` | Expected — customer retries or sweep cancels after 15 min | No action needed unless stuck past 15 min |

---

## 13. Configuration (env)

```
KASHIER_BASE_URL=https://api.kashier.io
KASHIER_MERCHANT_ID=...
KASHIER_API_KEY=...            # used for session creation calls TO Kashier
KASHIER_WEBHOOK_SECRET=...     # used to verify webhooks FROM Kashier (separate key)
KASHIER_RETURN_URL=https://app.quickbite.io/checkout/return
KASHIER_FAIL_URL=https://app.quickbite.io/checkout/failed
PAYMENT_SESSION_TIMEOUT_MIN=15
```

All added to `lib/config/env.ts` zod schema before any payment code ships.

---

## 14. Error Catalogue

| Error constant | HTTP | Thrown when |
|---|---|---|
| `OrderNotPendingPaymentError` | 409 | `POST /payments/init` but order is not `pending_payment` |
| `OrderNotOwnedByCustomerError` | 403 | Customer requesting session for another customer's order |
| `InvalidWebhookSignatureError` | 401 | HMAC verification fails |
| `KashierApiError` | 502 | Kashier API returns non-success response |
| `TransactionTerminalStateError` | 409 | Attempting to modify a `succeeded`/`failed` transaction |
| `TransactionNotRefundableError` | 409 | Transaction is already fully refunded |
| `InsufficientRefundAmountError` | 409 | Requested refund amount exceeds original charge |
| `PaymentProviderUnavailableError` | 503 | Kashier unreachable after retries |
