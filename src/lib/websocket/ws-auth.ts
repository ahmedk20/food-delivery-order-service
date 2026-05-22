import type { Socket } from 'socket.io';
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

function extractCookieToken(cookieHeader: string | undefined): string | null {
    if (!cookieHeader) return null;
    for (const part of cookieHeader.split(';')) {
        const [name, ...rest] = part.trim().split('=');
        if (name.trim() === 'access_token') return decodeURIComponent(rest.join('=').trim());
    }
    return null;
}

/**
 * socket.io handshake middleware.
 * Token source priority:
 *   1. socket.handshake.auth.token  — explicit, preferred for native/SPA clients
 *   2. access_token cookie          — fallback for same-origin browser clients
 */
export async function socketAuthMiddleware(
    socket: Socket,
    next: (err?: Error) => void,
): Promise<void> {
    try {
        const token: string | undefined =
            socket.handshake.auth?.token ??
            extractCookieToken(socket.handshake.headers.cookie);

        if (!token) {
            return next(new Error('unauthorized'));
        }

        const secretKey = createSecretKey(env.jwt.accessSecret, 'utf-8');
        const { payload } = await jwtVerify(token, secretKey);

        socket.data.user = {
            userId:      payload.userId as number,
            role:        payload.role as string,
            countryCode: payload.countryCode as string,
            ...(payload.restaurantId   !== undefined && { restaurantId:   payload.restaurantId   as number }),
            ...(payload.restaurantRole !== undefined && { restaurantRole: payload.restaurantRole as string }),
            ...(payload.branchIds      !== undefined && { branchIds:      payload.branchIds      as number[] }),
        } satisfies WsUser;

        next();
    } catch {
        next(new Error('unauthorized'));
    }
}
