# Postgres image used by CI (and available for local test stacks).
#
# order-service migrations run `CREATE EXTENSION pg_partman` to auto-manage
# monthly range partitions on orders/transactions/deliveries/webhook_events.
# The stock `postgres:16` image does NOT ship pg_partman, so we bake it in.
# postgis is included too, to mirror the shared dev image exactly.
FROM postgres:16

RUN apt-get update \
    && apt-get install -y \
        postgresql-16-partman \
        postgresql-16-postgis-3 \
    && rm -rf /var/lib/apt/lists/*
