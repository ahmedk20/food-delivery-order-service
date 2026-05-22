import type { Knex } from 'knex';
import { db } from '../../../lib/knex/knex.js';

// Returns true if the row was inserted (first delivery), false if already seen (duplicate).
// Uses SELECT-then-INSERT within the caller's transaction: partitioned tables require the
// partition key in any unique constraint, making ON CONFLICT with a subset of columns unsafe
// across partitions. Same-partition retries (the common case) are still idempotent because
// the SELECT inside the transaction sees the already-inserted row and returns early.
export async function insertWebhookEvent(
    providerId: number,
    providerEventId: string,
    signature: string,
    rawPayload: object,
    region: string,
    conn?: Knex,
): Promise<boolean> {
    const knex = conn ?? db(region);
    const existing = await knex('payment_webhook_events')
        .where({ provider_id: providerId, provider_event_id: providerEventId })
        .first();
    if (existing) return false;
    await knex('payment_webhook_events').insert({
        region,
        provider_id:       providerId,
        provider_event_id: providerEventId,
        signature,
        payload:           rawPayload,
        created_at:        new Date(),
    });
    return true;
}

export async function markWebhookProcessed(
    providerEventId: string,
    region: string,
    conn?: Knex,
): Promise<void> {
    const knex = conn ?? db(region);
    await knex('payment_webhook_events')
        .where({ provider_event_id: providerEventId })
        .update({ processed_at: new Date() });
}

export async function markWebhookError(
    providerEventId: string,
    error: string,
    region: string,
    conn?: Knex,
): Promise<void> {
    const knex = conn ?? db(region);
    await knex('payment_webhook_events')
        .where({ provider_event_id: providerEventId })
        .update({ process_error: error });
}
