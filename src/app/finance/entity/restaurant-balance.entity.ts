export class RestaurantBalanceEntity {
    restaurantId: number;
    region: string;
    currency: string;
    availableBalance: number;
    pendingBalance: number;
    totalEarned: number;
    createdAt: Date;
    updatedAt: Date;

    constructor(data: Partial<RestaurantBalanceEntity>) {
        this.restaurantId     = data.restaurantId!;
        this.region           = data.region!;
        this.currency         = data.currency!;
        this.availableBalance = data.availableBalance ?? 0;
        this.pendingBalance   = data.pendingBalance ?? 0;
        this.totalEarned      = data.totalEarned ?? 0;
        this.createdAt        = data.createdAt ?? new Date();
        this.updatedAt        = data.updatedAt ?? new Date();
    }
}
