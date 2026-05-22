import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { routes } from './routes.js';
import { correlationId } from './lib/correlation/correlationId.js';
import { resolveRegion } from './lib/sharding/region-resolver.js';
import { errorHandler } from './lib/error/errorHandler.js';
import { env } from './lib/config/env.js';

// Routes that must receive the raw request body (no JSON parsing).
// The Kashier webhook needs the untouched payload so the route's express.raw()
// middleware populates req.body as a Buffer for HMAC signature verification.
const RAW_BODY_PATHS = new Set<string>(['/api/payments/webhook']);

export function createApp() {
    const app = express();

    app.use(cors({ origin: env.cors.origins, credentials: true }));
    app.use(helmet());

    app.use((req, res, next) => {
        if (RAW_BODY_PATHS.has(req.path)) return next();
        return express.json()(req, res, next);
    });

    app.use(cookieParser());

    // Step 1: stamp every request with a correlation ID for distributed tracing.
    app.use(correlationId);

    // Step 2: read X-Region header → req.region (never throws; undefined if missing).
    // Applied globally so every handler has region available without per-router boilerplate.
    app.use(resolveRegion);

    // Step 3: authenticate + role guards are applied per-router, not globally,
    // because health and webhook endpoints don't need JWT auth.

    app.use('/api', routes);

    app.use(errorHandler);

    return app;
}
