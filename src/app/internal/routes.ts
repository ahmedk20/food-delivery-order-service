import { Router, type Request, type Response, type NextFunction } from 'express';
import { container } from '../../lib/di/container.js';
import { TOKENS } from '../../lib/di/tokens.js';
import { requireInternalHmac } from '../../lib/auth/internal.js';
import { sendSuccess } from '../../lib/http/response.js';
import AppError from '../../lib/error/AppError.js';
import { handleCoreEventPayload } from '../../lib/messaging/core-event-handler.js';
import type { ICacheProvider } from '../../pkg/cache/cache.interface.js';
import type { PermissionCacheService } from '../rbac/service/permission-cache.service.js';

export const internalRouter = Router();

internalRouter.post('/webhooks/core', requireInternalHmac, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { eventType, payload } = req.body as { eventType?: string; payload?: Record<string, unknown> };

        if (!eventType || typeof eventType !== 'string') {
            throw new AppError('MissingEventType', 400);
        }
        if (!payload || typeof payload !== 'object') {
            throw new AppError('MissingPayload', 400);
        }

        const cache = container.resolve<ICacheProvider>(TOKENS.CacheProvider);
        const permCacheSvc = container.resolve<PermissionCacheService>(TOKENS.PermissionCacheService);

        await handleCoreEventPayload(eventType, payload, cache, permCacheSvc);

        sendSuccess(res, { ok: true });
    } catch (err) {
        next(err);
    }
});
