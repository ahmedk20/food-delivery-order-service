import express, { Router } from 'express';
import { container } from '../../lib/di/container.js';
import { TOKENS } from '../../lib/di/tokens.js';
import { authenticate } from '../../lib/auth/guard.js';
import { requireRole } from '../../lib/auth/rbac.js';
import { idempotency } from '../../lib/http/idempotency.js';
import { SystemRole } from '../../lib/auth/enums.js';
import { PaymentController } from './controller/payment.controller.js';

const ctrl = container.resolve<PaymentController>(TOKENS.PaymentController);

export const paymentRouter = Router();

// Webhook: no auth middleware — verified by Kashier HMAC inside the handler
// express.raw() preserves the raw body buffer needed for HMAC verification
paymentRouter.post(
    '/webhook',
    express.raw({ type: 'application/json' }),
    ctrl.handleWebhook,
);

// Session creation: idempotency prevents duplicate Kashier API calls
paymentRouter.post(
    '/sessions',
    authenticate,
    requireRole(SystemRole.CUSTOMER),
    idempotency(),
    ctrl.createSession,
);

// View transaction for an order (customer sees own, admin sees all)
paymentRouter.get(
    '/orders/:orderId',
    authenticate,
    ctrl.getByOrderId,
);
