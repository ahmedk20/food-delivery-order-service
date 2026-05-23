import { createHash } from 'node:crypto';
import logger from '../logger/logger.js';
import type { IMessageBroker, ConsumerOptions } from '../../pkg/messaging/message-broker.interface.js';
import type { ICacheProvider } from '../../pkg/cache/cache.interface.js';
import type { PermissionCacheService } from '../../app/rbac/service/permission-cache.service.js';

const CORE_EVENTS_CONSUMER_OPTS: ConsumerOptions = {
    exchange:           'core-service.events',
    queue:              'order-service.core-events',
    bindingKeys:        ['product.#', 'restaurant.#', 'branch.#', 'rbac.#'],
    prefetch:           10,
    deadLetterExchange: 'order-service.core-events.dlx',
    deadLetterQueue:    'order-service.core-events.dead',
};

const DEDUP_TTL_SECONDS = 3600;

function hashBody(body: Buffer): string {
    return createHash('sha256').update(body).digest('hex').slice(0, 16);
}

export async function startCoreEventConsumer(
    broker: IMessageBroker,
    cache: ICacheProvider,
    permissionCacheService: PermissionCacheService,
): Promise<void> {
    await broker.consume(CORE_EVENTS_CONSUMER_OPTS, async (msg) => {
        const dedupKey = `os:consumed:${msg.routingKey}:${hashBody(msg.body)}`;
        const isFirst = await cache.trySet(dedupKey, '1', DEDUP_TTL_SECONDS);
        if (!isFirst) {
            msg.ack();
            return;
        }

        const payload = JSON.parse(msg.body.toString());

        switch (msg.routingKey) {
            case 'rbac.permissions_changed':
                await permissionCacheService.invalidate(payload.roleName);
                break;
            case 'product.price_changed':
            case 'product.stock_changed':
                await cache.delete(`os:product:${payload.productId}`);
                break;
            case 'restaurant.suspended':
                await cache.delete(`os:orders:branch:${payload.branchId}:*`);
                break;
            case 'branch.deactivated':
                await cache.delete(`os:orders:branch:${payload.branchId}:*`);
                break;
            default:
                logger.debug('Core event ignored (unknown routing key)', { routingKey: msg.routingKey });
        }

        msg.ack();
    });

    logger.info('Core event consumer started', { queue: CORE_EVENTS_CONSUMER_OPTS.queue });
}

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
