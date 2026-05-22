import { type Knex } from 'knex';
import { getHotShard, getArchiveShard } from './shards.js';

// db(region) is the primary query interface for all sharded tables.
// Always pass region from req.region — never hardcode a string.
export function db(region: string): Knex {
    return getHotShard(region);
}

// dbArchive(region) targets the read-replica / cold-storage cluster.
// Use only for historical reporting queries, never for writes.
export function dbArchive(region: string): Knex {
    return getArchiveShard(region);
}

export { destroyAllShards, pingAll } from './shards.js';
