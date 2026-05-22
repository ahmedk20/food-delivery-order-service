import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../../../lib/di/tokens.js';
import { db } from '../../../lib/knex/knex.js';
import AppError from '../../../lib/error/AppError.js';
import { SystemRole } from '../../../lib/auth/enums.js';
import { parsePaginationQuery, parseFilters } from '../../../lib/http/pagination/parse-query.js';
import type { ICoreServiceClient } from '../../../lib/http/core-service-client.interface.js';
import type { ICacheProvider } from '../../../pkg/cache/cache.interface.js';
import type { ISocketServer } from '../../../lib/websocket/ws-server.js';
import type { PlaceOrderDTO } from '../dto/place-order.dto.js';
import type { CancelOrderDTO } from '../dto/cancel-order.dto.js';
import type {
    OrderItemResponseDTO,
    OrderResponseDTO,
    OrderSummaryResponseDTO,
} from '../dto/order-response.dto.js';
import { Order, type DeliveryAddressSnapshot } from '../entity/order.entity.js';
import { OrderItem } from '../entity/order-item.entity.js';
import {
    createOrder,
    findOrderById,
    findOrderByPublicId,
    findOrdersByCustomer,
    updateOrderStatus,
    type OrderFilterField,
    type OrderSortField,
} from '../repository/order.repo.js';
import { createOrderItems, findItemsByOrderId } from '../repository/order-item.repo.js';
import {
    InvalidStatusTransitionError,
    OrderNotFoundError,
} from '../errors.js';
import {
    orderRoom,
    restaurantBranchRoom,
    WS_EVENTS,
} from '../../../lib/websocket/events.js';

const ORDER_CACHE_TTL = 300;

function orderCacheKey(region: string, publicId: string): string {
    return `${region}:os:order:${publicId}`;
}

function toOrderItemResponseDTO(item: OrderItem): OrderItemResponseDTO {
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

function toOrderSummaryResponseDTO(order: Order): OrderSummaryResponseDTO {
    return {
        id:                  order.publicId,   // expose publicId, never the bigint
        restaurantId:        order.restaurantId,
        branchId:            order.branchId,
        status:              order.status,
        paymentMethod:       order.paymentMethod,
        itemsTotal:          order.itemsTotal,
        deliveryFee:         order.deliveryFee,
        discount:            order.discount,
        totalAmount:         order.totalAmount,
        currency:            order.currency,
        notes:               order.notes,
        estimatedDeliveryAt: order.estimatedDeliveryAt,
        deliveredAt:         order.deliveredAt,
        cancelledAt:         order.cancelledAt,
        createdAt:           order.createdAt,
    };
}

function toOrderResponseDTO(order: Order, items: OrderItem[]): OrderResponseDTO {
    return {
        ...toOrderSummaryResponseDTO(order),
        deliveryAddressSnapshot: order.deliveryAddressSnapshot,
        cancellationReason:      order.cancellationReason,
        items:                   items.map(toOrderItemResponseDTO),
    };
}

@injectable()
export class OrderService {
    constructor(
        @inject(TOKENS.CoreServiceClient) private readonly coreClient: ICoreServiceClient,
        @inject(TOKENS.CacheProvider)     private readonly cache: ICacheProvider,
        @inject(TOKENS.SocketServer)      private readonly socket: ISocketServer,
    ) {}

    placeOrder = async (
        customerId: number,
        region: string,
        dto: PlaceOrderDTO,
        correlationId?: string,
    ): Promise<OrderResponseDTO> => {
        // 1. Validate all products in parallel
        const products = await Promise.all(
            dto.items.map(item =>
                this.coreClient.getProductWithBranchDetails(item.productId, dto.branchId, correlationId),
            ),
        );

        for (let i = 0; i < products.length; i++) {
            const product = products[i];
            const item    = dto.items[i];
            if (!product.isAvailable || product.stock < item.quantity) {
                throw new AppError(
                    `Product '${product.name}' is not available or has insufficient stock`,
                    422,
                );
            }
        }

        const restaurantId = products[0].restaurantId;
        for (const product of products) {
            if (product.restaurantId !== restaurantId) {
                throw new AppError('All items must be from the same restaurant', 422);
            }
        }

        // 2. Validate address ownership
        const address = await this.coreClient.getAddressById(dto.deliveryAddressId, correlationId);
        if (address.userId !== customerId) {
            throw new AppError('Address does not belong to you', 403);
        }

        // 3. Build address snapshot
        const snapshot: DeliveryAddressSnapshot = {
            id:              address.id,
            label:           address.label,
            country:         address.country,
            city:            address.city,
            street:          address.street,
            building:        address.building,
            apartmentNumber: address.apartmentNumber,
            type:            address.type,
            lat:             address.lat,
            lng:             address.lng,
        };

        // 4. Compute totals (minor currency units)
        const itemsTotal  = dto.items.reduce((sum, item, i) => sum + products[i].price * item.quantity, 0);
        const totalAmount = itemsTotal; // deliveryFee and discount are 0 in v1

        // currency is resolved once at placement from the countryCode on the JWT
        const countryCode = address.country;
        const currency    = 'EGP'; // TODO: Phase 3.0 — currencyForCountry(countryCode)

        // 5. Persist inside a DB transaction
        const trx = await db(region).transaction();
        try {
            const order = await createOrder(
                {
                    region,
                    publicId:                '',   // DB generates via gen_random_uuid()
                    countryCode,
                    currency,
                    customerId,
                    restaurantId,
                    branchId:                dto.branchId,
                    deliveryAddressId:       dto.deliveryAddressId,
                    deliveryAddressSnapshot: snapshot,
                    deliveryAgentId:         null,
                    status:                  'pending',
                    paymentMethod:           dto.paymentMethod,
                    itemsTotal,
                    deliveryFee:             0,
                    discount:                0,
                    totalAmount,
                    notes:                   dto.notes ?? null,
                    estimatedDeliveryAt:     null,
                    deliveryStartedAt:       null,
                    deliveredAt:             null,
                    cancelledAt:             null,
                    cancellationReason:      null,
                },
                region,
                trx,
            );

            const items = await createOrderItems(
                dto.items.map((item, i) => ({
                    orderId:         order.id,
                    region,
                    productId:       item.productId,
                    productName:     products[i].name,
                    productImageUrl: products[i].imageUrl,
                    unitPrice:       products[i].price,
                    quantity:        item.quantity,
                    subtotal:        products[i].price * item.quantity,
                    notes:           item.notes ?? null,
                })),
                region,
                trx,
            );

            await trx.commit();

            // Notify the restaurant branch dashboard a new order arrived
            this.socket.emitToRoom(restaurantBranchRoom(order.branchId), WS_EVENTS.ORDER_CREATED, {
                orderId:    order.publicId,
                customerId: order.customerId,
                itemsTotal: order.itemsTotal,
                createdAt:  order.createdAt,
            });

            return toOrderResponseDTO(order, items);
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    };

    listOrders = async (
        customerId: number,
        region: string,
        query: Record<string, any>,
    ): Promise<{
        data: OrderSummaryResponseDTO[];
        meta: { hasMore: boolean; nextCursor: number | null; count: number };
    }> => {
        const pagination = parsePaginationQuery<Record<string, any>, OrderSortField>(
            query, ['id'], 'id',
        );
        const filters = parseFilters<Record<string, any>, OrderFilterField>(query, ['status']);

        const result = await findOrdersByCustomer(customerId, region, pagination, filters);
        return {
            data: result.data.map(toOrderSummaryResponseDTO),
            meta: result.meta,
        };
    };

    getOrderByPublicId = async (
        publicId: string,
        region: string,
        userId: number,
        role: string,
    ): Promise<OrderResponseDTO> => {
        const order = await findOrderByPublicId(publicId, region);
        if (!order) throw OrderNotFoundError();

        if (role === SystemRole.CUSTOMER && order.customerId !== userId) {
            throw new AppError('Forbidden', 403);
        }
        if (role === SystemRole.DELIVERY_AGENT) {
            throw new AppError('Forbidden', 403);
        }

        let cached: string | null = null;
        try {
            cached = await this.cache.get(orderCacheKey(region, publicId));
        } catch { /* Redis down — fall through to DB */ }
        if (cached) return JSON.parse(cached) as OrderResponseDTO;

        const items  = await findItemsByOrderId(order.id, region);
        const result = toOrderResponseDTO(order, items);

        this.cache.set(orderCacheKey(region, publicId), JSON.stringify(result), ORDER_CACHE_TTL)
            .catch(() => {});

        return result;
    };

    cancelOrder = async (
        publicId: string,
        region: string,
        customerId: number,
        dto: CancelOrderDTO,
    ): Promise<OrderResponseDTO> => {
        const order = await findOrderByPublicId(publicId, region);
        if (!order) throw OrderNotFoundError();

        if (order.customerId !== customerId) throw new AppError('Forbidden', 403);
        if (order.status !== 'pending') throw InvalidStatusTransitionError(order.status);

        const updated = await updateOrderStatus(order.id, region, 'cancelled', {
            cancelledAt:        new Date(),
            cancellationReason: dto.cancellationReason ?? null,
        });

        this.cache.delete(orderCacheKey(region, publicId)).catch(() => {});

        this.socket.emitToRoom(orderRoom(order.publicId), WS_EVENTS.ORDER_CANCELLED, {
            orderId: order.publicId,
            reason:  dto.cancellationReason ?? null,
        });

        const items = await findItemsByOrderId(order.id, region);
        return toOrderResponseDTO(updated, items);
    };
}
