import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import { OpenAIProvider } from '@/llm/openai';

describe('OpenAIProvider stream arg accumulation', () => {
  let server: http.Server;
  let port = 0;

  function createServer(chunks: string[]): Promise<http.Server> {
    return new Promise((resolve, reject) => {
      const srv = http.createServer((_req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        let delay = 0;
        for (const chunk of chunks) {
          const sseData = `data: ${chunk}\n\n`;
          setTimeout(() => { res.write(sseData); }, delay);
          delay += 10;
        }
        setTimeout(() => { res.end(); }, delay + 50);
      });
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address() as import('net').AddressInfo;
        port = addr.port;
        resolve(srv);
      });
      srv.on('error', reject);
    });
  }

  beforeEach(async () => {
    server = await createServer([]);
  });

  afterEach(async () => {
    return new Promise<void>((resolve) => {
      if (server) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
  });

  function getBaseUrl(): string {
    return `http://localhost:${port}/v1`;
  }

  it('yields tool_name chunks for streamed tool calls', async () => {
    const toolChunk = JSON.stringify({
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

    const stopChunk = JSON.stringify({
      id: 'test',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    });

    // Close old server and create new one with chunks
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
    server = await createServer([toolChunk, stopChunk]);

    const provider = new OpenAIProvider({
      baseURL: getBaseUrl(),
      apiKey: 'fake',
      model: 'gpt-4',
    });

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
  });

  it('accumulates argument deltas via stream buffer', async () => {
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

    const argChunk1Data = {
      id: 'test',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '{\\n' } }],
          },
          finish_reason: null,
        },
      ],
    };

    const argChunk2Data = {
      id: 'test',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '"file": "path.txt"\\n}' } }],
          },
          finish_reason: null,
        },
      ],
    };

    const argChunk1 = JSON.stringify(argChunk1Data);
    const argChunk2 = JSON.stringify(argChunk2Data);

    const stopChunk = JSON.stringify({
      id: 'test',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    });

    await new Promise<void>((resolve) => { server.close(() => resolve()); });
    server = await createServer([nameChunk, argChunk1, argChunk2, stopChunk]);

    const provider = new OpenAIProvider({
      baseURL: getBaseUrl(),
      apiKey: 'fake',
      model: 'gpt-4',
    });

    const chunks: Array<{ type: string; text?: string }> = [];
    for await (const chunk of provider.chatStream(
      [{ role: 'user', content: 'read file' }],
      { tools: [] },
    )) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.type === 'tool_name')).toBe(true);
    expect(chunks.some((c) => c.type === 'tool_args_delta')).toBe(true);
  });
});
