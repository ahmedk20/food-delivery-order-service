import { db } from '../knex/knex.js';
import logger from '../logger/logger.js';
import type { IMessageBroker } from '../../pkg/messaging/message-broker.interface.js';

const BATCH_SIZE      = 50;
const POLL_INTERVAL_MS = 2_000;
const MAX_ATTEMPTS    = 5;
const EXCHANGE        = 'order-service.events';

export function startOutboxDispatcher(broker: IMessageBroker, region: string): void {
    const knex = db(region);

    async function tick(): Promise<void> {
        const rows = await knex.raw<{ rows: Array<{ id: number; event_type: string; aggregate_id: string; payload: string; attempts: number }> }>(`
            SELECT id, event_type, aggregate_id, payload, attempts
            FROM outbox
            WHERE dispatched_at IS NULL AND attempts < :maxAttempts
            ORDER BY created_at ASC
            LIMIT :batchSize
            FOR UPDATE SKIP LOCKED
        `, { maxAttempts: MAX_ATTEMPTS, batchSize: BATCH_SIZE });

        for (const row of rows.rows) {
            try {
                const body = Buffer.from(typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload));
                await broker.publish(EXCHANGE, row.event_type, body);
                await knex('outbox').where('id', row.id).update({ dispatched_at: new Date() });
            } catch (err) {
                await knex('outbox')
                    .where('id', row.id)
                    .update({
                        attempts:   knex.raw('attempts + 1'),
                        last_error: String(err),
                    });
                logger.warn('Outbox dispatch failed', { id: row.id, attempts: row.attempts + 1, region });
            }
        }
    }

    setInterval(() => {
        tick().catch(err => logger.error('Outbox tick error', { err, region }));
    }, POLL_INTERVAL_MS);

    logger.info('Outbox dispatcher started', { region });
}
