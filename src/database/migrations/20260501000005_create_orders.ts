import type { Knex } from 'knex';

// Partitioned by created_at (monthly, 24-month retention).
// Composite PK (id, created_at) required: PostgreSQL demands the partition key in every
// unique constraint. BIGSERIAL still produces globally monotonic values across partitions.
// public_id (UUID) is the only ID exposed to clients; internal bigint id never leaves the service.
// FKs from child tables (order_items, transactions, deliveries) to orders are logical only —
// DB-level FKs cannot reference a partitioned table without the partition key in the FK.
export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE orders (
            id                        BIGSERIAL     NOT NULL,
            region                    TEXT          NOT NULL,
            public_id                 UUID          NOT NULL DEFAULT gen_random_uuid(),
            country_code              TEXT          NOT NULL,
            customer_id               BIGINT        NOT NULL,
            restaurant_id             BIGINT        NOT NULL,
            branch_id                 BIGINT        NOT NULL,
            delivery_address_id       BIGINT        NOT NULL,
            delivery_lat              DECIMAL(10,7) NOT NULL,
            delivery_lng              DECIMAL(10,7) NOT NULL,
            delivery_address_snapshot JSONB         NOT NULL,
            delivery_agent_id         BIGINT,
            status                    TEXT          NOT NULL DEFAULT 'pending_payment',
            payment_method            TEXT          NOT NULL,
            subtotal                  INT           NOT NULL CHECK (subtotal >= 0),
            delivery_fee              INT           NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
            service_fee               INT           NOT NULL DEFAULT 0 CHECK (service_fee >= 0),
            discount                  INT           NOT NULL DEFAULT 0 CHECK (discount >= 0),
            commission                INT           NOT NULL DEFAULT 0 CHECK (commission >= 0),
            total                     INT           NOT NULL CHECK (total >= 0),
            currency                  CHAR(3)       NOT NULL,
            notes                     TEXT,
            estimated_delivery_at     TIMESTAMP,
            accepted_at               TIMESTAMP,
            rejected_at               TIMESTAMP,
            ready_at                  TIMESTAMP,
            assigned_at               TIMESTAMP,
            picked_at                 TIMESTAMP,
            delivered_at              TIMESTAMP,
            cancelled_at              TIMESTAMP,
            cancellation_reason       TEXT,
            created_at                TIMESTAMP     NOT NULL DEFAULT NOW(),
            updated_at                TIMESTAMP     NOT NULL DEFAULT NOW(),
            PRIMARY KEY (id, created_at),
            UNIQUE (public_id, created_at),
            CONSTRAINT ck_orders_status CHECK (status IN (
                'pending_payment', 'placed', 'accepted', 'rejected',
                'preparing', 'ready', 'assigned', 'picked', 'delivered', 'cancelled'
            )),
            CONSTRAINT ck_orders_payment_method CHECK (payment_method IN ('online', 'cod'))
        ) PARTITION BY RANGE (created_at)
    `);

    await knex.raw(`
        SELECT partman.create_parent(
            p_parent_table    => 'public.orders',
            p_control         => 'created_at',
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
        WHERE parent_table = 'public.orders'
    `);

    // Indexes and trigger on the parent propagate to all existing and future partitions (PG11+/PG13+).

    // Client and gateway lookup by public UUID
    await knex.raw(`CREATE INDEX idx_orders_public_id ON orders (public_id)`);

    // Customer viewing their order history (cursor pagination by (created_at DESC, id DESC) tuple)
    await knex.raw(`
        CREATE INDEX idx_orders_customer_id_created_at
        ON orders (customer_id, created_at DESC, id DESC)
    `);

    // Restaurant dashboard: orders by branch + status
    await knex.raw(`
        CREATE INDEX idx_orders_branch_id_status
        ON orders (branch_id, status, created_at DESC, id DESC)
    `);

    // Auto-assignment scan: ready/assigned orders sorted FIFO
    await knex.raw(`
        CREATE INDEX idx_orders_status_created_at
        ON orders (status, created_at ASC)
        WHERE status IN ('ready', 'assigned')
    `);

    // Agent task lookup: their current/recent orders
    await knex.raw(`
        CREATE INDEX idx_orders_delivery_agent_id_status
        ON orders (delivery_agent_id, status)
        WHERE delivery_agent_id IS NOT NULL
    `);

    await knex.raw(`
        CREATE TRIGGER trg_orders_updated_at
        BEFORE UPDATE ON orders
        FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at()
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TABLE IF EXISTS orders CASCADE`);
}
