import { describe, it, expect } from 'vitest';
import { withRetry, withRetryOnHttpStatus } from '@/utils/retry';

describe('withRetry', () => {
  it('should succeed on first attempt', async () => {
    let attempts = 0;
    const fn = () => { attempts++; return Promise.resolve('ok'); };
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(attempts).toBe(1);
  });

  it('should retry on failure and succeed eventually', async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      if (attempts < 3) throw new Error('fail');
      return Promise.resolve('success');
    };
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1 });
    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('should throw after exhausting retries', async () => {
    let attempts = 0;
    const fn = () => { attempts++; throw new Error('persistent error'); };
    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow('persistent error');
    expect(attempts).toBe(3); // 1 initial + 2 retries
  });

  it('should handle non-Error exceptions', async () => {
    let attempts = 0;
    const fn = () => { attempts++; throw new TypeError('type error'); };
    await expect(withRetry(fn, { maxRetries: 1, baseDelayMs: 1 })).rejects.toThrow('type error');
    expect(attempts).toBe(2);
  });
});

describe('withRetryOnHttpStatus', () => {
  it('should return response on success', async () => {
    const fn = () => Promise.resolve(new Response('ok', { status: 200 }));
    const result = await withRetryOnHttpStatus(fn);
    expect(result.status).toBe(200);
  });

  it('should retry on retryable HTTP status codes', async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      if (attempts < 3) {
        return Promise.resolve(new Response('rate limited', { status: 429 }));
      }
      return Promise.resolve(new Response('OK', { status: 200 }));
    };
    const result = await withRetryOnHttpStatus(fn, { maxRetries: 3, baseDelayMs: 1 });
    expect(result.status).toBe(200);
    expect(attempts).toBe(3);
  });

  it('should pass through non-retryable HTTP statuses', async () => {
    let attempts = 0;
    const fn = () => { attempts++; return Promise.resolve(new Response('Not Found', { status: 404 })); };
    const result = await withRetryOnHttpStatus(fn);
    expect(result.status).toBe(404);
    expect(attempts).toBe(1);
  });

  it('should retry on 500 server error', async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      if (attempts < 2) {
        return Promise.resolve(new Response('Internal Server Error', { status: 500 }));
      }
      return Promise.resolve(new Response('Recovery', { status: 200 }));
    };
    const result = await withRetryOnHttpStatus(fn, { maxRetries: 2, baseDelayMs: 1 });
    expect(result.status).toBe(200);
  });
});
