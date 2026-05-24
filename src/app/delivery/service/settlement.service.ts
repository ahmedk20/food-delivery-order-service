import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../../../lib/di/tokens.js';
import { db } from '../../../lib/knex/knex.js';
import type { ICacheProvider } from '../../../pkg/cache/cache.interface.js';
import type { ISocketServer } from '../../../lib/websocket/ws-server.js';
import { WS_EVENTS, agentRoom, orderRoom, customerRoom, restaurantBranchRoom } from '../../../lib/websocket/events.js';
import { writeOutboxEvent } from '../../../lib/outbox/writer.js';
import { updateDelivery } from '../repository/delivery.repo.js';
import { createAgentEarnings } from '../repository/agent-earnings.repo.js';
import type { PaymentService } from '../../payment/service/payment.service.js';
import type { OrderService } from '../../order/service/order.service.js';
import type { OrderEntity } from '../../order/entity/order.entity.js';
import { env } from '../../../lib/config/env.js';

const BUSY_SET_KEY = (region: string) => `presence:busy:${region}`;

@injectable()
export class SettlementService {
    constructor(
        @inject(TOKENS.CacheProvider)  private readonly cache: ICacheProvider,
        @inject(TOKENS.SocketServer)   private readonly socket: ISocketServer,
        @inject(TOKENS.PaymentService) private readonly paymentService: PaymentService,
        @inject(TOKENS.OrderService)   private readonly orderService: OrderService,
    ) {}

    /**
     * Single transaction that runs on the `delivered` transition:
     *   1. Settle payment (COD flip or online verify) + restaurant balance.
     *   2. Flip delivery row to delivered.
     *   3. Flip order status to delivered.
     *   4. Mint agent earnings.
     *   5. Emit transactional outbox event.
     *
     * After commit: free the agent's busy slot, invalidate caches, broadcast WS.
     */
    async settleAndDeliver(
        deliveryId: number,
        order: OrderEntity,
        region: string,
        agentId: number,
        now: Date,
    ): Promise<void> {
        const agentEarning = Math.floor(order.deliveryFee * env.delivery.agentEarningShareBps / 10_000);

        const trx = await db(region).transaction();
        try {
            await this.paymentService.settleDelivery(order, region, trx);

            await updateDelivery(deliveryId, region, {
                status:        'delivered',
                deliveredAt:   now,
                earningAmount: agentEarning > 0 ? agentEarning : null,
            }, trx);

            await this.orderService.internalUpdateStatus(order.id, region, 'delivered', {
                deliveredAt: now,
            }, trx);

            if (agentEarning > 0) {
                await createAgentEarnings({
                    agentId,
                    orderId:    order.id,
                    deliveryId,
                    amount:     agentEarning,
                    currency:   order.currency,
                    region,
                }, trx);
            }

            await writeOutboxEvent(trx, region, 'order.delivered', String(order.id), {
                orderId:     order.id,
                customerId:  order.customerId,
                agentId,
                deliveredAt: now.toISOString(),
            });

            await trx.commit();
        } catch (err) {
            await trx.rollback();
            throw err;
        }

        // Post-commit side effects (best-effort — financial state is already committed).
        this.cache.sRem(BUSY_SET_KEY(region), String(agentId)).catch(() => {});
        this.cache.delete(`${region}:os:order:${order.publicId}`).catch(() => {});
        this.cache.delete(`${region}:os:balance:${order.restaurantId}`).catch(() => {});

        const deliveredPayload = {
            orderPublicId: order.publicId,
            deliveryId,
            status:        'delivered' as const,
            updatedAt:     now.toISOString(),
        };
        this.socket.emitToRoom(customerRoom(order.customerId),        WS_EVENTS.DELIVERY_STATUS_CHANGED, deliveredPayload);
        this.socket.emitToRoom(restaurantBranchRoom(order.branchId),  WS_EVENTS.DELIVERY_STATUS_CHANGED, deliveredPayload);
        this.socket.emitToRoom(agentRoom(agentId),                    WS_EVENTS.DELIVERY_STATUS_CHANGED, deliveredPayload);
        this.socket.emitToRoom(orderRoom(order.publicId),             WS_EVENTS.ORDER_STATUS_CHANGED, {
            orderId:   order.publicId,
            status:    'delivered',
            updatedAt: now.toISOString(),
        });
    }
}
