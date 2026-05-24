import { vi } from 'vitest';

process.env.APP_STAGE = 'test';

// ── Mock infrastructure modules ──────────────────────────────────────────────
// These vi.mock calls are hoisted and applied globally to all test files.
// They replace the real modules (which open DB/Redis/RabbitMQ connections)
// with lightweight stubs that let the DI container initialise without I/O.

const mockKnexChain = () => ({
    select:    vi.fn().mockReturnThis(),
    where:     vi.fn().mockReturnThis(),
    andWhere:  vi.fn().mockReturnThis(),
    orWhere:   vi.fn().mockReturnThis(),
    whereIn:   vi.fn().mockReturnThis(),
    orderBy:   vi.fn().mockReturnThis(),
    limit:     vi.fn().mockReturnThis(),
    offset:    vi.fn().mockReturnThis(),
    first:     vi.fn().mockResolvedValue(null),
    insert:    vi.fn().mockReturnThis(),
    update:    vi.fn().mockResolvedValue(1),
    del:       vi.fn().mockResolvedValue(1),
    returning: vi.fn().mockResolvedValue([]),
    raw:       vi.fn().mockResolvedValue({ rows: [] }),
    count:     vi.fn().mockResolvedValue([{ count: '0' }]),
    join:      vi.fn().mockReturnThis(),
    leftJoin:  vi.fn().mockReturnThis(),
    as:        vi.fn().mockReturnThis(),
    then:      vi.fn(),
});

const createMockTrx = () => {
    const trx: any = vi.fn((tableName: string) => mockKnexChain());
    trx.commit   = vi.fn().mockResolvedValue(undefined);
    trx.rollback = vi.fn().mockResolvedValue(undefined);
    trx.raw      = vi.fn().mockResolvedValue({ rows: [] });
    return trx;
};

const mockDb: any = vi.fn((_region: string) => {
    const chain: any = mockKnexChain();
    chain.transaction = vi.fn().mockResolvedValue(createMockTrx());
    const callable: any = vi.fn((tableName: string) => mockKnexChain());
    callable.transaction = chain.transaction;
    callable.raw = chain.raw;
    return callable;
});

vi.mock('../lib/knex/knex.js', () => ({
    db:               mockDb,
    dbArchive:        mockDb,
    pingAll:          vi.fn().mockResolvedValue(undefined),
    destroyAllShards: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/knex/shards.js', () => ({
    getHotShard:      vi.fn(() => mockDb('eg')),
    getArchiveShard:  vi.fn(() => mockDb('eg')),
    destroyAllShards: vi.fn().mockResolvedValue(undefined),
    pingAll:          vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/cache/init.js', () => ({
    cacheProvider: {
        get:               vi.fn().mockResolvedValue(null),
        set:               vi.fn().mockResolvedValue(undefined),
        delete:            vi.fn().mockResolvedValue(undefined),
        sAdd:              vi.fn().mockResolvedValue(undefined),
        sRem:              vi.fn().mockResolvedValue(undefined),
        sIsMember:         vi.fn().mockResolvedValue(false),
        geoAdd:            vi.fn().mockResolvedValue(undefined),
        geoRem:            vi.fn().mockResolvedValue(undefined),
        geosearchByRadius: vi.fn().mockResolvedValue([]),
        zMembers:          vi.fn().mockResolvedValue([]),
        sMembers:          vi.fn().mockResolvedValue([]),
        trySet:            vi.fn().mockResolvedValue(true),
        incr:              vi.fn().mockResolvedValue(1),
        expire:            vi.fn().mockResolvedValue(undefined),
        ttl:               vi.fn().mockResolvedValue(-1),
    },
}));

vi.mock('../lib/websocket/ws-server.js', () => {
    class MockSocketServer {
        init                  = vi.fn().mockResolvedValue(undefined);
        emitToRoom            = vi.fn();
        close                 = vi.fn().mockResolvedValue(undefined);
        setOrderAccessChecker = vi.fn();
    }
    const socketServer = new MockSocketServer();
    return { socketServer, SocketServer: MockSocketServer };
});

vi.mock('../lib/websocket/ws-auth.js', () => ({
    socketAuthMiddleware: vi.fn((_socket: any, next: any) => next()),
}));

vi.mock('../pkg/messaging/rabbitmq/rabbitmq.client.js', () => {
    class MockRabbitMQClient {
        connect         = vi.fn().mockResolvedValue(undefined);
        close           = vi.fn().mockResolvedValue(undefined);
        declareTopology = vi.fn().mockResolvedValue(undefined);
        publish         = vi.fn().mockResolvedValue(undefined);
        consume         = vi.fn().mockResolvedValue(undefined);
    }
    return { RabbitMQClient: MockRabbitMQClient };
});

vi.mock('../pkg/payment/kashier/index.js', () => {
    class MockKashierPaymentProvider {
        createSession          = vi.fn().mockResolvedValue({ sessionId: 'sess-1', sessionUrl: 'https://pay.test/sess-1' });
        verifyWebhookSignature = vi.fn().mockReturnValue(true);
    }
    return { KashierPaymentProvider: MockKashierPaymentProvider };
});

vi.mock('../pkg/cache/redis.js', () => {
    class MockRedisCacheProvider {
        get               = vi.fn().mockResolvedValue(null);
        set               = vi.fn().mockResolvedValue(undefined);
        delete            = vi.fn().mockResolvedValue(undefined);
        sAdd              = vi.fn().mockResolvedValue(undefined);
        sRem              = vi.fn().mockResolvedValue(undefined);
        sIsMember         = vi.fn().mockResolvedValue(false);
        geoAdd            = vi.fn().mockResolvedValue(undefined);
        geoRem            = vi.fn().mockResolvedValue(undefined);
        geosearchByRadius = vi.fn().mockResolvedValue([]);
        zMembers          = vi.fn().mockResolvedValue([]);
        sMembers          = vi.fn().mockResolvedValue([]);
        trySet            = vi.fn().mockResolvedValue(true);
        incr              = vi.fn().mockResolvedValue(1);
        expire            = vi.fn().mockResolvedValue(undefined);
        ttl               = vi.fn().mockResolvedValue(-1);
    }
    return { RedisCacheProvider: MockRedisCacheProvider };
});

vi.mock('../lib/outbox/writer.js', () => ({
    writeOutboxEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/messaging/core-event-handler.js', () => ({
    startCoreEventConsumer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/core-events/handlers.js', () => ({
    handleCoreEventPayload: vi.fn().mockResolvedValue(undefined),
}));
