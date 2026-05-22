import type { NextFunction, Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../../../lib/di/tokens.js';
import { validateBody } from '../../../lib/validation/validate.js';
import { sendPaginated, sendSuccess } from '../../../lib/http/response.js';
import { PlaceOrderDTO } from '../dto/place-order.dto.js';
import { CancelOrderDTO } from '../dto/cancel-order.dto.js';
import { OrderService } from '../service/order.service.js';

@injectable()
export class OrderController {
    constructor(
        @inject(TOKENS.OrderService) private readonly orderService: OrderService,
    ) {}

    placeOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const dto    = await validateBody(PlaceOrderDTO, req.body);
            const result = await this.orderService.placeOrder(
                req.user!.userId,
                req.region!,
                dto,
                req.correlationId,
            );
            sendSuccess(res, result, 201);
        } catch (err) {
            next(err);
        }
    };

    listOrders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await this.orderService.listOrders(
                req.user!.userId,
                req.region!,
                req.query as Record<string, any>,
            );
            sendPaginated(res, result.data, 200, result.meta);
        } catch (err) {
            next(err);
        }
    };

    getOrderByPublicId = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const order = await this.orderService.getOrderByPublicId(
                String(req.params.publicId),
                req.region!,
                req.user!.userId,
                req.user!.role,
            );
            sendSuccess(res, order);
        } catch (err) {
            next(err);
        }
    };

    cancelOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const dto    = await validateBody(CancelOrderDTO, req.body);
            const result = await this.orderService.cancelOrder(
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
