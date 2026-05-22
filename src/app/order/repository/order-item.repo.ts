import type { Knex } from 'knex';
import { db } from '../../../lib/knex/knex.js';
import { OrderItemEntity } from '../entity/order-item.entity.js';

const COLUMNS = [
    'id', 'order_id', 'region', 'product_id',
    'product_name', 'product_image_url', 'unit_price',
    'quantity', 'subtotal', 'notes', 'created_at',
];

function toEntity(row: any): OrderItemEntity {
    return new OrderItemEntity({
        id:              row.id,
        orderId:         row.order_id,
        region:          row.region,
        productId:       row.product_id,
        productName:     row.product_name,
        productImageUrl: row.product_image_url,
        unitPrice:       row.unit_price,
        quantity:        row.quantity,
        subtotal:        row.subtotal,
        notes:           row.notes,
        createdAt:       row.created_at,
    });
}

export async function createOrderItems(
    items: Omit<OrderItemEntity, 'id' | 'createdAt'>[],
    region: string,
    conn?: Knex,
): Promise<OrderItemEntity[]> {
    if (items.length === 0) return [];
    const knex = conn ?? db(region);
    const now  = new Date();
    const rows = await knex('order_items')
        .insert(items.map(item => ({
            order_id:          item.orderId,
            region,
            product_id:        item.productId,
            product_name:      item.productName,
            product_image_url: item.productImageUrl,
            unit_price:        item.unitPrice,
            quantity:          item.quantity,
            subtotal:          item.subtotal,
            notes:             item.notes,
            created_at:        now,
        })))
        .returning(COLUMNS);
    return rows.map(toEntity);
}

export async function findItemsByOrderId(orderId: number, region: string): Promise<OrderItemEntity[]> {
    const rows = await db(region)('order_items')
        .select(COLUMNS)
        .where({ order_id: orderId });
    return rows.map(toEntity);
}

// Single IN query — never call this inside a loop (N+1).
export async function findItemsByOrderIds(orderIds: number[], region: string): Promise<OrderItemEntity[]> {
    if (orderIds.length === 0) return [];
    const rows = await db(region)('order_items')
        .select(COLUMNS)
        .whereIn('order_id', orderIds);
    return rows.map(toEntity);
}
