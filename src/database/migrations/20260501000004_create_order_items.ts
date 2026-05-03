import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE order_items (
            id                BIGSERIAL   NOT NULL,
            order_id          BIGINT      NOT NULL,
            country_code      CHAR(2)     NOT NULL,
            product_id        BIGINT      NOT NULL,
            product_name      TEXT        NOT NULL,
            product_image_url TEXT,
            unit_price        INT         NOT NULL CHECK (unit_price >= 0),
            quantity          SMALLINT    NOT NULL CHECK (quantity > 0),
            subtotal          INT         NOT NULL CHECK (subtotal >= 0),
            notes             TEXT,
            created_at        TIMESTAMP   NOT NULL,
            PRIMARY KEY (id, country_code),
            CONSTRAINT fk_order_items_order
                FOREIGN KEY (order_id, country_code) REFERENCES orders(id, country_code) ON DELETE CASCADE
        )
    `);

    // Fetching all items for a given order (always paired with country_code for shard routing)
    await knex.raw(`
        CREATE INDEX idx_order_items_order_id
        ON order_items(order_id, country_code)
    `);

    // Product popularity analytics: how many times a product was ordered
    await knex.raw(`
        CREATE INDEX idx_order_items_product_id
        ON order_items(product_id, country_code)
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TABLE IF EXISTS order_items`);
}
