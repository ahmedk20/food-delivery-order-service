# Table Partitioning — pg_partman

This document covers time-based range partitioning for high-volume tables using
[pg_partman](https://github.com/pgpartman/pg_partman). Partitioning is transparent to
application code but requires schema changes and a background worker.

---

## Why Partition

The `orders` and `transactions` tables grow unboundedly. Without partitioning:
- Vacuums and autovacuum run over the full table even when only touching recent rows.
- Index scans on `created_at` ranges become slower as the table grows.
- Dropping old data requires slow `DELETE` statements with dead-tuple bloat.

With monthly range partitions:
- Old partitions are dropped by a single `DROP TABLE` — instant, no bloat.
- Queries that filter on `created_at` hit only the relevant partition(s) — partition pruning.
- Autovacuum ignores frozen old partitions entirely.

---

## Tables to Partition

| Table | Partition key | Interval | Retention |
|---|---|---|---|
| `orders` | `created_at` | monthly | 24 months on hot cluster; archive cluster is unlimited |
| `transactions` | `created_at` | monthly | 24 months on hot cluster |
| `deliveries` | `assigned_at` | monthly | 24 months on hot cluster |
| `payment_webhook_events` | `created_at` | monthly | 6 months on hot cluster |

Lower-volume tables (`agent_earnings`, `payment_sessions`, `idempotency_keys`) are not
partitioned — their size is bounded by natural TTLs or order volume caps.

---

## Docker Setup

pg_partman is a compiled Postgres extension. The official `postgres` Docker image does not
include it. Build a custom image.

### `docker/Dockerfile.postgres`

```dockerfile
FROM postgres:17

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      postgresql-17-partman \
 && rm -rf /var/lib/apt/lists/*
```

### `docker-compose.yml` (relevant service block)

```yaml
services:
  db-eg:
    build:
      context: .
      dockerfile: docker/Dockerfile.postgres
    environment:
      POSTGRES_DB: order_service_eg
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - pgdata-eg:/var/lib/postgresql/data
      - ./docker/postgres.conf:/etc/postgresql/postgresql.conf
    command: postgres -c config_file=/etc/postgresql/postgresql.conf
    ports:
      - "5432:5432"

  db-ksa:
    build:
      context: .
      dockerfile: docker/Dockerfile.postgres
    environment:
      POSTGRES_DB: order_service_ksa
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - pgdata-ksa:/var/lib/postgresql/data
      - ./docker/postgres.conf:/etc/postgresql/postgresql.conf
    command: postgres -c config_file=/etc/postgresql/postgresql.conf
    ports:
      - "5433:5432"

volumes:
  pgdata-eg:
  pgdata-ksa:
```

### `docker/postgres.conf`

```conf
# pg_partman background worker — must be in shared_preload_libraries
shared_preload_libraries = 'pg_partman_bgw'

# Run maintenance every hour (3600 seconds)
pg_partman_bgw.interval    = 3600

# Database list to run maintenance on (comma-separated, no spaces)
pg_partman_bgw.dbname      = order_service_eg,order_service_ksa

# Role used by the background worker (must own the partitioned tables)
pg_partman_bgw.role        = postgres
```

> If you add a new region, append its database name to `pg_partman_bgw.dbname` and restart
> the container.

---

## Enable the Extension

Run this once per cluster (add to migration `{ts}_enable_pg_partman.ts`, which runs before
any partitioned-table migration):

```sql
CREATE SCHEMA IF NOT EXISTS partman;
CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;
```

The `partman` schema keeps pg_partman's own tables and functions isolated from the app schema.

---

## Schema Implications

### Primary key must include the partition key

PostgreSQL requires that every unique constraint on a partitioned table includes **all**
partition key columns. The `orders` table currently has `id BIGSERIAL PRIMARY KEY` and a
separate `UNIQUE (public_id)`. Both must change:

```sql
-- New composite PK
PRIMARY KEY (id, created_at)

-- New unique constraint (local to each partition — UUID collision probability is negligible)
UNIQUE (public_id, created_at)
```

The `id` column keeps its `BIGSERIAL` default so values are still globally monotonic — the
sequence spans all partitions. Uniqueness of `id` alone is **not** enforced at the DB level;
it is guaranteed by the monotonic sequence.

### Foreign keys from child tables

PostgreSQL cannot enforce a foreign key from a child table to a partitioned parent unless the
FK includes all partition key columns. Adding `created_at` to `order_items`, `payment_sessions`,
`deliveries`, and `transactions` just for FK purposes is too invasive.

**Decision**: convert intra-service FKs from child tables to `orders(id)` to **logical-only**
FKs (same pattern as cross-service FKs). The application layer is responsible for referential
integrity — an `orders` row is always created before any child rows in the same transaction.

DB-level FKs between child tables that are both **not** partitioned (e.g., `agent_earnings →
deliveries`) remain as real constraints and are unaffected.

---

## Creating Partitioned Tables

Below is the target DDL for `orders`. The other tables follow the same pattern — substitute
the table name, columns, and partition key.

```sql
-- Create the partitioned parent (no data lives here directly)
CREATE TABLE orders (
    id                              BIGSERIAL       NOT NULL,
    region                          TEXT            NOT NULL,
    public_id                       UUID            NOT NULL DEFAULT gen_random_uuid(),
    country_code                    TEXT            NOT NULL,
    customer_id                     BIGINT          NOT NULL,
    restaurant_id                   BIGINT          NOT NULL,
    branch_id                       BIGINT          NOT NULL,
    delivery_address_id             BIGINT          NOT NULL,
    delivery_lat                    DECIMAL(10,7)   NOT NULL,
    delivery_lng                    DECIMAL(10,7)   NOT NULL,
    delivery_address_snapshot       JSONB           NOT NULL,
    delivery_agent_id               BIGINT,
    status                          TEXT            NOT NULL DEFAULT 'pending_payment',
    payment_method                  TEXT            NOT NULL,
    subtotal                        INT             NOT NULL CHECK (subtotal >= 0),
    delivery_fee                    INT             NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
    service_fee                     INT             NOT NULL DEFAULT 0 CHECK (service_fee >= 0),
    discount                        INT             NOT NULL DEFAULT 0 CHECK (discount >= 0),
    commission                      INT             NOT NULL DEFAULT 0 CHECK (commission >= 0),
    total                           INT             NOT NULL CHECK (total >= 0),
    currency                        CHAR(3)         NOT NULL,
    notes                           TEXT,
    estimated_delivery_at           TIMESTAMP,
    accepted_at                     TIMESTAMP,
    rejected_at                     TIMESTAMP,
    ready_at                        TIMESTAMP,
    assigned_at                     TIMESTAMP,
    picked_at                       TIMESTAMP,
    delivered_at                    TIMESTAMP,
    cancelled_at                    TIMESTAMP,
    cancellation_reason             TEXT,
    created_at                      TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMP       NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at),
    UNIQUE (public_id, created_at),
    CONSTRAINT ck_orders_status CHECK (status IN (
        'pending_payment', 'placed', 'accepted', 'rejected',
        'preparing', 'ready', 'assigned', 'picked', 'delivered', 'cancelled'
    )),
    CONSTRAINT ck_orders_payment_method CHECK (payment_method IN ('online', 'cod'))
) PARTITION BY RANGE (created_at);

-- Hand the table to pg_partman.
-- p_interval: how wide each partition is ('monthly' creates one per calendar month).
-- p_premake:  how many future partitions to pre-create (4 = ~4 months ahead).
-- p_start_partition: first partition start; set to the beginning of your data.
SELECT partman.create_parent(
    p_parent_table   => 'public.orders',
    p_control        => 'created_at',
    p_interval       => 'monthly',
    p_premake        => 4,
    p_start_partition => to_char(NOW() - INTERVAL '1 month', 'YYYY-MM-01')
);
```

Indexes and the updated_at trigger are created **per partition** automatically by pg_partman
when you register them on the template table it creates (named `_partman_template_orders`):

```sql
-- Apply indexes to the template so all future partitions inherit them
CREATE INDEX ON partman._partman_template_orders (public_id);
CREATE INDEX ON partman._partman_template_orders (customer_id, created_at DESC, id DESC);
CREATE INDEX ON partman._partman_template_orders (branch_id, status, created_at DESC, id DESC);
CREATE INDEX ON partman._partman_template_orders (status, created_at ASC)
    WHERE status IN ('ready', 'assigned');
CREATE INDEX ON partman._partman_template_orders (delivery_agent_id, status)
    WHERE delivery_agent_id IS NOT NULL;

CREATE TRIGGER trg_orders_updated_at
BEFORE UPDATE ON partman._partman_template_orders
FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
```

> Indexes defined on the template are automatically added to every new partition pg_partman
> creates. Existing partitions must have the indexes added manually with a one-off migration
> (see Migration section below).

---

## Maintenance Configuration

pg_partman stores per-table settings in `partman.part_config`. Tune retention here:

```sql
-- Keep 24 months; drop older partitions automatically
UPDATE partman.part_config
SET
    retention             = '24 months',
    retention_keep_table  = false,   -- physically drop the old partition
    premake               = 4        -- always keep 4 future partitions pre-created
WHERE parent_table = 'public.orders';
```

Set `retention_keep_table = true` if you want to **detach** old partitions rather than drop
them — useful if you plan to `ATTACH` them to the archive cluster later.

Run maintenance manually to verify config before relying on the background worker:

```sql
-- Run one maintenance cycle for all configured tables
CALL partman.run_maintenance_proc();

-- Run for a single table only
SELECT partman.run_maintenance('public.orders');
```

---

## Migration Approach

Migrating an existing populated `orders` table to a partitioned layout requires a table swap.
Knex does not provide built-in support — use `knex.raw()` with explicit SQL.

### Migration file: `{ts}_partition_orders.ts`

```typescript
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    -- 1. Rename the existing table
    ALTER TABLE orders RENAME TO orders_old;

    -- 2. Create the new partitioned table (see DDL above)
    -- ... (full CREATE TABLE statement here)

    -- 3. Register with pg_partman (creates initial partitions)
    SELECT partman.create_parent(
        p_parent_table    => 'public.orders',
        p_control         => 'created_at',
        p_interval        => 'monthly',
        p_premake         => 4,
        p_start_partition => to_char(
            (SELECT MIN(created_at) FROM orders_old),
            'YYYY-MM-01'
        )
    );

    -- 4. Copy data in batches (avoid one giant transaction)
    -- Run this outside the migration if the table is large (see note below)
    INSERT INTO orders SELECT * FROM orders_old;

    -- 5. Drop the old table
    DROP TABLE orders_old;
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Reversing a partition migration is destructive — not safe to automate.
  // Create a new non-partitioned table from the partitioned one if needed.
  throw new Error('Partition migration cannot be rolled back automatically.');
}
```

> **Large tables**: for tables with millions of rows, run step 4 as a background batch job
> (e.g. copy 10,000 rows at a time) while the service is in read-only maintenance mode, or
> use `pg_dump` / `pg_restore` on the new schema. Never run a single INSERT that touches
> hundreds of millions of rows inside a migration transaction.

---

## Application Code Impact

Partition pruning is **transparent** to application queries. A query like:

```typescript
await db(region)('orders')
  .where({ customer_id: id })
  .whereBetween('created_at', [startDate, endDate])
  .orderBy('created_at', 'desc')
  .limit(20);
```

will automatically hit only the relevant monthly partitions. No code changes are needed.

The only behavioral difference: `INSERT` statements must include `created_at` explicitly
(they already do via `DEFAULT NOW()` in the column definition — no change required).

---

## Verifying Partition Pruning

```sql
-- EXPLAIN should show "Partitions scanned: N" — not all partitions
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM orders
WHERE customer_id = 123
  AND created_at >= '2025-01-01'
  AND created_at <  '2025-02-01';
```

If the plan shows `Partitions scanned: 1`, pruning is working. If it shows all partitions,
check that `created_at` is in the `WHERE` clause as a constant or parameter-bound value.

---

## Adding a New Region

When provisioning a new cluster (see `docs/sharding.md`), pg_partman setup is included in the
migration sequence:

```
REGION=bh CLUSTER=hot npm run migrate
```

The migration file `{ts}_enable_pg_partman.ts` runs `CREATE EXTENSION` and
`{ts}_partition_orders.ts` (and the other table migrations) do the rest. The background
worker picks up the new database automatically once you add it to `pg_partman_bgw.dbname`
and restart the container.
