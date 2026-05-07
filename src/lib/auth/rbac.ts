import type { Request, Response, NextFunction } from 'express';
import { container } from '../di/container.js';
import { TOKENS } from '../di/tokens.js';
import { PermissionCacheService } from '../../app/rbac/service/permission-cache.service.js';
import AppError from '../error/AppError.js';
import { SystemRole } from './enums.js';
import { NotAuthenticated, NotAuthorized } from './errors.js';

export interface RBACOptions {
    resource: string;
    action: string;
    allowSystemAdmin?: boolean;
}

export function rbac(options: RBACOptions) {
    return async (req: Request, _res: Response, next: NextFunction) => {
        try {
            if (!req.user) return next(NotAuthenticated);

            const { resource, action, allowSystemAdmin = true } = options;

            if (allowSystemAdmin && req.user.role === SystemRole.SYSTEM_ADMIN) {
                return next();
            }

            if (req.user.role === SystemRole.RESTAURANT_USER) {
                if (!req.user.restaurantRole) return next(NotAuthorized);
                const permissionCacheService = container.resolve<PermissionCacheService>(TOKENS.PermissionCacheService);
                const permissions = await permissionCacheService.getPermissions(req.user.restaurantRole);
                if (!permissionCacheService.hasPermission(permissions, resource, action)) {
                    return next(NotAuthorized);
                }
                return next();
            }

            return next(NotAuthorized);
        } catch (err) {
            next(err);
        }
    };
}

export function requireRestaurantMember(paramName: string = 'restaurantId') {
    return (req: Request, _res: Response, next: NextFunction) => {
        if (!req.user) return next(NotAuthenticated);

        if (req.user.role === SystemRole.SYSTEM_ADMIN) return next();

        if (paramName && req.params[paramName]) {
            const restaurantId = parseInt(req.params[paramName] as string, 10);
            if (Number.isNaN(restaurantId)) return next(new AppError('Invalid restaurantId', 400));
            if (Number(req.user.restaurantId) !== restaurantId) return next(NotAuthorized);
            return next();
        }

        if (!req.user.restaurantId) return next(NotAuthorized);
        next();
    };
}

export function requireBranchAccess(paramName: string = 'branchId') {
    return (req: Request, _res: Response, next: NextFunction) => {
        if (!req.user) return next(NotAuthenticated);

        if (req.user.role === SystemRole.SYSTEM_ADMIN || req.user.restaurantRole === 'owner') {
            return next();
        }

        const raw = req.params[paramName] ?? req.query[paramName];
        const branchId = Number(raw);
        if (!Number.isFinite(branchId) || branchId <= 0) {
            return next(new AppError('Branch ID is required', 400));
        }

        const branchIds: number[] = (req.user.branchIds as number[]) ?? [];
        if (!branchIds.includes(branchId)) return next(NotAuthorized);

        next();
    };
}

export function requireSystemAdmin() {
    return (req: Request, _res: Response, next: NextFunction) => {
        if (!req.user) return next(NotAuthenticated);
        if (req.user.role !== SystemRole.SYSTEM_ADMIN) return next(NotAuthorized);
        next();
    };
}

export function requireRole(role: SystemRole | string) {
    return (req: Request, _res: Response, next: NextFunction) => {
        if (!req.user) return next(NotAuthenticated);
        if (req.user.role !== role) return next(NotAuthorized);
        next();
    };
}
