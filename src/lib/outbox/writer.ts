import type { Knex } from 'knex';

export async function writeOutboxEvent(
    conn: Knex,
    region: string,
    eventType: string,
    aggregateId: string,
    payload: object,
): Promise<void> {
    await conn('outbox').insert({
        region,
        event_type:   eventType,
        aggregate_id: aggregateId,
        payload:      JSON.stringify(payload),
        created_at:   new Date(),
    });
}
