import type { Knex } from 'knex';

// Partitioned by created_at (monthly, 24-month retention).
// FK to orders is logical only — orders is a partitioned table.
// idempotency_key provides a secondary dedup layer for programmatic inserts (retried payouts,
// refunds). Primary webhook dedup is handled by payment_webhook_events.
// src_acc_id / dst_acc_id: NULL means the platform (QuickBite) is the party on that side.
// ck_transactions_account_present guarantees at least one side is non-null.
export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE transactions (
            id                    BIGSERIAL NOT NULL,
            region                TEXT      NOT NULL,
            order_id              BIGINT,
            type                  TEXT      NOT NULL,
            method                TEXT      NOT NULL,
            provider_id           INT       REFERENCES payment_providers(id),
            provider_reference_id TEXT,
            status                TEXT      NOT NULL DEFAULT 'pending',
            amount                INT       NOT NULL CHECK (amount > 0),
            currency              CHAR(3)   NOT NULL,
            src_acc_id            BIGINT,
            dst_acc_id            BIGINT,
            is_refunded           BOOLEAN   NOT NULL DEFAULT false,
            refunded_payment_id   BIGINT,
            idempotency_key       TEXT,
            metadata              JSONB     NOT NULL DEFAULT '{}',
            created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
            PRIMARY KEY (id, created_at),
            UNIQUE (idempotency_key, created_at),
            CONSTRAINT ck_transactions_type CHECK (type IN (
                'charge', 'cod_collection', 'commission', 'refund', 'payout', 'adjustment'
            )),
            CONSTRAINT ck_transactions_method CHECK (method IN (
                'online', 'cod', 'bank_transfer', 'system'
            )),
            CONSTRAINT ck_transactions_status CHECK (status IN (
                'pending', 'succeeded', 'failed', 'reversed'
            )),
            CONSTRAINT ck_transactions_account_present
                CHECK (src_acc_id IS NOT NULL OR dst_acc_id IS NOT NULL)
        ) PARTITION BY RANGE (created_at)
    `);

    await knex.raw(`
        SELECT partman.create_parent(
            p_parent_table    => 'public.transactions',
            p_control         => 'created_at',
            p_interval        => 'monthly',
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
        WHERE parent_table = 'public.transactions'
    `);

    // Order detail: show payment status
    await knex.raw(`
        CREATE INDEX idx_transactions_order_id ON transactions (order_id)
        WHERE order_id IS NOT NULL
    `);

    // Webhook processing: lookup by provider reference
    await knex.raw(`
        CREATE INDEX idx_transactions_provider_reference_id ON transactions (provider_reference_id)
        WHERE provider_reference_id IS NOT NULL
    `);

    // Restaurant payout history
    await knex.raw(`
        CREATE INDEX idx_transactions_dst_acc_type
        ON transactions (dst_acc_id, type, created_at DESC)
        WHERE type = 'payout'
    `);

    // Admin finance reconciliation
    await knex.raw(`
        CREATE INDEX idx_transactions_type_status
        ON transactions (type, status, created_at DESC)
    `);

    await knex.raw(`
        CREATE TRIGGER trg_transactions_updated_at
        BEFORE UPDATE ON transactions
        FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at()
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TABLE IF EXISTS transactions CASCADE`);
}
