# Database Design — Order Service

Database name: `order_service_{region}` (one database per region, e.g. `order_service_eg`)
Engine: PostgreSQL 17+

---

## Sharding Architecture

**Pattern**: one independent Postgres cluster per region (`eg`, `ksa`, ...). No Citus coordinator. Each cluster hosts a single database with the complete schema. A separate archive cluster per region (`order_service_archive_{region}`) is populated by the future archival worker.

**Routing key**: `region TEXT NOT NULL` — present on every sharded table as the second column after `id`. All repository calls pass a region to `db(region)`, which routes to the correct cluster. Queries never cross clusters on the hot path.

**Sharded tables**: `orders`, `order_items`, `transactions`, `payment_sessions`, `payment_webhook_events`, `restaurant_balances`, `deliveries`, `agent_presence`, `agent_earnings`, `idempotency_keys`.

**`payment_providers`** is a normal table replicated to every cluster via migration (no Citus `create_reference_table`).

Cross-service FKs (to core service) are **logical only** — no DB-level constraint. Validation happens at the application layer via synchronous HTTP calls to the core service.

---

## Conventions

- Every table has `id BIGSERIAL PRIMARY KEY` unless noted. **Exception**: partitioned tables use a composite PK `(id, created_at)` — see Partitioning below.
- Every sharded table has `region TEXT NOT NULL` immediately after `id`.
- `created_at`, `updated_at` are `TIMESTAMP NOT NULL DEFAULT NOW()` on mutable rows. Status-transition timestamps (`accepted_at`, `picked_at`, etc.) are `TIMESTAMP NULL` until that transition fires.
- Money columns are `INT NOT NULL` storing minor units. A `currency CHAR(3) NOT NULL` column lives next to them or on the parent (`orders.currency`).
- Enum-like columns use `TEXT NOT NULL CHECK (col IN (...))` — portable across N independent clusters and easier to alter than native PG `ENUM`.
- Index naming: `idx_<table>_<col>[_<col>]`. Constraint naming: `fk_<table>_<col>`, `uq_<table>_<col>`, `ck_<table>_<col>`.
- Every FK column has a supporting btree index (Postgres does not auto-index FK columns).

## Partitioning

Four high-volume tables are range-partitioned by their creation timestamp using
[pg_partman](https://github.com/pgpartman/pg_partman). See `docs/partitioning.md` for the
full Docker setup and migration approach.

| Table | Partition key | Interval | Hot-cluster retention |
|---|---|---|---|
| `orders` | `created_at` | monthly | 24 months |
| `transactions` | `created_at` | monthly | 24 months |
| `deliveries` | `assigned_at` | monthly | 24 months |
| `payment_webhook_events` | `created_at` | monthly | 6 months |

### Unique-constraint rule

PostgreSQL requires every unique constraint on a partitioned table to include all partition
key columns. Consequences for this schema:

- **`orders` PK**: `(id, created_at)` instead of `id` alone. The `BIGSERIAL` sequence still
  produces monotonically increasing values across all partitions; uniqueness of bare `id` is
  guaranteed by the sequence, not by a DB constraint.
- **`orders.public_id`**: `UNIQUE (public_id, created_at)` instead of `UNIQUE (public_id)`.
  Global uniqueness of the UUID relies on collision probability, which is negligible.
- Same pattern applies to `transactions`, `deliveries`, and `payment_webhook_events`.

### Foreign keys to partitioned tables

A DB-level FK from a child table to `orders(id)` cannot be enforced by Postgres unless the
FK includes all partition key columns (`id, created_at`). Adding `created_at` to every child
table is too invasive.

**Decision**: FKs from child tables to `orders` are **logical only** — same pattern as
cross-service FKs to the core service. The application layer guarantees referential integrity
(the `orders` row is always created before child rows, inside the same transaction).

FKs between two non-partitioned tables (e.g. `agent_earnings → deliveries`) remain as real
DB-level constraints and are unaffected.

---

## Enums

TEXT + CHECK instead of native Postgres enums — portable across N independent clusters and easier to alter (adding a value to a native enum requires an exclusive lock; with TEXT + CHECK you widen the constraint with a non-blocking `ALTER TABLE ... VALIDATE CONSTRAINT`).

```sql
-- orders.status
CONSTRAINT ck_orders_status CHECK (status IN (
    'pending_payment',  -- online order created; awaiting Kashier payment confirmation
    'placed',           -- in restaurant queue (payment confirmed or COD order)
    'accepted',         -- restaurant accepted; cooking scheduled
    'rejected',         -- restaurant declined (terminal); triggers refund for online, void for COD
    'preparing',        -- restaurant is actively preparing
    'ready',            -- food ready; eligible for delivery agent assignment
    'assigned',         -- delivery agent assigned; agent notified
    'picked',           -- agent confirmed pickup at branch
    'delivered',        -- successfully delivered (terminal)
    'cancelled'         -- cancelled by customer / restaurant / admin (terminal)
))

-- orders.payment_method
CONSTRAINT ck_orders_payment_method CHECK (payment_method IN ('online', 'cod'))

-- transactions.type
CONSTRAINT ck_transactions_type CHECK (type IN (
    'charge',         -- customer charged for order (online payment collected)
    'cod_collection', -- COD amount recorded at delivery
    'commission',     -- platform commission deducted from restaurant's share
    'refund',         -- platform → customer (refund on cancellation or rejection)
    'payout',         -- platform → restaurant owner (earnings released)
    'adjustment'      -- manual admin correction
))

-- transactions.status
CONSTRAINT ck_transactions_status CHECK (status IN ('pending', 'succeeded', 'failed', 'reversed'))

-- deliveries.status
CONSTRAINT ck_deliveries_status CHECK (status IN (
    'assigned',    -- delivery row created; agent notified
    'accepted',    -- agent accepted the task
    'rejected',    -- agent declined; triggers reassignment
    'picked',      -- agent confirmed pickup at branch
    'delivered',   -- handoff confirmed (terminal); triggers money settlement
    'cancelled',   -- order cancelled while in delivery; agent released
    'reassigned'   -- superseded by a new delivery row
))

-- agent_earnings.status
CONSTRAINT ck_agent_earnings_status CHECK (status IN ('pending', 'paid'))

-- payment_sessions.status
CONSTRAINT ck_payment_sessions_status CHECK (status IN (
    'initialized', 'pending', 'authorized', 'captured', 'failed', 'expired', 'cancelled'
))
```

---

## Tables

### `payment_providers`

```sql
CREATE TABLE payment_providers (
    id            INT           PRIMARY KEY,
    name          TEXT          NOT NULL UNIQUE,   -- e.g. 'kashier', 'cod'
    display_name  TEXT          NOT NULL,
    is_enabled    BOOLEAN       NOT NULL DEFAULT true,
    priority      SMALLINT      NOT NULL DEFAULT 100,
    created_at    TIMESTAMP     NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- Seed (separate migration file, run after table creation)
INSERT INTO payment_providers (id, name, display_name, is_enabled, priority)
VALUES
    (1, 'kashier', 'Kashier',          true, 10),
    (2, 'cod',     'Cash on Delivery', true, 20)
ON CONFLICT (id) DO NOTHING;
```

No indexes beyond PK and the unique on `name`. Tiny lookup table; read-only in steady state.

> To add a payment provider, write a new seed migration and run it against every cluster.

---

### `orders`

Primary write target of this service. Holds the order header.

```sql
-- Partitioned by created_at (monthly). See docs/partitioning.md for pg_partman setup.
CREATE TABLE orders (
    id                              BIGSERIAL       NOT NULL,
    region                          TEXT            NOT NULL,
    public_id                       UUID            NOT NULL DEFAULT gen_random_uuid(),
    country_code                    TEXT            NOT NULL,   -- business column: drives currencyForCountry()
    customer_id                     BIGINT          NOT NULL,   -- logical FK → core.users.id
    restaurant_id                   BIGINT          NOT NULL,   -- logical FK → core.restaurants.id
    branch_id                       BIGINT          NOT NULL,   -- logical FK → core.restaurant_branches.id
    delivery_address_id             BIGINT          NOT NULL,   -- logical FK → core.customer_addresses.id
    delivery_lat                    DECIMAL(10,7)   NOT NULL,   -- snapshot at order time
    delivery_lng                    DECIMAL(10,7)   NOT NULL,
    delivery_address_snapshot       JSONB           NOT NULL,   -- full address JSON snapshot
    delivery_agent_id               BIGINT,                     -- logical FK → core.users.id (nullable until assigned)
    status                          TEXT            NOT NULL DEFAULT 'pending_payment',
    payment_method                  TEXT            NOT NULL,
    subtotal                        INT             NOT NULL CHECK (subtotal >= 0),
    delivery_fee                    INT             NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
    service_fee                     INT             NOT NULL DEFAULT 0 CHECK (service_fee >= 0),
    discount                        INT             NOT NULL DEFAULT 0 CHECK (discount >= 0),
    commission                      INT             NOT NULL DEFAULT 0 CHECK (commission >= 0),
    -- total = subtotal + delivery_fee + service_fee - discount (enforced at app layer)
    total                           INT             NOT NULL CHECK (total >= 0),
    currency                        CHAR(3)         NOT NULL,   -- snapshotted from country_code at write time
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
    -- Composite PK required: partition key (created_at) must be part of every unique constraint
    PRIMARY KEY (id, created_at),
    -- Local uniqueness per partition; global UUID collision probability is negligible
    UNIQUE (public_id, created_at),
    CONSTRAINT ck_orders_status CHECK (status IN (
        'pending_payment', 'placed', 'accepted', 'rejected',
        'preparing', 'ready', 'assigned', 'picked', 'delivered', 'cancelled'
    )),
    CONSTRAINT ck_orders_payment_method CHECK (payment_method IN ('online', 'cod'))
) PARTITION BY RANGE (created_at);

CREATE OR REPLACE FUNCTION fn_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- Client and gateway lookup by public UUID
CREATE INDEX idx_orders_public_id ON orders (public_id);

-- Customer viewing their order history (cursor pagination by (created_at DESC, id DESC) tuple)
CREATE INDEX idx_orders_customer_id_created_at ON orders (customer_id, created_at DESC, id DESC);

-- Restaurant dashboard: orders by branch + status (most queried hot endpoint)
CREATE INDEX idx_orders_branch_id_status ON orders (branch_id, status, created_at DESC, id DESC);

-- Auto-assignment scan: ready orders without an agent, sorted FIFO
CREATE INDEX idx_orders_status_created_at ON orders (status, created_at ASC)
    WHERE status IN ('ready', 'assigned');

-- Agent task lookup: their current/recent orders
CREATE INDEX idx_orders_delivery_agent_id_status ON orders (delivery_agent_id, status)
    WHERE delivery_agent_id IS NOT NULL;
```

**Notes:**
- `public_id` (UUID) is what the API exposes. The internal `id` (bigint) never leaves this service.
- `region` and `country_code` hold the same value at insert time but serve different roles. `region` is the routing column. `country_code` drives `currencyForCountry()` and populates `currency`.
- `delivery_address_snapshot` captures the full address JSON so order history remains coherent if the customer later edits or deletes the address.
- `delivery_lat` / `delivery_lng` are denormalized **out of** `delivery_address_snapshot` so they can be read directly by the auto-assignment query without parsing JSON. They MUST equal the values inside the JSON snapshot — the service writes them in the same INSERT.
- `total = subtotal + delivery_fee + service_fee - discount` — enforced by the service layer before insert.
- `commission` is computed at delivery time (when `delivered_at` is set) and written back to the order row for reporting convenience.
- All list indexes order by `(created_at DESC, id DESC)` so cursor pagination remains deterministic even when two rows share the same `created_at` (the `id` tie-breaker is monotonic).
- **Partitioned table**: PK is `(id, created_at)`. FKs from `order_items`, `payment_sessions`, `transactions`, and `deliveries` to `orders(id)` are logical only (no DB-level FK constraint — see Partitioning section above).

---

### `order_items`

```sql
CREATE TABLE order_items (
    id                  BIGSERIAL   PRIMARY KEY,
    region              TEXT        NOT NULL,
    order_id            BIGINT      NOT NULL,
    product_id          BIGINT      NOT NULL,       -- logical FK → core.products.id
    name_snapshot       TEXT        NOT NULL,        -- snapshot at order time
    image_url_snapshot  TEXT,
    unit_price_snapshot INT         NOT NULL CHECK (unit_price_snapshot >= 0),  -- minor units
    quantity            SMALLINT    NOT NULL CHECK (quantity > 0),
    line_total          INT         NOT NULL CHECK (line_total >= 0),
    -- line_total = unit_price_snapshot * quantity (enforced at app layer)
    notes               TEXT,
    created_at          TIMESTAMP   NOT NULL DEFAULT NOW()
    -- fk_order_items_order: logical only — orders is a partitioned table; see Partitioning section
);

-- Batch fetch all items for one or many orders
CREATE INDEX idx_order_items_order_id ON order_items (order_id);
```

**Notes:**
- Product name, image, and price are snapshotted so order history is stable even after product edits or deletions.
- No index on `product_id` — this service never queries items by product; that is the analytics service's concern.

---

### `payment_sessions`

Tracks every Kashier payment session created for an order. Persisting this to the DB (not just Redis) means:
- Webhook handlers can look up a session by `provider_session_id` directly.
- If Redis is cleared, outstanding sessions are not lost.
- Audit trail of every session attempt (including retries).

```sql
CREATE TABLE payment_sessions (
    id                  BIGSERIAL   NOT NULL,
    region              TEXT        NOT NULL,
    order_id            BIGINT      NOT NULL,        -- logical FK → orders(id); orders is partitioned
    provider_id         INT         NOT NULL REFERENCES payment_providers(id),
    provider_session_id TEXT        NOT NULL,        -- Kashier's session id
    redirect_url        TEXT        NOT NULL,        -- URL returned to client
    amount              INT         NOT NULL,        -- minor units
    currency            CHAR(3)     NOT NULL,
    status              TEXT        NOT NULL DEFAULT 'initialized',
    expires_at          TIMESTAMP   NOT NULL,        -- session timeout (PAYMENT_SESSION_TIMEOUT_MIN, default 15m)
    raw_init_payload    JSONB       NOT NULL,        -- what we sent to Kashier
    raw_last_payload    JSONB,                       -- last webhook payload from Kashier
    created_at          TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at),
    UNIQUE (provider_session_id, created_at),
    CONSTRAINT ck_payment_sessions_status CHECK (status IN (
        'initialized', 'pending', 'authorized', 'captured', 'failed', 'expired', 'cancelled'
    ))
);

CREATE TRIGGER trg_payment_sessions_updated_at
BEFORE UPDATE ON payment_sessions
FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- Webhook lookup: find session by Kashier's session id
CREATE INDEX idx_payment_sessions_provider_session_id ON payment_sessions (provider_session_id);

-- Order detail: find all sessions for an order
CREATE INDEX idx_payment_sessions_order_id ON payment_sessions (order_id);

-- Sweep worker: find expired but un-finalised sessions
CREATE INDEX idx_payment_sessions_expires_at ON payment_sessions (expires_at)
    WHERE status IN ('initialized', 'pending');
```

---

### `payment_webhook_events`

Stores every inbound Kashier webhook event for idempotency and audit. The `UNIQUE (provider_id, provider_event_id)` constraint is the primary dedup mechanism — `INSERT ... ON CONFLICT DO NOTHING` is the idempotency check.

```sql
-- Partitioned by created_at (monthly, 6-month retention). See docs/partitioning.md.
CREATE TABLE payment_webhook_events (
    id                  BIGSERIAL   NOT NULL,
    region              TEXT        NOT NULL,
    provider_id         INT         NOT NULL REFERENCES payment_providers(id),
    provider_event_id   TEXT        NOT NULL,    -- Kashier eventId (unique within provider)
    signature           TEXT        NOT NULL,
    payload             JSONB       NOT NULL,
    processed_at        TIMESTAMP,               -- NULL until successfully processed
    process_error       TEXT,                    -- set if processing threw an error
    created_at          TIMESTAMP   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at),
    -- Per-partition uniqueness; provider_event_id values are unique within a given month in practice
    UNIQUE (provider_id, provider_event_id, created_at)
) PARTITION BY RANGE (created_at);

-- Reconciliation: find unprocessed events
CREATE INDEX idx_payment_webhook_events_unprocessed ON payment_webhook_events (created_at)
    WHERE processed_at IS NULL;
```

---

### `transactions`

The money ledger. Every money movement is one row. Includes charges, COD collections, commissions, refunds, and payouts — no separate `payouts` table needed.

-- Partitioned by created_at (monthly, 24-month retention). See docs/partitioning.md.
CREATE TABLE transactions (
    id                    BIGSERIAL   NOT NULL,
    region                TEXT        NOT NULL,
    order_id              BIGINT,                     -- nullable: payouts may not be tied to a single order
                                                      -- logical FK → orders(id); orders is partitioned
    type                  TEXT        NOT NULL,
    method                TEXT        NOT NULL CHECK (method IN ('online', 'cod', 'bank_transfer', 'system')),
    provider_id           INT         REFERENCES payment_providers(id),
    provider_reference_id TEXT,                       -- Kashier txn id / bank ref
    status                TEXT        NOT NULL DEFAULT 'pending',
    amount                INT         NOT NULL CHECK (amount > 0),  -- always positive; direction encoded by type + src/dst
    currency              CHAR(3)     NOT NULL,
    src_acc_id            BIGINT,                     -- NULL = source is the platform (QuickBite)
    dst_acc_id            BIGINT,                     -- NULL = destination is the platform (QuickBite)
    is_refunded           BOOLEAN     NOT NULL DEFAULT false,
    refunded_payment_id   BIGINT,                     -- logical self-ref: charge row that was refunded
    idempotency_key       TEXT,                       -- for webhook event dedup at txn level
    metadata              JSONB       NOT NULL DEFAULT '{}',
    created_at            TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMP   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at),
    UNIQUE (idempotency_key, created_at),
    CONSTRAINT ck_transactions_type CHECK (type IN (
        'charge', 'cod_collection', 'commission', 'refund', 'payout', 'adjustment'
    )),
    CONSTRAINT ck_transactions_status CHECK (status IN ('pending', 'succeeded', 'failed', 'reversed')),
    CONSTRAINT ck_transactions_account_present
        CHECK (src_acc_id IS NOT NULL OR dst_acc_id IS NOT NULL)
) PARTITION BY RANGE (created_at);

CREATE TRIGGER trg_transactions_updated_at
BEFORE UPDATE ON transactions
FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- Order detail: show payment status
CREATE INDEX idx_transactions_order_id ON transactions (order_id)
    WHERE order_id IS NOT NULL;

-- Webhook processing: lookup by provider reference
CREATE INDEX idx_transactions_provider_reference_id ON transactions (provider_reference_id)
    WHERE provider_reference_id IS NOT NULL;

-- Restaurant payout history
CREATE INDEX idx_transactions_dst_acc_type ON transactions (dst_acc_id, type, created_at DESC)
    WHERE type = 'payout';

-- Admin finance reconciliation
CREATE INDEX idx_transactions_type_status ON transactions (type, status, created_at DESC);
```

**`src_acc_id` / `dst_acc_id` semantics:**

`NULL` means **the platform** is the party on that side. `ck_transactions_account_present` guarantees at least one side is non-null.

| Type | src_acc_id | dst_acc_id |
|---|---|---|
| `charge` (online) | customer `users.id` | NULL (platform) |
| `cod_collection` | customer `users.id` | NULL (platform) |
| `commission` | restaurant owner `users.id` | NULL (platform) |
| `refund` | NULL (platform pays) | customer `users.id` |
| `payout` | NULL (platform pays) | restaurant owner `users.id` |
| `adjustment` | varies | varies |

> **Idempotency**: webhook dedup is primarily handled by `payment_webhook_events(provider_id, provider_event_id)`. The `idempotency_key` column on `transactions` provides a secondary dedup layer for programmatic inserts (e.g., retried payout requests).

---

### `restaurant_balances`

One row per (restaurant, currency). Composite PK eliminates the need for a separate unique constraint and is the natural lookup key.

```sql
CREATE TABLE restaurant_balances (
    restaurant_id     BIGINT      NOT NULL,   -- logical FK → core.restaurants.id
    region            TEXT        NOT NULL,
    currency          CHAR(3)     NOT NULL,
    available_balance INT         NOT NULL DEFAULT 0 CHECK (available_balance >= 0),  -- ready for payout
    pending_balance   INT         NOT NULL DEFAULT 0 CHECK (pending_balance >= 0),    -- credited on payment; released on delivery
    total_earned      INT         NOT NULL DEFAULT 0 CHECK (total_earned >= 0),       -- running total; never decremented
    created_at        TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMP   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (restaurant_id, currency)
);

CREATE TRIGGER trg_restaurant_balances_updated_at
BEFORE UPDATE ON restaurant_balances
FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- Single-row lookup by restaurant is the only hot read; PK covers it.
-- No additional indexes needed.
```

**Balance lifecycle:**
1. Online payment confirmed (Kashier webhook): `pending_balance += order.subtotal`, `total_earned += order.subtotal`.
2. COD order delivered: same — credited at delivery confirmation instead of at payment.
3. Order `delivered`: move earning from pending to available: `available_balance += delta`, `pending_balance -= delta`.
4. Payout (admin-initiated): `available_balance -= payout.amount`.

`creditRestaurantBalance` uses `INSERT ... ON CONFLICT (restaurant_id, currency) DO UPDATE` for atomicity — no separate `SELECT ... FOR UPDATE` is needed.

---

### `deliveries`

Per-order delivery record. Created when an order is assigned to an agent. A new row is created on each reassignment — never mutated — giving a full audit trail.

-- Partitioned by assigned_at (monthly, 24-month retention). See docs/partitioning.md.
CREATE TABLE deliveries (
    id              BIGSERIAL       NOT NULL,
    region          TEXT            NOT NULL,
    order_id        BIGINT          NOT NULL,        -- logical FK → orders(id); orders is partitioned
    agent_id        BIGINT          NOT NULL,        -- logical FK → core.users.id (delivery_agent role)
    status          TEXT            NOT NULL DEFAULT 'assigned',
    pickup_lat      DECIMAL(10,7)   NOT NULL,        -- branch coords at assignment time
    pickup_lng      DECIMAL(10,7)   NOT NULL,
    dropoff_lat     DECIMAL(10,7)   NOT NULL,
    dropoff_lng     DECIMAL(10,7)   NOT NULL,
    distance_meters INT,
    earning_amount  INT,                             -- minor units; set at delivered
    currency        CHAR(3)         NOT NULL,
    assigned_at     TIMESTAMP       NOT NULL DEFAULT NOW(),
    accepted_at     TIMESTAMP,
    rejected_at     TIMESTAMP,
    picked_at       TIMESTAMP,
    delivered_at    TIMESTAMP,
    reassigned_at   TIMESTAMP,
    reassigned_from BIGINT,                          -- logical self-ref: previous delivery row on reassignment
    PRIMARY KEY (id, assigned_at),
    CONSTRAINT ck_deliveries_status CHECK (status IN (
        'assigned', 'accepted', 'rejected', 'picked', 'delivered', 'cancelled', 'reassigned'
    ))
) PARTITION BY RANGE (assigned_at);

-- Agent task list: GET /agents/tasks?status=
CREATE INDEX idx_deliveries_agent_id_status ON deliveries (agent_id, status, assigned_at DESC);

-- Order → delivery lookup (latest active delivery)
CREATE INDEX idx_deliveries_order_id ON deliveries (order_id);

-- Reassignment chain traversal
CREATE INDEX idx_deliveries_reassigned_from ON deliveries (reassigned_from)
    WHERE reassigned_from IS NOT NULL;

-- At most one active delivery row per order at any time (within each partition).
-- The application layer enforces this globally; the index is the last line of defense
-- within a partition (the partition key assigned_at must be included).
CREATE UNIQUE INDEX uq_deliveries_active_per_order ON deliveries (order_id, assigned_at)
    WHERE status IN ('assigned', 'accepted', 'picked');
```

**Notes:**
- Reassignment creates a **new** row with `reassigned_from = old_id` and marks the old row `status = 'reassigned'`. This preserves a full audit chain without destructive updates.
- `orders.delivery_agent_id` is a denormalized pointer to the **current** assigned agent for fast lookups; it is updated whenever a new delivery row is created.
- `uq_deliveries_active_per_order` is a partial unique index — it allows many `delivered`, `cancelled`, `rejected`, `reassigned` rows per order but blocks a second concurrent active row within the same partition. The application layer still checks first for a friendly 409 and also enforces the cross-partition guarantee.
- **Partitioned table**: PK is `(id, assigned_at)`. The self-reference `reassigned_from` and the FK to `orders(id)` are logical only (no DB-level constraint).
- **FK from `agent_earnings`**: `agent_earnings.delivery_id → deliveries(id)` remains a real DB-level FK because `agent_earnings` is not partitioned.

---

### `agent_presence`

Tracks delivery agents that are online and their last known location. PostGIS `GEOGRAPHY` column is generated from lat/lng so they are never out of sync.

```sql
-- Requires PostGIS extension on each cluster
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE agent_presence (
    agent_id        BIGINT          PRIMARY KEY,    -- logical FK → core.users.id; one row per agent
    region          TEXT            NOT NULL,
    is_online       BOOLEAN         NOT NULL DEFAULT false,
    is_available    BOOLEAN         NOT NULL DEFAULT false,
    last_lat        DECIMAL(10,7),
    last_lng        DECIMAL(10,7),
    last_seen_at    TIMESTAMP       NOT NULL DEFAULT NOW(),
    -- generated column: always consistent with last_lat / last_lng
    location        GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (
                        ST_MakePoint(last_lng::float, last_lat::float)::geography
                    ) STORED,
    updated_at      TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_agent_presence_updated_at
BEFORE UPDATE ON agent_presence
FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- Postgres GIST fallback for assignment when Redis geo set is empty/cold
CREATE INDEX idx_agent_presence_location_gist ON agent_presence USING GIST (location)
    WHERE is_online = true AND is_available = true;

-- Cleanup: find stale online agents
CREATE INDEX idx_agent_presence_last_seen_at ON agent_presence (last_seen_at)
    WHERE is_online = true;
```

**Notes:**
- One row per agent, upserted on every presence ping: `INSERT ... ON CONFLICT (agent_id) DO UPDATE SET ...`.
- Redis geo set (`presence:geo:{region}`) is the primary read path for auto-assignment. This table is the durable source of truth and the cold-start / Redis-down fallback.
- The generated `location` column eliminates the need to manually keep a separate geography column in sync with lat/lng updates.
- A reconciliation worker runs every 60s and removes agents from the Redis geo set whose `last_seen_at` is older than `PRESENCE_STALE_SEC` (env, default 90s).

---

### `agent_earnings`

A per-delivery snapshot for agent earnings reporting. Linked to `deliveries` (not just `order_id`) so reassignment scenarios don't create ambiguity about which delivery earned what.

```sql
CREATE TABLE agent_earnings (
    id              BIGSERIAL   PRIMARY KEY,
    region          TEXT        NOT NULL,
    agent_id        BIGINT      NOT NULL,   -- logical FK → core.users.id
    order_id        BIGINT      NOT NULL,
    delivery_id     BIGINT      NOT NULL,   -- FK to deliveries (the specific row that completed)
    amount          INT         NOT NULL CHECK (amount > 0),
    currency        CHAR(3)     NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'pending',
    paid_at         TIMESTAMP,
    created_at      TIMESTAMP   NOT NULL DEFAULT NOW(),
    -- fk_agent_earnings_order: logical only — orders is a partitioned table
    -- fk_agent_earnings_delivery: logical only — deliveries is a partitioned table
    CONSTRAINT ck_agent_earnings_status CHECK (status IN ('pending', 'paid')),
    CONSTRAINT uq_agent_earnings_delivery UNIQUE (delivery_id)
);

-- Agent earnings history (cursor pagination)
CREATE INDEX idx_agent_earnings_agent_id ON agent_earnings (agent_id, status, created_at DESC);

-- Pending payout list
CREATE INDEX idx_agent_earnings_status ON agent_earnings (status)
    WHERE status = 'pending';
```

**Notes:**
- Inserted in the same transaction as `deliveries.status = 'delivered'`. The `UNIQUE (delivery_id)` constraint makes the insert idempotent on retries.
- Linking to `delivery_id` rather than just `order_id` means if an order is reassigned, only the completing delivery row gets an earnings record — not the rejected one.
- FKs to `orders` and `deliveries` are logical only because both parent tables are partitioned. The application layer guarantees the referenced rows exist before inserting an earnings record.

---

### `idempotency_keys`

DB-level fallback for HTTP idempotency on money-critical write paths. Redis handles the hot path (fast lookup); this table is the source of truth if Redis is cleared or evicts the key.

```sql
CREATE TABLE idempotency_keys (
    key_hash            BYTEA       PRIMARY KEY,    -- sha256 of (userId + method + path + idempotency-key header)
    region              TEXT        NOT NULL,
    user_id             BIGINT      NOT NULL,
    request_fingerprint BYTEA       NOT NULL,        -- sha256 of request body (for conflict detection)
    response_status     INT         NOT NULL,
    response_body       JSONB       NOT NULL,
    created_at          TIMESTAMP   NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMP   NOT NULL         -- 24h from created_at
);

-- TTL cleanup job
CREATE INDEX idx_idempotency_keys_expires_at ON idempotency_keys (expires_at);
```

**Usage**: only applied on `POST /orders` and `POST /payments/init`. On a Redis miss, look up by `key_hash`. If the stored `request_fingerprint` does not match the current request body hash → return 409 `IdempotencyConflict`. If it matches → replay `response_body` with `response_status`.

---

## Migration File Order

Run in this sequence. Each file is a separate Knex migration targeting a single unit. Run against each cluster explicitly:

```
REGION=eg   CLUSTER=hot npm run migrate
REGION=ksa  CLUSTER=hot npm run migrate
```

```
 1. {ts}_create_fn_update_updated_at.ts         (shared trigger function — must run first)
 2. {ts}_enable_pg_partman.ts                   (CREATE SCHEMA partman; CREATE EXTENSION pg_partman)
 3. {ts}_create_payment_providers.ts            (table + seed; not partitioned)
 4. {ts}_create_orders.ts                       (partitioned by created_at)
 5. {ts}_create_order_items.ts
 6. {ts}_create_payment_sessions.ts             (partitioned by created_at)
 7. {ts}_create_payment_webhook_events.ts       (partitioned by created_at)
 8. {ts}_create_transactions.ts                 (partitioned by created_at)
 9. {ts}_create_restaurant_balances.ts
10. {ts}_create_deliveries.ts                   (partitioned by assigned_at)
11. {ts}_create_agent_presence.ts               (also enables PostGIS extension)
12. {ts}_create_agent_earnings.ts
13. {ts}_create_idempotency_keys.ts
```

---

## Entity-Relationship Summary

```
payment_providers
    ├── payment_sessions.provider_id
    ├── payment_webhook_events.provider_id
    └── transactions.provider_id

orders ──────────────────────────────────────────────
    │ 1..N  order_items              (cascade delete)
    │ 1..N  payment_sessions
    │ 1..N  transactions
    │ 1..N  deliveries
    │           └── 1..1  agent_earnings (on delivery_id)
    │           └── 0..1  deliveries    (reassigned_from self-ref)
    │ transactions (self-ref via refunded_payment_id)

agent_presence   (one row per agent; PK = agent_id)

restaurant_balances  (one row per (restaurant_id, currency); PK = composite)
```

---

## Data Integrity Rules

| Rule | Enforcement |
|---|---|
| `total = subtotal + delivery_fee + service_fee - discount` | App layer (service before insert) |
| `line_total = unit_price_snapshot * quantity` | App layer (repo insert) |
| Order items cannot be updated after insert | App layer (no update path exists) |
| Transaction `succeeded`/`failed` are terminal states | App layer (status transition guard) |
| Agent can only accept order if `is_available = true` | App layer (service) |
| One earnings record per delivery | `UNIQUE (delivery_id)` on `agent_earnings` |
| One balance record per (restaurant, currency) | Composite `PRIMARY KEY (restaurant_id, currency)` |
| At most one active delivery per order | App layer (global, cross-partition) + partial `UNIQUE INDEX uq_deliveries_active_per_order` on `deliveries (order_id, assigned_at) WHERE status IN ('assigned','accepted','picked')` (within-partition guard) |
| Webhook idempotency (primary) | `UNIQUE (provider_id, provider_event_id, created_at)` on `payment_webhook_events` (per-partition; app layer handles cross-partition dedup on redelivery via `core-events:dedupe:{eventId}` Redis key) |
| Webhook → transaction idempotency (secondary) | `UNIQUE (idempotency_key, created_at)` on `transactions` — also covers admin-initiated payouts and refunds keyed by the HTTP `Idempotency-Key` header |
| At least one party on every transaction | `CHECK (src_acc_id IS NOT NULL OR dst_acc_id IS NOT NULL)` |
| Payment session has a hard expiry | `payment_sessions.expires_at NOT NULL` — sweep worker drives it |
| Currency snapshotted at write time | App layer — `currencyForCountry(countryCode)` → `orders.currency`; downstream rows copy verbatim |
| Status values are restricted | TEXT + CHECK constraints on each table |
| `location` is always consistent with lat/lng | Generated column — Postgres maintains it automatically |
| `pending_payment` orders older than 15 min are auto-cancelled | Background sweep worker (not a DB constraint) |
