import { Router } from 'express';
import type { Request, Response } from 'express';
import { pingAll } from '../../lib/knex/knex.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req: Request, res: Response) => {
    try {
        await pingAll();
        res.status(200).json({ ok: true });
    } catch {
        res.status(500).json({ ok: false, error: 'Database unreachable' });
    }
});
