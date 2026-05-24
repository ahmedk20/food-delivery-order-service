import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../di/tokens.js';
import { toMs } from '../../pkg/utils/time.js';
import type { RbacClient } from '../core-client/rbac.client.js';

@injectable()
export class PermissionCacheService {
    private cache: Map<string, { permissions: string[]; cachedAt: number }> = new Map();
    private readonly TTL = toMs(1, 'h');

    constructor(
        @inject(TOKENS.RbacClient) private readonly rbacClient: RbacClient,
    ) {}

    async getPermissions(roleName: string): Promise<string[]> {
        const cached = this.cache.get(roleName);
        if (cached && Date.now() - cached.cachedAt < this.TTL) return cached.permissions;

        const result = await this.rbacClient.getRolePermissions(roleName);
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
