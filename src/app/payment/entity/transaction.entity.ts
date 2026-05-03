import type { TransactionType, TransactionStatus } from '../enums.js';

export class Transaction {
    id: number;
    countryCode: string;
    orderId: number | null;
    srcAccId: number | null;
    dstAccId: number;
    amount: number;                          // piastres
    currency: string;
    type: TransactionType;
    status: TransactionStatus;
    paymentProviderId: number | null;
    externalReference: string | null;        // Kashier session _id
    kashierOrderId: string | null;           // Kashier payment transaction ID from webhook
    metadata: Record<string, any>;
    idempotencyKey: string | null;
    createdAt: Date;
    updatedAt: Date;

    constructor(data: Partial<Transaction>) {
        this.id = data.id!;
        this.countryCode = data.countryCode!;
        this.orderId = data.orderId ?? null;
        this.srcAccId = data.srcAccId ?? null;
        this.dstAccId = data.dstAccId!;
        this.amount = data.amount!;
        this.currency = data.currency ?? 'EGP';
        this.type = data.type!;
        this.status = data.status ?? 'pending';
        this.paymentProviderId = data.paymentProviderId ?? null;
        this.externalReference = data.externalReference ?? null;
        this.kashierOrderId = data.kashierOrderId ?? null;
        this.metadata = data.metadata ?? {};
        this.idempotencyKey = data.idempotencyKey ?? null;
        this.createdAt = data.createdAt ?? new Date();
        this.updatedAt = data.updatedAt ?? new Date();
    }
}
