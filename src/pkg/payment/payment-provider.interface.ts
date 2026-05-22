export interface CreateSessionParams {
    orderId: number;
    region: string;              // encoded into Kashier's `order` field as `${region}-${orderId}`
    amount: string;              // major unit string e.g. "12.50" — Kashier requirement
    currency: string;
    merchantRedirectUrl: string;
    serverWebhookUrl: string;
    customer: {
        name: string;
        email: string;
        phone?: string;
    };
    expiresAt: string;           // ISO 8601
}

export interface SessionResult {
    sessionId: string;           // Kashier _id
    sessionUrl: string;
}

export interface IPaymentProvider {
    createSession(params: CreateSessionParams): Promise<SessionResult>;
    verifyWebhookSignature(payload: Record<string, any>, signature: string): boolean;
}
