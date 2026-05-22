import 'reflect-metadata';
import './lib/di/container.js';
import * as http from 'node:http';
import { createApp } from './app.js';
import { env } from './lib/config/env.js';
import { pingAll, destroyAllShards } from './lib/knex/knex.js';
import logger from './lib/logger/logger.js';
import { socketServer } from './lib/websocket/ws-server.js';

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

    await new Promise<void>(resolve => server.listen(env.port, resolve));
    logger.info(`Order service listening on port ${env.port}`);
    logger.info('WebSocket server attached at /ws');

    async function shutdown() {
        logger.info('Shutting down…');
        await socketServer.close();
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
