import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request, deliveryService } from '../helpers/app.js';
import { adminToken, agentToken, customerToken } from '../helpers/auth.js';
import { makeDeliveryResponse } from '../helpers/fixtures.js';

describe('Delivery endpoints', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    // ── POST /api/deliveries/assign/:orderPublicId ───────────────────────────

    describe('POST /api/deliveries/assign/:orderPublicId', () => {
        it('assigns a delivery (admin, concrete region)', async () => {
            const token = await adminToken();
            const mockDelivery = makeDeliveryResponse();
            vi.spyOn(deliveryService, 'assignDelivery').mockResolvedValueOnce(mockDelivery);

            const res = await request
                .post('/api/deliveries/assign/uuid-1')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ agentId: 200 });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.agentId).toBe(200);
            expect(res.body.data.status).toBe('assigned');
        });

        it('assigns without agentId (auto-select)', async () => {
            const token = await adminToken();
            vi.spyOn(deliveryService, 'assignDelivery').mockResolvedValueOnce(
                makeDeliveryResponse({ agentId: 555 }),
            );

            const res = await request
                .post('/api/deliveries/assign/uuid-1')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({});

            expect(res.status).toBe(201);
        });

        it('rejects non-admin users', async () => {
            const token = await customerToken();

            const res = await request
                .post('/api/deliveries/assign/uuid-1')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({});

            expect(res.status).toBe(403);
        });

        it('rejects X-Region: all (requires concrete region)', async () => {
            const token = await adminToken();

            const res = await request
                .post('/api/deliveries/assign/uuid-1')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'all')
                .send({});

            expect(res.status).toBe(400);
        });

        it('rejects missing X-Region', async () => {
            const token = await adminToken();

            const res = await request
                .post('/api/deliveries/assign/uuid-1')
                .set('Cookie', `access_token=${token}`)
                .send({});

            expect(res.status).toBe(400);
        });
    });

    // ── POST /api/deliveries/reassign/:orderPublicId ─────────────────────────

    describe('POST /api/deliveries/reassign/:orderPublicId', () => {
        it('reassigns a delivery (admin)', async () => {
            const token = await adminToken();
            vi.spyOn(deliveryService, 'reassignDelivery').mockResolvedValueOnce(
                makeDeliveryResponse({ agentId: 300 }),
            );

            const res = await request
                .post('/api/deliveries/reassign/uuid-1')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ agentId: 300 });

            expect(res.status).toBe(201);
            expect(res.body.data.agentId).toBe(300);
        });

        it('rejects non-admin', async () => {
            const token = await agentToken();

            const res = await request
                .post('/api/deliveries/reassign/uuid-1')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({});

            expect(res.status).toBe(403);
        });
    });

    // ── PATCH /api/deliveries/:deliveryId/status ─────────────────────────────

    describe('PATCH /api/deliveries/:deliveryId/status', () => {
        it('updates delivery status (agent)', async () => {
            const token = await agentToken();
            vi.spyOn(deliveryService, 'updateDeliveryStatus').mockResolvedValueOnce(
                makeDeliveryResponse({ status: 'accepted', acceptedAt: '2026-01-15T10:35:00.000Z' }),
            );

            const res = await request
                .patch('/api/deliveries/1/status')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ status: 'accepted' });

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('accepted');
        });

        it('validates status enum', async () => {
            const token = await agentToken();

            const res = await request
                .patch('/api/deliveries/1/status')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ status: 'teleported' });

            expect(res.status).toBe(400);
        });

        it('rejects non-agent roles', async () => {
            const token = await customerToken();

            const res = await request
                .patch('/api/deliveries/1/status')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'eg')
                .send({ status: 'accepted' });

            expect(res.status).toBe(403);
        });

        it('rejects X-Region: all', async () => {
            const token = await agentToken();

            const res = await request
                .patch('/api/deliveries/1/status')
                .set('Cookie', `access_token=${token}`)
                .set('X-Region', 'all')
                .send({ status: 'accepted' });

            expect(res.status).toBe(400);
        });
    });
});
