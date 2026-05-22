import type { DeliveryAddressSnapshot } from '../entity/order.entity.js';
import type { OrderStatus, PaymentMethod } from '../enums.js';

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
    id: string;
    restaurantId: number;
    branchId: number;
    status: OrderStatus;
    paymentMethod: PaymentMethod;
    subtotal: number;
    deliveryFee: number;
    serviceFee: number;
    discount: number;
    commission: number;
    total: number;
    currency: string;
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
