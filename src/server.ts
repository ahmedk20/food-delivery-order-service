import 'reflect-metadata';
import './lib/di/container.js';
import * as http from 'node:http';
import { container } from './lib/di/container.js';
import { createApp } from './app.js';
import { env } from './lib/config/env.js';
import { pingAll, destroyAllShards } from './lib/knex/knex.js';
import logger from './lib/logger/logger.js';
import { socketServer } from './lib/websocket/ws-server.js';
import { TOKENS } from './lib/di/tokens.js';
import { startOutboxDispatcher } from './lib/outbox/dispatcher.js';
import { startCoreEventConsumer } from './lib/messaging/core-event-handler.js';
import type { IMessageBroker } from './pkg/messaging/message-broker.interface.js';
import type { ICacheProvider } from './pkg/cache/cache.interface.js';
import type { PermissionCacheService } from './app/rbac/service/permission-cache.service.js';

async function main() {
    // Verify every configured region cluster is reachable before accepting traffic.
    // Fails fast at startup rather than on the first customer request.
    logger.info('Pinging all DB shards…', { regions: env.regions });
    await pingAll();
    logger.info('All shards reachable');

    const app = createApp();
    const server = http.createServer(app);

    // Init socket.io + Redis adapter (async — opens pub/sub Redis connections).
    // Must complete before server.listen() so the first WS handshakes have an adapter.
    await socketServer.init(server);

    // Connect RabbitMQ broker (amqp-connection-manager handles auto-reconnect after this)
    const broker  = container.resolve<IMessageBroker>(TOKENS.MessageBroker);
    await broker.connect();
    logger.info('RabbitMQ broker connected');

    // Declare topology for the core-service events consumer before subscribing
    await broker.declareTopology({
        exchange:           'core-service.events',
        queue:              'order-service.core-events',
        bindingKeys:        ['product.#', 'restaurant.#', 'branch.#', 'rbac.#'],
        prefetch:           10,
        deadLetterExchange: 'order-service.core-events.dlx',
        deadLetterQueue:    'order-service.core-events.dead',
    });

    const cache      = container.resolve<ICacheProvider>(TOKENS.CacheProvider);
    const permSvc    = container.resolve<PermissionCacheService>(TOKENS.PermissionCacheService);

    await startCoreEventConsumer(broker, cache, permSvc);

    // One outbox dispatcher per region — publishes pending outbox rows to RabbitMQ
    for (const region of env.regions) {
        startOutboxDispatcher(broker, region);
    }

    await new Promise<void>(resolve => server.listen(env.port, resolve));
    logger.info(`Order service listening on port ${env.port}`);
    logger.info('WebSocket server attached at /ws');

    async function shutdown() {
        logger.info('Shutting down…');
        await socketServer.close();
        await broker.close();
        await new Promise<void>(resolve => server.close(() => resolve()));
        await destroyAllShards();
        process.exit(0);
    }

    process.on('SIGINT',  shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch(err => {
    logger.error('Fatal startup error', { err });
    process.exit(1);
});
