import type { Knex } from 'knex';

// agent_presence table removed — presence is tracked entirely in Redis.
// presence:geo:{region}  — geo sorted set for GEOSEARCH at assignment time
// presence:meta:{region}:{agentId}  — hash with TTL; key existence = agent online
// presence:busy:{region}  — set of agent IDs with an active delivery
export async function up(_knex: Knex): Promise<void> {}

export async function down(_knex: Knex): Promise<void> {}
