import type { DeliveryStatus } from '../enums.js';

export class DeliveryEntity {
    id: number;
    region: string;
    orderId: number;
    agentId: number;
    status: DeliveryStatus;
    pickupLat: number | null;
    pickupLng: number | null;
    dropoffLat: number | null;
    dropoffLng: number | null;
    distanceMeters: number | null;
    earningAmount: number | null;
    currency: string | null;
    reassignedFrom: number | null;
    assignedAt: Date;
    acceptedAt: Date | null;
    rejectedAt: Date | null;
    pickedAt: Date | null;
    deliveredAt: Date | null;
    cancelledAt: Date | null;
    reassignedAt: Date | null;
    rejectionReason: string | null;
    createdAt: Date;
    updatedAt: Date;

    constructor(data: Partial<DeliveryEntity>) {
        this.id              = data.id!;
        this.region          = data.region!;
        this.orderId         = data.orderId!;
        this.agentId         = data.agentId!;
        this.status          = data.status ?? 'assigned';
        this.pickupLat       = data.pickupLat ?? null;
        this.pickupLng       = data.pickupLng ?? null;
        this.dropoffLat      = data.dropoffLat ?? null;
        this.dropoffLng      = data.dropoffLng ?? null;
        this.distanceMeters  = data.distanceMeters ?? null;
        this.earningAmount   = data.earningAmount ?? null;
        this.currency        = data.currency ?? null;
        this.reassignedFrom  = data.reassignedFrom ?? null;
        this.assignedAt      = data.assignedAt ?? new Date();
        this.acceptedAt      = data.acceptedAt ?? null;
        this.rejectedAt      = data.rejectedAt ?? null;
        this.pickedAt        = data.pickedAt ?? null;
        this.deliveredAt     = data.deliveredAt ?? null;
        this.cancelledAt     = data.cancelledAt ?? null;
        this.reassignedAt    = data.reassignedAt ?? null;
        this.rejectionReason = data.rejectionReason ?? null;
        this.createdAt       = data.createdAt ?? new Date();
        this.updatedAt       = data.updatedAt ?? new Date();
    }
}
