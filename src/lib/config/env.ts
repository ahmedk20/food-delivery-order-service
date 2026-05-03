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

const envSchema = z.object({
    APP_STAGE: z.enum(['dev', 'production', 'test']).default('dev'),

    PORT: z.coerce.number().positive().default(3001),
    HOST: z.string().default('localhost'),

    DB_URL: z.string().startsWith('postgresql://'),
    DB_POOL_MIN: z.coerce.number().min(0).default(2),
    DB_POOL_MAX: z.coerce.number().positive().default(10),

    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().positive().default(6379),
    REDIS_PASSWORD: z.string().optional(),

    // Only verify — never sign. No REFRESH_SECRET needed.
    ACCESS_SECRET: z.string().min(1),

    CORE_SERVICE_URL: z.string().url(),

    KASHIER_MERCHANT_ID: z.string().min(1),
    KASHIER_API_KEY: z.string().min(1),
    KASHIER_WEBHOOK_SECRET: z.string().min(1),
    KASHIER_BASE_URL: z.string().url().default('https://checkout.kashier.io'),

    APP_BASE_URL: z.string().url().default('http://localhost:3001'),

    CORS_ORIGINS: z.string().default('http://localhost:5173'),

    COUNTRY_CODE: z.string().length(2).default('EG'),

    RABBITMQ_URL: z.string().default('amqp://guest:guest@localhost:5672'),

    INTERNAL_HMAC_SECRET: z.string().min(1),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error('Invalid environment variables');
    console.error(parsed.error.format());
    process.exit(1);
}

const data = parsed.data;

export const env = {
    port: data.PORT,
    host: data.HOST,

    db: {
        url: data.DB_URL,
        poolMin: data.DB_POOL_MIN,
        poolMax: data.DB_POOL_MAX,
        migrationDirectory: path.resolve(__dirname, '../../../src/database/migrations'),
        migrationExtension: 'ts',
    },

    redis: {
        host: data.REDIS_HOST,
        port: data.REDIS_PORT,
        password: data.REDIS_PASSWORD,
    },

    jwt: {
        accessSecret: data.ACCESS_SECRET,
    },

    coreServiceUrl: data.CORE_SERVICE_URL,
    appBaseUrl: data.APP_BASE_URL,

    kashier: {
        merchantId: data.KASHIER_MERCHANT_ID,
        apiKey: data.KASHIER_API_KEY,
        webhookSecret: data.KASHIER_WEBHOOK_SECRET,
        baseUrl: data.KASHIER_BASE_URL,
    },

    cors: {
        origins: data.CORS_ORIGINS.split(',').map(o => o.trim()),
    },

    countryCode: data.COUNTRY_CODE,

    rabbitmq: {
        url: data.RABBITMQ_URL,
    },

    internalHmacSecret: data.INTERNAL_HMAC_SECRET,
};
