import 'reflect-metadata';
import './lib/di/container.js';
import { container } from './lib/di/container.js';
import { env } from './lib/config/env.js';
import { pingAll, destroyAllShards } from './lib/knex/knex.js';
import logger from './lib/logger/logger.js';
import { TOKENS } from './lib/di/tokens.js';
import { JobRegistry } from './lib/jobs/job-registry.js';
import { createOutboxDrainJobs } from './lib/outbox/jobs.js';
import { createPaymentSweepJobs } from './app/payment/jobs.js';
import { startCoreEventConsumer } from './lib/messaging/core-event-handler.js';
import type { IMessageBroker } from './pkg/messaging/message-broker.interface.js';
import type { ICacheProvider } from './pkg/cache/cache.interface.js';
import type { PermissionCacheService } from './lib/rbac/permission-cache.service.js';

async function main() {
    logger.info('Worker starting — pinging all DB shards…', { regions: env.regions });
    await pingAll();
    logger.info('All shards reachable');

    const broker = container.resolve<IMessageBroker>(TOKENS.MessageBroker);
    await broker.connect();
    logger.info('RabbitMQ broker connected');

    await broker.declareTopology({
        exchange:           env.rabbitmq.coreEvents.exchange,
        queue:              env.rabbitmq.coreEvents.queue,
        bindingKeys:        ['product.#', 'restaurant.#', 'branch.#', 'rbac.#'],
        prefetch:           env.rabbitmq.coreEvents.prefetch,
        deadLetterExchange: env.rabbitmq.coreEvents.dlx,
        deadLetterQueue:    env.rabbitmq.coreEvents.dlq,
    });

    const cache   = container.resolve<ICacheProvider>(TOKENS.CacheProvider);
    const permSvc = container.resolve<PermissionCacheService>(TOKENS.PermissionCacheService);
    await startCoreEventConsumer(broker, cache, permSvc);

    const registry = new JobRegistry();
    registry.register(...createOutboxDrainJobs(broker, env.regions));
    registry.register(...createPaymentSweepJobs(env.regions));
    registry.startAll();

    logger.info('Worker running', { regions: env.regions });

    async function shutdown() {
        logger.info('Worker shutting down…');
        registry.stopAll();
        await broker.close();
        await destroyAllShards();
        process.exit(0);
    }

    process.on('SIGINT',  shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch(err => {
    logger.error('Worker fatal startup error', { err });
    process.exit(1);
});
