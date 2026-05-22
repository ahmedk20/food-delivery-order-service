# Implementation Plan — Order & Payment Service

Implement modules one at a time in the order below. Each phase is complete when:
- All migration files run without error
- All entities, repos, services, controllers, and routes for the phase are implemented
- TypeScript compiles with zero errors (`tsc --noEmit`)

Do not proceed to the next phase until the current one is green.

---

## Phase 0 — Project Bootstrap

**Goal**: runnable Express server with health endpoint, DB connection, Redis, and DI wired up.

### 0.1 Package Setup
- Copy `package.json` from core service, update `name` to `order-service`, set `PORT=3001`.
- Add new dependencies: `socket.io`, `@socket.io/redis-adapter`, `amqp-connection-manager`, `amqplib`. Dev: `@types/amqplib`. **Do not add axios** — use Node 18+ native `fetch`.
- Run `npm install`.

### 0.2 tsconfig.json
- Mirror core service `tsconfig.json` exactly (ES2022, NodeNext, strict, decorators).

### 0.3 Environment
Create `.env.dev` with the full variable set up front so later phases don't have to revisit
this file. Must match CLAUDE.md §15 exactly.
```
APP_STAGE=dev
PORT=3001
HOST=localhost
APP_BASE_URL=http://localhost:3001            # used by PaymentService for the Kashier serverWebhook URL

# Per-region Postgres clusters. One block per region.
REGIONS=eg,ksa

DB_eg_HOST=localhost
DB_eg_PORT=5432
DB_eg_NAME=order_service_eg
DB_eg_USER=postgres
DB_eg_PASSWORD=
DB_eg_POOL_MIN=2
DB_eg_POOL_MAX=10

ARCHIVE_DB_eg_HOST=localhost
ARCHIVE_DB_eg_PORT=5432
ARCHIVE_DB_eg_NAME=order_service_eg_archive
ARCHIVE_DB_eg_USER=postgres
ARCHIVE_DB_eg_PASSWORD=

DB_ksa_HOST=localhost
DB_ksa_PORT=5433
DB_ksa_NAME=order_service_ksa
DB_ksa_USER=postgres
DB_ksa_PASSWORD=
DB_ksa_POOL_MIN=2
DB_ksa_POOL_MAX=10

ARCHIVE_DB_ksa_HOST=localhost
ARCHIVE_DB_ksa_PORT=5433
ARCHIVE_DB_ksa_NAME=order_service_ksa_archive
ARCHIVE_DB_ksa_USER=postgres
ARCHIVE_DB_ksa_PASSWORD=

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

ACCESS_SECRET=<same secret as core service>   # JWT verification
INTERNAL_HMAC_SECRET=<same secret as core>    # cross-service HMAC (consumed in Phase 2)

CORE_SERVICE_URL=http://localhost:3000

KASHIER_MERCHANT_ID=test_merchant
KASHIER_API_KEY=test_key
KASHIER_WEBHOOK_SECRET=test_webhook_secret    # separate secret for webhook HMAC verification
KASHIER_BASE_URL=https://checkout.kashier.io

CORS_ORIGINS=http://localhost:5173

RABBITMQ_URL=amqp://guest:guest@localhost:5672  # consumed in Phase 10
```

> Variables are introduced here so the Zod schema in `lib/config/env.ts` can validate the
> full surface at boot from day one. Phase 2 and Phase 10 reference some of these but do not
> add new env entries — they assume Phase 0.3 already declared them.

### 0.4 Core Infrastructure Files
Implement these files in order (each depends on the previous):

1. `src/lib/config/env.ts` — Zod schema (mirror core service, add new vars)
2. `src/lib/logger/logger.ts` — winston singleton (copy from core)
3. `src/lib/error/AppError.ts` — copy from core service verbatim
4. `src/lib/error/errorHandler.ts` — copy from core service verbatim
5. `src/lib/knex/knex.ts` + `knexfile.ts` — implement `db(region)`, `dbArchive(region)`, `pingAll()`; `knexfile.ts` reads `REGION` env var (required for CLI migrations: `REGION=eg CLUSTER=hot npm run migrate`)
5a. `src/lib/knex/shards.ts` — lazy `Map<string,Knex>` connection cache; `getHotShard(region)`, `getArchiveShard(region)`, `destroyAllShards()`
6. `src/pkg/cache/cache.interface.ts` — copy from core
7. `src/pkg/cache/redis.ts` — copy from core
8. `src/lib/cache/init.ts` — copy from core
9. `src/lib/correlation/correlationId.ts` — copy from core
10. `src/lib/http/response.ts` — copy from core (`sendSuccess`, `sendPaginated`)
11. `src/lib/validation/validate.ts` — copy from core
12. `src/lib/types/express.d.ts` — augment `Request` with `req.user: JWTPayload` and `req.region: string | undefined`
13. `src/lib/di/tokens.ts` — stub with all token symbols (no registrations yet)
14. `src/lib/di/container.ts` — empty container, register only CacheProvider for now
15. `src/lib/http/idempotency.ts` — copy from core
16. `src/lib/http/pagination/cursor-pagination.ts` + `parse-query.ts` — copy from core

### 0.5 Auth + Region Middleware
1. `src/lib/auth/errors.ts` — `NotAuthenticated`, `NotAuthorized`
2. `src/lib/auth/guard.ts` — `authenticate` middleware (verify JWT with `jose`, set `req.user`)
3. `src/lib/auth/rbac.ts` — `requireRole(role)`, `requireSystemAdmin()`, `requireRestaurantMember()` helpers; resolves permissions from `core:rbac:perms:{role}` Redis key (5m TTL), fetched via `CoreServiceClient.getRolePermissions`
4. `src/lib/sharding/region-resolver.ts` — `resolveRegion` (reads `X-Region` header → `req.region`; never throws), `requireRegion` (400 if `req.region` is unset), `requireConcreteRegion` (400 if `req.region === 'all'`)

> Note: this service has no `restaurant_members` table. RBAC is simpler — role is on the JWT.
> Guards are: `requireRole('customer')`, `requireRole('delivery_agent')`,
> `requireRestaurantMember()` (checks JWT `restaurantId`), `requireSystemAdmin()`.
> `resolveRegion` is mounted globally (see §0.6). `requireRegion` / `requireConcreteRegion`
> are applied per-router on endpoints that need a concrete shard target.

### 0.6 Health Route + App Bootstrap
1. `src/app/health/routes.ts`
2. `src/routes.ts`
3. `src/app.ts`
4. `src/server.ts`

**Checkpoint**: `npm run dev` → `GET /api/health` returns 200.

---

## Phase 1 — Database Migrations

**Goal**: all tables exist in the per-region `order_service_{region}` database.

Run each migration with `REGION=eg CLUSTER=hot npx knex migrate:up` after creating the file.
Repeat for every region you have configured in `REGIONS`.

### Migration Files

**1.0** `20260501000001_create_fn_update_updated_at.ts`
- Creates the `fn_update_updated_at()` trigger function used by all mutable tables.
- Must run **first** — all subsequent migrations reference it.

**1.1** `20260501000002_enable_pg_partman.ts`
- Enables the `pg_partman` extension needed by all partitioned tables.
- Must run **before** any partitioned-table migration (`orders`, `transactions`, `payment_webhook_events`).

**1.2** `20260501000003_create_payment_providers.ts`
- `payment_providers` table (see database-design.md).
- No Citus distribution — this is a plain table replicated identically to every per-region
  cluster by running the migration on each shard.
- Seed: insert `kashier` and `cod` rows.
- Must run **before** migration 1.6 (`transactions` has a FK to this table).

**1.3** `20260501000004_create_payment_webhook_events.ts`
- `payment_webhook_events` table — dedup store for incoming Kashier webhook deliveries.
- `UNIQUE (provider_id, provider_event_id, created_at)` is the primary idempotency mechanism
  (partition key included per partitioned-table constraint rules).

**1.4** `20260501000005_create_orders.ts`
- `orders` table with composite PK `(id, created_at)`, `region TEXT NOT NULL`, check constraints,
  indexes, `updated_at` trigger. Partitioned monthly by `created_at` via pg_partman.
- Includes `country_code TEXT NOT NULL` (business column — drives `currencyForCountry()`) and
  `currency CHAR(3) NOT NULL` — populated by the service at write time, never defaulted.
- No `create_distributed_table` call — each region has its own independent cluster.

**1.5** `20260501000006_create_order_items.ts`
- `order_items` table. FK to `orders(id)` is logical only — `orders` is a partitioned table.

**1.6** `20260501000007_create_transactions.ts`
- `transactions` table. FK to `orders(id)` is logical only (orders is partitioned); real FK to
  `payment_providers(id)`.
- Both `src_acc_id` and `dst_acc_id` are nullable (NULL = "platform is the party on that side"),
  guarded by `CHECK (src_acc_id IS NOT NULL OR dst_acc_id IS NOT NULL)`.
- `currency CHAR(3) NOT NULL` — no `DEFAULT`. Every insert must pass currency explicitly,
  copied from the order.
- `idempotency_key TEXT` with `UNIQUE (idempotency_key, created_at)` — secondary dedup layer for
  programmatic inserts (retried payouts, refunds). Primary webhook dedup is handled by
  `payment_webhook_events`.

**1.7** `20260501000008_create_restaurant_balances.ts`
- `restaurant_balances` table. Composite `PRIMARY KEY (restaurant_id, currency)` — no surrogate key.
- Three balance columns: `available_balance` (ready for payout), `pending_balance` (credited on
  payment confirmation; moved to available on delivery), `total_earned` (running total, never
  decremented).

**1.8** `20260501000009_create_agent_presence.ts`
- `agent_presence` table. `PRIMARY KEY (agent_id)` — one row per agent.
- `location GEOGRAPHY` is a generated column derived from `last_lat`/`last_lng`; NULL-safe (CASE
  guard when no location has been sent yet).

**1.9** `20260501000010_create_agent_earnings.ts`
- `agent_earnings` table. `UNIQUE (delivery_id)` — one earnings record per delivery.
- FKs to `orders` and `deliveries` are logical only (both partitioned).

**Checkpoint**: `REGION=eg CLUSTER=hot npx knex migrate:latest` runs without error. Inspect
tables in psql for the `eg` cluster.

---

## Phase 2 — Core Service HTTP Client

**Goal**: `ICoreServiceClient` implemented, injected into DI, callable from services.

### 2.1 Interface
`src/lib/http/core-service-client.interface.ts`

Lives in `lib/` (not `pkg/`) because it references `AppError` and service-specific types.

```typescript
export interface ProductBranchData {
  id: number; name: string; imageUrl: string | null;
  price: number; isAvailable: boolean; stock: number;
  restaurantId: number; branchId: number;
}
export interface AddressData {
  id: number; userId: number; label: string;
  country: string; city: string; street: string;
  building: string | null; apartmentNumber: string | null;
  type: string; lat: number; lng: number;
}
export interface UserData {
  id: number; email: string; name: string; deletedAt: Date | null;
}
export interface RolePermissionsData {
  roleName: string;
  permissions: { permission: string }[];
}
export interface BranchMetadata {
  branchId: number;
  restaurantId: number;
  region: string;   // routing key — e.g. 'eg', 'ksa'; cached 60s by the client
}

export interface ICoreServiceClient {
  getProductWithBranchDetails(productId: number, branchId: number, correlationId?: string): Promise<ProductBranchData>;
  getAddressById(addressId: number, correlationId?: string): Promise<AddressData>;
  getUserById(userId: number, correlationId?: string): Promise<UserData>;
  getRolePermissions(roleName: string, correlationId?: string): Promise<RolePermissionsData>;
  getBranchMetadata(branchId: number, correlationId?: string): Promise<BranchMetadata>;
}
```

### 2.2 CoreServiceClient Implementation
`src/lib/http/core-service-client.ts`

Use native `fetch` (Node 18+ built-in) — **no axios**.

**Auth**: HMAC-SHA256 per-request signature for internal endpoints. The client computes:
```
timestamp = Date.now()
sig = HMAC-SHA256(INTERNAL_HMAC_SECRET, `${timestamp}:GET:${path}`)
```
and sends `x-internal-signature` + `x-internal-timestamp` headers.

Public endpoints (e.g. `GET /api/roles/:name/permissions`) send no HMAC headers.

**Timeout**: 5-second `AbortController` on every request. No retry — fail fast, surface errors to the caller.

```typescript
@injectable()
export class CoreServiceClient implements ICoreServiceClient {
  private hmacHeaders(method: string, path: string): Record<string, string> {
    const timestamp = String(Date.now());
    const sig = createHmac('sha256', env.internalHmacSecret)
      .update(`${timestamp}:${method}:${path}`).digest('hex');
    return { 'x-internal-signature': sig, 'x-internal-timestamp': timestamp };
  }

  private async fetchJson<T>(path: string, headers: Record<string, string>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(`${env.coreServiceUrl}${path}`, { headers, signal: controller.signal });
      if (!res.ok) {
        if (res.status === 404) throw new AppError('Resource not found', 422);
        throw new AppError('Core service unavailable', 503);
      }
      const json = (await res.json()) as CoreEnvelope<T>;
      return json.data;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('Core service unavailable', 503);
    } finally { clearTimeout(timer); }
  }

  private getInternal<T>(path: string, correlationId?: string): Promise<T> { /* HMAC headers */ }
  private getPublic<T>(path: string, correlationId?: string): Promise<T>   { /* no HMAC */ }

  getProductWithBranchDetails(productId, branchId, correlationId?) {
    return this.getInternal<ProductBranchData>(
      `/api/internal/products/${productId}/branch/${branchId}`, correlationId
    );
  }
  getAddressById(addressId, correlationId?) {
    return this.getInternal<AddressData>(`/api/internal/customer/addresses/${addressId}`, correlationId);
  }
  getUserById(userId, correlationId?) {
    return this.getInternal<UserData>(`/api/internal/users/${userId}`, correlationId);
  }
  getRolePermissions(roleName, correlationId?) {
    return this.getPublic<RolePermissionsData>(
      `/api/roles/${encodeURIComponent(roleName)}/permissions`, correlationId
    );
  }
}
```

### 2.3 Core Service — Internal Routes (core service changes)
`src/lib/auth/internal.ts` — HMAC verification middleware:
- Parse `x-internal-signature` + `x-internal-timestamp` from headers.
- Reject if timestamp is > 60 seconds old (replay protection).
- Recompute HMAC using `req.originalUrl.split('?')[0]` (full path, not router-relative).
- Use `timingSafeEqual` for comparison.

`src/app/internal/routes.ts` — 3 endpoints, all behind `requireInternalHmac`:
```
GET /api/internal/products/:id/branch/:branchId
GET /api/internal/customer/addresses/:id
GET /api/internal/users/:id
```

### 2.4 Env Variable
`INTERNAL_HMAC_SECRET` is already declared in Phase 0.3 of this service's env file.
The **core service** must add a matching entry to its own `env.ts` and `.env.dev` —
the secret value is shared between the two services. Never exposed to clients.

### 2.5 Register in DI Container
```typescript
container.registerSingleton(TOKENS.CoreServiceClient, CoreServiceClient);
```

**Checkpoint**: call `getProductWithBranchDetails` with a valid product — verify response shape matches `ProductBranchData`. Call with an invalid ID — verify AppError 422 is thrown, not a crash.

---

## Phase 3 — Orders Module

Implement in this sub-order: money utils → entity → repo → service → controller → routes.

### 3.0 Money + Currency Utilities — `pkg/utils/money.ts`, `pkg/utils/currency.ts`

Add before any service that touches amounts. All amounts are stored as **integers in the
smallest currency unit** (piastres for EGP, halalas for SAR). Never do arithmetic on floats.

```typescript
// pkg/utils/currency.ts
const CURRENCY_BY_COUNTRY: Record<string, string> = {
  EG: 'EGP',
  SA: 'SAR',
};

export function currencyForCountry(countryCode: string): string {
  const code = CURRENCY_BY_COUNTRY[countryCode];
  if (!code) throw new Error(`No currency configured for country ${countryCode}`);
  return code;
}
```

The map is intentionally a code constant, not a DB table — currencies don't change at
runtime, and adding a new country requires a deployment anyway (Kashier credentials,
shard provisioning). Call `currencyForCountry(countryCode)` once at order placement and
write the result to `orders.currency`. Every downstream row (`transactions`,
`restaurant_balances`, `agent_earnings`) copies it from the order — never re-derives it
from country, so currency stays stable for the order's lifetime even if a country's
default currency ever changes.

```typescript
// Convert a major-unit price (e.g. 29.99 EGP) to minor units (piastres)
export function toMinor(majorAmount: number): number {
  return Math.round(majorAmount * 100);
}

// Convert minor units back to major for API responses only
export function fromMinor(minorAmount: number): number {
  return minorAmount / 100;
}

// Safe sum of minor-unit amounts (avoids floating-point drift)
export function sumMinor(amounts: number[]): number {
  return amounts.reduce((acc, n) => acc + n, 0);
}

// Multiply a unit price (minor) by a quantity — returns minor units
export function multiplyMinor(unitPriceMinor: number, quantity: number): number {
  return unitPriceMinor * quantity;
}
```

**Usage rule**: call `toMinor()` once at the boundary where external data enters the system
(price from core service snapshot). Use `sumMinor` / `multiplyMinor` for all internal math.
Call `fromMinor()` only inside Response DTOs, never inside business logic.

### 3.1 Entities
- `src/app/order/entity/order.entity.ts` — `OrderEntity` (all fields, constructor pattern)
  - Add `publicId: string` — UUID generated at insert time (`gen_random_uuid()`). This is the only
    ID exposed to clients; the internal integer `id` never leaves the service. Routes and response
    DTOs use `publicId`; repositories accept `publicId` for lookups initiated by clients and the
    internal integer `id` for intra-service joins.
- `src/app/order/entity/order-item.entity.ts` — `OrderItemEntity`

### 3.2 Enums + Errors
- `src/app/order/enums.ts` — `OrderStatus`, `PaymentMethod`
- `src/app/order/errors.ts` — all error constants, exported as canonical string codes:

```typescript
// Use PascalCase code strings — clients switch on these, not on message text.
export const OrderNotFoundError          = () => new AppError('OrderNotFound', 404);
export const OrderNotPayableError        = () => new AppError('OrderNotPayable', 422);
export const BranchNotAcceptingOrders    = () => new AppError('BranchNotAcceptingOrders', 409);
export const InvalidStatusTransitionError = (from: string, to: string) =>
  new AppError(`InvalidStatusTransition:${from}→${to}`, 409);
export const CancellationWindowExpiredError = () => new AppError('CancellationWindowExpired', 409);
export const OutOfStockError             = (details: object[]) =>
  new AppError('OutOfStock', 409, details);
```

> Every error message is the machine-readable code (PascalCase). The global `errorHandler`
> serializes it to `{ "error": "<code>" }`. Clients switch on the code string, not on free-text.

### 3.3 Repositories
- `src/app/order/repository/order.repo.ts`
  - `ORDER_COLUMNS` constant (include `public_id`)
  - `toEntity(row)` mapper
  - `findOrderById(id, region)` — internal use (joins, webhook handler)
  - `findOrderByPublicId(publicId, region)` — client-facing lookups
  - `findOrdersByCustomerId(customerId, region, pagination, statusFilter?)`
  - `findOrdersByBranchId(branchId, region, pagination, statusFilter?)`
  - `createOrder(data, region, conn?)` — `(conn ?? db(region))('orders').insert(...)`
  - `updateOrderStatus(id, region, status, extraFields?, conn?)`

- `src/app/order/repository/order-item.repo.ts`
  - `ORDER_ITEM_COLUMNS` constant
  - `toEntity(row)` mapper
  - `findItemsByOrderId(orderId, region)`
  - `findItemsByOrderIds(orderIds, region)` — single IN query, returns all items
  - `createItems(items[], region, conn?)`

> `findOrdersByAgentId` and `findAvailableOrders` live in the Delivery module repo (Phase 6),
> not here — the order repo is unaware of delivery assignment.

### 3.4 DTOs
**All request and response DTOs use camelCase field names** (matching TypeScript conventions
end-to-end). The `toEntity()` mapper in each repo handles the snake_case↔camelCase translation
at the DB boundary; no snake_case ever appears in a DTO.

- `src/app/order/dto/place-order.dto.ts` — `PlaceOrderDTO`, `OrderItemInputDTO`
  - `branchId`, `customerAddressId`, `paymentMethod`, `items[].productId`, `items[].quantity`
- `src/app/order/dto/update-order-status.dto.ts` — `UpdateOrderStatusDTO`
  - `status: OrderStatus` — allowed values depend on actor role (validated in service)
  - `reason?: string` — required for `cancelled` / `rejected` transitions (max 500 chars)
  - `estimatedDeliveryAt?: string` — ISO timestamp; required when restaurant accepts an order
- `src/app/order/dto/order-response.dto.ts` — `OrderResponseDTO.fromEntity(order, items?)`
  - Fields: `publicId`, `status`, `paymentMethod`, `branch`, `restaurant`, `customerAddress`,
    `subtotal`, `deliveryFee`, `serviceFee`, `total`, `currency`, `items`, `createdAt`
  - `subtotal` = sum of item line totals; `serviceFee` = platform fee; `total` = subtotal + deliveryFee + serviceFee
- `src/app/order/dto/order-list-item.dto.ts` — `OrderListItemDTO` (no items array, has `itemsCount`)

### 3.5 Service
`src/app/order/service/order.service.ts`

Methods:
- `placeOrder(customerId, region, dto)` — full flow from business-logic/orders.md; if `region` is undefined, derives it from `dto.branchId` via `coreClient.getBranchMetadata(branchId)` (cached, TTL 60s)
- `getOrderByPublicId(publicId, region, actorId, actorRole)` — returns `OrderResponseDTO`; ownership check inside
- `getMyOrders(customerId, region, pagination, statusFilter?)`
- `updateOrderStatus(publicId, region, actorId, actorRole, dto)` — **unified status transition method**;
  validates the requested transition is allowed for the actor's role, then delegates to the
  appropriate repo call. Replaces the old `cancelOrder` + `updateStatusByRestaurant` split.

### 3.6 Controller
`src/app/order/controller/order.controller.ts` — `@injectable()` `OrderController`

All methods as arrow functions. Each: `validateBody` → `service call` → `sendSuccess`.

### 3.7 Routes

Two routers: orders (public-facing) and customer orders (customer list).

```typescript
// src/app/order/routes.ts
export const orderRouter = Router();
orderRouter.post('/',
  authenticate, requireRole('customer'), requireRegion, idempotency(), ctrl.placeOrder);
orderRouter.get('/:publicId',
  authenticate, ctrl.getOrderByPublicId);  // ownership checked inside service
orderRouter.patch('/:publicId/status',
  authenticate, requireRegion, idempotency(), ctrl.updateOrderStatus);

// src/app/customer-orders/routes.ts  (thin — no separate module needed, same controller)
export const customerOrderRouter = Router();
customerOrderRouter.get('/',
  authenticate, requireRole('customer'), requireRegion, ctrl.getMyOrders);
```

Mount in `src/routes.ts`:
```typescript
router.use('/orders',           orderRouter);
router.use('/customer/orders',  customerOrderRouter);
```

**Register service + controller in** `src/lib/di/container.ts`.

**Checkpoint**: `POST /api/orders` returns 201 with `publicId` UUID. `GET /api/orders/:publicId` returns full order. `PATCH /api/orders/:publicId/status` with `{ "status": "cancelled", "reason": "..." }` cancels the order (role checked inside service).

---

## Phase 4 — Payments Module

Implement in this order: provider interface → Kashier impl → entity → repo → dto → service → controller → routes → DI.

### 4.1 `pkg/payment/payment-provider.interface.ts`

```typescript
export interface CreateSessionParams {
  orderId: number;              // our internal order id
  region: string;               // routing key — encoded into Kashier's `order` field as `${region}-${orderId}` so the webhook can recover both
  amount: string;               // Kashier requires amount as a string, e.g. "12.50"
  currency: string;             // e.g. "EGP", "SAR"
  merchantRedirectUrl: string;  // front-end redirect after payment
  serverWebhookUrl: string;     // Kashier will POST webhook here
  customer: {
    name: string;
    email: string;
    phone?: string;
  };
  expiresAt: string;            // ISO 8601 string
}

export interface SessionResult {
  sessionId: string;   // Kashier response._id
  sessionUrl: string;  // redirect the customer here
}

export interface IPaymentProvider {
  createSession(params: CreateSessionParams): Promise<SessionResult>;
  verifyWebhookSignature(payload: Record<string, any>, signature: string): boolean;
}
```

### 4.2 `pkg/payment/kashier.ts`

**Session creation**
```
POST https://api.kashier.io/v3/payment/sessions
Headers:
  Authorization: {KASHIER_API_KEY}
  api-key: {KASHIER_API_KEY}
  Content-Type: application/json

Body:
{
  "amount":             params.amount,
  "currency":           params.currency,
  "order":              `${params.region}-${params.orderId}`,  // e.g. "eg-123" — webhook will return this as merchantOrderId
  "merchantRedirect":   params.merchantRedirectUrl,
  "serverWebhook":      params.serverWebhookUrl,
  "customer":           params.customer,
  "expireAt":           params.expiresAt
}

Response envelope: { status: "success", body: { _id: string, sessionUrl: string } }
```

Use native `fetch` + 10-second `AbortController` timeout.

**Webhook order id parsing** — the inverse of the encoding above:
```typescript
// Returns { region, orderId } from a Kashier merchantOrderId like "eg-123".
export function parseMerchantOrderId(raw: string): { region: string; orderId: number } {
  const dash = raw.indexOf('-');
  if (dash < 1) throw new AppError('Malformed merchantOrderId', 400);
  const region = raw.slice(0, dash);
  const orderId = Number(raw.slice(dash + 1));
  if (!Number.isInteger(orderId) || orderId <= 0) {
    throw new AppError('Malformed merchantOrderId', 400);
  }
  return { region, orderId };
}
```
Defined alongside `KashierPaymentProvider`. Used by `PaymentService.handleWebhook` to recover
the routing key and the local order id from `payload.data.merchantOrderId`.

**Webhook signature verification** — exact algorithm:
1. Extract `signatureKeys` array from the webhook payload (top-level field).
2. Sort `signatureKeys` alphabetically.
3. Build a query string from only those keys in `payload.data`, preserving sorted order:
   ```
   key1=value1&key2=value2&...
   ```
4. Compute `HMAC-SHA256(KASHIER_API_KEY, queryString)`, digest as hex.
5. Compare result to the `x-kashier-signature` request header using `timingSafeEqual`.

```typescript
export class KashierPaymentProvider implements IPaymentProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async createSession(params: CreateSessionParams): Promise<SessionResult> { ... }

  verifyWebhookSignature(payload: Record<string, any>, signature: string): boolean {
    const signatureKeys: string[] = payload.signatureKeys ?? [];
    const data: Record<string, any> = payload.data ?? {};
    const sorted = [...signatureKeys].sort();
    const qs = sorted.map(k => `${k}=${data[k]}`).join('&');
    const expected = createHmac('sha256', this.apiKey).update(qs).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false; // length mismatch
    }
  }
}
```

### 4.3 Entity + Enums + Errors

**`src/app/payment/enums.ts`**
```typescript
export type TransactionType   = 'payment' | 'payout' | 'refund' | 'penalty' | 'adjustment' | 'fee';
export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'reversed';
```

**`src/app/payment/entity/transaction.entity.ts`** — mirrors `transactions` table:
```typescript
export class Transaction {
  id: number;
  region: string;
  orderId: number | null;            // nullable per schema (admin adjustments)
  srcAccId: number | null;           // BIGINT, NULL = platform is the source
  dstAccId: number | null;           // BIGINT, NULL = platform is the destination
  amount: number;                    // smallest currency unit
  currency: string;
  type: TransactionType;
  status: TransactionStatus;
  paymentProviderId: number | null;
  externalReference: string | null;  // Kashier session _id stored here
  kashierOrderId: string | null;     // Kashier order reference from webhook
  metadata: Record<string, any>;     // JSONB NOT NULL DEFAULT '{}' — never null
  createdAt: Date;
  updatedAt: Date;

  constructor(data: Partial<Transaction>) { ... }
}
```

**`src/app/payment/errors.ts`**
```typescript
export const TransactionNotFoundError    = () => new AppError('Transaction not found', 404);
export const PaymentAlreadyCompletedError = () => new AppError('Payment already completed', 409);
export const InvalidWebhookSignatureError = () => new AppError('Invalid webhook signature', 400);
export const DuplicateWebhookError        = () => new AppError('Webhook already processed', 200);
```

### 4.4 Repositories

**`src/app/payment/repository/transaction.repo.ts`**
```typescript
const COLUMNS = ['id', 'region', 'order_id', 'src_acc_id', 'dst_acc_id',
  'amount', 'currency', 'type', 'status', 'payment_provider_id',
  'external_reference', 'kashier_order_id', 'metadata',
  'created_at', 'updated_at'];

// All transactions for an order, oldest first (e.g. payment + later refund).
export async function findTransactionsByOrderId(orderId: number, region: string): Promise<Transaction[]>

// The single pending payment row created at session creation time.
// Filtered to (type='payment', status='pending') so the webhook handler
// targets only the row it should advance.
export async function findPendingPaymentByOrderId(orderId: number, region: string, conn?: Knex): Promise<Transaction | undefined>

export async function createTransaction(data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>, region: string, conn?: Knex): Promise<Transaction>
export async function updateTransaction(id: number, region: string, updates: Partial<Transaction>, conn?: Knex): Promise<Transaction>
```

**`src/app/payment/repository/webhook-event.repo.ts`**
```typescript
// Returns true if the row was inserted (first delivery), false if it already existed (duplicate).
export async function insertWebhookEvent(
  providerId: number,
  providerEventId: string,   // Kashier eventId — unique per delivery attempt
  rawPayload: object,
  region: string,
  conn?: Knex,
): Promise<boolean>

export async function markWebhookProcessed(providerEventId: string, region: string, conn?: Knex): Promise<void>
export async function markWebhookError(providerEventId: string, error: string, region: string, conn?: Knex): Promise<void>
```
`insertWebhookEvent` uses `INSERT ... ON CONFLICT (provider_id, provider_event_id) DO NOTHING`
and checks `rowCount` to determine first-delivery vs. duplicate.

**`src/app/payment/repository/payment-provider.repo.ts`**
```typescript
export async function findPaymentProviderByName(name: string): Promise<{ id: number; name: string; isActive: boolean } | undefined>
```
Queries `payment_providers` — plain table, no region filter needed (same data in every cluster).

**`src/app/payment/repository/restaurant-balance.repo.ts`**
```typescript
// UPSERT used by the webhook handler and the COD delivery handler.
export async function creditRestaurantBalance(
  restaurantId: number,
  region: string,
  amount: number,        // smallest currency unit
  currency: string,      // copied from order.currency
  conn: Knex,
): Promise<void>

// Used by GET /api/admin/restaurant-balances and future payout flow.
export async function findRestaurantBalance(restaurantId: number, region: string): Promise<RestaurantBalance | undefined>
```

`creditRestaurantBalance` is implemented as:
```sql
INSERT INTO restaurant_balances (restaurant_id, region, pending_balance, total_earned, currency, created_at, updated_at)
VALUES (:restaurantId, :region, :amount, :amount, :currency, NOW(), NOW())
ON CONFLICT (restaurant_id, currency) DO UPDATE
SET pending_balance = restaurant_balances.pending_balance + EXCLUDED.pending_balance,
    total_earned    = restaurant_balances.total_earned    + EXCLUDED.total_earned,
    updated_at      = NOW();
```
The `ON CONFLICT … DO UPDATE` form is atomic and serializable under PostgreSQL — no separate
`SELECT … FOR UPDATE` is needed because the conflict target acquires a row-level lock.

### 4.5 DTOs

**`src/app/payment/dto/init-payment.dto.ts`**
```typescript
export class InitPaymentDTO {
  @IsUUID()
  orderId!: string;   // public UUID of the order
}
```

> No `redirectUrl` in the request body — the return URL is configured server-side via
> `env.kashier.returnUrl` / `env.kashier.failUrl`. This keeps the redirect contract under
> server control and prevents open-redirect abuse.

**`src/app/payment/dto/refund-request.dto.ts`**
```typescript
export class RefundRequestDTO {
  @IsOptional() @IsInt() @Min(1)
  amount?: number;   // omit → full refund

  @IsString() @MinLength(1) @MaxLength(500)
  reason!: string;
}
```

**`src/app/payment/dto/payment-response.dto.ts`**
```typescript
export interface PaymentResponseDTO {
  id: number;
  orderPublicId: string;
  type: TransactionType;
  method: 'online' | 'cod';
  status: TransactionStatus;
  amount: number;
  currency: string;
  isRefunded: boolean;
  refundedPaymentId?: number;
  createdAt: string;
}
```

**`src/app/payment/dto/transaction-response.dto.ts`**
```typescript
export interface TransactionResponseDTO {
  id: number;
  orderPublicId: string;
  amount: number;
  currency: string;
  type: TransactionType;
  status: TransactionStatus;
  externalReference: string | null;
  createdAt: Date;
}
```
Plain interface — no `paymentProviderId`, `srcAccId`, `dstAccId` exposed to clients.

### 4.6 Service

**`src/app/payment/service/payment.service.ts`**

```typescript
@injectable()
export class PaymentService {
  constructor(
    @inject(TOKENS.PaymentProvider)     private readonly provider: IPaymentProvider,
    @inject(TOKENS.CacheProvider)       private readonly cache: ICacheProvider,
    @inject(TOKENS.CoreServiceClient)   private readonly coreClient: ICoreServiceClient,
    @inject(TOKENS.SocketServer)        private readonly socket: ISocketServer,
  ) {}
```

> The `CoreServiceClient` is required to fetch the customer's name+email for Kashier (the JWT
> does not carry these). The `SocketServer` is required to emit `payment.completed`,
> `order.status_changed`, and `order.created` after the webhook commits.

#### `initPayment(customerId, region, dto): Promise<{ sessionId: string; providerSessionId: string; redirectUrl: string; expiresAt: string; amount: number; currency: string }>`

```
1. Find order by dto.orderId (publicId) + region → not found → 404 OrderNotFound
   if order.customerId !== customerId → 403
   if order.paymentMethod !== 'online' → 409 OrderNotPendingPayment
   if order.status !== 'pending'      → 409 OrderNotPendingPayment

2. Check cache: {region}:os:payment:session:{orderId}
   if hit → return cached { sessionUrl, transactionId }

3. Fetch Kashier provider from the reference table:
   provider = await findPaymentProviderByName('kashier')
   if !provider || !provider.isActive → 503

4. Resolve customer details (JWT does NOT carry name/email):
   user = await this.coreClient.getUserById(customerId)

5. Call Kashier:
   result = await this.provider.createSession({
     orderId:             dto.orderId,
     region,                                                           // encoded into Kashier's `order` field
     amount:              (order.totalAmount / 100).toFixed(2),
     currency:            order.currency,                              // snapshotted on the order
     merchantRedirectUrl: dto.redirectUrl,
     serverWebhookUrl:    `${env.appBaseUrl}/api/payments/webhook`,
     customer:            { name: user.name, email: user.email },
     expiresAt:           new Date(Date.now() + 30 * 60 * 1000).toISOString(),
   })

6. Create pending transaction (src=customer, dst=NULL = platform receives, currency from order):
   tx = await createTransaction({
     region, orderId: dto.orderId,
     srcAccId: customerId, dstAccId: null,
     amount: order.totalAmount, currency: order.currency,
     type: 'payment', status: 'pending',
     paymentProviderId: provider.id,
     externalReference: result.sessionId,            // Kashier _id
     kashierOrderId: null, metadata: {},
   }, region)

7. Cache: SET {region}:os:payment:session:{orderId} { sessionUrl, transactionId } EX 1800

8. Return { sessionUrl: result.sessionUrl, transactionId: tx.id }
```

> **Orphan-session caveat**: if step 5 succeeds but step 6 fails (DB unavailable), Kashier
> holds a session that we have no record of. Acceptable in practice because the
> `Idempotency-Key` middleware on the route makes retries replay the cached HTTP response,
> and any unmapped Kashier session expires in 30 minutes. Don't add a "create tx first"
> reorder — without `external_reference` set, the webhook handler couldn't find the row.

#### `handleWebhook(signature: string, payload: Record<string, any>): Promise<void>`

```
1. Verify HMAC:
   if !this.provider.verifyWebhookSignature(payload, signature)
     → throw InvalidWebhookSignatureError() (400)

2. Recover (region, orderId) from merchantOrderId:
   const { region, orderId } = parseMerchantOrderId(payload.data.merchantOrderId)

3. Idempotency check via payment_webhook_events table (use eventId — unique per delivery):
   const eventId   = payload.data.eventId
   const providerId = (await findPaymentProviderByName('kashier'))!.id
   const trx = await db(region).transaction()
   const isFirst = await insertWebhookEvent(providerId, eventId, payload, region, trx)
   if (!isFirst) {
     await trx.rollback()
     return  // already processed — controller still returns 200
   }

4. Map Kashier status to our action:
   const status = String(payload.data.status).toUpperCase()
   const isSuccess = status === 'SUCCESS'
   const isFailure = status === 'FAILED' || status === 'FAILURE'
   if (!isSuccess && !isFailure) {
     await trx.rollback()
     logger.info('Kashier webhook ignored', { status, orderId })
     return  // pending / authorized / etc — no state change
   }

5. Locate the pending payment row (the one we created in createSession step 6):
   const pending = await findPendingPaymentByOrderId(orderId, region, trx)
   if (!pending) {
     await trx.rollback()
     logger.warn('No pending payment for webhook', { orderId, region, eventId })
     return  // could be a duplicate that already advanced, or a malicious unknown order
   }

6. Load the order so we know what to credit / which branch to notify:
   const order = await findOrderById(orderId, region)
   if (!order) { await trx.rollback(); return }  // order vanished — safe to no-op

7. Write DB changes inside the already-open transaction (trx):
   try {
     if (isSuccess) {
       await updateTransaction(pending.id, region, {
         status: 'completed',
         externalReference: payload.data.transactionId,    // Kashier txn id
         kashierOrderId:    String(payload.data.orderId),  // Kashier internal order id
         metadata:          payload.data,
       }, trx)

       await updateOrderStatus(orderId, region, 'confirmed', {}, trx)

       await creditRestaurantBalance(
         order.restaurantId, region,
         order.itemsTotal, order.currency,                  // delivery_fee stays with platform
         trx,
       )

       // TODO: Phase 10 — writeOutboxEvent(trx, region, 'payment.completed', String(orderId), {...})
     } else {  // isFailure
       await updateTransaction(pending.id, region, {
         status: 'failed',
         metadata: payload.data,
       }, trx)
       await updateOrderStatus(orderId, region, 'failed', {}, trx)
       // No balance credit on failure.
     }
     await trx.commit()
   } catch (err) {
     await trx.rollback()
     throw err
   }

8. Invalidate caches (fire-and-forget):
   this.cache.delete(`${region}:os:order:${orderId}`).catch(() => {})
   this.cache.delete(`${region}:os:payment:session:${orderId}`).catch(() => {})

9. Emit WebSocket events (best-effort):
   if (isSuccess) {
     this.socket.emitToRoom(`order:${orderId}`,         'payment.completed',     { orderId, transactionId: pending.id })
     this.socket.emitToRoom(`order:${orderId}`,         'order.status_changed',  { orderId, status: 'confirmed' })
     this.socket.emitToRoom(`branch:${order.branchId}`, 'order.created',         { orderId, customerId: order.customerId, totalAmount: order.totalAmount })
   } else {
     this.socket.emitToRoom(`order:${orderId}`,         'payment.failed',        { orderId, reason: payload.data.failureReason ?? 'unknown' })
     this.socket.emitToRoom(`order:${orderId}`,         'order.status_changed',  { orderId, status: 'failed' })
   }
```

> Step 5's "no pending payment" branch is intentionally a no-op return (not an error). After the
> idempotency check in step 3 the only ways to reach step 5 with no pending row are: (a) a
> webhook for an order we don't own (return 200 to stop retries; log), (b) the order was
> manually cancelled before the webhook arrived (terminal state — webhook is moot). Throwing
> here would force Kashier to retry indefinitely.

#### `getPaymentById(paymentId, region, actorId, actorRole): Promise<PaymentResponseDTO>`

```
1. Load transaction by id + region → 404 if missing.
2. Authorize: actorRole === 'system_admin' OR (restaurantOwner with payments:read) — else 403.
3. Map to PaymentResponseDTO and return.
```

#### `refundPayment(paymentId, region, dto): Promise<{ refundId: number; status: string; amount: number; currency: string }>`

```
1. Load transaction by paymentId + region → 404 if missing.
2. Verify transaction.status === 'completed' and transaction.type === 'payment' → else 409.
3. Determine refund amount: dto.amount ?? transaction.amount (full refund).
4. Check not already refunded (isRefunded flag) → 409 if so.
5. Begin DB transaction:
   a. Create refund transaction row (type='refund', status='pending', amount=refundAmount).
   b. Mark original transaction as isRefunded=true, refundedPaymentId=newRow.id.
   c. Debit restaurant balance (creditRestaurantBalance with negative amount, or separate debit call).
6. Commit.
7. Return { refundId, status: 'pending', amount, currency }.
   // Actual provider refund call is async (Phase 10 outbox event) — response is 202 Accepted.
```

Returning a `202 Accepted` (not `200`) signals that the refund is initiated but not yet settled
with Kashier. Final state arrives via the Kashier refund webhook.

### 4.7 Controller

**`src/app/payment/controller/payment.controller.ts`**

```typescript
@injectable()
export class PaymentController {
  constructor(@inject(TOKENS.PaymentService) private readonly paymentService: PaymentService) {}

  initPayment = async (req, res, next) => {
    try {
      const dto = await validateBody(InitPaymentDTO, req.body);
      const result = await this.paymentService.initPayment(
        req.user!.userId, req.region!, dto
      );
      sendSuccess(res, result, 200);
    } catch (err) { next(err); }
  }

  refundPayment = async (req, res, next) => {
    try {
      const dto = await validateBody(RefundRequestDTO, req.body);
      const result = await this.paymentService.refundPayment(
        Number(req.params.paymentId), req.region!, dto
      );
      sendSuccess(res, result, 202);
    } catch (err) { next(err); }
  }

  getPaymentById = async (req, res, next) => {
    try {
      const result = await this.paymentService.getPaymentById(
        Number(req.params.paymentId), req.region!,
        req.user!.userId, req.user!.role
      );
      sendSuccess(res, result);
    } catch (err) { next(err); }
  }

  handleWebhook = async (req, res, next) => {
    try {
      const signature = req.headers['x-kashier-signature'] as string;
      // req.body is a Buffer (express.raw middleware mounted on this route).
      // We retain the raw bytes for audit logging only; signature verification
      // operates on the parsed payload (Kashier signs selected fields, not the body).
      const payload = JSON.parse(req.body.toString()) as Record<string, any>;
      await this.paymentService.handleWebhook(signature, payload);
      // Kashier retries on non-200 — always 200 after we've decided not to throw.
      res.status(200).json({ received: true });
    } catch (err) {
      // InvalidWebhookSignatureError → 400; everything else → 500 + retry.
      next(err);
    }
  }

  getByOrderId = async (req, res, next) => {
    try {
      const result = await this.paymentService.getTransactionsByOrderId(
        Number(req.params.orderId), req.region!,
        req.user!.userId, req.user!.role
      );
      sendSuccess(res, result);
    } catch (err) { next(err); }
  }
}
```

### 4.8 Routes

**`src/app/payment/routes.ts`**

```typescript
const ctrl = container.resolve<PaymentController>(TOKENS.PaymentController);
export const paymentRouter = Router();

// Webhook: no authenticate middleware, raw body for HMAC, no idempotency middleware
paymentRouter.post('/webhook/:provider',
  express.raw({ type: 'application/json' }),
  ctrl.handleWebhook
);

// Payment init: customer only, idempotency prevents duplicate sessions
paymentRouter.post('/init',
  authenticate, requireRole(SystemRole.CUSTOMER), requireRegion, idempotency(), ctrl.initPayment
);

// Refund: admin only
paymentRouter.post('/:paymentId/refund',
  authenticate, requireSystemAdmin(), requireRegion, idempotency(), ctrl.refundPayment
);

// View single payment (restaurant owner or admin)
paymentRouter.get('/:paymentId',
  authenticate, requireRegion, ctrl.getPaymentById
);
```

Mount in `src/routes.ts`:
```typescript
routes.use('/payments', paymentRouter);
```

### 4.9 DI Registration

`src/lib/di/container.ts`:
```typescript
import { KashierPaymentProvider } from '../../pkg/payment/kashier.js';
import { PaymentService } from '../../app/payment/service/payment.service.js';
import { PaymentController } from '../../app/payment/controller/payment.controller.js';

container.registerInstance(TOKENS.PaymentProvider,
  new KashierPaymentProvider(env.kashier.apiKey, env.kashier.baseUrl)
);
container.registerSingleton(TOKENS.PaymentService, PaymentService);
container.registerSingleton(TOKENS.PaymentController, PaymentController);
```

> `PaymentService` resolves `TOKENS.CoreServiceClient` (registered in Phase 2.5) and
> `TOKENS.SocketServer` (registered in Phase 5). When wiring Phase 4 ahead of Phase 5,
> stub the socket interface with a no-op `emitToRoom` until the real server lands.

### Acceptance Criteria

- [ ] `POST /api/payments/sessions` returns `{ sessionUrl, transactionId }` — transaction row has `status=pending`, `external_reference=<Kashier _id>`
- [ ] Duplicate session request (same Idempotency-Key) → same response, no second Kashier API call
- [ ] Kashier webhook with valid signature + `status=SUCCESS` → order → `confirmed`, transaction → `completed`, `restaurant_balances.pending_balance` incremented by `order.items_total`
- [ ] Kashier webhook with valid signature + `status=FAILED` → order → `failed`, transaction → `failed`, no balance change
- [ ] Webhook with invalid signature → 400
- [ ] Webhook replayed (same `eventId`) → 200, no duplicate DB write, no double balance credit
- [ ] Webhook for unknown / already-terminal order → 200 (no retry storm), warning logged
- [ ] `GET /api/payments/orders/:orderId` by order owner → returns array (covers payment + refund case)
- [ ] Cash orders → `POST /api/payments/sessions` returns 422 `OrderNotPayableError`

---

## Phase 5 — WebSocket Layer (socket.io + Redis adapter)

Implement after orders and payments so events have real data to emit. Uses `socket.io` with
`@socket.io/redis-adapter` so any backend instance can fan out to any connected client without
a sticky load balancer.

### 5.1 socket-server.ts
- Define an `ISocketServer` interface that services depend on (so Phase 4 / 6 / 7 can be
  unit-tested with a no-op stub):
  ```typescript
  export interface ISocketServer {
    emitToRoom(room: string, event: string, payload: unknown): void;
  }
  ```
- Implement `SocketServer` from `socket.io`, mount on the HTTP server at path `/ws`.
- Configure `@socket.io/redis-adapter` using two Redis clients (pub + sub) created from the
  same `ICacheProvider` config.
- Apply the auth middleware (5.2) to the namespace.
- On connection:
  - Compute the rooms this user is allowed to join (see "Channel ACL" below) and stash them on
    `socket.data.allowedChannels`.
  - Emit `hello { allowedChannels }` so the client knows what it can subscribe to.
- Register handlers for `subscribe`, `unsubscribe`, `agent:location` (see 5.5).
- Register the singleton in DI as `TOKENS.SocketServer`. Services inject the interface,
  not the concrete class.

**Channel ACL** (computed from JWT):
- `customer:<userId>` — every authenticated user gets their own customer channel.
- `restaurant:<restaurantId>` — only if `req.user.restaurantId` matches.
- `branch:<branchId>` — only if `branchId ∈ req.user.branchIds`.
- `agent:<agentId>` — only if `role === 'delivery_agent'` and `agentId === userId`.
- `order:<orderId>` — granted on demand: when the client emits `subscribe('order:<id>')`,
  verify ownership server-side (customer of the order, restaurant member of the order's
  branch, or assigned agent) before joining the socket to the room.

### 5.2 socket-auth.ts
- `socketAuthMiddleware(socket, next)` — runs during the socket.io handshake.
- Reads JWT from `socket.handshake.auth.token` (preferred) **or** `access_token` cookie in
  `socket.handshake.headers.cookie` as a fallback for same-origin browser clients.
- Verifies with `jose` against `env.accessSecret`. On failure: `next(new Error('unauthorized'))`.
- On success: `socket.data.user = jwtPayload`, then `next()`.

> Token-in-handshake (the socket.io standard) avoids the cookie-cross-origin headache that
> raw `ws` would force us into.

### 5.3 events.ts
Use dot-notation event names (socket.io convention) — same names appear in business-logic docs:
```typescript
export const WS_EVENTS = {
  ORDER_CREATED:           'order.created',
  ORDER_STATUS_CHANGED:    'order.status_changed',
  ORDER_CANCELLED:         'order.cancelled',
  ORDER_DELIVERY_ASSIGNED: 'order.delivery_assigned',
  AGENT_LOCATION_UPDATED:  'agent.location_updated',
  PAYMENT_COMPLETED:       'payment.completed',
  PAYMENT_FAILED:          'payment.failed',
} as const;
```

### 5.4 Wire into server.ts
```typescript
import http from 'node:http';
import { initSocketServer } from './lib/websocket/socket-server.js';

const httpServer = http.createServer(app);
await initSocketServer(httpServer);   // configures socket.io + redis-adapter
httpServer.listen(env.port);
```

### 5.5 Client → Server messages
- `subscribe(channel, ack)` — server validates `channel ∈ socket.data.allowedChannels`
  (or runs the on-demand `order:<id>` ownership check), joins the room, returns
  `{ ok: true }` via `ack`. Returns `{ ok: false, error }` on rejection.
- `unsubscribe(channel)` — leaves the room.
- `agent:location { lat, lng }` — only accepted if `role === 'delivery_agent'`. Calls
  `agentService.updatePresence` and the service emits `agent.location_updated` to any
  active order rooms it determines.

### 5.6 Service → Client emits
Services use the injected `socketServer` (or its `emitToRoom` helper) — never wire raw
`io.to()` calls into business code. Example callsites:
- `orderService.placeOrder` → `emitToRoom('branch:' + branchId, 'order.created', payload)`
- `orderService.cancelOrder` → `emitToRoom('order:' + orderId, 'order.cancelled', payload)`
- `paymentService.handleWebhook` → `emitToRoom('order:' + orderId, 'payment.completed', payload)`
- `agentService.acceptOrder` → `emitToRoom('order:' + orderId, 'order.delivery_assigned', payload)`

**Checkpoint**: Two browser tabs (customer + restaurant) connect via socket.io. Restaurant
emits `subscribe('branch:<id>')`, customer places an order, the restaurant tab receives
`order.created`. Kill the backend instance the customer is connected to and reconnect to a
second instance — events still fan out (proves the redis-adapter works).

---

## Phase 6 — Delivery Module

**Goal**: Admin/system assigns a delivery agent to an order. Agent accepts/rejects and tracks
the delivery to completion. This is a distinct entity from the order — one order has one active
delivery row at a time, with a reassignment history.

### 6.1 Migration — `deliveries` Table

`src/database/migrations/{ts}_create_deliveries.ts`

```sql
CREATE TABLE deliveries (
  id              BIGSERIAL       PRIMARY KEY,
  region          TEXT            NOT NULL,
  order_id        BIGINT          NOT NULL REFERENCES orders(id),
  agent_id        BIGINT          NOT NULL,
  status          TEXT            NOT NULL DEFAULT 'assigned',
  pickup_lat      DOUBLE PRECISION,
  pickup_lng      DOUBLE PRECISION,
  dropoff_lat     DOUBLE PRECISION,
  dropoff_lng     DOUBLE PRECISION,
  distance_meters INT,
  assigned_at     TIMESTAMP       NOT NULL DEFAULT NOW(),
  accepted_at     TIMESTAMP,
  rejected_at     TIMESTAMP,
  picked_at       TIMESTAMP,
  delivered_at    TIMESTAMP,
  rejection_reason TEXT,
  created_at      TIMESTAMP       NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP       NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_deliveries_status CHECK (status IN ('assigned','accepted','rejected','picked','delivered'))
);

CREATE INDEX idx_deliveries_order_id  ON deliveries(order_id);
CREATE INDEX idx_deliveries_agent_id  ON deliveries(agent_id);
CREATE INDEX idx_deliveries_status    ON deliveries(status) WHERE status NOT IN ('delivered', 'rejected');
```

Also add `reassignment_count INT NOT NULL DEFAULT 0` to the `orders` table (separate migration)
to enforce the `MaxReassignmentAttemptsReached` guard.

### 6.2 Entity + Enums + Errors

- `src/app/delivery/entity/delivery.entity.ts` — `DeliveryEntity` (all fields)
- `src/app/delivery/enums.ts` — `DeliveryStatus = 'assigned' | 'accepted' | 'rejected' | 'picked' | 'delivered'`
- `src/app/delivery/errors.ts`

```typescript
export const OrderNotReadyError               = () => new AppError('OrderNotReady', 409);
export const OrderAlreadyHasActiveDelivery    = () => new AppError('OrderAlreadyHasActiveDelivery', 409);
export const NoEligibleAgentsError            = () => new AppError('NoEligibleAgents', 409);
export const MaxReassignmentAttemptsReached   = () => new AppError('MaxReassignmentAttemptsReached', 409);
export const DeliveryNotFoundError            = () => new AppError('DeliveryNotFound', 404);
```

### 6.3 Repositories

- `src/app/delivery/repository/delivery.repo.ts`
  - `findDeliveryById(id, region)`
  - `findActiveDeliveryByOrderId(orderId, region)` — `status NOT IN ('delivered', 'rejected')`
  - `findDeliveriesByAgentId(agentId, region, statusFilter?, pagination?)`
  - `createDelivery(data, region, conn?)`
  - `updateDeliveryStatus(id, region, status, extraFields?, conn?)`

### 6.4 DTOs

- `src/app/delivery/dto/assign-delivery.dto.ts`
  ```typescript
  export class AssignDeliveryDTO {
    @IsOptional() @IsInt() @Min(1)
    agentId?: number;   // if omitted, service auto-selects from available agents
  }
  ```
- `src/app/delivery/dto/update-delivery-status.dto.ts`
  ```typescript
  export class UpdateDeliveryStatusDTO {
    @IsEnum(DeliveryStatus)
    status!: 'accepted' | 'rejected' | 'picked' | 'delivered';

    @IsOptional() @IsString() @MaxLength(500)
    reason?: string;  // required for 'rejected'
  }
  ```
- `src/app/delivery/dto/delivery-response.dto.ts` — `DeliveryResponseDTO`

### 6.5 Service

`src/app/delivery/service/delivery.service.ts`

- `assignDelivery(orderId, region, dto)` — admin/system only:
  1. Load order by publicId → `OrderNotReady` if not `ready_for_pickup`.
  2. `findActiveDeliveryByOrderId` → `OrderAlreadyHasActiveDelivery` if found.
  3. If `dto.agentId` present: verify agent exists and `is_available=true`.
     Otherwise: query `agent_presence` for nearest available agent (Redis geo sorted set).
     → `NoEligibleAgents` if none found.
  4. Create `deliveries` row with `status='assigned'`.
  5. Mark agent unavailable in Redis (`presence:meta:{region}:{agentId}`).
  6. Emit `task.assigned` to `agent:{agentId}` room.
  7. Return `DeliveryResponseDTO`.

- `reassignDelivery(orderId, region, dto)` — admin/system only:
  1. Load order; find active delivery row.
  2. Check `orders.reassignment_count < MAX_REASSIGNMENTS` (e.g. 3) → else `MaxReassignmentAttemptsReached`.
  3. Mark existing delivery `status='rejected'`.
  4. Increment `orders.reassignment_count`.
  5. Call `assignDelivery` logic for a new agent.

- `updateDeliveryStatus(deliveryId, region, agentId, dto)` — agent only:
  1. Load delivery; verify `delivery.agentId === agentId` → else 403.
  2. Validate status transition: `assigned → accepted`, `accepted → picked`, `picked → delivered`.
     Also allow `assigned/accepted → rejected` (agent rejects).
  3. Write `deliveries` status + timestamp.
  4. Mirror order status: `accepted → order stays ready_for_pickup`, `picked → order.status = on_the_way`, `delivered → order.status = delivered`.
  5. On `delivered`: create `agent_earnings` row; credit restaurant `available_balance` (move from `pending_balance`).
  6. On `rejected`: emit `task.cancelled` to `agent:{agentId}`; trigger reassignment or admin alert.
  7. Emit WebSocket events.

### 6.6 Controller + Routes

```typescript
// src/app/delivery/routes.ts
const ctrl = container.resolve<DeliveryController>(TOKENS.DeliveryController);
export const deliveryRouter = Router();

// Admin/system: assign and reassign
deliveryRouter.post('/assign/:orderId',
  authenticate, requireSystemAdmin(), requireRegion, ctrl.assignDelivery);
deliveryRouter.post('/reassign/:orderId',
  authenticate, requireSystemAdmin(), requireRegion, ctrl.reassignDelivery);

// Agent: update delivery status (accepted/rejected/picked/delivered)
deliveryRouter.patch('/:deliveryId/status',
  authenticate, requireRole('delivery_agent'), requireRegion, idempotency(), ctrl.updateDeliveryStatus);
```

Mount in `src/routes.ts`: `router.use('/deliveries', deliveryRouter)`.

**Checkpoint**: Admin calls `POST /api/deliveries/assign/:orderId` → delivery row created, agent
receives `task.assigned` WebSocket event. Agent calls `PATCH /api/deliveries/:id/status` with
`{ status: "picked" }` → order flips to `on_the_way`, customer sees `order.status_changed`.

---

## Phase 7 — Agent Module

**Goal**: delivery agent's own presence, task view, and earnings. Presence uses three explicit
endpoints (online/offline/ping) instead of a single PATCH so state transitions are unambiguous.

### 7.1 Entities + Errors
- `agent-presence.entity.ts`, `agent-earnings.entity.ts`
- `src/app/delivery-agent/errors.ts`

```typescript
export const AgentInActiveDeliveryError = () => new AppError('AgentInActiveDelivery', 409);
export const NotOnlineError             = () => new AppError('NotOnline', 409);
```

### 7.2 Repositories
- `agent-presence.repo.ts` — `upsertPresence`, `findPresenceByAgentId`
- `agent-earnings.repo.ts` — `createEarnings`, `findEarningsByAgentId`, `getEarningsTotals`

### 7.3 DTOs
```typescript
// presence-online.dto.ts
export class PresenceOnlineDTO {
  @IsNumber() lat!: number;
  @IsNumber() lng!: number;
}

// delivery-task-response.dto.ts
export class DeliveryTaskResponseDTO {
  deliveryId: number;
  orderPublicId: string;
  status: DeliveryStatus;
  pickup: { branchName: string; lat: number; lng: number; addressText: string };
  dropoff: { lat: number; lng: number; addressText: string };
  itemsCount: number;
  total: number;
  currency: string;
  paymentMethod: 'online' | 'cod';
  earningEstimate?: number;
  assignedAt: string;
}
```

### 7.4 Service

`src/app/delivery-agent/service/agent.service.ts`

- `goOnline(agentId, region, dto)` — upsert `agent_presence` (is_online=true) + write to Redis geo set; emit no event
- `goOffline(agentId, region)` — verify agent has no active delivery (`AgentInActiveDelivery` if so); upsert is_online=false + remove from Redis geo set
- `ping(agentId, region, dto)` — verify is_online → `NotOnline` if not; update lat/lng in Redis geo set + refresh `presence:meta` TTL (90s); does NOT touch DB (hot path)
- `getMyTasks(agentId, region, statusFilter?, pagination?)` — queries `deliveries` table
- `getMyEarnings(agentId, region, from?, to?, pagination?)`

### 7.5 Controller + Routes

```typescript
// src/app/delivery-agent/routes.ts
export const agentRouter = Router();
const ctrl = container.resolve<AgentController>(TOKENS.AgentController);

// Presence
agentRouter.post('/presence/online',
  authenticate, requireRole('delivery_agent'), requireRegion, ctrl.goOnline);
agentRouter.post('/presence/offline',
  authenticate, requireRole('delivery_agent'), requireRegion, ctrl.goOffline);
agentRouter.post('/presence/ping',
  authenticate, requireRole('delivery_agent'), requireRegion, ctrl.ping);

// Tasks (agent's delivery list)
agentRouter.get('/tasks',
  authenticate, requireRole('delivery_agent'), requireRegion, ctrl.getMyTasks);

// Earnings
agentRouter.get('/earnings',
  authenticate, requireRole('delivery_agent'), requireRegion, ctrl.getMyEarnings);
```

Mount in `src/routes.ts`: `router.use('/agents', agentRouter)`.

**Checkpoint**: Agent calls `POST /api/agents/presence/online`, then
`GET /api/agents/tasks?status=assigned` — sees assigned deliveries. `POST /api/agents/presence/offline`
with an active delivery → 409 `AgentInActiveDelivery`.

---

## Phase 8 — Restaurant Orders Module

### 8.1 Service
`src/app/restaurant-orders/service/restaurant-order.service.ts`

Wraps `OrderService.updateOrderStatus` — the restaurant module does **not** have its own
repository. Status transitions allowed for restaurant roles are: `pending → accepted`,
`accepted → preparing`, `preparing → ready_for_pickup`, and cancellation on `pending/accepted`.

```typescript
@injectable()
export class RestaurantOrderService {
  constructor(
    @inject(TOKENS.OrderService) private readonly orderService: OrderService
  ) {}

  // All status changes go through the same unified updateOrderStatus method on OrderService.
  // This module only adds restaurant-specific authorization (JWT restaurantId check).
  updateStatus = (publicId, region, memberId, restaurantId, dto) =>
    this.orderService.updateOrderStatus(publicId, region, memberId, 'restaurant_user', dto);
}
```

### 8.2 DTOs + Controller + Routes

**Routes protected by**: `authenticate` + `requireRestaurantMember()` (verifies JWT `restaurantId`)

```typescript
// src/app/restaurant-orders/routes.ts
restaurantOrderRouter.get('/',
  authenticate, requireRestaurantMember(), requireRegion, rbac({ resource: 'orders', action: 'read' }), ctrl.listOrders);
restaurantOrderRouter.patch('/:publicId/status',
  authenticate, requireRestaurantMember(), requireRegion, idempotency(), ctrl.updateStatus);
```

No separate `/confirm`, `/prepare`, `/ready` endpoints — all status transitions go through a
single `PATCH /:publicId/status` with `{ "status": "accepted" | "preparing" | "ready_for_pickup" | "cancelled" }`.

**Checkpoint**: Restaurant calls `PATCH /api/restaurant/orders/:publicId/status` with
`{ "status": "accepted", "estimatedDeliveryAt": "..." }`. Customer sees `order.status_changed`
WebSocket event on the `order:{orderId}` room.

---

## Phase 9 — Admin Module

### 9.1 Service
`AdminService` — thin orchestration layer calling order/payment/delivery/agent repos directly.

Key capabilities:
- `listAllOrders(region, filters, pagination)` — full filter set (status, customerId, restaurantId, branchId, agentId)
- `listAllTransactions(region, filters, pagination)`
- `listRestaurantBalances(region, restaurantId?, pagination)`
- `listAgentsWithPresence(region, isOnline?, isAvailable?, pagination)`
- `forceUpdateOrderStatus(publicId, region, dto)` — system_admin can cancel any order regardless of status

### 9.2 Controller + Routes

```typescript
// src/app/admin/routes.ts
adminRouter.get('/orders',               ctrl.listOrders);
adminRouter.get('/transactions',         ctrl.listTransactions);
adminRouter.get('/restaurant-balances',  ctrl.listRestaurantBalances);
adminRouter.post('/restaurant/payouts',  idempotency(), ctrl.createPayout);
adminRouter.get('/agents',               ctrl.listAgents);
```

Protected by: `authenticate` + `requireSystemAdmin()`.

**Finance — restaurant payouts** (`POST /api/admin/restaurant/payouts`):
```typescript
export class CreatePayoutDTO {
  @IsInt() @Min(1)       restaurantId!: number;
  @IsInt() @Min(1)       amount!: number;
  @IsEnum(Currency)      currency!: 'EGP' | 'SAR';
  @IsString()            providerReferenceId!: string;
  @IsOptional() @IsString() note?: string;
}
// Errors: InsufficientBalance (409), IdempotencyConflict (409)
```

**Checkpoint**: Admin can view all orders, force-cancel via `PATCH /api/orders/:publicId/status`,
view transactions, and trigger a restaurant payout.

---

## Phase 10 — Redis Caching Pass

Review all read endpoints and add caching where specified in CLAUDE.md §8:

- `GET /api/orders/:publicId` → `{region}:os:order:{publicId}` TTL 300s
- `GET /api/customer/orders` → `{region}:os:orders:customer:{customerId}:{hash}` TTL 60s
- `GET /api/payments/:paymentId` → no cache (financial data — always fresh)
- Agent presence reads → `presence:meta:{region}:{agentId}` TTL 90s (refreshed by ping)

Add cache invalidation to all relevant service write paths. Key format: `{region}:os:{entity}:{id}`.

**Checkpoint**: Second call to `GET /api/orders/:publicId` returns `X-Cache: HIT`.

---

## Phase 11 — Async Messaging: Transactional Outbox + RabbitMQ

**Goal**: reliable async communication between the order service and the core service using
the Transactional Outbox Pattern with RabbitMQ as the message broker. No message is ever
lost — even if RabbitMQ is temporarily down, events survive in the DB outbox table.

### Why Outbox + RabbitMQ (not direct HTTP)
Direct HTTP calls from service to service for fire-and-forget events (increment total_orders,
notify customer) are fragile: if the target is down, the event is lost. With the outbox pattern:
1. The producing service writes the event to an `outbox` table **in the same DB transaction** as the business write.
2. A background dispatcher reads unpublished rows and publishes them to RabbitMQ.
3. If RabbitMQ is temporarily unavailable, the row stays in the outbox and is retried with backoff.

### 11.1 Env Variables
No new env variables. `RABBITMQ_URL` and `INTERNAL_HMAC_SECRET` are already declared in
Phase 0.3 — Phase 10 just consumes them. RabbitMQ credentials are embedded in `RABBITMQ_URL`
(`amqp://user:pass@host:port`) per the `amqp-connection-manager` convention; no separate
`RABBITMQ_USER`/`RABBITMQ_PASSWORD` are needed.

### 11.2 Migration — `outbox` Table

`src/database/migrations/{ts}_create_outbox.ts`

```sql
CREATE TABLE outbox (
    id              BIGSERIAL       PRIMARY KEY,
    region          TEXT            NOT NULL,
    event_type      TEXT            NOT NULL,  -- e.g. 'order.placed', 'payment.completed'
    aggregate_id    TEXT            NOT NULL,  -- e.g. order_id
    payload         JSONB           NOT NULL,
    attempts        SMALLINT        NOT NULL DEFAULT 0,
    last_error      TEXT,
    dispatched_at   TIMESTAMP,                 -- NULL = pending
    created_at      TIMESTAMP       NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_outbox_attempts CHECK (attempts >= 0)
);

-- Dispatcher poll query: pending rows, oldest first
CREATE INDEX idx_outbox_pending ON outbox(created_at ASC)
    WHERE dispatched_at IS NULL;
```

One outbox table per shard (lives in `order_service_{region}`). One dispatcher per service
instance is fine; multiple instances coordinate via `FOR UPDATE SKIP LOCKED` so the same
row is never published twice.

### 11.3 pkg/messaging/ — RabbitMQ Provider

Use **`amqp-connection-manager`** (wraps `amqplib`) — it handles reconnection and channel
re-declaration automatically so you don't have to write manual retry/backoff for AMQP itself.
Install: `npm i amqp-connection-manager amqplib && npm i -D @types/amqplib`.

`src/pkg/messaging/message-broker.interface.ts`
```typescript
export interface ConsumeMessage {
  routingKey: string;
  body: Buffer;
  ack: () => void;
  nack: (requeue?: boolean) => void;
}

export interface ConsumerOptions {
  exchange: string;
  queue: string;
  bindingKeys: string[];
  prefetch: number;
  deadLetterExchange?: string;   // DLQ exchange name
  deadLetterQueue?: string;      // DLQ queue name
}

export interface IMessageBroker {
  connect(): Promise<void>;
  close(): Promise<void>;
  declareTopology(opts: ConsumerOptions): Promise<void>;
  publish(exchange: string, routingKey: string, body: Buffer): Promise<void>;
  consume(opts: ConsumerOptions, handler: (msg: ConsumeMessage) => Promise<void>): Promise<void>;
}
```

`src/pkg/messaging/rabbitmq/rabbitmq.client.ts`

Key design points (from mentor's implementation):
- One TCP connection → many cheap virtual "channels" (ChannelWrapper).
- Keep ONE long-lived publisher channel; open separate channels for topology declaration
  and consuming. One channel = one purpose.
- `setup(ch: ConfirmChannel)` runs on **every reconnect** — topology and consumer registration
  are restored automatically after broker restarts.
- `declareTopology`: open a throwaway channel, let setup run the asserts, close it.

```typescript
// Mental model:
// connect()          → opens TCP connection + long-lived publisher channel
// declareTopology()  → throwaway channel, asserts exchanges/queues/bindings, closes
// consume()          → long-lived consumer channel, re-registers on reconnect
// publish()          → sends through the publisher channel (persistent:true)

export class RabbitMQClient implements IMessageBroker {
  private connection: AmqpConnectionManager | null = null;
  private publishChannel: ChannelWrapper | null = null;
  constructor(private readonly config: RabbitMQConfig) {}
  // ... see rabbitmq.client.ts
}
```

**Dead Letter Queue (DLQ) topology**: when `ConsumerOptions` includes `deadLetterExchange`
and `deadLetterQueue`, the topology setup:
1. Asserts the DLQ exchange (topic, durable).
2. Asserts the DLQ queue (durable) and binds it with routing key `#` (catch-all).
3. Asserts the main queue with `x-dead-letter-exchange` argument pointing at the DLQ exchange.

Messages that are nack'd **without requeue** (`ch.nack(raw, false, false)`) flow automatically
to the DLQ — no manual routing needed. Ops team monitors the DLQ for manual replay.

```typescript
// Inside assertTopology helper:
if (opts.deadLetterExchange && opts.deadLetterQueue) {
  await ch.assertExchange(opts.deadLetterExchange, 'topic', { durable: true });
  await ch.assertQueue(opts.deadLetterQueue, { durable: true });
  await ch.bindQueue(opts.deadLetterQueue, opts.deadLetterExchange, '#');
}
const queueArgs: Record<string, string> = {};
if (opts.deadLetterExchange) queueArgs['x-dead-letter-exchange'] = opts.deadLetterExchange;
await ch.assertQueue(opts.queue, { durable: true, arguments: queueArgs });
```

**`RabbitMQConfig`** (`src/pkg/messaging/rabbitmq/rabbitmq.types.ts`):
```typescript
export interface RabbitMQConfig {
  url: string;
  reconnectInitialMs: number;   // e.g. 2000
}
```

### 11.4 ICacheProvider — Add `trySet` (atomic SETNX)

The consumer deduplication pattern requires an **atomic set-if-not-exists** operation.
Add `trySet` to `ICacheProvider` and `RedisCacheProvider`:

```typescript
// src/pkg/cache/cache.interface.ts — add to interface:
trySet(key: string, value: string, ttlSeconds: number): Promise<boolean>;
// Returns true if the key was SET (first caller wins), false if key already existed.
```

```typescript
// src/pkg/cache/redis.ts — implementation:
async trySet(key: string, value: string, ttlSeconds: number): Promise<boolean> {
  const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
  return result === 'OK';
}
```

**Why**: Redis `SET key value EX ttl NX` is atomic — it either sets and returns `OK`, or
finds an existing key and returns `null`. This prevents two consumer instances from processing
the same message concurrently (e.g. after a restart with an unacked message).

### 11.5 lib/outbox/ — Outbox Writer + Dispatcher

**`src/lib/outbox/writer.ts`** — called inside DB transactions alongside business writes:
```typescript
export async function writeOutboxEvent(
  conn: Knex,
  region: string,
  eventType: string,
  aggregateId: string,
  payload: object
): Promise<void> {
  await conn('outbox').insert({
    region,
    event_type:   eventType,
    aggregate_id: aggregateId,
    payload:      JSON.stringify(payload),
    created_at:   new Date(),
  });
}
```

Call this inside any DB transaction that should emit an event:
```typescript
// Inside placeOrder transaction:
await writeOutboxEvent(trx, region, 'order.placed', String(order.id), {
  orderId: order.id, restaurantId: order.restaurantId, customerId: order.customerId,
  totalAmount: order.totalAmount, itemsCount: items.length,
});
```

**`src/lib/outbox/dispatcher.ts`** — background polling loop, one per service instance per region:

```typescript
export async function startOutboxDispatcher(
  publisher: IMessagePublisher,
  region: string,
): Promise<void> {
  const BATCH_SIZE = 50;
  const POLL_INTERVAL_MS = 2_000;
  const MAX_ATTEMPTS = 5;
  const knex = db(region);

  async function tick(): Promise<void> {
    const rows = await knex.raw(`
      SELECT id, event_type, aggregate_id, payload, attempts
      FROM outbox
      WHERE dispatched_at IS NULL AND attempts < :maxAttempts
      ORDER BY created_at ASC
      LIMIT :batchSize
      FOR UPDATE SKIP LOCKED
    `, { maxAttempts: MAX_ATTEMPTS, batchSize: BATCH_SIZE });

    for (const row of rows.rows) {
      try {
        await publisher.publish(
          'order-service.events',    // exchange name
          row.event_type,            // routing key (e.g. 'order.placed')
          JSON.parse(row.payload)
        );
        await knex('outbox')
          .where('id', row.id)
          .update({ dispatched_at: new Date() });
      } catch (err) {
        await knex('outbox')
          .where('id', row.id)
          .update({
            attempts:   knex.raw('attempts + 1'),
            last_error: String(err),
          });
        logger.warn('Outbox dispatch failed', { id: row.id, attempts: row.attempts + 1, region });
      }
    }
  }

  setInterval(() => tick().catch(err => logger.error('Outbox tick error', { err, region })), POLL_INTERVAL_MS);
  logger.info('Outbox dispatcher started', { region });
}
```

**Key properties**:
- `FOR UPDATE SKIP LOCKED` — if multiple instances run (future), they don't double-publish.
- Rows with `attempts >= MAX_ATTEMPTS` are left in the table as dead-letter for manual inspection.
- Dispatcher does NOT delete rows — `dispatched_at` stamp preserves the audit trail.

### 11.6 server.ts — Start Dispatcher

```typescript
// After HTTP server is listening:
const publisher = container.resolve<IMessagePublisher>(TOKENS.MessagePublisher);
for (const region of env.regions) {
  startOutboxDispatcher(publisher, region);
}
```

One dispatcher loop per region per service instance. Multiple instances are safe —
`FOR UPDATE SKIP LOCKED` ensures each pending outbox row is claimed by exactly one tick.

### 11.7 Events Published by Order Service

| event_type | aggregate_id | Payload | Consumed by |
|---|---|---|---|
| `order.placed` | `orderId` | `{ orderId, restaurantId, customerId, totalAmount, itemsCount }` | Core (increment restaurant total_orders) |
| `order.status_changed` | `orderId` | `{ orderId, status, updatedAt }` | Core (customer notification) |
| `order.delivered` | `orderId` | `{ orderId, customerId, agentId, deliveredAt }` | Core (notify customer) |
| `payment.completed` | `orderId` | `{ orderId, transactionId, amount, currency }` | Core (receipt email) |
| `order.cancelled` | `orderId` | `{ orderId, customerId, reason }` | Core (notify customer) |

Write each outbox row **inside the same DB transaction** as the business event that triggers it.

### 11.8 Events Consumed from Core Service

The order service subscribes to events from the core service to invalidate caches.

**RabbitMQ topology**:
```typescript
const CORE_EVENTS_CONSUMER_OPTS: ConsumerOptions = {
  exchange:           'core-service.events',
  queue:              'order-service.core-events',
  bindingKeys:        ['product.#', 'restaurant.#', 'branch.#', 'rbac.#'],
  prefetch:           10,
  deadLetterExchange: 'order-service.core-events.dlx',
  deadLetterQueue:    'order-service.core-events.dead',
};
```

**`src/lib/messaging/core-event-handler.ts`**

Routing key → handler:

| Routing Key | Action |
|---|---|
| `product.price_changed` | Invalidate any cached product snapshot (core client cache) |
| `product.stock_changed` | Same — invalidate product availability cache |
| `restaurant.suspended` | `DEL os:orders:branch:{branchId}:*` |
| `branch.deactivated` | Invalidate branch-related order list caches |
| `rbac.permissions_changed` | **Call `permissionCacheService.invalidate(roleName)`** — we DO have an in-memory permission cache |

**Consumer deduplication with `trySet`**: RabbitMQ guarantees at-least-once delivery. After a
crash, the broker may redeliver a message that was already processed. Use `trySet` to deduplicate:

```typescript
export async function startCoreEventConsumer(
  broker: IMessageBroker,
  cache: ICacheProvider,
  permissionCacheService: PermissionCacheService,
): Promise<void> {
  await broker.consume(CORE_EVENTS_CONSUMER_OPTS, async (msg) => {
    // Dedup: derive a stable key from the routing key + body hash
    const dedupKey = `os:consumed:${msg.routingKey}:${hashBody(msg.body)}`;
    const isFirst = await cache.trySet(dedupKey, '1', 3600); // 1h window
    if (!isFirst) {
      msg.ack(); // already processed — ack and skip
      return;
    }

    const payload = JSON.parse(msg.body.toString());
    switch (msg.routingKey) {
      case 'rbac.permissions_changed':
        await permissionCacheService.invalidate(payload.roleName);
        break;
      case 'product.price_changed':
      case 'product.stock_changed':
        await cache.del(`os:product:${payload.productId}`);
        break;
      case 'restaurant.suspended':
        await cache.del(`os:orders:branch:${payload.branchId}:*`);
        break;
      // Unknown events: fall through — ack and ignore (forward compatibility)
    }
    msg.ack();
  });
}

function hashBody(body: Buffer): string {
  return require('crypto').createHash('sha256').update(body).digest('hex').slice(0, 16);
}
```

**Why dedup with `trySet` and not a DB flag**: the event is idempotent (cache invalidation has
no side effects beyond a redundant DEL), so a Redis key with a 1-hour TTL is sufficient.
No DB write, no distributed lock. If Redis is down, `trySet` throws — the catch in
`RabbitMQClient.handleMessage` nacks (no requeue → DLQ), preventing a crash loop.

### 11.9 Internal Webhook Endpoint (from Core Service)
In addition to RabbitMQ, the core service may call `POST /api/internal/webhooks/core` for
synchronous invalidation events (e.g., immediate cache bust on restaurant suspension).

**Auth**: HMAC-SHA256 signature on the request body using `INTERNAL_HMAC_SECRET` (shared secret
between services — never exposed to clients).

```
POST /api/internal/webhooks/core
Headers: x-internal-signature: <hmac_hex>
Body: { "eventType": "restaurant.suspended", "payload": { "restaurantId": 5 } }
```

The handler verifies the signature then routes to the same `CORE_EVENT_HANDLERS` map.

### 11.10 DI Registration
```typescript
// src/lib/di/container.ts
import { RabbitMQClient } from '../../pkg/messaging/rabbitmq/rabbitmq.client.js';

const broker = new RabbitMQClient({
  url: env.rabbitmq.url,
  reconnectInitialMs: 2000,
});
// Single RabbitMQClient satisfies both IMessagePublisher and IMessageBroker
container.registerInstance(TOKENS.MessageBroker, broker);
```

Add to `TOKENS`:
```typescript
MessageBroker: Symbol('MessageBroker'),
```

> The `RabbitMQClient` exposes `publish()`, `consume()`, and `declareTopology()` — one instance
> handles both publishing (outbox dispatcher) and consuming (core event consumer). Register once,
> resolve as `IMessageBroker` wherever needed.

### 11.11 Env Variables
Already covered by Phase 0.3 and CLAUDE.md §15 (`RABBITMQ_URL`, `INTERNAL_HMAC_SECRET`).
This phase introduces no new env variables.

### Acceptance Criteria
- [ ] Place an order → `outbox` row appears with `dispatched_at = NULL`.
- [ ] Within 2 seconds → row `dispatched_at` is stamped, RabbitMQ message visible in management UI.
- [ ] Simulate RabbitMQ down → `attempts` increments on each tick, `last_error` populated. No data lost.
- [ ] RabbitMQ back up → pending rows dispatch without manual intervention.
- [ ] Core service emits `product.price_changed` → order service handler runs, Redis key deleted.
- [ ] `POST /api/internal/webhooks/core` with invalid signature → 400.

---

## Phase 12 — Hardening & Review

- [ ] All repository calls use `db(region)` — never bare `db` singleton
- [ ] No N+1 queries anywhere (audit every service method)
- [ ] All response types go through a Response DTO (no raw entity exposure)
- [ ] Kashier webhook endpoint uses raw body middleware for HMAC
- [ ] Internal webhook endpoint (`/api/internal/webhooks/core`) verifies HMAC signature
- [ ] Idempotency middleware on: POST /orders, POST /payments/sessions, POST /orders/:id/cancel
- [ ] All errors use `AppError` — no raw `throw new Error()`
- [ ] `tsc --noEmit` — zero type errors
- [ ] All migration `down()` functions tested
- [ ] Environment validated at startup (Zod) — server fails fast on missing vars
- [ ] Outbox dispatcher starts on server boot — confirm with log line
- [ ] RabbitMQ consumer starts on server boot — confirm subscription log line
- [ ] Dead-letter rows (attempts >= 5) visible and queryable for ops team
