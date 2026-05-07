export const WS_EVENTS = {
    ORDER_STATUS_CHANGED: 'order:status_changed',
    ORDER_NEW:            'order:new',
    ORDER_AGENT_ASSIGNED: 'order:agent_assigned',
    AGENT_LOCATION:       'agent:location_updated',
    PAYMENT_COMPLETED:    'payment:completed',
} as const;

export type WsEvent = typeof WS_EVENTS[keyof typeof WS_EVENTS];

export const orderRoom = (orderId: number): string => `order:${orderId}`;
export const restaurantBranchRoom = (branchId: number): string => `restaurant:branch:${branchId}`;
export const agentRoom = (agentId: number): string => `agent:${agentId}`;
