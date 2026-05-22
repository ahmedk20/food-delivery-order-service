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

export const orderRouter = Router();

orderRouter.post(
    '/',
    authenticate, requireRole(SystemRole.CUSTOMER), requireRegion, idempotency(),
    ctrl.placeOrder,
);

orderRouter.get(
    '/',
    authenticate, requireRole(SystemRole.CUSTOMER), requireRegion,
    ctrl.listOrders,
);

// :publicId — any authenticated role; service layer enforces ownership
orderRouter.get(
    '/:publicId',
    authenticate,
    ctrl.getOrderByPublicId,
);

orderRouter.post(
    '/:publicId/cancel',
    authenticate, requireRole(SystemRole.CUSTOMER), requireRegion, idempotency(),
    ctrl.cancelOrder,
);
