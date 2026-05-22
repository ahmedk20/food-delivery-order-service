import type { Knex } from 'knex';

// Per-delivery earnings snapshot. Linked to delivery_id (not just order_id) so reassignment
// scenarios don't create ambiguity: only the completing delivery row gets an earnings record.
// UNIQUE (delivery_id) makes the insert idempotent on retries.
// FKs to orders and deliveries are logical only — both parent tables are partitioned.
// agent_id is a logical FK to core.users.id (no DB-level constraint).
export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE agent_earnings (
            id          BIGSERIAL PRIMARY KEY,
            region      TEXT      NOT NULL,
            agent_id    BIGINT    NOT NULL,
            order_id    BIGINT    NOT NULL,
            delivery_id BIGINT    NOT NULL,
            amount      INT       NOT NULL CHECK (amount > 0),
            currency    CHAR(3)   NOT NULL,
            status      TEXT      NOT NULL DEFAULT 'pending',
            paid_at     TIMESTAMP,
            created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
            CONSTRAINT ck_agent_earnings_status CHECK (status IN ('pending', 'paid')),
            CONSTRAINT uq_agent_earnings_delivery UNIQUE (delivery_id)
        )
    `);

    // Agent earnings history (cursor pagination)
    await knex.raw(`
        CREATE INDEX idx_agent_earnings_agent_id
        ON agent_earnings (agent_id, status, created_at DESC)
    `);

    // Pending payout list
    await knex.raw(`
        CREATE INDEX idx_agent_earnings_status ON agent_earnings (status)
        WHERE status = 'pending'
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TABLE IF EXISTS agent_earnings`);
}
