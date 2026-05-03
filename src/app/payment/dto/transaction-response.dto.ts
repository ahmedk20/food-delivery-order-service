import type { TransactionStatus, TransactionType } from '../enums.js';

export interface TransactionResponseDTO {
    id: number;
    orderId: number | null;
    amount: number;
    currency: string;
    type: TransactionType;
    status: TransactionStatus;
    externalReference: string | null;
    createdAt: Date;
}
