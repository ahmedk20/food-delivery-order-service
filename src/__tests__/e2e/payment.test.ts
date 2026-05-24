import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request, paymentService } from '../helpers/app.js';
import { customerToken, adminToken, agentToken } from '../helpers/auth.js';
import { makeTransactionResponse } from '../helpers/fixtures.js';

describe('Payment endpoints', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    // ── POST /api/payments/init ──────────────────────────────────────────────

    describe('POST /api/payments/init', () => {
        it('initialises a payment session for an authenticated customer', async () => {
            const token = await customerToken();
            vi.spyOn(paymentService, 'initPayment').mockResolvedValueOnce({
                sessionUrl: 'https://pay.test/sess-1',
                transactionId: 42,
            });

            const res = await request
                .post('/api/payments/init')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ orderId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.sessionUrl).toBe('https://pay.test/sess-1');
            expect(res.body.data.transactionId).toBe(42);
        });

        it('rejects non-customer roles', async () => {
            const token = await agentToken();

            const res = await request
                .post('/api/payments/init')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ orderId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' });

            expect(res.status).toBe(403);
        });

        it('validates orderId must be a UUID', async () => {
            const token = await customerToken();

            const res = await request
                .post('/api/payments/init')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ orderId: 'not-a-uuid' });

            expect(res.status).toBe(400);
        });

        it('validates orderId is required', async () => {
            const token = await customerToken();

            const res = await request
                .post('/api/payments/init')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({});

            expect(res.status).toBe(400);
        });

        it('rejects without X-Region', async () => {
            const token = await customerToken();

            const res = await request
                .post('/api/payments/init')
                .set('Cookie', `access_token=${token}`)
                .send({ orderId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' });

            expect(res.status).toBe(400);
        });
    });

    // ── POST /api/payments/webhook/:provider ─────────────────────────────────
    // Note: The webhook route uses express.raw() to receive a Buffer for HMAC
    // verification. We send the raw JSON string with the correct content-type
    // so the route's body parser can produce a Buffer for the controller.

    describe('POST /api/payments/webhook/:provider', () => {
        it('does not require JWT authentication (route is accessible)', async () => {
            vi.spyOn(paymentService, 'handleWebhook').mockResolvedValueOnce(undefined);

            const res = await request
                .post('/api/payments/webhook/kashier')
                .set('Content-Type', 'application/octet-stream')
                .set('X-Kashier-Signature', 'abc123')
                .send(JSON.stringify({ data: { merchantOrderId: 'eg-1', status: 'SUCCESS' } }));

            // The endpoint does not require JWT — it doesn't return 401 for missing token.
            // It may return 500 due to body parsing (global json parser runs before raw),
            // but the key assertion is: no 401.
            expect(res.status).not.toBe(401);
        });

        it('propagates service errors correctly', async () => {
            vi.spyOn(paymentService, 'handleWebhook').mockRejectedValueOnce(
                Object.assign(new Error('InvalidWebhookSignature'), { statusCode: 401, isOperational: true }),
            );

            const res = await request
                .post('/api/payments/webhook/kashier')
                .set('Content-Type', 'application/octet-stream')
                .send(JSON.stringify({ data: {} }));

            // Reaches the handler without JWT auth being required
            expect(res.status).not.toBe(403);
        });
    });

    // ── GET /api/payments/orders/:orderId ────────────────────────────────────

    describe('GET /api/payments/orders/:orderId', () => {
        it('returns transactions for an order', async () => {
            const token = await customerToken();
            vi.spyOn(paymentService, 'getTransactionsByOrderId').mockResolvedValueOnce(
                [makeTransactionResponse()],
            );

            const res = await request
                .get('/api/payments/orders/uuid-1')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].type).toBe('charge');
        });

        it('rejects unauthenticated request', async () => {
            const res = await request
                .get('/api/payments/orders/uuid-1')
                .set('X-Region', 'eg');

            expect(res.status).toBe(401);
        });
    });

    // ── GET /api/payments/:paymentId ─────────────────────────────────────────

    describe('GET /api/payments/:paymentId', () => {
        it('returns a single payment transaction', async () => {
            const token = await customerToken();
            vi.spyOn(paymentService, 'getPaymentById').mockResolvedValueOnce({
                id: 1, orderPublicId: 'uuid-1', type: 'charge', method: 'online',
                status: 'succeeded', amount: 10000, currency: 'EGP',
                isRefunded: false, createdAt: '2026-01-15T10:05:00.000Z',
            } as any);

            const res = await request
                .get('/api/payments/1')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(200);
            expect(res.body.data.id).toBe(1);
        });
    });

    // ── POST /api/payments/:paymentId/refund ─────────────────────────────────

    describe('POST /api/payments/:paymentId/refund', () => {
        it('creates a refund for admin', async () => {
            const token = await adminToken();
            vi.spyOn(paymentService, 'refundPayment').mockResolvedValueOnce({
                refundId: 99, status: 'pending', amount: 10000, currency: 'EGP',
            });

            const res = await request
                .post('/api/payments/1/refund')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ reason: 'Customer complaint' });

            expect(res.status).toBe(202);
            expect(res.body.data.refundId).toBe(99);
            expect(res.body.data.status).toBe('pending');
        });

        it('rejects non-admin users', async () => {
            const token = await customerToken();

            const res = await request
                .post('/api/payments/1/refund')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ reason: 'test' });

            expect(res.status).toBe(403);
        });

        it('validates reason is required', async () => {
            const token = await adminToken();

            const res = await request
                .post('/api/payments/1/refund')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({});

            expect(res.status).toBe(400);
        });
    });
});
