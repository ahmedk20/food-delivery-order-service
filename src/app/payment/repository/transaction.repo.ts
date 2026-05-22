import type { Knex } from 'knex';
import { db } from '../../../lib/knex/knex.js';
import { Transaction } from '../entity/transaction.entity.js';

const COLUMNS = [
    'id', 'region', 'order_id', 'src_acc_id', 'dst_acc_id',
    'amount', 'currency', 'type', 'status', 'payment_provider_id',
    'external_reference', 'kashier_order_id', 'metadata',
    'created_at', 'updated_at',
];

function toEntity(row: any): Transaction {
    return new Transaction({
        id:                row.id,
        region:            row.region,
        orderId:           row.order_id,
        srcAccId:          row.src_acc_id,
        dstAccId:          row.dst_acc_id,
        amount:            row.amount,
        currency:          row.currency,
        type:              row.type,
        status:            row.status,
        paymentProviderId: row.payment_provider_id,
        externalReference: row.external_reference,
        kashierOrderId:    row.kashier_order_id,
        metadata:          row.metadata,
        createdAt:         row.created_at,
        updatedAt:         row.updated_at,
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

export async function findPendingPaymentByOrderId(
    orderId: number,
    region: string,
    conn?: Knex,
): Promise<Transaction | undefined> {
    const knex = conn ?? db(region);
    const row  = await knex('transactions')
        .select(COLUMNS)
        .where({ order_id: orderId, type: 'payment', status: 'pending' })
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
        metadata:            JSON.stringify(data.metadata ?? {}),
        created_at:          now,
        updated_at:          now,
    }).returning(COLUMNS);
    return toEntity(row);
}

export async function updateTransaction(
    id: number,
    region: string,
    updates: Partial<Pick<Transaction,
        | 'status'
        | 'externalReference'
        | 'kashierOrderId'
        | 'metadata'
    >>,
    conn?: Knex,
): Promise<Transaction> {
    const knex    = conn ?? db(region);
    const payload: Record<string, unknown> = { updated_at: new Date() };

    if (updates.status            !== undefined) payload.status             = updates.status;
    if (updates.externalReference !== undefined) payload.external_reference = updates.externalReference;
    if (updates.kashierOrderId    !== undefined) payload.kashier_order_id   = updates.kashierOrderId;
    if (updates.metadata          !== undefined) payload.metadata           = JSON.stringify(updates.metadata);

    const [row] = await knex('transactions')
        .where({ id })
        .update(payload)
        .returning(COLUMNS);
    return toEntity(row);
}
