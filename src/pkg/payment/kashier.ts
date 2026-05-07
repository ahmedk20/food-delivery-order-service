import { createHmac, timingSafeEqual } from 'crypto';
import type { CreateSessionParams, IPaymentProvider, SessionResult } from './payment-provider.interface.js';

type KashierSessionResponse = {
    status: string;
    body: { _id: string; sessionUrl: string };
};

export class KashierPaymentProvider implements IPaymentProvider {
    constructor(
        private readonly apiKey: string,
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
                    'api-key': this.apiKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    amount: params.amount,
                    currency: params.currency,
                    order: String(params.orderId),
                    merchantRedirect: params.merchantRedirectUrl,
                    serverWebhook: params.serverWebhookUrl,
                    customer: params.customer,
                    expireAt: params.expiresAt,
                }),
                signal: controller.signal,
            });

            if (!res.ok) {
                throw new Error(`Kashier API error: ${res.status}`);
            }

            const json = (await res.json()) as KashierSessionResponse;
            return {
                sessionId: json.body._id,
                sessionUrl: json.body.sessionUrl,
            };
        } finally {
            clearTimeout(timer);
        }
    }

    verifyWebhookSignature(payload: Record<string, any>, signature: string): boolean {
        if (!signature || typeof signature !== 'string') return false;
        if (!/^[0-9a-fA-F]+$/.test(signature)) return false;

        const signatureKeys: string[] = Array.isArray(payload.signatureKeys) ? payload.signatureKeys : [];
        const data: Record<string, any> = payload.data ?? {};
        if (signatureKeys.length === 0) return false;

        const sorted = [...signatureKeys].sort();
        const qs = sorted.map(k => `${k}=${data[k]}`).join('&');

        const expectedHex = createHmac('sha256', this.apiKey).update(qs).digest('hex');

        const expectedBuf = Buffer.from(expectedHex, 'hex');
        const sigBuf = Buffer.from(signature, 'hex');
        if (expectedBuf.length !== sigBuf.length) return false;

        return timingSafeEqual(expectedBuf, sigBuf);
    }
}
