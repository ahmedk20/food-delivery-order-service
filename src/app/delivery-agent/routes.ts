import { Router } from 'express';
import { container } from '../../lib/di/container.js';
import { TOKENS } from '../../lib/di/tokens.js';
import { authenticate } from '../../lib/auth/guard.js';
import { requireRole } from '../../lib/auth/rbac.js';
import { requireRegion } from '../../lib/sharding/region-resolver.js';
import { SystemRole } from '../../lib/auth/enums.js';
import { AgentController } from './controller/agent.controller.js';

const ctrl = container.resolve<AgentController>(TOKENS.AgentController);

export const agentRouter = Router();

// Presence
agentRouter.post(
    '/presence/online',
    authenticate, requireRole(SystemRole.DELIVERY_AGENT), requireRegion,
    ctrl.goOnline,
);

agentRouter.post(
    '/presence/offline',
    authenticate, requireRole(SystemRole.DELIVERY_AGENT), requireRegion,
    ctrl.goOffline,
);

agentRouter.post(
    '/presence/ping',
    authenticate, requireRole(SystemRole.DELIVERY_AGENT), requireRegion,
    ctrl.ping,
);

// Tasks (agent's delivery list)
agentRouter.get(
    '/tasks',
    authenticate, requireRole(SystemRole.DELIVERY_AGENT), requireRegion,
    ctrl.getMyTasks,
);

// Earnings
agentRouter.get(
    '/earnings',
    authenticate, requireRole(SystemRole.DELIVERY_AGENT), requireRegion,
    ctrl.getMyEarnings,
);
