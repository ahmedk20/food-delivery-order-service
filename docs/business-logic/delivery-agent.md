# Business Logic — Agents Module

Owner module: `app/delivery-agent/`

Responsible for agent presence (real-time location and availability), the agent-facing task list, and earnings reporting. Delivery assignment and lifecycle are in `deliveries.md`.

Delivery agents are authenticated via the same JWT issued by the core service with `role = 'delivery_agent'`. This service does not manage agent accounts — only their operational state during active sessions.

---

## 1. Presence Model

### What Presence Means

An agent's presence is their current operational snapshot:
- **Location** (`last_lat`, `last_lng`) — where they are right now.
- **Online** (`is_online`) — they have the app open and are working a shift.
- **Available** (`is_available`) — online AND no active delivery AND willing to accept new orders.

### Presence Storage — Two Layers

**Layer 1 — Redis** (primary read path):

| Key | TTL | Purpose |
|---|---|---|
| `presence:geo:{region}` | no TTL | Redis geo sorted set; `GEOADD` on every ping; `GEOSEARCH` for auto-assignment |
| `presence:busy:{region}` | no TTL | Set of agent IDs currently assigned to an active delivery |
| `presence:meta:{region}:{agentId}` | 90s | Hash: `{ is_online, last_seen_at }` — a missing/expired key means offline |

**Layer 2 — DB (`agent_presence` table)** (durable source of truth):
Written on every presence update via UPSERT. Used as cold-start fallback (Redis just flushed / restarted), admin queries (`/api/admin/agents`), and the Postgres GIST fallback for assignment when the Redis geo set is empty.

When Redis is up, only the geo set is consulted on the assignment hot path — the DB write is a fire-and-forget durability log. When Redis is cold the assignment service falls back to:

```sql
SELECT agent_id
FROM agent_presence
WHERE is_online = true
  AND is_available = true
  AND last_seen_at > NOW() - INTERVAL '90 seconds'
ORDER BY ST_Distance(location, ST_MakePoint(:branchLng, :branchLat)::geography)
LIMIT :k;
```

This uses the partial GIST index `idx_agent_presence_location_gist`.

### Update Frequency

Clients call `POST /agents/presence/ping` every **10–15 seconds** while active. Server writes to both Redis and DB on every call. Debouncing happens on the client.

A reconciliation worker runs every 60 seconds and removes agents from the Redis geo set whose `last_seen_at` is older than `PRESENCE_STALE_SEC` (env, default 90s).

---

## 2. POST /agents/presence/online

Agent signals they are starting a shift.

**Request**:
```ts
class PresenceOnlineRequestDTO {
  lat: number;  // -90 to 90
  lng: number;  // -180 to 180
}
```

**Steps**:
1. Upsert `agent_presence(agent_id, is_online=true, is_available=true, last_lat, last_lng, last_seen_at=NOW())`.
2. `GEOADD presence:geo:{region} <lng> <lat> {agentId}`.
3. Set `presence:meta:{region}:{agentId} { is_online: '1', last_seen_at: <now> }` with TTL 90s.
4. Return `{ ok: true }`.

---

## 3. POST /agents/presence/offline

Agent signals they are ending their shift.

**Pre-condition**: agent must not have an active delivery (`status IN ('assigned', 'accepted', 'picked')`). If they do → 409 `AgentInActiveDelivery`.

**Steps**:
1. Upsert `agent_presence(is_online=false, is_available=false, last_seen_at=NOW())`.
2. `ZREM presence:geo:{region} {agentId}`.
3. Delete `presence:meta:{region}:{agentId}`.
4. Return `{ ok: true }`.

---

## 4. POST /agents/presence/ping

Heartbeat — updates location and keeps the agent alive in Redis.

**Request**: same as `online`.

**Pre-condition**: agent must be online. If `presence:meta:{region}:{agentId}` is missing (expired or never online) → 409 `AgentNotOnline`.

**Steps**:
1. Upsert `agent_presence(last_lat, last_lng, last_seen_at=NOW())`.
2. `GEOADD presence:geo:{region} <lng> <lat> {agentId}` (updates position).
3. Refresh `presence:meta:{region}:{agentId}` TTL to 90s.
4. **If agent has an active delivery** (check `orders` table for `delivery_agent_id = agentId AND status IN ('assigned', 'accepted', 'picked')`):
   - Emit WS `agent.location_updated` to `order:{activeOrder.publicId}`:
     ```json
     { "agentId": 77, "lat": 30.0444, "lng": 31.2357 }
     ```
5. Return `{ ok: true }`.

---

## 5. GET /agents/tasks?status=

Returns the agent's delivery task list.

**Query params**: `status` (filter by delivery status), cursor, limit.

**Implementation**:
```sql
SELECT d.*, o.public_id AS order_public_id, o.subtotal, o.delivery_fee, o.currency, o.payment_method
FROM deliveries d
JOIN orders o ON o.id = d.order_id
WHERE d.agent_id = :agentId
  AND (:status IS NULL OR d.status = :status)
ORDER BY d.assigned_at DESC
LIMIT :limit
```

Uses `idx_deliveries_agent_id_status` index. No N+1 (single join query).

**Response**: paginated `DeliveryTaskResponseDTO[]` including pickup/dropoff coords, order summary, and earning estimate.

---

## 6. GET /agents/earnings?from=&to=

Returns the agent's earnings history.

**Query params**: `from` (ISO date), `to` (ISO date), `status` (`pending | paid`), cursor, limit.

**Aggregates** (single query, no N+1):
```typescript
const knex = db(region);
const totals = await knex('agent_earnings')
  .where({ agent_id: agentId })
  .select(
    knex.raw('SUM(CASE WHEN status = ? THEN amount ELSE 0 END) AS total_pending', ['pending']),
    knex.raw('SUM(CASE WHEN status = ? THEN amount ELSE 0 END) AS total_paid',    ['paid'])
  )
  .first();
```

> `db` is a function in this service, not a singleton. `db(region).raw(...)` works too; binding to a local `knex` avoids re-resolving the shard for each `.raw()`.

**Response meta** includes `total_pending` and `total_paid` aggregates alongside the paginated list.

---

## 7. Earnings Model

### Earning Amount

```typescript
const agentEarning = Math.floor(order.deliveryFee * agentShareRate);
// agentShareRate from env/config (currently 1.0 — agent keeps full delivery fee in v1)
```

Adjust `agentShareRate` when the commission model is introduced.

### Earning Lifecycle

- `pending` — earned; not yet paid out.
- `paid` — payout transferred (future feature).

One `agent_earnings` row per delivery. Created atomically with the `delivered` status update (see deliveries.md §5). `UNIQUE (delivery_id)` makes it idempotent.

---

## 8. Authorization

| Endpoint | Who |
|---|---|
| `POST /agents/presence/online` | `delivery_agent` only |
| `POST /agents/presence/offline` | `delivery_agent` only |
| `POST /agents/presence/ping` | `delivery_agent` only |
| `GET /agents/tasks` | `delivery_agent` only |
| `GET /agents/earnings` | `delivery_agent` only |
| `GET /admin/agents` | `system_admin` only |

---

## 9. Error Catalogue

| Error constant | HTTP | Thrown when |
|---|---|---|
| `AgentNotOnlineError` | 409 | Ping or offline called but agent is not registered as online |
| `AgentInActiveDeliveryError` | 409 | Agent tries to go offline while assigned to an active delivery |
| `AgentPresenceNotFoundError` | 404 | No presence record exists (agent never checked in) |
