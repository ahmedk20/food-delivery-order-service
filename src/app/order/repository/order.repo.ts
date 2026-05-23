import type { Knex } from 'knex';
import { db } from '../../../lib/knex/knex.js';
import { OrderEntity } from '../entity/order.entity.js';
import type { OrderStatus } from '../enums.js';
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
    'delivery_address_id', 'delivery_lat', 'delivery_lng',
    'delivery_address_snapshot', 'delivery_agent_id',
    'status', 'payment_method',
    'subtotal', 'delivery_fee', 'service_fee', 'discount', 'commission', 'total',
    'notes', 'reassignment_count', 'estimated_delivery_at',
    'accepted_at', 'rejected_at', 'ready_at', 'assigned_at',
    'picked_at', 'delivered_at', 'cancelled_at', 'cancellation_reason',
    'created_at', 'updated_at',
];

function toEntity(row: any): OrderEntity {
    return new OrderEntity({
        id:                      row.id,
        region:                  row.region,
        publicId:                row.public_id,
        countryCode:             row.country_code,
        currency:                row.currency,
        customerId:              row.customer_id,
        restaurantId:            row.restaurant_id,
        branchId:                row.branch_id,
        deliveryAddressId:       row.delivery_address_id,
        deliveryLat:             Number(row.delivery_lat),
        deliveryLng:             Number(row.delivery_lng),
        deliveryAddressSnapshot: row.delivery_address_snapshot,
        deliveryAgentId:         row.delivery_agent_id,
        status:                  row.status,
        paymentMethod:           row.payment_method,
        subtotal:                row.subtotal,
        deliveryFee:             row.delivery_fee,
        serviceFee:              row.service_fee,
        discount:                row.discount,
        commission:              row.commission,
        total:                   row.total,
        notes:                   row.notes,
        reassignmentCount:       row.reassignment_count,
        estimatedDeliveryAt:     row.estimated_delivery_at,
        acceptedAt:              row.accepted_at,
        rejectedAt:              row.rejected_at,
        readyAt:                 row.ready_at,
        assignedAt:              row.assigned_at,
        pickedAt:                row.picked_at,
        deliveredAt:             row.delivered_at,
        cancelledAt:             row.cancelled_at,
        cancellationReason:      row.cancellation_reason,
        createdAt:               row.created_at,
        updatedAt:               row.updated_at,
    });
}

export type OrderSortField         = 'id';
export type OrderFilterField       = 'status';
export type AdminOrderFilterField  = 'status' | 'customer_id' | 'restaurant_id' | 'branch_id' | 'delivery_agent_id';

export async function findAllOrders(
    region: string,
    pagination: PaginationParams<Record<string, any>, OrderSortField>,
    filters: FilterParams<Record<string, any>, AdminOrderFilterField>[],
): Promise<{ data: OrderEntity[]; meta: { hasMore: boolean; nextCursor: number | null; count: number } }> {
    let query = db(region)('orders').select(COLUMNS);
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

export async function createOrder(
    data: Omit<OrderEntity, 'id' | 'createdAt' | 'updatedAt'>,
    region: string,
    conn?: Knex,
): Promise<OrderEntity> {
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
        delivery_lat:              data.deliveryLat,
        delivery_lng:              data.deliveryLng,
        delivery_address_snapshot: JSON.stringify(data.deliveryAddressSnapshot),
        delivery_agent_id:         data.deliveryAgentId,
        status:                    data.status,
        payment_method:            data.paymentMethod,
        subtotal:                  data.subtotal,
        delivery_fee:              data.deliveryFee,
        service_fee:               data.serviceFee,
        discount:                  data.discount,
        commission:                data.commission,
        total:                     data.total,
        notes:                     data.notes,
        estimated_delivery_at:     data.estimatedDeliveryAt,
        accepted_at:               data.acceptedAt,
        rejected_at:               data.rejectedAt,
        ready_at:                  data.readyAt,
        assigned_at:               data.assignedAt,
        picked_at:                 data.pickedAt,
        delivered_at:              data.deliveredAt,
        cancelled_at:              data.cancelledAt,
        cancellation_reason:       data.cancellationReason,
        created_at:                now,
        updated_at:                now,
    }).returning(COLUMNS);
    return toEntity(row);
}

export async function findOrderById(id: number, region: string): Promise<OrderEntity | undefined> {
    const row = await db(region)('orders')
        .select(COLUMNS)
        .where({ id })
        .first();
    return row ? toEntity(row) : undefined;
}

export async function findOrderByPublicId(publicId: string, region: string): Promise<OrderEntity | undefined> {
    const row = await db(region)('orders')
        .select(COLUMNS)
        .where({ public_id: publicId })
        .first();
    return row ? toEntity(row) : undefined;
}

export async function findOrdersByCustomerId(
    customerId: number,
    region: string,
    pagination: PaginationParams<Record<string, any>, OrderSortField>,
    filters: FilterParams<Record<string, any>, OrderFilterField>[],
): Promise<{ data: OrderEntity[]; meta: { hasMore: boolean; nextCursor: number | null; count: number } }> {
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

export async function findOrdersByBranchId(
    branchId: number,
    region: string,
    pagination: PaginationParams<Record<string, any>, OrderSortField>,
    filters: FilterParams<Record<string, any>, OrderFilterField>[],
): Promise<{ data: OrderEntity[]; meta: { hasMore: boolean; nextCursor: number | null; count: number } }> {
    let query = db(region)('orders')
        .select(COLUMNS)
        .where({ branch_id: branchId });

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
    extra: Partial<Pick<OrderEntity,
        | 'acceptedAt'
        | 'rejectedAt'
        | 'readyAt'
        | 'assignedAt'
        | 'pickedAt'
        | 'deliveredAt'
        | 'cancelledAt'
        | 'cancellationReason'
        | 'estimatedDeliveryAt'
        | 'deliveryAgentId'
    >> = {},
    conn?: Knex,
): Promise<OrderEntity> {
    const knex    = conn ?? db(region);
    const updates: Record<string, unknown> = { status, updated_at: new Date() };

    if (extra.acceptedAt          !== undefined) updates.accepted_at          = extra.acceptedAt;
    if (extra.rejectedAt          !== undefined) updates.rejected_at          = extra.rejectedAt;
    if (extra.readyAt             !== undefined) updates.ready_at             = extra.readyAt;
    if (extra.assignedAt          !== undefined) updates.assigned_at          = extra.assignedAt;
    if (extra.pickedAt            !== undefined) updates.picked_at            = extra.pickedAt;
    if (extra.deliveredAt         !== undefined) updates.delivered_at         = extra.deliveredAt;
    if (extra.cancelledAt         !== undefined) updates.cancelled_at         = extra.cancelledAt;
    if (extra.cancellationReason  !== undefined) updates.cancellation_reason  = extra.cancellationReason;
    if (extra.estimatedDeliveryAt !== undefined) updates.estimated_delivery_at = extra.estimatedDeliveryAt;
    if (extra.deliveryAgentId     !== undefined) updates.delivery_agent_id    = extra.deliveryAgentId;

    const [row] = await knex('orders')
        .where({ id })
        .update(updates)
        .returning(COLUMNS);
    return toEntity(row);
}

export async function incrementReassignmentCount(
    id: number,
    region: string,
    conn?: Knex,
): Promise<void> {
    const knex = conn ?? db(region);
    await knex.raw(
        `UPDATE orders SET reassignment_count = reassignment_count + 1, updated_at = NOW() WHERE id = ?`,
        [id],
    );
}
