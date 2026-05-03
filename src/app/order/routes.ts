import { Router } from 'express';
import { container } from '../../lib/di/container.js';
import { TOKENS } from '../../lib/di/tokens.js';
import { authenticate } from '../../lib/auth/guard.js';
import { requireRole } from '../../lib/auth/rbac.js';
import { idempotency } from '../../lib/http/idempotency.js';
import { SystemRole } from '../../lib/auth/enums.js';
import { OrderController } from './controller/order.controller.js';

const ctrl = container.resolve<OrderController>(TOKENS.OrderController);

export const orderRouter = Router();

orderRouter.post(
    '/',
    authenticate,
    requireRole(SystemRole.CUSTOMER),
    idempotency(),
    ctrl.placeOrder,
);

orderRouter.get(
    '/',
    authenticate,
    requireRole(SystemRole.CUSTOMER),
    ctrl.listOrders,
);

// any authenticated role — service-level auth enforces ownership
orderRouter.get(
    '/:id',
    authenticate,
    ctrl.getOrderById,
);

orderRouter.post(
    '/:id/cancel',
    authenticate,
    requireRole(SystemRole.CUSTOMER),
    idempotency(),
    ctrl.cancelOrder,
);
