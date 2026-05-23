import AppError from '../../lib/error/AppError.js';

export const OrderNotReadyError                 = () => new AppError('OrderNotReady', 409);
export const OrderAlreadyHasActiveDeliveryError = () => new AppError('OrderAlreadyHasActiveDelivery', 409);
export const NoEligibleAgentsError              = () => new AppError('NoEligibleAgents', 409);
export const MaxReassignmentAttemptsReachedError = () => new AppError('MaxReassignmentAttemptsReached', 409);
export const DeliveryNotFoundError              = () => new AppError('DeliveryNotFound', 404);
export const DeliveryNotOwnedByAgentError       = () => new AppError('DeliveryNotOwnedByAgent', 403);
export const InvalidDeliveryStatusTransitionError = (from: string, to: string) =>
    new AppError(`InvalidDeliveryStatusTransition:${from}→${to}`, 409);
export const AgentInActiveDeliveryError         = () => new AppError('AgentInActiveDelivery', 409);
