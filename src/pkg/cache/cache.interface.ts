export interface ICacheProvider {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttl: number): Promise<void>;
    delete(key: string): Promise<void>;

    // Redis Set operations — used for presence:busy tracking
    sAdd(key: string, member: string): Promise<void>;
    sRem(key: string, member: string): Promise<void>;
    sIsMember(key: string, member: string): Promise<boolean>;
}
