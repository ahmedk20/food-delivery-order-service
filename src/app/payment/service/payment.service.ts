import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../../../lib/di/tokens.js';
import { env } from '../../../lib/config/env.js';
import AppError from '../../../lib/error/AppError.js';
import logger from '../../../lib/logger/logger.js';
import { db } from '../../../lib/knex/knex.js';
import type { ICacheProvider } from '../../../pkg/cache/cache.interface.js';
import type { IPaymentProvider } from '../../../pkg/payment/payment-provider.interface.js';
import type { ICoreServiceClient } from '../../../lib/http/core-service-client.interface.js';
import { findOrderById, updateOrderStatus } from '../../order/repository/order.repo.js';
import {
    createTransaction,
    findTransactionByIdempotencyKey,
    findTransactionByOrderId,
    updateTransaction,
} from '../repository/transaction.repo.js';
import { findPaymentProviderByName } from '../repository/payment-provider.repo.js';
import {
    InvalidWebhookSignatureError,
    OrderNotPayableError,
    TransactionNotFoundError,
} from '../errors.js';
import { Transaction } from '../entity/transaction.entity.js';
import type { CreatePaymentSessionDTO } from '../dto/create-session.dto.js';
import type { TransactionResponseDTO } from '../dto/transaction-response.dto.js';
import { SystemRole } from '../../../lib/auth/enums.js';

const SESSION_CACHE_TTL = 1800; // 30 minutes

function sessionCacheKey(orderId: number): string {
    return `os:payment:session:${orderId}`;
}

function toTransactionResponseDTO(tx: Transaction): TransactionResponseDTO {
    return {
        id: tx.id,
        orderId: tx.orderId,
        amount: tx.amount,
        currency: tx.currency,
        type: tx.type,
        status: tx.status,
        externalReference: tx.externalReference,
        createdAt: tx.createdAt,
    };
}

@injectable()
export class PaymentService {
    constructor(
        @inject(TOKENS.PaymentProvider)  private readonly provider: IPaymentProvider,
        @inject(TOKENS.CacheProvider)    private readonly cache: ICacheProvider,
        @inject(TOKENS.CoreServiceClient) private readonly coreClient: ICoreServiceClient,
    ) {}

    createSession = async (
        customerId: number,
        countryCode: string,
        dto: CreatePaymentSessionDTO,
    ): Promise<{ sessionUrl: string; transactionId: number }> => {
        const order = await findOrderById(dto.orderId, countryCode);
        if (!order) throw new AppError('Order not found', 404);
        if (order.customerId !== customerId) throw new AppError('Forbidden', 403);
        if (order.paymentMethod !== 'online') throw OrderNotPayableError('Order uses cash payment');
        if (order.status !== 'pending') throw OrderNotPayableError('Order is not in a payable state');

        // Return cached session if still valid
        let cached: string | null = null;
        try {
            cached = await this.cache.get(sessionCacheKey(dto.orderId));
        } catch { /* Redis down — continue */ }
        if (cached) {
            const parsed = JSON.parse(cached) as { sessionUrl: string; transactionId: number };
            return parsed;
        }

        const paymentProvider = await findPaymentProviderByName('kashier');
        if (!paymentProvider || !paymentProvider.isActive) {
            throw new AppError('Payment provider unavailable', 503);
        }

        // Fetch customer info for Kashier
        let customerName = 'Customer';
        let customerEmail = `user${customerId}@placeholder.local`;
        try {
            const user = await this.coreClient.getUserById(customerId);
            customerName = user.name;
            customerEmail = user.email;
        } catch (err) {
            logger.warn('Could not fetch customer info for Kashier session', { customerId });
        }

        const amountStr = (order.totalAmount / 100).toFixed(2); // piastres → major units
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

        const result = await this.provider.createSession({
            orderId: dto.orderId,
            amount: amountStr,
            currency: 'EGP',
            merchantRedirectUrl: dto.merchantRedirectUrl,
            serverWebhookUrl: `${env.appBaseUrl}/api/payments/webhook`,
            customer: { name: customerName, email: customerEmail },
            expiresAt,
        });

        const tx = await createTransaction({
            countryCode,
            orderId: dto.orderId,
            srcAccId: null,
            dstAccId: order.restaurantId,
            amount: order.totalAmount,
            currency: 'EGP',
            type: 'payment',
            status: 'pending',
            paymentProviderId: paymentProvider.id,
            externalReference: result.sessionId,
            kashierOrderId: null,
            metadata: {},
            idempotencyKey: null,
        });

        const response = { sessionUrl: result.sessionUrl, transactionId: tx.id };
        this.cache.set(sessionCacheKey(dto.orderId), JSON.stringify(response), SESSION_CACHE_TTL)
            .catch(() => {});

        return response;
    };

    handleWebhook = async (
        rawBody: Buffer,
        signature: string,
        payload: Record<string, any>,
    ): Promise<void> => {
        if (!this.provider.verifyWebhookSignature(payload, signature)) {
            throw InvalidWebhookSignatureError();
        }

        const data: Record<string, any> = payload.data ?? {};
        const { orderId, status, transactionId } = data;

        // Only process successful payments
        if (status !== 'pay') {
            logger.info('Kashier webhook ignored — non-payment status', { status, orderId });
            return;
        }

        const countryCode = env.countryCode;
        const idempotencyKey = `kashier:${transactionId}`;

        // Dedup: skip if already processed
        const existing = await findTransactionByIdempotencyKey(idempotencyKey, countryCode);
        if (existing) {
            logger.info('Kashier webhook already processed', { idempotencyKey });
            return;
        }

        const tx = await findTransactionByOrderId(Number(orderId), countryCode);
        if (!tx) {
            logger.error('Kashier webhook: transaction not found for order', { orderId });
            throw TransactionNotFoundError();
        }

        // Atomic update: mark transaction completed + advance order to confirmed
        const trx = await db.transaction();
        try {
            await updateTransaction(tx.id, countryCode, {
                status: 'completed',
                kashierOrderId: String(transactionId),
                idempotencyKey,
                metadata: data,
            }, trx);

            await updateOrderStatus(Number(orderId), countryCode, 'confirmed', {}, trx);

            await trx.commit();
        } catch (err) {
            await trx.rollback();
            throw err;
        }

        // Invalidate caches (fire-and-forget)
        this.cache.delete(`os:order:${orderId}:${countryCode}`).catch(() => {});
        this.cache.delete(sessionCacheKey(Number(orderId))).catch(() => {});
    };

    getTransactionByOrderId = async (
        orderId: number,
        countryCode: string,
        actorId: number,
        actorRole: string,
    ): Promise<TransactionResponseDTO> => {
        const tx = await findTransactionByOrderId(orderId, countryCode);
        if (!tx) throw TransactionNotFoundError();

        if (actorRole === SystemRole.CUSTOMER) {
            const order = await findOrderById(orderId, countryCode);
            if (!order || order.customerId !== actorId) throw new AppError('Forbidden', 403);
        }

        return toTransactionResponseDTO(tx);
    };
}
