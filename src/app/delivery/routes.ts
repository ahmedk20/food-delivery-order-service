import { Router } from 'express';
import { container } from '../../lib/di/container.js';
import { TOKENS } from '../../lib/di/tokens.js';
import { authenticate } from '../../lib/auth/guard.js';
import { requireRole, requireSystemAdmin } from '../../lib/auth/rbac.js';
import { requireConcreteRegion } from '../../lib/sharding/region-resolver.js';
import { idempotency } from '../../lib/http/idempotency.js';
import { SystemRole } from '../../lib/auth/enums.js';
import { DeliveryController } from './controller/delivery.controller.js';

const ctrl = container.resolve<DeliveryController>(TOKENS.DeliveryController);

export const deliveryRouter = Router();

// Admin: assign a delivery agent to a ready order
deliveryRouter.post(
    '/assign/:orderPublicId',
    authenticate, requireSystemAdmin(), requireConcreteRegion,
    ctrl.assignDelivery,
);

// Admin: reassign delivery to a different agent
deliveryRouter.post(
    '/reassign/:orderPublicId',
    authenticate, requireSystemAdmin(), requireConcreteRegion,
    ctrl.reassignDelivery,
);

// Agent: update delivery status (accepted / rejected / picked / delivered)
deliveryRouter.patch(
    '/:deliveryId/status',
    authenticate, requireRole(SystemRole.DELIVERY_AGENT), requireConcreteRegion, idempotency(),
    ctrl.updateDeliveryStatus,
);
