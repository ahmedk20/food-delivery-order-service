export class OrderItem {
    id: number;
    orderId: number;
    region: string;
    productId: number;
    productName: string;
    productImageUrl: string | null;
    unitPrice: number;
    quantity: number;
    subtotal: number;
    notes: string | null;
    createdAt: Date;

    constructor(data: Partial<OrderItem>) {
        this.id              = data.id!;
        this.orderId         = data.orderId!;
        this.region          = data.region!;
        this.productId       = data.productId!;
        this.productName     = data.productName!;
        this.productImageUrl = data.productImageUrl ?? null;
        this.unitPrice       = data.unitPrice!;
        this.quantity        = data.quantity!;
        this.subtotal        = data.subtotal!;
        this.notes           = data.notes ?? null;
        this.createdAt       = data.createdAt ?? new Date();
    }
}
