import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebhookDispatcher } from '@/core/webhook';
import { createServer, Server as HttpServer } from 'http';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('WebhookDispatcher', () => {
  let dispatcher: WebhookDispatcher;
  let server: HttpServer;
  let received: Array<{ url: string; body: unknown; headers: Record<string, string> }>;
  let port = 0;

  beforeEach(() => {
    dispatcher = new WebhookDispatcher();
    received = [];
  });

  afterEach(() => {
    if (server) {
      server.close();
    }
  });

  function startServer(): Promise<number> {
    return new Promise((resolve, reject) => {
      const s = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          received.push({
            url: req.url || '',
            body: JSON.parse(body),
            headers: req.headers as Record<string, string>,
          });
          res.writeHead(200);
          res.end();
        });
      });
      s.listen(0, () => {
        port = (s.address() as any).port;
        resolve(port);
      });
      s.on('error', reject);
    });
  }

  describe('endpoint management', () => {
    it('registers and lists webhook endpoints', async () => {
      const p = await startServer();
      dispatcher.registerEndpoint({
        url: `http://localhost:${p}/hook`,
        events: ['task.complete'],
        secret: 'test-secret',
      });
      const registered = dispatcher.getRegistered();
      expect(registered).toContain(`http://localhost:${p}/hook`);
    });

    it('unregisters an existing endpoint', async () => {
      const p = await startServer();
      dispatcher.registerEndpoint({
        url: `http://localhost:${p}/hook`,
        events: ['*'],
      });
      dispatcher.unregisterEndpoint(`http://localhost:${p}/hook`);
      expect(dispatcher.getRegistered()).not.toContain(`http://localhost:${p}/hook`);
    });

    it('toggles enabled state without error', async () => {
      const p = await startServer();
      dispatcher.registerEndpoint({
        url: `http://localhost:${p}/hook`,
        events: ['*'],
      });
      dispatcher.setEnabled(`http://localhost:${p}/hook`, false);
      await expect(dispatcher.dispatch('any.event', {})).resolves.not.toThrow();
    });

    });

  describe('dispatch sends real HTTP POST', () => {
    it('sends POST to wildcard-matched endpoint', async () => {
      const p = await startServer();
      dispatcher.registerEndpoint({
        url: `http://localhost:${p}/all`,
        events: ['*'],
      });
      await dispatcher.dispatch('any.event', { task_id: 'test1' });
      // withRetryOnHttpStatus has internal delays
      await delay(500);
      expect(received).toHaveLength(1);
      expect(received[0]!.body.event_type).toBe('any.event');
    });

    it('sends POST only to matching event names', async () => {
      const p = await startServer();
      dispatcher.registerEndpoint({
        url: `http://localhost:${p}/task`,
        events: ['task.complete'],
      });
      await dispatcher.dispatch('task.complete', { task_id: 't2' });
      await delay(500);
      expect(received).toHaveLength(1);
      expect(received[0]!.url).toBe('/task');
    });

    it('skips non-matching events (no request sent)', async () => {
      const p = await startServer();
      dispatcher.registerEndpoint({
        url: `http://localhost:${p}/task`,
        events: ['task.complete'],
      });
      await dispatcher.dispatch('other.event', {});
      await delay(200);
      expect(received).toHaveLength(0);
    });

    it('handles unknown endpoints gracefully (no crash)', async () => {
      await expect(dispatcher.dispatch('any.event', { task_id: 'x' })).resolves.not.toThrow();
    });

    it('sends multiple POST requests on multiple dispatch calls', async () => {
      const p = await startServer();
      dispatcher.registerEndpoint({
        url: `http://localhost:${p}/hook`,
        events: ['*'],
      });
      await dispatcher.dispatch('e1', {});
      await dispatcher.dispatch('e2', {});
      await dispatcher.dispatch('e3', {});
      await delay(500);
      expect(received).toHaveLength(3);
      expect(received[0]!.body.event_type).toBe('e1');
      expect(received[1]!.body.event_type).toBe('e2');
      expect(received[2]!.body.event_type).toBe('e3');
    });

    it('includes X-Webhook-Secret header when secret provided', async () => {
      const p = await startServer();
      dispatcher.registerEndpoint({
        url: `http://localhost:${p}/secure`,
        events: ['*'],
        secret: 'my-secret',
      });
      await dispatcher.dispatch('event', {});
      await delay(500);
      expect(received).toHaveLength(1);
      expect(received[0]!.headers['x-webhook-secret']).toBe('my-secret');
    });
  });
});
