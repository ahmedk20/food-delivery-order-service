import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request, agentService } from '../helpers/app.js';
import { agentToken, customerToken } from '../helpers/auth.js';

describe('Delivery Agent endpoints', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    // ── POST /api/agents/presence/online ─────────────────────────────────────

    describe('POST /api/agents/presence/online', () => {
        it('marks agent as online', async () => {
            const token = await agentToken();
            vi.spyOn(agentService, 'goOnline').mockResolvedValueOnce(undefined);

            const res = await request
                .post('/api/agents/presence/online')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ lat: 30.05, lng: 31.23 });

            expect(res.status).toBe(200);
            expect(res.body.data.online).toBe(true);
        });

        it('validates lat/lng are required', async () => {
            const token = await agentToken();

            const res = await request
                .post('/api/agents/presence/online')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({});

            expect(res.status).toBe(400);
        });

        it('validates lat range (-90 to 90)', async () => {
            const token = await agentToken();

            const res = await request
                .post('/api/agents/presence/online')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ lat: 999, lng: 31.23 });

            expect(res.status).toBe(400);
        });

        it('validates lng range (-180 to 180)', async () => {
            const token = await agentToken();

            const res = await request
                .post('/api/agents/presence/online')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ lat: 30.05, lng: 999 });

            expect(res.status).toBe(400);
        });

        it('rejects non-agent roles', async () => {
            const token = await customerToken();

            const res = await request
                .post('/api/agents/presence/online')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ lat: 30.05, lng: 31.23 });

            expect(res.status).toBe(403);
        });
    });

    // ── POST /api/agents/presence/offline ────────────────────────────────────

    describe('POST /api/agents/presence/offline', () => {
        it('marks agent as offline', async () => {
            const token = await agentToken();
            vi.spyOn(agentService, 'goOffline').mockResolvedValueOnce(undefined);

            const res = await request
                .post('/api/agents/presence/offline')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(200);
            expect(res.body.data.online).toBe(false);
        });

        it('propagates agent-in-active-delivery error', async () => {
            const token = await agentToken();
            vi.spyOn(agentService, 'goOffline').mockRejectedValueOnce(
                Object.assign(new Error('AgentInActiveDelivery'), { statusCode: 409, isOperational: true }),
            );

            const res = await request
                .post('/api/agents/presence/offline')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(409);
        });
    });

    // ── POST /api/agents/presence/ping ───────────────────────────────────────

    describe('POST /api/agents/presence/ping', () => {
        it('pings with updated location', async () => {
            const token = await agentToken();
            vi.spyOn(agentService, 'ping').mockResolvedValueOnce(undefined);

            const res = await request
                .post('/api/agents/presence/ping')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ lat: 30.06, lng: 31.24 });

            expect(res.status).toBe(200);
            expect(res.body.data.ok).toBe(true);
        });
    });

    // ── GET /api/agents/tasks ────────────────────────────────────────────────

    describe('GET /api/agents/tasks', () => {
        it('returns agent tasks', async () => {
            const token = await agentToken();
            vi.spyOn(agentService, 'getMyTasks').mockResolvedValueOnce({
                data: [{ deliveryId: 1, orderPublicId: 'uuid-1', status: 'assigned' } as any],
                meta: { hasMore: false, nextCursor: null, count: 1 },
            });

            const res = await request
                .get('/api/agents/tasks')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.meta.count).toBe(1);
        });

        it('rejects non-agent role', async () => {
            const token = await customerToken();

            const res = await request
                .get('/api/agents/tasks')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(403);
        });
    });

    // ── GET /api/agents/earnings ─────────────────────────────────────────────

    describe('GET /api/agents/earnings', () => {
        it('returns agent earnings with totals', async () => {
            const token = await agentToken();
            vi.spyOn(agentService, 'getMyEarnings').mockResolvedValueOnce({
                data:   [{ id: 1, amount: 3000, currency: 'EGP', status: 'pending' } as any],
                meta:   { hasMore: false, nextCursor: null, count: 1 },
                totals: [{ currency: 'EGP', totalEarned: 15000, totalPaid: 12000, totalPending: 3000 }] as any,
            });

            const res = await request
                .get('/api/agents/earnings')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg');

            expect(res.status).toBe(200);
            expect(res.body.data.data).toHaveLength(1);
            expect(res.body.data.totals).toBeDefined();
        });
    });
});
