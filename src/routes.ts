import { Router } from 'express';
import { healthRouter } from './app/health/routes.js';
import { orderRouter, customerOrderRouter } from './app/order/routes.js';
import { paymentRouter } from './app/payment/routes.js';
import { deliveryRouter } from './app/delivery/routes.js';

export const routes = Router();

routes.use('/health', healthRouter);
routes.use('/orders', orderRouter);
routes.use('/customer/orders', customerOrderRouter);
routes.use('/payments', paymentRouter);
routes.use('/deliveries', deliveryRouter);

// Phase 7: routes.use('/agents', agentRouter);
// Phase 8: routes.use('/restaurant/orders', restaurantOrderRouter);
// Phase 9: routes.use('/admin', adminRouter);
