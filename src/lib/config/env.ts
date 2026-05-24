import { config } from 'dotenv';
import { z } from 'zod';
import path from 'path';

process.env.APP_STAGE = process.env.APP_STAGE || 'dev';

const isDevelopment = process.env.APP_STAGE === 'dev';
const isTest = process.env.APP_STAGE === 'test';

const rootPath = path.resolve(__dirname, '../../../');

if (isDevelopment) {
    config({ path: path.join(rootPath, '.env.dev') });
} else if (isTest) {
    config({ path: path.join(rootPath, '.env.test') });
} else {
    config({ path: path.join(rootPath, '.env') });
}

// ── Static (non-region) env vars ─────────────────────────────────────────────
const staticSchema = z.object({
    APP_STAGE: z.enum(['dev', 'production', 'test']).default('dev'),

    PORT:  z.coerce.number().positive().default(3001),
    HOST:  z.string().default('localhost'),

    // Comma-separated list of region slugs that this instance serves.
    // Each region maps to its own Postgres cluster via DB_{REGION}_* vars.
    REGIONS: z.string().min(1),

    DB_POOL_MIN: z.coerce.number().min(0).default(2),
    DB_POOL_MAX: z.coerce.number().positive().default(10),

    REDIS_HOST:     z.string().default('localhost'),
    REDIS_PORT:     z.coerce.number().positive().default(6379),
    REDIS_PASSWORD: z.string().optional(),

    // Only verify — tokens are issued by the core service.
    ACCESS_SECRET: z.string().min(1),

    CORE_SERVICE_URL: z.string().url(),

    KASHIER_MERCHANT_ID:    z.string().min(1),
    KASHIER_API_KEY:        z.string().min(1),
    KASHIER_WEBHOOK_SECRET: z.string().min(1),
    KASHIER_BASE_URL:       z.string().url().default('https://checkout.kashier.io'),
    KASHIER_RETURN_URL:     z.string().url().default('https://app.quickbite.example/checkout/return'),
    KASHIER_FAIL_URL:       z.string().url().default('https://app.quickbite.example/checkout/failed'),

    APP_BASE_URL: z.string().url().default('http://localhost:3001'),

    CORS_ORIGINS: z.string().default('http://localhost:5173'),

    RABBITMQ_URL:         z.string().default('amqp://guest:guest@localhost:5672'),
    INTERNAL_HMAC_SECRET: z.string().min(1),

    // RabbitMQ topology — inbound core events
    RABBITMQ_CORE_EVENTS_EXCHANGE: z.string().default('core-service.events'),
    RABBITMQ_CORE_EVENTS_QUEUE:    z.string().default('order-service.core-events'),
    RABBITMQ_CORE_EVENTS_DLX:      z.string().default('order-service.core-events.dlx'),
    RABBITMQ_CORE_EVENTS_DLQ:      z.string().default('order-service.core-events.dead'),
    RABBITMQ_PREFETCH:             z.coerce.number().positive().default(10),

    // RabbitMQ topology — outbound order events (transactional outbox)
    RABBITMQ_ORDER_EVENTS_EXCHANGE:    z.string().default('order-service.events'),
    OUTBOUND_EVENTS_DRAIN_TICK_SEC:    z.coerce.number().positive().default(2),
    OUTBOUND_EVENTS_BATCH_SIZE:        z.coerce.number().positive().default(50),

    // Delivery auto-assignment tuning
    ASSIGNMENT_RADIUS_METERS:   z.coerce.number().positive().default(5000),
    AGENT_ACCEPT_TIMEOUT_SEC:   z.coerce.number().positive().default(30),
    MAX_REASSIGNMENT_ATTEMPTS:  z.coerce.number().positive().default(3),
    // BPS: 10000 = 100%, 8000 = 80%. Integer math — no float money arithmetic.
    AGENT_EARNING_SHARE_BPS:    z.coerce.number().int().min(0).max(10000).default(10000),
    PRESENCE_STALE_SEC:         z.coerce.number().positive().default(90),
    // Assignment worker: how many orders to scan per tick, max candidates per broadcast
    ASSIGNMENT_BATCH_SIZE:      z.coerce.number().positive().default(20),
    ASSIGNMENT_CANDIDATES:      z.coerce.number().positive().default(5),
    // How long offer lives in Redis (agent must claim within this window)
    OFFER_TTL_SEC:              z.coerce.number().positive().default(30),
    // How long atomic claim lock lives (prevents double-delivery on retry)
    CLAIM_TTL_SEC:              z.coerce.number().positive().default(300),

    // Background sweep: cancel pending_payment orders older than this
    PAYMENT_SESSION_TIMEOUT_MIN:     z.coerce.number().positive().default(15),
});

const staticResult = staticSchema.safeParse(process.env);
if (!staticResult.success) {
    console.error('Invalid environment variables');
    console.error(staticResult.error.format());
    process.exit(1);
}

const staticData = staticResult.data;
const regions = staticData.REGIONS.split(',').map(r => r.trim()).filter(Boolean);

// ── Per-region DB connection config ──────────────────────────────────────────
// For each region slug (e.g. "eg", "ksa") we expect:
//   DB_{REGION}_HOST, DB_{REGION}_PORT, DB_{REGION}_NAME, DB_{REGION}_USER, DB_{REGION}_PASSWORD
//   ARCHIVE_DB_{REGION}_HOST, ARCHIVE_DB_{REGION}_PORT, ARCHIVE_DB_{REGION}_NAME,
//   ARCHIVE_DB_{REGION}_USER, ARCHIVE_DB_{REGION}_PASSWORD

export interface RegionDbConfig {
    hot: {
        host: string;
        port: number;
        database: string;
        user: string;
        password: string | undefined;
    };
    archive: {
        host: string;
        port: number;
        database: string;
        user: string;
        password: string | undefined;
    };
}

function parseRegionDb(region: string): RegionDbConfig {
    const r = region.toUpperCase();
    const get = (key: string): string | undefined => process.env[key];
    const require = (key: string, label: string): string => {
        const v = get(key);
        if (!v) throw new Error(`Missing env var ${key} (required for region ${region} ${label})`);
        return v;
    };

    return {
        hot: {
            host:     require(`DB_${r}_HOST`,     'hot cluster'),
            port:     Number(get(`DB_${r}_PORT`) ?? '5432'),
            database: require(`DB_${r}_NAME`,     'hot cluster'),
            user:     require(`DB_${r}_USER`,     'hot cluster'),
            password: get(`DB_${r}_PASSWORD`),
        },
        archive: {
            host:     require(`ARCHIVE_DB_${r}_HOST`,     'archive cluster'),
            port:     Number(get(`ARCHIVE_DB_${r}_PORT`) ?? '5432'),
            database: require(`ARCHIVE_DB_${r}_NAME`,     'archive cluster'),
            user:     require(`ARCHIVE_DB_${r}_USER`,     'archive cluster'),
            password: get(`ARCHIVE_DB_${r}_PASSWORD`),
        },
    };
}

const regionConfigs: Record<string, RegionDbConfig> = {};
for (const region of regions) {
    try {
        regionConfigs[region] = parseRegionDb(region);
    } catch (err) {
        console.error(String(err));
        process.exit(1);
    }
}

// ── Exported env object ───────────────────────────────────────────────────────
export const env = {
    stage:   staticData.APP_STAGE,
    port:    staticData.PORT,
    host:    staticData.HOST,

    regions,
    regionConfigs,

    db: {
        poolMin: staticData.DB_POOL_MIN,
        poolMax: staticData.DB_POOL_MAX,
        migrationDirectory: path.resolve(__dirname, '../../../src/database/migrations'),
        migrationExtension: 'ts',
    },

    redis: {
        host:     staticData.REDIS_HOST,
        port:     staticData.REDIS_PORT,
        password: staticData.REDIS_PASSWORD,
    },

    jwt: {
        accessSecret: staticData.ACCESS_SECRET,
    },

    coreServiceUrl: staticData.CORE_SERVICE_URL,
    appBaseUrl:     staticData.APP_BASE_URL,

    kashier: {
        merchantId:    staticData.KASHIER_MERCHANT_ID,
        apiKey:        staticData.KASHIER_API_KEY,
        webhookSecret: staticData.KASHIER_WEBHOOK_SECRET,
        baseUrl:       staticData.KASHIER_BASE_URL,
        returnUrl:     staticData.KASHIER_RETURN_URL,
        failUrl:       staticData.KASHIER_FAIL_URL,
    },

    cors: {
        origins: staticData.CORS_ORIGINS.split(',').map(o => o.trim()),
    },

    rabbitmq: {
        url: staticData.RABBITMQ_URL,
        coreEvents: {
            exchange:   staticData.RABBITMQ_CORE_EVENTS_EXCHANGE,
            queue:      staticData.RABBITMQ_CORE_EVENTS_QUEUE,
            dlx:        staticData.RABBITMQ_CORE_EVENTS_DLX,
            dlq:        staticData.RABBITMQ_CORE_EVENTS_DLQ,
            prefetch:   staticData.RABBITMQ_PREFETCH,
        },
        orderEvents: {
            exchange:     staticData.RABBITMQ_ORDER_EVENTS_EXCHANGE,
            drainTickSec: staticData.OUTBOUND_EVENTS_DRAIN_TICK_SEC,
            batchSize:    staticData.OUTBOUND_EVENTS_BATCH_SIZE,
        },
    },

    internalHmacSecret: staticData.INTERNAL_HMAC_SECRET,

    delivery: {
        assignmentRadiusMeters:  staticData.ASSIGNMENT_RADIUS_METERS,
        agentAcceptTimeoutSec:   staticData.AGENT_ACCEPT_TIMEOUT_SEC,
        maxReassignmentAttempts: staticData.MAX_REASSIGNMENT_ATTEMPTS,
        agentEarningShareBps:    staticData.AGENT_EARNING_SHARE_BPS,
        presenceStaleSec:        staticData.PRESENCE_STALE_SEC,
        assignmentBatchSize:     staticData.ASSIGNMENT_BATCH_SIZE,
        candidates:              staticData.ASSIGNMENT_CANDIDATES,
        offerTtlSec:             staticData.OFFER_TTL_SEC,
        claimTtlSec:             staticData.CLAIM_TTL_SEC,
    },

    payment: {
        sessionTimeoutMin: staticData.PAYMENT_SESSION_TIMEOUT_MIN,
    },
};
