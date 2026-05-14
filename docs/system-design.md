# System Design — `order-service`

This document explains the architectural decisions behind the Orders & Payments microservice, how it fits into QuickBite, and the trade-offs taken.

```
[Customer App] [Restaurant Dashboard] [Delivery App] [Admin Dashboard]
        \           |           |          /
         \          |           |         /
          \         v           v        /
           +────►  CORE-SERVICE (users, restaurants, branches, products, RBAC, auth)
                       ▲              ▲
                  sync HTTP        async via RabbitMQ (bidirectional:
                       │              order → core: business events from outbox
                       │              core → order: cache + RBAC invalidation)
                       v              v
                  ORDER-SERVICE (this) ◄──── socket.io (+ Redis adapter) ──── all client apps
                  / │ │ \
                 /  │ │  \
       Postgres ◄──┘ │  └──► Redis (cache + presence + socket.io pub/sub)
       (N hot clusters,
        one per region)
                       │
                       └────► Kashier (payment provider — sync session create + async webhook)

       Postgres archive clusters (one per region, cold) — populated by future archival worker

(future) Analytics service — out of scope
```

---

## 1. Service Boundaries

### What this service owns

- The **lifecycle and state** of every order, payment, transaction, and delivery.
- The **money ledger** for restaurants (balances, future payouts, commissions, refunds).
- **Real-time** order/delivery updates to all four client apps.

### What it does NOT own

- Users, auth tokens, RBAC permission catalog, restaurants, branches, products, customer addresses → `core-service`.
- Analytics aggregations, dashboards, KPIs → future analytics service.
- Image hosting / CDN → core-service uploads, S3 + CDN.

### Why split orders out from core?

1. **Different write profile.** Core is read-heavy (browse menus). This service is the high-write, money-critical path. Separating lets us scale and optimize independently.
2. **Stronger isolation.** Money and order data live in their own DB cluster; a noisy menu-browsing query cannot starve checkout.
3. **Per-region sharding fits orders** (locality is real — a customer orders in their city, fulfilled by a local restaurant and a local agent), but doesn't fit the global product catalog.
4. **Independent failure domain.** A core-service incident doesn't have to take down customer order placement (we degrade gracefully via cache).

---

## 2. Sharding Strategy

### Shard key: country (region)

**N independent Postgres clusters** — one hot cluster per country (`eg`, `ksa`, ...), plus one archive cluster per country. No Citus coordinator. The code identifier is `region TEXT NOT NULL` so the router stays generic if a country is ever sub-sharded (e.g. `eg-cai`) — in this milestone `region == country code` (lowercase).

All tables in the order domain live on the same cluster per region — any join inside the order domain stays local, no cross-cluster joins needed. `payment_providers` is a normal table replicated to every cluster via migration.

### Why country (and not customer_id, restaurant_id, order_id)?

| Candidate | Locality | Hot-spot risk | Cross-shard reads |
|---|---|---|---|
| customer_id | poor | low | restaurant view of all its orders → fan-out |
| restaurant_id | poor | very high (one big chain) | customer order history → fan-out |
| order_id | none | low | every read is fan-out |
| **country** | **high** | medium (peak meal hours) | rare; only system-admin global views |

A customer in Egypt orders from a restaurant in Egypt, fulfilled by an agent in Egypt. The restaurant dashboard for any branch in Egypt reads only Egyptian orders. **All three actors are co-located in the same country.** That makes country the natural shard key.

The hot-spot risk during meal times is mitigated by:
- **Redis caching** of the read-heavy "pending orders" list per branch.
- **Horizontal scaling** of the order-service stateless tier per region.
- (Read replicas are not introduced in this milestone; revisit per-region when traffic justifies it.)

### Resolving the region per request

Region comes from the **`X-Region` header** (e.g. `X-Region: eg`). Not in the JWT, not in the URL, not a cookie. `X-Region: all` is permitted for system_admin fan-out reads; all writes must resolve a concrete region.

**`POST /orders` fallback**: if no `X-Region` header is present, the order controller derives the region from the `branchId` in the request body via cached branch metadata (`core:branch:{branchId}`, TTL 60s). This is the only endpoint with a non-header fallback. If neither header nor `branchId` yields a valid region → 400 `RegionNotResolvedError`.

**Public-ID lookups (`GET /orders/:publicId`, `POST /payments/init`, etc.)**: clients MUST send the `X-Region` header. The service does not maintain a global UUID→region index — fan-out across every cluster on each public-id read would defeat the point of sharding. The frontend remembers the region returned from `POST /orders` (or stored alongside the order) and echoes it on every follow-up call.

The JWT's `countryCode` claim is a user-profile field and is **not** the DB routing key; it is never used to select a cluster.

### Cross-shard reads

Only one pattern exists, outside the hot path:

1. **System admin global views** — a fan-out controller queries each region's cluster sequentially or in parallel up to a cap. The cursor includes the region tag (`{region}:{id}`) so pages remain stable across fan-out. With ~2 regions today (`eg`, `ksa`) this is cheap.

### What lives outside the shards

- `payment_providers` — a normal table present on every cluster via migration. Small, low-write.
- `outbox` (future) — node-local on the same cluster as the region it serves.
- Migrations — run explicitly against each cluster: `REGION=eg CLUSTER=hot npm run migrate`.

---

## 3. Caching Layers (Redis)

### Layer A — Read-through cache for cross-service data

| Key pattern | Source | TTL | Invalidation |
|---|---|---|---|
| `core:branch:{branchId}` | `core-service GET /api/internal/branches/:id` | 60s | TTL; invalidated by `branch.updated` event |
| `core:product:{branchId}:{productId}` | `core-service GET /api/internal/products/:id/branch/:branchId` | 30s | invalidated by `product.price_changed` and `product.availability_changed` events |
| `core:restaurant:{id}` | `core-service GET /api/internal/restaurants/:id` | 5m | TTL; invalidated by `restaurant.status_changed` event |
| `core:rbac:perms:{roleName}` | `core-service GET /api/roles/:name/permissions` | 5m | invalidated by `rbac.role_updated` event |

### Layer B — Endpoint cache (`withCache` middleware)

Used for:
- `GET /restaurant/orders?branchId=&status=placed` (per-branch, 10s TTL).
- `GET /agents/tasks?status=` (per-agent, 5s TTL).

WebSocket events on state change ensure clients don't actually rely on polling — the cache absorbs misbehaving clients.

### Layer C — Idempotency cache

`{region}:os:idempotency:{userId}:{method}:{path}:{key}` — 24h TTL. If Redis is unavailable, fall back to the `idempotency_keys` DB table.

The service has **three** independent idempotency layers, each scoped to a different concern:

| Layer | Where | Purpose |
|---|---|---|
| HTTP `Idempotency-Key` | Redis cache + `idempotency_keys` table | Replays the cached response on duplicate `POST /orders`, `POST /payments/init`, `POST /payments/{id}/refund`, `POST /restaurant/payouts`, `PATCH /orders/{id}/status` |
| Webhook event dedup | `UNIQUE (provider_id, provider_event_id)` on `payment_webhook_events` | Drops Kashier webhook re-deliveries before any side effects run |
| Transaction insert dedup | `UNIQUE (idempotency_key)` on `transactions` | Defense-in-depth for retries that bypassed the cache (admin payouts, programmatic refunds). The column stores a **namespaced** value — `webhook:{eventId}` or `req:{httpKey}` — so a Kashier event-id can never accidentally collide with a user-supplied header value. |

A request that survives all three is genuinely new.

### Layer D — Agent presence cache

Three keys per region:
- `presence:geo:{region}` — Redis geo sorted set. `GEOADD` on every ping; `GEOSEARCH` for auto-assignment.
- `presence:busy:{region}` — Set of agent IDs currently assigned to an active delivery. Updated atomically on assignment / release.
- `presence:meta:{region}:{agentId}` — Hash: `{ is_online, last_seen_at }` (TTL 90s). Missing/expired key → agent treated as offline.

The DB `agent_presence` row is the durable source of truth. A reconciliation worker runs every 60s and removes agents from the geo set whose `last_seen_at` is older than `PRESENCE_STALE_SEC`.

### Layer E — WebSocket fan-out (socket.io Redis adapter)

Services emit via `io.to("<room>").emit(event, payload)`. The `@socket.io/redis-adapter` uses Redis pub/sub to deliver the message to whichever worker holds the target socket. No per-region fan-out channel and no sticky load balancer — any worker can serve any client on reconnect.

---

## 4. Synchronous Communication with `core-service`

### Use cases

1. **Validate branch** — required on `POST /orders` if not in cache.
2. **Fetch fresh price/stock** — at order time if cache TTL elapsed.
3. **Validate customer address** — snapshot delivery coordinates and address text.
4. **Stock reservation** — after order commit, `core-client.reserveStock(branchId, items)` decrements stock atomically.
5. **RBAC permissions** — first call after deploy or after cache invalidation.

### Implementation: `lib/http/core-service-client.ts`

- Thin HTTP client over **native `fetch`**. Implements `ICoreServiceClient`.
- **Timeout**: 5-second `AbortController` per call.
- **Retry**: 3 attempts with exponential backoff (100ms → 200ms → 400ms, capped at 500ms total wait). Only retries on network errors or 5xx; does not retry on 4xx.
- All calls forward `X-CorrelationId` for tracing.
- Authentication: HMAC-SHA256 over `${timestamp}:${method}:${path}` with `INTERNAL_HMAC_SECRET`, sent as `x-internal-signature` + `x-internal-timestamp` headers.

**Per-call degradation policies:**

| Call | On failure |
|---|---|
| Branch validation | Must succeed → 503 |
| Product price/stock | Must succeed → 503 |
| Address fetch | Must succeed → 503 |
| Stock reservation | Void order with `reason='out_of_stock_post_commit'` if post-commit |
| Permission lookup | Serve stale cache up to 1h; after that deny |

---

## 5. Asynchronous Communication

Two async paths in v1:

- **Outbound**: business events the core service needs (`order.placed`, `order.delivered`, `payment.completed`, `order.cancelled`, …). Emitted via the **Transactional Outbox** pattern — written into a node-local `outbox` table inside the same DB transaction as the business write, then dispatched to RabbitMQ by a polling worker. Subscribers today: core-service (analytics counters, customer notifications).
- **Inbound from `core-service`**: cache invalidation and RBAC invalidation events.

### Transport: RabbitMQ

| Component | Name | Owner |
|---|---|---|
| Topic exchange | `core.events` (durable) | declared by core; defensively redeclared here at startup |
| Consumer queue | `order-service.core-events` (durable) | this service |
| Bindings | `product.#`, `branch.#`, `restaurant.#`, `rbac.#` | this service |
| Dead-letter exchange | `core.events.dlx` | this service |
| Dead-letter queue | `order-service.core-events.dlq` | this service |
| Prefetch | 32 messages per channel | this service |

The consumer declares its own queue, bindings, and DLQ at startup (idempotent). Core only declares the exchange.

### Events consumed (routing key = `eventType`)

| Event | Trigger in core | Action in order-service |
|---|---|---|
| `product.price_changed` | menu price edit | invalidate `core:product:{branchId}:{productId}` |
| `product.availability_changed` | stock decrement / toggle | invalidate `core:product:{branchId}:{productId}` |
| `branch.updated` | branch metadata change | invalidate `core:branch:{branchId}` |
| `branch.status_changed` | branch turned off / on | invalidate `core:branch:{branchId}` + reject new orders if `accept_orders=false` |
| `restaurant.status_changed` | restaurant suspended / restored | invalidate `core:restaurant:{id}` |
| `rbac.role_updated` | role/permission edited | invalidate `core:rbac:perms:{roleName}` |

### Message envelope

```jsonc
{
  "eventId": "<uuid, stable across broker redeliveries>",
  "eventType": "product.price_changed",
  "occurredAt": "2026-04-16T15:00:00.000Z",
  "payload": { /* event-specific */ }
}
```

### Consumer flow

1. Receive message.
2. Redis `SET core-events:dedupe:{eventId} "1" NX EX 86400` — set-if-absent with 24h TTL.
3. If already set → already processed → **ack** and return.
4. Otherwise dispatch to the handler registered for `eventType`.
5. On success → **ack**.
6. On failure → **nack with requeue=false** (message flows to DLQ). Alert on DLQ depth.

Delivery semantics: **at-least-once**. All handlers are idempotent cache invalidations — an expired key re-running a handler is harmless.

---

## 6. Kashier v3 Integration

We integrate per the official docs — Payment Sessions to initiate, Webhook to confirm.

### Init flow (online payment) — two steps

```
client                  order-service                     Kashier
  │  POST /orders          │                                │
  │ ─────────────────────► │                                │
  │                        │ create order (status='pending_payment')
  │                        │ insert transactions(type='cod_collection') [COD only]
  │                        │ commit                         │
  │  { publicId }          │                                │
  │ ◄───────────────────── │                                │
  │  POST /payments/init { orderId }                        │
  │ ─────────────────────► │                                │
  │                        │ check payment_sessions table   │
  │                        │ POST Kashier /sessions ─────► │
  │                        │ ◄─── { sessionId, redirectUrl }│
  │                        │ insert payment_sessions row    │
  │  { redirectUrl }       │                                │
  │ ◄───────────────────── │                                │
  │ ──── redirect ─────────────────────────────────────► hosted payment page
  │                                                          │
  │                                            ◄─── customer pays ─── │
  │                        │ ◄─── webhook ──── │             │
  │                        │ verify HMAC (KASHIER_WEBHOOK_SECRET)
  │                        │ idempotency: INSERT payment_webhook_events ON CONFLICT DO NOTHING
  │                        │ update payment_sessions.status='captured'
  │                        │ insert transactions(type='charge', status='succeeded')
  │                        │ update orders.status='placed'
  │                        │ upsert restaurant_balances
  │                        │ publish WS (payment.completed, order.status_changed, order.created)
  │                        │ commit                          │
```

### COD flow

- Order created with `payment_method='cod'` → `status='placed'` directly (no `pending_payment` step).
- `transactions(type='cod_collection', status='pending')` inserted at order creation.
- On `delivered`: `cod_collection` flipped to `succeeded`; `restaurant_balances` credited.

### Webhook security

- Verify HMAC using **`KASHIER_WEBHOOK_SECRET`** (not `KASHIER_API_KEY`) over the sorted query string of `signatureKeys`-selected fields from `payload.data`.
- Reject if signature missing/invalid → **401** + log alert.
- Reject duplicates via `INSERT INTO payment_webhook_events ... ON CONFLICT DO NOTHING`. If `rowCount === 0` → already processed → return 200.

### `payment_sessions` table

Every Kashier session is persisted to the DB, not just cached in Redis. This means:
- Webhook handlers look up the session by `provider_session_id` — no fan-out across clusters needed.
- If Redis is cleared, outstanding sessions are not lost.
- Full audit trail of session attempts including retries.

### Pending payment timeout

`pending_payment` orders not confirmed within `PAYMENT_SESSION_TIMEOUT_MIN` (default 15 min) are auto-cancelled by a background sweep worker. This prevents orphaned orders from accumulating in the restaurant queue.

---

## 7. WebSocket Layer

### Protocol

- **`socket.io`** server, mounted on the same HTTP server as Express (`server.ts`) at path `/ws`.
- Uses `@socket.io/redis-adapter` for horizontal fan-out across workers — no sticky load balancer required.
- Clients connect:
  ```ts
  const socket = io("wss://<host>", {
    path: "/ws",
    auth: { token: "<jwt>" },
    transports: ["websocket"],
  });
  ```
- Server middleware verifies the JWT, stashes the user on `socket.data.user`, and computes the rooms they may join.
- Client emits `subscribe(channelName, ack)` / `unsubscribe(channelName)`. Server checks the allowed set; ack returns `{ ok: true }` or `{ ok: false, error }`.
- Server emits a `hello { allowedChannels }` event immediately after connection.

### Channels & Events

| Channel | Events | Subscribers |
|---|---|---|
| `customer:{userId}` | `order.status_changed`, `delivery.status_changed`, `payment.completed`, `payment.failed` | the customer |
| `restaurant:{restId}` | `order.created`, `order.cancelled` | restaurant owner |
| `branch:{branchId}` | `order.created`, `order.status_changed`, `order.cancelled`, `delivery.assigned`, `delivery.status_changed` | branch staff & managers |
| `agent:{agentId}` | `task.assigned`, `task.cancelled` | the agent |
| `order:{publicId}` | `order.status_changed`, `delivery.status_changed`, `agent.location_updated`, `payment.completed`, `payment.failed` | customer + restaurant member + assigned agent |

> Naming: `delivery.assigned` is the one-shot event fired when a delivery row is first created (signals a courier has been chosen). `delivery.status_changed` covers every subsequent transition (`accepted`, `picked`, `delivered`, `cancelled`). Clients that want a single feed can subscribe only to `delivery.status_changed` — the initial assignment also publishes a `delivery.status_changed` with `status: 'assigned'`.

### Why socket.io (not raw `ws`)?

- Built-in room management, reconnection handling, and ack protocol.
- `@socket.io/redis-adapter` eliminates the need for a sticky load balancer.
- Client reconnect can land on any worker; missed events recoverable via REST poll.
- Bi-directional commands (`subscribe`, `unsubscribe`, agent pings) make socket.io the right shape vs SSE.

---

## 8. High Availability

- **Stateless service tier** with autoscaling. Any instance can serve any country's request.
- **Redis** with at least one replica per region.
- **Kashier outage**: COD is unaffected. `POST /payments/init` returns 503; order stays `pending_payment`; customer retries. Sweep cancels after 15 min if not resolved.
- **Core-service outage**: cached branch/product data lets us serve GETs and accept orders that hit cached branches. New branches not yet cached are unservable (503). Permission lookups serve stale cache up to 1h.
- **Inbound core webhook delivery down**: cache TTLs eventually expire and reads fall back to live core-client lookups.

---

## 9. Strong Consistency for Money

Money paths are wrapped in `db(region).transaction()` with `SELECT ... FOR UPDATE` on `restaurant_balances` rows where they participate.

### Online payment confirmation (Kashier webhook → `captured`)

1. Parse `publicId` from webhook payload to recover region and order.
2. Idempotency check via `payment_webhook_events` unique constraint.
3. Lock `restaurant_balances` row (`FOR UPDATE`; insert zeroed row first if missing).
4. Update `payment_sessions.status = 'captured'`.
5. Insert `transactions(type='charge', status='succeeded')`.
6. Update `orders.status = 'placed'`.
7. Upsert `restaurant_balances.balance += subtotal - commission`.
8. Commit.

### Cash on delivery — agent marks `delivered`

1. Lock `restaurant_balances` row.
2. Flip `transactions(type='cod_collection')` from `pending` → `succeeded`.
3. Insert `transactions(type='commission')` if commission > 0.
4. Insert `agent_earnings`.
5. Update `orders.status = 'delivered'`.
6. Upsert `restaurant_balances.balance += subtotal - commission`.
7. Commit.

---

## 10. Archival & Retention

PRD §9: only the **current year** of orders is queryable from hot DB; older data lives in cold storage.

Plan (a future phase, not v1):
1. **One archive Postgres cluster per region** (`order_service_archive_{region}`) — identical schema to the hot cluster.
2. A nightly archival worker copies rows older than the current year into the archive cluster for the same region (in batches of 1000), validates the copy with `ON CONFLICT DO NOTHING` for re-run safety, then deletes from hot.
3. Table walk respects FK dependencies: `{agent_earnings, transactions, order_items, payment_sessions, deliveries}` (any order among those) → `orders` deleted last.
4. List endpoints gate by year — current year hits hot DB; older years route to the archive cluster connection.
5. A Redis lock (`archival:lock`) prevents duplicate runs if multiple workers start.

---

## 11. Failure Modes & Graceful Degradation

| Failure | Behavior |
|---|---|
| Postgres primary down | Writes and reads fail with 503; managed failover restores within seconds |
| Redis down | Cache misses → DB. HTTP idempotency falls back to `idempotency_keys` table. Presence geo sets lost — assignment falls back to Postgres GIST. socket.io fan-out broken across instances until Redis adapter reconnects; existing sockets stay open. |
| Kashier down | COD unaffected; online checkout returns 503; order stays `pending_payment`; sweep cancels after 15 min |
| Core-service sync down | New orders to uncached branches fail 503; cached branches still work; permissions serve stale cache up to 1h |
| RabbitMQ down | Producer + consumer loops reconnect with backoff. Outbox accumulates; drains when broker returns. API responses are unaffected — outbox writes share the same DB transaction as the business write. |
| WS worker crash | Client reconnects automatically; reconnect can land on any worker; missed events recoverable via REST poll |

---

## 12. Security Summary

- All endpoints require JWT auth except:
  - `POST /api/payments/webhook/{provider}` — verified by **`KASHIER_WEBHOOK_SECRET`** HMAC.
  - `POST /api/internal/*` — verified by HMAC over `${timestamp}:${method}:${path}` using `INTERNAL_HMAC_SECRET`.
  - `GET /api/health`.
- RBAC: role from JWT (`req.user.role`). Permissions resolved from `core:rbac:perms:{roleName}` (Redis, 5m TTL). Ownership checks live in the service layer.
- Cross-region tamper prevention: every write resolves `req.region` from the `X-Region` header. A request to a concrete region can only read or write rows in that region's cluster.
- Provider secrets (`KASHIER_API_KEY`, `KASHIER_WEBHOOK_SECRET`, `INTERNAL_HMAC_SECRET`, `ACCESS_SECRET`) live in env; never logged, never returned in responses.
- Public-facing IDs are UUIDs (`orders.public_id`) — internal bigint `id` never leaves this service.
- Idempotency keys are user-scoped — keyed by `(user_id, method, path, key)` so one user can't replay another user's response.
