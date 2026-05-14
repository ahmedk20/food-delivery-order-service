# QuickBite — Order & Payment Service: Project Guidelines

This file is the authoritative reference for Claude when working in this codebase. Every decision
must be consistent with these rules. Do not deviate without an explicit user instruction.

---

## 1. Project Identity

This is the **order-and-payment microservice** of the QuickBite food-delivery platform. It handles:
- Order lifecycle (placement → delivery)
- Payment processing (Kashier v3 online, cash-on-delivery)
- Delivery agent auto-assignment, presence, and earnings
- Restaurant balance tracking and admin-initiated payouts

It does **not** own user accounts, restaurants, branches, products, or authentication. Those live
in the **core service** (`food-delivery-core-service`). This service calls the core service
synchronously for data it needs (product price/stock, address details, user lookups).

---

## 2. Stack (identical to core service unless noted)

| Concern | Library | Notes |
|---|---|---|
| Runtime | Node.js (tsx in dev) | Same as core |
| Framework | Express 5 | Same |
| Language | TypeScript 5 (strict) | Same |
| DB query builder | Knex 3 + `pg` | Same; DB name: `order_service` |
| DB sharding | Per-region Postgres clusters | One cluster per country; routing key: `region TEXT` |
| Cache | ioredis 5 via `ICacheProvider` | Same interface |
| Auth / JWT | jose 6 (verify only — tokens issued by core) | No token issuance here |
| DI | TSyringe | Same container pattern |
| Validation | class-validator + class-transformer | Same DTOs |
| Env validation | Zod | Same |
| Logging | winston (singleton `logger`) | Same pattern |
| Correlation | X-CorrelationId header | Same middleware |
| Idempotency | `Idempotency-Key` header | Same middleware |
| WebSocket | `socket.io` + `@socket.io/redis-adapter` on same HTTP server | New — not in core |
| HTTP client | Native `fetch` (Node 18+) | New — for core service sync calls; no axios dependency |
| Payment | Kashier v3 (hosted sessions + webhook) | New |
| Async messaging | RabbitMQ via `amqplib` + Transactional Outbox | New — inter-service events |
| Partitioning | pg_partman (installed via custom Docker image) | New — manages monthly range partitions on high-volume tables |

---

## 3. Folder Structure

```
src/
├── app/                        # Business modules (app-aware, imports from lib and pkg)
│   ├── order/
│   │   ├── controller/
│   │   ├── dto/
│   │   ├── entity/
│   │   ├── repository/
│   │   ├── service/
│   │   ├── enums.ts
│   │   ├── errors.ts
│   │   └── routes.ts
│   ├── payment/
│   │   ├── controller/
│   │   ├── dto/
│   │   ├── entity/
│   │   ├── repository/
│   │   ├── service/
│   │   ├── enums.ts
│   │   ├── errors.ts
│   │   └── routes.ts
│   ├── delivery/               # Delivery assignment lifecycle (deliveries table)
│   │   ├── controller/
│   │   ├── dto/
│   │   ├── entity/
│   │   ├── repository/
│   │   ├── service/
│   │   ├── errors.ts
│   │   └── routes.ts
│   ├── delivery-agent/         # Agent presence, tasks, and earnings (agent_presence table)
│   │   ├── controller/
│   │   ├── dto/
│   │   ├── entity/
│   │   ├── repository/
│   │   ├── service/
│   │   ├── errors.ts
│   │   └── routes.ts
│   ├── restaurant-orders/      # Restaurant dashboard: order views + finance (balance, payouts)
│   │   ├── controller/
│   │   ├── dto/
│   │   ├── service/
│   │   └── routes.ts
│   ├── admin/
│   │   ├── controller/
│   │   ├── dto/
│   │   ├── service/
│   │   └── routes.ts
│   └── health/
│       └── routes.ts
│
├── lib/                        # App-aware infrastructure (imports pkg, used by app/)
│   ├── auth/
│   │   ├── guard.ts            # JWT verify middleware (reads access_token cookie)
│   │   ├── rbac.ts             # Role-based access control middleware
│   │   └── errors.ts
│   ├── cache/
│   │   ├── init.ts             # Redis provider initialization
│   │   └── withCache.ts        # GET response cache middleware
│   ├── config/
│   │   └── env.ts              # Zod-validated env object
│   ├── correlation/
│   │   └── correlationId.ts
│   ├── di/
│   │   ├── container.ts        # TSyringe container setup
│   │   └── tokens.ts           # DI token symbols
│   ├── error/
│   │   ├── AppError.ts
│   │   └── errorHandler.ts
│   ├── http/
│   │   ├── response.ts                     # sendSuccess / sendPaginated
│   │   ├── idempotency.ts
│   │   ├── core-service-client.interface.ts # ICoreServiceClient
│   │   ├── core-service-client.ts          # CoreServiceClient — native fetch + AbortController
│   │   └── pagination/
│   │       ├── cursor-pagination.ts
│   │       └── parse-query.ts
│   ├── knex/
│   │   ├── knex.ts             # db(region) + dbArchive(region) + pingAll
│   │   ├── shards.ts           # Lazy Knex connection cache per cluster (Map<string,Knex>)
│   │   └── knexfile.ts         # Requires REGION + CLUSTER env vars; throws if missing
│   ├── sharding/
│   │   └── region-resolver.ts  # resolveRegion, requireRegion, requireConcreteRegion
│   ├── logger/
│   │   └── logger.ts
│   ├── types/
│   │   └── express.d.ts        # req.user + req.region augmentation
│   ├── validation/
│   │   └── validate.ts
│   └── websocket/
│       ├── socket-server.ts    # socket.io server + @socket.io/redis-adapter setup
│       ├── socket-auth.ts      # JWT auth middleware for socket.io handshake
│       └── events.ts           # WS_EVENTS constants (dot-notation)
│
├── pkg/                        # Pure provider implementations (NO app imports, NO lib imports)
│   ├── cache/
│   │   ├── cache.interface.ts
│   │   └── redis.ts
│   ├── payment/
│   │   ├── payment-provider.interface.ts
│   │   └── kashier.ts          # Kashier v3 implementation
│   └── utils/
│       └── time.ts
│
├── database/
│   └── migrations/             # Knex migration files (timestamp_description.ts)
│
├── app.ts                      # Express app factory
├── routes.ts                   # Main router
└── server.ts                   # HTTP + WebSocket server bootstrap
```

### Layer Import Rules (STRICT)

| Layer | May import from | Must NOT import from |
|---|---|---|
| `pkg/` | Node stdlib, npm packages only | `lib/`, `app/` |
| `lib/` | `pkg/`, npm packages | `app/` |
| `app/` | `lib/`, `pkg/`, npm packages | other `app/` modules directly |

Modules under `app/` communicate through services via DI, never by importing each other's
repositories directly.

---

## 4. Naming Conventions

### Database (snake_case everywhere)
- Table names: `orders`, `order_items`, `transactions`, `payment_sessions`, `deliveries`, `idempotency_keys`, `agent_presence`, `agent_earnings`, `restaurant_balances`
- Column names: `country_code`, `created_at`, `subtotal`, `dst_acc_id`, `public_id`
- Constraint names:
  - FK: `fk_{table}_{column}` e.g. `fk_order_items_order`
  - UQ: `uq_{table}_{column}` e.g. `uq_restaurant_balances_restaurant`
  - CK: `ck_{table}_{column}` e.g. `ck_orders_status`
  - IDX: `idx_{table}_{column(s)}` e.g. `idx_orders_customer_id`
  - Trigger: `trg_{table}_{event}` e.g. `trg_orders_after_status_change`
  - Function: `fn_{description}` e.g. `fn_update_updated_at`

### TypeScript (camelCase)
- Entity properties: camelCase, mapped from snake_case in `toEntity()`
- DTO class names: `PascalCaseDTO` suffix e.g. `PlaceOrderDTO`
- Entity class names: `PascalCaseEntity` suffix e.g. `OrderEntity`
- Enum names: PascalCase with values SCREAMING_SNAKE_CASE or lowercase string
- Error constants: PascalCase e.g. `OrderNotFoundError`, `InvalidOrderStatusError`
- Service methods: camelCase verbs e.g. `placeOrder`, `confirmOrder`
- Repository functions: camelCase verb e.g. `findOrderById`, `createOrder`

### Files (kebab-case)
- `order.entity.ts`, `place-order.dto.ts`, `order.repo.ts`, `order.service.ts`
- `order.controller.ts`, `order.errors.ts`, `order.enums.ts`, `order.routes.ts`

### Routes (kebab-case paths)
- `/api/orders`, `/api/orders/:id/cancel`, `/api/agents/me/presence`

---

## 5. Database Conventions

### Money / Amounts
All monetary values are stored as **integers in the smallest currency unit** (piastres for EGP,
halalas for SAR). Never store floats for money. Divide by 100 at the API response layer only.

### Currency
- Currency is resolved once at order placement: `currencyForCountry(countryCode)` in
  `pkg/utils/currency.ts` (`EG → 'EGP'`, `SA → 'SAR'`).
- The result is written to `orders.currency` and **copied verbatim** to every downstream money
  row (`transactions`, `restaurant_balances`, `agent_earnings`). Downstream code must never
  re-derive currency from `country_code` — the order owns its currency for life.
- Money columns on those tables are `CHAR(3) NOT NULL` with **no default** — every insert
  passes currency explicitly.

### Timestamps
- Use `TIMESTAMP` (not `TIMESTAMPTZ`) consistently — store UTC.
- Every mutable table has `created_at TIMESTAMP NOT NULL` and `updated_at TIMESTAMP NOT NULL`.
- Soft-deletes: add `deleted_at TIMESTAMP` where applicable (orders never hard-delete).
- `updated_at` is managed by a DB trigger (same pattern as core service).

### Sharding (per-region clusters)
- **Architecture**: one independent Postgres cluster per country (`eg`, `ksa`, ...). No Citus coordinator. The DB column and code identifier is `region TEXT NOT NULL` so the router stays generic if a country is ever sub-sharded (e.g. `eg-cai`).
- **Routing key**: `region TEXT NOT NULL` — present on every sharded table as the second column after `id`. All queries are region-isolated: every caller must pass a region to `db(region)`.
- **Sharded tables**: `orders`, `order_items`, `transactions`, `payment_sessions`, `deliveries`, `idempotency_keys`, `restaurant_balances`, `agent_presence`, `agent_earnings`.
- **`payment_providers`** is a normal table replicated to every shard via migration (no Citus `create_reference_table` call).
- **PKs**: `BIGSERIAL PRIMARY KEY` for non-partitioned tables. Partitioned tables (`orders`, `transactions`, `deliveries`, `payment_webhook_events`) use a composite PK `(id, <partition_key>)` because PostgreSQL requires the partition key in every unique constraint. `restaurant_balances` uses a composite PK `(restaurant_id, currency)` — no surrogate key.
- **Simple FKs**: no need to include `region` in FK column lists.
- **FKs to partitioned tables are logical only**: DB-level foreign keys cannot reference a partitioned table unless the FK includes all partition key columns. Rather than denormalizing `created_at` onto every child table, we drop the DB-level constraint and enforce referential integrity in the service layer (same pattern as cross-service FKs). Affected: `order_items → orders`, `payment_sessions → orders`, `transactions → orders`, `deliveries → orders`, `agent_earnings → orders`, `agent_earnings → deliveries`.
- **`agent_presence` generated column**: `location GEOGRAPHY GENERATED ALWAYS AS (ST_MakePoint(last_lng::float, last_lat::float)::geography) STORED` — lat/lng and the geography column can never drift.
- **`country_code`** stays as a business column on `orders` only — it drives `currencyForCountry()`. Do not confuse it with `region`; they hold the same value at insert time but serve different roles.
- **Migrations run per-shard explicitly**: `REGION=eg CLUSTER=hot npm run migrate`. The knexfile throws if `REGION` is not set.
- **`db(region)` is a function, not a singleton** — it calls `getHotShard(region)` from `lib/knex/shards.ts`. Pass `region` to every repository call; never import a bare `db` constant.

### Indexes — Query-Driven (no speculative indexes)

Create an index only when there is a concrete query that needs it. Each index must have a
corresponding query comment explaining why it exists. Index every FK column used in JOINs.

Naming: `idx_{table}_{column(s)}` — multi-column indexes list all columns left-to-right.

### Partitioning

Four tables are range-partitioned monthly by pg_partman. See `docs/partitioning.md` for the
full Docker setup, DDL, and migration approach.

| Table | Partition key | Retention (hot cluster) |
|---|---|---|
| `orders` | `created_at` | 24 months |
| `transactions` | `created_at` | 24 months |
| `deliveries` | `assigned_at` | 24 months |
| `payment_webhook_events` | `created_at` | 6 months |

Key constraints that flow from this:
- Every unique index on a partitioned table must include the partition key column.
- `UNIQUE (public_id)` on `orders` becomes `UNIQUE (public_id, created_at)` — uniqueness is
  guaranteed per-partition; global UUID uniqueness relies on collision probability.
- `UNIQUE (idempotency_key)` on `transactions` becomes `UNIQUE (idempotency_key, created_at)`.
- `UNIQUE (provider_id, provider_event_id)` on `payment_webhook_events` becomes
  `UNIQUE (provider_id, provider_event_id, created_at)`. Cross-partition webhook dedup is
  handled by the `core-events:dedupe:{eventId}` Redis key (TTL 24h).
- The partial unique index on `deliveries` becomes `(order_id, assigned_at) WHERE status IN
  ('assigned', 'accepted', 'picked')`. The application layer enforces the global (cross-partition)
  single-active-delivery guarantee.

### Migrations
- File format: `{YYYYMMDDHHmmss}_{description}.ts`
- Use `knex.raw()` with raw SQL (same as core service pattern — no knex schema builder).
- Always include `up` and `down` functions.
- Never drop a column in a migration without checking all queries first.
- Seed data (e.g. `payment_providers`) goes in a separate seed migration file.
- pg_partman must be enabled before any partitioned-table migration:
  `{ts}_enable_pg_partman.ts` runs `CREATE SCHEMA partman; CREATE EXTENSION pg_partman SCHEMA partman`.

### External References
This service does NOT own users, restaurants, branches, or products. Foreign keys to those
entities are **logical only** (no DB-level FK constraint crossing service boundaries). The
application layer is responsible for validating existence via core service HTTP calls.

---

## 6. Code Patterns

### Entity Pattern
```typescript
// src/app/order/entity/order.entity.ts
export class OrderEntity {
  id: number;
  publicId: string;      // UUID — the only ID ever returned to clients
  region: string;
  countryCode: string;   // business column: drives currency; same value as region at insert time
  customerId: number;
  subtotal: number;      // sum of (unit_price × quantity) for all items, in minor units
  deliveryFee: number;
  serviceFee: number;
  commission: number;
  discount: number;
  total: number;
  // ... all properties camelCase
  createdAt: Date;
  updatedAt: Date;

  constructor(data: Partial<OrderEntity>) {
    this.id = data.id!;
    this.publicId = data.publicId!;
    this.region = data.region!;
    this.countryCode = data.countryCode!;
    // nullable: data.deliveryAgentId ?? null
    // timestamps: data.createdAt ?? new Date()
  }
}
```

### Repository Pattern
```typescript
// src/app/order/repository/order.repo.ts
const ORDER_COLUMNS = ['id', 'region', 'country_code', 'customer_id', ...];

function toEntity(row: any): OrderEntity {
  return new OrderEntity({
    id: row.id,
    region: row.region,
    countryCode: row.country_code,
    // map every snake_case → camelCase
  });
}

export async function findOrderById(id: number, region: string): Promise<OrderEntity | undefined> {
  const row = await db(region)('orders')
    .select(ORDER_COLUMNS)
    .where({ id })
    .first();
  return row ? toEntity(row) : undefined;
}

// All writes accept optional conn for transaction support; region is always required
export async function createOrder(data: Partial<OrderEntity>, region: string, conn?: Knex): Promise<OrderEntity> {
  const knex = conn ?? db(region);
  const [row] = await knex('orders').insert({ ... }).returning(ORDER_COLUMNS);
  return toEntity(row);
}
```

### Service Pattern
```typescript
@injectable()
export class OrderService {
  constructor(
    @inject(TOKENS.CacheProvider) private readonly cache: ICacheProvider,
    @inject(TOKENS.CoreServiceClient) private readonly coreClient: ICoreServiceClient,
  ) {}

  placeOrder = async (customerId: number, region: string, data: PlaceOrderDTO): Promise<PlaceOrderResponseDTO> => {
    const trx = await db(region).transaction();
    try {
      // business logic
      await trx.commit();
      return result;
    } catch (err) {
      await trx.rollback();
      throw err;
    }
  }
}
```

### Controller Pattern
```typescript
@injectable()
export class OrderController {
  constructor(@inject(TOKENS.OrderService) private readonly orderService: OrderService) {}

  placeOrder = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = await validateBody(PlaceOrderDTO, req.body);
      const result = await this.orderService.placeOrder(req.user!.userId, req.region!, dto);
      sendSuccess(res, result, 201);
    } catch (err) {
      next(err);
    }
  }
}
```

### Response DTOs
Unlike the core service (which returns entities directly), **all controller responses must go
through a typed Response DTO**. This prevents accidental leakage of internal fields.

```typescript
// src/app/order/dto/order-response.dto.ts
export class OrderResponseDTO {
  id: string;            // public_id (UUID) — NEVER expose the internal bigint id
  status: OrderStatus;
  subtotal: number;      // in minor units (piastres / halalas)
  total: number;
  currency: string;
  // ...

  static fromEntity(entity: OrderEntity, items?: OrderItemEntity[]): OrderResponseDTO {
    const dto = new OrderResponseDTO();
    dto.id = entity.publicId;   // expose publicId, not entity.id
    // map fields
    return dto;
  }
}
```

### Error Pattern
```typescript
// src/app/order/errors.ts
import AppError from '../../lib/error/AppError.js';

export const OrderNotFoundError = new AppError('Order not found', 404);
export const OrderAlreadyCancelledError = new AppError('Order is already cancelled', 409);
export const InvalidOrderStatusTransitionError = (from: string, to: string) =>
  new AppError(`Cannot transition order from ${from} to ${to}`, 422);
```

### DI Tokens
Add every new service and controller to `src/lib/di/tokens.ts`:
```typescript
export const TOKENS = {
  // existing...
  OrderService: Symbol('OrderService'),
  OrderController: Symbol('OrderController'),
  PaymentService: Symbol('PaymentService'),
  // ...
};
```

---

## 7. Authentication & Authorization

### JWT Verification
This service only **verifies** JWTs issued by the core service. It does not issue them.
The `authenticate` middleware reads the `access_token` cookie, verifies the signature using the
shared `ACCESS_SECRET`, and populates `req.user`.

The `req.user` payload mirrors the core service JWT shape:
```typescript
interface JWTPayload {
  userId: number;
  role: SystemRole;      // customer | delivery_agent | restaurant_user | system_admin
  countryCode: string;   // user's home country (profile field) — NOT used for DB routing
  restaurantId?: number;
  restaurantRole?: string;
  branchIds?: number[];
}
```

### Middleware Stack (applied in order on every request)
1. `correlationId` — sets X-CorrelationId
2. `resolveRegion` — reads `X-Region` header → sets `req.region`; never throws
3. `authenticate` — verifies JWT cookie; populates `req.user`
4. Role / permission guards (see below)

### Route-Level Guards
- Customer routes: `authenticate`, `requireRole('customer')`, `requireRegion`
- Delivery agent routes: `authenticate`, `requireRole('delivery_agent')`, `requireRegion`
- Delivery assign/reassign (admin-initiated): `authenticate`, `requireSystemAdmin()`, `requireConcreteRegion`
- Restaurant order/finance routes: `authenticate`, `requireRestaurantMember()`, `requireRegion`, `rbac({ resource, action })`
- Restaurant payout (admin): `authenticate`, `requireSystemAdmin()`, `requireConcreteRegion`
- Admin read routes (`/api/admin/*`): `authenticate`, `requireSystemAdmin()` (allows `X-Region: all` for fan-out reads)
- Internal cross-service routes (`/api/internal/*`): `requireInternalHmac()` (no JWT auth)
- Webhook endpoints (`/api/payments/webhook/{provider}`): **no auth middleware** — verified by Kashier HMAC inside the handler

`requireRegion` throws `RegionNotResolvedError` (400) if `req.region` is undefined. `requireConcreteRegion` additionally rejects the `"all"` value (used on all write endpoints that touch a single shard).

### RBAC
The `rbac({ resource, action })` middleware resolves the calling role's permissions from a Redis-backed projection at `core:rbac:perms:{roleName}`, populated via `core-client.getPermissionsByRole()` (TTL 5 minutes). Invalidated when a `rbac.permissions_changed` event arrives over RabbitMQ. Ownership checks (e.g., this order belongs to this customer) live in the **service layer** because they require a DB lookup.

See `docs/business-logic/rbac.md` for the permission seed and per-endpoint matrix.

---

## 8. Redis Key Conventions

All order-service keys follow: `{region}:os:{entity}:{identifier}` pattern.

| Key | TTL | Purpose |
|---|---|---|
| `{region}:os:order:{publicId}` | 300s | Single order detail cache (keyed by UUID) |
| `{region}:os:orders:customer:{customerId}:{cursor}:{filtersHash}` | 60s | Customer order list |
| `{region}:os:orders:branch:{branchId}:{status}:{cursor}` | 30s | Restaurant branch order list |
| `{region}:os:balance:{restaurantId}:{currency}` | 5s | Restaurant balance cache (short TTL — high stakes) |
| `{region}:os:idempotency:{userId}:{method}:{path}:{key}` | 86400s | Idempotency replay cache (user-scoped); DB `idempotency_keys` is the fallback |
| `presence:geo:{region}` | no TTL | Agent geo sorted set — maintained by presence pings |
| `presence:busy:{region}` | no TTL | Set of agent IDs with an active delivery |
| `presence:meta:{region}:{agentId}` | 90s | Agent online flag + last_seen_at hash |
| `core:branch:{branchId}` | 60s | Cached branch metadata (region derivation for POST /orders) |
| `core:rbac:perms:{roleName}` | 300s | Permission list fetched from core service |
| `core-events:dedupe:{eventId}` | 86400s | RabbitMQ event dedup — prevents double-processing on redelivery |

> Payment sessions are no longer cached in Redis — they are persisted to the `payment_sessions` DB table. Redis held only the session URL; the table holds the full lifecycle and idempotency context.

The `{region}:os:` prefix scopes order-service keys per region and avoids collisions with core service keys in a shared Redis instance. Presence keys use a separate `presence:` namespace.

---

## 9. WebSocket Events

`socket.io` server mounted at `/ws` on the same HTTP server. Multi-instance fan-out via
`@socket.io/redis-adapter` (no sticky load balancer required).

### Authentication
JWT supplied at handshake via `socket.handshake.auth.token` (preferred) or the `access_token`
cookie as a same-origin fallback. Verified with `jose` against `ACCESS_SECRET`. Failed handshake
→ connection rejected with `unauthorized`.

### Rooms
- `customer:{userId}` — customer's own channel
- `order:{publicId}` — anyone authorized for that specific order (customer, restaurant member, assigned agent); keyed by UUID not bigint
- `branch:{branchId}` — restaurant dashboard for a branch
- `agent:{agentId}` — agent's own channel

### Server → Client Events
| Event | Payload | Room |
|---|---|---|
| `order.status_changed` | `{ orderId, status, updatedAt }` | `order:{publicId}` |
| `order.created` | `{ orderId, customerId, subtotal, createdAt }` | `branch:{branchId}` |
| `order.delivery_assigned` | `{ orderId, agentId }` | `order:{publicId}` |
| `order.cancelled` | `{ orderId, reason }` | `order:{publicId}` |
| `agent.location_updated` | `{ agentId, lat, lng }` | `order:{publicId}` |
| `payment.succeeded` | `{ orderId, transactionId }` | `order:{publicId}` |
| `payment.failed` | `{ orderId, reason }` | `order:{publicId}` |

### Client → Server Events
| Event | Payload | Handler |
|---|---|---|
| `subscribe` | `(channel, ack)` | Validate channel ∈ allowedChannels (or run on-demand ownership check for `order:<id>`), join room, ack `{ ok: true }` |
| `unsubscribe` | `(channel)` | Leave room |
| `agent:location` | `{ lat, lng }` | `delivery_agent` role only — calls `agentService.updatePresence` |

On connection the server emits `hello { allowedChannels }` so the client knows what it can
subscribe to without round-tripping.

---

## 10. Core Service Communication

### Synchronous (HTTP via CoreServiceClient)

Called at order-placement time only. Never call during read-only paths (use cached snapshots instead).

| Call | Purpose | Failure strategy |
|---|---|---|
| `GET /api/products/:id/branch/:branchId` | Validate price + stock | Fail order with 422 |
| `GET /api/customer/addresses/:id` | Snapshot delivery address | Fail order with 422 |
| `GET /api/user/:id` | Validate customer exists | Fail order with 422 |

Use the `ICoreServiceClient` interface injected via DI. The concrete `CoreServiceClient`
implementation lives in `lib/http/core-service-client.ts` and uses native `fetch` with an
`AbortController` 5-second timeout per attempt. **Retry policy**: 3 attempts with exponential
backoff (100ms → 200ms → 400ms, capped at 500ms total wait); retries only on network errors or
5xx responses. Non-retryable failures (4xx, stock conflicts) surface immediately.

After the order DB transaction commits, call `coreClient.reserveStock(items)` out-of-transaction
to decrement product stock. If this call fails, void the order (cancel + refund) — do not leave
an order with unreserved stock.

### Asynchronous (future)
- Place order → increment `total_orders` on restaurant (analytics counter, fire-and-forget)
- Order delivered → trigger customer notification (push/email, via event bus)
These are marked as `// TODO: async event` comments at the relevant call sites.

---

## 11. Performance Rules

### No N+1 Queries
Never query inside a loop. For order items: always use a single `WHERE order_id IN (ids)` query,
then group in application memory.

```typescript
// WRONG
for (const order of orders) {
  order.items = await findItemsByOrderId(order.id);
}

// RIGHT
const orderIds = orders.map(o => o.id);
const allItems = await findItemsByOrderIds(orderIds, region);
const itemsMap = groupBy(allItems, 'orderId');
orders.forEach(o => { o.items = itemsMap[o.id] ?? []; });
```

### Always pass region to db()
Every sharded table query runs through `db(region)`. Never import `db` as a singleton. The region comes from `req.region` (set by `resolveRegion` middleware) and must be threaded through to every service and repository call.

### Snapshots Over Joins
Order items store a snapshot of `product_name`, `unit_price`, `product_image_url` at order time.
Never join back to the core service DB to resolve product data on reads.

### Pagination
All list endpoints use **cursor-based pagination** (id-based cursor, no OFFSET). Default page
size is 20. Maximum is 100.

### Cache Aggressively, Invalidate Precisely
- On order status change: `del({region}:os:order:{id})`
- On new order: `del({region}:os:orders:branch:{branchId}:*)` (pattern delete or let TTL expire)

---

## 12. Kashier v3 Payment Integration

See `docs/business-logic/payments.md` for full flow documentation.

Key rules:
- Payment sessions are created server-side (never expose `KASHIER_API_KEY` to clients).
- Every Kashier session is persisted to the `payment_sessions` table at creation time. Webhook handlers look up the session by `provider_session_id` — not by order ID alone.
- Webhook endpoint is unauthenticated but **must verify the HMAC-SHA256 signature using `KASHIER_WEBHOOK_SECRET`** (not the API key) before trusting the payload.
- Use `UNIQUE (idempotency_key, created_at)` on the `transactions` table to prevent double-processing webhooks (partition key must be included — see Partitioning section).
- Transactions are immutable once `status = 'succeeded'` or `status = 'failed'`.
- On payment failure (`payment.failed` webhook): order status stays `pending_payment` — it is NOT terminal. The customer may retry. A background sweep cancels `pending_payment` orders older than `PAYMENT_SESSION_TIMEOUT_MIN` (default 15 min).

---

## 13. Error Handling

Same pattern as core service:

- `AppError(message, statusCode)` for all domain errors
- Global `errorHandler` middleware handles all thrown errors
- Operational errors (isOperational: true) return their message to the client
- Programming errors (isOperational: false) return "Something went wrong"
- HTTP 400: validation / bad request
- HTTP 401: not authenticated
- HTTP 403: not authorized
- HTTP 404: resource not found
- HTTP 409: conflict (duplicate, wrong state)
- HTTP 422: business rule violation (invalid status transition, out of stock)

---

## 14. Idempotency

Use the `idempotency()` middleware on:
- `POST /api/orders` (place order)
- `POST /api/payments/init` (create Kashier session)
- `POST /api/orders/:publicId/cancel`
- `POST /api/restaurant/payouts` (admin payout)

**Two-layer idempotency**:
1. **Redis** (`{region}:os:idempotency:{userId}:{method}:{path}:{key}`, TTL 24h) — fast path.
2. **`idempotency_keys` DB table** — fallback when Redis is unavailable. The table stores a `key_hash` (SHA-256 of the full key), `request_fingerprint` (hash of the request body), `response_body JSONB`, and `expires_at`. On Redis miss, the middleware falls back to a DB lookup before processing the request.

The `transactions` table additionally has a `UNIQUE (idempotency_key, created_at)` constraint for database-level dedup of Kashier webhook replays, independent of the HTTP middleware (partition key included — see Partitioning section).

---

## 15. Environment Variables

```
APP_STAGE=dev|production|test
PORT=3001
HOST=localhost
APP_BASE_URL=http://localhost:3001  # public base URL — used to build the Kashier serverWebhook URL

REGIONS=eg,ksa                      # comma-separated list; must match DB_<r>_* keys below

DB_eg_HOST=localhost
DB_eg_PORT=5432
DB_eg_USERNAME=postgres
DB_eg_PASSWORD=
DB_eg_NAME=order_service_eg
ARCHIVE_DB_eg_HOST=localhost
ARCHIVE_DB_eg_PORT=5432
ARCHIVE_DB_eg_USERNAME=postgres
ARCHIVE_DB_eg_PASSWORD=
ARCHIVE_DB_eg_NAME=order_service_archive_eg

DB_ksa_HOST=localhost
DB_ksa_PORT=5432
DB_ksa_USERNAME=postgres
DB_ksa_PASSWORD=
DB_ksa_NAME=order_service_ksa
ARCHIVE_DB_ksa_HOST=localhost
ARCHIVE_DB_ksa_PORT=5432
ARCHIVE_DB_ksa_USERNAME=postgres
ARCHIVE_DB_ksa_PASSWORD=
ARCHIVE_DB_ksa_NAME=order_service_archive_ksa

DB_POOL_MIN=2
DB_POOL_MAX=10                      # per shard; total connections = REGIONS × 2 × DB_POOL_MAX per instance

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

ACCESS_SECRET=                      # Shared with core service (JWT verification)
CORE_SERVICE_URL=http://localhost:3000

KASHIER_MERCHANT_ID=
KASHIER_API_KEY=                    # Session creation auth header
KASHIER_WEBHOOK_SECRET=             # HMAC key for webhook signature verification
KASHIER_BASE_URL=https://checkout.kashier.io
KASHIER_RETURN_URL=https://app.quickbite.example/checkout/return
KASHIER_FAIL_URL=https://app.quickbite.example/checkout/failed

CORS_ORIGINS=http://localhost:3000

RABBITMQ_URL=amqp://guest:guest@localhost:5672
INTERNAL_HMAC_SECRET=               # Shared secret for internal service-to-service webhooks

# Delivery auto-assignment tuning
ASSIGNMENT_RADIUS_METERS=5000       # GEOSEARCH radius for candidate agents
AGENT_ACCEPT_TIMEOUT_SEC=30         # Seconds before trying next candidate
MAX_REASSIGNMENT_ATTEMPTS=3         # After this many failures → broadcast mode
AGENT_SHARE_RATE=1.0                # Fraction of delivery_fee kept by agent (1.0 in v1)

# Background jobs
PAYMENT_SESSION_TIMEOUT_MIN=15      # Minutes before pending_payment orders are auto-cancelled
PRESENCE_STALE_SEC=90               # Seconds before an agent is removed from the geo set
```

---

## 16. What NOT to do

- Do NOT use `SELECT *` — always specify `COLUMNS` array and select explicitly.
- Do NOT store float/decimal for money — use integers (piastres).
- Do NOT cross service boundaries with DB joins — snapshot data at write time.
- Do NOT call core service during read paths — use persisted snapshots.
- Do NOT process Kashier webhooks without signature verification.
- Do NOT return raw entity objects from controllers — always map to Response DTOs.
- Do NOT add indexes speculatively — only add when a concrete query requires it.
- Do NOT call `db()` without a region argument — always `db(region)` or `db(region).transaction()`.
- Do NOT hardcode region strings — always read from `req.region` or validated `env.regions`.
- Do NOT use OFFSET pagination — use cursor-based pagination.
- Do NOT import `app/` modules from `lib/` or `pkg/`.
- Do NOT import one `app/` module's repository from another `app/` module.
- Do NOT expose the Kashier API key to clients — session creation is server-side only.
- Do NOT expose internal bigint `id` fields in API responses — always use `public_id` (UUID).
- Do NOT use `KASHIER_API_KEY` for webhook signature verification — the webhook secret is `KASHIER_WEBHOOK_SECRET`; these are distinct credentials.
- Do NOT treat a `payment.failed` webhook as a terminal order state — the order stays `pending_payment` so the customer can retry; only the background sweep cancels it after timeout.
- Do NOT create a new `deliveries` row on reassignment mutations — insert a new row with `reassigned_from` pointing to the previous one; never mutate a delivered/cancelled delivery row.
- Do NOT add a DB-level `FOREIGN KEY` constraint from any child table to `orders`, `transactions`, `deliveries`, or `payment_webhook_events` — these are partitioned tables; the constraint cannot be enforced without including the partition key in the FK. Use logical-only FKs and enforce referential integrity in the service layer.
- Do NOT create a `UNIQUE` constraint on a single column for a partitioned table — the partition key must be part of every unique constraint. E.g. `UNIQUE (idempotency_key, created_at)` not `UNIQUE (idempotency_key)`.
- Do NOT rely on the per-partition `uq_deliveries_active_per_order` index alone to enforce single-active-delivery globally — it is only enforced within one partition. The service layer must check across partitions before inserting.
