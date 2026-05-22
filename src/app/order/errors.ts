import AppError from '../../lib/error/AppError.js';

export const OrderNotFoundError             = () => new AppError('OrderNotFound', 404);
export const OrderAccessDeniedError         = () => new AppError('OrderAccessDenied', 403);
export const OrderAlreadyFinalizedError     = () => new AppError('OrderAlreadyFinalized', 409);
export const InvalidStatusTransitionError   = (from: string, to: string) =>
    new AppError(`InvalidStatusTransition:${from}→${to}`, 409);
export const CancellationWindowExpiredError = () => new AppError('CancellationWindowExpired', 409);
export const BranchNotAcceptingOrders       = () => new AppError('BranchNotAcceptingOrders', 409);
export const OutOfStockError                = (_details?: object[]) => new AppError('OutOfStock', 409);
export const OrderNotPayableError           = () => new AppError('OrderNotPayable', 422);
