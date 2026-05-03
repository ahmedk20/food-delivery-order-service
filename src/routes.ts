import { Router } from 'express';
import { healthRouter } from './app/health/routes.js';
import { orderRouter } from './app/order/routes.js';
import { paymentRouter } from './app/payment/routes.js';

export const routes = Router();

routes.use('/health', healthRouter);
routes.use('/orders', orderRouter);
routes.use('/payments', paymentRouter);

// Phase 6: routes.use('/agents', agentRouter);
// Phase 7: routes.use('/restaurant-orders', restaurantOrderRouter);
// Phase 8: routes.use('/admin', adminRouter);
