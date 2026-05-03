import { db } from '../../../lib/knex/knex.js';

export interface PaymentProvider {
    id: number;
    name: string;
    displayName: string;
    isActive: boolean;
}

export async function findPaymentProviderByName(name: string): Promise<PaymentProvider | undefined> {
    const row = await db('payment_providers')
        .select(['id', 'name', 'display_name', 'is_active'])
        .where({ name })
        .first();
    if (!row) return undefined;
    return {
        id: row.id,
        name: row.name,
        displayName: row.display_name,
        isActive: row.is_active,
    };
}
