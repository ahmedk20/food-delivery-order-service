import { IsInt, IsOptional, Min } from 'class-validator';

export class AssignDeliveryDTO {
    @IsOptional()
    @IsInt()
    @Min(1)
    agentId?: number;
}
