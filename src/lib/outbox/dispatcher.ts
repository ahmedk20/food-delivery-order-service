import { db } from '../knex/knex.js';
import logger from '../logger/logger.js';
import { env } from '../config/env.js';
import { claimPendingBatch, markDispatched, markFailed } from './outbox.repo.js';
import type { IMessageBroker } from '../../pkg/messaging/message-broker.interface.js';

const MAX_ATTEMPTS = 5;

export function startOutboxDispatcher(broker: IMessageBroker, region: string): void {
    const knex           = db(region);
    const batchSize      = env.rabbitmq.orderEvents.batchSize;
    const pollIntervalMs = env.rabbitmq.orderEvents.drainTickSec * 1_000;
    const exchange       = env.rabbitmq.orderEvents.exchange;

    async function tick(): Promise<void> {
        const rows = await claimPendingBatch(knex, MAX_ATTEMPTS, batchSize);

        for (const row of rows) {
            try {
                const body = Buffer.from(
                    typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload),
                );
                await broker.publish(exchange, row.event_type, body);
                await markDispatched(knex, row.id);
            } catch (err) {
                await markFailed(knex, row.id, String(err));
                logger.warn('Outbox dispatch failed', { id: row.id, attempts: row.attempts + 1, region });
            }
        }
    }

    setInterval(() => {
        tick().catch(err => logger.error('Outbox tick error', { err, region }));
    }, pollIntervalMs);

    logger.info('Outbox dispatcher started', { region, exchange, batchSize, pollIntervalMs });
}
