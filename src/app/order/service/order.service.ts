import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../../../lib/di/tokens.js';
import { db } from '../../../lib/knex/knex.js';
import AppError from '../../../lib/error/AppError.js';
import { SystemRole } from '../../../lib/auth/enums.js';
import { parsePaginationQuery, parseFilters } from '../../../lib/http/pagination/parse-query.js';
import type { ICoreServiceClient } from '../../../pkg/http/http-client.interface.js';
import type { ICacheProvider } from '../../../pkg/cache/cache.interface.js';
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

const ORDER_CACHE_TTL = 300;

function orderCacheKey(id: number, countryCode: string): string {
    return `os:order:${id}:${countryCode}`;
}

function toOrderItemResponseDTO(item: OrderItem): OrderItemResponseDTO {
    return {
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        productImageUrl: item.productImageUrl,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        subtotal: item.subtotal,
        notes: item.notes,
    };
}

function toOrderSummaryResponseDTO(order: Order): OrderSummaryResponseDTO {
    return {
        id: order.id,
        restaurantId: order.restaurantId,
        branchId: order.branchId,
        status: order.status,
        paymentMethod: order.paymentMethod,
        itemsTotal: order.itemsTotal,
        deliveryFee: order.deliveryFee,
        discount: order.discount,
        totalAmount: order.totalAmount,
        notes: order.notes,
        estimatedDeliveryAt: order.estimatedDeliveryAt,
        deliveredAt: order.deliveredAt,
        cancelledAt: order.cancelledAt,
        createdAt: order.createdAt,
    };
}

function toOrderResponseDTO(order: Order, items: OrderItem[]): OrderResponseDTO {
    return {
        ...toOrderSummaryResponseDTO(order),
        deliveryAddressSnapshot: order.deliveryAddressSnapshot,
        cancellationReason: order.cancellationReason,
        items: items.map(toOrderItemResponseDTO),
    };
}

@injectable()
export class OrderService {
    constructor(
        @inject(TOKENS.CoreServiceClient) private readonly coreClient: ICoreServiceClient,
        @inject(TOKENS.CacheProvider) private readonly cache: ICacheProvider,
    ) {}

    placeOrder = async (
        customerId: number,
        countryCode: string,
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
            const item = dto.items[i];
            if (!product.isAvailable || product.stock < item.quantity) {
                throw new AppError(
                    `Product '${product.name}' is not available or has insufficient stock`,
                    422,
                );
            }
        }

        // All products must belong to the same restaurant
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
            id: address.id,
            label: address.label,
            country: address.country,
            city: address.city,
            street: address.street,
            building: address.building,
            apartmentNumber: address.apartmentNumber,
            type: address.type,
            lat: address.lat,
            lng: address.lng,
        };

        // 4. Compute totals
        const itemsTotal = dto.items.reduce(
            (sum, item, i) => sum + products[i].price * item.quantity,
            0,
        );
        const totalAmount = itemsTotal; // deliveryFee=0, discount=0

        // 5. Persist in a transaction
        const trx = await db.transaction();
        try {
            const order = await createOrder(
                {
                    countryCode,
                    customerId,
                    restaurantId,
                    branchId: dto.branchId,
                    deliveryAddressId: dto.deliveryAddressId,
                    deliveryAddressSnapshot: snapshot,
                    deliveryAgentId: null,
                    status: 'pending',
                    paymentMethod: dto.paymentMethod,
                    itemsTotal,
                    deliveryFee: 0,
                    discount: 0,
                    totalAmount,
                    notes: dto.notes ?? null,
                    estimatedDeliveryAt: null,
                    deliveryStartedAt: null,
                    deliveredAt: null,
                    cancelledAt: null,
                    cancellationReason: null,
                },
                trx,
            );

            const items = await createOrderItems(
                dto.items.map((item, i) => ({
                    orderId: order.id,
                    countryCode,
                    productId: item.productId,
                    productName: products[i].name,
                    productImageUrl: products[i].imageUrl,
                    unitPrice: products[i].price,
                    quantity: item.quantity,
                    subtotal: products[i].price * item.quantity,
                    notes: item.notes ?? null,
                })),
                trx,
            );

            await trx.commit();
            return toOrderResponseDTO(order, items);
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    };

    listOrders = async (
        customerId: number,
        countryCode: string,
        query: Record<string, any>,
    ): Promise<{
        data: OrderSummaryResponseDTO[];
        meta: { hasMore: boolean; nextCursor: number | null; count: number };
    }> => {
        const pagination = parsePaginationQuery<Record<string, any>, OrderSortField>(
            query, ['id'], 'id',
        );
        const filters = parseFilters<Record<string, any>, OrderFilterField>(query, ['status']);

        const result = await findOrdersByCustomer(customerId, countryCode, pagination, filters);
        return {
            data: result.data.map(toOrderSummaryResponseDTO),
            meta: result.meta,
        };
    };

    getOrderById = async (
        id: number,
        countryCode: string,
        userId: number,
        role: string,
    ): Promise<OrderResponseDTO> => {
        // Try cache first (non-fatal on Redis failure)
        let cached: string | null = null;
        try {
            cached = await this.cache.get(orderCacheKey(id, countryCode));
        } catch { /* Redis down — fall through to DB */ }
        if (cached) return JSON.parse(cached) as OrderResponseDTO;

        const order = await findOrderById(id, countryCode);
        if (!order) throw OrderNotFoundError();

        // Service-level authorization
        if (role === SystemRole.CUSTOMER && order.customerId !== userId) {
            throw new AppError('Forbidden', 403);
        }
        if (role === SystemRole.RESTAURANT_USER || role === SystemRole.DELIVERY_AGENT) {
            throw new AppError('Forbidden', 403);
        }

        const items = await findItemsByOrderId(id, countryCode);
        const result = toOrderResponseDTO(order, items);

        this.cache.set(orderCacheKey(id, countryCode), JSON.stringify(result), ORDER_CACHE_TTL)
            .catch(() => {});

        return result;
    };

    cancelOrder = async (
        id: number,
        countryCode: string,
        customerId: number,
        dto: CancelOrderDTO,
    ): Promise<OrderResponseDTO> => {
        const order = await findOrderById(id, countryCode);
        if (!order) throw OrderNotFoundError();

        if (order.customerId !== customerId) throw new AppError('Forbidden', 403);

        if (order.status !== 'pending') throw InvalidStatusTransitionError(order.status);

        const updated = await updateOrderStatus(id, countryCode, 'cancelled', {
            cancelledAt: new Date(),
            cancellationReason: dto.cancellationReason ?? null,
        });

        this.cache.delete(orderCacheKey(id, countryCode)).catch(() => {});

        const items = await findItemsByOrderId(id, countryCode);
        return toOrderResponseDTO(updated, items);
    };
}
