import type { DeliveryStatus } from '../enums.js';
import type { DeliveryEntity } from '../entity/delivery.entity.js';

export interface DeliveryResponseDTO {
    id: number;
    orderId: string;         // order's publicId (UUID)
    agentId: number;
    status: DeliveryStatus;
    pickup: { lat: number | null; lng: number | null };
    dropoff: { lat: number | null; lng: number | null };
    distanceMeters: number | null;
    earningAmount: number | null;
    currency: string | null;
    assignedAt: string;
    acceptedAt: string | null;
    rejectedAt: string | null;
    pickedAt: string | null;
    deliveredAt: string | null;
    cancelledAt: string | null;
    reassignedAt: string | null;
    rejectionReason: string | null;
    createdAt: string;
}

export function toDeliveryResponseDTO(
    delivery: DeliveryEntity,
    orderPublicId: string,
): DeliveryResponseDTO {
    return {
        id:              delivery.id,
        orderId:         orderPublicId,
        agentId:         delivery.agentId,
        status:          delivery.status,
        pickup:          { lat: delivery.pickupLat, lng: delivery.pickupLng },
        dropoff:         { lat: delivery.dropoffLat, lng: delivery.dropoffLng },
        distanceMeters:  delivery.distanceMeters,
        earningAmount:   delivery.earningAmount,
        currency:        delivery.currency,
        assignedAt:      delivery.assignedAt.toISOString(),
        acceptedAt:      delivery.acceptedAt?.toISOString() ?? null,
        rejectedAt:      delivery.rejectedAt?.toISOString() ?? null,
        pickedAt:        delivery.pickedAt?.toISOString() ?? null,
        deliveredAt:     delivery.deliveredAt?.toISOString() ?? null,
        cancelledAt:     delivery.cancelledAt?.toISOString() ?? null,
        reassignedAt:    delivery.reassignedAt?.toISOString() ?? null,
        rejectionReason: delivery.rejectionReason,
        createdAt:       delivery.createdAt.toISOString(),
    };
}
