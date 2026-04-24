import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from './tokens.js';
import { cacheProvider } from '../cache/init.js';
import { PermissionCacheService } from '../../app/rbac/service/permission-cache.service.js';

container.registerInstance(TOKENS.CacheProvider, cacheProvider);
container.registerSingleton(TOKENS.PermissionCacheService, PermissionCacheService);

export { container };
