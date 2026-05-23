import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../../../lib/di/tokens.js';
import { db } from '../../../lib/knex/knex.js';
import AppError from '../../../lib/error/AppError.js';
import { SystemRole } from '../../../lib/auth/enums.js';
import type { ISocketServer } from '../../../lib/websocket/ws-server.js';
import { orderRoom, restaurantBranchRoom, customerRoom, WS_EVENTS } from '../../../lib/websocket/events.js';
import { writeOutboxEvent } from '../../../lib/outbox/writer.js';
import {
    findOrderByPublicId,
    updateOrderStatus as repoUpdateOrderStatus,
} from '../repository/order.repo.js';
import { findItemsByOrderId } from '../repository/order-item.repo.js';
import {
    OrderNotFoundError,
    OrderAccessDeniedError,
    OrderAlreadyFinalizedError,
    InvalidStatusTransitionError,
    CancellationWindowExpiredError,
} from '../errors.js';
import type { UpdateOrderStatusDTO } from '../dto/update-order-status.dto.js';
import type { OrderResponseDTO } from '../dto/order-response.dto.js';
import { OrderEntity } from '../entity/order.entity.js';
import type { OrderItemEntity } from '../entity/order-item.entity.js';
import type { OrderStatus } from '../enums.js';

const TERMINAL_STATUSES = new Set(['delivered', 'rejected', 'cancelled']);

function toOrderItemResponseDTO(item: OrderItemEntity) {
    return {
        id:              item.id,
        productId:       item.productId,
        productName:     item.productName,
        productImageUrl: item.productImageUrl,
        unitPrice:       item.unitPrice,
        quantity:        item.quantity,
        subtotal:        item.subtotal,
        notes:           item.notes,
    };
}

@injectable()
export class OrderStatusService {
    constructor(
        @inject(TOKENS.SocketServer) private readonly socket: ISocketServer,
    ) {}

    updateStatus = async (
        publicId: string,
        region: string,
        actorId: number,
        actorRole: string,
        dto: UpdateOrderStatusDTO,
    ): Promise<OrderResponseDTO> => {
        const order = await findOrderByPublicId(publicId, region);
        if (!order) throw OrderNotFoundError();

        const from = order.status;
        const to   = dto.status;

        if (TERMINAL_STATUSES.has(from)) throw OrderAlreadyFinalizedError();

        if (actorRole !== SystemRole.SYSTEM_ADMIN) {
            if (actorRole === SystemRole.CUSTOMER) {
                if (order.customerId !== actorId) throw OrderAccessDeniedError();

                const allowed: Partial<Record<string, string[]>> = {
                    pending_payment: ['cancelled'],
                    placed:          ['cancelled'],
                };
                if (!allowed[from]?.includes(to)) throw InvalidStatusTransitionError(from, to);

                if (from === 'placed' && order.acceptedAt) throw CancellationWindowExpiredError();

            } else if (actorRole === SystemRole.RESTAURANT_USER) {
                const allowed: Partial<Record<string, string[]>> = {
                    placed:    ['accepted', 'rejected', 'cancelled'],
                    accepted:  ['preparing', 'cancelled'],
                    preparing: ['ready', 'cancelled'],
                };
                if (!allowed[from]?.includes(to)) throw InvalidStatusTransitionError(from, to);
            } else {
                throw InvalidStatusTransitionError(from, to);
            }
        }

        if ((to === 'rejected' || to === 'cancelled') && !dto.reason) {
            throw new AppError('ReasonRequired', 422);
        }

        const extra: Parameters<typeof repoUpdateOrderStatus>[3] = {};
        if (to === 'accepted')  {
            extra.acceptedAt = new Date();
            if (dto.estimatedDeliveryAt) extra.estimatedDeliveryAt = new Date(dto.estimatedDeliveryAt);
        }
        if (to === 'rejected')  { extra.rejectedAt = new Date(); extra.cancellationReason = dto.reason; }
        if (to === 'ready')     { extra.readyAt = new Date(); }
        if (to === 'cancelled') {
            extra.cancelledAt        = new Date();
            extra.cancellationReason = dto.reason ?? null;
        }

        const trx = await db(region).transaction();
        let updated!: OrderEntity;
        try {
            updated = await repoUpdateOrderStatus(order.id, region, to, extra, trx);

            await writeOutboxEvent(trx, region, 'order.status_changed', String(order.id), {
                orderId:   order.id,
                status:    to,
                updatedAt: new Date().toISOString(),
            });

            if (to === 'cancelled') {
                await writeOutboxEvent(trx, region, 'order.cancelled', String(order.id), {
                    orderId:    order.id,
                    customerId: order.customerId,
                    reason:     dto.reason ?? null,
                });
            }

            await trx.commit();
        } catch (err) {
            await trx.rollback();
            throw err;
        }

        const statusPayload = { orderId: publicId, status: to, updatedAt: new Date().toISOString() };
        this.socket.emitToRoom(orderRoom(publicId),                         WS_EVENTS.ORDER_STATUS_CHANGED, statusPayload);
        this.socket.emitToRoom(restaurantBranchRoom(order.branchId),        WS_EVENTS.ORDER_STATUS_CHANGED, statusPayload);
        this.socket.emitToRoom(customerRoom(order.customerId),              WS_EVENTS.ORDER_STATUS_CHANGED, statusPayload);

        if (to === 'cancelled') {
            const cancelPayload = { orderId: publicId, reason: dto.reason ?? null, updatedAt: new Date().toISOString() };
            this.socket.emitToRoom(orderRoom(publicId),            WS_EVENTS.ORDER_CANCELLED, cancelPayload);
            this.socket.emitToRoom(customerRoom(order.customerId), WS_EVENTS.ORDER_CANCELLED, cancelPayload);
        }

        const items = await findItemsByOrderId(updated.id, region);
        return {
            id:                      updated.publicId,
            restaurantId:            updated.restaurantId,
            branchId:                updated.branchId,
            status:                  updated.status,
            paymentMethod:           updated.paymentMethod,
            subtotal:                updated.subtotal,
            deliveryFee:             updated.deliveryFee,
            serviceFee:              updated.serviceFee,
            discount:                updated.discount,
            commission:              updated.commission,
            total:                   updated.total,
            currency:                updated.currency,
            notes:                   updated.notes,
            estimatedDeliveryAt:     updated.estimatedDeliveryAt,
            deliveredAt:             updated.deliveredAt,
            cancelledAt:             updated.cancelledAt,
            deliveryAddressSnapshot: updated.deliveryAddressSnapshot,
            cancellationReason:      updated.cancellationReason,
            items:                   items.map(toOrderItemResponseDTO),
            createdAt:               updated.createdAt,
        } as OrderResponseDTO;
    };

    internalUpdateStatus = async (
        orderId: number,
        region: string,
        status: OrderStatus,
        extra: Parameters<typeof repoUpdateOrderStatus>[3] = {},
        conn?: import('knex').Knex,
    ): Promise<void> => {
        await repoUpdateOrderStatus(orderId, region, status, extra, conn);
    };
}
