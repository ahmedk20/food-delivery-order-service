import 'reflect-metadata';
import './lib/di/container.js';
import * as http from 'node:http';
import { createApp } from './app.js';
import { env } from './lib/config/env.js';
import { db } from './lib/knex/knex.js';
import logger from './lib/logger/logger.js';

const app = createApp();

// Use http.createServer (not app.listen) so Phase 5 can attach the WebSocket server
const server = http.createServer(app);

server.listen(env.port, () => {
    logger.info(`Order service listening on port ${env.port}`);
});

async function shutdown() {
    logger.info('Shutting down...');
    server.close(async () => {
        await db.destroy();
        process.exit(0);
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
