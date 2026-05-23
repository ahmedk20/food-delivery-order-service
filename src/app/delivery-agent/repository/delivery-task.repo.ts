import { db } from '../../../lib/knex/knex.js';
import type { DeliveryStatus } from '../../delivery/enums.js';

export interface DeliveryTaskRow {
    deliveryId: number;
    orderId: number;
    orderPublicId: string;
    status: DeliveryStatus;
    pickupLat: number | null;
    pickupLng: number | null;
    dropoffLat: number | null;
    dropoffLng: number | null;
    earningAmount: number | null;
    currency: string | null;
    assignedAt: Date;
    total: number;
    orderCurrency: string;
    paymentMethod: string;
    deliveryAddressSnapshot: Record<string, any>;
    branchId: number;
    itemsCount: number;
}

export async function findTasksByAgentId(
    agentId: number,
    region: string,
    opts: {
        statusFilter?: DeliveryStatus[];
        cursor?: number;
        limit?: number;
    } = {},
): Promise<DeliveryTaskRow[]> {
    const limit = opts.limit ?? 20;

    let query = db(region)('deliveries AS d')
        .join('orders AS o', 'o.id', 'd.order_id')
        .select([
            'd.id AS delivery_id',
            'd.order_id',
            'o.public_id AS order_public_id',
            'd.status',
            'd.pickup_lat',
            'd.pickup_lng',
            'd.dropoff_lat',
            'd.dropoff_lng',
            'd.earning_amount',
            'd.currency',
            'd.assigned_at',
            'o.total',
            'o.currency AS order_currency',
            'o.payment_method',
            'o.delivery_address_snapshot',
            'o.branch_id',
            db(region).raw(`(SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = d.order_id) AS items_count`),
        ])
        .where('d.agent_id', agentId);

    if (opts.statusFilter && opts.statusFilter.length > 0) {
        query = query.whereIn('d.status', opts.statusFilter);
    }
    if (opts.cursor) {
        query = query.where('d.id', '<', opts.cursor);
    }

    const rows = await query.orderBy('d.assigned_at', 'desc').limit(limit + 1);

    return rows.map((r: any): DeliveryTaskRow => ({
        deliveryId:              r.delivery_id,
        orderId:                 r.order_id,
        orderPublicId:           r.order_public_id,
        status:                  r.status,
        pickupLat:               r.pickup_lat  != null ? Number(r.pickup_lat)  : null,
        pickupLng:               r.pickup_lng  != null ? Number(r.pickup_lng)  : null,
        dropoffLat:              r.dropoff_lat != null ? Number(r.dropoff_lat) : null,
        dropoffLng:              r.dropoff_lng != null ? Number(r.dropoff_lng) : null,
        earningAmount:           r.earning_amount != null ? Number(r.earning_amount) : null,
        currency:                r.currency,
        assignedAt:              r.assigned_at,
        total:                   r.total,
        orderCurrency:           r.order_currency,
        paymentMethod:           r.payment_method,
        deliveryAddressSnapshot: r.delivery_address_snapshot,
        branchId:                r.branch_id,
        itemsCount:              r.items_count,
    }));
}
