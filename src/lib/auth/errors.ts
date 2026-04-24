import AppError from '../error/AppError.js';

export const NotAuthenticated = new AppError('Not authenticated', 401);
export const NotAuthorized = new AppError('Not authorized', 403);
