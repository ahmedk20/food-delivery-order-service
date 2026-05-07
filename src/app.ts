import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { routes } from './routes.js';
import { correlationId } from './lib/correlation/correlationId.js';
import { errorHandler } from './lib/error/errorHandler.js';
import { env } from './lib/config/env.js';

// Routes that must receive the raw request body (no JSON parsing).
// The Kashier webhook needs the untouched payload so the route's express.raw()
// — and any future raw-bytes signature verification — actually populate req.body
// as a Buffer instead of being shadowed by the global json parser.
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
    app.use(correlationId);

    app.use('/api', routes);

    app.use(errorHandler);

    return app;
}
