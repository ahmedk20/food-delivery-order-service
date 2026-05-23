export type EarningsStatus = 'pending' | 'paid';

export class AgentEarningsEntity {
    id: number;
    region: string;
    agentId: number;
    orderId: number;
    deliveryId: number;
    amount: number;
    currency: string;
    status: EarningsStatus;
    paidAt: Date | null;
    createdAt: Date;

    constructor(data: Partial<AgentEarningsEntity>) {
        this.id         = data.id!;
        this.region     = data.region!;
        this.agentId    = data.agentId!;
        this.orderId    = data.orderId!;
        this.deliveryId = data.deliveryId!;
        this.amount     = data.amount!;
        this.currency   = data.currency!;
        this.status     = data.status ?? 'pending';
        this.paidAt     = data.paidAt ?? null;
        this.createdAt  = data.createdAt ?? new Date();
    }
}
