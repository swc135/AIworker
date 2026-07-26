import { describe, it, expect } from 'vitest';
import { OpenAIProvider } from '@/llm/openai';

describe('OpenAIProvider stream arg accumulation', () => {
  const provider = new OpenAIProvider({
    baseURL: 'https://api.openai.com/v1',
    apiKey: 'fake',
    model: 'gpt-4',
  });

  it('yields tool_name chunks for streamed tool calls', async () => {
    const nameChunk = JSON.stringify({
      id: 'test',
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          content: null,
          tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'bash' } }],
        },
        finish_reason: null,
      }],
    });

    const mockResponse = createMockResponse([nameChunk]);
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = () => Promise.resolve(mockResponse);

    try {
      const chunks: Array<{ type: string; text?: string }> = [];
      for await (const chunk of provider.chatStream(
        [{ role: 'user', content: 'list files' }],
        { tools: [] },
      )) {
        chunks.push(chunk);
      }

      const toolNames = chunks.filter((c) => c.type === 'tool_name').map((c) => c.text);
      expect(toolNames.length).toBeGreaterThan(0);
      expect(toolNames[0]).toContain('bash');
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });

  it('accumulates argument deltas via stream buffer', async () => {
    // Build JSON strings using concatenation to avoid esbuild JSX parse issues
    const p1 = '\u007B"file"\u003A\u0020';
    const p2 = '\u0022path"\u003A\u0020\u0022';
    const p3 = 'file.txt\u0022\u007D';

    const nameChunk = JSON.stringify({
      id: 'test',
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          content: null,
          tool_calls: [{ index: 0, id: 'call_x', type: 'function', function: { name: 'read' } }],
        },
        finish_reason: null,
      }],
    });

    const argChunk1 = JSON.stringify({
      id: 'test',
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{ index: 0, function: { arguments: p2 } },
        ],
      },
        finish_reason: null,
      }],
    });

    const argChunk2 = JSON.stringify({
      id: 'test',
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{ index: 0, function: { arguments: p3 } },
        ],
      },
      finish_reason: null,
      }],
    });

    const stopChunk = JSON.stringify({
      id: 'test',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    });

    const mockResponse = createMockResponse([nameChunk, argChunk1, argChunk2, stopChunk]);
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = () => Promise.resolve(mockResponse);

    try {
      const chunks: Array<{ type: string; text?: string }> = [];
      for await (const chunk of provider.chatStream(
        [{ role: 'user', content: 'read file' }],
        { tools: [] },
      )) {
        chunks.push(chunk);
      }

      expect(chunks.some((c) => c.type === 'tool_name')).toBe(true);
      expect(chunks.some((c) => c.type === 'tool_args_delta')).toBe(true);
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });
});

function createMockResponse(chunks: string[]): Response {
  const events = chunks.map((c) => `data: ${c}\n\n`).join('');
  return {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(events));
        controller.close();
      },
    }),
  } as unknown as Response;
}
