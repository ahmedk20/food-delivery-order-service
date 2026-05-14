# Folder Structure — Order & Payment Service

This document describes the complete folder and file structure following the same conventions
as the core service (`food-delivery-core-service`). Every new file must be placed in the
correct layer. Violating layer import rules is treated as a bug.

---

## Top-Level Layout

```
order-service/
├── src/
│   ├── app/          # Business modules — app-aware, may import lib + pkg
│   ├── lib/          # Infrastructure layer — may import pkg only
│   ├── pkg/          # Pure providers — no lib or app imports
│   ├── database/
│   │   └── migrations/
│   ├── app.ts        # Express factory
│   ├── routes.ts     # Root router
│   └── server.ts     # HTTP + WebSocket bootstrap
├── docs/             # Project documentation (this directory)
├── .env.dev
├── .env.example
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

---

## Layer Rules (STRICT — never break these)

```
pkg/   ← pure npm + Node stdlib only. Zero knowledge of Express, app, or lib.
  ↑
lib/   ← knows pkg. App-aware infrastructure (middleware, DI container, error handler).
         Does NOT import from app/.
  ↑
app/   ← knows lib + pkg. Business logic. app/ modules DO NOT import each other's
         repositories. Cross-module calls go through services injected via DI.
```

---

## src/pkg/ — Pure Provider Implementations

No framework awareness. No business logic. These are adapters around external SDKs.

```
src/pkg/
├── cache/
│   ├── cache.interface.ts        # ICacheProvider: get / set / delete
│   └── redis.ts                  # RedisCacheProvider (ioredis)
│
├── payment/
│   ├── payment-provider.interface.ts  # IPaymentProvider: createSession / verifyWebhookSignature
│   └── kashier.ts                     # KashierPaymentProvider — Kashier v3 HTTP calls
│
├── messaging/
│   ├── messaging.interface.ts    # IMessagePublisher / IMessageConsumer
│   └── rabbitmq.ts               # RabbitMQPublisher + RabbitMQConsumer (amqplib)
│
└── utils/
    ├── time.ts                   # Pure time helpers (e.g. nowUtc(), secondsUntil(date))
    ├── money.ts                  # toMinor / fromMinor / sumMinor / multiplyMinor
    └── currency.ts               # currencyForCountry(countryCode) → 'EGP' | 'SAR' | ...
```

**Rules for `pkg/`:**
- Exports interfaces first, implementations second.
- No `AppError` — throw plain `Error` with descriptive messages; `lib/` translates.
- No Knex, no Express types, no DI decorators.
- Unit-testable in isolation with zero mocking of internal modules.

---

## src/lib/ — App-Aware Infrastructure

Shared infrastructure used by all `app/` modules. Knows about `pkg/` and npm packages.
Does NOT import from `app/`.

```
src/lib/
├── auth/
│   ├── guard.ts          # authenticate middleware — reads access_token cookie, sets req.user
│   ├── rbac.ts           # rbac({ resource, action }) — resolves perms from core:rbac:perms:{role} (Redis, 5m TTL); requireRole() / requireSystemAdmin() / requireRestaurantMember()
│   └── errors.ts         # NotAuthenticated, NotAuthorized (AppError instances)
│
├── cache/
│   ├── init.ts           # Initializes RedisCacheProvider from env, exports cacheProvider singleton
│   └── withCache.ts      # GET response cache middleware factory
│
├── config/
│   └── env.ts            # Zod-validated env object — the ONLY place process.env is read
│
├── correlation/
│   └── correlationId.ts  # Assigns X-CorrelationId to every request
│
├── di/
│   ├── container.ts      # TSyringe container — registers all services, controllers, providers
│   └── tokens.ts         # Symbol constants for every injectable
│
├── error/
│   ├── AppError.ts       # class AppError extends Error { statusCode, isOperational }
│   └── errorHandler.ts   # Global Express error handler middleware
│
├── http/
│   ├── response.ts                    # sendSuccess() / sendPaginated() — enforces ApiResponse<T> shape
│   ├── idempotency.ts                 # idempotency() middleware — replays cached response on duplicate key
│   ├── core-service-client.interface.ts  # ICoreServiceClient: getProduct / getAddress / getUser / getBranchMetadata / getRolePermissions
│   ├── core-service-client.ts         # CoreServiceClient — uses native fetch + AbortController; no axios
│   └── pagination/
│       ├── cursor-pagination.ts       # buildCursorQuery(query, cursor, limit, direction)
│       └── parse-query.ts             # parsePaginationQuery(req) → { cursor, limit }
│
├── knex/
│   ├── knex.ts           # db(region) + dbArchive(region) functions + pingAll()
│   ├── shards.ts         # Lazy Knex connection cache — Map<string,Knex> per cluster; getHotShard / getArchiveShard / destroyAllShards
│   └── knexfile.ts       # Knex config for CLI migrations — throws if REGION env var is missing
│
├── sharding/
│   └── region-resolver.ts  # resolveRegion (reads X-Region header → req.region), requireRegion (400 if unset), requireConcreteRegion (400 if "all")
│
├── logger/
│   └── logger.ts         # winston singleton logger
│
├── types/
│   └── express.d.ts      # Augments Request with req.user: JWTPayload and req.region: string | undefined
│
├── validation/
│   └── validate.ts       # validateBody<T>(cls, body) — class-validator + class-transformer
│
├── websocket/
│   ├── socket-server.ts  # socket.io server factory — attaches to HTTP server, configures redis-adapter, declares rooms
│   ├── socket-auth.ts    # verifySocketToken() — JWT auth middleware for socket.io connection handshake
│   └── events.ts         # WS_EVENTS constants: 'order.status_changed', 'order.created', 'order.delivery_assigned', etc.
│
└── outbox/
    ├── writer.ts              # writeOutboxEvent(conn, ...) — called inside DB transactions
    ├── dispatcher.ts          # startOutboxDispatcher(publisher) — polling loop, FOR UPDATE SKIP LOCKED
    └── core-event-handler.ts  # CORE_EVENT_HANDLERS map — handles events consumed from core service
```

---

## src/app/ — Business Modules

Each module follows the same internal structure. No module imports another module's
repository directly — all cross-module calls go through injected services.

```
src/app/
├── order/
│   ├── controller/
│   │   └── order.controller.ts       # @injectable() OrderController
│   ├── dto/
│   │   ├── place-order.dto.ts        # PlaceOrderDTO (class-validator)
│   │   ├── cancel-order.dto.ts       # CancelOrderDTO
│   │   ├── order-response.dto.ts     # OrderResponseDTO.fromEntity()
│   │   └── order-list-response.dto.ts
│   ├── entity/
│   │   ├── order.entity.ts           # OrderEntity (plain class, camelCase props)
│   │   └── order-item.entity.ts      # OrderItemEntity
│   ├── repository/
│   │   ├── order.repo.ts             # findOrderById / createOrder / updateOrderStatus / ...
│   │   └── order-item.repo.ts        # findItemsByOrderId / findItemsByOrderIds / createItems
│   ├── service/
│   │   └── order.service.ts          # @injectable() OrderService
│   ├── enums.ts                      # OrderStatus, PaymentMethod
│   ├── errors.ts                     # OrderNotFoundError, InvalidOrderStatusTransitionError, ...
│   └── routes.ts                     # Express Router — customer order routes
│
├── payment/
│   ├── controller/
│   │   └── payment.controller.ts     # @injectable() PaymentController
│   ├── dto/
│   │   ├── create-session.dto.ts     # CreatePaymentSessionDTO
│   │   └── transaction-response.dto.ts
│   ├── entity/
│   │   ├── transaction.entity.ts           # TransactionEntity
│   │   └── webhook-event.entity.ts         # PaymentWebhookEventEntity
│   ├── repository/
│   │   ├── transaction.repo.ts             # findTransaction / createTransaction / updateTransaction
│   │   ├── webhook-event.repo.ts           # insertWebhookEvent (ON CONFLICT DO NOTHING) / markProcessed / markError
│   │   └── payment-provider.repo.ts        # findPaymentProviderByName / findActiveProvider
│   ├── service/
│   │   └── payment.service.ts        # @injectable() PaymentService
│   ├── enums.ts                      # TransactionType, TransactionStatus
│   ├── errors.ts                     # InvalidWebhookSignatureError, KashierApiError, ...
│   └── routes.ts                     # /payments/sessions, /payments/webhook, /payments/orders/:id
│
├── delivery-agent/
│   ├── controller/
│   │   └── agent.controller.ts       # @injectable() AgentController
│   ├── dto/
│   │   ├── update-presence.dto.ts    # UpdatePresenceDTO
│   │   ├── agent-order-response.dto.ts
│   │   └── earnings-response.dto.ts
│   ├── entity/
│   │   ├── agent-presence.entity.ts  # AgentPresenceEntity
│   │   └── agent-earnings.entity.ts  # AgentEarningsEntity
│   ├── repository/
│   │   ├── agent-presence.repo.ts    # upsertPresence / findPresenceByAgentId
│   │   └── agent-earnings.repo.ts    # createEarnings / findEarningsByAgentId
│   ├── service/
│   │   └── agent.service.ts          # @injectable() AgentService
│   ├── errors.ts                     # AgentNotAvailableError, OrderAlreadyTakenError, ...
│   └── routes.ts                     # /agents/me/presence, /agents/me/orders, ...
│
├── restaurant-orders/
│   ├── controller/
│   │   └── restaurant-order.controller.ts
│   ├── dto/
│   │   ├── confirm-order.dto.ts      # ConfirmOrderDTO (estimated_delivery_at)
│   │   └── restaurant-order-response.dto.ts
│   ├── service/
│   │   └── restaurant-order.service.ts  # confirm / prepare / ready transitions
│   └── routes.ts                        # /restaurant/orders, /restaurant/orders/:id/confirm, ...
│
├── admin/
│   ├── controller/
│   │   └── admin.controller.ts
│   ├── dto/
│   │   └── admin-cancel-order.dto.ts
│   ├── service/
│   │   └── admin.service.ts
│   └── routes.ts                     # /admin/orders, /admin/transactions, ...
│
└── health/
    └── routes.ts                     # GET /health
```

---

## src/database/migrations/

File naming: `{YYYYMMDDHHmmss}_{snake_case_description}.ts`

```
src/database/migrations/
├── 20260501000001_create_fn_update_updated_at.ts   # shared trigger function — must run first
├── 20260501000002_create_payment_providers.ts      # table + seed
├── 20260501000003_create_payment_webhook_events.ts
├── 20260501000004_create_orders.ts
├── 20260501000005_create_order_items.ts
├── 20260501000006_create_transactions.ts
├── 20260501000007_create_restaurant_balances.ts
├── 20260501000008_create_agent_presence.ts
└── 20260501000009_create_agent_earnings.ts
```

Each migration file exports only `up(knex)` and `down(knex)`.
All SQL is written with `knex.raw()` — no Knex schema builder.

---

## DI Token Registry (src/lib/di/tokens.ts)

Every injectable class must have a token. Register all of them here:

```typescript
export const TOKENS = {
  // Services
  OrderService:           Symbol('OrderService'),
  PaymentService:         Symbol('PaymentService'),
  AgentService:           Symbol('AgentService'),
  RestaurantOrderService: Symbol('RestaurantOrderService'),
  AdminService:           Symbol('AdminService'),

  // Controllers
  OrderController:           Symbol('OrderController'),
  PaymentController:         Symbol('PaymentController'),
  AgentController:           Symbol('AgentController'),
  RestaurantOrderController: Symbol('RestaurantOrderController'),
  AdminController:           Symbol('AdminController'),

  // Providers
  CacheProvider:          Symbol('CacheProvider'),
  PaymentProvider:        Symbol('PaymentProvider'),     // IPaymentProvider (Kashier)
  CoreServiceClient:      Symbol('CoreServiceClient'),   // ICoreServiceClient (native fetch)
  SocketServer:           Symbol('SocketServer'),        // ISocketServer (socket.io + redis-adapter)
  MessageBroker:          Symbol('MessageBroker'),       // IMessageBroker (RabbitMQ — publish + consume)

  Logger: Symbol('Logger'),
};
```

---

## Route Registration (src/routes.ts)

```typescript
import { Router } from 'express';
import { orderRouter }           from './app/order/routes.js';
import { paymentRouter }         from './app/payment/routes.js';
import { agentRouter }           from './app/delivery-agent/routes.js';
import { restaurantOrderRouter } from './app/restaurant-orders/routes.js';
import { adminRouter }           from './app/admin/routes.js';
import { healthRouter }          from './app/health/routes.js';

export const routes = Router();

routes.use('/orders',          orderRouter);
routes.use('/payments',        paymentRouter);
routes.use('/agents',          agentRouter);
routes.use('/restaurant',      restaurantOrderRouter);
routes.use('/admin',           adminRouter);
routes.use('/health',          healthRouter);
```

---

## Middleware Stack (src/app.ts)

Applied in this exact order:

```typescript
app.use(cors(...))
app.use(helmet())
app.use(express.json())
app.use(cookieParser())
app.use(correlationId)       // assigns X-CorrelationId
app.use(resolveRegion)       // reads X-Region header → req.region (never throws)
app.use('/api', routes)
app.use(errorHandler)        // global error handler — must be last
```

> `authenticate` and role/region guards (`requireRegion`, `requireRole`, `rbac`) are applied
> per-router, not globally — webhook and health endpoints must remain unauthenticated.

---

## File Naming Cheatsheet

| What | Pattern | Example |
|---|---|---|
| Entity | `{domain}.entity.ts` | `order.entity.ts` |
| Repository | `{domain}.repo.ts` | `order.repo.ts` |
| Service | `{domain}.service.ts` | `order.service.ts` |
| Controller | `{domain}.controller.ts` | `order.controller.ts` |
| DTO (request) | `{verb}-{noun}.dto.ts` | `place-order.dto.ts` |
| DTO (response) | `{noun}-response.dto.ts` | `order-response.dto.ts` |
| Enums | `enums.ts` (per module) | `src/app/order/enums.ts` |
| Errors | `errors.ts` (per module) | `src/app/order/errors.ts` |
| Routes | `routes.ts` (per module) | `src/app/order/routes.ts` |
| Migration | `{ts}_{description}.ts` | `20260501000003_create_orders.ts` |
