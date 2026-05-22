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
import { findOrderById, findOrderByPublicId, updateOrderStatus } from '../../order/repository/order.repo.js';
import {
    createTransaction,
    findPendingPaymentByOrderId,
    findTransactionById,
    findTransactionsByOrderId,
    updateTransaction,
} from '../repository/transaction.repo.js';
import { findPaymentProviderByName } from '../repository/payment-provider.repo.js';
import {
    insertWebhookEvent,
    markWebhookError,
    markWebhookProcessed,
} from '../repository/webhook-event.repo.js';
import { creditRestaurantBalance } from '../repository/restaurant-balance.repo.js';
import {
    InvalidWebhookSignatureError,
    PaymentAlreadyCompletedError,
    TransactionNotFoundError,
} from '../errors.js';
import { OrderNotFoundError, OrderNotPayableError } from '../../order/errors.js';
import { Transaction } from '../entity/transaction.entity.js';
import type { InitPaymentDTO } from '../dto/init-payment.dto.js';
import type { RefundRequestDTO } from '../dto/refund-request.dto.js';
import type { TransactionResponseDTO } from '../dto/transaction-response.dto.js';
import type { PaymentResponseDTO } from '../dto/payment-response.dto.js';
import { SystemRole } from '../../../lib/auth/enums.js';
import { orderRoom, restaurantBranchRoom, WS_EVENTS } from '../../../lib/websocket/events.js';

const SESSION_CACHE_TTL = 1800; // 30 minutes

function sessionCacheKey(region: string, orderId: number): string {
    return `${region}:os:payment:session:${orderId}`;
}

function toTransactionResponseDTO(tx: Transaction, orderPublicId: string | null): TransactionResponseDTO {
    return {
        id:                  tx.id,
        orderPublicId,
        amount:              tx.amount,
        currency:            tx.currency,
        type:                tx.type,
        status:              tx.status,
        providerReferenceId: tx.providerReferenceId,
        createdAt:           tx.createdAt,
    };
}

function toPaymentResponseDTO(tx: Transaction, orderPublicId: string | null): PaymentResponseDTO {
    return {
        id:                tx.id,
        orderPublicId,
        type:              tx.type,
        method:            tx.method,
        status:            tx.status,
        amount:            tx.amount,
        currency:          tx.currency,
        isRefunded:        tx.isRefunded,
        refundedPaymentId: tx.refundedPaymentId ?? undefined,
        createdAt:         tx.createdAt.toISOString(),
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

    initPayment = async (
        customerId: number,
        region: string,
        dto: InitPaymentDTO,
    ): Promise<{ sessionUrl: string; transactionId: number }> => {
        const order = await findOrderByPublicId(dto.orderId, region);
        if (!order) throw OrderNotFoundError();
        if (order.customerId !== customerId) throw new AppError('Forbidden', 403);
        if (order.paymentMethod !== 'online')       throw OrderNotPayableError();
        if (order.status !== 'pending_payment')     throw OrderNotPayableError();

        const cacheKey = sessionCacheKey(region, order.id);
        try {
            const cached = await this.cache.get(cacheKey);
            if (cached) return JSON.parse(cached) as { sessionUrl: string; transactionId: number };
        } catch { /* Redis down — continue */ }

        const paymentProvider = await findPaymentProviderByName('kashier');
        if (!paymentProvider || !paymentProvider.isActive) {
            throw new AppError('Payment provider unavailable', 503);
        }

        const user      = await this.coreClient.getUserById(customerId);
        const amountStr = (order.total / 100).toFixed(2);
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

        const result = await this.provider.createSession({
            orderId:             order.id,
            region,
            amount:              amountStr,
            currency:            order.currency,
            merchantRedirectUrl: env.kashier.returnUrl,
            serverWebhookUrl:    `${env.appBaseUrl}/api/payments/webhook/kashier`,
            customer:            { name: user.name, email: user.email },
            expiresAt,
        });

        const tx = await createTransaction({
            region,
            orderId:             order.id,
            type:                'charge',
            method:              'online',
            providerId:          paymentProvider.id,
            providerReferenceId: result.sessionId,
            status:              'pending',
            amount:              order.total,
            currency:            order.currency,
            srcAccId:            customerId,
            dstAccId:            null,
            isRefunded:          false,
            refundedPaymentId:   null,
            idempotencyKey:      null,
            metadata:            {},
        }, region);

        const response = { sessionUrl: result.sessionUrl, transactionId: tx.id };
        this.cache.set(cacheKey, JSON.stringify(response), SESSION_CACHE_TTL).catch(() => {});

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

        // Ignore interim statuses (pending, authorized, etc.) — no state change needed
        if (!isSuccess && !isFailure) {
            logger.info('Kashier webhook ignored — interim status', { rawStatus, orderId });
            return;
        }

        const paymentProvider = await findPaymentProviderByName('kashier');
        if (!paymentProvider) {
            logger.error('Kashier webhook: payment provider not found in DB');
            return;
        }

        const eventId = String(data.eventId ?? '');

        const trx = await db(region).transaction();
        try {
            // Idempotency: reject duplicate deliveries of the same event
            const isFirst = await insertWebhookEvent(
                paymentProvider.id, eventId, signature, payload, region, trx,
            );
            if (!isFirst) {
                await trx.rollback();
                logger.info('Kashier webhook: duplicate event ignored', { eventId, orderId });
                return;
            }

            const pending = await findPendingPaymentByOrderId(orderId, region, trx);
            if (!pending) {
                // Could be a webhook for an already-processed or cancelled order — no-op to stop retries
                await trx.commit();
                logger.warn('Kashier webhook: no pending charge for order', { orderId, region, eventId });
                return;
            }

            const order = await findOrderById(orderId, region);
            if (!order) {
                await trx.commit();
                return;
            }

            if (isSuccess) {
                await updateTransaction(pending.id, region, {
                    status:              'succeeded',
                    providerReferenceId: String(data.transactionId ?? ''),
                    metadata:            data,
                }, trx);

                // Advance order to 'placed' — restaurant is notified via WebSocket
                await updateOrderStatus(orderId, region, 'placed', {}, trx);

                // Credit restaurant's pending balance with the order subtotal (delivery_fee stays with platform)
                await creditRestaurantBalance(
                    order.restaurantId, region,
                    order.subtotal, order.currency,
                    trx,
                );
            } else {
                await updateTransaction(pending.id, region, {
                    status:   'failed',
                    metadata: data,
                }, trx);
                // payment.failed is NOT terminal — order stays pending_payment so customer can retry.
                // A background sweep (Phase 10) cancels stale pending_payment orders after PAYMENT_SESSION_TIMEOUT_MIN.
            }

            await markWebhookProcessed(eventId, region, trx);
            await trx.commit();
        } catch (err) {
            await trx.rollback();
            // Best-effort error stamp — uses a fresh connection since trx is rolled back
            markWebhookError(eventId, String(err), region).catch(() => {});
            throw err;
        }

        // Fire-and-forget cache invalidation
        const updatedOrder = await findOrderById(orderId, region);
        if (updatedOrder) {
            this.cache.delete(`${region}:os:order:${updatedOrder.publicId}`).catch(() => {});
        }
        this.cache.delete(sessionCacheKey(region, orderId)).catch(() => {});

        // Emit WebSocket events (best-effort — never throw from here)
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
                reason:  String(data.failureReason ?? 'unknown'),
            });
        }
    };

    getTransactionsByOrderId = async (
        orderPublicId: string,
        region: string,
        actorId: number,
        actorRole: string,
    ): Promise<TransactionResponseDTO[]> => {
        const order = await findOrderByPublicId(orderPublicId, region);
        if (!order) throw OrderNotFoundError();
        if (actorRole === SystemRole.CUSTOMER && order.customerId !== actorId) {
            throw new AppError('Forbidden', 403);
        }
        const txs = await findTransactionsByOrderId(order.id, region);
        return txs.map(tx => toTransactionResponseDTO(tx, orderPublicId));
    };

    getPaymentById = async (
        paymentId: number,
        region: string,
        actorId: number,
        actorRole: string,
    ): Promise<PaymentResponseDTO> => {
        const tx = await findTransactionById(paymentId, region);
        if (!tx) throw TransactionNotFoundError();

        if (actorRole !== SystemRole.SYSTEM_ADMIN) {
            if (!tx.orderId) throw new AppError('Forbidden', 403);
            const order = await findOrderById(tx.orderId, region);
            if (!order || order.customerId !== actorId) throw new AppError('Forbidden', 403);
            return toPaymentResponseDTO(tx, order.publicId);
        }

        // Admin: resolve publicId if the transaction has an orderId
        let orderPublicId: string | null = null;
        if (tx.orderId) {
            const order = await findOrderById(tx.orderId, region);
            orderPublicId = order?.publicId ?? null;
        }
        return toPaymentResponseDTO(tx, orderPublicId);
    };

    refundPayment = async (
        paymentId: number,
        region: string,
        dto: RefundRequestDTO,
    ): Promise<{ refundId: number; status: string; amount: number; currency: string }> => {
        const tx = await findTransactionById(paymentId, region);
        if (!tx) throw TransactionNotFoundError();
        if (tx.status !== 'succeeded' || tx.type !== 'charge') throw PaymentAlreadyCompletedError();
        if (tx.isRefunded) throw PaymentAlreadyCompletedError();

        const refundAmount = dto.amount ?? tx.amount;

        const trx = await db(region).transaction();
        try {
            const refundTx = await createTransaction({
                region,
                orderId:             tx.orderId,
                type:                'refund',
                method:              tx.method,
                providerId:          tx.providerId,
                providerReferenceId: null,
                status:              'pending',
                amount:              refundAmount,
                currency:            tx.currency,
                srcAccId:            null,
                dstAccId:            tx.srcAccId,
                isRefunded:          false,
                refundedPaymentId:   null,
                idempotencyKey:      null,
                metadata:            { originalPaymentId: paymentId, reason: dto.reason },
            }, region, trx);

            await updateTransaction(paymentId, region, {
                isRefunded:        true,
                refundedPaymentId: refundTx.id,
            }, trx);

            await trx.commit();

            // TODO: Phase 10 — writeOutboxEvent(trx, region, 'payment.refund_initiated', String(paymentId), { refundId: refundTx.id, amount: refundAmount })
            return {
                refundId: refundTx.id,
                status:   'pending',
                amount:   refundAmount,
                currency: tx.currency,
            };
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    };
}
