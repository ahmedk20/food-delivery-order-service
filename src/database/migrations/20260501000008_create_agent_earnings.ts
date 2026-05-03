import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE agent_earnings (
            id            BIGSERIAL       NOT NULL,
            country_code  CHAR(2)         NOT NULL,
            agent_id      BIGINT          NOT NULL,
            order_id      BIGINT          NOT NULL,
            amount        INT             NOT NULL CHECK (amount > 0),
            currency      CHAR(3)         NOT NULL DEFAULT 'EGP',
            status        earnings_status NOT NULL DEFAULT 'pending',
            paid_at       TIMESTAMP,
            created_at    TIMESTAMP       NOT NULL,
            PRIMARY KEY (id, country_code),
            CONSTRAINT fk_agent_earnings_order
                FOREIGN KEY (order_id, country_code) REFERENCES orders(id, country_code),
            CONSTRAINT uq_agent_earnings_order
                UNIQUE (order_id, country_code)
        )
    `);

    // Agent earnings history and pending payout list
    await knex.raw(`
        CREATE INDEX idx_agent_earnings_agent_id
        ON agent_earnings(agent_id, status, country_code)
    `);

    // Admin payout queue: all pending earnings across all agents
    await knex.raw(`
        CREATE INDEX idx_agent_earnings_status
        ON agent_earnings(status, country_code)
        WHERE status = 'pending'
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TABLE IF EXISTS agent_earnings`);
}
