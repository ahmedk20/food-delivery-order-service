export type OrderStatus =
    | 'pending'
    | 'confirmed'
    | 'preparing'
    | 'ready_for_pickup'
    | 'picked_up'
    | 'on_the_way'
    | 'delivered'
    | 'cancelled'
    | 'failed';

export type PaymentMethod = 'online' | 'cash';

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

export class Order {
    id: number;
    countryCode: string;
    customerId: number;
    restaurantId: number;
    branchId: number;
    deliveryAddressId: number;
    deliveryAddressSnapshot: DeliveryAddressSnapshot;
    deliveryAgentId: number | null;
    status: OrderStatus;
    paymentMethod: PaymentMethod;
    itemsTotal: number;
    deliveryFee: number;
    discount: number;
    totalAmount: number;
    notes: string | null;
    estimatedDeliveryAt: Date | null;
    deliveryStartedAt: Date | null;
    deliveredAt: Date | null;
    cancelledAt: Date | null;
    cancellationReason: string | null;
    createdAt: Date;
    updatedAt: Date;

    constructor(data: Partial<Order>) {
        this.id = data.id!;
        this.countryCode = data.countryCode!;
        this.customerId = data.customerId!;
        this.restaurantId = data.restaurantId!;
        this.branchId = data.branchId!;
        this.deliveryAddressId = data.deliveryAddressId!;
        this.deliveryAddressSnapshot = data.deliveryAddressSnapshot!;
        this.deliveryAgentId = data.deliveryAgentId ?? null;
        this.status = data.status ?? 'pending';
        this.paymentMethod = data.paymentMethod!;
        this.itemsTotal = data.itemsTotal!;
        this.deliveryFee = data.deliveryFee ?? 0;
        this.discount = data.discount ?? 0;
        this.totalAmount = data.totalAmount!;
        this.notes = data.notes ?? null;
        this.estimatedDeliveryAt = data.estimatedDeliveryAt ?? null;
        this.deliveryStartedAt = data.deliveryStartedAt ?? null;
        this.deliveredAt = data.deliveredAt ?? null;
        this.cancelledAt = data.cancelledAt ?? null;
        this.cancellationReason = data.cancellationReason ?? null;
        this.createdAt = data.createdAt ?? new Date();
        this.updatedAt = data.updatedAt ?? new Date();
    }
}
