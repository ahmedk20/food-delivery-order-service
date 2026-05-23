import { db } from '../../../lib/knex/knex.js';
import { AgentEarningsEntity } from '../entity/agent-earnings.entity.js';

const COLUMNS = ['id', 'region', 'agent_id', 'order_id', 'delivery_id', 'amount', 'currency', 'status', 'paid_at', 'created_at'];

function toEntity(row: any): AgentEarningsEntity {
    return new AgentEarningsEntity({
        id:         row.id,
        region:     row.region,
        agentId:    row.agent_id,
        orderId:    row.order_id,
        deliveryId: row.delivery_id,
        amount:     row.amount,
        currency:   row.currency,
        status:     row.status,
        paidAt:     row.paid_at ?? null,
        createdAt:  row.created_at,
    });
}

export async function findEarningsByAgentId(
    agentId: number,
    region: string,
    opts: {
        status?: 'pending' | 'paid';
        from?: Date;
        to?: Date;
        cursor?: number;
        limit?: number;
    } = {},
): Promise<AgentEarningsEntity[]> {
    const limit = opts.limit ?? 20;

    let query = db(region)('agent_earnings')
        .select(COLUMNS)
        .where({ agent_id: agentId });

    if (opts.status)        query = query.where({ status: opts.status });
    if (opts.from)          query = query.where('created_at', '>=', opts.from);
    if (opts.to)            query = query.where('created_at', '<=', opts.to);
    if (opts.cursor)        query = query.where('id', '<', opts.cursor);

    const rows = await query.orderBy('id', 'desc').limit(limit + 1);
    return rows.map(toEntity);
}

export interface EarningsTotals {
    currency: string;
    totalAmount: number;
    pendingAmount: number;
    paidAmount: number;
}

export async function getEarningsTotals(
    agentId: number,
    region: string,
    from?: Date,
    to?: Date,
): Promise<EarningsTotals[]> {
    let query = db(region)('agent_earnings')
        .select([
            'currency',
            db(region).raw(`SUM(amount) AS "totalAmount"`),
            db(region).raw(`SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) AS "pendingAmount"`),
            db(region).raw(`SUM(CASE WHEN status = 'paid'    THEN amount ELSE 0 END) AS "paidAmount"`),
        ])
        .where({ agent_id: agentId })
        .groupBy('currency');

    if (from) query = query.where('created_at', '>=', from);
    if (to)   query = query.where('created_at', '<=', to);

    const rows = await query;
    return rows.map((r: any) => ({
        currency:      r.currency,
        totalAmount:   Number(r.totalAmount ?? 0),
        pendingAmount: Number(r.pendingAmount ?? 0),
        paidAmount:    Number(r.paidAmount ?? 0),
    }));
}
