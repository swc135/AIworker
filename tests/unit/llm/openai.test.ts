import { describe, it, expect, afterEach } from 'vitest';
import http, { IncomingMessage, ServerResponse } from 'http';
import { OpenAIProvider } from '@/llm/openai';
import type { Message, ContentBlock } from '@/types';

async function createTestServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as import('net').AddressInfo;
      resolve({ server: srv, port: addr.port });
    });
    srv.on('error', reject);
  });
}

describe('OpenAIProvider', () => {
  let port: number;
  let capturedBody: Record<string, unknown>;
  let capturedPath: string;
  let requestHandler: http.Server;

  afterEach(async () => {
    if (requestHandler) {
      await new Promise<void>((resolve) => {
        requestHandler.close(() => resolve());
      });
    }
  });

  it('should send chat request with correct format', async () => {
    capturedBody = {};
    capturedPath = '';
    const resultPromise = createTestServer(async (req, res) => {
      capturedPath = req.url || '';
      let raw = '';
      req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
      req.on('end', () => {
        capturedBody = raw ? JSON.parse(raw) : {};
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chat-1',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }));
      });
    });
    const { server, port: testPort } = await resultPromise;
    requestHandler = server;
    port = testPort;

    const provider = new OpenAIProvider({
      baseURL: `http://localhost:${port}/v1`,
      apiKey: 'test-key',
      model: 'gpt-4',
    });
    const messages: Message[] = [{ role: 'user', content: 'Hi there' }];
    const response = await provider.chat(messages);

    expect(capturedBody.model).toBe('gpt-4');
    expect(capturedBody.messages).toEqual([{ role: 'user', content: 'Hi there' }]);
    expect(response.content[0]).toEqual({ type: 'text', text: 'Hello!' });
    expect(response.usage.input_tokens).toBe(10);
    expect(response.usage.output_tokens).toBe(5);
  });

  it('should handle tool calls in response', async () => {
    capturedBody = {};
    capturedPath = '';
    const resultPromise = createTestServer(async (req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
      req.on('end', () => {
        capturedBody = raw ? JSON.parse(raw) : {};
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chat-2',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'call_1',
                type: 'function',
                function: { name: 'search', arguments: '{"query":"hello"}' },
              }],
            },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        }));
      });
    });
    const { server, port: testPort } = await resultPromise;
    requestHandler = server;
    port = testPort;

    const provider = new OpenAIProvider({
      baseURL: `http://localhost:${port}/v1`,
      apiKey: 'test-key',
      model: 'gpt-4',
    });
    const messages: Message[] = [{ role: 'user', content: 'Search for hello' }];
    const response = await provider.chat(messages);

    expect(response.tool_calls).toHaveLength(1);
    expect(response.tool_calls[0]!.tool_name).toBe('search');
    expect(response.tool_calls[0]!.parameters).toEqual({ query: 'hello' });
    expect(response.finish_reason).toBe('tool_use');
  });

  it('should include tools in request body', async () => {
    capturedBody = {};
    capturedPath = '';
    const resultPromise = createTestServer(async (req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
      req.on('end', () => {
        capturedBody = raw ? JSON.parse(raw) : {};
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chat-3',
          choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        }));
      });
    });
    const { server, port: testPort } = await resultPromise;
    requestHandler = server;
    port = testPort;

    const provider = new OpenAIProvider({
      baseURL: `http://localhost:${port}/v1`,
      apiKey: 'test-key',
      model: 'gpt-4',
    });
    const messages: Message[] = [{ role: 'user', content: 'test' }];
    await provider.chat(messages, {
      tools: [{
        name: 'search',
        description: 'Search the web',
        parameters: { type: 'object', properties: { query: { type: 'string', description: 'Query' } }, required: ['query'] },
      }],
    });

    expect(capturedBody.tools).toBeDefined();
    expect(Array.isArray(capturedBody.tools)).toBe(true);
  });

  it('should handle API errors', async () => {
    const resultPromise = createTestServer(async (req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_api_key' }));
    });
    const { server, port: testPort } = await resultPromise;
    requestHandler = server;
    port = testPort;

    const provider = new OpenAIProvider({
      baseURL: `http://localhost:${port}/v1`,
      apiKey: 'test-key',
      model: 'gpt-4',
    });
    await expect(provider.chat([{ role: 'user', content: 'test' }])).rejects.toThrow('401');
  });

  it('should stream response chunks', async () => {
    const chunkResponses = [
      { id: 's1', choices: [{ index: 0, delta: { content: 'Hel' }, finish_reason: null }] },
      { id: 's1', choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: null }] },
      { id: 's1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ];

    const streamResult = await new Promise<{ server: http.Server; port: number }>((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          for (const cr of chunkResponses) {
            const sseData = `data: ${JSON.stringify(cr)}\n\n`;
            res.write(sseData);
          }
          res.end();
        });
      });
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address() as import('net').AddressInfo;
        resolve({ server: srv, port: addr.port });
      });
      srv.on('error', reject);
    });

    requestHandler = streamResult.server;
    port = streamResult.port;

    const provider = new OpenAIProvider({
      baseURL: `http://localhost:${port}/v1`,
      apiKey: 'test-key',
      model: 'gpt-4',
    });
    const results: { type: string; text?: string }[] = [];
    for await (const chunk of provider.chatStream([{ role: 'user', content: 'Hi' }])) {
      results.push(chunk);
    }

    expect(results.filter((r) => r.type === 'text_delta')).toHaveLength(2);
    expect(results.map((r) => r.text).join('')).toBe('Hello');
  });

  it('should use custom model from options', async () => {
    capturedBody = {};
    capturedPath = '';
    const resultPromise = createTestServer(async (req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
      req.on('end', () => {
        capturedBody = raw ? JSON.parse(raw) : {};
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chat-4',
          choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
        }));
      });
    });
    const { server: srv2, port: testPort2 } = await resultPromise;
    requestHandler = srv2;
    port = testPort2;

    const provider = new OpenAIProvider({
      baseURL: `http://localhost:${port}/v1`,
      apiKey: 'test-key',
      model: 'gpt-4',
    });
    await provider.chat([{ role: 'user', content: 'test' }], { model: 'gpt-3.5-turbo' });
    expect(capturedBody.model).toBe('gpt-3.5-turbo');
  });

  it('should count tokens', () => {
    const provider = new OpenAIProvider({
      baseURL: 'http://localhost:9999/v1',
      apiKey: 'test-key',
      model: 'gpt-4',
    });
    const count = provider.countTokens('Hello world');
    expect(count).toBeGreaterThan(0);
  });
});
