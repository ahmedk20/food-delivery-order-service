import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE transactions (
            id                  BIGSERIAL           NOT NULL,
            country_code        CHAR(2)             NOT NULL,
            order_id            BIGINT,
            src_acc_id          BIGINT,
            dst_acc_id          BIGINT              NOT NULL,
            amount              INT                 NOT NULL CHECK (amount > 0),
            currency            CHAR(3)             NOT NULL DEFAULT 'EGP',
            type                transaction_type    NOT NULL,
            status              transaction_status  NOT NULL DEFAULT 'pending',
            payment_provider_id SMALLINT,
            external_reference  TEXT,
            kashier_order_id    TEXT,
            metadata            JSONB               NOT NULL DEFAULT '{}',
            idempotency_key     TEXT,
            created_at          TIMESTAMP           NOT NULL,
            updated_at          TIMESTAMP           NOT NULL,
            PRIMARY KEY (id, country_code),
            CONSTRAINT fk_transactions_order
                FOREIGN KEY (order_id, country_code) REFERENCES orders(id, country_code),
            CONSTRAINT fk_transactions_payment_provider
                FOREIGN KEY (payment_provider_id) REFERENCES payment_providers(id),
            CONSTRAINT uq_transactions_idempotency
                UNIQUE (idempotency_key, country_code)
        )
    `);

    // Payment status shown on order detail page
    await knex.raw(`
        CREATE INDEX idx_transactions_order_id
        ON transactions(order_id, country_code)
        WHERE order_id IS NOT NULL
    `);

    // Kashier webhook processing and refund lookups
    await knex.raw(`
        CREATE INDEX idx_transactions_external_reference
        ON transactions(external_reference, country_code)
        WHERE external_reference IS NOT NULL
    `);

    // Admin reconciliation: filter by status + type
    await knex.raw(`
        CREATE INDEX idx_transactions_status
        ON transactions(status, type, country_code)
    `);

    // Financial history for a destination account (restaurant or agent payouts)
    await knex.raw(`
        CREATE INDEX idx_transactions_dst_acc_id
        ON transactions(dst_acc_id, country_code)
    `);

    await knex.raw(`
        CREATE TRIGGER trg_transactions_updated_at
        BEFORE UPDATE ON transactions
        FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at()
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TABLE IF EXISTS transactions`);
}
