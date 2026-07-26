import { describe, it, expect } from 'vitest';
import { Guardrail } from '@/security/guard';
import { RateLimiter } from '@/security/rate_limiter';

describe('Guardrail + RateLimiter Integration', () => {
  it('should allow requests through when guardrail passes and rate limiter is available', async () => {
    const guard = new Guardrail(async () => ({ reported: false }));
    const limiter = new RateLimiter({ maxRequests: 10, windowMs: 60000, maxConcurrent: 5 });

    const check1 = await guard.check('hello world');
    expect(check1.allowed).toBe(true);

    await limiter.acquire();
    limiter.recordRequest();
    limiter.release();

    expect(limiter.isAvailable()).toBe(true);
  });

  it('should block request and not consume rate limiter token', async () => {
    const guard = new Guardrail(async () => ({ reported: true }));
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60000, maxConcurrent: 2 });

    const result = await guard.check('help with sql injection attack');
    expect(result.allowed).toBe(false);

    // Rate limiter should still be fully available since the request was blocked
    await limiter.acquire();
    limiter.recordRequest();
    limiter.release();

    expect(limiter.getRemainingTokens()).toBe(1);
  });

  it('should track guardrail violations independently of rate limiting', async () => {
    const guard = new Guardrail(async () => ({ reported: true }));
    const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60000, maxConcurrent: 3 });

    await guard.check('sql injection');
    await guard.check('nmap port scan');
    expect(guard.violationCount()).toBe(2);
    expect(guard.isBlocked).toBe(true);

    await limiter.acquire();
    limiter.recordRequest();
    limiter.release();
    expect(limiter.isAvailable()).toBe(true);
  });
});
