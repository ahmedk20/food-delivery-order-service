import { injectable } from 'tsyringe';
import { BaseCoreClient } from './base.client.js';
import type { ProductBranchData } from '../http/core-service-client.interface.js';

@injectable()
export class ProductClient extends BaseCoreClient {
    getProductWithBranchDetails(
        productId: number,
        branchId: number,
        correlationId?: string,
    ): Promise<ProductBranchData> {
        return this.getInternal<ProductBranchData>(
            `/api/internal/products/${productId}/branch/${branchId}`,
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
