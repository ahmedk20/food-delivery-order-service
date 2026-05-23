import Redis from 'ioredis';
import type { ICacheProvider } from './cache.interface.js';

export interface RedisConfig {
    host: string;
    port: number;
    password?: string;
}

export class RedisCacheProvider implements ICacheProvider {
    private readonly client: Redis;

    constructor(config: RedisConfig) {
        this.client = new Redis({
            host: config.host,
            port: config.port,
            password: config.password,
            lazyConnect: true,
            maxRetriesPerRequest: 3,
        });

        this.client.on('error', (err) => {
            console.error('Redis error:', err);
        });

        this.client.connect().catch((err) => {
            console.error('Redis connection error:', err);
        });
    }

    get(key: string): Promise<string | null> {
        return this.client.get(key);
    }

    async set(key: string, value: string, ttl: number): Promise<void> {
        await this.client.setex(key, ttl, value);
    }

    async delete(key: string): Promise<void> {
        await this.client.del(key);
    }

    async sAdd(key: string, member: string): Promise<void> {
        await this.client.sadd(key, member);
    }

    async sRem(key: string, member: string): Promise<void> {
        await this.client.srem(key, member);
    }

    async sIsMember(key: string, member: string): Promise<boolean> {
        const result = await this.client.sismember(key, member);
        return result === 1;
    }

    async geoAdd(key: string, lng: number, lat: number, member: string): Promise<void> {
        await this.client.geoadd(key, lng, lat, member);
    }

    async geoRem(key: string, member: string): Promise<void> {
        // geo sets are backed by sorted sets; ZREM removes the member
        await this.client.zrem(key, member);
    }

    async geosearchByRadius(
        key: string,
        lng: number,
        lat: number,
        radiusMeters: number,
        count: number,
    ): Promise<string[]> {
        const result = await (this.client as any).geosearch(
            key, 'FROMLONLAT', lng, lat, 'BYRADIUS', radiusMeters, 'm', 'ASC', 'COUNT', count,
        );
        return (result as string[]) ?? [];
    }
}
