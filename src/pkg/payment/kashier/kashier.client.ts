import type { CreateSessionParams, IPaymentProvider, SessionResult } from '../payment-provider.interface.js';
import { verifyKashierSignature } from './kashier.signature.js';
import type { KashierSessionResponse } from './types.js';

export class KashierPaymentProvider implements IPaymentProvider {
    constructor(
        private readonly apiKey: string,
        private readonly webhookSecret: string,
        private readonly baseUrl: string,
    ) {}

    async createSession(params: CreateSessionParams): Promise<SessionResult> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);

        try {
            const res = await fetch(`${this.baseUrl}/v3/payment/sessions`, {
                method: 'POST',
                headers: {
                    'Authorization': this.apiKey,
                    'api-key':       this.apiKey,
                    'Content-Type':  'application/json',
                },
                body: JSON.stringify({
                    amount:           params.amount,
                    currency:         params.currency,
                    order:            `${params.region}-${params.orderId}`,
                    merchantRedirect: params.merchantRedirectUrl,
                    serverWebhook:    params.serverWebhookUrl,
                    customer:         params.customer,
                    expireAt:         params.expiresAt,
                }),
                signal: controller.signal,
            });

            if (!res.ok) {
                throw new Error(`Kashier API error: ${res.status}`);
            }

            const json = (await res.json()) as KashierSessionResponse;
            return {
                sessionId:  json.body._id,
                sessionUrl: json.body.sessionUrl,
            };
        } finally {
            clearTimeout(timer);
        }
    }

    verifyWebhookSignature(payload: Record<string, any>, signature: string): boolean {
        return verifyKashierSignature(payload, signature, this.webhookSecret);
    }
}
