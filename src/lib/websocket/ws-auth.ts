import { jwtVerify } from 'jose';
import { createSecretKey } from 'crypto';
import { env } from '../config/env.js';

export interface WsUser {
    userId: number;
    role: string;
    countryCode: string;
    restaurantId?: number;
    restaurantRole?: string;
    branchIds?: number[];
}

function parseAccessTokenCookie(cookieHeader: string | undefined): string | null {
    if (!cookieHeader) return null;
    const cookies = cookieHeader.split(';').map(c => c.trim());
    for (const cookie of cookies) {
        const eq = cookie.indexOf('=');
        if (eq === -1) continue;
        const name = cookie.slice(0, eq).trim();
        if (name === 'access_token') {
            return decodeURIComponent(cookie.slice(eq + 1).trim());
        }
    }
    return null;
}

export async function verifyWsToken(cookieHeader: string | undefined): Promise<WsUser> {
    const token = parseAccessTokenCookie(cookieHeader);
    if (!token) throw new Error('Missing access_token cookie');

    const secretKey = createSecretKey(env.jwt.accessSecret, 'utf-8');
    const { payload } = await jwtVerify(token, secretKey);

    return {
        userId:      payload.userId as number,
        role:        payload.role as string,
        countryCode: (payload.countryCode as string) ?? env.countryCode,
        ...(payload.restaurantId   !== undefined && { restaurantId:   payload.restaurantId   as number }),
        ...(payload.restaurantRole !== undefined && { restaurantRole: payload.restaurantRole as string }),
        ...(payload.branchIds      !== undefined && { branchIds:      payload.branchIds      as number[] }),
    };
}
