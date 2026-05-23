import type { NextFunction, Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../../../lib/di/tokens.js';
import { validateBody } from '../../../lib/validation/validate.js';
import { sendPaginated, sendSuccess } from '../../../lib/http/response.js';
import { UpdateOrderStatusDTO } from '../../order/dto/update-order-status.dto.js';
import { RestaurantOrderService } from '../service/restaurant-order.service.js';
import AppError from '../../../lib/error/AppError.js';

@injectable()
export class RestaurantOrderController {
    constructor(
        @inject(TOKENS.RestaurantOrderService) private readonly restaurantOrderService: RestaurantOrderService,
    ) {}

    listOrders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const branchId = Number(req.query.branchId);
            if (!Number.isFinite(branchId) || branchId <= 0) {
                return next(new AppError('branchId query parameter is required', 400));
            }
            const result = await this.restaurantOrderService.listOrders(
                branchId,
                req.region!,
                req.query as Record<string, any>,
            );
            sendPaginated(res, result.data, 200, result.meta);
        } catch (err) {
            next(err);
        }
    };

    updateStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const dto    = await validateBody(UpdateOrderStatusDTO, req.body);
            const result = await this.restaurantOrderService.updateStatus(
                String(req.params.publicId),
                req.region!,
                req.user!.userId,
                dto,
            );
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    };
}
