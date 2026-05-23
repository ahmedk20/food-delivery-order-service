import type { DeliveryStatus } from '../../delivery/enums.js';
import type { DeliveryTaskRow } from '../repository/delivery-task.repo.js';

export interface DeliveryTaskPickup {
    branchId: number;
    lat: number | null;
    lng: number | null;
}

export interface DeliveryTaskDropoff {
    lat: number | null;
    lng: number | null;
    addressText: string;
}

export interface DeliveryTaskResponseDTO {
    deliveryId: number;
    orderPublicId: string;
    status: DeliveryStatus;
    pickup: DeliveryTaskPickup;
    dropoff: DeliveryTaskDropoff;
    itemsCount: number;
    total: number;
    currency: string;
    paymentMethod: string;
    earningEstimate: number | null;
    assignedAt: string;
}

function buildAddressText(snapshot: Record<string, any>): string {
    const parts: string[] = [];
    if (snapshot.street)   parts.push(snapshot.street);
    if (snapshot.building) parts.push(snapshot.building);
    if (snapshot.city)     parts.push(snapshot.city);
    return parts.join(', ') || '';
}

export function toDeliveryTaskResponseDTO(row: DeliveryTaskRow): DeliveryTaskResponseDTO {
    return {
        deliveryId:      row.deliveryId,
        orderPublicId:   row.orderPublicId,
        status:          row.status,
        pickup: {
            branchId: row.branchId,
            lat:      row.pickupLat,
            lng:      row.pickupLng,
        },
        dropoff: {
            lat:         row.dropoffLat,
            lng:         row.dropoffLng,
            addressText: buildAddressText(row.deliveryAddressSnapshot ?? {}),
        },
        itemsCount:      row.itemsCount,
        total:           row.total,
        currency:        row.orderCurrency,
        paymentMethod:   row.paymentMethod,
        earningEstimate: row.earningAmount,
        assignedAt:      row.assignedAt.toISOString(),
    };
}
