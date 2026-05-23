import type { Knex } from 'knex';

// Persists every Kashier session at creation time.
// Webhook handlers look up sessions by provider_session_id, not order_id alone,
// to handle edge cases where the same order has multiple session attempts.
// FK to orders is logical only — orders is a partitioned table.
export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE payment_sessions (
            id                  BIGSERIAL   PRIMARY KEY,
            region              TEXT        NOT NULL,
            order_id            BIGINT      NOT NULL,
            provider_id         INT         REFERENCES payment_providers(id),
            provider_session_id TEXT        NOT NULL,
            session_url         TEXT        NOT NULL,
            amount              INT         NOT NULL CHECK (amount > 0),
            currency            CHAR(3)     NOT NULL,
            status              TEXT        NOT NULL DEFAULT 'created',
            expires_at          TIMESTAMP   NOT NULL,
            created_at          TIMESTAMP   NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMP   NOT NULL DEFAULT NOW(),
            CONSTRAINT ck_payment_sessions_status CHECK (status IN (
                'created', 'completed', 'failed', 'expired'
            ))
        )
    `);

    // Webhook handler: look up session by Kashier's session ID
    await knex.raw(`
        CREATE UNIQUE INDEX uq_payment_sessions_provider_session_id
        ON payment_sessions (provider_session_id)
    `);

    // Link back to order to list all sessions for an order
    await knex.raw(`
        CREATE INDEX idx_payment_sessions_order_id
        ON payment_sessions (order_id)
    `);

    await knex.raw(`
        CREATE TRIGGER trg_payment_sessions_updated_at
        BEFORE UPDATE ON payment_sessions
        FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at()
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TABLE IF EXISTS payment_sessions CASCADE`);
}
