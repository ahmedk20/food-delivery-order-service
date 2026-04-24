import { Router } from 'express';
import { healthRouter } from './app/health/routes.js';

export const routes = Router();

routes.use('/health', healthRouter);

// Phase 3: routes.use('/orders', orderRouter);
// Phase 4: routes.use('/payments', paymentRouter);
// Phase 6: routes.use('/agents', agentRouter);
// Phase 7: routes.use('/restaurant-orders', restaurantOrderRouter);
// Phase 8: routes.use('/admin', adminRouter);
