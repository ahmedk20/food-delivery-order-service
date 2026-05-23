import type { Knex } from 'knex';

export type OutboxRow = {
    id: number;
    event_type: string;
    aggregate_id: string;
    payload: string;
    attempts: number;
};

export async function claimPendingBatch(
    knex: Knex,
    maxAttempts: number,
    batchSize: number,
): Promise<OutboxRow[]> {
    const result = await knex.raw<{ rows: OutboxRow[] }>(`
        SELECT id, event_type, aggregate_id, payload, attempts
        FROM outbox
        WHERE dispatched_at IS NULL AND attempts < :maxAttempts
        ORDER BY created_at ASC
        LIMIT :batchSize
        FOR UPDATE SKIP LOCKED
    `, { maxAttempts, batchSize });
    return result.rows;
}

export async function markDispatched(knex: Knex, id: number): Promise<void> {
    await knex('outbox').where({ id }).update({ dispatched_at: new Date() });
}

export async function markFailed(knex: Knex, id: number, error: string): Promise<void> {
    await knex('outbox')
        .where({ id })
        .update({
            attempts:   knex.raw('attempts + 1'),
            last_error: error,
        });
}
