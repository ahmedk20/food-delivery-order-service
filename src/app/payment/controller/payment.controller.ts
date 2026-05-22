import { inject, injectable } from 'tsyringe';
import type { NextFunction, Request, Response } from 'express';
import { TOKENS } from '../../../lib/di/tokens.js';
import { validateBody } from '../../../lib/validation/validate.js';
import { sendSuccess } from '../../../lib/http/response.js';
import { PaymentService } from '../service/payment.service.js';
import { InitPaymentDTO } from '../dto/init-payment.dto.js';
import { RefundRequestDTO } from '../dto/refund-request.dto.js';

@injectable()
export class PaymentController {
    constructor(
        @inject(TOKENS.PaymentService) private readonly paymentService: PaymentService,
    ) {}

    initPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const dto    = await validateBody(InitPaymentDTO, req.body);
            const result = await this.paymentService.initPayment(
                req.user!.userId,
                req.region!,
                dto,
            );
            sendSuccess(res, result, 200);
        } catch (err) {
            next(err);
        }
    };

    handleWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const signature = (Array.isArray(req.headers['x-kashier-signature'])
                ? req.headers['x-kashier-signature'][0]
                : req.headers['x-kashier-signature']) ?? '';
            // req.body is a Buffer when express.raw() middleware is applied on this route.
            const payload = JSON.parse((req.body as Buffer).toString()) as Record<string, any>;
            await this.paymentService.handleWebhook(signature, payload);
            // Always 200 after we've decided not to throw — Kashier retries on non-200
            res.status(200).json({ received: true });
        } catch (err) {
            next(err);
        }
    };

    getByOrderId = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await this.paymentService.getTransactionsByOrderId(
                String(req.params.orderId),
                req.region!,
                req.user!.userId,
                req.user!.role,
            );
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    };

    getPaymentById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await this.paymentService.getPaymentById(
                Number(req.params.paymentId),
                req.region!,
                req.user!.userId,
                req.user!.role,
            );
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    };

    refundPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const dto    = await validateBody(RefundRequestDTO, req.body);
            const result = await this.paymentService.refundPayment(
                Number(req.params.paymentId),
                req.region!,
                dto,
            );
            sendSuccess(res, result, 202);
        } catch (err) {
            next(err);
        }
    };
}
