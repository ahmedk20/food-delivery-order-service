import { db } from '../src/lib/knex/knex.js';

async function main() {
    const tables = await db.raw(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
    `);

    const enums = await db.raw(`
        SELECT typname
        FROM pg_type
        WHERE typcategory = 'E'
        ORDER BY typname
    `);

    const indexes = await db.raw(`
        SELECT indexname, tablename
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname NOT LIKE '%_pkey'
        ORDER BY tablename, indexname
    `);

    const triggers = await db.raw(`
        SELECT trigger_name, event_object_table
        FROM information_schema.triggers
        WHERE trigger_schema = 'public'
        ORDER BY event_object_table
    `);

    console.log('\n=== TABLES ===');
    tables.rows.forEach((r: any) => console.log(' ', r.table_name));

    console.log('\n=== ENUMS ===');
    enums.rows.forEach((r: any) => console.log(' ', r.typname));

    console.log('\n=== INDEXES ===');
    indexes.rows.forEach((r: any) => console.log(` ${r.tablename}.${r.indexname}`));

    console.log('\n=== TRIGGERS ===');
    triggers.rows.forEach((r: any) => console.log(` ${r.event_object_table}.${r.trigger_name}`));

    await db.destroy();
}

main().catch(err => { console.error(err); process.exit(1); });
