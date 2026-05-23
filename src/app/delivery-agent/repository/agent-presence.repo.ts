import { db } from '../../../lib/knex/knex.js';
import { AgentPresenceEntity } from '../entity/agent-presence.entity.js';

const COLUMNS = ['agent_id', 'region', 'is_online', 'is_available', 'last_lat', 'last_lng', 'last_seen_at', 'updated_at'];

function toEntity(row: any): AgentPresenceEntity {
    return new AgentPresenceEntity({
        agentId:     row.agent_id,
        region:      row.region,
        isOnline:    row.is_online,
        isAvailable: row.is_available,
        lastLat:     row.last_lat  != null ? Number(row.last_lat)  : null,
        lastLng:     row.last_lng  != null ? Number(row.last_lng)  : null,
        lastSeenAt:  row.last_seen_at,
        updatedAt:   row.updated_at,
    });
}

export async function findPresenceByAgentId(
    agentId: number,
    region: string,
): Promise<AgentPresenceEntity | undefined> {
    const row = await db(region)('agent_presence')
        .select(COLUMNS)
        .where({ agent_id: agentId })
        .first();
    return row ? toEntity(row) : undefined;
}

export async function upsertPresence(data: {
    agentId: number;
    region: string;
    isOnline: boolean;
    isAvailable: boolean;
    lastLat: number | null;
    lastLng: number | null;
}): Promise<void> {
    const now = new Date();
    await db(data.region)('agent_presence')
        .insert({
            agent_id:     data.agentId,
            region:       data.region,
            is_online:    data.isOnline,
            is_available: data.isAvailable,
            last_lat:     data.lastLat,
            last_lng:     data.lastLng,
            last_seen_at: now,
            updated_at:   now,
        })
        .onConflict('agent_id')
        .merge({
            is_online:    data.isOnline,
            is_available: data.isAvailable,
            last_lat:     data.lastLat,
            last_lng:     data.lastLng,
            last_seen_at: now,
            updated_at:   now,
        });
}
