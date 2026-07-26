import { describe, it, expect } from 'vitest';
import { Guardrail } from '@/security/guard';
import { RateLimiter, DEFAULT_RATE_LIMIT_CONFIG } from '@/security/rate_limiter';

describe('RateLimiter', () => {
  it('should allow requests within limit', async () => {
    const limiter = new RateLimiter({ maxRequests: 10, windowMs: 60000, maxConcurrent: 3 });
    
    for (let i = 0; i < 3; i++) {
      await limiter.acquire();
      limiter.recordRequest();
      limiter.release();
    }
    
    expect(limiter.isAvailable()).toBe(true);
  });

  it('should block when rate limit exceeded', async () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60000, maxConcurrent: 3 });
    
    await limiter.acquire();
    limiter.recordRequest();
    await limiter.acquire();
    limiter.recordRequest();
    
    expect(limiter.getRemainingTokens()).toBe(0);
    expect(limiter.isAvailable()).toBe(false);
  });

  it('should track request count accurately', async () => {
    const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60000, maxConcurrent: 5 });
    
    await limiter.acquire();
    limiter.recordRequest();
    await limiter.acquire();
    limiter.recordRequest();
    
    expect(limiter.getRemainingTokens()).toBe(3);
  });

  it('should release slots properly', async () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60000, maxConcurrent: 1 });
    
    await limiter.acquire();
    limiter.recordRequest();
    
    limiter.release();
    expect(limiter.getActiveCount()).toBe(0);
  });

  it('should use default config when not specified', async () => {
    const limiter = new RateLimiter();
    const config = limiter.getConfig();
    
    expect(config.maxRequests).toBe(DEFAULT_RATE_LIMIT_CONFIG.maxRequests);
    expect(config.windowMs).toBe(DEFAULT_RATE_LIMIT_CONFIG.windowMs);
    expect(config.maxConcurrent).toBe(DEFAULT_RATE_LIMIT_CONFIG.maxConcurrent);
  });

  it('should update config dynamically', async () => {
    const limiter = new RateLimiter({ maxRequests: 30, windowMs: 30000 });
    
    limiter.updateConfig({ maxConcurrent: 10 });
    const config = limiter.getConfig();
    
    expect(config.maxRequests).toBe(30);
    expect(config.windowMs).toBe(30000);
    expect(config.maxConcurrent).toBe(10);
  });

  it('should handle concurrent access properly', async () => {
    const limiter = new RateLimiter({ maxRequests: 100, windowMs: 60000, maxConcurrent: 5 });
    
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        limiter.acquire().then(() => {
          limiter.recordRequest();
          limiter.release();
        })
      );
    }
    
    await Promise.all(promises);
    expect(limiter.getRemainingTokens()).toBe(95);
  });

  it('should expire old records after window', async () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 100, maxConcurrent: 2 });
    
    await limiter.acquire();
    limiter.recordRequest();
    limiter.release();
    await limiter.acquire();
    limiter.recordRequest();
    limiter.release();
    
    expect(limiter.isAvailable()).toBe(false);
    
    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 150));
    
    expect(limiter.isAvailable()).toBe(true);
  });

  it('should reject when wait timeout exceeded', async () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 50, maxConcurrent: 1 });
    
    await limiter.acquire();
    limiter.recordRequest();
    
    // This should eventually timeout since slot is occupied
    await expect(
      Promise.race([
        limiter.acquire(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('timeout')), 100)
        ),
      ])
    ).rejects.toThrow('timeout');
  });
});
