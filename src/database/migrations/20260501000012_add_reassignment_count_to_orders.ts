import type { Knex } from 'knex';

// Adds reassignment_count to orders so MaxReassignmentAttemptsReached can be guarded
// without a full delivery-history query. Updated atomically by the delivery service
// each time a reassignment occurs.
export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS reassignment_count INT NOT NULL DEFAULT 0
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`
        ALTER TABLE orders
        DROP COLUMN IF EXISTS reassignment_count
    `);
}
