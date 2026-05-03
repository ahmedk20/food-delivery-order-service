import type { DeliveryAddressSnapshot, OrderStatus, PaymentMethod } from '../entity/order.entity.js';

export interface OrderItemResponseDTO {
    id: number;
    productId: number;
    productName: string;
    productImageUrl: string | null;
    unitPrice: number;
    quantity: number;
    subtotal: number;
    notes: string | null;
}

export interface OrderSummaryResponseDTO {
    id: number;
    restaurantId: number;
    branchId: number;
    status: OrderStatus;
    paymentMethod: PaymentMethod;
    itemsTotal: number;
    deliveryFee: number;
    discount: number;
    totalAmount: number;
    notes: string | null;
    estimatedDeliveryAt: Date | null;
    deliveredAt: Date | null;
    cancelledAt: Date | null;
    createdAt: Date;
}

export interface OrderResponseDTO extends OrderSummaryResponseDTO {
    deliveryAddressSnapshot: DeliveryAddressSnapshot;
    cancellationReason: string | null;
    items: OrderItemResponseDTO[];
}
