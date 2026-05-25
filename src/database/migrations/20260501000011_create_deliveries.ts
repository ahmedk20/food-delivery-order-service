import type { Knex } from 'knex';

// Partitioned by assigned_at (monthly, 24-month retention).
// Composite PK (id, assigned_at) required: PostgreSQL demands the partition key in every
// unique constraint. BIGSERIAL still produces globally monotonic values across partitions.
// FK to orders is logical only — orders is partitioned; DB-level FK would require partition key.
// FK to agent is logical only — agent lives in core service DB.
// uq_deliveries_active_per_order is per-partition only; the service layer enforces the
// global (cross-partition) single-active-delivery guarantee before inserting.
export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE deliveries (
            id               BIGSERIAL         NOT NULL,
            region           TEXT              NOT NULL,
            order_id         BIGINT            NOT NULL,
            agent_id         BIGINT            NOT NULL,
            status           TEXT              NOT NULL DEFAULT 'assigned',
            pickup_lat       DOUBLE PRECISION,
            pickup_lng       DOUBLE PRECISION,
            dropoff_lat      DOUBLE PRECISION,
            dropoff_lng      DOUBLE PRECISION,
            distance_meters  INT,
            earning_amount   INT,
            currency         CHAR(3),
            reassigned_from  BIGINT,
            assigned_at      TIMESTAMP         NOT NULL DEFAULT NOW(),
            accepted_at      TIMESTAMP,
            rejected_at      TIMESTAMP,
            picked_at        TIMESTAMP,
            delivered_at     TIMESTAMP,
            cancelled_at     TIMESTAMP,
            reassigned_at    TIMESTAMP,
            rejection_reason TEXT,
            created_at       TIMESTAMP         NOT NULL DEFAULT NOW(),
            updated_at       TIMESTAMP         NOT NULL DEFAULT NOW(),
            CONSTRAINT ck_deliveries_status CHECK (
                status IN ('assigned', 'accepted', 'rejected', 'picked', 'delivered', 'cancelled', 'reassigned')
            ),
            PRIMARY KEY (id, assigned_at)
        ) PARTITION BY RANGE (assigned_at)
    `);

    await knex.raw(`
        SELECT partman.create_parent(
            p_parent_table    => 'public.deliveries',
            p_control         => 'assigned_at',
            p_interval        => '1 month',
            p_premake         => 4,
            p_start_partition => to_char(NOW() - INTERVAL '1 month', 'YYYY-MM-01')
        )
    `);

    await knex.raw(`
        UPDATE partman.part_config
        SET
            retention            = '24 months',
            retention_keep_table = false,
            premake              = 4
        WHERE parent_table = 'public.deliveries'
    `);

    // Indexes on the parent propagate to all partitions (PG11+).

    // Partial unique index: enforce single active delivery per order within each partition.
    // Application layer checks across all partitions before inserting (cross-partition guarantee).
    await knex.raw(`
        CREATE UNIQUE INDEX uq_deliveries_active_per_order
        ON deliveries (order_id, assigned_at)
        WHERE status IN ('assigned', 'accepted', 'picked')
    `);

    // FK-like index for looking up deliveries by order
    await knex.raw(`
        CREATE INDEX idx_deliveries_order_id ON deliveries (order_id)
    `);

    // Agent task list query (cursor-paginated by assigned_at DESC)
    await knex.raw(`
        CREATE INDEX idx_deliveries_agent_id_status
        ON deliveries (agent_id, status, assigned_at DESC)
    `);

    // Active-delivery filter (excludes terminal rows from full scans)
    await knex.raw(`
        CREATE INDEX idx_deliveries_status_active
        ON deliveries (status)
        WHERE status NOT IN ('delivered', 'rejected', 'cancelled', 'reassigned')
    `);

    await knex.raw(`
        CREATE TRIGGER trg_deliveries_updated_at
        BEFORE UPDATE ON deliveries
        FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at()
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TABLE IF EXISTS deliveries CASCADE`);
}
