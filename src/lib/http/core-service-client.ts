import { createHmac } from 'crypto';
import { injectable } from 'tsyringe';
import { env } from '../config/env.js';
import AppError from '../error/AppError.js';
import logger from '../logger/logger.js';
import type {
    ICoreServiceClient,
    ProductBranchData,
    AddressData,
    UserData,
    RolePermissionsData,
    BranchMetadata,
} from './core-service-client.interface.js';

type CoreEnvelope<T> = { success: boolean; data: T };

@injectable()
export class CoreServiceClient implements ICoreServiceClient {

    private hmacHeaders(method: string, path: string): Record<string, string> {
        const timestamp = String(Date.now());
        const sig = createHmac('sha256', env.internalHmacSecret)
            .update(`${timestamp}:${method}:${path}`)
            .digest('hex');
        return { 'x-internal-signature': sig, 'x-internal-timestamp': timestamp };
    }

    private async fetchJson<T>(
        path: string,
        headers: Record<string, string>,
        method: string = 'GET',
        body?: unknown,
    ): Promise<T> {
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
    }

    private getInternal<T>(path: string, correlationId?: string): Promise<T> {
        const headers: Record<string, string> = {
            ...this.hmacHeaders('GET', path),
            ...(correlationId ? { 'X-CorrelationId': correlationId } : {}),
        };
        return this.fetchJson<T>(path, headers);
    }

    private getPublic<T>(path: string, correlationId?: string): Promise<T> {
        const headers: Record<string, string> = correlationId
            ? { 'X-CorrelationId': correlationId }
            : {};
        return this.fetchJson<T>(path, headers);
    }

    private postInternal<T>(path: string, body: unknown, correlationId?: string): Promise<T> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...this.hmacHeaders('POST', path),
            ...(correlationId ? { 'X-CorrelationId': correlationId } : {}),
        };
        return this.fetchJson<T>(path, headers, 'POST', body);
    }

    getProductWithBranchDetails(productId: number, branchId: number, correlationId?: string) {
        return this.getInternal<ProductBranchData>(
            `/api/internal/products/${productId}/branch/${branchId}`,
            correlationId,
        );
    }

    getAddressById(addressId: number, correlationId?: string) {
        return this.getInternal<AddressData>(
            `/api/internal/customer/addresses/${addressId}`,
            correlationId,
        );
    }

    getUserById(userId: number, correlationId?: string) {
        return this.getInternal<UserData>(`/api/internal/users/${userId}`, correlationId);
    }

    getRolePermissions(roleName: string, correlationId?: string) {
        return this.getPublic<RolePermissionsData>(
            `/api/roles/${encodeURIComponent(roleName)}/permissions`,
            correlationId,
        );
    }

    getBranchMetadata(branchId: number, correlationId?: string) {
        return this.getInternal<BranchMetadata>(
            `/api/internal/branches/${branchId}`,
            correlationId,
        );
    }

    reserveStock(
        branchId: number,
        items: { productId: number; quantity: number }[],
        correlationId?: string,
    ): Promise<void> {
        return this.postInternal<void>(
            `/api/internal/branches/${branchId}/reserve-stock`,
            items,
            correlationId,
        );
    }
}
