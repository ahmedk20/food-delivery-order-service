import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../../../lib/di/tokens.js';
import { db } from '../../../lib/knex/knex.js';
import AppError from '../../../lib/error/AppError.js';
import type { ICacheProvider } from '../../../pkg/cache/cache.interface.js';
import type { RestaurantBalanceEntity } from '../entity/restaurant-balance.entity.js';
import {
    creditRestaurantBalance,
    debitRestaurantBalance,
    settleRestaurantBalance,
    payoutFromAvailableBalance,
    findRestaurantBalance,
    findAllRestaurantBalances,
} from '../repository/finance.repo.js';
import { createTransaction, findPayoutsByRestaurant } from '../../payment/repository/transaction.repo.js';
import type { Transaction } from '../../payment/entity/transaction.entity.js';
import type { CreatePayoutDTO } from '../../admin/dto/create-payout.dto.js';
import type { PaginationMeta } from '../../../lib/http/response.js';

const BALANCE_CACHE_TTL = 5;
const balanceCacheKey   = (region: string, restaurantId: number) => `${region}:os:balance:${restaurantId}`;

@injectable()
export class FinanceService {
    constructor(
        @inject(TOKENS.CacheProvider) private readonly cache: ICacheProvider,
    ) {}

    // ── Balance mutation (called by PaymentService inside its own transaction) ─

    creditBalance = async (
        restaurantId: number,
        region: string,
        amount: number,
        currency: string,
        conn: import('knex').Knex,
    ): Promise<void> => {
        await creditRestaurantBalance(restaurantId, region, amount, currency, conn);
    };

    debitBalance = async (
        restaurantId: number,
        region: string,
        amount: number,
        currency: string,
        conn: import('knex').Knex,
    ): Promise<void> => {
        await debitRestaurantBalance(restaurantId, region, amount, currency, conn);
    };

    settleBalance = async (
        restaurantId: number,
        region: string,
        amount: number,
        commission: number,
        currency: string,
        conn: import('knex').Knex,
    ): Promise<void> => {
        await settleRestaurantBalance(restaurantId, region, amount, commission, currency, conn);
    };

    invalidateCache = (restaurantId: number, region: string): void => {
        this.cache.delete(balanceCacheKey(region, restaurantId)).catch(() => {});
    };

    // ── Admin-facing reads ────────────────────────────────────────────────────

    getBalance = async (
        restaurantId: number,
        region: string,
    ): Promise<RestaurantBalanceEntity | undefined> => {
        const cacheKey = balanceCacheKey(region, restaurantId);
        try {
            const cached = await this.cache.get(cacheKey);
            if (cached) return JSON.parse(cached) as RestaurantBalanceEntity;
        } catch { /* Redis down */ }

        const balance = await findRestaurantBalance(restaurantId, region);
        if (balance) {
            this.cache.set(cacheKey, JSON.stringify(balance), BALANCE_CACHE_TTL).catch(() => {});
        }
        return balance;
    };

    listBalances = async (
        region: string,
        query: Record<string, any>,
    ): Promise<{ data: RestaurantBalanceEntity[]; meta: PaginationMeta }> => {
        const limit        = Math.min(Number(query.limit) || 20, 100);
        const cursor       = query.cursor ? Number(query.cursor) : undefined;
        const restaurantId = query.restaurantId ? Number(query.restaurantId) : undefined;

        if (restaurantId !== undefined) {
            const cacheKey = balanceCacheKey(region, restaurantId);
            try {
                const cached = await this.cache.get(cacheKey);
                if (cached) return JSON.parse(cached);
            } catch { /* Redis down */ }

            const result = await findAllRestaurantBalances(region, { restaurantId, cursor, limit });
            this.cache.set(cacheKey, JSON.stringify(result), BALANCE_CACHE_TTL).catch(() => {});
            return result;
        }

        return findAllRestaurantBalances(region, { restaurantId, cursor, limit });
    };

    listPayouts = async (
        restaurantId: number,
        region: string,
        query: Record<string, any>,
    ): Promise<{ data: Transaction[]; meta: PaginationMeta }> => {
        const limit  = Math.min(Number(query.limit) || 20, 100);
        const cursor = query.cursor ? Number(query.cursor) : undefined;
        return findPayoutsByRestaurant(restaurantId, region, { cursor, limit });
    };

    // ── Admin payout ──────────────────────────────────────────────────────────

    createPayout = async (
        region: string,
        actorId: number,
        dto: CreatePayoutDTO,
    ): Promise<{ payoutId: number; amount: number; currency: string; status: string }> => {
        const trx = await db(region).transaction();
        try {
            const success = await payoutFromAvailableBalance(
                dto.restaurantId, region, dto.amount, dto.currency, trx,
            );
            if (!success) {
                await trx.rollback();
                throw new AppError('InsufficientBalance', 409);
            }

            const payout = await createTransaction({
                region,
                orderId:             null,
                type:                'payout',
                method:              'bank_transfer',
                providerId:          null,
                providerReferenceId: dto.providerReferenceId,
                status:              'pending',
                amount:              dto.amount,
                currency:            dto.currency,
                srcAccId:            dto.restaurantId,
                dstAccId:            null,
                isRefunded:          false,
                refundedPaymentId:   null,
                idempotencyKey:      null,
                metadata:            { note: dto.note ?? null, initiatedBy: actorId },
            }, region, trx);

            await trx.commit();

            this.invalidateCache(dto.restaurantId, region);

            return {
                payoutId: payout.id,
                amount:   payout.amount,
                currency: payout.currency,
                status:   payout.status,
            };
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    };
}
