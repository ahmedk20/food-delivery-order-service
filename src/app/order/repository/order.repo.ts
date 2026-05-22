import type { Knex } from 'knex';
import { db } from '../../../lib/knex/knex.js';
import { Order, type OrderStatus } from '../entity/order.entity.js';
import {
    applyCursorPagination,
    applyFilters,
    buildPaginationResult,
    type FilterParams,
    type PaginationParams,
} from '../../../lib/http/pagination/cursor-pagination.js';

const COLUMNS = [
    'id', 'region', 'public_id', 'country_code', 'currency',
    'customer_id', 'restaurant_id', 'branch_id',
    'delivery_address_id', 'delivery_address_snapshot', 'delivery_agent_id',
    'status', 'payment_method', 'items_total', 'delivery_fee', 'discount',
    'total_amount', 'notes', 'estimated_delivery_at', 'delivery_started_at',
    'delivered_at', 'cancelled_at', 'cancellation_reason', 'created_at', 'updated_at',
];

function toEntity(row: any): Order {
    return new Order({
        id:                      row.id,
        region:                  row.region,
        publicId:                row.public_id,
        countryCode:             row.country_code,
        currency:                row.currency,
        customerId:              row.customer_id,
        restaurantId:            row.restaurant_id,
        branchId:                row.branch_id,
        deliveryAddressId:       row.delivery_address_id,
        deliveryAddressSnapshot: row.delivery_address_snapshot,
        deliveryAgentId:         row.delivery_agent_id,
        status:                  row.status,
        paymentMethod:           row.payment_method,
        itemsTotal:              row.items_total,
        deliveryFee:             row.delivery_fee,
        discount:                row.discount,
        totalAmount:             row.total_amount,
        notes:                   row.notes,
        estimatedDeliveryAt:     row.estimated_delivery_at,
        deliveryStartedAt:       row.delivery_started_at,
        deliveredAt:             row.delivered_at,
        cancelledAt:             row.cancelled_at,
        cancellationReason:      row.cancellation_reason,
        createdAt:               row.created_at,
        updatedAt:               row.updated_at,
    });
}

export type OrderSortField   = 'id';
export type OrderFilterField = 'status';

export async function createOrder(
    data: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>,
    region: string,
    conn?: Knex,
): Promise<Order> {
    const knex = conn ?? db(region);
    const now  = new Date();
    const [row] = await knex('orders').insert({
        region,
        country_code:              data.countryCode,
        currency:                  data.currency,
        customer_id:               data.customerId,
        restaurant_id:             data.restaurantId,
        branch_id:                 data.branchId,
        delivery_address_id:       data.deliveryAddressId,
        delivery_address_snapshot: JSON.stringify(data.deliveryAddressSnapshot),
        delivery_agent_id:         data.deliveryAgentId,
        status:                    data.status,
        payment_method:            data.paymentMethod,
        items_total:               data.itemsTotal,
        delivery_fee:              data.deliveryFee,
        discount:                  data.discount,
        total_amount:              data.totalAmount,
        notes:                     data.notes,
        estimated_delivery_at:     data.estimatedDeliveryAt,
        delivery_started_at:       data.deliveryStartedAt,
        delivered_at:              data.deliveredAt,
        cancelled_at:              data.cancelledAt,
        cancellation_reason:       data.cancellationReason,
        created_at:                now,
        updated_at:                now,
    }).returning(COLUMNS);
    return toEntity(row);
}

export async function findOrderById(id: number, region: string): Promise<Order | undefined> {
    const row = await db(region)('orders')
        .select(COLUMNS)
        .where({ id })
        .first();
    return row ? toEntity(row) : undefined;
}

export async function findOrderByPublicId(publicId: string, region: string): Promise<Order | undefined> {
    const row = await db(region)('orders')
        .select(COLUMNS)
        .where({ public_id: publicId })
        .first();
    return row ? toEntity(row) : undefined;
}

export async function findOrdersByCustomer(
    customerId: number,
    region: string,
    pagination: PaginationParams<Record<string, any>, OrderSortField>,
    filters: FilterParams<Record<string, any>, OrderFilterField>[],
): Promise<{ data: Order[]; meta: { hasMore: boolean; nextCursor: number | null; count: number } }> {
    let query = db(region)('orders')
        .select(COLUMNS)
        .where({ customer_id: customerId });

    query = applyFilters(query, filters);
    query = applyCursorPagination(query, pagination);

    const rows = await query;
    const { rows: data, hasMore, nextCursor } = buildPaginationResult(
        rows, pagination.limit, pagination.sortBy, pagination.sortOrder,
    );
    return {
        data: data.map(toEntity),
        meta: { hasMore, nextCursor, count: data.length },
    };
}

export async function updateOrderStatus(
    id: number,
    region: string,
    status: OrderStatus,
    extra: Partial<Pick<Order,
        | 'cancelledAt'
        | 'cancellationReason'
        | 'estimatedDeliveryAt'
        | 'deliveryStartedAt'
        | 'deliveredAt'
    >> = {},
    conn?: Knex,
): Promise<Order> {
    const knex = conn ?? db(region);
    const updates: Record<string, unknown> = { status, updated_at: new Date() };

    if (extra.cancelledAt         !== undefined) updates.cancelled_at         = extra.cancelledAt;
    if (extra.cancellationReason  !== undefined) updates.cancellation_reason  = extra.cancellationReason;
    if (extra.estimatedDeliveryAt !== undefined) updates.estimated_delivery_at = extra.estimatedDeliveryAt;
    if (extra.deliveryStartedAt   !== undefined) updates.delivery_started_at  = extra.deliveryStartedAt;
    if (extra.deliveredAt         !== undefined) updates.delivered_at         = extra.deliveredAt;

    const [row] = await knex('orders')
        .where({ id })
        .update(updates)
        .returning(COLUMNS);
    return toEntity(row);
}
