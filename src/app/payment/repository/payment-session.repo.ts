import type { Knex } from 'knex';
import { db } from '../../../lib/knex/knex.js';
import { PaymentSessionEntity, type PaymentSessionStatus } from '../entity/payment-session.entity.js';

const COLUMNS = [
    'id', 'region', 'order_id', 'provider_id', 'provider_session_id',
    'session_url', 'amount', 'currency', 'status', 'expires_at',
    'created_at', 'updated_at',
] as const;

function toEntity(row: any): PaymentSessionEntity {
    return new PaymentSessionEntity({
        id:                row.id,
        region:            row.region,
        orderId:           Number(row.order_id),
        providerId:        row.provider_id ?? null,
        providerSessionId: row.provider_session_id,
        sessionUrl:        row.session_url,
        amount:            row.amount,
        currency:          row.currency,
        status:            row.status,
        expiresAt:         row.expires_at,
        createdAt:         row.created_at,
        updatedAt:         row.updated_at,
    });
}

export type CreatePaymentSessionInput = {
    region:            string;
    orderId:           number;
    providerId:        number | null;
    providerSessionId: string;
    sessionUrl:        string;
    amount:            number;
    currency:          string;
    expiresAt:         Date;
};

export async function createPaymentSession(
    input: CreatePaymentSessionInput,
    region: string,
    conn?: Knex,
): Promise<PaymentSessionEntity> {
    const knex = conn ?? db(region);
    const [row] = await knex('payment_sessions')
        .insert({
            region:              input.region,
            order_id:            input.orderId,
            provider_id:         input.providerId,
            provider_session_id: input.providerSessionId,
            session_url:         input.sessionUrl,
            amount:              input.amount,
            currency:            input.currency,
            expires_at:          input.expiresAt,
        })
        .returning(COLUMNS);
    return toEntity(row);
}

export async function findSessionByProviderSessionId(
    providerSessionId: string,
    region: string,
): Promise<PaymentSessionEntity | undefined> {
    const row = await db(region)('payment_sessions')
        .select(COLUMNS)
        .where({ provider_session_id: providerSessionId })
        .first();
    return row ? toEntity(row) : undefined;
}

export async function findSessionsByOrderId(
    orderId: number,
    region: string,
): Promise<PaymentSessionEntity[]> {
    const rows = await db(region)('payment_sessions')
        .select(COLUMNS)
        .where({ order_id: orderId })
        .orderBy('created_at', 'desc');
    return rows.map(toEntity);
}

export async function updatePaymentSessionStatus(
    id: number,
    region: string,
    status: PaymentSessionStatus,
    conn?: Knex,
): Promise<void> {
    const knex = conn ?? db(region);
    await knex('payment_sessions').where({ id }).update({ status, updated_at: new Date() });
}
