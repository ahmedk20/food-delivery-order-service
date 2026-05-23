type RetryOptions = {
    attempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    // Return true to retry on this error; false to throw immediately.
    isRetryable?: (err: unknown) => boolean;
};

const DEFAULT_OPTIONS: RetryOptions = {
    attempts:    3,
    baseDelayMs: 100,
    maxDelayMs:  500,
};

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function withRetry<T>(
    fn: () => Promise<T>,
    options: Partial<RetryOptions> = {},
): Promise<T> {
    const { attempts, baseDelayMs, maxDelayMs, isRetryable } = { ...DEFAULT_OPTIONS, ...options };

    let lastErr: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (isRetryable && !isRetryable(err)) throw err;
            if (attempt === attempts) break;
            const jitter     = Math.random() * baseDelayMs;
            const backoff    = Math.min(baseDelayMs * 2 ** (attempt - 1) + jitter, maxDelayMs);
            await delay(backoff);
        }
    }
    throw lastErr;
}
