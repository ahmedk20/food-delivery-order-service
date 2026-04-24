export const TOKENS = {
    // Infrastructure
    CacheProvider:          Symbol('CacheProvider'),
    Logger:                 Symbol('Logger'),
    PermissionCacheService: Symbol('PermissionCacheService'),

    // HTTP client (Phase 2)
    CoreServiceClient: Symbol('CoreServiceClient'),

    // Messaging (Phase 10)
    MessagePublisher: Symbol('MessagePublisher'),
    MessageConsumer:  Symbol('MessageConsumer'),

    // Orders (Phase 3)
    OrderService:    Symbol('OrderService'),
    OrderController: Symbol('OrderController'),

    // Payments (Phase 4)
    PaymentService:    Symbol('PaymentService'),
    PaymentController: Symbol('PaymentController'),
    PaymentProvider:   Symbol('PaymentProvider'),

    // Delivery agent (Phase 6)
    AgentService:    Symbol('AgentService'),
    AgentController: Symbol('AgentController'),

    // Restaurant orders (Phase 7)
    RestaurantOrderService:    Symbol('RestaurantOrderService'),
    RestaurantOrderController: Symbol('RestaurantOrderController'),

    // Admin (Phase 8)
    AdminService:    Symbol('AdminService'),
    AdminController: Symbol('AdminController'),
};
