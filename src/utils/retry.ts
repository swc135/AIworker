import { createLogger } from '@/utils/logger';
import type { RetryConfig, DEFAULT_RETRY_CONFIG } from '@/types';

const logger = createLogger('Retry');

export const defaultRetryConfig: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryableStatusCodes: [429, 500, 502, 503, 504],
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  config?: Partial<RetryConfig>,
): Promise<T> {
  const merged = { ...defaultRetryConfig, ...config };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= merged.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.debug(`Attempt ${attempt + 1}/${merged.maxRetries + 1} failed: ${lastError.message}`);

      if (attempt === merged.maxRetries) break;

      const delay = calculateDelay(attempt, merged.baseDelayMs, merged.maxDelayMs);
      logger.debug(`Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw lastError!;
}

export async function withRetryOnHttpStatus<T>(
  fn: () => Promise<Response>,
  config?: Partial<RetryConfig>,
): Promise<Response> {
  const merged = { ...defaultRetryConfig, ...config };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= merged.maxRetries; attempt++) {
    try {
      const response = await fn();
      if (merged.retryableStatusCodes!.includes(response.status)) {
        const errorMsg = `HTTP ${response.status}: ${await response.text()}`;
        lastError = new Error(errorMsg);
        logger.debug(`HTTP ${response.status}, retrying (attempt ${attempt + 1}/${merged.maxRetries + 1})...`);

        if (attempt < merged.maxRetries) {
          const delay = calculateDelay(attempt, merged.baseDelayMs, merged.maxDelayMs);
          await sleep(delay);
          continue;
        }
        throw lastError;
      }
      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === merged.maxRetries) break;
      const delay = calculateDelay(attempt, merged.baseDelayMs, merged.maxDelayMs);
      logger.debug(`Request failed: ${lastError.message}, retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw lastError!;
}

function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const jitter = exponential * 0.5 * Math.random();
  return Math.min(exponential + jitter, maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
