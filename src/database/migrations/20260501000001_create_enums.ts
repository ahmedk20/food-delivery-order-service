import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TYPE order_status AS ENUM (
            'pending',
            'confirmed',
            'preparing',
            'ready_for_pickup',
            'picked_up',
            'on_the_way',
            'delivered',
            'cancelled',
            'failed'
        )
    `);

    await knex.raw(`
        CREATE TYPE payment_method AS ENUM (
            'online',
            'cash'
        )
    `);

    await knex.raw(`
        CREATE TYPE transaction_type AS ENUM (
            'payment',
            'payout',
            'refund',
            'penalty',
            'adjustment',
            'fee'
        )
    `);

    await knex.raw(`
        CREATE TYPE transaction_status AS ENUM (
            'pending',
            'completed',
            'failed',
            'reversed'
        )
    `);

    await knex.raw(`
        CREATE TYPE earnings_status AS ENUM (
            'pending',
            'paid'
        )
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TYPE IF EXISTS earnings_status`);
    await knex.raw(`DROP TYPE IF EXISTS transaction_status`);
    await knex.raw(`DROP TYPE IF EXISTS transaction_type`);
    await knex.raw(`DROP TYPE IF EXISTS payment_method`);
    await knex.raw(`DROP TYPE IF EXISTS order_status`);
}
