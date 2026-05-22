import type { TransactionType, TransactionStatus, TransactionMethod } from '../enums.js';

export class Transaction {
    id: number;
    region: string;
    orderId: number | null;
    type: TransactionType;
    method: TransactionMethod;
    providerId: number | null;
    providerReferenceId: string | null;
    status: TransactionStatus;
    amount: number;                    // minor currency units (piastres / halalas)
    currency: string;                  // copied from order.currency — never re-derived
    srcAccId: number | null;
    dstAccId: number | null;
    isRefunded: boolean;
    refundedPaymentId: number | null;
    idempotencyKey: string | null;
    metadata: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;

    constructor(data: Partial<Transaction>) {
        this.id                  = data.id!;
        this.region              = data.region!;
        this.orderId             = data.orderId ?? null;
        this.type                = data.type!;
        this.method              = data.method!;
        this.providerId          = data.providerId ?? null;
        this.providerReferenceId = data.providerReferenceId ?? null;
        this.status              = data.status ?? 'pending';
        this.amount              = data.amount!;
        this.currency            = data.currency!;
        this.srcAccId            = data.srcAccId ?? null;
        this.dstAccId            = data.dstAccId ?? null;
        this.isRefunded          = data.isRefunded ?? false;
        this.refundedPaymentId   = data.refundedPaymentId ?? null;
        this.idempotencyKey      = data.idempotencyKey ?? null;
        this.metadata            = data.metadata ?? {};
        this.createdAt           = data.createdAt ?? new Date();
        this.updatedAt           = data.updatedAt ?? new Date();
    }
}
