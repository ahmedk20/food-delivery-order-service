import type { Request, Response, NextFunction } from 'express';
import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../../../lib/di/tokens.js';
import { validateBody } from '../../../lib/validation/validate.js';
import { sendSuccess, sendPaginated } from '../../../lib/http/response.js';
import { PresenceOnlineDTO } from '../dto/presence-online.dto.js';
import { AgentService } from '../service/agent.service.js';

@injectable()
export class AgentController {
    constructor(
        @inject(TOKENS.AgentService) private readonly agentService: AgentService,
    ) {}

    goOnline = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const dto = await validateBody(PresenceOnlineDTO, req.body);
            await this.agentService.goOnline(req.user!.userId, req.region!, dto);
            sendSuccess(res, { online: true });
        } catch (err) {
            next(err);
        }
    };

    goOffline = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            await this.agentService.goOffline(req.user!.userId, req.region!);
            sendSuccess(res, { online: false });
        } catch (err) {
            next(err);
        }
    };

    ping = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const dto = await validateBody(PresenceOnlineDTO, req.body);
            await this.agentService.ping(req.user!.userId, req.region!, dto);
            sendSuccess(res, { ok: true });
        } catch (err) {
            next(err);
        }
    };

    getMyTasks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await this.agentService.getMyTasks(
                req.user!.userId,
                req.region!,
                req.query as Record<string, any>,
            );
            sendPaginated(res, result.data, 200, result.meta);
        } catch (err) {
            next(err);
        }
    };

    getMyEarnings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await this.agentService.getMyEarnings(
                req.user!.userId,
                req.region!,
                req.query as Record<string, any>,
            );
            // Earnings list uses sendSuccess (not sendPaginated) because the response
            // carries an extra `totals` field alongside data+meta.
            sendSuccess(res, { data: result.data, totals: result.totals }, 200, result.meta);
        } catch (err) {
            next(err);
        }
    };
}
