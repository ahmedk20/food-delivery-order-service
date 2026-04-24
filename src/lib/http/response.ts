import type { Response } from 'express';

export interface ApiResponse<T = unknown, M = undefined> {
    success: boolean;
    data: T;
    meta?: M;
}

export interface PaginationMeta {
    nextCursor: number | null;
    hasMore: boolean;
    count: number;
}

export function sendSuccess<T, M = undefined>(
    res: Response,
    data: T,
    statusCode = 200,
    meta?: M
) {
    const body: ApiResponse<T, M> = {
        success: true,
        data,
        ...(meta && { meta }),
    };
    res.status(statusCode).json(body);
}

export function sendPaginated<T>(res: Response, data: T[], statusCode = 200, meta?: PaginationMeta) {
    sendSuccess<T[], PaginationMeta>(res, data, statusCode, meta);
}
