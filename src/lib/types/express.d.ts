declare namespace Express {
    interface Request {
        correlationId?: string;

        // Set by resolveRegion middleware (lib/sharding/region-resolver.ts).
        // undefined on requests that don't carry an X-Region header (e.g. health).
        // "all" is a valid value for admin fan-out reads; write routes must use requireConcreteRegion.
        region?: string;

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
