import { SignJWT, type JWTPayload } from 'jose';
import { createSecretKey } from 'crypto';

const SECRET = createSecretKey('test-jwt-secret-that-is-long-enough-for-hmac', 'utf-8');

interface TokenPayload extends JWTPayload {
    userId: number;
    role: string;
    countryCode: string;
    restaurantId?: number;
    restaurantRole?: string;
    branchIds?: number[];
}

export async function signToken(payload: TokenPayload): Promise<string> {
    return new SignJWT(payload as unknown as Record<string, unknown>)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(SECRET);
}

export async function customerToken(userId = 100, countryCode = 'eg'): Promise<string> {
    return signToken({ userId, role: 'customer', countryCode });
}

export async function agentToken(userId = 200, countryCode = 'eg'): Promise<string> {
    return signToken({ userId, role: 'delivery_agent', countryCode });
}

export async function adminToken(userId = 300, countryCode = 'eg'): Promise<string> {
    return signToken({ userId, role: 'system_admin', countryCode });
}

export async function restaurantToken(
    userId = 400,
    restaurantId = 10,
    restaurantRole = 'owner',
    branchIds = [1, 2],
    countryCode = 'eg',
): Promise<string> {
    return signToken({ userId, role: 'restaurant_user', countryCode, restaurantId, restaurantRole, branchIds });
}
