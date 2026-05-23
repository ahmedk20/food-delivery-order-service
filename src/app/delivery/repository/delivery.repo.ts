import type { Knex } from 'knex';
import { db } from '../../../lib/knex/knex.js';
import { DeliveryEntity } from '../entity/delivery.entity.js';
import type { DeliveryStatus } from '../enums.js';

const COLUMNS = [
    'id', 'region', 'order_id', 'agent_id', 'status',
    'pickup_lat', 'pickup_lng', 'dropoff_lat', 'dropoff_lng', 'distance_meters',
    'earning_amount', 'currency', 'reassigned_from',
    'assigned_at', 'accepted_at', 'rejected_at', 'picked_at',
    'delivered_at', 'cancelled_at', 'reassigned_at', 'rejection_reason',
    'created_at', 'updated_at',
];

function toEntity(row: any): DeliveryEntity {
    return new DeliveryEntity({
        id:              row.id,
        region:          row.region,
        orderId:         row.order_id,
        agentId:         row.agent_id,
        status:          row.status,
        pickupLat:       row.pickup_lat  != null ? Number(row.pickup_lat)  : null,
        pickupLng:       row.pickup_lng  != null ? Number(row.pickup_lng)  : null,
        dropoffLat:      row.dropoff_lat != null ? Number(row.dropoff_lat) : null,
        dropoffLng:      row.dropoff_lng != null ? Number(row.dropoff_lng) : null,
        distanceMeters:  row.distance_meters,
        earningAmount:   row.earning_amount,
        currency:        row.currency,
        reassignedFrom:  row.reassigned_from,
        assignedAt:      row.assigned_at,
        acceptedAt:      row.accepted_at,
        rejectedAt:      row.rejected_at,
        pickedAt:        row.picked_at,
        deliveredAt:     row.delivered_at,
        cancelledAt:     row.cancelled_at,
        reassignedAt:    row.reassigned_at,
        rejectionReason: row.rejection_reason,
        createdAt:       row.created_at,
        updatedAt:       row.updated_at,
    });
}

export async function findDeliveryById(
    id: number,
    region: string,
): Promise<DeliveryEntity | undefined> {
    const row = await db(region)('deliveries')
        .select(COLUMNS)
        .where({ id })
        .first();
    return row ? toEntity(row) : undefined;
}

// Returns the single active delivery row for this order (if any).
// Active means the delivery has not been completed, rejected, cancelled, or superseded.
export async function findActiveDeliveryByOrderId(
    orderId: number,
    region: string,
    conn?: Knex,
): Promise<DeliveryEntity | undefined> {
    const knex = conn ?? db(region);
    const row  = await knex('deliveries')
        .select(COLUMNS)
        .where({ order_id: orderId })
        .whereIn('status', ['assigned', 'accepted', 'picked'])
        .first();
    return row ? toEntity(row) : undefined;
}

export async function findDeliveriesByAgentId(
    agentId: number,
    region: string,
    statusFilter?: DeliveryStatus[],
): Promise<DeliveryEntity[]> {
    let query = db(region)('deliveries')
        .select(COLUMNS)
        .where({ agent_id: agentId });

    if (statusFilter && statusFilter.length > 0) {
        query = query.whereIn('status', statusFilter);
    }

    const rows = await query.orderBy('assigned_at', 'desc');
    return rows.map(toEntity);
}

export async function createDelivery(
    data: Omit<DeliveryEntity, 'id' | 'createdAt' | 'updatedAt'>,
    region: string,
    conn?: Knex,
): Promise<DeliveryEntity> {
    const knex = conn ?? db(region);
    const now  = new Date();
    const [row] = await knex('deliveries').insert({
        region,
        order_id:         data.orderId,
        agent_id:         data.agentId,
        status:           data.status,
        pickup_lat:       data.pickupLat,
        pickup_lng:       data.pickupLng,
        dropoff_lat:      data.dropoffLat,
        dropoff_lng:      data.dropoffLng,
        distance_meters:  data.distanceMeters,
        earning_amount:   data.earningAmount,
        currency:         data.currency,
        reassigned_from:  data.reassignedFrom,
        assigned_at:      data.assignedAt ?? now,
        accepted_at:      data.acceptedAt,
        rejected_at:      data.rejectedAt,
        picked_at:        data.pickedAt,
        delivered_at:     data.deliveredAt,
        cancelled_at:     data.cancelledAt,
        reassigned_at:    data.reassignedAt,
        rejection_reason: data.rejectionReason,
        created_at:       now,
        updated_at:       now,
    }).returning(COLUMNS);
    return toEntity(row);
}

export async function updateDelivery(
    id: number,
    region: string,
    updates: Partial<Pick<DeliveryEntity,
        | 'status'
        | 'acceptedAt'
        | 'rejectedAt'
        | 'pickedAt'
        | 'deliveredAt'
        | 'cancelledAt'
        | 'reassignedAt'
        | 'rejectionReason'
        | 'earningAmount'
    >>,
    conn?: Knex,
): Promise<DeliveryEntity> {
    const knex    = conn ?? db(region);
    const payload: Record<string, unknown> = { updated_at: new Date() };

    if (updates.status          !== undefined) payload.status           = updates.status;
    if (updates.acceptedAt      !== undefined) payload.accepted_at      = updates.acceptedAt;
    if (updates.rejectedAt      !== undefined) payload.rejected_at      = updates.rejectedAt;
    if (updates.pickedAt        !== undefined) payload.picked_at        = updates.pickedAt;
    if (updates.deliveredAt     !== undefined) payload.delivered_at     = updates.deliveredAt;
    if (updates.cancelledAt     !== undefined) payload.cancelled_at     = updates.cancelledAt;
    if (updates.reassignedAt    !== undefined) payload.reassigned_at    = updates.reassignedAt;
    if (updates.rejectionReason !== undefined) payload.rejection_reason = updates.rejectionReason;
    if (updates.earningAmount   !== undefined) payload.earning_amount   = updates.earningAmount;

    const [row] = await knex('deliveries')
        .where({ id })
        .update(payload)
        .returning(COLUMNS);
    return toEntity(row);
}
