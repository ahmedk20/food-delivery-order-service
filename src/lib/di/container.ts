import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from './tokens.js';
import { env } from '../config/env.js';
import { cacheProvider } from '../cache/init.js';
import { CoreServiceClient } from '../http/core-service-client.js';
import { KashierPaymentProvider } from '../../pkg/payment/kashier.js';
import { PermissionCacheService } from '../../app/rbac/service/permission-cache.service.js';
import { OrderService } from '../../app/order/service/order.service.js';
import { OrderController } from '../../app/order/controller/order.controller.js';
import { OrderAccessChecker } from '../../app/order/service/order-access-checker.js';
import { PaymentService } from '../../app/payment/service/payment.service.js';
import { PaymentController } from '../../app/payment/controller/payment.controller.js';
import { DeliveryService } from '../../app/delivery/service/delivery.service.js';
import { DeliveryController } from '../../app/delivery/controller/delivery.controller.js';
import { socketServer } from '../websocket/ws-server.js';

// ── Infrastructure ────────────────────────────────────────────────────────────
container.registerInstance(TOKENS.CacheProvider, cacheProvider);
container.registerSingleton(TOKENS.CoreServiceClient, CoreServiceClient);
container.registerSingleton(TOKENS.PermissionCacheService, PermissionCacheService);

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

export { container };
