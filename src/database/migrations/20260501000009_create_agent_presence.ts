import type { Knex } from 'knex';

// One row per agent; upserted on every presence ping.
// The generated location column eliminates manual sync between lat/lng and the geography type.
// When last_lat/last_lng are NULL (agent hasn't sent a location yet), location is also NULL.
// Redis geo set (presence:geo:{region}) is the primary read path for auto-assignment.
// This table is the durable source of truth and the cold-start / Redis-down fallback.
export async function up(knex: Knex): Promise<void> {
    await knex.raw(`CREATE EXTENSION IF NOT EXISTS postgis`);

    await knex.raw(`
        CREATE TABLE agent_presence (
            agent_id     BIGINT          PRIMARY KEY,
            region       TEXT            NOT NULL,
            is_online    BOOLEAN         NOT NULL DEFAULT false,
            is_available BOOLEAN         NOT NULL DEFAULT false,
            last_lat     DECIMAL(10,7),
            last_lng     DECIMAL(10,7),
            last_seen_at TIMESTAMP       NOT NULL DEFAULT NOW(),
            location     GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (
                             CASE
                                 WHEN last_lng IS NOT NULL AND last_lat IS NOT NULL
                                 THEN ST_MakePoint(last_lng::float, last_lat::float)::geography
                                 ELSE NULL
                             END
                         ) STORED,
            updated_at   TIMESTAMP       NOT NULL DEFAULT NOW()
        )
    `);

    await knex.raw(`
        CREATE TRIGGER trg_agent_presence_updated_at
        BEFORE UPDATE ON agent_presence
        FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at()
    `);

    // Postgres GIST fallback for assignment when Redis geo set is empty/cold
    await knex.raw(`
        CREATE INDEX idx_agent_presence_location_gist ON agent_presence USING GIST (location)
        WHERE is_online = true AND is_available = true
    `);

    // Cleanup: find stale online agents
    await knex.raw(`
        CREATE INDEX idx_agent_presence_last_seen_at ON agent_presence (last_seen_at)
        WHERE is_online = true
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TABLE IF EXISTS agent_presence`);
}
