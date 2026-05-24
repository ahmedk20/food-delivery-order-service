/**
 * Run knex migrate:latest across every region configured in REGIONS env var.
 * Usage: REGIONS=eg,ksa tsx scripts/migrate-all.ts
 */
import { config } from 'dotenv';
import path from 'path';
import { execSync } from 'child_process';

config({ path: path.resolve(process.cwd(), '.env.dev') });

const regions = (process.env.REGIONS ?? '').split(',').map(r => r.trim()).filter(Boolean);

if (regions.length === 0) {
    console.error('Error: REGIONS env var is empty or missing');
    process.exit(1);
}

const knexBin    = path.resolve('node_modules', 'knex', 'bin', 'cli.js');
const knexfile   = path.resolve('src', 'lib', 'knex', 'knexfile.ts');
const command    = `tsx ${knexBin} --knexfile ${knexfile} migrate:latest`;

let failed = false;

for (const region of regions) {
    console.log(`\n── Migrating region: ${region} ──`);
    try {
        execSync(command, {
            stdio: 'inherit',
            env:   { ...process.env, REGION: region, APP_STAGE: process.env.APP_STAGE ?? 'dev' },
        });
        console.log(`✓ ${region} migration complete`);
    } catch {
        console.error(`✗ ${region} migration FAILED`);
        failed = true;
    }
}

if (failed) {
    console.error('\nOne or more regions failed to migrate.');
    process.exit(1);
}

console.log('\nAll regions migrated successfully.');
