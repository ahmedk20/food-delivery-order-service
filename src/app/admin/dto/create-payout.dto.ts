import { IsInt, IsIn, IsOptional, IsString, Min } from 'class-validator';

export class CreatePayoutDTO {
    @IsInt()
    @Min(1)
    restaurantId!: number;

    @IsInt()
    @Min(1)
    amount!: number;

    @IsIn(['EGP', 'SAR'])
    currency!: string;

    @IsString()
    providerReferenceId!: string;

    @IsOptional()
    @IsString()
    note?: string;
}
