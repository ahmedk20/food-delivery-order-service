import type { Knex } from 'knex';
import { db } from '../../../lib/knex/knex.js';
import { Transaction } from '../entity/transaction.entity.js';

const COLUMNS = [
    'id', 'country_code', 'order_id', 'src_acc_id', 'dst_acc_id',
    'amount', 'currency', 'type', 'status', 'payment_provider_id',
    'external_reference', 'kashier_order_id', 'metadata',
    'idempotency_key', 'created_at', 'updated_at',
];

function toEntity(row: any): Transaction {
    return new Transaction({
        id: row.id,
        countryCode: row.country_code,
        orderId: row.order_id,
        srcAccId: row.src_acc_id,
        dstAccId: row.dst_acc_id,
        amount: row.amount,
        currency: row.currency,
        type: row.type,
        status: row.status,
        paymentProviderId: row.payment_provider_id,
        externalReference: row.external_reference,
        kashierOrderId: row.kashier_order_id,
        metadata: row.metadata,
        idempotencyKey: row.idempotency_key,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    });
}

export async function findTransactionByOrderId(
    orderId: number,
    countryCode: string,
): Promise<Transaction | undefined> {
    const row = await db('transactions')
        .select(COLUMNS)
        .where({ order_id: orderId, country_code: countryCode })
        .first();
    return row ? toEntity(row) : undefined;
}

export async function findTransactionByIdempotencyKey(
    key: string,
    countryCode: string,
): Promise<Transaction | undefined> {
    const row = await db('transactions')
        .select(COLUMNS)
        .where({ idempotency_key: key, country_code: countryCode })
        .first();
    return row ? toEntity(row) : undefined;
}

export async function createTransaction(
    data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>,
    conn: Knex = db,
): Promise<Transaction> {
    const now = new Date();
    const [row] = await conn('transactions').insert({
        country_code:        data.countryCode,
        order_id:            data.orderId,
        src_acc_id:          data.srcAccId,
        dst_acc_id:          data.dstAccId,
        amount:              data.amount,
        currency:            data.currency,
        type:                data.type,
        status:              data.status,
        payment_provider_id: data.paymentProviderId,
        external_reference:  data.externalReference,
        kashier_order_id:    data.kashierOrderId,
        metadata:            JSON.stringify(data.metadata),
        idempotency_key:     data.idempotencyKey,
        created_at:          now,
        updated_at:          now,
    }).returning(COLUMNS);
    return toEntity(row);
}

export async function updateTransaction(
    id: number,
    countryCode: string,
    updates: Partial<Pick<Transaction,
        | 'status'
        | 'kashierOrderId'
        | 'idempotencyKey'
        | 'metadata'
    >>,
    conn: Knex = db,
): Promise<Transaction> {
    const payload: Record<string, unknown> = { updated_at: new Date() };

    if (updates.status !== undefined)          payload.status = updates.status;
    if (updates.kashierOrderId !== undefined)  payload.kashier_order_id = updates.kashierOrderId;
    if (updates.idempotencyKey !== undefined)  payload.idempotency_key = updates.idempotencyKey;
    if (updates.metadata !== undefined)        payload.metadata = JSON.stringify(updates.metadata);

    const [row] = await conn('transactions')
        .where({ id, country_code: countryCode })
        .update(payload)
        .returning(COLUMNS);
    return toEntity(row);
}
