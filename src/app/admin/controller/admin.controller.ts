import type { Request, Response, NextFunction } from 'express';
import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../../../lib/di/tokens.js';
import { validateBody } from '../../../lib/validation/validate.js';
import { sendSuccess, sendPaginated } from '../../../lib/http/response.js';
import { CreatePayoutDTO } from '../dto/create-payout.dto.js';
import { AdminService } from '../service/admin.service.js';
import { UpdateOrderStatusDTO } from '../../order/dto/update-order-status.dto.js';

@injectable()
export class AdminController {
    constructor(
        @inject(TOKENS.AdminService) private readonly adminService: AdminService,
    ) {}

    listOrders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await this.adminService.listAllOrders(
                req.region!,
                req.query as Record<string, any>,
            );
            sendPaginated(res, result.data, 200, result.meta);
        } catch (err) {
            next(err);
        }
    };

    listTransactions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await this.adminService.listAllTransactions(
                req.region!,
                req.query as Record<string, any>,
            );
            sendPaginated(res, result.data, 200, result.meta);
        } catch (err) {
            next(err);
        }
    };

    listRestaurantBalances = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await this.adminService.listRestaurantBalances(
                req.region!,
                req.query as Record<string, any>,
            );
            sendPaginated(res, result.data, 200, result.meta);
        } catch (err) {
            next(err);
        }
    };

    listAgents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await this.adminService.listAgentsWithPresence(
                req.region!,
                req.query as Record<string, any>,
            );
            sendPaginated(res, result.data, 200, result.meta);
        } catch (err) {
            next(err);
        }
    };

    listDeadLetterOutbox = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await this.adminService.listDeadLetterOutbox(
                req.region!,
                req.query as Record<string, any>,
            );
            sendPaginated(res, result.data, 200, result.meta);
        } catch (err) {
            next(err);
        }
    };

    forceUpdateOrderStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const dto    = await validateBody(UpdateOrderStatusDTO, req.body);
            const result = await this.adminService.forceUpdateOrderStatus(
                req.params.publicId as string,
                req.region!,
                req.user!.userId,
                dto,
            );
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    };

    createPayout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const dto    = await validateBody(CreatePayoutDTO, req.body);
            const result = await this.adminService.createPayout(
                req.region!,
                req.user!.userId,
                dto,
            );
            sendSuccess(res, result, 201);
        } catch (err) {
            next(err);
        }
    };
}
