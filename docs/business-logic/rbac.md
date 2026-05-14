# Business Logic — RBAC & Authorization

## Overview

This service does **not** own a permission catalog or a `restaurant_members` table. All
role and permission data is issued by the core service and travels into this service via
two paths:

1. **JWT claims** — coarse role, restaurantId, branchIds carried at login time.
2. **Redis permission projection** — fine-grained permission set fetched from the core
   service and cached for 5 minutes.

---

## JWT Claim Shape

```typescript
interface JWTPayload {
  userId: number;
  role: 'customer' | 'delivery_agent' | 'restaurant_user' | 'system_admin';
  countryCode: string;       // user profile field — NOT used for DB routing
  restaurantId?: number;     // present only for restaurant_user role
  restaurantRole?: 'owner' | 'branch_manager' | 'staff';
  branchIds?: number[];      // branches this member can act on (branch_manager + staff)
}
```

> `countryCode` in the JWT is the user's home country — it is useful for displaying the
> correct currency on the frontend but is **not** used for DB routing. Region routing comes
> exclusively from the `X-Region` request header.

> The permission catalogue (`orders:read`, `orders:accept`, `orders:update`, `orders:cancel`,
> `payments:read`, `finance:read`, `deliveries:assign`, ...) and the `restaurantRole → permissions`
> mapping are **owned by the core service** — this service caches the projection in Redis
> (`core:rbac:perms:{roleName}`, TTL 5 min) and reacts to the `rbac.role_updated` event for
> invalidation. Do not edit the catalogue here; treat the entries below as documentation of the
> contract this service consumes.

---

## Middleware Chain (per-router)

```
resolveRegion        → reads X-Region header, sets req.region (never throws)
requireRegion        → 400 if req.region is undefined
authenticate         → verifies JWT, sets req.user
requireRole(role)    → 403 if req.user.role !== role
```

For admin fan-out reads (`X-Region: all`), use `requireConcreteRegion` instead of
`requireRegion` only on endpoints that must target a specific shard.

---

## Role Guards

### `requireRole(role)`
Asserts `req.user.role === role`. Returns 403 otherwise.

### `requireSystemAdmin()`
Shorthand for `requireRole('system_admin')`.

### `requireRestaurantMember()`
Asserts `req.user.role === 'restaurant_user'` AND `req.user.restaurantId` is set.
Does **not** check branch-level access — that check lives in the service layer (requires
loading the order to compare `order.branchId` against `req.user.branchIds`).

---

## Permission Projection (Redis Cache)

For fine-grained permission checks (e.g. "can this role call this resource/action pair"),
the service fetches the permission set from the core service and caches it in Redis.

**Cache key**: `core:rbac:perms:{roleName}` — TTL 5 minutes.

**Population**:
```typescript
// On cache miss:
const data = await coreClient.getRolePermissions(roleName);
await cache.set(`core:rbac:perms:${roleName}`, JSON.stringify(data.permissions), 300);
```

**Invalidation**: when the order service receives a `rbac.permissions_changed` event from
the core service (via RabbitMQ or internal webhook), it calls:
```typescript
await cache.delete(`core:rbac:perms:${payload.roleName}`);
```
The next request for that role re-fetches from the core service.

---

## Branch-Level Access Check

For restaurant endpoints that operate on a specific order, the service layer enforces:

```typescript
function canAccessBranch(user: JWTPayload, branchId: number): boolean {
  if (user.restaurantRole === 'owner') return true;          // owners see all branches
  return user.branchIds?.includes(branchId) ?? false;        // branch_manager + staff scoped
}
```

This check happens **after** loading the order — the middleware only verifies the coarse
restaurant membership. The service method is responsible for calling `canAccessBranch` and
throwing `OrderAccessDeniedError` (403) if it returns false.

The cross-restaurant check (`order.restaurantId === user.restaurantId`) is also performed in
the service layer, before `canAccessBranch`, so a member of one restaurant can never enumerate
or read orders belonging to another.

---

## Authorization Matrix Summary

| Route group | Middleware | Extra service-layer check |
|---|---|---|
| `POST /api/orders` | `authenticate`, `requireRole('customer')`, `requireRegion` | address.userId === customerId |
| `GET /api/customer/orders` | `authenticate`, `requireRole('customer')`, `requireRegion` | — |
| `GET /api/orders/{publicId}` | `authenticate`, `requireRegion` | order owner / restaurant member / admin |
| `PATCH /api/orders/{publicId}/status` | `authenticate`, `requireRegion` | actor role + status transition matrix |
| `GET /api/restaurant/orders` | `authenticate`, `requireRestaurantMember()`, `requireRegion`, `rbac({ resource: 'orders', action: 'read' })` | `canAccessBranch(user, branchId)` |
| `POST /api/payments/init` | `authenticate`, `requireRole('customer')`, `requireRegion` | order.customerId === userId |
| `GET /api/payments/{id}` | `authenticate`, `requireRegion` | admin or restaurant owner |
| `POST /api/payments/{id}/refund` | `authenticate`, `requireSystemAdmin()`, `requireRegion` | — |
| `POST /api/payments/webhook/{provider}` | *(none)* | HMAC signature via `KASHIER_WEBHOOK_SECRET` |
| `POST /api/deliveries/assign/{orderId}` | `authenticate`, `requireSystemAdmin()`, `requireRegion` | — |
| `POST /api/deliveries/reassign/{orderId}` | `authenticate`, `requireSystemAdmin()`, `requireRegion` | — |
| `PATCH /api/deliveries/{id}/status` | `authenticate`, `requireRole('delivery_agent')`, `requireRegion` | delivery.agentId === userId |
| `POST /api/agents/presence/*` | `authenticate`, `requireRole('delivery_agent')`, `requireRegion` | — |
| `GET /api/agents/tasks` | `authenticate`, `requireRole('delivery_agent')`, `requireRegion` | — |
| `GET /api/agents/earnings` | `authenticate`, `requireRole('delivery_agent')`, `requireRegion` | — |
| `GET /api/restaurant/balance` | `authenticate`, `requireRestaurantMember()`, `requireRegion`, `rbac({ resource: 'finance', action: 'read' })` | — |
| `GET /api/restaurant/payouts` | `authenticate`, `requireRestaurantMember()`, `requireRegion`, `rbac({ resource: 'finance', action: 'read' })` | — |
| `POST /api/restaurant/payouts` | `authenticate`, `requireSystemAdmin()`, `requireRegion` | — |
| `GET /api/admin/*` | `authenticate`, `requireSystemAdmin()` | — |
| `POST /api/internal/*` | *(none)* | HMAC signature via `INTERNAL_HMAC_SECRET` |
