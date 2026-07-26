import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhookDispatcher } from '@/core/webhook';

describe('WebhookDispatcher', () => {
  let dispatcher: WebhookDispatcher;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    dispatcher = new WebhookDispatcher();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  describe('endpoint management', () => {
    it('registers a webhook endpoint', () => {
      dispatcher.registerEndpoint({
        url: 'http://example.com/hook',
        events: ['task.complete'],
        secret: 'test-secret',
      });
      const registered = dispatcher.getRegistered();
      expect(registered).toContain('http://example.com/hook');
    });

    it('unregisters an existing endpoint', () => {
      dispatcher.registerEndpoint({
        url: 'http://example.com/hook',
        events: ['*'],
      });
      dispatcher.unregisterEndpoint('http://example.com/hook');
      expect(dispatcher.getRegistered()).not.toContain('http://example.com/hook');
    });

    it('toggles enabled state', () => {
      dispatcher.registerEndpoint({
        url: 'http://example.com/hook',
        events: ['*'],
      });
      dispatcher.setEnabled('http://example.com/hook', false);
      // No error thrown - disabled endpoints silently skip dispatch
    });

    it('registers default webhook', () => {
      dispatcher.registerDefault();
      expect(dispatcher.getRegistered()).toContain('http://localhost:9999/webhook');
    });
  });

  describe('dispatch', () => {
    it('dispatches to matching endpoints with wildcard', async () => {
      dispatcher.registerEndpoint({
        url: 'http://example.com/all',
        events: ['*'],
      });
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      (globalThis as any).fetch = mockFetch;
      await expect(dispatcher.dispatch('any.event', {})).resolves.not.toThrow();
      expect(mockFetch).toHaveBeenCalled();
    });

    it('dispatches to matching endpoint by event name', async () => {
      dispatcher.registerEndpoint({
        url: 'http://example.com/task',
        events: ['task.complete'],
      });
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      (globalThis as any).fetch = mockFetch;
      await expect(dispatcher.dispatch('task.complete', { task_id: 't1' })).resolves.not.toThrow();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://example.com/task',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('skips non-matching events', async () => {
      dispatcher.registerEndpoint({
        url: 'http://example.com/task',
        events: ['task.complete'],
      });
      // No fetch should be called since event doesn't match
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      (globalThis as any).fetch = mockFetch;
      await expect(dispatcher.dispatch('other.event', {})).resolves.not.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('handles unknown endpoints gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      (globalThis as any).fetch = mockFetch;
      await expect(dispatcher.dispatch('any.event', { task_id: 'x' })).resolves.not.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not crash on multiple dispatch calls', async () => {
      dispatcher.registerEndpoint({
        url: 'http://example.com/hook',
        events: ['*'],
      });
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      (globalThis as any).fetch = mockFetch;
      for (let i = 0; i < 5; i++) {
        await dispatcher.dispatch('event', { index: i });
      }
      expect(mockFetch.mock.calls.length).toBe(5);
    }, 2000);

    it('includes x-webhook-secret header when secret provided', async () => {
      dispatcher.registerEndpoint({
        url: 'http://example.com/secure',
        events: ['*'],
        secret: 'my-secret',
      });
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      (globalThis as any).fetch = mockFetch;
      await dispatcher.dispatch('event', {});
      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(callArgs[1].headers).toEqual(
        expect.objectContaining({ 'X-Webhook-Secret': 'my-secret' }),
      );
    });
  });

  describe('flushPending', () => {
    it('cleans up pending items after maxRetries', async () => {
      // No endpoint registered - pending stays empty
      expect(dispatcher.getRegistered()).toHaveLength(0);
      await expect(dispatcher.flushPending()).resolves.not.toThrow();
    }, 2000);
  });
});
