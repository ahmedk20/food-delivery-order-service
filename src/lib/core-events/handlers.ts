import logger from '../logger/logger.js';
import type { ICacheProvider } from '../../pkg/cache/cache.interface.js';
import type { PermissionCacheService } from '../rbac/permission-cache.service.js';

export async function handleCoreEventPayload(
    routingKey: string,
    payload: Record<string, unknown>,
    cache: ICacheProvider,
    permissionCacheService: PermissionCacheService,
): Promise<void> {
    switch (routingKey) {
        case 'rbac.permissions_changed':
            permissionCacheService.invalidate(payload.roleName as string);
            break;

        case 'product.price_changed':
        case 'product.stock_changed': {
            // Key written by CoreDataCacheService.getProduct: os:product:{productId}:branch:{branchId}
            const productId = payload.productId;
            const branchId  = payload.branchId;
            if (productId !== undefined && branchId !== undefined) {
                await cache.delete(`os:product:${productId}:branch:${branchId}`);
            } else if (productId !== undefined) {
                // branchId not in payload — delete all cached variants for this product
                // by clearing branch metadata so next order re-fetches from core service
                logger.debug('product cache evict: branchId missing in payload, clearing product key only', { productId });
                await cache.delete(`os:product:${productId}`);
            }
            break;
        }

        case 'branch.deactivated':
        case 'branch.updated': {
            // Branch metadata is cached at core:branch:{branchId} (no region prefix)
            const branchId = payload.branchId;
            if (branchId !== undefined) {
                await cache.delete(`core:branch:${branchId}`);
            }
            break;
        }

        case 'restaurant.suspended': {
            // We don't have the branch list here — evict what we can; short-TTL order lists expire on their own
            const branchId = payload.branchId;
            if (branchId !== undefined) {
                await cache.delete(`core:branch:${branchId}`);
            }
            break;
        }

        default:
            logger.debug('Core event ignored (unknown routing key)', { routingKey });
    }
}
