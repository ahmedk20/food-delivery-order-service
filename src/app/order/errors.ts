import AppError from '../../lib/error/AppError.js';

export const OrderNotFoundError = () => new AppError('Order not found', 404);
export const OrderCancelledError = () => new AppError('Order is already cancelled', 409);
export const InvalidStatusTransitionError = (from: string) =>
    new AppError(`Cannot cancel an order with status '${from}'`, 422);
