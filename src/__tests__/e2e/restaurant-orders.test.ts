import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request, restaurantOrderSvc, permCacheSvc } from '../helpers/app.js';
import { restaurantToken, customerToken, adminToken } from '../helpers/auth.js';
import { makeOrderListItem, makeOrderResponse } from '../helpers/fixtures.js';

describe('Restaurant Order endpoints', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(permCacheSvc, 'getPermissions').mockResolvedValue(
            ['orders:read', 'orders:write', 'finance:read', 'finance:write'],
        );
        vi.spyOn(permCacheSvc, 'hasPermission').mockReturnValue(true);
    });

    // ── GET /api/restaurant/orders ───────────────────────────────────────────

    describe('GET /api/restaurant/orders', () => {
        it('returns order list for restaurant member', async () => {
            const token = await restaurantToken();
            vi.spyOn(restaurantOrderSvc, 'listOrders').mockResolvedValueOnce({
                data: [makeOrderListItem()],
                meta: { hasMore: false, nextCursor: null, count: 1 },
            });

            const res = await request
                .get('/api/restaurant/orders?branchId=1')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
        });

        it('requires branchId query parameter', async () => {
            const token = await restaurantToken();

            const res = await request
                .get('/api/restaurant/orders')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(400);
        });

        it('rejects non-restaurant users', async () => {
            const token = await customerToken();

            const res = await request
                .get('/api/restaurant/orders?branchId=1')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(403);
        });

        it('allows system admin to access', async () => {
            const token = await adminToken();
            vi.spyOn(restaurantOrderSvc, 'listOrders').mockResolvedValueOnce({
                data: [],
                meta: { hasMore: false, nextCursor: null, count: 0 },
            });

            const res = await request
                .get('/api/restaurant/orders?branchId=1')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(200);
        });

        it('rejects without X-Region', async () => {
            const token = await restaurantToken();

            const res = await request
                .get('/api/restaurant/orders?branchId=1')
                .set('Cookie', `access_token=${token}`);

            expect(res.status).toBe(400);
        });
    });

    // ── PATCH /api/restaurant/orders/:publicId/status ────────────────────────

    describe('PATCH /api/restaurant/orders/:publicId/status', () => {
        it('updates order status for restaurant member', async () => {
            const token = await restaurantToken();
            vi.spyOn(restaurantOrderSvc, 'updateStatus').mockResolvedValueOnce(
                makeOrderResponse({ status: 'preparing' }) as any,
            );

            const res = await request
                .patch('/api/restaurant/orders/uuid-1/status')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ status: 'preparing' });

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('preparing');
        });

        it('validates status enum', async () => {
            const token = await restaurantToken();

            const res = await request
                .patch('/api/restaurant/orders/uuid-1/status')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ status: 'invalid_status' });

            expect(res.status).toBe(400);
        });
    });
});
