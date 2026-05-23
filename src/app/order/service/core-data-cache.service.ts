import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../../../lib/di/tokens.js';
import type { ICoreServiceClient } from '../../../lib/http/core-service-client.interface.js';
import type { ICacheProvider } from '../../../pkg/cache/cache.interface.js';
import type {
    ProductBranchData,
    AddressData,
    UserData,
    BranchMetadata,
} from '../../../lib/http/core-service-client.interface.js';

// Short-lived TTL: product prices and stock can change between order attempts.
const PRODUCT_CACHE_TTL = 30;
const BRANCH_CACHE_TTL  = 60;

@injectable()
export class CoreDataCacheService {
    constructor(
        @inject(TOKENS.CoreServiceClient) private readonly coreClient: ICoreServiceClient,
        @inject(TOKENS.CacheProvider)     private readonly cache: ICacheProvider,
    ) {}

    async getProduct(
        productId: number,
        branchId: number,
        correlationId?: string,
    ): Promise<ProductBranchData> {
        const key = `os:product:${productId}:branch:${branchId}`;
        try {
            const cached = await this.cache.get(key);
            if (cached) return JSON.parse(cached) as ProductBranchData;
        } catch { /* Redis down */ }

        const data = await this.coreClient.getProductWithBranchDetails(productId, branchId, correlationId);

        this.cache.set(key, JSON.stringify(data), PRODUCT_CACHE_TTL).catch(() => {});
        return data;
    }

    async getBranch(branchId: number, correlationId?: string): Promise<BranchMetadata> {
        const key = `core:branch:${branchId}`;
        try {
            const cached = await this.cache.get(key);
            if (cached) return JSON.parse(cached) as BranchMetadata;
        } catch { /* Redis down */ }

        const data = await this.coreClient.getBranchMetadata(branchId, correlationId);

        this.cache.set(key, JSON.stringify(data), BRANCH_CACHE_TTL).catch(() => {});
        return data;
    }

    async getAddress(addressId: number, correlationId?: string): Promise<AddressData> {
        return this.coreClient.getAddressById(addressId, correlationId);
    }

    async getUser(userId: number, correlationId?: string): Promise<UserData> {
        return this.coreClient.getUserById(userId, correlationId);
    }
}
