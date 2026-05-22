import type { Knex } from 'knex';

// FK to orders is logical only — orders is a partitioned table; a DB-level FK cannot be
// enforced without including the partition key (created_at) in the FK column list.
// Referential integrity is guaranteed by the service layer (orders row always created first,
// inside the same transaction as order_items).
// No index on product_id — this service never queries items by product.
export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE order_items (
            id                  BIGSERIAL NOT NULL,
            region              TEXT      NOT NULL,
            order_id            BIGINT    NOT NULL,
            product_id          BIGINT    NOT NULL,
            name_snapshot       TEXT      NOT NULL,
            image_url_snapshot  TEXT,
            unit_price_snapshot INT       NOT NULL CHECK (unit_price_snapshot >= 0),
            quantity            SMALLINT  NOT NULL CHECK (quantity > 0),
            line_total          INT       NOT NULL CHECK (line_total >= 0),
            notes               TEXT,
            created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
            PRIMARY KEY (id)
        )
    `);

    // Batch fetch all items for one or many orders
    await knex.raw(`CREATE INDEX idx_order_items_order_id ON order_items (order_id)`);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TABLE IF EXISTS order_items`);
}
