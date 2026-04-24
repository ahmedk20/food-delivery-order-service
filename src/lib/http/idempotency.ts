import type { Request, Response, NextFunction } from 'express';
import { container } from '../di/container.js';
import { TOKENS } from '../di/tokens.js';
import type { ICacheProvider } from '../../pkg/cache/cache.interface.js';

const TTL = 86_400; // 24 hours

interface StoredResponse {
    status: number;
    body: unknown;
}

export function idempotency() {
    const cache = container.resolve<ICacheProvider>(TOKENS.CacheProvider);

    return async (req: Request, res: Response, next: NextFunction) => {
        const key = req.headers['idempotency-key'] as string | undefined;

        if (!key) return next();

        const cacheKey = `idempotent:${key}`;

        try {
            const cached = await cache.get(cacheKey);
            if (cached) {
                const stored: StoredResponse = JSON.parse(cached);
                res.setHeader('X-Idempotency-Replay', 'true');
                return res.status(stored.status).json(stored.body);
            }
        } catch {
            // Redis down → process normally. Better to process twice than block.
        }

        const originalJson = res.json.bind(res);
        res.json = function (body: unknown) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const stored: StoredResponse = { status: res.statusCode, body };
                cache.set(cacheKey, JSON.stringify(stored), TTL).catch(() => {});
            }
            return originalJson(body);
        };

        next();
    };
}
