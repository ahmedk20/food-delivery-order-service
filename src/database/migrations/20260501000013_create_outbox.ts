import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE outbox (
            id             BIGSERIAL    PRIMARY KEY,
            region         TEXT         NOT NULL,
            event_type     TEXT         NOT NULL,
            aggregate_id   TEXT         NOT NULL,
            payload        JSONB        NOT NULL,
            attempts       SMALLINT     NOT NULL DEFAULT 0,
            last_error     TEXT,
            dispatched_at  TIMESTAMP,
            created_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
            CONSTRAINT ck_outbox_attempts CHECK (attempts >= 0)
        )
    `);

    await knex.raw(`
        CREATE INDEX idx_outbox_pending ON outbox (created_at ASC)
            WHERE dispatched_at IS NULL
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TABLE IF EXISTS outbox CASCADE`);
}
