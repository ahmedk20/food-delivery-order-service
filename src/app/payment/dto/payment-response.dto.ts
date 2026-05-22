import type { TransactionStatus, TransactionType } from '../enums.js';

export interface PaymentResponseDTO {
    id: number;
    orderPublicId: string | null;
    type: TransactionType;
    method: string;
    status: TransactionStatus;
    amount: number;
    currency: string;
    isRefunded: boolean;
    refundedPaymentId?: number;
    createdAt: string;
}
