import { createHash } from 'node:crypto';
import logger from '../logger/logger.js';
import { env } from '../config/env.js';
import type { IMessageBroker, ConsumerOptions } from '../../pkg/messaging/message-broker.interface.js';
import type { ICacheProvider } from '../../pkg/cache/cache.interface.js';
import type { PermissionCacheService } from '../rbac/permission-cache.service.js';
import { handleCoreEventPayload } from '../../app/order/core-events.handlers.js';

function buildConsumerOpts(): ConsumerOptions {
    return {
        exchange:           env.rabbitmq.coreEvents.exchange,
        queue:              env.rabbitmq.coreEvents.queue,
        bindingKeys:        ['product.#', 'restaurant.#', 'branch.#', 'rbac.#'],
        prefetch:           env.rabbitmq.coreEvents.prefetch,
        deadLetterExchange: env.rabbitmq.coreEvents.dlx,
        deadLetterQueue:    env.rabbitmq.coreEvents.dlq,
    };
}

const DEDUP_TTL_SECONDS = 3600;

function hashBody(body: Buffer): string {
    return createHash('sha256').update(body).digest('hex').slice(0, 16);
}

export async function startCoreEventConsumer(
    broker: IMessageBroker,
    cache: ICacheProvider,
    permissionCacheService: PermissionCacheService,
): Promise<void> {
    await broker.consume(buildConsumerOpts(), async (msg) => {
        const dedupKey = `os:consumed:${msg.routingKey}:${hashBody(msg.body)}`;
        const isFirst = await cache.trySet(dedupKey, '1', DEDUP_TTL_SECONDS);
        if (!isFirst) {
            msg.ack();
            return;
        }

        const payload = JSON.parse(msg.body.toString());
        await handleCoreEventPayload(msg.routingKey, payload, cache, permissionCacheService);
        msg.ack();
    });

    logger.info('Core event consumer started', { queue: env.rabbitmq.coreEvents.queue });
}
