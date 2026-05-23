export type KashierSessionRequest = {
    amount:           string;
    currency:         string;
    order:            string;   // merchantOrderId: "{region}-{orderId}"
    merchantRedirect: string;
    serverWebhook:    string;
    customer:         { name: string; email: string };
    expireAt:         string;
};

export type KashierSessionResponse = {
    status: string;
    body: { _id: string; sessionUrl: string };
};
