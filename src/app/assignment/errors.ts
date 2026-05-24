import AppError from '../../lib/error/AppError.js';

export const OfferExpiredError      = () => new AppError('OfferExpiredOrNotFound', 409);
export const NotInCandidateListError = () => new AppError('AgentNotInCandidateList', 409);
export const OrderAlreadyClaimedError = () => new AppError('OrderAlreadyClaimed', 409);
export const OrderNotReadyError      = () => new AppError('OrderNotInReadyState', 409);
