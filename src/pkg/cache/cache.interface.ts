export interface ICacheProvider {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttl: number): Promise<void>;
    delete(key: string): Promise<void>;

    // Redis Set operations — used for presence:busy tracking
    sAdd(key: string, member: string): Promise<void>;
    sRem(key: string, member: string): Promise<void>;
    sIsMember(key: string, member: string): Promise<boolean>;

    // Redis Sorted Set (geo) operations — used for presence:geo tracking
    geoAdd(key: string, lng: number, lat: number, member: string): Promise<void>;
    geoRem(key: string, member: string): Promise<void>;
    geosearchByRadius(key: string, lng: number, lat: number, radiusMeters: number, count: number): Promise<string[]>;
    zMembers(key: string): Promise<string[]>;  // ZRANGE 0 -1 — all geo set members

    // Redis Set membership enumeration — used for presence:busy listing (admin)
    sMembers(key: string): Promise<string[]>;

    // Atomic SETNX — returns true if key was set (first caller), false if it already existed.
    trySet(key: string, value: string, ttlSeconds: number): Promise<boolean>;

    // Counter operations — used by assignment worker for per-order attempt tracking
    incr(key: string): Promise<number>;
    expire(key: string, ttlSeconds: number): Promise<void>;
    ttl(key: string): Promise<number>;
}
