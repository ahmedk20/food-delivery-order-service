export interface ConsumeMessage {
    routingKey: string;
    body: Buffer;
    ack: () => void;
    nack: (requeue?: boolean) => void;
}

export interface ConsumerOptions {
    exchange: string;
    queue: string;
    bindingKeys: string[];
    prefetch: number;
    deadLetterExchange?: string;
    deadLetterQueue?: string;
}

export interface IMessageBroker {
    connect(): Promise<void>;
    close(): Promise<void>;
    declareTopology(opts: ConsumerOptions): Promise<void>;
    publish(exchange: string, routingKey: string, body: Buffer): Promise<void>;
    consume(opts: ConsumerOptions, handler: (msg: ConsumeMessage) => Promise<void>): Promise<void>;
}
