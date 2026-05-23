import type { OrderStatus, PaymentMethod } from '../enums.js';

export interface DeliveryAddressSnapshot {
    id: number;
    label: string;
    country: string;
    city: string;
    street: string;
    building: string | null;
    apartmentNumber: string | null;
    type: string;
    lat: number;
    lng: number;
}

export class OrderEntity {
    id: number;
    region: string;
    publicId: string;
    countryCode: string;
    currency: string;
    customerId: number;
    restaurantId: number;
    branchId: number;
    deliveryAddressId: number;
    deliveryLat: number;
    deliveryLng: number;
    deliveryAddressSnapshot: DeliveryAddressSnapshot;
    deliveryAgentId: number | null;
    status: OrderStatus;
    paymentMethod: PaymentMethod;
    subtotal: number;
    deliveryFee: number;
    serviceFee: number;
    discount: number;
    commission: number;
    total: number;
    notes: string | null;
    reassignmentCount: number;
    estimatedDeliveryAt: Date | null;
    acceptedAt: Date | null;
    rejectedAt: Date | null;
    readyAt: Date | null;
    assignedAt: Date | null;
    pickedAt: Date | null;
    deliveredAt: Date | null;
    cancelledAt: Date | null;
    cancellationReason: string | null;
    createdAt: Date;
    updatedAt: Date;

    constructor(data: Partial<OrderEntity>) {
        this.id                      = data.id!;
        this.region                  = data.region!;
        this.publicId                = data.publicId!;
        this.countryCode             = data.countryCode!;
        this.currency                = data.currency!;
        this.customerId              = data.customerId!;
        this.restaurantId            = data.restaurantId!;
        this.branchId                = data.branchId!;
        this.deliveryAddressId       = data.deliveryAddressId!;
        this.deliveryLat             = data.deliveryLat!;
        this.deliveryLng             = data.deliveryLng!;
        this.deliveryAddressSnapshot = data.deliveryAddressSnapshot!;
        this.deliveryAgentId         = data.deliveryAgentId ?? null;
        this.status                  = data.status ?? 'pending_payment';
        this.paymentMethod           = data.paymentMethod!;
        this.subtotal                = data.subtotal!;
        this.deliveryFee             = data.deliveryFee ?? 0;
        this.serviceFee              = data.serviceFee ?? 0;
        this.discount                = data.discount ?? 0;
        this.commission              = data.commission ?? 0;
        this.total                   = data.total!;
        this.notes                   = data.notes ?? null;
        this.reassignmentCount       = data.reassignmentCount ?? 0;
        this.estimatedDeliveryAt     = data.estimatedDeliveryAt ?? null;
        this.acceptedAt              = data.acceptedAt ?? null;
        this.rejectedAt              = data.rejectedAt ?? null;
        this.readyAt                 = data.readyAt ?? null;
        this.assignedAt              = data.assignedAt ?? null;
        this.pickedAt                = data.pickedAt ?? null;
        this.deliveredAt             = data.deliveredAt ?? null;
        this.cancelledAt             = data.cancelledAt ?? null;
        this.cancellationReason      = data.cancellationReason ?? null;
        this.createdAt               = data.createdAt ?? new Date();
        this.updatedAt               = data.updatedAt ?? new Date();
    }
}
