import type { Transaction } from '../../payment/entity/transaction.entity.js';

export class PayoutResponseDTO {
    id!: number;
    amount!: number;
    currency!: string;
    status!: string;
    providerReferenceId!: string | null;
    createdAt!: string;

    static fromEntity(tx: Transaction): PayoutResponseDTO {
        const dto = new PayoutResponseDTO();
        dto.id                  = tx.id;
        dto.amount              = tx.amount;
        dto.currency            = tx.currency;
        dto.status              = tx.status;
        dto.providerReferenceId = tx.providerReferenceId;
        dto.createdAt           = tx.createdAt.toISOString();
        return dto;
    }
}
