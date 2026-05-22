import type { Knex } from 'knex';
import { db } from '../../../lib/knex/knex.js';
import { Transaction } from '../entity/transaction.entity.js';

const COLUMNS = [
    'id', 'region', 'order_id', 'type', 'method',
    'provider_id', 'provider_reference_id', 'status',
    'amount', 'currency', 'src_acc_id', 'dst_acc_id',
    'is_refunded', 'refunded_payment_id', 'idempotency_key',
    'metadata', 'created_at', 'updated_at',
];

function toEntity(row: any): Transaction {
    return new Transaction({
        id:                  row.id,
        region:              row.region,
        orderId:             row.order_id,
        type:                row.type,
        method:              row.method,
        providerId:          row.provider_id,
        providerReferenceId: row.provider_reference_id,
        status:              row.status,
        amount:              row.amount,
        currency:            row.currency,
        srcAccId:            row.src_acc_id,
        dstAccId:            row.dst_acc_id,
        isRefunded:          row.is_refunded,
        refundedPaymentId:   row.refunded_payment_id,
        idempotencyKey:      row.idempotency_key,
        metadata:            row.metadata,
        createdAt:           row.created_at,
        updatedAt:           row.updated_at,
    });
}

export async function findTransactionsByOrderId(
    orderId: number,
    region: string,
): Promise<Transaction[]> {
    const rows = await db(region)('transactions')
        .select(COLUMNS)
        .where({ order_id: orderId })
        .orderBy('created_at', 'asc');
    return rows.map(toEntity);
}

export async function findTransactionById(
    id: number,
    region: string,
): Promise<Transaction | undefined> {
    const row = await db(region)('transactions')
        .select(COLUMNS)
        .where({ id })
        .first();
    return row ? toEntity(row) : undefined;
}

// Targets the single pending charge row created at session init time.
export async function findPendingPaymentByOrderId(
    orderId: number,
    region: string,
    conn?: Knex,
): Promise<Transaction | undefined> {
    const knex = conn ?? db(region);
    const row  = await knex('transactions')
        .select(COLUMNS)
        .where({ order_id: orderId, type: 'charge', status: 'pending' })
        .first();
    return row ? toEntity(row) : undefined;
}

export async function createTransaction(
    data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>,
    region: string,
    conn?: Knex,
): Promise<Transaction> {
    const knex = conn ?? db(region);
    const now  = new Date();
    const [row] = await knex('transactions').insert({
        region,
        order_id:              data.orderId,
        type:                  data.type,
        method:                data.method,
        provider_id:           data.providerId,
        provider_reference_id: data.providerReferenceId,
        status:                data.status,
        amount:                data.amount,
        currency:              data.currency,
        src_acc_id:            data.srcAccId,
        dst_acc_id:            data.dstAccId,
        is_refunded:           data.isRefunded,
        refunded_payment_id:   data.refundedPaymentId,
        idempotency_key:       data.idempotencyKey,
        metadata:              JSON.stringify(data.metadata ?? {}),
        created_at:            now,
        updated_at:            now,
    }).returning(COLUMNS);
    return toEntity(row);
}

export async function updateTransaction(
    id: number,
    region: string,
    updates: Partial<Pick<Transaction,
        | 'status'
        | 'providerReferenceId'
        | 'metadata'
        | 'isRefunded'
        | 'refundedPaymentId'
    >>,
    conn?: Knex,
): Promise<Transaction> {
    const knex    = conn ?? db(region);
    const payload: Record<string, unknown> = { updated_at: new Date() };

    if (updates.status              !== undefined) payload.status               = updates.status;
    if (updates.providerReferenceId !== undefined) payload.provider_reference_id = updates.providerReferenceId;
    if (updates.metadata            !== undefined) payload.metadata             = JSON.stringify(updates.metadata);
    if (updates.isRefunded          !== undefined) payload.is_refunded          = updates.isRefunded;
    if (updates.refundedPaymentId   !== undefined) payload.refunded_payment_id  = updates.refundedPaymentId;

    const [row] = await knex('transactions')
        .where({ id })
        .update(payload)
        .returning(COLUMNS);
    return toEntity(row);
}
