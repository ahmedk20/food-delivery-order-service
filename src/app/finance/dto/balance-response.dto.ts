import type { RestaurantBalanceEntity } from '../entity/restaurant-balance.entity.js';

export class BalanceResponseDTO {
    restaurantId!: number;
    currency!: string;
    availableBalance!: number;
    pendingBalance!: number;
    totalEarned!: number;
    updatedAt!: string;

    static fromEntity(entity: RestaurantBalanceEntity): BalanceResponseDTO {
        const dto = new BalanceResponseDTO();
        dto.restaurantId     = entity.restaurantId;
        dto.currency         = entity.currency;
        dto.availableBalance = entity.availableBalance;
        dto.pendingBalance   = entity.pendingBalance;
        dto.totalEarned      = entity.totalEarned;
        dto.updatedAt        = entity.updatedAt.toISOString();
        return dto;
    }
}
