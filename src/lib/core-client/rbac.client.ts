import { injectable } from 'tsyringe';
import { BaseCoreClient } from './base.client.js';
import type { RolePermissionsData } from './types.js';

@injectable()
export class RbacClient extends BaseCoreClient {
    getRolePermissions(roleName: string, correlationId?: string): Promise<RolePermissionsData> {
        return this.getPublic<RolePermissionsData>(
            `/api/roles/${encodeURIComponent(roleName)}/permissions`,
            correlationId,
        );
    }
}
