import type { OrderResponseDTO, OrderSummaryResponseDTO, OrderItemResponseDTO } from '../../app/order/dto/order-response.dto.js';
import type { OrderListItemDTO } from '../../app/order/dto/order-list-item.dto.js';
import type { DeliveryResponseDTO } from '../../app/delivery/dto/delivery-response.dto.js';

export function makeOrderItem(overrides: Partial<OrderItemResponseDTO> = {}): OrderItemResponseDTO {
    return {
        id:              1,
        productId:       10,
        productName:     'Shawarma Wrap',
        productImageUrl: 'https://img.test/shawarma.jpg',
        unitPrice:       5000,
        quantity:        2,
        subtotal:        10000,
        notes:           null,
        ...overrides,
    };
}

export function makeOrderResponse(overrides: Partial<OrderResponseDTO> = {}): OrderResponseDTO {
    return {
        id:                      'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        restaurantId:            1,
        branchId:                1,
        status:                  'placed',
        paymentMethod:           'cod',
        subtotal:                10000,
        deliveryFee:             0,
        serviceFee:              0,
        discount:                0,
        commission:              0,
        total:                   10000,
        currency:                'EGP',
        notes:                   null,
        estimatedDeliveryAt:     null,
        deliveredAt:             null,
        cancelledAt:             null,
        createdAt:               new Date('2026-01-15T10:00:00Z'),
        deliveryAddressSnapshot: {
            id: 1, label: 'Home', country: 'EG', city: 'Cairo',
            street: '123 Test St', building: '5', apartmentNumber: '3A',
            type: 'apartment', lat: 30.05, lng: 31.23,
        },
        cancellationReason:      null,
        items:                   [makeOrderItem()],
        ...overrides,
    };
}

export function makeOrderListItem(overrides: Partial<OrderListItemDTO> = {}): OrderListItemDTO {
    return {
        id:            'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        restaurantId:  1,
        branchId:      1,
        status:        'placed',
        paymentMethod: 'cod',
        subtotal:      10000,
        deliveryFee:   0,
        serviceFee:    0,
        total:         10000,
        currency:      'EGP',
        itemsCount:    2,
        createdAt:     new Date('2026-01-15T10:00:00Z'),
        ...overrides,
    };
}

export function makeDeliveryResponse(overrides: Partial<DeliveryResponseDTO> = {}): DeliveryResponseDTO {
    return {
        id:              1,
        orderId:         'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        agentId:         200,
        status:          'assigned',
        pickup:          { lat: null, lng: null },
        dropoff:         { lat: 30.05, lng: 31.23 },
        distanceMeters:  null,
        earningAmount:   null,
        currency:        'EGP',
        assignedAt:      '2026-01-15T10:30:00.000Z',
        acceptedAt:      null,
        rejectedAt:      null,
        pickedAt:        null,
        deliveredAt:     null,
        cancelledAt:     null,
        reassignedAt:    null,
        rejectionReason: null,
        createdAt:       '2026-01-15T10:30:00.000Z',
        ...overrides,
    };
}

export function makeTransactionResponse(overrides: Record<string, unknown> = {}) {
    return {
        id:                  1,
        orderPublicId:       'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        amount:              10000,
        currency:            'EGP',
        type:                'charge',
        status:              'succeeded',
        providerReferenceId: 'kashier-ref-123',
        createdAt:           new Date('2026-01-15T10:05:00Z'),
        ...overrides,
    };
}

export function makeBalanceResponse(overrides: Record<string, unknown> = {}) {
    return {
        restaurantId:     1,
        currency:         'EGP',
        availableBalance: 50000,
        pendingBalance:   10000,
        totalEarned:      150000,
        updatedAt:        '2026-01-15T12:00:00.000Z',
        ...overrides,
    };
}

export function makeEarningsResponse(overrides: Record<string, unknown> = {}) {
    return {
        data: [
            { id: 1, orderId: 'uuid-1', amount: 3000, currency: 'EGP', status: 'pending', createdAt: '2026-01-15T11:00:00.000Z' },
        ],
        totals: [{ currency: 'EGP', totalEarned: 15000, totalPaid: 12000, totalPending: 3000 }],
        ...overrides,
    };
}

export function makeTaskResponse(overrides: Record<string, unknown> = {}) {
    return {
        deliveryId:    1,
        orderPublicId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        status:        'assigned',
        dropoff:       { lat: 30.05, lng: 31.23 },
        assignedAt:    '2026-01-15T10:30:00.000Z',
        ...overrides,
    };
}
