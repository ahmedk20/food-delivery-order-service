import { env } from '../config/env.js';
import { db } from '../knex/knex.js';
import logger from '../logger/logger.js';
import { claimPendingBatch, markDispatched, markFailed } from './outbox.repo.js';
import type { IMessageBroker } from '../../pkg/messaging/message-broker.interface.js';
import type { Job } from '../jobs/job.types.js';

const MAX_ATTEMPTS = 5;

export function createOutboxDrainJobs(broker: IMessageBroker, regions: string[]): Job[] {
    return regions.map(region => {
        const knex      = db(region);
        const exchange  = env.rabbitmq.orderEvents.exchange;
        const batchSize = env.rabbitmq.orderEvents.batchSize;

        return {
            name:       `outbox-drain:${region}`,
            intervalMs: env.rabbitmq.orderEvents.drainTickSec * 1_000,
            handler: async () => {
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
            },
        };
    });
}
