import AppError from '../../lib/error/AppError.js';

export const AgentInActiveDeliveryError = () => new AppError('AgentInActiveDelivery', 409);
export const NotOnlineError             = () => new AppError('NotOnline', 409);
