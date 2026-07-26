import { createLogger } from '@/utils/logger';

const logger = createLogger('Metrics');

export interface TokenMetrics {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  byModel: Record<string, { input: number; output: number }>;
}

export interface APIEvent {
  timestamp: number;
  durationMs: number;
  toolName: string;
  success: boolean;
  error?: string;
}

export interface MetricsSnapshot {
  uptime: number;
  taskCount: number;
  apiCallCount: number;
  avgResponseTimeMs: number;
  errorRate: number;
  tokenMetrics: TokenMetrics;
  lastError?: string;
}

export class MetricsCollector {
  private events: APIEvent[] = [];
  private tokenMetrics: TokenMetrics = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    byModel: {},
  };
  private taskCount: number = 0;
  private startTime: number = Date.now();
  private lastError?: string;
  private maxEvents: number = 10000;

  recordTask(): void {
    this.taskCount++;
    logger.debug(`Task count: ${this.taskCount}`);
  }

  recordAPIEvent(event: Omit<APIEvent, 'timestamp'>): void {
    const fullEvent: APIEvent = { ...event, timestamp: Date.now() };
    this.events.push(fullEvent);

    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    if (!fullEvent.success) {
      this.lastError = fullEvent.error;
    }
  }

  recordTokens(model: string, inputTokens: number, outputTokens: number): void {
    this.tokenMetrics.totalInputTokens += inputTokens;
    this.tokenMetrics.totalOutputTokens += outputTokens;
    this.tokenMetrics.totalTokens += inputTokens + outputTokens;

    if (!this.tokenMetrics.byModel[model]) {
      this.tokenMetrics.byModel[model] = { input: 0, output: 0 };
    }
    this.tokenMetrics.byModel[model].input += inputTokens;
    this.tokenMetrics.byModel[model].output += outputTokens;
  }

  incrementTaskCount(n: number = 1): void {
    this.taskCount += n;
  }

  getSnapshot(): MetricsSnapshot {
    const events = this.events;
    const totalCalls = events.length;
    const successfulCalls = events.filter((e) => e.success).length;
    const errorCount = totalCalls - successfulCalls;

    const durations = events.map((e) => e.durationMs);
    const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    return {
      uptime: Date.now() - this.startTime,
      taskCount: this.taskCount,
      apiCallCount: totalCalls,
      avgResponseTimeMs: Math.round(avgDuration),
      errorRate: totalCalls > 0 ? errorCount / totalCalls : 0,
      tokenMetrics: { ...this.tokenMetrics },
      lastError: this.lastError,
    };
  }

  getTokenBreakdown(): string {
    const lines = ['=== Token Usage ==='];
    lines.push(`Total input:    ${this.tokenMetrics.totalInputTokens.toLocaleString()}`);
    lines.push(`Total output:   ${this.tokenMetrics.totalOutputTokens.toLocaleString()}`);
    lines.push(`Total tokens:   ${this.tokenMetrics.totalTokens.toLocaleString()}`);
    lines.push('');
    lines.push('By model:');

    for (const [model, counts] of Object.entries(this.tokenMetrics.byModel)) {
      lines.push(`  ${model}: ${counts.input.toLocaleString()} in / ${counts.output.toLocaleString()} out`);
    }

    return lines.join('\n');
  }

  getSummary(): string {
    const snap = this.getSnapshot();
    return [
      '=== System Metrics ===',
      `Uptime:              ${this.formatDuration(snap.uptime)}`,
      `Tasks processed:     ${snap.taskCount}`,
      `API calls made:      ${snap.apiCallCount}`,
      `Avg response time:   ${snap.avgResponseTimeMs}ms`,
      `Error rate:          ${(snap.errorRate * 100).toFixed(1)}%`,
      ...(snap.lastError ? [`Last error:          ${snap.lastError}`] : []),
      '',
      this.getTokenBreakdown(),
    ].join('\n');
  }

  reset(): void {
    this.events = [];
    this.tokenMetrics = { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, byModel: {} };
    this.taskCount = 0;
    this.startTime = Date.now();
    this.lastError = undefined;
    logger.info('Metrics reset');
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}
