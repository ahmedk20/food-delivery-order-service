import { Router } from 'express';
import { container } from '../../lib/di/container.js';
import { TOKENS } from '../../lib/di/tokens.js';
import { authenticate } from '../../lib/auth/guard.js';
import { requireRole } from '../../lib/auth/rbac.js';
import { requireRegion } from '../../lib/sharding/region-resolver.js';
import { idempotency } from '../../lib/http/idempotency.js';
import { SystemRole } from '../../lib/auth/enums.js';
import { OrderController } from './controller/order.controller.js';

const ctrl = container.resolve<OrderController>(TOKENS.OrderController);

// Orders router — placement, detail, and status transitions
export const orderRouter = Router();

orderRouter.post(
    '/',
    authenticate, requireRole(SystemRole.CUSTOMER), requireRegion, idempotency(),
    ctrl.placeOrder,
);

// :publicId — any authenticated role; service enforces ownership
orderRouter.get(
    '/:publicId',
    authenticate, requireRegion,
    ctrl.getOrderByPublicId,
);

orderRouter.patch(
    '/:publicId/status',
    authenticate, requireRegion, idempotency(),
    ctrl.updateOrderStatus,
);

// Customer order list — mounted separately at /customer/orders
export const customerOrderRouter = Router();

customerOrderRouter.get(
    '/',
    authenticate, requireRole(SystemRole.CUSTOMER), requireRegion,
    ctrl.listOrders,
);
