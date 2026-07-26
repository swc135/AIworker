import { createLogger } from '@/utils/logger';

const logger = createLogger('RateLimiter');

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  maxConcurrent: number;
}

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxRequests: 60,
  windowMs: 60000,
  maxConcurrent: 3,
};

interface RequestRecord {
  timestamp: number;
}

export class RateLimiter {
  private config: RateLimitConfig;
  private requestWindow: RequestRecord[] = [];
  private activeCount = 0;
  private waitingQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = { ...DEFAULT_RATE_LIMIT_CONFIG, ...config };
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    
    this.cleanExpiredRecords(now);

    if (this.requestWindow.length >= this.config.maxRequests) {
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          const idx = this.waitingQueue.findIndex((w) => w.resolve === resolve);
          if (idx !== -1) {
            this.waitingQueue.splice(idx, 1);
          }
          reject(new Error('Rate limit wait timeout exceeded'));
        }, this.config.windowMs);

        this.waitingQueue.push({
          resolve: () => {
            clearTimeout(timeout);
            resolve();
          },
          reject: (err) => {
            clearTimeout(timeout);
            reject(err);
          },
        });
      });
    }

    return new Promise<void>((resolve) => {
      if (this.activeCount < this.config.maxConcurrent) {
        this.activeCount++;
      } else {
        this.waitingQueue.push({ resolve, reject: () => {} });
      }
      resolve();
    });
  }

  release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    
    if (this.waitingQueue.length > 0 && this.activeCount < this.config.maxConcurrent) {
      const next = this.waitingQueue.shift();
      if (next) {
        this.activeCount++;
        next.resolve();
      }
    }
  }

  private cleanExpiredRecords(now: number): void {
    const windowStart = now - this.config.windowMs;
    this.requestWindow = this.requestWindow.filter((r) => r.timestamp > windowStart);
  }

  recordRequest(): void {
    this.requestWindow.push({ timestamp: Date.now() });
  }

  getRemainingTokens(now?: number): number {
    const current = now || Date.now();
    this.cleanExpiredRecords(current);
    return Math.max(0, this.config.maxRequests - this.requestWindow.length);
  }

  isAvailable(): boolean {
    const now = Date.now();
    this.cleanExpiredRecords(now);
    return this.requestWindow.length < this.config.maxRequests && this.activeCount < this.config.maxConcurrent;
  }

  getConfig(): RateLimitConfig {
    return { ...this.config };
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  updateConfig(config: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info(`Rate limiter config updated: ${this.config.maxRequests} req/${this.config.windowMs}ms, max concurrent: ${this.config.maxConcurrent}`);
  }
}
