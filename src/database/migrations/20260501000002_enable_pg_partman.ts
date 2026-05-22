import type { Knex } from 'knex';

// pg_partman manages monthly range partitions. Must run before any partitioned-table migration.
export async function up(knex: Knex): Promise<void> {
    await knex.raw(`CREATE SCHEMA IF NOT EXISTS partman`);
    await knex.raw(`CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman`);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP EXTENSION IF EXISTS pg_partman`);
    await knex.raw(`DROP SCHEMA IF EXISTS partman CASCADE`);
}
