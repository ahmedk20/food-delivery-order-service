export interface ProductBranchData {
    id: number;
    name: string;
    imageUrl: string | null;
    price: number;
    stock: number;
    isAvailable: boolean;
    restaurantId: number;
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
}

export interface RolePermissionsData {
    role: string;
    permissions: { permission: string }[];
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
}
