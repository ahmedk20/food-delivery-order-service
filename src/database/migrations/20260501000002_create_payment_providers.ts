import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE payment_providers (
            id            SMALLSERIAL   PRIMARY KEY,
            name          TEXT          NOT NULL UNIQUE,
            display_name  TEXT          NOT NULL,
            is_active     BOOLEAN       NOT NULL DEFAULT true,
            config        JSONB         NOT NULL DEFAULT '{}',
            created_at    TIMESTAMP     NOT NULL,
            updated_at    TIMESTAMP     NOT NULL
        )
    `);

    await knex.raw(`
        INSERT INTO payment_providers (name, display_name, is_active, config, created_at, updated_at)
        VALUES ('kashier', 'Kashier', true, '{}', NOW(), NOW())
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TABLE IF EXISTS payment_providers`);
}
