export const TOKENS = {
    // Infrastructure
    CacheProvider:          Symbol('CacheProvider'),
    Logger:                 Symbol('Logger'),
    PermissionCacheService: Symbol('PermissionCacheService'),

    // WebSocket server (Phase 5) — services inject ISocketServer, not SocketServer
    SocketServer: Symbol('SocketServer'),

    // HTTP client (Phase 2)
    CoreServiceClient: Symbol('CoreServiceClient'),

    // Messaging (Phase 11)
    MessageBroker: Symbol('MessageBroker'),

    // Orders (Phase 3)
    OrderService:          Symbol('OrderService'),
    OrderController:       Symbol('OrderController'),
    OrderStatusService:    Symbol('OrderStatusService'),
    CoreDataCacheService:  Symbol('CoreDataCacheService'),

    // Payments (Phase 4)
    PaymentService:    Symbol('PaymentService'),
    PaymentController: Symbol('PaymentController'),
    PaymentProvider:   Symbol('PaymentProvider'),

    // Delivery (Phase 6)
    DeliveryService:    Symbol('DeliveryService'),
    DeliveryController: Symbol('DeliveryController'),

    // Delivery agent (Phase 7)
    AgentService:    Symbol('AgentService'),
    AgentController: Symbol('AgentController'),

    // Restaurant orders (Phase 8)
    RestaurantOrderService:    Symbol('RestaurantOrderService'),
    RestaurantOrderController: Symbol('RestaurantOrderController'),

    // Admin (Phase 9)
    AdminService:    Symbol('AdminService'),
    AdminController: Symbol('AdminController'),

    // Finance
    FinanceService: Symbol('FinanceService'),
};
