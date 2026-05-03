import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../../../lib/di/tokens.js';
import { toMs } from '../../../pkg/utils/time.js';
import type { ICoreServiceClient } from '../../../pkg/http/http-client.interface.js';

@injectable()
export class PermissionCacheService {
    private cache: Map<string, { permissions: string[]; cachedAt: number }> = new Map();
    private readonly TTL = toMs(1, 'h');

    constructor(
        @inject(TOKENS.CoreServiceClient) private readonly coreClient: ICoreServiceClient,
    ) {}

    async getPermissions(roleName: string): Promise<string[]> {
        const cached = this.cache.get(roleName);
        if (cached && Date.now() - cached.cachedAt < this.TTL) return cached.permissions;

        const result = await this.coreClient.getRolePermissions(roleName);
        const permissions = result.permissions.map(p => p.permission);
        this.cache.set(roleName, { permissions, cachedAt: Date.now() });
        return permissions;
    }

    hasPermission(permissions: string[], resource: string, action: string): boolean {
        return permissions.includes(`${resource}:${action}`);
    }

    invalidate(roleName: string): void {
        this.cache.delete(roleName);
    }
}
