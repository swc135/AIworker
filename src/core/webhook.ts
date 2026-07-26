import { createLogger } from '@/utils/logger';
import { withRetryOnHttpStatus } from '@/utils/retry';

const logger = createLogger('Webhook');

export interface WebhookPayload {
  event_type: string;
  task_id?: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export interface WebhookEndpoint {
  url: string;
  secret?: string;
  events: string[];
  enabled: boolean;
}

export class WebhookDispatcher {
  private endpoints: Map<string, WebhookEndpoint> = new Map();
  private pending: Array<{ payload: WebhookPayload; retryCount: number }> = [];
  private readonly maxRetries = 3;
  private readonly baseDelayMs = 1000;

  registerEndpoint(config: Omit<WebhookEndpoint, 'enabled'>): void {
    const endpoint: WebhookEndpoint = { ...config, enabled: true };
    this.endpoints.set(endpoint.url, endpoint);
    logger.info(`Registered webhook: ${endpoint.url} for events ${endpoint.events.join(', ')}`);
  }

  unregisterEndpoint(url: string): void {
    this.endpoints.delete(url);
    logger.info(`Unregistered webhook: ${url}`);
  }


  async dispatch(eventType: string, payload: Record<string, unknown>): Promise<void> {
    const webhookPayload: WebhookPayload = {
      event_type: eventType,
      data: payload,
      timestamp: Date.now(),
    };

    const tasks = this.pending.filter((p) => p.payload.task_id === (payload as { task_id?: string }).task_id);
    if (tasks.length > 10) {
      logger.warn(`Webhook queue full, dropping: ${eventType}`);
      return;
    }

    for (const [url, endpoint] of this.endpoints) {
      if (!endpoint.enabled || !this.matchesEvents(endpoint.events, eventType)) continue;

      try {
        await this.sendToEndpoint(url, endpoint, webhookPayload);
      } catch (err) {
        this.pending.push({ payload: webhookPayload, retryCount: 1 });
        logger.error(`Webhook failed for ${url}: ${(err as Error).message}`);
        setTimeout(() => this.flushPending(), 5000);
      }
    }
  }

  private matchesEvents(allowed: string[], event: string): boolean {
    if (allowed.includes('*')) return true;
    return allowed.includes(event);
  }

  private async sendToEndpoint(url: string, endpoint: WebhookEndpoint, payload: WebhookPayload): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (endpoint.secret) {
      headers['X-Webhook-Secret'] = endpoint.secret;
    }

    await withRetryOnHttpStatus(
      () => fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      }),
      { maxRetries: 2, baseDelayMs: this.baseDelayMs, maxDelayMs: 10000 },
    );
  }

  async flushPending(): Promise<void> {
    const toRetry: WebhookPayload[] = [];
    for (const item of this.pending) {
      if (item.retryCount < this.maxRetries) {
        toRetry.push(item.payload);
        item.retryCount++;
      }
    }

    for (const payload of toRetry) {
      await this.dispatch(payload.event_type, payload.data);
    }

    this.pending = this.pending.filter((p) => p.retryCount >= this.maxRetries);
  }

  getRegistered(): string[] {
    return [...this.endpoints.keys()];
  }

  setEnabled(url: string, enabled: boolean): void {
    const endpoint = this.endpoints.get(url);
    if (endpoint) endpoint.enabled = enabled;
  }
}
