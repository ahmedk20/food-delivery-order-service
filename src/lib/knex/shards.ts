import knex, { type Knex } from 'knex';
import { env } from '../config/env.js';

// Connections are created lazily on first use and cached here for the process lifetime.
// Key format: "${region}:hot" or "${region}:archive"
const pool = new Map<string, Knex>();

function create(region: string, tier: 'hot' | 'archive'): Knex {
    const cfg = env.regionConfigs[region];
    if (!cfg) {
        throw new Error(`No DB config for region "${region}". Check REGIONS env var.`);
    }

    const conn = tier === 'hot' ? cfg.hot : cfg.archive;

    return knex({
        client: 'pg',
        connection: {
            host:     conn.host,
            port:     conn.port,
            database: conn.database,
            user:     conn.user,
            password: conn.password,
            // AWS RDS forces SSL. Enable it in production (trust the RDS-managed
            // cert); locally/tests the throwaway Postgres speaks plaintext.
            ssl:      env.stage === 'production' ? { rejectUnauthorized: false } : false,
        },
        pool: {
            min: env.db.poolMin,
            max: env.db.poolMax,
        },
        // Migrations are run via knexfile.ts (CLI). The shard pool is query-only.
    });
}

export function getHotShard(region: string): Knex {
    const key = `${region}:hot`;
    if (!pool.has(key)) pool.set(key, create(region, 'hot'));
    return pool.get(key)!;
}

export function getArchiveShard(region: string): Knex {
    const key = `${region}:archive`;
    if (!pool.has(key)) pool.set(key, create(region, 'archive'));
    return pool.get(key)!;
}

export async function destroyAllShards(): Promise<void> {
    const closures = [...pool.values()].map(k => k.destroy());
    await Promise.all(closures);
    pool.clear();
}

export async function pingAll(): Promise<void> {
    // Eagerly open a connection to every configured region so startup fails
    // fast if any cluster is unreachable, rather than failing on the first request.
    const checks = env.regions.map(async region => {
        await getHotShard(region).raw('SELECT 1');
    });
    await Promise.all(checks);
}
