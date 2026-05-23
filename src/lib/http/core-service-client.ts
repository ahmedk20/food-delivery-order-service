import { injectable } from 'tsyringe';
import { BaseCoreClient } from '../core-client/base.client.js';
import type {
    ICoreServiceClient,
    ProductBranchData,
    AddressData,
    UserData,
    RolePermissionsData,
    BranchMetadata,
} from './core-service-client.interface.js';

@injectable()
export class CoreServiceClient extends BaseCoreClient implements ICoreServiceClient {

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
