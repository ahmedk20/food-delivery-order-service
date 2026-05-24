import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request, adminService } from '../helpers/app.js';
import { adminToken, customerToken, agentToken } from '../helpers/auth.js';
import { makeOrderListItem } from '../helpers/fixtures.js';

describe('Admin endpoints', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    // ── Auth guard: all admin routes require system_admin ─────────────────────

    describe('Auth guards', () => {
        it('rejects unauthenticated requests', async () => {
            const res = await request
                .get('/api/admin/orders')
                .set('X-Region', 'eg');

            expect(res.status).toBe(401);
        });

        it('rejects customer role', async () => {
            const token = await customerToken();

            const res = await request
                .get('/api/admin/orders')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(403);
        });

        it('rejects delivery_agent role', async () => {
            const token = await agentToken();

            const res = await request
                .get('/api/admin/orders')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(403);
        });
    });

    // ── GET /api/admin/orders ────────────────────────────────────────────────

    describe('GET /api/admin/orders', () => {
        it('lists all orders for admin', async () => {
            const token = await adminToken();
            vi.spyOn(adminService, 'listAllOrders').mockResolvedValueOnce({
                data: [makeOrderListItem()],
                meta: { hasMore: false, nextCursor: null, count: 1 },
            });

            const res = await request
                .get('/api/admin/orders')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.meta).toBeDefined();
        });

        it('allows X-Region: all for fan-out reads', async () => {
            const token = await adminToken();
            vi.spyOn(adminService, 'listAllOrders').mockResolvedValueOnce({
                data: [], meta: { hasMore: false, nextCursor: null, count: 0 },
            });

            const res = await request
                .get('/api/admin/orders')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'all');

            expect(res.status).toBe(200);
        });

        it('rejects without X-Region', async () => {
            const token = await adminToken();

            const res = await request
                .get('/api/admin/orders')
                .set('Cookie', `access_token=${token}`);

            expect(res.status).toBe(400);
        });
    });

    // ── GET /api/admin/transactions ──────────────────────────────────────────

    describe('GET /api/admin/transactions', () => {
        it('lists transactions for admin', async () => {
            const token = await adminToken();
            vi.spyOn(adminService, 'listAllTransactions').mockResolvedValueOnce({
                data: [], meta: { hasMore: false, nextCursor: null, count: 0 },
            });

            const res = await request
                .get('/api/admin/transactions')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(200);
        });
    });

    // ── GET /api/admin/restaurant-balances ────────────────────────────────────

    describe('GET /api/admin/restaurant-balances', () => {
        it('lists restaurant balances for admin', async () => {
            const token = await adminToken();
            vi.spyOn(adminService, 'listRestaurantBalances').mockResolvedValueOnce({
                data: [], meta: { hasMore: false, nextCursor: null, count: 0 },
            });

            const res = await request
                .get('/api/admin/restaurant-balances')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(200);
        });
    });

    // ── GET /api/admin/agents ────────────────────────────────────────────────

    describe('GET /api/admin/agents', () => {
        it('lists agents with presence for admin', async () => {
            const token = await adminToken();
            vi.spyOn(adminService, 'listAgentsWithPresence').mockResolvedValueOnce({
                data: [], meta: { hasMore: false, nextCursor: null, count: 0 },
            });

            const res = await request
                .get('/api/admin/agents')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(200);
        });
    });

    // ── PATCH /api/admin/orders/:publicId/status ─────────────────────────────

    describe('PATCH /api/admin/orders/:publicId/status', () => {
        it('force-updates order status', async () => {
            const token = await adminToken();
            vi.spyOn(adminService, 'forceUpdateOrderStatus').mockResolvedValueOnce({
                id: 'uuid-1', status: 'cancelled',
            } as any);

            const res = await request
                .patch('/api/admin/orders/uuid-1/status')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ status: 'cancelled', reason: 'Admin override' });

            expect(res.status).toBe(200);
        });

        it('rejects X-Region: all for write', async () => {
            const token = await adminToken();

            const res = await request
                .patch('/api/admin/orders/uuid-1/status')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'all')
                .send({ status: 'cancelled' });

            expect(res.status).toBe(400);
        });

        it('rejects unknown region', async () => {
            const token = await adminToken();

            const res = await request
                .patch('/api/admin/orders/uuid-1/status')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'xx')
                .send({ status: 'cancelled' });

            expect(res.status).toBe(400);
        });
    });

    // ── POST /api/admin/restaurant/payouts ───────────────────────────────────

    describe('POST /api/admin/restaurant/payouts', () => {
        it('creates a payout', async () => {
            const token = await adminToken();
            vi.spyOn(adminService, 'createPayout').mockResolvedValueOnce({
                payoutId: 1, amount: 50000, currency: 'EGP', status: 'pending',
            } as any);

            const res = await request
                .post('/api/admin/restaurant/payouts')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({
                    restaurantId:        1,
                    amount:              50000,
                    currency:            'EGP',
                    providerReferenceId: 'bank-ref-001',
                });

            expect(res.status).toBe(201);
            expect(res.body.data.payoutId).toBe(1);
        });

        it('validates required fields', async () => {
            const token = await adminToken();

            const res = await request
                .post('/api/admin/restaurant/payouts')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({});

            expect(res.status).toBe(400);
        });

        it('validates currency enum', async () => {
            const token = await adminToken();

            const res = await request
                .post('/api/admin/restaurant/payouts')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({
                    restaurantId: 1, amount: 50000,
                    currency: 'USD', providerReferenceId: 'ref',
                });

            expect(res.status).toBe(400);
        });
    });

    // ── GET /api/admin/outbox/dead-letters ───────────────────────────────────

    describe('GET /api/admin/outbox/dead-letters', () => {
        it('lists dead letter outbox entries', async () => {
            const token = await adminToken();
            vi.spyOn(adminService, 'listDeadLetterOutbox').mockResolvedValueOnce({
                data: [], meta: { hasMore: false, nextCursor: null, count: 0 },
            });

            const res = await request
                .get('/api/admin/outbox/dead-letters')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(200);
        });

        it('requires concrete region', async () => {
            const token = await adminToken();

            const res = await request
                .get('/api/admin/outbox/dead-letters')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'all');

            expect(res.status).toBe(400);
        });
    });
});
