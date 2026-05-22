import { IsUUID } from 'class-validator';

export class InitPaymentDTO {
    @IsUUID()
    orderId!: string;  // public UUID of the order
}
