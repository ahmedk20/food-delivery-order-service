import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export type AgentDeliveryAction = 'accepted' | 'rejected' | 'picked' | 'delivered';

export class UpdateDeliveryStatusDTO {
    @IsEnum(['accepted', 'rejected', 'picked', 'delivered'])
    status!: AgentDeliveryAction;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;
}
