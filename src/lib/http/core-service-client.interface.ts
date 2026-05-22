export interface ProductBranchData {
    id: number;
    name: string;
    imageUrl: string | null;
    price: number;
    stock: number;
    isAvailable: boolean;
    restaurantId: number;
    branchId: number;
}

export interface AddressData {
    id: number;
    userId: number;
    label: string;
    country: string;
    city: string;
    street: string;
    building: string | null;
    apartmentNumber: string | null;
    type: string;
    lat: number;
    lng: number;
    isDefault: boolean;
}

export interface UserData {
    id: number;
    name: string;
    email: string;
    phone: string;
    systemRole: string;
    deletedAt: Date | null;
}

export interface RolePermissionsData {
    roleName: string;
    permissions: { permission: string }[];
}

export interface BranchMetadata {
    branchId: number;
    restaurantId: number;
    region: string;
}

export interface ICoreServiceClient {
    getProductWithBranchDetails(
        productId: number,
        branchId: number,
        correlationId?: string,
    ): Promise<ProductBranchData>;

    getAddressById(
        addressId: number,
        correlationId?: string,
    ): Promise<AddressData>;

    getUserById(
        userId: number,
        correlationId?: string,
    ): Promise<UserData>;

    getRolePermissions(
        roleName: string,
        correlationId?: string,
    ): Promise<RolePermissionsData>;

    getBranchMetadata(
        branchId: number,
        correlationId?: string,
    ): Promise<BranchMetadata>;
}
