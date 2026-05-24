import 'reflect-metadata';
import '../../lib/di/container.js';
import supertest from 'supertest';
import { createApp } from '../../app.js';
import { container } from '../../lib/di/container.js';
import { TOKENS } from '../../lib/di/tokens.js';
import type { OrderService } from '../../app/order/service/order.service.js';
import type { PaymentService } from '../../app/payment/service/payment.service.js';
import type { DeliveryService } from '../../app/delivery/service/delivery.service.js';
import type { AgentService } from '../../app/delivery-agent/service/agent.service.js';
import type { RestaurantOrderService } from '../../app/restaurant-orders/service/restaurant-order.service.js';
import type { AdminService } from '../../app/admin/service/admin.service.js';
import type { FinanceService } from '../../app/finance/service/finance.service.js';
import type { PermissionCacheService } from '../../lib/rbac/permission-cache.service.js';

export const app = createApp();
export const request = supertest(app);

export const orderService       = container.resolve<OrderService>(TOKENS.OrderService);
export const paymentService     = container.resolve<PaymentService>(TOKENS.PaymentService);
export const deliveryService    = container.resolve<DeliveryService>(TOKENS.DeliveryService);
export const agentService       = container.resolve<AgentService>(TOKENS.AgentService);
export const restaurantOrderSvc = container.resolve<RestaurantOrderService>(TOKENS.RestaurantOrderService);
export const adminService       = container.resolve<AdminService>(TOKENS.AdminService);
export const financeService     = container.resolve<FinanceService>(TOKENS.FinanceService);
export const permCacheSvc       = container.resolve<PermissionCacheService>(TOKENS.PermissionCacheService);
