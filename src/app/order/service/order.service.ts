import { createHash } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../../../lib/di/tokens.js';
import { db } from '../../../lib/knex/knex.js';
import AppError from '../../../lib/error/AppError.js';
import { SystemRole } from '../../../lib/auth/enums.js';
import { parsePaginationQuery, parseFilters } from '../../../lib/http/pagination/parse-query.js';
import type { PaymentService } from '../../payment/service/payment.service.js';
import type { ICacheProvider } from '../../../pkg/cache/cache.interface.js';
import type { ISocketServer } from '../../../lib/websocket/ws-server.js';
import { currencyForCountry } from '../../../pkg/utils/currency.js';
import { sumMinor, multiplyMinor } from '../../../pkg/utils/money.js';
import type { ProductClient } from '../../../lib/core-client/product.client.js';
import type { CoreDataCacheService } from './core-data-cache.service.js';
import type { OrderStatusService } from './order-status.service.js';
import type { PlaceOrderDTO } from '../dto/place-order.dto.js';
import type { UpdateOrderStatusDTO } from '../dto/update-order-status.dto.js';
import type {
    OrderItemResponseDTO,
    OrderResponseDTO,
    OrderSummaryResponseDTO,
} from '../dto/order-response.dto.js';
import type { OrderListItemDTO } from '../dto/order-list-item.dto.js';
import { OrderEntity, type DeliveryAddressSnapshot } from '../entity/order.entity.js';
import { OrderItemEntity } from '../entity/order-item.entity.js';
import {
    createOrder,
    findOrderById,
    findOrderByPublicId,
    findOrdersByCustomerId,
    findOrdersByBranchId,
    updateOrderStatus as repoUpdateOrderStatus,
    type OrderFilterField,
    type OrderSortField,
} from '../repository/order.repo.js';
import { createOrderItems, findItemsByOrderId } from '../repository/order-item.repo.js';
import {
    OrderNotFoundError,
    OrderAccessDeniedError,
    OrderAlreadyFinalizedError,
    InvalidStatusTransitionError,
    CancellationWindowExpiredError,
} from '../errors.js';
import {
    orderRoom,
    restaurantBranchRoom,
    customerRoom,
    WS_EVENTS,
} from '../../../lib/websocket/events.js';
import { writeOutboxEvent } from '../../../lib/outbox/writer.js';

const ORDER_CACHE_TTL             = 300;
const CUSTOMER_ORDER_LIST_TTL    = 60;
const BRANCH_ORDER_LIST_TTL      = 30;
const TERMINAL_STATUSES          = new Set(['delivered', 'rejected', 'cancelled']);

function orderCacheKey(region: string, publicId: string): string {
    return `${region}:os:order:${publicId}`;
}

function customerOrderListCacheKey(region: string, customerId: number, query: Record<string, any>): string {
    const hash = createHash('sha256').update(JSON.stringify(query)).digest('hex').slice(0, 16);
    return `${region}:os:orders:customer:${customerId}:${hash}`;
}

function branchOrderListCacheKey(region: string, branchId: number, query: Record<string, any>): string {
    const hash = createHash('sha256').update(JSON.stringify(query)).digest('hex').slice(0, 16);
    return `${region}:os:orders:branch:${branchId}:${hash}`;
}

function toOrderItemResponseDTO(item: OrderItemEntity): OrderItemResponseDTO {
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

function toOrderSummaryResponseDTO(order: OrderEntity): OrderSummaryResponseDTO {
    return {
        id:                  order.publicId,
        restaurantId:        order.restaurantId,
        branchId:            order.branchId,
        status:              order.status,
        paymentMethod:       order.paymentMethod,
        subtotal:            order.subtotal,
        deliveryFee:         order.deliveryFee,
        serviceFee:          order.serviceFee,
        discount:            order.discount,
        commission:          order.commission,
        total:               order.total,
        currency:            order.currency,
        notes:               order.notes,
        estimatedDeliveryAt: order.estimatedDeliveryAt,
        deliveredAt:         order.deliveredAt,
        cancelledAt:         order.cancelledAt,
        createdAt:           order.createdAt,
    };
}

function toOrderResponseDTO(order: OrderEntity, items: OrderItemEntity[]): OrderResponseDTO {
    return {
        ...toOrderSummaryResponseDTO(order),
        deliveryAddressSnapshot: order.deliveryAddressSnapshot,
        cancellationReason:      order.cancellationReason,
        items:                   items.map(toOrderItemResponseDTO),
    };
}

function toOrderListItemDTO(order: OrderEntity, itemsCount: number): OrderListItemDTO {
    return {
        id:          order.publicId,
        restaurantId: order.restaurantId,
        branchId:    order.branchId,
        status:      order.status,
        paymentMethod: order.paymentMethod,
        subtotal:    order.subtotal,
        deliveryFee: order.deliveryFee,
        serviceFee:  order.serviceFee,
        total:       order.total,
        currency:    order.currency,
        itemsCount,
        createdAt:   order.createdAt,
    };
}

@injectable()
export class OrderService {
    constructor(
        @inject(TOKENS.CacheProvider)        private readonly cache: ICacheProvider,
        @inject(TOKENS.SocketServer)         private readonly socket: ISocketServer,
        @inject(TOKENS.PaymentService)       private readonly paymentService: PaymentService,
        @inject(TOKENS.ProductClient)        private readonly productClient: ProductClient,
        @inject(TOKENS.CoreDataCacheService) private readonly coreData: CoreDataCacheService,
        @inject(TOKENS.OrderStatusService)   private readonly statusService: OrderStatusService,
    ) {}

    placeOrder = async (
        customerId: number,
        region: string,
        dto: PlaceOrderDTO,
        correlationId?: string,
    ): Promise<OrderResponseDTO> => {
        // 1. Validate customer, branch metadata, and address in parallel
        const [, branchMeta, address] = await Promise.all([
            this.coreData.getUser(customerId, correlationId),
            this.coreData.getBranch(dto.branchId, correlationId),
            this.coreData.getAddress(dto.deliveryAddressId, correlationId),
        ]);

        if (address.userId !== customerId) {
            throw new AppError('AddressNotFound', 422);
        }

        // 2. Validate all products in parallel
        const products = await Promise.all(
            dto.items.map(item =>
                this.coreData.getProduct(item.productId, dto.branchId, correlationId),
            ),
        );

        const outOfStock = dto.items
            .map((item, i) => ({ item, product: products[i] }))
            .filter(({ item, product }) => !product.isAvailable || product.stock < item.quantity)
            .map(({ product }) => ({ productId: product.id, name: product.name }));

        if (outOfStock.length > 0) {
            throw new AppError('OutOfStock', 409);
        }

        const restaurantId = products[0].restaurantId;
        if (products.some(p => p.restaurantId !== restaurantId)) {
            throw new AppError('AllItemsMustBeFromSameRestaurant', 422);
        }

        // 3. Resolve currency from branch's country code
        const countryCode = branchMeta.countryCode;
        const currency    = currencyForCountry(countryCode);

        // 4. Build address snapshot
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

        // 5. Compute totals (all in minor currency units)
        const subtotal    = sumMinor(dto.items.map((item, i) => multiplyMinor(products[i].price, item.quantity)));
        const deliveryFee = 0;
        const serviceFee  = 0;
        const discount    = 0;
        const commission  = 0;
        const total       = subtotal + deliveryFee + serviceFee - discount;

        // 6. Initial status: online orders wait for payment; COD orders go straight to placed
        const initialStatus = dto.paymentMethod === 'online' ? 'pending_payment' : 'placed';

        // 7. Persist inside a DB transaction
        const trx = await db(region).transaction();
        try {
            const order = await createOrder(
                {
                    region,
                    publicId:                '',
                    countryCode,
                    currency,
                    customerId,
                    restaurantId,
                    branchId:                dto.branchId,
                    deliveryAddressId:       dto.deliveryAddressId,
                    deliveryLat:             address.lat,
                    deliveryLng:             address.lng,
                    deliveryAddressSnapshot: snapshot,
                    deliveryAgentId:         null,
                    status:                  initialStatus,
                    paymentMethod:           dto.paymentMethod,
                    subtotal,
                    deliveryFee,
                    serviceFee,
                    discount,
                    commission,
                    total,
                    notes:                   dto.notes ?? null,
                    estimatedDeliveryAt:     null,
                    acceptedAt:              null,
                    rejectedAt:              null,
                    readyAt:                 null,
                    assignedAt:              null,
                    pickedAt:                null,
                    deliveredAt:             null,
                    cancelledAt:             null,
                    cancellationReason:      null,
                    reassignmentCount:       0,
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
                    subtotal:        multiplyMinor(products[i].price, item.quantity),
                    notes:           item.notes ?? null,
                })),
                region,
                trx,
            );

            // For COD: record the pending cash collection inside the same transaction
            if (dto.paymentMethod === 'cod') {
                await this.paymentService.createCodPendingTransaction(
                    order.id, customerId, total, currency, region, trx,
                );
            }

            await writeOutboxEvent(trx, region, 'order.placed', String(order.id), {
                orderId:     order.id,
                restaurantId: order.restaurantId,
                customerId:  order.customerId,
                totalAmount: order.total,
                itemsCount:  items.length,
            });

            await trx.commit();

            // 8. After commit: reserve stock in core service (out-of-transaction)
            this.productClient.reserveStock(
                dto.branchId,
                dto.items.map((item, i) => ({ productId: products[i].id, quantity: item.quantity })),
                correlationId,
            ).catch(async (err) => {
                // Stock reservation failed post-commit — void the order
                await repoUpdateOrderStatus(order.id, region, 'cancelled', {
                    cancelledAt:        new Date(),
                    cancellationReason: 'out_of_stock_post_commit',
                });
                this.cache.delete(orderCacheKey(region, order.publicId)).catch(() => {});
                throw err;
            });

            // 9. COD orders enter the restaurant queue immediately; online orders wait for payment
            if (dto.paymentMethod === 'cod') {
                this.socket.emitToRoom(restaurantBranchRoom(order.branchId), WS_EVENTS.ORDER_CREATED, {
                    orderId:    order.publicId,
                    customerId: order.customerId,
                    subtotal:   order.subtotal,
                    createdAt:  order.createdAt,
                });
            }

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
        data: OrderListItemDTO[];
        meta: { hasMore: boolean; nextCursor: number | null; count: number };
    }> => {
        const cacheKey = customerOrderListCacheKey(region, customerId, query);
        try {
            const cached = await this.cache.get(cacheKey);
            if (cached) return JSON.parse(cached);
        } catch { /* Redis down — fall through to DB */ }

        const pagination = parsePaginationQuery<Record<string, any>, OrderSortField>(
            query, ['id'], 'id',
        );
        const filters = parseFilters<Record<string, any>, OrderFilterField>(query, ['status']);

        const result = await findOrdersByCustomerId(customerId, region, pagination, filters);
        const response = {
            data: result.data.map(o => toOrderListItemDTO(o, 0)),
            meta: result.meta,
        };

        this.cache.set(cacheKey, JSON.stringify(response), CUSTOMER_ORDER_LIST_TTL).catch(() => {});

        return response;
    };

    listOrdersByBranch = async (
        branchId: number,
        region: string,
        query: Record<string, any>,
    ): Promise<{
        data: OrderListItemDTO[];
        meta: { hasMore: boolean; nextCursor: number | null; count: number };
    }> => {
        const cacheKey = branchOrderListCacheKey(region, branchId, query);
        try {
            const cached = await this.cache.get(cacheKey);
            if (cached) return JSON.parse(cached);
        } catch { /* Redis down — fall through to DB */ }

        const pagination = parsePaginationQuery<Record<string, any>, OrderSortField>(
            query, ['id'], 'id',
        );
        const filters = parseFilters<Record<string, any>, OrderFilterField>(query, ['status']);

        const result = await findOrdersByBranchId(branchId, region, pagination, filters);
        const response = {
            data: result.data.map(o => toOrderListItemDTO(o, 0)),
            meta: result.meta,
        };

        this.cache.set(cacheKey, JSON.stringify(response), BRANCH_ORDER_LIST_TTL).catch(() => {});

        return response;
    };

    getOrderByPublicId = async (
        publicId: string,
        region: string,
        userId: number,
        role: string,
    ): Promise<{ data: OrderResponseDTO; fromCache: boolean }> => {
        const order = await findOrderByPublicId(publicId, region);
        if (!order) throw OrderNotFoundError();

        if (role === SystemRole.CUSTOMER && order.customerId !== userId) {
            throw OrderAccessDeniedError();
        }
        if (role === SystemRole.DELIVERY_AGENT) {
            throw OrderAccessDeniedError();
        }

        let cached: string | null = null;
        try {
            cached = await this.cache.get(orderCacheKey(region, publicId));
        } catch { /* Redis down — fall through to DB */ }
        if (cached) return { data: JSON.parse(cached) as OrderResponseDTO, fromCache: true };

        const items  = await findItemsByOrderId(order.id, region);
        const result = toOrderResponseDTO(order, items);

        this.cache.set(orderCacheKey(region, publicId), JSON.stringify(result), ORDER_CACHE_TTL)
            .catch(() => {});

        return { data: result, fromCache: false };
    };

    updateOrderStatus = async (
        publicId: string,
        region: string,
        actorId: number,
        actorRole: string,
        dto: UpdateOrderStatusDTO,
    ): Promise<OrderResponseDTO> => {
        const result = await this.statusService.updateStatus(publicId, region, actorId, actorRole, dto);
        this.cache.delete(orderCacheKey(region, publicId)).catch(() => {});
        return result;
    };

    // ── Internal methods (called by DeliveryService via DI) ───────────────────

    getOrderEntity = async (
        publicId: string,
        region: string,
    ): Promise<OrderEntity | undefined> => {
        return findOrderByPublicId(publicId, region);
    };

    getOrderEntityById = async (
        id: number,
        region: string,
    ): Promise<OrderEntity | undefined> => {
        return findOrderById(id, region);
    };

    internalUpdateStatus = async (
        orderId: number,
        region: string,
        status: import('../enums.js').OrderStatus,
        extra: Parameters<typeof repoUpdateOrderStatus>[3] = {},
        conn?: import('knex').Knex,
    ): Promise<void> => {
        await this.statusService.internalUpdateStatus(orderId, region, status, extra, conn);
    };
}
