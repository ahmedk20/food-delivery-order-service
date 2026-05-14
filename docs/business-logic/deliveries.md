# Business Logic — Deliveries Module

Owner module: `app/delivery/`

Responsible for converting a `ready` order into a delivery (assignment), tracking the delivery lifecycle, handling agent rejection and reassignment, and triggering money settlement on completion.

---

## 1. Delivery Status Machine

```
assigned ──► accepted ──► picked ──► delivered  (terminal; triggers money settlement)
   │             │
   │             │
   ▼             ▼
reassigned    rejected ──► (triggers reassignment)
   │
   ▼
(new delivery row created; reassigned_from = old_id)
```

| Status | Meaning | Who writes it |
|---|---|---|
| `assigned` | Delivery row created; agent notified via WS | system (auto) / system_admin (manual) |
| `accepted` | Agent accepted the task | delivery agent |
| `rejected` | Agent declined → triggers reassignment | delivery agent |
| `picked` | Agent confirmed pickup at branch | delivery agent |
| `delivered` | Agent confirmed handoff — terminal; triggers settlement | delivery agent |
| `cancelled` | Order cancelled while in delivery; agent released | system / admin |
| `reassigned` | Superseded by a new delivery row | system |

`orders.delivery_agent_id` mirrors the **current** delivery's agent (denormalized for fast lookups). Updated whenever a new delivery row is created or a delivery is cancelled.

---

## 2. POST /deliveries/assign/{orderId}

Two callers:
1. **System (auto):** triggered when `orders.status` transitions to `ready`.
2. **Admin (manual):** admin specifies a specific agent via request body.

### Algorithm — Auto-Assignment

1. Resolve region from order.
2. Validate: order is `ready` and has no active delivery row. The application checks first for a friendly 409, but the partial unique index `uq_deliveries_active_per_order` is the hard guarantee — a duplicate concurrent assignment will be rejected by the DB.
3. **Find candidate agents** using the Redis geo set:
   ```
   GEOSEARCH presence:geo:{region}
     FROMMEMBER <branch_location>
     BYRADIUS ASSIGNMENT_RADIUS_METERS (env, default 5000) m
     ASC COUNT K (env, default 5)
   ```
   Filter candidates to those:
   - **Not** in `presence:busy:{region}` (Redis set of agents with active deliveries).
   - **Not** in `assignment:rejected:{orderId}` (Redis set, TTL = `AGENT_ACCEPT_TIMEOUT_SEC × MAX_REASSIGNMENT_ATTEMPTS`) — prevents re-offering the same order to an agent who just rejected/timed it out.

4. **For each candidate in ranked order:**
   - Open a DB transaction on `db(region)`.
   - `SELECT * FROM agent_presence WHERE agent_id = :agentId FOR UPDATE` — verify `is_online = true` and `last_seen_at > NOW() - 90s` (not stale).
   - If stale or offline: skip this candidate, release lock.
   - Insert `deliveries(order_id, agent_id, status='assigned', pickup_lat/lng, dropoff_lat/lng, currency)`. The partial unique index `uq_deliveries_active_per_order` will reject the insert if another worker raced ahead — treat that as a non-error, exit cleanly.
   - Update `orders.status = 'assigned'`, `delivery_agent_id = agentId`, `assigned_at = NOW()`.
   - Add agent to `presence:busy:{region}` Redis set.
   - Add the delivery to `assignment:pending_accept` Redis sorted set with score = `now + AGENT_ACCEPT_TIMEOUT_SEC` (env, default 30s).
   - Commit.
   - Push WS `task.assigned` to `agent:{agentId}` with the task details.
   - **Acceptance timeout enforcement**: a background sweep runs every 5 seconds:
     ```
     ZRANGEBYSCORE assignment:pending_accept -inf <now>
     ```
     For every expired delivery still in `status='assigned'`, the sweep marks the row `status='rejected', rejected_at=NOW()`, adds `agent_id` to `assignment:rejected:{orderId}`, removes the agent from `presence:busy:{region}`, and triggers reassignment. This is durable — restarting the API does not lose pending timeouts (the sorted set is in Redis; the row is in Postgres).

5. **If all K candidates fail:** widen the radius (e.g. 2× `ASSIGNMENT_RADIUS_METERS`) for one more pass before declaring no eligible agents.

6. **If the widened pass also fails** (no takers): push `assignment.unassigned_alert` WS to the admin channel; revert `orders.status = 'ready'` (clear `delivery_agent_id`); the order sits until manual admin assignment or the next auto-assignment sweep (driven by the orders index `WHERE status IN ('ready')`).

7. If `MAX_REASSIGNMENT_ATTEMPTS` (env, default 3) total attempts reached → 409 `MaxReassignmentAttemptsReached` + admin alert.

> v1 deliberately **does not** push to multiple agents simultaneously. A "broadcast race" model needs an `offers` table with `(delivery_id, agent_id)` rows and an exclusive accept claim — out of scope for v1. The serial fallback above is simpler and predictable; it costs at most `K × AGENT_ACCEPT_TIMEOUT_SEC` seconds before either an agent accepts or the admin alert fires.

### Algorithm — Manual (Admin)

- Admin provides `agentId` in request body. Skip candidate scoring.
- Same DB insert + side effects as auto-assignment.
- If agent is busy → 409 `AgentInActiveDelivery`.

### Idempotency

An order with an active delivery row (`status IN ('assigned', 'accepted', 'picked')`) cannot be re-assigned. The application returns 409 `OrderAlreadyHasActiveDelivery` after a pre-check, and the partial unique index `uq_deliveries_active_per_order` rejects the duplicate at the DB layer if a race slips through.

---

## 3. POST /deliveries/reassign/{orderId}

Triggered by admin or automatically after agent rejection / acceptance timeout.

1. Find the active delivery row for the order.
2. Mark it `status='reassigned'`, `reassigned_at=NOW()`.
3. Remove agent from `presence:busy:{region}`.
4. Emit WS `task.cancelled` to `agent:{oldAgentId}`.
5. Run the auto-assignment algorithm from §2 again. The new delivery row references `reassigned_from = old_delivery.id`.
6. Total reassignment chain length is capped at `MAX_REASSIGNMENT_ATTEMPTS`. Beyond that → 409 `MaxReassignmentAttemptsReached` + admin alert.

---

## 4. PATCH /deliveries/{deliveryId}/status

Single endpoint for all agent actions on a delivery. Body: `{ status, reason? }`.

Allowed transitions per actor:

| Current | Target | Actor |
|---|---|---|
| `assigned` | `accepted` | assigned delivery agent |
| `assigned` | `rejected` | assigned delivery agent |
| `accepted` | `picked` | assigned delivery agent |
| `picked` | `delivered` | assigned delivery agent |

Anything else → 409 `InvalidDeliveryStatusTransition`.

### Side effects

| Transition | Side effects |
|---|---|
| `→ accepted` | Stamp `accepted_at`; WS `delivery.status_changed` to `customer:{id}` + `branch:{id}` |
| `→ rejected` | Stamp `rejected_at`; trigger reassignment (§3); WS `task.cancelled` to agent |
| `→ picked` | Stamp `picked_at`; mirror `orders.status = 'picked'`, `picked_at`; WS to customer + branch |
| `→ delivered` | Stamp `delivered_at`; **money settlement trx** (§5); mirror `orders.status = 'delivered'`, `delivered_at`; WS to all parties |

---

## 5. Settlement on `delivered`

All steps execute in a **single DB transaction** on `db(region)`. Failure rolls back the entire thing — no partial settlement.

1. `SELECT * FROM restaurant_balances WHERE (restaurant_id, currency) = (:restId, :currency) FOR UPDATE` — prevents concurrent balance drift. Insert a zero-balance row first if one does not exist yet (`INSERT ... ON CONFLICT DO NOTHING`).

2. Compute commission:
   ```typescript
   const commission = Math.floor(order.subtotal * branch.commissionRate);
   // commissionRate from env/config (currently 0 — v1 has no platform cut)
   ```
   Write `commission` back to `orders.commission`.

3. For **online** orders: the `transactions(type='charge', status='succeeded')` row was already created by the Kashier webhook. Assert it exists (invariant check).

4. For **COD** orders: flip `transactions(type='cod_collection', status='pending')` → `succeeded`.

5. Insert `transactions(type='commission', method='system', status='succeeded', amount=commission, src_acc_id=restaurantOwnerId, dst_acc_id=NULL)` — only if `commission > 0`.

6. Upsert `restaurant_balances`: `balance += subtotal - commission`.

7. Compute agent earning:
   ```typescript
   const agentEarning = Math.floor(order.deliveryFee * agentShareRate);
   // agentShareRate from env/config (currently 1.0 — agent keeps the full delivery fee in v1).
   // The platform does NOT keep any portion of the delivery fee; it flows straight to the agent.
   ```

8. Insert `agent_earnings(agent_id, order_id, delivery_id, amount=agentEarning, currency, status='pending')`.
   `UNIQUE (delivery_id)` makes this insert idempotent on retries.

9. Update `deliveries.earning_amount = agentEarning`.

10. Commit.

### After commit

- Remove agent from `presence:busy:{region}`.
- Update `agent_presence.is_available = true` (via upsert).
- Invalidate order cache: `DEL {region}:os:order:{order.id}`.
- Emit WS `delivery.status_changed` to `customer:{id}`, `branch:{id}`, `agent:{id}`.

---

## 6. Cancellation While In Delivery

| Delivery status at cancel | Action |
|---|---|
| `assigned` or `accepted` | Mark delivery `cancelled`; remove agent from `presence:busy:{region}`; clear `orders.delivery_agent_id`; WS `task.cancelled` to agent. If the order was an online order with a `succeeded` charge, the cancellation flow also triggers a refund (see orders.md §9). |
| `picked` | **Forbidden** by the order-status validator. Food is already with the agent. Requires admin resolution via a separate support flow (out of scope for v1). |

---

## 7. RBAC

| Action | Role |
|---|---|
| `POST /deliveries/assign/{orderId}` (manual) | `system_admin` |
| `POST /deliveries/reassign/{orderId}` | `system_admin` |
| `PATCH /deliveries/{id}/status` | assigned `delivery_agent` (ownership checked in service) |

Permission seed: `deliveries:assign` (admin-only). Agents are not RBAC-permissioned for their own task — ownership check is done in the service layer.

---

## 8. Invariants

1. An order has at most one active delivery row (`status IN ('assigned', 'accepted', 'picked')`) at any time. Enforced by the partial unique index `uq_deliveries_active_per_order`.
2. `deliveries.status = 'delivered'` implies `agent_earnings(delivery_id)` exists.
3. `deliveries.status = 'delivered'` implies `restaurant_balances.balance` was incremented atomically in the same transaction.
4. Reassignment chain length ≤ `MAX_REASSIGNMENT_ATTEMPTS` per order.
5. `delivery.agent_id` matches the actor on every `PATCH` — no agent can act on another agent's delivery row.
6. `agent_earnings.delivery_id` is unique — no double-earning for the same delivery.
7. Once a delivery reaches `delivered` or `cancelled`/`rejected`/`reassigned`, the row is **immutable** — no field other than analytics-style metadata may be updated. New facts always create new rows (e.g. reassignment chain).

---

## 9. Performance Notes

- Assignment radius scan **must** come from the Redis geo set (`presence:geo:{region}`) in steady state. Postgres GIST index on `agent_presence.location` is the fallback if Redis is empty or cold.
- The Redis geo set is kept current by every presence ping (write-through). Online/offline transitions add/remove the agent entry.
- `idx_deliveries_agent_id_status` covers the agent task list query.
- `orders.delivery_agent_id` (denormalized) covers the simpler "what is my current task" customer-facing lookup without joining `deliveries`.

---

## 10. WebSocket Events Emitted

| Event | Channel(s) | Payload |
|---|---|---|
| `task.assigned` | `agent:{agentId}` | `DeliveryTaskResponseDTO` |
| `task.cancelled` | `agent:{agentId}` | `{ deliveryId, reason }` |
| `delivery.status_changed` | `customer:{customerId}`, `branch:{branchId}` | `{ orderPublicId, deliveryId, status, agent: { id, name, phone? }, updatedAt }` |
| `agent.location_updated` | `order:{publicId}` | `{ agentId, lat, lng }` — emitted on every presence ping while agent has active delivery |

---

## 11. Error Catalogue

| Error constant | HTTP | Thrown when |
|---|---|---|
| `OrderNotReadyError` | 409 | Order is not in `ready` status for assignment |
| `OrderAlreadyHasActiveDeliveryError` | 409 | Active delivery row already exists for this order |
| `MaxReassignmentAttemptsReachedError` | 409 | Reassignment chain exceeded `MAX_REASSIGNMENT_ATTEMPTS` |
| `NoEligibleAgentsError` | 409 | No online, available agents within radius |
| `AgentInActiveDeliveryError` | 409 | Manual assignment to an agent who has an active delivery |
| `InvalidDeliveryStatusTransitionError` | 409 | Requested (from, to) delivery status pair is not allowed |
| `DeliveryNotOwnedByAgentError` | 403 | Agent trying to update a delivery that is not assigned to them |
