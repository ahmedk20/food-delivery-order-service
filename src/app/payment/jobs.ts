import { env } from '../../lib/config/env.js';
import { db } from '../../lib/knex/knex.js';
import logger from '../../lib/logger/logger.js';
import { updateOrderStatus } from '../order/repository/order.repo.js';
import type { Job } from '../../lib/jobs/job.types.js';

async function sweepExpiredSessions(region: string): Promise<void> {
    const cutoff = new Date(Date.now() - env.payment.sessionTimeoutMin * 60_000);

    const rows: { id: number }[] = await db(region)('orders')
        .where({ status: 'pending_payment' })
        .where('created_at', '<', cutoff)
        .select('id');

    if (rows.length === 0) return;

    for (const row of rows) {
        await updateOrderStatus(row.id, region, 'cancelled', {
            cancelledAt:        new Date(),
            cancellationReason: 'payment_session_timeout',
        });
    }

    logger.info('Payment session sweep cancelled stale orders', { region, count: rows.length });
}

export function createPaymentSweepJobs(regions: string[]): Job[] {
    return regions.map(region => ({
        name:       `payment-sweep:${region}`,
        intervalMs: 60_000,
        handler:    () => sweepExpiredSessions(region),
    }));
}
