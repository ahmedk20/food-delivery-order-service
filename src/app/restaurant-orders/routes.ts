import { Router } from 'express';
import { container } from '../../lib/di/container.js';
import { TOKENS } from '../../lib/di/tokens.js';
import { authenticate } from '../../lib/auth/guard.js';
import { requireRestaurantMember } from '../../lib/auth/rbac.js';
import { rbac } from '../../lib/auth/rbac.js';
import { requireRegion } from '../../lib/sharding/region-resolver.js';
import { idempotency } from '../../lib/http/idempotency.js';
import { RestaurantOrderController } from './controller/restaurant-order.controller.js';

const ctrl = container.resolve<RestaurantOrderController>(TOKENS.RestaurantOrderController);

export const restaurantOrderRouter = Router();

restaurantOrderRouter.get(
    '/',
    authenticate, requireRestaurantMember(), requireRegion,
    rbac({ resource: 'orders', action: 'read' }),
    ctrl.listOrders,
);

restaurantOrderRouter.patch(
    '/:publicId/status',
    authenticate, requireRestaurantMember(), requireRegion, idempotency(),
    ctrl.updateStatus,
);
