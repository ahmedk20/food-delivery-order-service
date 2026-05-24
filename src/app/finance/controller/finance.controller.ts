import { inject, injectable } from 'tsyringe';
import type { Request, Response, NextFunction } from 'express';
import { TOKENS } from '../../../lib/di/tokens.js';
import { sendSuccess, sendPaginated } from '../../../lib/http/response.js';
import AppError from '../../../lib/error/AppError.js';
import type { FinanceService } from '../service/finance.service.js';
import { BalanceResponseDTO } from '../dto/balance-response.dto.js';
import { PayoutResponseDTO } from '../dto/payout-response.dto.js';

@injectable()
export class FinanceController {
    constructor(
        @inject(TOKENS.FinanceService) private readonly financeService: FinanceService,
    ) {}

    getMyBalance = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const restaurantId = req.user!.restaurantId;
            if (!restaurantId) throw new AppError('NoRestaurantAssociated', 403);

            const balance = await this.financeService.getBalance(restaurantId, req.region!);
            if (!balance) throw new AppError('BalanceNotFound', 404);

            sendSuccess(res, BalanceResponseDTO.fromEntity(balance));
        } catch (err) {
            next(err);
        }
    };

    listMyPayouts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const restaurantId = req.user!.restaurantId;
            if (!restaurantId) throw new AppError('NoRestaurantAssociated', 403);

            const result = await this.financeService.listPayouts(restaurantId, req.region!, req.query);
            const dtos   = result.data.map(PayoutResponseDTO.fromEntity);
            sendPaginated(res, dtos, 200, result.meta);
        } catch (err) {
            next(err);
        }
    };
}
