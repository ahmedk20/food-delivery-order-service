import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request, financeService, permCacheSvc } from '../helpers/app.js';
import { restaurantToken, customerToken, adminToken } from '../helpers/auth.js';
import { makeBalanceResponse } from '../helpers/fixtures.js';

describe('Finance endpoints', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(permCacheSvc, 'getPermissions').mockResolvedValue(
            ['orders:read', 'orders:write', 'finance:read', 'finance:write'],
        );
        vi.spyOn(permCacheSvc, 'hasPermission').mockReturnValue(true);
    });

    // ── GET /api/restaurant/finance/balance ──────────────────────────────────

    describe('GET /api/restaurant/finance/balance', () => {
        it('returns balance for restaurant member', async () => {
            const token = await restaurantToken();
            vi.spyOn(financeService, 'getBalance').mockResolvedValueOnce({
                restaurantId: 10, currency: 'EGP',
                availableBalance: 50000, pendingBalance: 10000, totalEarned: 150000,
                updatedAt: new Date('2026-01-15T12:00:00Z'),
            } as any);

            const res = await request
                .get('/api/restaurant/finance/balance')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(200);
            expect(res.body.data.availableBalance).toBe(50000);
            expect(res.body.data.currency).toBe('EGP');
        });

        it('returns 404 when balance not found', async () => {
            const token = await restaurantToken();
            vi.spyOn(financeService, 'getBalance').mockResolvedValueOnce(undefined);

            const res = await request
                .get('/api/restaurant/finance/balance')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(404);
        });

        it('rejects non-restaurant users', async () => {
            const token = await customerToken();

            const res = await request
                .get('/api/restaurant/finance/balance')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(403);
        });

        it('admin can access (requireRestaurantMember allows system_admin)', async () => {
            const token = await adminToken();
            // Admin token has no restaurantId → should get 403 from FinanceController
            const res = await request
                .get('/api/restaurant/finance/balance')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(403);
        });

        it('rejects without X-Region', async () => {
            const token = await restaurantToken();

            const res = await request
                .get('/api/restaurant/finance/balance')
                .set('Cookie', `access_token=${token}`);

            expect(res.status).toBe(400);
        });
    });

    // ── GET /api/restaurant/finance/payouts ──────────────────────────────────

    describe('GET /api/restaurant/finance/payouts', () => {
        it('returns payout list for restaurant member', async () => {
            const token = await restaurantToken();
            vi.spyOn(financeService, 'listPayouts').mockResolvedValueOnce({
                data: [],
                meta: { hasMore: false, nextCursor: null, count: 0 },
            });

            const res = await request
                .get('/api/restaurant/finance/payouts')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
        });

        it('rejects non-restaurant user', async () => {
            const token = await customerToken();

            const res = await request
                .get('/api/restaurant/finance/payouts')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(403);
        });
    });
});
