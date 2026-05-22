import express, { Router } from 'express';
import { container } from '../../lib/di/container.js';
import { TOKENS } from '../../lib/di/tokens.js';
import { authenticate } from '../../lib/auth/guard.js';
import { requireRole, requireSystemAdmin } from '../../lib/auth/rbac.js';
import { requireRegion } from '../../lib/sharding/region-resolver.js';
import { idempotency } from '../../lib/http/idempotency.js';
import { SystemRole } from '../../lib/auth/enums.js';
import { PaymentController } from './controller/payment.controller.js';

const ctrl = container.resolve<PaymentController>(TOKENS.PaymentController);

export const paymentRouter = Router();

// Webhook: no auth middleware — verified by Kashier HMAC inside the handler.
// express.raw() preserves the raw body buffer so the controller can parse it.
paymentRouter.post(
    '/webhook/:provider',
    express.raw({ type: 'application/json' }),
    ctrl.handleWebhook,
);

// Must come before /:paymentId to avoid Express matching 'orders' as a paymentId.
// View all transactions for an order (customer sees own, admin sees all).
paymentRouter.get(
    '/orders/:orderId',
    authenticate,
    requireRegion,
    ctrl.getByOrderId,
);

// Payment init: customer only, idempotency prevents duplicate Kashier API calls.
paymentRouter.post(
    '/init',
    authenticate,
    requireRole(SystemRole.CUSTOMER),
    requireRegion,
    idempotency(),
    ctrl.initPayment,
);

// Refund: admin only. 202 Accepted — actual Kashier refund call is async (Phase 10 outbox).
paymentRouter.post(
    '/:paymentId/refund',
    authenticate,
    requireSystemAdmin(),
    requireRegion,
    idempotency(),
    ctrl.refundPayment,
);

// View a single payment transaction (owner or admin).
paymentRouter.get(
    '/:paymentId',
    authenticate,
    requireRegion,
    ctrl.getPaymentById,
);
