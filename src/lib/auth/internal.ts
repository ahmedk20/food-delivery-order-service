import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import AppError from '../error/AppError.js';

const MAX_TIMESTAMP_SKEW_MS = 60_000;

export function requireInternalHmac(req: Request, _res: Response, next: NextFunction): void {
    try {
        const sig       = req.headers['x-internal-signature'] as string | undefined;
        const tsHeader  = req.headers['x-internal-timestamp'] as string | undefined;

        if (!sig || !tsHeader) {
            return next(new AppError('InternalAuthRequired', 401));
        }

        const ts = Number(tsHeader);
        if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_TIMESTAMP_SKEW_MS) {
            return next(new AppError('InternalAuthExpired', 401));
        }

        const path = req.originalUrl.split('?')[0];
        const expected = createHmac('sha256', env.internalHmacSecret)
            .update(`${tsHeader}:${req.method}:${path}`)
            .digest('hex');

        const expectedBuf = Buffer.from(expected, 'hex');
        const sigBuf      = Buffer.from(sig, 'hex');

        if (expectedBuf.length !== sigBuf.length || !timingSafeEqual(expectedBuf, sigBuf)) {
            return next(new AppError('InternalAuthInvalidSignature', 401));
        }

        next();
    } catch {
        next(new AppError('InternalAuthFailed', 401));
    }
}
