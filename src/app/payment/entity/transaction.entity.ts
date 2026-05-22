import type { TransactionType, TransactionStatus } from '../enums.js';

export class Transaction {
    id: number;
    region: string;
    orderId: number | null;
    srcAccId: number | null;
    dstAccId: number | null;
    amount: number;                    // minor currency units (piastres / halalas)
    currency: string;                  // copied from order.currency — never re-derived
    type: TransactionType;
    status: TransactionStatus;
    paymentProviderId: number | null;
    externalReference: string | null;  // Kashier session _id
    kashierOrderId: string | null;     // Kashier payment transaction ID from webhook
    metadata: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;

    constructor(data: Partial<Transaction>) {
        this.id                = data.id!;
        this.region            = data.region!;
        this.orderId           = data.orderId ?? null;
        this.srcAccId          = data.srcAccId ?? null;
        this.dstAccId          = data.dstAccId ?? null;
        this.amount            = data.amount!;
        this.currency          = data.currency!;
        this.type              = data.type!;
        this.status            = data.status ?? 'pending';
        this.paymentProviderId = data.paymentProviderId ?? null;
        this.externalReference = data.externalReference ?? null;
        this.kashierOrderId    = data.kashierOrderId ?? null;
        this.metadata          = data.metadata ?? {};
        this.createdAt         = data.createdAt ?? new Date();
        this.updatedAt         = data.updatedAt ?? new Date();
    }
}
