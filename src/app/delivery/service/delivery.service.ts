import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../../../lib/di/tokens.js';
import { db } from '../../../lib/knex/knex.js';
import { env } from '../../../lib/config/env.js';
import AppError from '../../../lib/error/AppError.js';
import logger from '../../../lib/logger/logger.js';
import type { ICacheProvider } from '../../../pkg/cache/cache.interface.js';
import type { ISocketServer } from '../../../lib/websocket/ws-server.js';
import {
    WS_EVENTS,
    agentRoom,
    orderRoom,
    restaurantBranchRoom,
    customerRoom,
} from '../../../lib/websocket/events.js';
import type { OrderService } from '../../order/service/order.service.js';
import type { PaymentService } from '../../payment/service/payment.service.js';
import {
    findDeliveryById,
    findActiveDeliveryByOrderId,
    createDelivery,
    updateDelivery,
} from '../repository/delivery.repo.js';
import {
    findAgentPresenceById,
    findNearestAvailableAgents,
    setAgentAvailability,
} from '../repository/agent-presence.repo.js';
import { createAgentEarnings } from '../repository/agent-earnings.repo.js';
import { incrementReassignmentCount } from '../../order/repository/order.repo.js';
import {
    OrderNotReadyError,
    OrderAlreadyHasActiveDeliveryError,
    NoEligibleAgentsError,
    MaxReassignmentAttemptsReachedError,
    DeliveryNotFoundError,
    DeliveryNotOwnedByAgentError,
    InvalidDeliveryStatusTransitionError,
    AgentInActiveDeliveryError,
} from '../errors.js';
import type { AssignDeliveryDTO } from '../dto/assign-delivery.dto.js';
import type { UpdateDeliveryStatusDTO } from '../dto/update-delivery-status.dto.js';
import { toDeliveryResponseDTO, type DeliveryResponseDTO } from '../dto/delivery-response.dto.js';
import { OrderNotFoundError } from '../../order/errors.js';

const BUSY_SET_KEY = (region: string) => `presence:busy:${region}`;

@injectable()
export class DeliveryService {
    constructor(
        @inject(TOKENS.CacheProvider)  private readonly cache: ICacheProvider,
        @inject(TOKENS.SocketServer)   private readonly socket: ISocketServer,
        @inject(TOKENS.OrderService)   private readonly orderService: OrderService,
        @inject(TOKENS.PaymentService) private readonly paymentService: PaymentService,
    ) {}

    assignDelivery = async (
        orderPublicId: string,
        region: string,
        dto: AssignDeliveryDTO,
    ): Promise<DeliveryResponseDTO> => {
        const order = await this.orderService.getOrderEntity(orderPublicId, region);
        if (!order) throw OrderNotFoundError();
        if (order.status !== 'ready') throw OrderNotReadyError();

        // Application-layer cross-partition check (DB index only guards within partition)
        const existing = await findActiveDeliveryByOrderId(order.id, region);
        if (existing) throw OrderAlreadyHasActiveDeliveryError();

        const agentId = dto.agentId
            ? await this._validateManualAgent(dto.agentId, region)
            : await this._autoSelectAgent(order.deliveryLat, order.deliveryLng, region);

        const now      = new Date();
        const trx      = await db(region).transaction();
        try {
            const delivery = await createDelivery({
                region,
                orderId:         order.id,
                agentId,
                status:          'assigned',
                pickupLat:       null,
                pickupLng:       null,
                dropoffLat:      order.deliveryLat,
                dropoffLng:      order.deliveryLng,
                distanceMeters:  null,
                earningAmount:   null,
                currency:        order.currency,
                reassignedFrom:  null,
                assignedAt:      now,
                acceptedAt:      null,
                rejectedAt:      null,
                pickedAt:        null,
                deliveredAt:     null,
                cancelledAt:     null,
                reassignedAt:    null,
                rejectionReason: null,
            }, region, trx);

            await this.orderService.internalUpdateStatus(order.id, region, 'assigned', {
                deliveryAgentId: agentId,
                assignedAt:      now,
            }, trx);

            await trx.commit();

            this.cache.sAdd(BUSY_SET_KEY(region), String(agentId)).catch(() => {});

            this.socket.emitToRoom(agentRoom(agentId), WS_EVENTS.TASK_ASSIGNED, {
                deliveryId:    delivery.id,
                orderPublicId: order.publicId,
                status:        delivery.status,
                dropoff:       { lat: order.deliveryLat, lng: order.deliveryLng },
                currency:      order.currency,
                assignedAt:    delivery.assignedAt.toISOString(),
            });

            return toDeliveryResponseDTO(delivery, order.publicId);
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    };

    reassignDelivery = async (
        orderPublicId: string,
        region: string,
        dto: AssignDeliveryDTO,
    ): Promise<DeliveryResponseDTO> => {
        const order = await this.orderService.getOrderEntity(orderPublicId, region);
        if (!order) throw OrderNotFoundError();

        if (order.reassignmentCount >= env.delivery.maxReassignmentAttempts) {
            throw MaxReassignmentAttemptsReachedError();
        }

        const activeDelivery = await findActiveDeliveryByOrderId(order.id, region);
        if (!activeDelivery) throw new AppError('NoActiveDelivery', 409);

        const oldAgentId = activeDelivery.agentId;
        const now        = new Date();

        const trx = await db(region).transaction();
        try {
            await updateDelivery(activeDelivery.id, region, {
                status:        'reassigned',
                reassignedAt:  now,
            }, trx);

            await incrementReassignmentCount(order.id, region, trx);
            await trx.commit();
        } catch (err) {
            await trx.rollback();
            throw err;
        }

        // Release old agent
        this.cache.sRem(BUSY_SET_KEY(region), String(oldAgentId)).catch(() => {});
        setAgentAvailability(oldAgentId, true, region).catch(() => {});
        this.socket.emitToRoom(agentRoom(oldAgentId), WS_EVENTS.TASK_CANCELLED, {
            deliveryId: activeDelivery.id,
            reason:     'reassigned',
        });

        // Assign a new agent (re-use assignDelivery logic)
        return this.assignDelivery(orderPublicId, region, dto);
    };

    updateDeliveryStatus = async (
        deliveryId: number,
        region: string,
        agentId: number,
        dto: UpdateDeliveryStatusDTO,
    ): Promise<DeliveryResponseDTO> => {
        const delivery = await findDeliveryById(deliveryId, region);
        if (!delivery) throw DeliveryNotFoundError();
        if (delivery.agentId !== agentId) throw DeliveryNotOwnedByAgentError();

        const from = delivery.status;
        const to   = dto.status;

        const allowed: Partial<Record<string, string[]>> = {
            assigned: ['accepted', 'rejected'],
            accepted: ['picked'],
            picked:   ['delivered'],
        };
        if (!allowed[from]?.includes(to)) {
            throw InvalidDeliveryStatusTransitionError(from, to);
        }

        if (to === 'rejected' && !dto.reason) {
            throw new AppError('ReasonRequired', 422);
        }

        const order = await this.orderService.getOrderEntityById(delivery.orderId, region);
        if (!order) throw OrderNotFoundError();

        const now = new Date();

        if (to === 'delivered') {
            await this._settleAndDeliver(delivery.id, delivery, order, region, agentId, now);
        } else {
            const trx = await db(region).transaction();
            try {
                const updates: Parameters<typeof updateDelivery>[2] = { status: to };
                if (to === 'accepted') updates.acceptedAt     = now;
                if (to === 'rejected') { updates.rejectedAt = now; updates.rejectionReason = dto.reason; }
                if (to === 'picked')   updates.pickedAt       = now;

                await updateDelivery(delivery.id, region, updates, trx);

                if (to === 'picked') {
                    await this.orderService.internalUpdateStatus(order.id, region, 'picked', {
                        pickedAt: now,
                    }, trx);
                }

                await trx.commit();
            } catch (err) {
                await trx.rollback();
                throw err;
            }

            if (to === 'rejected') {
                this.cache.sRem(BUSY_SET_KEY(region), String(agentId)).catch(() => {});
                setAgentAvailability(agentId, true, region).catch(() => {});
                this.socket.emitToRoom(agentRoom(agentId), WS_EVENTS.TASK_CANCELLED, {
                    deliveryId: delivery.id,
                    reason:     dto.reason ?? 'agent_rejected',
                });
                // Auto-reassign if attempts remain
                if (order.reassignmentCount < env.delivery.maxReassignmentAttempts) {
                    this.reassignDelivery(order.publicId, region, {}).catch((err) => {
                        logger.warn('Auto-reassign failed after rejection', {
                            orderId: order.id, reason: String(err),
                        });
                    });
                } else {
                    logger.warn('Max reassignment attempts reached — admin alert needed', {
                        orderId: order.id,
                    });
                }
            }
        }

        const updated = await findDeliveryById(delivery.id, region);
        if (!updated) throw DeliveryNotFoundError();

        if (to !== 'rejected') {
            const wsPayload = {
                orderPublicId: order.publicId,
                deliveryId:    delivery.id,
                status:        to,
                updatedAt:     now.toISOString(),
            };
            this.socket.emitToRoom(customerRoom(order.customerId), WS_EVENTS.DELIVERY_STATUS_CHANGED, wsPayload);
            this.socket.emitToRoom(restaurantBranchRoom(order.branchId), WS_EVENTS.DELIVERY_STATUS_CHANGED, wsPayload);
        }

        return toDeliveryResponseDTO(updated, order.publicId);
    };

    // ── Private helpers ───────────────────────────────────────────────────────

    private async _validateManualAgent(agentId: number, region: string): Promise<number> {
        const presence = await findAgentPresenceById(agentId, region);
        if (!presence || !presence.isOnline || !presence.isAvailable) {
            throw AgentInActiveDeliveryError();
        }
        const isBusy = await this.cache.sIsMember(BUSY_SET_KEY(region), String(agentId))
            .catch(() => false);
        if (isBusy) throw AgentInActiveDeliveryError();
        return agentId;
    }

    private async _autoSelectAgent(
        lat: number,
        lng: number,
        region: string,
    ): Promise<number> {
        const candidates = await findNearestAvailableAgents(lat, lng, region, 5);

        for (const candidate of candidates) {
            const isBusy = await this.cache.sIsMember(
                BUSY_SET_KEY(region), String(candidate.agentId),
            ).catch(() => false);
            if (!isBusy) return candidate.agentId;
        }

        throw NoEligibleAgentsError();
    }

    private async _settleAndDeliver(
        deliveryId: number,
        delivery: import('../entity/delivery.entity.js').DeliveryEntity,
        order: import('../../order/entity/order.entity.js').OrderEntity,
        region: string,
        agentId: number,
        now: Date,
    ): Promise<void> {
        const agentShareRate  = env.delivery.agentShareRate;
        const agentEarning    = Math.floor(order.deliveryFee * agentShareRate);

        const trx = await db(region).transaction();
        try {
            // Settle payment + restaurant balance (online verify, COD flip, balance move)
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

            await trx.commit();
        } catch (err) {
            await trx.rollback();
            throw err;
        }

        // Post-commit side effects (best-effort)
        this.cache.sRem(BUSY_SET_KEY(region), String(agentId)).catch(() => {});
        setAgentAvailability(agentId, true, region).catch(() => {});
        this.cache.delete(`${region}:os:order:${order.publicId}`).catch(() => {});

        const deliveredPayload = {
            orderPublicId: order.publicId,
            deliveryId,
            status:        'delivered' as const,
            updatedAt:     now.toISOString(),
        };
        this.socket.emitToRoom(customerRoom(order.customerId), WS_EVENTS.DELIVERY_STATUS_CHANGED, deliveredPayload);
        this.socket.emitToRoom(restaurantBranchRoom(order.branchId), WS_EVENTS.DELIVERY_STATUS_CHANGED, deliveredPayload);
        this.socket.emitToRoom(agentRoom(agentId), WS_EVENTS.DELIVERY_STATUS_CHANGED, deliveredPayload);
        this.socket.emitToRoom(orderRoom(order.publicId), WS_EVENTS.ORDER_STATUS_CHANGED, {
            orderId:   order.publicId,
            status:    'delivered',
            updatedAt: now.toISOString(),
        });
    }
}
