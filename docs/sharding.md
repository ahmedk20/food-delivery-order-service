# Sharding Guide — Per-Region Postgres Clusters

## Architecture

One independent PostgreSQL 15+ cluster per region. No shared coordinator, no Citus.
Each cluster holds all data for that region in a database named `order_service_{region}`.

```
Client (X-Region: eg)
  └─▶ Express app
        └─▶ resolveRegion middleware → req.region = 'eg'
              └─▶ db('eg')  →  [order_service_eg cluster]  (hot: reads + writes)
              └─▶ dbArchive('eg')  →  [order_service_eg_archive cluster]  (old data, read-only)
```

---

## Routing Key

`region TEXT NOT NULL` — present as the second column after `id` on every distributed table:
`orders`, `order_items`, `transactions`, `payment_sessions`, `payment_webhook_events`,
`restaurant_balances`, `deliveries`, `agent_presence`, `agent_earnings`,
`idempotency_keys`, and the future `outbox`.

The value matches the region codes in the `REGIONS` env var (e.g. `eg`, `ksa`).

`payment_providers` is the only **non-sharded** table — it lives on every cluster as a
per-shard replicated reference table (no `region` column, identical seed across clusters).

### Sharding + Partitioning

Four sharded tables are also **range-partitioned** monthly by pg_partman:

| Table | Partition key | Hot-cluster retention |
|---|---|---|
| `orders` | `created_at` | 24 months |
| `transactions` | `created_at` | 24 months |
| `deliveries` | `assigned_at` | 24 months |
| `payment_webhook_events` | `created_at` | 6 months |

Sharding and partitioning are independent axes: `db(region)` selects the cluster; within that
cluster Postgres routes each query to the correct monthly child partition automatically via
partition pruning. No application code changes are required.

See `docs/partitioning.md` for the Docker setup, DDL, and schema implications (composite PKs,
logical-only FKs to partitioned tables).

**`country_code`** is a separate business column on `orders` only — it drives
`currencyForCountry()` and may appear in responses, but is never used to select a cluster.

---

## `db(region)` vs. bare `db`

`db` is not a singleton in this service. Always call `db(region)` to get a Knex instance
for the target cluster:

```typescript
// RIGHT
const row = await db(region)('orders').where({ id }).first();

// WRONG — db is a function, calling it without arguments throws
const row = await db('orders').where({ id }).first();
```

`lib/knex/shards.ts` holds the lazy `Map<string,Knex>` connection cache. The first call for
a region creates the Knex instance and stores it; subsequent calls return the cached instance.

```typescript
// lib/knex/shards.ts
const hotShards = new Map<string, Knex>();

export function getHotShard(region: string): Knex {
  if (!hotShards.has(region)) {
    hotShards.set(region, buildKnex(env.db[region]));
  }
  return hotShards.get(region)!;
}

export async function destroyAllShards(): Promise<void> {
  await Promise.all([...hotShards.values()].map(k => k.destroy()));
  hotShards.clear();
}
```

---

## Region Resolution

```
Request lifecycle:
  1. resolveRegion  — reads X-Region header, sets req.region (never throws, region may be undefined)
  2. requireRegion  — throws 400 if req.region is undefined
  3. authenticate   — verifies JWT
  4. role guard     — requireRole / requireSystemAdmin / requireRestaurantMember
```

`POST /api/orders` is the only endpoint that derives region from context rather than the
header: if `req.region` is undefined, `OrderService.placeOrder` calls
`coreClient.getBranchMetadata(dto.branchId)` (cached TTL 60s) to recover the region.

`X-Region: all` is accepted by `resolveRegion` and sets `req.region = 'all'`. It is valid
only for system_admin fan-out reads. Use `requireConcreteRegion` on any endpoint that must
write to or read from a single cluster.

---

## Running Migrations

Migrations run per-shard. Every migration file is identical across regions — only the
connection changes.

```bash
# Run all pending migrations on the Egypt hot cluster
REGION=eg CLUSTER=hot npm run migrate

# Roll back the last migration on KSA hot cluster
REGION=ksa CLUSTER=hot npm run migrate:down

# Run on the archive cluster
REGION=eg CLUSTER=archive npm run migrate
```

`lib/knex/knexfile.ts` reads `REGION` and `CLUSTER` from `process.env` to build the
connection. It throws if either is missing — the CLI will not run silently against a wrong
database.

**Migration order requirement**: `{ts}_enable_pg_partman.ts` must run before any
partitioned-table migration (`orders`, `transactions`, `deliveries`, `payment_webhook_events`).
It creates the `partman` schema and installs the `pg_partman` extension, which the subsequent
`SELECT partman.create_parent(...)` calls depend on.

---

## Connection Pool Budget

Each service instance opens one pool per region per cluster type (hot + archive):

| Variable | Default | Notes |
|---|---|---|
| `DB_{region}_POOL_MIN` | 2 | Idle connections kept alive per hot cluster |
| `DB_{region}_POOL_MAX` | 10 | Maximum simultaneous connections per hot cluster |

With 2 regions and 2 service instances, the worst-case connection count per hot cluster is:
`POOL_MAX × instances = 10 × 2 = 20 connections`.

PostgreSQL default `max_connections = 100`. With 3 services (core + order + future),
budget: `20 connections × 3 services = 60`, leaving headroom for migrations and psql.

**Guidance**:
- Do not raise `POOL_MAX` beyond 20 per instance without increasing `max_connections` on
  the PostgreSQL server.
- Archive clusters handle analytics queries only — keep `POOL_MAX = 3` there; they are
  not on the critical path.
- In production with more than 5 service instances, use PgBouncer in front of each cluster
  to multiplex connections.
- The pg_partman background worker (`pg_partman_bgw`) holds **one superuser connection per
  database** it maintains. Account for this in your `max_connections` budget: with 2 regions
  that is 2 additional connections on each hot cluster.

---

## Adding a New Region

1. **Provision the cluster**: create a new PostgreSQL 17+ instance using the custom Docker image
   (`docker/Dockerfile.postgres`) that has `pg_partman` pre-installed.
2. **Add env vars**: copy the `DB_eg_*` block in `.env.dev` / `.env.example`, replace `eg`
   with the new region code (e.g. `bh`).
3. **Add to `REGIONS`**: append the new code, e.g. `REGIONS=eg,ksa,bh`.
4. **Run migrations**:
   ```bash
   REGION=bh CLUSTER=hot npm run migrate
   ```
5. **Register with the background worker**: append the new database name to
   `pg_partman_bgw.dbname` in `docker/postgres.conf` (e.g. `order_service_eg,order_service_ksa,order_service_bh`)
   and restart the container so pg_partman starts maintaining partitions for the new cluster.
6. **No application code change required**: `lib/knex/shards.ts` reads region codes at boot from `env.regions`.

---

## Adding a Payment Provider After Launch

To add a new payment provider (e.g. Paymob) without downtime:

1. **Implement the provider**: create `src/pkg/payment/paymob.ts` implementing `IPaymentProvider`.
2. **Add a `payment_providers` row** to each cluster via a migration or a one-off SQL script:
   ```sql
   INSERT INTO payment_providers (name, is_active, config, created_at, updated_at)
   VALUES ('paymob', false, '{}', NOW(), NOW());
   ```
   Start with `is_active = false` (dark launch).
3. **Register in DI** (optional): add a token and register alongside `KashierPaymentProvider`.
   The `PaymentService` can look up the active provider by name from the DB and resolve the
   correct implementation.
4. **Enable**: `UPDATE payment_providers SET is_active = true WHERE name = 'paymob'` on each
   cluster. No deploy required.

> The `payment_providers` table lives in every per-region cluster (run the migration per
> shard). There is no cross-region shared reference table (that was a Citus pattern).

---

## Archive Cluster

Each region has an optional archive cluster (`dbArchive(region)`). Use it for:
- Analytics and reporting queries that would saturate the hot cluster.
- Queries spanning long date ranges (> 30 days).
- Background jobs (e.g. earnings summary).

Write path **never** uses the archive cluster. Replication from hot → archive is handled
by PostgreSQL logical replication or periodic pg_dump restore (ops concern, not app code).

---

## Cross-Region Reads (system_admin only)

Endpoints that support `X-Region: all` must fan out manually:

```typescript
const regions = env.regions; // ['eg', 'ksa', ...]
const results = await Promise.all(
  regions.map(r => findOrdersByCustomerId(customerId, r, pagination))
);
const merged = results.flat().sort((a, b) => b.id - a.id);
```

This is acceptable for admin dashboards (low frequency). Never fan-out on customer-facing
paths — require a concrete region header instead.
