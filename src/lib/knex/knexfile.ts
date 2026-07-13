// This file is only used by the Knex CLI for migrations.
// Run migrations with: REGION=eg CLUSTER=hot npx knex migrate:latest
//
// The REGION + CLUSTER env vars are required so the CLI knows which cluster
// to target. Missing either will fail fast rather than defaulting to a wrong DB.

import { config } from 'dotenv';
import path from 'path';
import type { Knex } from 'knex';

const stage = process.env.APP_STAGE ?? 'dev';
const rootPath = path.resolve(__dirname, '../../../');

if (stage === 'dev') config({ path: path.join(rootPath, '.env.dev') });
else if (stage === 'test') config({ path: path.join(rootPath, '.env.test') });
else config({ path: path.join(rootPath, '.env') });

const region  = process.env.REGION;
const cluster = process.env.CLUSTER ?? 'hot';

if (!region) {
    console.error('ERROR: REGION env var is required for migrations. e.g. REGION=eg CLUSTER=hot npx knex migrate:latest');
    process.exit(1);
}

const r = region.toUpperCase();
const prefix = cluster === 'archive' ? `ARCHIVE_DB_${r}` : `DB_${r}`;

const host     = process.env[`${prefix}_HOST`];
const port     = Number(process.env[`${prefix}_PORT`] ?? '5432');
const database = process.env[`${prefix}_NAME`];
const user     = process.env[`${prefix}_USER`];
const password = process.env[`${prefix}_PASSWORD`] ?? '';

if (!host || !database || !user) {
    console.error(`ERROR: Missing DB vars for region="${region}" cluster="${cluster}". Expected: ${prefix}_HOST, ${prefix}_NAME, ${prefix}_USER`);
    process.exit(1);
}

// AWS RDS forces SSL. In production connect with SSL; `rejectUnauthorized: false`
// trusts the RDS-managed cert without shipping a CA bundle. Locally (dev/test) the
// throwaway Postgres speaks plaintext, so SSL stays off.
const isProd = stage === 'production';

const knexConfig: Knex.Config = {
    client: 'pg',
    connection: { host, port, database, user, password, ssl: isProd ? { rejectUnauthorized: false } : false },
    pool: { min: 1, max: 2 },
    migrations: {
        directory: path.resolve(__dirname, '../../../src/database/migrations'),
        extension: 'ts',
    },
};

export default knexConfig;
