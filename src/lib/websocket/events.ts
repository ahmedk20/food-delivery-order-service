export const WS_EVENTS = {
    ORDER_CREATED:           'order.created',
    ORDER_STATUS_CHANGED:    'order.status_changed',
    ORDER_CANCELLED:         'order.cancelled',
    ORDER_DELIVERY_ASSIGNED: 'order.delivery_assigned',
    AGENT_LOCATION_UPDATED:  'agent.location_updated',
    PAYMENT_COMPLETED:       'payment.completed',
    PAYMENT_FAILED:          'payment.failed',
    TASK_OFFERED:            'task.offered',
    TASK_ASSIGNED:           'task.assigned',
    TASK_CANCELLED:          'task.cancelled',
    OFFER_CANCELLED:         'offer.cancelled',
    ASSIGNMENT_EXHAUSTED:    'assignment.exhausted',
    DELIVERY_STATUS_CHANGED: 'delivery.status_changed',
} as const;

export type WsEvent = typeof WS_EVENTS[keyof typeof WS_EVENTS];

// Room name helpers — kept in one place so services and the WS server
// always construct identical strings and never drift apart.
export const orderRoom           = (orderId: number | string): string => `order:${orderId}`;
export const restaurantBranchRoom = (branchId: number):        string => `branch:${branchId}`;
export const agentRoom           = (agentId: number):          string => `agent:${agentId}`;
export const customerRoom        = (userId: number):           string => `customer:${userId}`;
