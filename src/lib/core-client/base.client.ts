import { createHmac } from 'crypto';
import { env } from '../config/env.js';
import AppError from '../error/AppError.js';
import logger from '../logger/logger.js';
import { withRetry } from '../../pkg/utils/retry.js';

type CoreEnvelope<T> = { success: boolean; data: T };

export abstract class BaseCoreClient {

    protected hmacHeaders(method: string, path: string): Record<string, string> {
        const timestamp = String(Date.now());
        const sig = createHmac('sha256', env.internalHmacSecret)
            .update(`${timestamp}:${method}:${path}`)
            .digest('hex');
        return { 'x-internal-signature': sig, 'x-internal-timestamp': timestamp };
    }

    protected async fetchJson<T>(
        path: string,
        headers: Record<string, string>,
        method: string = 'GET',
        body?: unknown,
    ): Promise<T> {
        return withRetry(
            async () => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 5_000);
                try {
                    const res = await fetch(`${env.coreServiceUrl}${path}`, {
                        method,
                        headers,
                        body: body !== undefined ? JSON.stringify(body) : undefined,
                        signal: controller.signal,
                    });

                    if (!res.ok) {
                        if (res.status === 404) throw new AppError('Resource not found', 422);
                        logger.error('Core service HTTP error', { path, status: res.status });
                        throw new AppError('Core service unavailable', 503);
                    }

                    const json = (await res.json()) as CoreEnvelope<T>;
                    return json.data;
                } catch (err) {
                    if (err instanceof AppError) throw err;
                    logger.error('Core service unreachable', { path, message: (err as Error).message });
                    throw new AppError('Core service unavailable', 503);
                } finally {
                    clearTimeout(timer);
                }
            },
            {
                attempts:    3,
                baseDelayMs: 100,
                maxDelayMs:  500,
                isRetryable: (err) => !(err instanceof AppError) || (err as AppError).statusCode >= 500,
            },
        );
    }

    protected getInternal<T>(path: string, correlationId?: string): Promise<T> {
        const headers: Record<string, string> = {
            ...this.hmacHeaders('GET', path),
            ...(correlationId ? { 'X-CorrelationId': correlationId } : {}),
        };
        return this.fetchJson<T>(path, headers);
    }

    protected getPublic<T>(path: string, correlationId?: string): Promise<T> {
        const headers: Record<string, string> = correlationId
            ? { 'X-CorrelationId': correlationId }
            : {};
        return this.fetchJson<T>(path, headers);
    }

    protected postInternal<T>(path: string, body: unknown, correlationId?: string): Promise<T> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...this.hmacHeaders('POST', path),
            ...(correlationId ? { 'X-CorrelationId': correlationId } : {}),
        };
        return this.fetchJson<T>(path, headers, 'POST', body);
    }
}
