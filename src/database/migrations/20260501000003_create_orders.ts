import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    // Shared trigger function used by all mutable tables
    await knex.raw(`
        CREATE OR REPLACE FUNCTION fn_update_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    `);

    await knex.raw(`
        CREATE TABLE orders (
            id                          BIGSERIAL       NOT NULL,
            country_code                CHAR(2)         NOT NULL,
            customer_id                 BIGINT          NOT NULL,
            restaurant_id               BIGINT          NOT NULL,
            branch_id                   BIGINT          NOT NULL,
            delivery_address_id         BIGINT          NOT NULL,
            delivery_address_snapshot   JSONB           NOT NULL,
            delivery_agent_id           BIGINT,
            status                      order_status    NOT NULL DEFAULT 'pending',
            payment_method              payment_method  NOT NULL,
            items_total                 INT             NOT NULL CHECK (items_total >= 0),
            delivery_fee                INT             NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
            discount                    INT             NOT NULL DEFAULT 0 CHECK (discount >= 0),
            total_amount                INT             NOT NULL CHECK (total_amount >= 0),
            notes                       TEXT,
            estimated_delivery_at       TIMESTAMP,
            delivery_started_at         TIMESTAMP,
            delivered_at                TIMESTAMP,
            cancelled_at                TIMESTAMP,
            cancellation_reason         TEXT,
            created_at                  TIMESTAMP       NOT NULL,
            updated_at                  TIMESTAMP       NOT NULL,
            PRIMARY KEY (id, country_code)
        )
    `);

    // Customer viewing their order history
    await knex.raw(`
        CREATE INDEX idx_orders_customer_id
        ON orders(customer_id, country_code)
    `);

    // Restaurant dashboard: filter by branch + status
    await knex.raw(`
        CREATE INDEX idx_orders_branch_id_status
        ON orders(branch_id, status, country_code)
    `);

    // Delivery agent: their active assigned orders
    await knex.raw(`
        CREATE INDEX idx_orders_delivery_agent_id
        ON orders(delivery_agent_id, country_code)
        WHERE delivery_agent_id IS NOT NULL
    `);

    // Agent browsing available unassigned orders
    await knex.raw(`
        CREATE INDEX idx_orders_status_no_agent
        ON orders(status, country_code)
        WHERE delivery_agent_id IS NULL AND status = 'ready_for_pickup'
    `);

    // Cursor pagination on customer order history sorted by created_at
    await knex.raw(`
        CREATE INDEX idx_orders_customer_created_at
        ON orders(customer_id, created_at DESC, country_code)
    `);

    await knex.raw(`
        CREATE TRIGGER trg_orders_updated_at
        BEFORE UPDATE ON orders
        FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at()
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TABLE IF EXISTS orders`);
    // Safe to drop here because all tables with triggers referencing this function
    // (transactions, restaurant_balances) are dropped in later down() calls first
    await knex.raw(`DROP FUNCTION IF EXISTS fn_update_updated_at()`);
}
