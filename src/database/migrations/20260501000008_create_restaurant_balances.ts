import type { Knex } from 'knex';

// Composite PK (restaurant_id, currency) — no surrogate id column.
// One row per (restaurant, currency). A restaurant operating in multiple regions with
// different currencies will have one row per currency.
// pending_balance: credited on payment confirmed; moved to available_balance on delivery.
// available_balance: eligible for payout. Decremented on admin-initiated payout.
// total_earned: running total, never decremented.
// restaurant_id is a logical FK to core.restaurants.id (no DB-level constraint).
export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE restaurant_balances (
            restaurant_id     BIGINT    NOT NULL,
            region            TEXT      NOT NULL,
            currency          CHAR(3)   NOT NULL,
            available_balance INT       NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
            pending_balance   INT       NOT NULL DEFAULT 0 CHECK (pending_balance >= 0),
            total_earned      INT       NOT NULL DEFAULT 0 CHECK (total_earned >= 0),
            created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at        TIMESTAMP NOT NULL DEFAULT NOW(),
            PRIMARY KEY (restaurant_id, currency)
        )
    `);

    await knex.raw(`
        CREATE TRIGGER trg_restaurant_balances_updated_at
        BEFORE UPDATE ON restaurant_balances
        FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at()
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TABLE IF EXISTS restaurant_balances`);
}
