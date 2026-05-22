import AppError from '../../lib/error/AppError.js';

export const TransactionNotFoundError     = () => new AppError('TransactionNotFound', 404);
export const PaymentAlreadyCompletedError = () => new AppError('PaymentAlreadyCompleted', 409);
export const InvalidWebhookSignatureError = () => new AppError('InvalidWebhookSignature', 400);
export const DuplicateWebhookError        = () => new AppError('WebhookAlreadyProcessed', 200);
