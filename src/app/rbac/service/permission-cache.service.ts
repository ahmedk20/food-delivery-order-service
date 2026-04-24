import axios from 'axios';
import { injectable } from 'tsyringe';
import { env } from '../../../lib/config/env.js';
import { toMs } from '../../../pkg/utils/time.js';

@injectable()
export class PermissionCacheService {
    private cache: Map<string, { permissions: string[]; cachedAt: number }> = new Map();
    private readonly TTL = toMs(1, 'h');

    async getPermissions(roleName: string): Promise<string[]> {
        const cached = this.cache.get(roleName);
        if (cached && Date.now() - cached.cachedAt < this.TTL) {
            return cached.permissions;
        }

        const { data } = await axios.get<string[]>(
            `${env.coreServiceUrl}/api/rbac/roles/${encodeURIComponent(roleName)}/permissions`
        );

        this.cache.set(roleName, { permissions: data, cachedAt: Date.now() });
        return data;
    }

    hasPermission(permissions: string[], resource: string, action: string): boolean {
        return permissions.includes(`${resource}:${action}`);
    }

    invalidate(roleName: string): void {
        this.cache.delete(roleName);
    }
}
