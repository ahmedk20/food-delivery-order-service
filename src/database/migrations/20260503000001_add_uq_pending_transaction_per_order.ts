import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    // Ensures at most one pending payment session exists per order, making
    // webhook lookups by order_id deterministic.
    await knex.raw(`
        CREATE UNIQUE INDEX uq_transactions_pending_order
        ON transactions(order_id, country_code)
        WHERE status = 'pending'
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP INDEX IF EXISTS uq_transactions_pending_order`);
}
