import 'reflect-metadata';
import './lib/di/container.js';
import * as http from 'node:http';
import { createApp } from './app.js';
import { env } from './lib/config/env.js';
import { db } from './lib/knex/knex.js';
import logger from './lib/logger/logger.js';
import { wsServer } from './lib/websocket/ws-server.js';

const app = createApp();

const server = http.createServer(app);
wsServer.init(server);

server.listen(env.port, () => {
    logger.info(`Order service listening on port ${env.port}`);
    logger.info('WebSocket server attached at /ws');
});

async function shutdown() {
    logger.info('Shutting down...');
    await wsServer.close();
    server.close(async () => {
        await db.destroy();
        process.exit(0);
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
