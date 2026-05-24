import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verifies a Kashier webhook HMAC-SHA256 signature.
 *
 * Kashier signs a subset of payload fields specified by `signatureKeys`,
 * sorted alphabetically and joined as a query string, then HMAC'd with
 * KASHIER_WEBHOOK_SECRET (NOT the API key).
 */
export function verifyKashierSignature(
    payload: Record<string, any>,
    signature: string,
    webhookSecret: string,
): boolean {
    if (!signature || typeof signature !== 'string') return false;
    if (!/^[0-9a-fA-F]+$/.test(signature)) return false;

    const signatureKeys: string[] = Array.isArray(payload.signatureKeys) ? payload.signatureKeys : [];
    const data: Record<string, any> = payload.data ?? {};
    if (signatureKeys.length === 0) return false;

    const sorted = [...signatureKeys].sort();
    const qs     = sorted.map(k => `${k}=${encodeURIComponent(String(data[k] ?? ''))}`).join('&');

    const expectedHex = createHmac('sha256', webhookSecret).update(qs).digest('hex');

    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const sigBuf      = Buffer.from(signature,   'hex');
    if (expectedBuf.length !== sigBuf.length) return false;

    return timingSafeEqual(expectedBuf, sigBuf);
}
