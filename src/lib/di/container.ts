import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from './tokens.js';
import { cacheProvider } from '../cache/init.js';
import { CoreServiceClient } from '../http/core-service-client.js';
import { PermissionCacheService } from '../../app/rbac/service/permission-cache.service.js';
import { OrderService } from '../../app/order/service/order.service.js';
import { OrderController } from '../../app/order/controller/order.controller.js';

container.registerInstance(TOKENS.CacheProvider, cacheProvider);
container.registerSingleton(TOKENS.CoreServiceClient, CoreServiceClient);
container.registerSingleton(TOKENS.PermissionCacheService, PermissionCacheService);
container.registerSingleton(TOKENS.OrderService, OrderService);
container.registerSingleton(TOKENS.OrderController, OrderController);

export { container };
