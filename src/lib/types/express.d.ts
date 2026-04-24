declare namespace Express {
    interface Request {
        correlationId?: string;
        user?: {
            userId: number;
            role: string;
            countryCode: string;
            restaurantId?: number;
            restaurantRole?: string;
            branchIds?: number[];
            [key: string]: unknown;
        };
    }
}
