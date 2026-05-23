import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../../../lib/di/tokens.js';
import type { OrderService } from '../../order/service/order.service.js';
import type { UpdateOrderStatusDTO } from '../../order/dto/update-order-status.dto.js';
import type { OrderResponseDTO } from '../../order/dto/order-response.dto.js';
import type { OrderListItemDTO } from '../../order/dto/order-list-item.dto.js';
import { SystemRole } from '../../../lib/auth/enums.js';

@injectable()
export class RestaurantOrderService {
    constructor(
        @inject(TOKENS.OrderService) private readonly orderService: OrderService,
    ) {}

    listOrders = async (
        branchId: number,
        region: string,
        query: Record<string, any>,
    ): Promise<{
        data: OrderListItemDTO[];
        meta: { hasMore: boolean; nextCursor: number | null; count: number };
    }> => {
        return this.orderService.listOrdersByBranch(branchId, region, query);
    };

    updateStatus = async (
        publicId: string,
        region: string,
        memberId: number,
        dto: UpdateOrderStatusDTO,
    ): Promise<OrderResponseDTO> => {
        return this.orderService.updateOrderStatus(
            publicId, region, memberId, SystemRole.RESTAURANT_USER, dto,
        );
    };
}
