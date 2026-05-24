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
    countryCode: string;
}
