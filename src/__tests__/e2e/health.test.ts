import { describe, it, expect, vi } from 'vitest';
import { request } from '../helpers/app.js';
import * as knex from '../../lib/knex/knex.js';

describe('GET /api/health', () => {
    it('returns 200 when all shards are reachable', async () => {
        vi.mocked(knex.pingAll).mockResolvedValueOnce(undefined);

        const res = await request.get('/api/health');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
    });

    it('returns 500 when a shard is unreachable', async () => {
        vi.mocked(knex.pingAll).mockRejectedValueOnce(new Error('connection refused'));

        const res = await request.get('/api/health');

        expect(res.status).toBe(500);
        expect(res.body.ok).toBe(false);
    });

    it('does not require authentication', async () => {
        vi.mocked(knex.pingAll).mockResolvedValueOnce(undefined);

        const res = await request.get('/api/health');

        expect(res.status).toBe(200);
    });

    it('does not require X-Region header', async () => {
        vi.mocked(knex.pingAll).mockResolvedValueOnce(undefined);

        const res = await request.get('/api/health');

        expect(res.status).toBe(200);
    });
});
