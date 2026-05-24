import { Router } from 'express';
import { container } from '../../lib/di/container.js';
import { TOKENS } from '../../lib/di/tokens.js';
import { authenticate } from '../../lib/auth/guard.js';
import { requireRestaurantMember, rbac } from '../../lib/auth/rbac.js';
import { requireRegion } from '../../lib/sharding/region-resolver.js';
import { FinanceController } from './controller/finance.controller.js';

const ctrl = container.resolve<FinanceController>(TOKENS.FinanceController);

export const financeRouter = Router();

financeRouter.get(
    '/balance',
    authenticate, requireRestaurantMember(), requireRegion,
    rbac({ resource: 'finance', action: 'read' }),
    ctrl.getMyBalance,
);

financeRouter.get(
    '/payouts',
    authenticate, requireRestaurantMember(), requireRegion,
    rbac({ resource: 'finance', action: 'read' }),
    ctrl.listMyPayouts,
);
