import logger from '../../lib/logger/logger.js';
import type { ICacheProvider } from '../../pkg/cache/cache.interface.js';
import type { PermissionCacheService } from '../../lib/rbac/permission-cache.service.js';

export async function handleCoreEventPayload(
    routingKey: string,
    payload: Record<string, unknown>,
    cache: ICacheProvider,
    permissionCacheService: PermissionCacheService,
): Promise<void> {
    switch (routingKey) {
        case 'rbac.permissions_changed':
            await permissionCacheService.invalidate(payload.roleName as string);
            break;
        case 'product.price_changed':
        case 'product.stock_changed':
            await cache.delete(`os:product:${payload.productId}`);
            break;
        case 'restaurant.suspended':
        case 'branch.deactivated':
            await cache.delete(`os:orders:branch:${payload.branchId}:*`);
            break;
        default:
            logger.debug('Core event ignored (unknown routing key)', { routingKey });
    }
}
