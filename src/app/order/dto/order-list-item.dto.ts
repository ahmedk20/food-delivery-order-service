import type { OrderStatus, PaymentMethod } from '../enums.js';

export interface OrderListItemDTO {
    id: string;
    restaurantId: number;
    branchId: number;
    status: OrderStatus;
    paymentMethod: PaymentMethod;
    subtotal: number;
    deliveryFee: number;
    serviceFee: number;
    total: number;
    currency: string;
    itemsCount: number;
    createdAt: Date;
}
