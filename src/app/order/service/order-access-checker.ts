import { injectable } from 'tsyringe';
import type { IOrderAccessChecker } from '../../../lib/websocket/ws-server.js';
import { findOrderByPublicId } from '../repository/order.repo.js';
import { SystemRole } from '../../../lib/auth/enums.js';

@injectable()
export class OrderAccessChecker implements IOrderAccessChecker {
    async canAccess(
        publicId: string,
        userId: number,
        role: string,
        restaurantId: number | undefined,
        region: string,
    ): Promise<boolean> {
        if (role === SystemRole.SYSTEM_ADMIN) return true;

        const order = await findOrderByPublicId(publicId, region);
        if (!order) return false;

        if (role === SystemRole.CUSTOMER)       return order.customerId === userId;
        if (role === SystemRole.RESTAURANT_USER) return order.restaurantId === restaurantId;
        if (role === SystemRole.DELIVERY_AGENT) return order.deliveryAgentId === userId;

        return false;
    }
}
