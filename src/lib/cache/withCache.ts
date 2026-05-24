import type { Request, Response, NextFunction } from 'express';
import { cacheProvider } from './init.js';

function buildCacheKey(req: Request): string {
    const region = req.region ?? 'global';
    const query  = Object.keys(req.query).sort().map(k => `${k}=${req.query[k]}`).join('&');
    return query ? `${region}:os:route:${req.path}:${query}` : `${region}:os:route:${req.path}`;
}

/**
 * GET response caching middleware.
 * Caches the JSON response body in Redis for `ttlSeconds`.
 * Cache miss → runs the handler → intercepts res.json() → stores result.
 * Cache hit → returns stored JSON directly, bypassing all downstream handlers.
 *
 * Usage: router.get('/path', withCache(30), handler)
 */
export function withCache(ttlSeconds: number) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const key = buildCacheKey(req);

        try {
            const cached = await cacheProvider.get(key);
            if (cached) {
                res.setHeader('X-Cache', 'HIT');
                res.status(200).json(JSON.parse(cached));
                return;
            }
        } catch {
            // Redis unavailable — fall through to handler
        }

        const originalJson = res.json.bind(res);
        res.json = (body: unknown): Response => {
            if (res.statusCode === 200) {
                cacheProvider.set(key, JSON.stringify(body), ttlSeconds).catch(() => {});
            }
            return originalJson(body);
        };

        next();
    };
}
