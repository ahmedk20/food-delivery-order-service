import type { Request, Response, NextFunction } from 'express';
import AppError from '../error/AppError.js';
import { env } from '../config/env.js';

const RegionNotResolvedError = new AppError('X-Region header is required', 400);
const RegionConcreteRequired = new AppError('X-Region must be a specific region, not "all"', 400);
const RegionUnknownError     = (r: string) => new AppError(`Unknown region: ${r}`, 400);

/**
 * Global middleware — reads the X-Region header and writes it to req.region.
 * Never throws: if the header is missing, req.region stays undefined.
 * Route-level guards (requireRegion / requireConcreteRegion) enforce presence.
 */
export function resolveRegion(req: Request, _res: Response, next: NextFunction): void {
    const raw = req.headers['x-region'];
    if (typeof raw === 'string' && raw.trim()) {
        req.region = raw.trim().toLowerCase();
    }
    next();
}

/**
 * Route guard — rejects requests where req.region is undefined.
 * Apply on any endpoint that does a sharded DB query.
 */
export function requireRegion(req: Request, _res: Response, next: NextFunction): void {
    if (!req.region) return next(RegionNotResolvedError);
    next();
}

/**
 * Route guard — rejects requests where req.region is "all".
 * Apply on every write endpoint so fan-out reads (admin, X-Region: all)
 * never accidentally reach a transaction path.
 */
export function requireConcreteRegion(req: Request, _res: Response, next: NextFunction): void {
    if (!req.region)        return next(RegionNotResolvedError);
    if (req.region === 'all') return next(RegionConcreteRequired);
    if (!env.regions.includes(req.region)) return next(RegionUnknownError(req.region));
    next();
}
