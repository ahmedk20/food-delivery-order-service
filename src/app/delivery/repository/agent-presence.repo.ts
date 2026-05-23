import type { Knex } from 'knex';
import { db } from '../../../lib/knex/knex.js';
import { env } from '../../../lib/config/env.js';

export interface AgentPresenceRow {
    agentId: number;
    isOnline: boolean;
    isAvailable: boolean;
    lastLat: number | null;
    lastLng: number | null;
    lastSeenAt: Date;
}

function toRow(row: any): AgentPresenceRow {
    return {
        agentId:     row.agent_id,
        isOnline:    row.is_online,
        isAvailable: row.is_available,
        lastLat:     row.last_lat != null ? Number(row.last_lat) : null,
        lastLng:     row.last_lng != null ? Number(row.last_lng) : null,
        lastSeenAt:  row.last_seen_at,
    };
}

export async function findAgentPresenceById(
    agentId: number,
    region: string,
): Promise<AgentPresenceRow | undefined> {
    const row = await db(region)('agent_presence')
        .select(['agent_id', 'is_online', 'is_available', 'last_lat', 'last_lng', 'last_seen_at'])
        .where({ agent_id: agentId })
        .first();
    return row ? toRow(row) : undefined;
}

// Find online, available agents near a location, ordered by distance.
// Uses the PostGIS GIST index on agent_presence.location as the primary source.
// Redis geo set (presence:geo:{region}) is the optimized path — populated in Phase 7.
export async function findNearestAvailableAgents(
    lat: number,
    lng: number,
    region: string,
    limit: number = 5,
): Promise<AgentPresenceRow[]> {
    const staleCutoff = new Date(Date.now() - env.delivery.presenceStaleSec * 1000);
    const rows = await db(region).raw<{ rows: any[] }>(`
        SELECT agent_id, is_online, is_available, last_lat, last_lng, last_seen_at
        FROM agent_presence
        WHERE is_online    = true
          AND is_available = true
          AND last_seen_at > :staleCutoff
          AND location     IS NOT NULL
        ORDER BY ST_Distance(
            location,
            ST_MakePoint(:lng, :lat)::geography
        ) ASC
        LIMIT :limit
    `, { lat, lng, staleCutoff, limit });
    return rows.rows.map(toRow);
}

export async function setAgentAvailability(
    agentId: number,
    isAvailable: boolean,
    region: string,
    conn?: Knex,
): Promise<void> {
    const knex = conn ?? db(region);
    await knex('agent_presence')
        .where({ agent_id: agentId })
        .update({ is_available: isAvailable, updated_at: new Date() });
}
