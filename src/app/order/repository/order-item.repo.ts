import type { Knex } from 'knex';
import { db } from '../../../lib/knex/knex.js';
import { OrderItem } from '../entity/order-item.entity.js';

const COLUMNS = [
    'id', 'order_id', 'country_code', 'product_id',
    'product_name', 'product_image_url', 'unit_price',
    'quantity', 'subtotal', 'notes', 'created_at',
];

function toEntity(row: any): OrderItem {
    return new OrderItem({
        id: row.id,
        orderId: row.order_id,
        countryCode: row.country_code,
        productId: row.product_id,
        productName: row.product_name,
        productImageUrl: row.product_image_url,
        unitPrice: row.unit_price,
        quantity: row.quantity,
        subtotal: row.subtotal,
        notes: row.notes,
        createdAt: row.created_at,
    });
}

export async function createOrderItems(
    items: Omit<OrderItem, 'id' | 'createdAt'>[],
    conn: Knex = db,
): Promise<OrderItem[]> {
    if (items.length === 0) return [];
    const now = new Date();
    const rows = await conn('order_items')
        .insert(items.map(item => ({
            order_id: item.orderId,
            country_code: item.countryCode,
            product_id: item.productId,
            product_name: item.productName,
            product_image_url: item.productImageUrl,
            unit_price: item.unitPrice,
            quantity: item.quantity,
            subtotal: item.subtotal,
            notes: item.notes,
            created_at: now,
        })))
        .returning(COLUMNS);
    return rows.map(toEntity);
}

export async function findItemsByOrderId(orderId: number, countryCode: string): Promise<OrderItem[]> {
    const rows = await db('order_items')
        .select(COLUMNS)
        .where({ order_id: orderId, country_code: countryCode });
    return rows.map(toEntity);
}
