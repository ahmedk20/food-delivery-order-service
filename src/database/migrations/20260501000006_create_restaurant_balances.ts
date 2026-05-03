import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE restaurant_balances (
            id                BIGSERIAL   NOT NULL,
            country_code      CHAR(2)     NOT NULL,
            restaurant_id     BIGINT      NOT NULL,
            available_balance INT         NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
            pending_balance   INT         NOT NULL DEFAULT 0 CHECK (pending_balance >= 0),
            total_earned      INT         NOT NULL DEFAULT 0 CHECK (total_earned >= 0),
            currency          CHAR(3)     NOT NULL DEFAULT 'EGP',
            created_at        TIMESTAMP   NOT NULL,
            updated_at        TIMESTAMP   NOT NULL,
            PRIMARY KEY (id, country_code),
            CONSTRAINT uq_restaurant_balances_restaurant
                UNIQUE (restaurant_id, country_code)
        )
    `);

    // Primary lookup: balance reads always go by restaurant_id + country_code
    await knex.raw(`
        CREATE INDEX idx_restaurant_balances_restaurant_id
        ON restaurant_balances(restaurant_id, country_code)
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
