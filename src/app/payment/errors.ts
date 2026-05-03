import AppError from '../../lib/error/AppError.js';

export const TransactionNotFoundError     = () => new AppError('Transaction not found', 404);
export const PaymentAlreadyCompletedError = () => new AppError('Payment already completed', 409);
export const InvalidWebhookSignatureError = () => new AppError('Invalid webhook signature', 400);
export const OrderNotPayableError         = (reason: string) => new AppError(reason, 422);
