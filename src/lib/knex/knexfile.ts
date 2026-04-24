import { env } from '../config/env.js';
import type { Knex } from 'knex';

const config: Knex.Config = {
    client: 'pg',
    connection: env.db.url,
    pool: {
        max: env.db.poolMax,
        min: env.db.poolMin,
    },
    migrations: {
        directory: env.db.migrationDirectory,
        extension: env.db.migrationExtension,
    },
};

export default config;
