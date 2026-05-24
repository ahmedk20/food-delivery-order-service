export const TOKENS = {
    // Infrastructure
    CacheProvider:          Symbol('CacheProvider'),
    Logger:                 Symbol('Logger'),
    PermissionCacheService: Symbol('PermissionCacheService'),

    // WebSocket server — services inject ISocketServer, not SocketServer
    SocketServer: Symbol('SocketServer'),

    // Core-service domain clients — each service injects only the client(s) it needs
    ProductClient: Symbol('ProductClient'),
    BranchClient:  Symbol('BranchClient'),
    AddressClient: Symbol('AddressClient'),
    UserClient:    Symbol('UserClient'),
    RbacClient:    Symbol('RbacClient'),

    // Messaging
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
    SettlementService:  Symbol('SettlementService'),

    // Assignment (Phase 6b) — offer/claim/reject worker flow
    AssignmentService: Symbol('AssignmentService'),

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
    FinanceService:    Symbol('FinanceService'),
    FinanceController: Symbol('FinanceController'),
};
