import { Router } from 'express';
import { healthRouter } from './app/health/routes.js';
import { orderRouter, customerOrderRouter } from './app/order/routes.js';
import { paymentRouter } from './app/payment/routes.js';
import { deliveryRouter } from './app/delivery/routes.js';
import { agentRouter } from './app/delivery-agent/routes.js';
import { restaurantOrderRouter } from './app/restaurant-orders/routes.js';
import { adminRouter } from './app/admin/routes.js';
import { internalRouter } from './app/internal/routes.js';

export const routes = Router();

routes.use('/health', healthRouter);
routes.use('/orders', orderRouter);
routes.use('/customer/orders', customerOrderRouter);
routes.use('/payments', paymentRouter);
routes.use('/deliveries', deliveryRouter);
routes.use('/agents', agentRouter);
routes.use('/restaurant/orders', restaurantOrderRouter);
routes.use('/admin', adminRouter);
routes.use('/internal', internalRouter);
