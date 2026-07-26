import { describe, it, expect } from 'vitest';
import { AnthropicProvider } from '@/llm/anthropic';

function createTestServer(
  handler: (req: import('http').IncomingMessage, res: import('http').ServerResponse) => void | Promise<void>,
): Promise<{ server: import('http').Server; port: number }> {
  return new Promise((resolve, reject) => {
    const srv = require('http').createServer(handler);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as import('net').AddressInfo;
      resolve({ server: srv, port: addr.port });
    });
    srv.on('error', reject);
  });
}

describe('AnthropicProvider', () => {
  it('should send chat request with correct format', async () => {
    let capturedBody: Record<string, unknown>;
    let capturedPath: string;
    
    const resultPromise = createTestServer(async (req, res) => {
      capturedPath = req.url || '';
      let raw = '';
      req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
      req.on('end', () => {
        capturedBody = raw ? JSON.parse(raw) : {};
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'msg-1',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello!' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }));
      });
    });
    const { server, port: testPort } = await resultPromise;

    const provider = new AnthropicProvider({
      baseURL: `http://localhost:${testPort}/v1`,
      apiKey: 'test-key',
      model: 'claude-3',
    });
    
    const messages: import('@/types').Message[] = [{ role: 'user', content: 'Hi there' }];
    const response = await provider.chat(messages);

    expect(capturedBody?.model).toBe('claude-3');
    expect(capturedBody?.messages).toBeDefined();
    expect(response.content[0]).toEqual({ type: 'text', text: 'Hello!' });
    
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  });

  it('should handle tool calls in response', async () => {
    const resultPromise = createTestServer(async (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg-2',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call_1', name: 'search', input: { query: 'hello' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 20, output_tokens: 10 },
      }));
    });
    const { server, port: testPort } = await resultPromise;

    const provider = new AnthropicProvider({
      baseURL: `http://localhost:${testPort}/v1`,
      apiKey: 'test-key',
      model: 'claude-3',
    });
    
    const messages: import('@/types').Message[] = [{ role: 'user', content: 'Search for hello' }];
    const response = await provider.chat(messages);

    expect(response.tool_calls).toHaveLength(1);
    expect(response.tool_calls[0]!.tool_name).toBe('search');
    expect(response.tool_calls[0]!.parameters).toEqual({ query: 'hello' });
    expect(response.finish_reason).toBe('tool_use');
    
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  });

  it('should stream response chunks', async () => {
    const events = [
      { event: 'content_block_start', data: JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) },
      { event: 'content_block_delta', data: JSON.stringify({ type: 'delta', delta: { type: 'text', text: 'Hel' } }) },
      { event: 'content_block_delta', data: JSON.stringify({ type: 'delta', delta: { type: 'text', text: 'lo' } }) },
      { event: 'message_delta', data: JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) },
    ];

    let resolvedPort = -1;
    const streamResultPromise = new Promise<{ server: import('http').Server; port: number }>((resolve, reject) => {
      const srv = require('http').createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const sseLines = [
          `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`,
          `event: content_block_delta\ndata: ${JSON.stringify({ type: 'delta', delta: { type: 'text', text: 'Hel' } })}\n\n`,
          `event: content_block_delta\ndata: ${JSON.stringify({ type: 'delta', delta: { type: 'text', text: 'lo' } })}\n\n`,
          `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })}\n\n`,
        ];
        for (let i = 0; i < sseLines.length; i++) {
          setTimeout(() => { res.write(sseLines[i]); }, i * 30);
        }
        setTimeout(() => { res.end(); }, sseLines.length * 30 + 100);
      });
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address() as import('net').AddressInfo;
        resolvedPort = addr.port;
        resolve({ server: srv, port: addr.port });
      });
      srv.on('error', reject);
    });

    const streamResult = await streamResultPromise;

    const provider = new AnthropicProvider({
      baseURL: `http://localhost:${streamResult.port}/v1`,
      apiKey: 'test-key',
      model: 'claude-3',
    });

    const results: { type: string; text?: string }[] = [];
    for await (const chunk of provider.chatStream([{ role: 'user', content: 'Hi' }])) {
      results.push(chunk);
    }

    expect(results.filter((r) => r.type === 'text_delta')).toHaveLength(2);
    expect(results.map((r) => r.text).join('')).toBe('Hello');

    await new Promise<void>((resolve) => { streamResult.server.close(() => resolve()); });
  }, 10000);

  it('should use rate limiter to control concurrent requests', async () => {
    const provider = new AnthropicProvider({
      baseURL: 'http://localhost:9999/v1',
      apiKey: 'test-key',
      model: 'claude-3',
    }, { maxRequests: 10, windowMs: 60000, maxConcurrent: 2 });
    
    const limiter = provider.getRateLimiter();
    expect(limiter.isAvailable()).toBe(true);
    expect(limiter.getConfig().maxRequests).toBe(10);
  });
});
