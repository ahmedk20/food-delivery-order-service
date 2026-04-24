import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { routes } from './routes.js';
import { correlationId } from './lib/correlation/correlationId.js';
import { errorHandler } from './lib/error/errorHandler.js';
import { env } from './lib/config/env.js';

export function createApp() {
    const app = express();

    app.use(cors({ origin: env.cors.origins, credentials: true }));
    app.use(helmet());
    app.use(express.json());
    app.use(cookieParser());
    app.use(correlationId);

    app.use('/api', routes);

    app.use(errorHandler);

    return app;
}
