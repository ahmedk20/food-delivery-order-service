import type { Knex } from 'knex';
import { db } from '../../../lib/knex/knex.js';

export interface RestaurantBalance {
    restaurantId: number;
    region: string;
    currency: string;
    availableBalance: number;
    pendingBalance: number;
    totalEarned: number;
    createdAt: Date;
    updatedAt: Date;
}

const COLUMNS = [
    'restaurant_id', 'region', 'currency',
    'available_balance', 'pending_balance', 'total_earned',
    'created_at', 'updated_at',
];

function toEntity(row: any): RestaurantBalance {
    return {
        restaurantId:     row.restaurant_id,
        region:           row.region,
        currency:         row.currency,
        availableBalance: row.available_balance,
        pendingBalance:   row.pending_balance,
        totalEarned:      row.total_earned,
        createdAt:        row.created_at,
        updatedAt:        row.updated_at,
    };
}

// Credit restaurant's pending_balance and total_earned on payment confirmation.
// Amount should be order.subtotal — delivery_fee stays with the platform.
// Atomic UPSERT: ON CONFLICT acquires a row-level lock, no separate SELECT … FOR UPDATE needed.
export async function creditRestaurantBalance(
    restaurantId: number,
    region: string,
    amount: number,
    currency: string,
    conn: Knex,
): Promise<void> {
    await conn.raw(`
        INSERT INTO restaurant_balances
            (restaurant_id, region, currency, pending_balance, total_earned, created_at, updated_at)
        VALUES
            (:restaurantId, :region, :currency, :amount, :amount, NOW(), NOW())
        ON CONFLICT (restaurant_id, currency) DO UPDATE
        SET
            pending_balance = restaurant_balances.pending_balance + EXCLUDED.pending_balance,
            total_earned    = restaurant_balances.total_earned    + EXCLUDED.total_earned,
            updated_at      = NOW()
    `, { restaurantId, region, currency, amount });
}

// Reverse a previous credit on refund. Drains pending_balance first, then available_balance.
// PostgreSQL evaluates the original column values for all SET expressions in a single UPDATE,
// so GREATEST/GREATEST arithmetic here is safe against negative balances.
export async function debitRestaurantBalance(
    restaurantId: number,
    region: string,
    amount: number,
    currency: string,
    conn: Knex,
): Promise<void> {
    await conn.raw(`
        UPDATE restaurant_balances
        SET
            pending_balance   = GREATEST(pending_balance - :amount, 0),
            available_balance = available_balance - GREATEST(:amount - pending_balance, 0),
            total_earned      = total_earned - :amount,
            updated_at        = NOW()
        WHERE restaurant_id = :restaurantId AND currency = :currency
    `, { restaurantId, currency, amount });
}

// Move amount from pending_balance to available_balance (minus commission) on delivery settlement.
// Uses a locked UPDATE — caller must hold a transaction.
export async function settleRestaurantBalance(
    restaurantId: number,
    region: string,
    amount: number,
    commission: number,
    currency: string,
    conn: Knex,
): Promise<void> {
    await conn.raw(`
        UPDATE restaurant_balances
        SET
            pending_balance   = pending_balance - :amount,
            available_balance = available_balance + (:amount - :commission),
            updated_at        = NOW()
        WHERE restaurant_id = :restaurantId AND currency = :currency
    `, { restaurantId, amount, commission, currency });
}

// List all restaurant balances, optionally filtered by restaurantId.
// Paginated by restaurant_id (ascending).
export async function findAllRestaurantBalances(
    region: string,
    opts: { restaurantId?: number; cursor?: number; limit: number },
): Promise<{ data: RestaurantBalance[]; meta: { hasMore: boolean; nextCursor: number | null; count: number } }> {
    let query = db(region)('restaurant_balances').select(COLUMNS).orderBy('restaurant_id', 'asc');

    if (opts.restaurantId !== undefined) {
        query = query.where({ restaurant_id: opts.restaurantId });
    }
    if (opts.cursor !== undefined) {
        query = query.where('restaurant_id', '>=', opts.cursor);
    }

    query = query.limit(opts.limit + 1);

    const rows = await query;
    const hasMore    = rows.length > opts.limit;
    const data       = rows.slice(0, opts.limit).map(toEntity);
    const nextCursor = hasMore ? data[data.length - 1].restaurantId : null;
    return { data, meta: { hasMore, nextCursor, count: data.length } };
}

// Deduct from available_balance in one atomic UPDATE.
// Returns true if the update happened (balance was sufficient), false if not.
export async function payoutFromAvailableBalance(
    restaurantId: number,
    region: string,
    amount: number,
    currency: string,
    conn: Knex,
): Promise<boolean> {
    const result = await conn.raw(`
        UPDATE restaurant_balances
        SET available_balance = available_balance - :amount,
            updated_at        = NOW()
        WHERE restaurant_id     = :restaurantId
          AND currency          = :currency
          AND available_balance >= :amount
    `, { restaurantId, currency, amount });
    return result.rowCount > 0;
}

export async function findRestaurantBalance(
    restaurantId: number,
    region: string,
): Promise<RestaurantBalance | undefined> {
    const row = await db(region)('restaurant_balances')
        .select(COLUMNS)
        .where({ restaurant_id: restaurantId })
        .first();
    return row ? toEntity(row) : undefined;
}
