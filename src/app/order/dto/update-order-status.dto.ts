import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOrderStatusDTO {
    @IsEnum(['accepted', 'rejected', 'preparing', 'ready', 'cancelled'])
    status!: 'accepted' | 'rejected' | 'preparing' | 'ready' | 'cancelled';

    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;

    @IsOptional()
    @IsISO8601()
    estimatedDeliveryAt?: string;
}
