import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../../../lib/di/tokens.js';
import { db } from '../../../lib/knex/knex.js';
import AppError from '../../../lib/error/AppError.js';
import { SystemRole } from '../../../lib/auth/enums.js';
import { parsePaginationQuery, parseFilters } from '../../../lib/http/pagination/parse-query.js';
import type { ICacheProvider } from '../../../pkg/cache/cache.interface.js';
import type { OrderService } from '../../order/service/order.service.js';
import type { UpdateOrderStatusDTO } from '../../order/dto/update-order-status.dto.js';
import type { OrderResponseDTO } from '../../order/dto/order-response.dto.js';
import type { OrderListItemDTO } from '../../order/dto/order-list-item.dto.js';
import { findAllOrders, type AdminOrderFilterField, type OrderSortField } from '../../order/repository/order.repo.js';
import { findAllTransactions, type AdminTxFilterField } from '../../payment/repository/transaction.repo.js';
import {
    findAllRestaurantBalances,
    payoutFromAvailableBalance,
    type RestaurantBalance,
} from '../../payment/repository/restaurant-balance.repo.js';
import { createTransaction } from '../../payment/repository/transaction.repo.js';
import type { TransactionResponseDTO } from '../../payment/dto/transaction-response.dto.js';
import type { Transaction } from '../../payment/entity/transaction.entity.js';
import type { CreatePayoutDTO } from '../dto/create-payout.dto.js';
import type { PaginationMeta } from '../../../lib/http/response.js';

const MAX_OUTBOX_ATTEMPTS = 5;

const GEO_SET_KEY        = (region: string) => `presence:geo:${region}`;
const META_KEY           = (region: string, agentId: number) => `presence:meta:${region}:${agentId}`;
const BUSY_SET_KEY       = (region: string) => `presence:busy:${region}`;
const BALANCE_CACHE_TTL  = 5;
const balanceCacheKey    = (region: string, restaurantId: number) => `${region}:os:balance:${restaurantId}`;

export interface DeadLetterRow {
    id: number;
    eventType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    attempts: number;
    lastError: string | null;
    createdAt: Date;
}

export interface AgentPresenceItem {
    agentId: number;
    isOnline: boolean;
    isBusy: boolean;
    lat: number | null;
    lng: number | null;
    lastSeenAt: string | null;
}

function toTransactionResponseDTO(tx: Transaction): TransactionResponseDTO {
    return {
        id:                  tx.id,
        orderPublicId:       null,
        amount:              tx.amount,
        currency:            tx.currency,
        type:                tx.type,
        status:              tx.status,
        providerReferenceId: tx.providerReferenceId,
        createdAt:           tx.createdAt,
    };
}

@injectable()
export class AdminService {
    constructor(
        @inject(TOKENS.CacheProvider) private readonly cache: ICacheProvider,
        @inject(TOKENS.OrderService)  private readonly orderService: OrderService,
    ) {}

    listAllOrders = async (
        region: string,
        query: Record<string, any>,
    ): Promise<{ data: OrderListItemDTO[]; meta: PaginationMeta }> => {
        const pagination = parsePaginationQuery<Record<string, any>, OrderSortField>(
            query, ['id'], 'id',
        );
        const filters = parseFilters<Record<string, any>, AdminOrderFilterField>(
            query, ['status', 'customer_id', 'restaurant_id', 'branch_id', 'delivery_agent_id'],
        );

        const result = await findAllOrders(region, pagination, filters);
        return {
            data: result.data.map(o => ({
                id:            o.publicId,
                restaurantId:  o.restaurantId,
                branchId:      o.branchId,
                status:        o.status,
                paymentMethod: o.paymentMethod,
                subtotal:      o.subtotal,
                deliveryFee:   o.deliveryFee,
                serviceFee:    o.serviceFee,
                total:         o.total,
                currency:      o.currency,
                itemsCount:    0,
                createdAt:     o.createdAt,
            })),
            meta: result.meta,
        };
    };

    listAllTransactions = async (
        region: string,
        query: Record<string, any>,
    ): Promise<{ data: TransactionResponseDTO[]; meta: PaginationMeta }> => {
        const pagination = parsePaginationQuery<Record<string, any>, 'id'>(
            query, ['id'], 'id',
        );
        const filters = parseFilters<Record<string, any>, AdminTxFilterField>(
            query, ['type', 'status', 'order_id'],
        );

        const result = await findAllTransactions(region, pagination, filters);
        return {
            data: result.data.map(toTransactionResponseDTO),
            meta: result.meta,
        };
    };

    listRestaurantBalances = async (
        region: string,
        query: Record<string, any>,
    ): Promise<{ data: RestaurantBalance[]; meta: PaginationMeta }> => {
        const limit        = Math.min(Number(query.limit) || 20, 100);
        const cursor       = query.cursor ? Number(query.cursor) : undefined;
        const restaurantId = query.restaurantId ? Number(query.restaurantId) : undefined;

        if (restaurantId !== undefined) {
            const cacheKey = balanceCacheKey(region, restaurantId);
            try {
                const cached = await this.cache.get(cacheKey);
                if (cached) return JSON.parse(cached);
            } catch { /* Redis down */ }

            const result = await findAllRestaurantBalances(region, { restaurantId, cursor, limit });
            this.cache.set(cacheKey, JSON.stringify(result), BALANCE_CACHE_TTL).catch(() => {});
            return result;
        }

        return findAllRestaurantBalances(region, { restaurantId, cursor, limit });
    };

    listAgentsWithPresence = async (
        region: string,
        query: Record<string, any>,
    ): Promise<{ data: AgentPresenceItem[]; meta: PaginationMeta }> => {
        const limit  = Math.min(Number(query.limit) || 20, 100);
        const cursor = query.cursor ? Number(query.cursor) : undefined;

        const isOnlineFilter   = query.isOnline   !== undefined ? query.isOnline   === 'true' : undefined;
        const isAvailableFilter = query.isAvailable !== undefined ? query.isAvailable === 'true' : undefined;

        // Pull all agent IDs from the geo set and the busy set in parallel
        const [geoMembers, busyMembers] = await Promise.all([
            this.cache.zMembers(GEO_SET_KEY(region)).catch(() => [] as string[]),
            this.cache.sMembers(BUSY_SET_KEY(region)).catch(() => [] as string[]),
        ]);

        const busySet = new Set(busyMembers);

        // Resolve presence meta for each geo member in parallel
        const items = await Promise.all(
            geoMembers.map(async (idStr): Promise<AgentPresenceItem> => {
                const agentId = Number(idStr);
                const isBusy  = busySet.has(idStr);
                let metaRaw: string | null = null;
                try {
                    metaRaw = await this.cache.get(META_KEY(region, agentId));
                } catch { /* Redis down — treat as offline */ }

                const isOnline = metaRaw !== null;
                let lat: number | null  = null;
                let lng: number | null  = null;
                let lastSeenAt: string | null = null;

                if (metaRaw) {
                    try {
                        const meta = JSON.parse(metaRaw) as { lat: number; lng: number; lastSeenAt: string };
                        lat        = meta.lat;
                        lng        = meta.lng;
                        lastSeenAt = meta.lastSeenAt;
                    } catch { /* malformed meta */ }
                }

                return { agentId, isOnline, isBusy, lat, lng, lastSeenAt };
            }),
        );

        // Apply filters
        let filtered = items;
        if (isOnlineFilter !== undefined)    filtered = filtered.filter(a => a.isOnline === isOnlineFilter);
        if (isAvailableFilter !== undefined) filtered = filtered.filter(a => (a.isOnline && !a.isBusy) === isAvailableFilter);

        // Sort by agentId ascending and apply cursor pagination
        filtered.sort((a, b) => a.agentId - b.agentId);
        if (cursor !== undefined) {
            filtered = filtered.filter(a => a.agentId > cursor);
        }

        const hasMore    = filtered.length > limit;
        const page       = filtered.slice(0, limit);
        const nextCursor = hasMore ? page[page.length - 1].agentId : null;

        return {
            data: page,
            meta: { hasMore, nextCursor, count: page.length },
        };
    };

    listDeadLetterOutbox = async (
        region: string,
        query: Record<string, any>,
    ): Promise<{ data: DeadLetterRow[]; meta: PaginationMeta }> => {
        const limit  = Math.min(Number(query.limit) || 20, 100);
        const cursor = query.cursor ? Number(query.cursor) : undefined;

        let q = db(region)('outbox')
            .select(['id', 'event_type', 'aggregate_id', 'payload', 'attempts', 'last_error', 'created_at'])
            .where('attempts', '>=', MAX_OUTBOX_ATTEMPTS)
            .whereNull('dispatched_at')
            .orderBy('created_at', 'asc')
            .limit(limit + 1);

        if (cursor !== undefined) {
            q = q.where('id', '>', cursor);
        }

        const rows = await q;
        const hasMore    = rows.length > limit;
        const page       = rows.slice(0, limit);
        const nextCursor = hasMore ? page[page.length - 1].id : null;

        return {
            data: page.map((r: any) => ({
                id:          r.id,
                eventType:   r.event_type,
                aggregateId: r.aggregate_id,
                payload:     r.payload,
                attempts:    r.attempts,
                lastError:   r.last_error,
                createdAt:   r.created_at,
            })),
            meta: { hasMore, nextCursor, count: page.length },
        };
    };

    forceUpdateOrderStatus = async (
        publicId: string,
        region: string,
        actorId: number,
        dto: UpdateOrderStatusDTO,
    ): Promise<OrderResponseDTO> => {
        return this.orderService.updateOrderStatus(
            publicId, region, actorId, SystemRole.SYSTEM_ADMIN, dto,
        );
    };

    createPayout = async (
        region: string,
        actorId: number,
        dto: CreatePayoutDTO,
    ): Promise<{ payoutId: number; amount: number; currency: string; status: string }> => {
        const trx = await db(region).transaction();
        try {
            const success = await payoutFromAvailableBalance(
                dto.restaurantId, region, dto.amount, dto.currency, trx,
            );
            if (!success) {
                await trx.rollback();
                throw new AppError('InsufficientBalance', 409);
            }

            const payout = await createTransaction({
                region,
                orderId:             null,
                type:                'payout',
                method:              'bank_transfer',
                providerId:          null,
                providerReferenceId: dto.providerReferenceId,
                status:              'pending',
                amount:              dto.amount,
                currency:            dto.currency,
                srcAccId:            dto.restaurantId,
                dstAccId:            null,
                isRefunded:          false,
                refundedPaymentId:   null,
                idempotencyKey:      null,
                metadata:            { note: dto.note ?? null, initiatedBy: actorId },
            }, region, trx);

            await trx.commit();

            this.cache.delete(balanceCacheKey(region, dto.restaurantId)).catch(() => {});

            return {
                payoutId: payout.id,
                amount:   payout.amount,
                currency: payout.currency,
                status:   payout.status,
            };
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    };
}
