import { describe, it, expect } from 'vitest';
import { MetricsCollector } from '@/utils/metrics';

describe('MetricsCollector', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  it('should start with zero counts', () => {
    const snap = metrics.getSnapshot();
    expect(snap.taskCount).toBe(0);
    expect(snap.apiCallCount).toBe(0);
    expect(snap.tokenMetrics.totalInputTokens).toBe(0);
    expect(snap.errorRate).toBe(0);
  });

  it('should record tasks', () => {
    metrics.recordTask();
    metrics.recordTask();
    const snap = metrics.getSnapshot();
    expect(snap.taskCount).toBe(2);
  });

  it('should increment task count by arbitrary number', () => {
    metrics.incrementTaskCount(5);
    expect(metrics.getSnapshot().taskCount).toBe(5);
  });

  it('should record API events and calculate error rate', () => {
    metrics.recordAPIEvent({ toolName: 'test', success: true, durationMs: 100 });
    metrics.recordAPIEvent({ toolName: 'test', success: true, durationMs: 200 });
    metrics.recordAPIEvent({ toolName: 'test', success: false, durationMs: 50, error: 'fail' });

    const snap = metrics.getSnapshot();
    expect(snap.apiCallCount).toBe(3);
    expect(snap.avgResponseTimeMs).toBeCloseTo(117);
    expect(snap.errorRate).toBeCloseTo(1 / 3, 4);
    expect(snap.lastError).toBe('fail');
  });

  it('should track token usage', () => {
    metrics.recordTokens('gpt-4', 1000, 500);
    metrics.recordTokens('gpt-4', 2000, 1000);
    metrics.recordTokens('claude-3', 500, 200);

    const snap = metrics.getSnapshot();
    expect(snap.tokenMetrics.totalInputTokens).toBe(3500);
    expect(snap.tokenMetrics.totalOutputTokens).toBe(1700);
    expect(snap.tokenMetrics.totalTokens).toBe(5200);
    expect(Object.keys(snap.tokenMetrics.byModel)).toHaveLength(2);
    expect(snap.tokenMetrics.byModel['gpt-4'].input).toBe(3000);
    expect(snap.tokenMetrics.byModel['gpt-4'].output).toBe(1500);
    expect(snap.tokenMetrics.byModel['claude-3'].input).toBe(500);
  });

  it('should format token breakdown', () => {
    metrics.recordTokens('gpt-4', 100, 50);
    const breakdown = metrics.getTokenBreakdown();
    expect(breakdown).toContain('gpt-4');
    expect(breakdown).toContain('100 in');
    expect(breakdown).toContain('50 out');
  });

  it('should format summary with uptime', () => {
    const summary = metrics.getSummary();
    expect(summary).toContain('System Metrics');
    expect(summary).toContain('Tasks processed');
    expect(summary).toContain('Uptime');
  });

  it('should reset all metrics', () => {
    metrics.recordTask();
    metrics.recordAPIEvent({ toolName: 'x', success: true, durationMs: 10 });
    metrics.recordTokens('gpt-4', 100, 50);
    metrics.reset();

    const snap = metrics.getSnapshot();
    expect(snap.taskCount).toBe(0);
    expect(snap.apiCallCount).toBe(0);
    expect(snap.tokenMetrics.totalInputTokens).toBe(0);
    expect(snap.lastError).toBeUndefined();
  });

  it('should cap event array at maxEvents', () => {
    for (let i = 0; i < 10001; i++) {
      metrics.recordAPIEvent({ toolName: `tool-${i}`, success: true, durationMs: 1 });
    }
    // Events should be capped (shifted off old ones)
    expect(metrics.getSnapshot().apiCallCount).toBeLessThanOrEqual(10000);
  });

  it('should calculate avg response time correctly', () => {
    metrics.recordAPIEvent({ toolName: 'a', success: true, durationMs: 100 });
    metrics.recordAPIEvent({ toolName: 'b', success: true, durationMs: 200 });
    metrics.recordAPIEvent({ toolName: 'c', success: true, durationMs: 300 });

    const snap = metrics.getSnapshot();
    expect(snap.avgResponseTimeMs).toBe(200);
  });

  it('should handle zero api calls gracefully', () => {
    const snap = metrics.getSnapshot();
    expect(snap.apiCallCount).toBe(0);
    expect(snap.avgResponseTimeMs).toBe(0);
    expect(snap.errorRate).toBe(0);
  });
});
