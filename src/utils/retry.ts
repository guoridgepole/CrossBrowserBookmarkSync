/**
 * Retry with exponential backoff.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Initial delay in ms (doubles each retry) */
  initialDelayMs: number;
  /** Maximum delay cap in ms */
  maxDelayMs?: number;
  /** HTTP status codes that should NOT be retried (e.g., 4xx) */
  nonRetryableStatusCodes?: number[];
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 2000,
  maxDelayMs: 8000,
  nonRetryableStatusCodes: [400, 401, 403, 404, 409],
};

/**
 * Execute a function with exponential backoff retry.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on last attempt
      if (attempt === opts.maxRetries) break;

      // Check if error is non-retryable
      const statusCode = (error as any)?.statusCode as number | undefined;
      if (
        statusCode &&
        opts.nonRetryableStatusCodes?.includes(statusCode)
      ) {
        break;
      }

      // Wait with exponential backoff
      const delay = Math.min(
        opts.initialDelayMs * Math.pow(2, attempt),
        opts.maxDelayMs ?? Infinity,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
