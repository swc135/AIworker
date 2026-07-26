import { describe, it, expect, afterEach } from 'vitest';
import { OpenAIProvider } from '@/llm/openai';
import type { Message, ContentBlock } from '@/types';

function createMockFetch(data: unknown, status = 200): typeof globalThis.fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body as string | undefined;
    const parsed = body ? JSON.parse(body) : {};

    let responseData = data;
    if (typeof data === 'function') {
      responseData = data(parsed);
    }

    return new Response(JSON.stringify(responseData), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
}

describe('OpenAIProvider', () => {
  const baseConfig = {
    baseURL: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    model: 'gpt-4',
  };

  afterEach(() => {
    globalThis.fetch = undefined as unknown as typeof globalThis.fetch;
  });

  it('should send chat request with correct format', async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = createMockFetch((body: Record<string, unknown>) => {
      capturedBody = body;
      return {
        id: 'chat-1',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    });

    const provider = new OpenAIProvider(baseConfig);
    const messages: Message[] = [{ role: 'user', content: 'Hi there' }];
    const response = await provider.chat(messages);

    expect(capturedBody.model).toBe('gpt-4');
    expect(capturedBody.messages).toEqual([{ role: 'user', content: 'Hi there' }]);
    expect(response.content[0]).toEqual({ type: 'text', text: 'Hello!' });
    expect(response.usage.input_tokens).toBe(10);
    expect(response.usage.output_tokens).toBe(5);
  });

  it('should handle tool calls in response', async () => {
    globalThis.fetch = createMockFetch({
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
    });

    const provider = new OpenAIProvider(baseConfig);
    const messages: Message[] = [{ role: 'user', content: 'Search for hello' }];
    const response = await provider.chat(messages);

    expect(response.tool_calls).toHaveLength(1);
    expect(response.tool_calls[0]!.tool_name).toBe('search');
    expect(response.tool_calls[0]!.parameters).toEqual({ query: 'hello' });
    expect(response.finish_reason).toBe('tool_use');
  });

  it('should include tools in request body', async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = createMockFetch((body: Record<string, unknown>) => {
      capturedBody = body;
      return {
        id: 'chat-3',
        choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      };
    });

    const provider = new OpenAIProvider(baseConfig);
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
    globalThis.fetch = (async () => {
      return new Response('{"error":"invalid_api_key"}', {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    const provider = new OpenAIProvider(baseConfig);
    await expect(provider.chat([{ role: 'user', content: 'test' }])).rejects.toThrow('401');
  });

  it('should stream response chunks', async () => {
    const chunks = [
      'data: {"id":"s1","choices":[{"index":0,"delta":{"content":"Hel"},"finish_reason":null}]}\n',
      'data: {"id":"s1","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}\n',
      'data: [DONE]\n',
    ];

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    globalThis.fetch = (async () => {
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof globalThis.fetch;

    const provider = new OpenAIProvider(baseConfig);
    const results: { type: string; text?: string }[] = [];
    for await (const chunk of provider.chatStream([{ role: 'user', content: 'Hi' }])) {
      results.push(chunk);
    }

    expect(results.filter((r) => r.type === 'text_delta')).toHaveLength(2);
    expect(results.map((r) => r.text).join('')).toBe('Hello');
  });

  it('should use custom model from options', async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = createMockFetch((body: Record<string, unknown>) => {
      capturedBody = body;
      return {
        id: 'chat-4',
        choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      };
    });

    const provider = new OpenAIProvider(baseConfig);
    await provider.chat([{ role: 'user', content: 'test' }], { model: 'gpt-3.5-turbo' });
    expect(capturedBody.model).toBe('gpt-3.5-turbo');
  });

  it('should count tokens', () => {
    const provider = new OpenAIProvider(baseConfig);
    const count = provider.countTokens('Hello world');
    expect(count).toBeGreaterThan(0);
  });
});
