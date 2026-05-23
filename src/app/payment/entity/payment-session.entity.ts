export type PaymentSessionStatus = 'created' | 'completed' | 'failed' | 'expired';

export class PaymentSessionEntity {
    id: number;
    region: string;
    orderId: number;
    providerId: number | null;
    providerSessionId: string;
    sessionUrl: string;
    amount: number;
    currency: string;
    status: PaymentSessionStatus;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;

    constructor(data: Partial<PaymentSessionEntity>) {
        this.id                = data.id!;
        this.region            = data.region!;
        this.orderId           = data.orderId!;
        this.providerId        = data.providerId ?? null;
        this.providerSessionId = data.providerSessionId!;
        this.sessionUrl        = data.sessionUrl!;
        this.amount            = data.amount!;
        this.currency          = data.currency!;
        this.status            = data.status ?? 'created';
        this.expiresAt         = data.expiresAt!;
        this.createdAt         = data.createdAt ?? new Date();
        this.updatedAt         = data.updatedAt ?? new Date();
    }
}
