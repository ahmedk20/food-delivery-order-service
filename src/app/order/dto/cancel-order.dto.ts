import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CancelOrderDTO {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    cancellationReason?: string;
}
