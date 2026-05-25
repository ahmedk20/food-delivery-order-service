import type { Knex } from 'knex';

// Partitioned by created_at (monthly, 6-month retention).
// UNIQUE (provider_id, provider_event_id, created_at) is the primary webhook dedup mechanism
// within a partition. Cross-partition dedup on redelivery uses the
// core-events:dedupe:{eventId} Redis key (TTL 24h).
export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE payment_webhook_events (
            id                BIGSERIAL NOT NULL,
            region            TEXT      NOT NULL,
            provider_id       INT       NOT NULL REFERENCES payment_providers(id),
            provider_event_id TEXT      NOT NULL,
            signature         TEXT      NOT NULL,
            payload           JSONB     NOT NULL,
            processed_at      TIMESTAMP,
            process_error     TEXT,
            created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
            PRIMARY KEY (id, created_at),
            UNIQUE (provider_id, provider_event_id, created_at)
        ) PARTITION BY RANGE (created_at)
    `);

    await knex.raw(`
        SELECT partman.create_parent(
            p_parent_table    => 'public.payment_webhook_events',
            p_control         => 'created_at',
            p_interval        => '1 month',
            p_premake         => 4,
            p_start_partition => to_char(NOW() - INTERVAL '1 month', 'YYYY-MM-01')
        )
    `);

    await knex.raw(`
        UPDATE partman.part_config
        SET
            retention            = '6 months',
            retention_keep_table = false,
            premake              = 4
        WHERE parent_table = 'public.payment_webhook_events'
    `);

    // Index on parent propagates to all existing and future partitions (PG11+).
    await knex.raw(`
        CREATE INDEX idx_payment_webhook_events_unprocessed
        ON payment_webhook_events (created_at)
        WHERE processed_at IS NULL
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TABLE IF EXISTS payment_webhook_events CASCADE`);
}
