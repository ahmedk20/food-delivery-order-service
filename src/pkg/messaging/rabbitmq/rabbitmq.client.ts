import { connect, type AmqpConnectionManager, type ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage as AmqpMessage } from 'amqplib';
import type { IMessageBroker, ConsumeMessage, ConsumerOptions } from '../message-broker.interface.js';
import type { RabbitMQConfig } from './rabbitmq.types.js';

export class RabbitMQClient implements IMessageBroker {
    private connection: AmqpConnectionManager | null = null;
    private publishChannel: ChannelWrapper | null = null;

    constructor(private readonly config: RabbitMQConfig) {}

    async connect(): Promise<void> {
        this.connection = connect([this.config.url], {
            reconnectTimeInSeconds: this.config.reconnectInitialMs / 1000,
        });

        this.publishChannel = this.connection.createChannel({
            json: false,
            setup: async (ch: ConfirmChannel) => {
                await ch.prefetch(1);
            },
        });

        await this.publishChannel.waitForConnect();
    }

    async close(): Promise<void> {
        await this.publishChannel?.close();
        await this.connection?.close();
        this.publishChannel = null;
        this.connection = null;
    }

    async declareTopology(opts: ConsumerOptions): Promise<void> {
        if (!this.connection) throw new Error('RabbitMQClient not connected');

        const ch = this.connection.createChannel({
            json: false,
            setup: async (channel: ConfirmChannel) => {
                await assertTopology(channel, opts);
            },
        });
        await ch.waitForConnect();
        await ch.close();
    }

    async publish(exchange: string, routingKey: string, body: Buffer): Promise<void> {
        if (!this.publishChannel) throw new Error('RabbitMQClient not connected');
        await this.publishChannel.publish(exchange, routingKey, body, { persistent: true });
    }

    async consume(opts: ConsumerOptions, handler: (msg: ConsumeMessage) => Promise<void>): Promise<void> {
        if (!this.connection) throw new Error('RabbitMQClient not connected');

        this.connection.createChannel({
            json: false,
            setup: async (ch: ConfirmChannel) => {
                await assertTopology(ch, opts);
                await ch.prefetch(opts.prefetch);
                await ch.consume(opts.queue, async (raw: AmqpMessage | null) => {
                    if (!raw) return;

                    const msg: ConsumeMessage = {
                        routingKey: raw.fields.routingKey,
                        body:       raw.content,
                        ack:        () => ch.ack(raw),
                        nack:       (requeue = false) => ch.nack(raw, false, requeue),
                    };

                    try {
                        await handler(msg);
                    } catch {
                        msg.nack(false); // non-retryable → DLQ
                    }
                });
            },
        });
    }
}

async function assertTopology(ch: ConfirmChannel, opts: ConsumerOptions): Promise<void> {
    await ch.assertExchange(opts.exchange, 'topic', { durable: true });

    if (opts.deadLetterExchange && opts.deadLetterQueue) {
        await ch.assertExchange(opts.deadLetterExchange, 'topic', { durable: true });
        await ch.assertQueue(opts.deadLetterQueue, { durable: true });
        await ch.bindQueue(opts.deadLetterQueue, opts.deadLetterExchange, '#');
    }

    const queueArgs: Record<string, string> = {};
    if (opts.deadLetterExchange) {
        queueArgs['x-dead-letter-exchange'] = opts.deadLetterExchange;
    }

    await ch.assertQueue(opts.queue, { durable: true, arguments: queueArgs });

    for (const key of opts.bindingKeys) {
        await ch.bindQueue(opts.queue, opts.exchange, key);
    }
}
