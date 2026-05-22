import type { Request, Response, NextFunction } from 'express';
import { jwtVerify } from 'jose';
import { createSecretKey } from 'crypto';
import { env } from '../config/env.js';
import { NotAuthenticated } from './errors.js';

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
    try {
        const token = req.cookies?.access_token;
        if (!token) throw NotAuthenticated;

        const secretKey = createSecretKey(env.jwt.accessSecret, 'utf-8');
        const { payload } = await jwtVerify(token, secretKey);

        req.user = {
            userId:         payload.userId as number,
            role:           payload.role as string,
            countryCode:    payload.countryCode as string,
            ...(payload.restaurantId   !== undefined && { restaurantId:   payload.restaurantId   as number }),
            ...(payload.restaurantRole !== undefined && { restaurantRole: payload.restaurantRole as string }),
            ...(payload.branchIds      !== undefined && { branchIds:      payload.branchIds      as number[] }),
        };

        next();
    } catch {
        next(NotAuthenticated);
    }
}
