import { IsInt, IsNotEmpty, IsString, IsUrl, Min } from 'class-validator';

export class CreatePaymentSessionDTO {
    @IsInt()
    @Min(1)
    orderId!: number;

    @IsString()
    @IsNotEmpty()
    @IsUrl({ require_tld: false })
    merchantRedirectUrl!: string;
}
