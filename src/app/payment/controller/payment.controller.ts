import { inject, injectable } from 'tsyringe';
import type { NextFunction, Request, Response } from 'express';
import { TOKENS } from '../../../lib/di/tokens.js';
import { validateBody } from '../../../lib/validation/validate.js';
import { sendSuccess } from '../../../lib/http/response.js';
import { PaymentService } from '../service/payment.service.js';
import { CreatePaymentSessionDTO } from '../dto/create-session.dto.js';

@injectable()
export class PaymentController {
    constructor(
        @inject(TOKENS.PaymentService) private readonly paymentService: PaymentService,
    ) {}

    createSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const dto    = await validateBody(CreatePaymentSessionDTO, req.body);
            const result = await this.paymentService.createSession(
                req.user!.userId,
                req.region!,
                dto,
            );
            sendSuccess(res, result, 201);
        } catch (err) {
            next(err);
        }
    };

    handleWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const signature = (req.headers['x-kashier-signature'] as string) ?? '';
            // req.body is a Buffer when express.raw() middleware is applied on this route.
            const payload = JSON.parse((req.body as Buffer).toString()) as Record<string, any>;
            await this.paymentService.handleWebhook(signature, payload);
            res.status(200).json({ received: true });
        } catch (err) {
            next(err);
        }
    };

    getByOrderId = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await this.paymentService.getTransactionsByOrderId(
                Number(req.params.orderId),
                req.region!,
                req.user!.userId,
                req.user!.role,
            );
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    };
}
