import type { Knex } from 'knex';

// Plain reference table — replicated identically to every per-region cluster via migration.
// No Citus create_reference_table call; migrations run per-shard explicitly.
export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE payment_providers (
            id            INT       PRIMARY KEY,
            name          TEXT      NOT NULL UNIQUE,
            display_name  TEXT      NOT NULL,
            is_enabled    BOOLEAN   NOT NULL DEFAULT true,
            priority      SMALLINT  NOT NULL DEFAULT 100,
            created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
        )
    `);

    await knex.raw(`
        CREATE TRIGGER trg_payment_providers_updated_at
        BEFORE UPDATE ON payment_providers
        FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at()
    `);

    await knex.raw(`
        INSERT INTO payment_providers (id, name, display_name, is_enabled, priority)
        VALUES
            (1, 'kashier', 'Kashier',          true, 10),
            (2, 'cod',     'Cash on Delivery', true, 20)
        ON CONFLICT (id) DO NOTHING
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TABLE IF EXISTS payment_providers`);
}
