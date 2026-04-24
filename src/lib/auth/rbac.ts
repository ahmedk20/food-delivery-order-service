import type { Request, Response, NextFunction } from 'express';
import { container } from '../di/container.js';
import { TOKENS } from '../di/tokens.js';
import { PermissionCacheService } from '../../app/rbac/service/permission-cache.service.js';
import { SystemRole } from './enums.js';
import { NotAuthenticated } from './errors.js';

export interface RBACOptions {
    resource: string;
    action: string;
    allowSystemAdmin?: boolean;
}

export function rbac(options: RBACOptions) {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (!req.user) throw NotAuthenticated;

            const { resource, action, allowSystemAdmin = true } = options;

            if (allowSystemAdmin && req.user.role === SystemRole.SYSTEM_ADMIN) {
                return next();
            }

            if (req.user.role === SystemRole.RESTAURANT_USER) {
                const permissionCacheService = container.resolve<PermissionCacheService>(TOKENS.PermissionCacheService);
                const permissions = await permissionCacheService.getPermissions(req.user.restaurantRole!);
                if (!permissionCacheService.hasPermission(permissions, resource, action)) {
                    return res.status(403).json({ error: 'Permission denied' });
                }
                return next();
            }

            return res.status(403).json({ error: 'Permission denied' });
        } catch (err) {
            next(err);
        }
    };
}

export function requireRestaurantMember(paramName: string = 'restaurantId') {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) throw NotAuthenticated;

        if (req.user.role === SystemRole.SYSTEM_ADMIN) return next();

        // If a param name is given, verify it matches the JWT restaurantId
        if (paramName && req.params[paramName]) {
            const restaurantId = parseInt(req.params[paramName] as string);
            if (Number(req.user.restaurantId) !== restaurantId) {
                return res.status(403).json({ error: 'Permission denied' });
            }
            return next();
        }

        // No param — just confirm the JWT has a restaurantId (user is some restaurant member)
        if (!req.user.restaurantId) {
            return res.status(403).json({ error: 'Permission denied' });
        }

        next();
    };
}

export function requireBranchAccess(paramName: string = 'branchId') {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) return next(NotAuthenticated);

        if (req.user.role === SystemRole.SYSTEM_ADMIN || req.user.restaurantRole === 'owner') {
            return next();
        }

        const branchId = Number(req.params[paramName] ?? req.query[paramName]);
        if (!branchId) {
            return res.status(400).json({ error: 'Branch ID is required' });
        }

        const branchIds: number[] = (req.user.branchIds as number[]) ?? [];
        if (!branchIds.includes(branchId)) {
            return res.status(403).json({ error: 'Permission denied' });
        }

        next();
    };
}

export function requireSystemAdmin() {
    return (req: Request, _res: Response, next: NextFunction) => {
        if (!req.user) return next(NotAuthenticated);
        if (req.user.role !== SystemRole.SYSTEM_ADMIN) return _res.status(403).json({ error: 'Permission denied' });
        next();
    };
}

export function requireRole(role: SystemRole | string) {
    return (req: Request, _res: Response, next: NextFunction) => {
        if (!req.user) return next(NotAuthenticated);
        if (req.user.role !== role) return _res.status(403).json({ error: 'Permission denied' });
        next();
    };
}
