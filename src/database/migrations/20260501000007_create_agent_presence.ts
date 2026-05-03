import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE agent_presence (
            agent_id        BIGINT          NOT NULL,
            country_code    CHAR(2)         NOT NULL,
            lat             DECIMAL(10,8)   NOT NULL,
            lng             DECIMAL(11,8)   NOT NULL,
            is_online       BOOLEAN         NOT NULL DEFAULT false,
            is_available    BOOLEAN         NOT NULL DEFAULT false,
            last_seen_at    TIMESTAMP       NOT NULL,
            PRIMARY KEY (agent_id, country_code)
        )
    `);

    // Finding available agents in a country for order assignment
    await knex.raw(`
        CREATE INDEX idx_agent_presence_available
        ON agent_presence(country_code, is_online, is_available)
        WHERE is_online = true AND is_available = true
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TABLE IF EXISTS agent_presence`);
}
