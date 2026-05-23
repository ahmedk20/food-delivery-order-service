import type { Knex } from 'knex';
import { db } from '../../../lib/knex/knex.js';

// Minimal write path — owned by the delivery settlement flow.
// Read operations (list, totals) live in app/delivery-agent/repository/agent-earnings.repo.ts (Phase 7).
export async function createAgentEarnings(
    data: {
        agentId: number;
        orderId: number;
        deliveryId: number;
        amount: number;
        currency: string;
        region: string;
    },
    conn?: Knex,
): Promise<void> {
    const knex = conn ?? db(data.region);
    await knex('agent_earnings').insert({
        region:      data.region,
        agent_id:    data.agentId,
        order_id:    data.orderId,
        delivery_id: data.deliveryId,
        amount:      data.amount,
        currency:    data.currency,
        status:      'pending',
        created_at:  new Date(),
    });
}
