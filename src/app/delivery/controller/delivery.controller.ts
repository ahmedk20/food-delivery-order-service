import type { NextFunction, Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../../../lib/di/tokens.js';
import { validateBody } from '../../../lib/validation/validate.js';
import { sendSuccess } from '../../../lib/http/response.js';
import { AssignDeliveryDTO } from '../dto/assign-delivery.dto.js';
import { UpdateDeliveryStatusDTO } from '../dto/update-delivery-status.dto.js';
import { DeliveryService } from '../service/delivery.service.js';

@injectable()
export class DeliveryController {
    constructor(
        @inject(TOKENS.DeliveryService) private readonly deliveryService: DeliveryService,
    ) {}

    assignDelivery = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const dto    = await validateBody(AssignDeliveryDTO, req.body);
            const result = await this.deliveryService.assignDelivery(
                String(req.params.orderPublicId),
                req.region!,
                dto,
            );
            sendSuccess(res, result, 201);
        } catch (err) {
            next(err);
        }
    };

    reassignDelivery = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const dto    = await validateBody(AssignDeliveryDTO, req.body);
            const result = await this.deliveryService.reassignDelivery(
                String(req.params.orderPublicId),
                req.region!,
                dto,
            );
            sendSuccess(res, result, 201);
        } catch (err) {
            next(err);
        }
    };

    updateDeliveryStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const dto    = await validateBody(UpdateDeliveryStatusDTO, req.body);
            const result = await this.deliveryService.updateDeliveryStatus(
                Number(req.params.deliveryId),
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
