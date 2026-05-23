import { Router } from 'express';
import { container } from '../../lib/di/container.js';
import { TOKENS } from '../../lib/di/tokens.js';
import { authenticate } from '../../lib/auth/guard.js';
import { requireSystemAdmin } from '../../lib/auth/rbac.js';
import { requireRegion, requireConcreteRegion } from '../../lib/sharding/region-resolver.js';
import { idempotency } from '../../lib/http/idempotency.js';
import type { AdminController } from './controller/admin.controller.js';

export const adminRouter = Router();

adminRouter.use(authenticate, requireSystemAdmin());

// Read endpoints allow X-Region: all (fan-out reads handled by caller)
adminRouter.get('/orders',
    requireRegion, (req, res, next) => container.resolve<AdminController>(TOKENS.AdminController).listOrders(req, res, next));

adminRouter.get('/transactions',
    requireRegion, (req, res, next) => container.resolve<AdminController>(TOKENS.AdminController).listTransactions(req, res, next));

adminRouter.get('/restaurant-balances',
    requireRegion, (req, res, next) => container.resolve<AdminController>(TOKENS.AdminController).listRestaurantBalances(req, res, next));

adminRouter.get('/agents',
    requireRegion, (req, res, next) => container.resolve<AdminController>(TOKENS.AdminController).listAgents(req, res, next));

// Write endpoints require a concrete region (no fan-out)
adminRouter.patch('/orders/:publicId/status',
    requireConcreteRegion, (req, res, next) => container.resolve<AdminController>(TOKENS.AdminController).forceUpdateOrderStatus(req, res, next));

adminRouter.post('/restaurant/payouts',
    requireConcreteRegion, idempotency(), (req, res, next) => container.resolve<AdminController>(TOKENS.AdminController).createPayout(req, res, next));

// Ops visibility: outbox rows that have exhausted all dispatch attempts
adminRouter.get('/outbox/dead-letters',
    requireConcreteRegion, (req, res, next) => container.resolve<AdminController>(TOKENS.AdminController).listDeadLetterOutbox(req, res, next));
