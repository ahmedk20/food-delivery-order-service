import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../../../lib/di/tokens.js';
import { env } from '../../../lib/config/env.js';
import AppError from '../../../lib/error/AppError.js';
import logger from '../../../lib/logger/logger.js';
import { db } from '../../../lib/knex/knex.js';
import type { ICacheProvider } from '../../../pkg/cache/cache.interface.js';
import type { IPaymentProvider } from '../../../pkg/payment/payment-provider.interface.js';
import type { ICoreServiceClient } from '../../../lib/http/core-service-client.interface.js';
import type { ISocketServer } from '../../../lib/websocket/ws-server.js';
import { findOrderById, updateOrderStatus } from '../../order/repository/order.repo.js';
import {
    createTransaction,
    findPendingPaymentByOrderId,
    findTransactionsByOrderId,
    updateTransaction,
} from '../repository/transaction.repo.js';
import { findPaymentProviderByName } from '../repository/payment-provider.repo.js';
import {
    InvalidWebhookSignatureError,
    TransactionNotFoundError,
} from '../errors.js';
import { OrderNotPayableError } from '../../order/errors.js';
import { Transaction } from '../entity/transaction.entity.js';
import type { CreatePaymentSessionDTO } from '../dto/create-session.dto.js';
import type { TransactionResponseDTO } from '../dto/transaction-response.dto.js';
import { SystemRole } from '../../../lib/auth/enums.js';
import { orderRoom, restaurantBranchRoom, WS_EVENTS } from '../../../lib/websocket/events.js';

const SESSION_CACHE_TTL = 1800; // 30 minutes

function sessionCacheKey(region: string, orderId: number): string {
    return `${region}:os:payment:session:${orderId}`;
}

function toTransactionResponseDTO(tx: Transaction): TransactionResponseDTO {
    return {
        id:                tx.id,
        orderId:           tx.orderId,
        amount:            tx.amount,
        currency:          tx.currency,
        type:              tx.type,
        status:            tx.status,
        externalReference: tx.externalReference,
        createdAt:         tx.createdAt,
    };
}

@injectable()
export class PaymentService {
    constructor(
        @inject(TOKENS.PaymentProvider)   private readonly provider: IPaymentProvider,
        @inject(TOKENS.CacheProvider)     private readonly cache: ICacheProvider,
        @inject(TOKENS.CoreServiceClient) private readonly coreClient: ICoreServiceClient,
        @inject(TOKENS.SocketServer)      private readonly socket: ISocketServer,
    ) {}

    createSession = async (
        customerId: number,
        region: string,
        dto: CreatePaymentSessionDTO,
    ): Promise<{ sessionUrl: string; transactionId: number }> => {
        const order = await findOrderById(dto.orderId, region);
        if (!order) throw new AppError('Order not found', 404);
        if (order.customerId !== customerId) throw new AppError('Forbidden', 403);
        if (order.paymentMethod !== 'online')       throw OrderNotPayableError();
        if (order.status !== 'pending_payment')     throw OrderNotPayableError();

        let cached: string | null = null;
        try {
            cached = await this.cache.get(sessionCacheKey(region, order.id));
        } catch { /* Redis down — continue */ }
        if (cached) return JSON.parse(cached) as { sessionUrl: string; transactionId: number };

        const paymentProvider = await findPaymentProviderByName('kashier');
        if (!paymentProvider || !paymentProvider.isActive) {
            throw new AppError('Payment provider unavailable', 503);
        }

        const user      = await this.coreClient.getUserById(customerId);
        const amountStr = (order.total / 100).toFixed(2); // minor units → major
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

        const result = await this.provider.createSession({
            orderId:             order.id,
            region,
            amount:              amountStr,
            currency:            order.currency,  // snapshotted at order placement
            merchantRedirectUrl: env.kashier.returnUrl,
            serverWebhookUrl:    `${env.appBaseUrl}/api/payments/webhook/kashier`,
            customer:            { name: user.name, email: user.email },
            expiresAt,
        });

        // Create the pending transaction row; webhook will advance it to completed/failed.
        const tx = await createTransaction({
            region,
            orderId:            order.id,
            srcAccId:           customerId,  // customer pays
            dstAccId:           null,        // platform receives (NULL = platform)
            amount:             order.total,
            currency:           order.currency,
            type:               'payment',
            status:             'pending',
            paymentProviderId:  paymentProvider.id,
            externalReference:  result.sessionId,
            kashierOrderId:     null,
            metadata:           {},
        }, region);

        const response = { sessionUrl: result.sessionUrl, transactionId: tx.id };
        this.cache.set(sessionCacheKey(region, order.id), JSON.stringify(response), SESSION_CACHE_TTL)
            .catch(() => {});

        return response;
    };

    handleWebhook = async (
        signature: string,
        payload: Record<string, any>,
    ): Promise<void> => {
        if (!this.provider.verifyWebhookSignature(payload, signature)) {
            throw InvalidWebhookSignatureError();
        }

        const data = payload.data ?? {};

        // Recover region and internal orderId from Kashier's merchantOrderId (e.g. "eg-123")
        const merchantOrderId: string = String(data.merchantOrderId ?? '');
        const dash = merchantOrderId.indexOf('-');
        if (dash < 1) {
            logger.warn('Kashier webhook: malformed merchantOrderId', { merchantOrderId });
            return;
        }
        const region  = merchantOrderId.slice(0, dash);
        const orderId = Number(merchantOrderId.slice(dash + 1));
        if (!Number.isInteger(orderId) || orderId <= 0) {
            logger.warn('Kashier webhook: invalid orderId in merchantOrderId', { merchantOrderId });
            return;
        }

        const rawStatus = String(data.status ?? '').toUpperCase();
        const isSuccess = rawStatus === 'SUCCESS';
        const isFailure = rawStatus === 'FAILED' || rawStatus === 'FAILURE';

        if (!isSuccess && !isFailure) {
            logger.info('Kashier webhook ignored — interim status', { rawStatus, orderId });
            return;
        }

        const trx = await db(region).transaction();
        try {
            const pending = await findPendingPaymentByOrderId(orderId, region, trx);
            if (!pending) {
                await trx.rollback();
                logger.warn('Kashier webhook: no pending payment for order', { orderId, region });
                return;
            }

            const order = await findOrderById(orderId, region);
            if (!order) {
                await trx.rollback();
                return;
            }

            if (isSuccess) {
                await updateTransaction(pending.id, region, {
                    status:            'completed',
                    externalReference: String(data.transactionId ?? ''),
                    kashierOrderId:    String(data.orderId ?? ''),
                    metadata:          data,
                }, trx);

                await updateOrderStatus(orderId, region, 'placed', {}, trx);

            } else {
                await updateTransaction(pending.id, region, {
                    status:   'failed',
                    metadata: data,
                }, trx);

                // payment.failed is NOT terminal — order stays pending_payment so customer can retry.
                // A background sweep (Phase 10) cancels stale pending orders after PAYMENT_SESSION_TIMEOUT_MIN.
            }

            await trx.commit();
        } catch (err) {
            await trx.rollback();
            throw err;
        }

        // Fire-and-forget cache invalidation
        this.cache.delete(sessionCacheKey(region, orderId)).catch(() => {});

        const updatedOrder = await findOrderById(orderId, region);
        if (updatedOrder) {
            this.cache.delete(`${region}:os:order:${updatedOrder.publicId}`).catch(() => {});
        }

        if (isSuccess && updatedOrder) {
            this.socket.emitToRoom(orderRoom(updatedOrder.publicId), WS_EVENTS.PAYMENT_COMPLETED, {
                orderId:       updatedOrder.publicId,
                transactionId: String(data.transactionId ?? ''),
            });
            this.socket.emitToRoom(orderRoom(updatedOrder.publicId), WS_EVENTS.ORDER_STATUS_CHANGED, {
                orderId:   updatedOrder.publicId,
                status:    'placed',
                updatedAt: new Date().toISOString(),
            });
            this.socket.emitToRoom(restaurantBranchRoom(updatedOrder.branchId), WS_EVENTS.ORDER_CREATED, {
                orderId:    updatedOrder.publicId,
                customerId: updatedOrder.customerId,
                subtotal:   updatedOrder.subtotal,
            });
        } else if (isFailure && updatedOrder) {
            this.socket.emitToRoom(orderRoom(updatedOrder.publicId), WS_EVENTS.PAYMENT_FAILED, {
                orderId: updatedOrder.publicId,
                reason:  data.failureReason ?? 'unknown',
            });
        }
    };

    getTransactionsByOrderId = async (
        orderId: number,
        region: string,
        actorId: number,
        actorRole: string,
    ): Promise<TransactionResponseDTO[]> => {
        if (actorRole === SystemRole.CUSTOMER) {
            const order = await findOrderById(orderId, region);
            if (!order || order.customerId !== actorId) throw new AppError('Forbidden', 403);
        }

        const txs = await findTransactionsByOrderId(orderId, region);
        return txs.map(toTransactionResponseDTO);
    };
}
