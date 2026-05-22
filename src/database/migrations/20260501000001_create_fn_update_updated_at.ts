import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE OR REPLACE FUNCTION fn_update_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP FUNCTION IF EXISTS fn_update_updated_at() CASCADE`);
}
