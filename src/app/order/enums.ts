export type OrderStatus =
    | 'pending_payment'
    | 'placed'
    | 'accepted'
    | 'rejected'
    | 'preparing'
    | 'ready'
    | 'assigned'
    | 'picked'
    | 'delivered'
    | 'cancelled';

export type PaymentMethod = 'online' | 'cod';
