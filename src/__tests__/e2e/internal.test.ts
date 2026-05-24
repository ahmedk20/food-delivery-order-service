import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { request } from '../helpers/app.js';
import { customerToken } from '../helpers/auth.js';

const HMAC_SECRET = 'test-internal-hmac-secret-long-enough';

function internalHeaders(method: string, path: string): Record<string, string> {
    const timestamp = String(Date.now());
    const sig = createHmac('sha256', HMAC_SECRET)
        .update(`${timestamp}:${method}:${path}`)
        .digest('hex');
    return { 'x-internal-signature': sig, 'x-internal-timestamp': timestamp };
}

describe('Internal webhook endpoints', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    // ── POST /api/internal/webhooks/core ─────────────────────────────────────

    describe('POST /api/internal/webhooks/core', () => {
        it('accepts a valid HMAC-signed event', async () => {
            const headers = internalHeaders('POST', '/api/internal/webhooks/core');

            const res = await request
                .post('/api/internal/webhooks/core')
                .set('x-internal-signature', headers['x-internal-signature'])
                .set('x-internal-timestamp', headers['x-internal-timestamp'])
                .send({ eventType: 'product.updated', payload: { productId: 1 } });

            expect(res.status).toBe(200);
            expect(res.body.data.ok).toBe(true);
        });

        it('rejects missing HMAC signature', async () => {
            const res = await request
                .post('/api/internal/webhooks/core')
                .send({ eventType: 'product.updated', payload: { productId: 1 } });

            expect(res.status).toBe(401);
        });

        it('rejects invalid HMAC signature', async () => {
            const res = await request
                .post('/api/internal/webhooks/core')
                .set('x-internal-signature', 'deadbeef')
                .set('x-internal-timestamp', String(Date.now()))
                .send({ eventType: 'product.updated', payload: { productId: 1 } });

            expect(res.status).toBe(401);
        });

        it('rejects stale timestamp (> 60s)', async () => {
            const staleTimestamp = String(Date.now() - 120_000);
            const sig = createHmac('sha256', HMAC_SECRET)
                .update(`${staleTimestamp}:POST:/api/internal/webhooks/core`)
                .digest('hex');

            const res = await request
                .post('/api/internal/webhooks/core')
                .set('x-internal-signature', sig)
                .set('x-internal-timestamp', staleTimestamp)
                .send({ eventType: 'product.updated', payload: { productId: 1 } });

            expect(res.status).toBe(401);
        });

        it('rejects missing eventType', async () => {
            const headers = internalHeaders('POST', '/api/internal/webhooks/core');

            const res = await request
                .post('/api/internal/webhooks/core')
                .set('x-internal-signature', headers['x-internal-signature'])
                .set('x-internal-timestamp', headers['x-internal-timestamp'])
                .send({ payload: { productId: 1 } });

            expect(res.status).toBe(400);
        });

        it('rejects missing payload', async () => {
            const headers = internalHeaders('POST', '/api/internal/webhooks/core');

            const res = await request
                .post('/api/internal/webhooks/core')
                .set('x-internal-signature', headers['x-internal-signature'])
                .set('x-internal-timestamp', headers['x-internal-timestamp'])
                .send({ eventType: 'product.updated' });

            expect(res.status).toBe(400);
        });

        it('does not accept JWT auth instead of HMAC', async () => {
            const token = await customerToken();

            const res = await request
                .post('/api/internal/webhooks/core')
                .set('Cookie', `access_token=${token}`)
                .send({ eventType: 'product.updated', payload: { productId: 1 } });

            expect(res.status).toBe(401);
        });
    });
});
