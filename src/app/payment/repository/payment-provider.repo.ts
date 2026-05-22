import { db } from '../../../lib/knex/knex.js';
import { env } from '../../../lib/config/env.js';

export interface PaymentProvider {
    id: number;
    name: string;
    displayName: string;
    isActive: boolean;
}

// payment_providers is a reference table replicated identically to every shard.
// Any region's shard will return the same rows, so we always query the first configured region.
export async function findPaymentProviderByName(name: string): Promise<PaymentProvider | undefined> {
    const region = env.regions[0];
    const row = await db(region)('payment_providers')
        .select(['id', 'name', 'display_name', 'is_active'])
        .where({ name })
        .first();
    if (!row) return undefined;
    return {
        id:          row.id,
        name:        row.name,
        displayName: row.display_name,
        isActive:    row.is_active,
    };
}
