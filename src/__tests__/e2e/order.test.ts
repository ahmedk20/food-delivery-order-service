import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request, orderService } from '../helpers/app.js';
import { customerToken, agentToken, adminToken } from '../helpers/auth.js';
import { makeOrderResponse, makeOrderListItem } from '../helpers/fixtures.js';

describe('Order endpoints', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    // ── POST /api/orders ─────────────────────────────────────────────────────

    describe('POST /api/orders', () => {
        const validBody = {
            branchId:          1,
            deliveryAddressId: 5,
            paymentMethod:     'cash',
            items:             [{ productId: 10, quantity: 2 }],
        };

        it('creates an order for an authenticated customer', async () => {
            const token = await customerToken();
            const mockOrder = makeOrderResponse();
            vi.spyOn(orderService, 'placeOrder').mockResolvedValueOnce(mockOrder);

            const res = await request
                .post('/api/orders')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send(validBody);

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.id).toBe(mockOrder.id);
            expect(res.body.data.status).toBe('placed');
        });

        it('rejects unauthenticated requests', async () => {
            const res = await request
                .post('/api/orders')
                .set('X-Region', 'eg')
                .send(validBody);

            expect(res.status).toBe(401);
        });

        it('rejects non-customer roles', async () => {
            const token = await agentToken();

            const res = await request
                .post('/api/orders')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send(validBody);

            expect(res.status).toBe(403);
        });

        it('rejects requests without X-Region', async () => {
            const token = await customerToken();

            const res = await request
                .post('/api/orders')
                .set('Cookie', `access_token=${token}`)
                .send(validBody);

            expect(res.status).toBe(400);
        });

        it('validates required fields — empty body', async () => {
            const token = await customerToken();

            const res = await request
                .post('/api/orders')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({});

            expect(res.status).toBe(400);
        });

        it('validates items array must not be empty', async () => {
            const token = await customerToken();

            const res = await request
                .post('/api/orders')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ ...validBody, items: [] });

            expect(res.status).toBe(400);
        });

        it('validates paymentMethod enum', async () => {
            const token = await customerToken();

            const res = await request
                .post('/api/orders')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ ...validBody, paymentMethod: 'bitcoin' });

            expect(res.status).toBe(400);
        });

        it('validates item quantity must be >= 1', async () => {
            const token = await customerToken();

            const res = await request
                .post('/api/orders')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ ...validBody, items: [{ productId: 1, quantity: 0 }] });

            expect(res.status).toBe(400);
        });

        it('validates branchId must be a positive integer', async () => {
            const token = await customerToken();

            const res = await request
                .post('/api/orders')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ ...validBody, branchId: -1 });

            expect(res.status).toBe(400);
        });

        it('propagates service errors (e.g. out of stock)', async () => {
            const token = await customerToken();
            vi.spyOn(orderService, 'placeOrder').mockRejectedValueOnce(
                Object.assign(new Error('OutOfStock'), { statusCode: 409, isOperational: true }),
            );

            const res = await request
                .post('/api/orders')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send(validBody);

            expect(res.status).toBe(409);
            expect(res.body.error).toBe('OutOfStock');
        });
    });

    // ── GET /api/orders/:publicId ────────────────────────────────────────────

    describe('GET /api/orders/:publicId', () => {
        it('returns an order for an authenticated user', async () => {
            const token = await customerToken();
            const mockOrder = makeOrderResponse();
            vi.spyOn(orderService, 'getOrderByPublicId').mockResolvedValueOnce({
                data: mockOrder, fromCache: false,
            });

            const res = await request
                .get('/api/orders/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.id).toBe(mockOrder.id);
        });

        it('sets X-Cache header to HIT when cached', async () => {
            const token = await customerToken();
            vi.spyOn(orderService, 'getOrderByPublicId').mockResolvedValueOnce({
                data: makeOrderResponse(), fromCache: true,
            });

            const res = await request
                .get('/api/orders/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.headers['x-cache']).toBe('HIT');
        });

        it('sets X-Cache header to MISS when not cached', async () => {
            const token = await customerToken();
            vi.spyOn(orderService, 'getOrderByPublicId').mockResolvedValueOnce({
                data: makeOrderResponse(), fromCache: false,
            });

            const res = await request
                .get('/api/orders/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.headers['x-cache']).toBe('MISS');
        });

        it('returns 404 when order not found', async () => {
            const token = await customerToken();
            vi.spyOn(orderService, 'getOrderByPublicId').mockRejectedValueOnce(
                Object.assign(new Error('OrderNotFound'), { statusCode: 404, isOperational: true }),
            );

            const res = await request
                .get('/api/orders/nonexistent-uuid')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(404);
        });

        it('rejects unauthenticated request', async () => {
            const res = await request
                .get('/api/orders/some-uuid')
                .set('X-Region', 'eg');

            expect(res.status).toBe(401);
        });
    });

    // ── PATCH /api/orders/:publicId/status ───────────────────────────────────

    describe('PATCH /api/orders/:publicId/status', () => {
        it('updates order status', async () => {
            const token = await adminToken();
            const updated = makeOrderResponse({ status: 'accepted' });
            vi.spyOn(orderService, 'updateOrderStatus').mockResolvedValueOnce(updated);

            const res = await request
                .patch('/api/orders/uuid-1/status')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ status: 'accepted' });

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('accepted');
        });

        it('validates status enum', async () => {
            const token = await adminToken();

            const res = await request
                .patch('/api/orders/uuid-1/status')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ status: 'flying' });

            expect(res.status).toBe(400);
        });

        it('rejects without authentication', async () => {
            const res = await request
                .patch('/api/orders/uuid-1/status')
                .set('X-Region', 'eg')
                .send({ status: 'accepted' });

            expect(res.status).toBe(401);
        });
    });

    // ── GET /api/customer/orders ─────────────────────────────────────────────

    describe('GET /api/customer/orders', () => {
        it('returns paginated order list for customer', async () => {
            const token = await customerToken();
            vi.spyOn(orderService, 'listOrders').mockResolvedValueOnce({
                data: [makeOrderListItem()],
                meta: { hasMore: false, nextCursor: null, count: 1 },
            });

            const res = await request
                .get('/api/customer/orders')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.meta.hasMore).toBe(false);
        });

        it('rejects non-customer role', async () => {
            const token = await agentToken();

            const res = await request
                .get('/api/customer/orders')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(403);
        });

        it('rejects without X-Region', async () => {
            const token = await customerToken();

            const res = await request
                .get('/api/customer/orders')
                .set('Cookie', `access_token=${token}`);

            expect(res.status).toBe(400);
        });
    });
});
