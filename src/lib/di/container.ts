import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from './tokens.js';
import { env } from '../config/env.js';
import { cacheProvider } from '../cache/init.js';
import { CoreServiceClient } from '../http/core-service-client.js';
import { KashierPaymentProvider } from '../../pkg/payment/kashier.js';
import { RabbitMQClient } from '../../pkg/messaging/rabbitmq/rabbitmq.client.js';
import { PermissionCacheService } from '../../app/rbac/service/permission-cache.service.js';
import { OrderService } from '../../app/order/service/order.service.js';
import { OrderController } from '../../app/order/controller/order.controller.js';
import { OrderAccessChecker } from '../../app/order/service/order-access-checker.js';
import { PaymentService } from '../../app/payment/service/payment.service.js';
import { PaymentController } from '../../app/payment/controller/payment.controller.js';
import { DeliveryService } from '../../app/delivery/service/delivery.service.js';
import { DeliveryController } from '../../app/delivery/controller/delivery.controller.js';
import { AgentService } from '../../app/delivery-agent/service/agent.service.js';
import { AgentController } from '../../app/delivery-agent/controller/agent.controller.js';
import { RestaurantOrderService } from '../../app/restaurant-orders/service/restaurant-order.service.js';
import { RestaurantOrderController } from '../../app/restaurant-orders/controller/restaurant-order.controller.js';
import { AdminService } from '../../app/admin/service/admin.service.js';
import { AdminController } from '../../app/admin/controller/admin.controller.js';
import { socketServer } from '../websocket/ws-server.js';

// ── Infrastructure ────────────────────────────────────────────────────────────
container.registerInstance(TOKENS.CacheProvider, cacheProvider);
container.registerSingleton(TOKENS.CoreServiceClient, CoreServiceClient);
container.registerSingleton(TOKENS.PermissionCacheService, PermissionCacheService);

const messageBroker = new RabbitMQClient({
    url:                env.rabbitmq.url,
    reconnectInitialMs: 2000,
});
container.registerInstance(TOKENS.MessageBroker, messageBroker);

// SocketServer is a singleton created outside tsyringe (needs async init in server.ts).
// We register the already-created instance so services can inject ISocketServer.
container.registerInstance(TOKENS.SocketServer, socketServer);
socketServer.setOrderAccessChecker(new OrderAccessChecker());

// ── Payment provider ──────────────────────────────────────────────────────────
container.registerInstance(
    TOKENS.PaymentProvider,
    new KashierPaymentProvider(env.kashier.apiKey, env.kashier.webhookSecret, env.kashier.baseUrl),
);

// ── App modules ───────────────────────────────────────────────────────────────
container.registerSingleton(TOKENS.OrderService, OrderService);
container.registerSingleton(TOKENS.OrderController, OrderController);
container.registerSingleton(TOKENS.PaymentService, PaymentService);
container.registerSingleton(TOKENS.PaymentController, PaymentController);
container.registerSingleton(TOKENS.DeliveryService, DeliveryService);
container.registerSingleton(TOKENS.DeliveryController, DeliveryController);
container.registerSingleton(TOKENS.AgentService, AgentService);
container.registerSingleton(TOKENS.AgentController, AgentController);
container.registerSingleton(TOKENS.RestaurantOrderService, RestaurantOrderService);
container.registerSingleton(TOKENS.RestaurantOrderController, RestaurantOrderController);
container.registerSingleton(TOKENS.AdminService, AdminService);
container.registerSingleton(TOKENS.AdminController, AdminController);

export { container };
