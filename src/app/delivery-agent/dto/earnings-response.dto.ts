import type { AgentEarningsEntity } from '../entity/agent-earnings.entity.js';
import type { EarningsTotals } from '../repository/agent-earnings.repo.js';

export interface EarningsItemResponseDTO {
    id: number;
    deliveryId: number;
    amount: number;
    currency: string;
    status: string;
    paidAt: string | null;
    createdAt: string;
}

export interface EarningsTotalsResponseDTO {
    currency: string;
    totalAmount: number;
    pendingAmount: number;
    paidAmount: number;
}

export function toEarningsItemResponseDTO(entity: AgentEarningsEntity): EarningsItemResponseDTO {
    return {
        id:         entity.id,
        deliveryId: entity.deliveryId,
        amount:     entity.amount,
        currency:   entity.currency,
        status:     entity.status,
        paidAt:     entity.paidAt?.toISOString() ?? null,
        createdAt:  entity.createdAt.toISOString(),
    };
}

export function toEarningsTotalsResponseDTO(totals: EarningsTotals[]): EarningsTotalsResponseDTO[] {
    return totals.map(t => ({
        currency:      t.currency,
        totalAmount:   t.totalAmount,
        pendingAmount: t.pendingAmount,
        paidAmount:    t.paidAmount,
    }));
}
