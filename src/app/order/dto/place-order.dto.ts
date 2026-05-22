import {
    ArrayMinSize,
    IsArray,
    IsEnum,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    Min,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { PaymentMethod } from '../enums.js';

export class PlaceOrderItemDTO {
    @IsInt()
    @Min(1)
    productId!: number;

    @IsInt()
    @Min(1)
    quantity!: number;

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    notes?: string;
}

export class PlaceOrderDTO {
    @IsInt()
    @Min(1)
    branchId!: number;

    @IsInt()
    @Min(1)
    deliveryAddressId!: number;

    @IsEnum(['online', 'cash'])
    paymentMethod!: PaymentMethod;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => PlaceOrderItemDTO)
    items!: PlaceOrderItemDTO[];

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    notes?: string;
}
