import { describe, it, expect } from 'vitest';
import { WebAdapter } from '@/mcp/adapters/web';

function makeCall(tool: string, params: Record<string, unknown>) {
  return { tool_name: tool, parameters: params, call_id: `call_${Date.now()}` };
}

describe('WebAdapter', () => {
  const adapter = new WebAdapter();

  it('should list all tools', () => {
    const tools = adapter.listTools();
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name).sort()).toEqual(['webfetch', 'websearch_aisearch', 'websearch_search']);
  });

  it('should validate known tools', () => {
    expect(adapter.validate(makeCall('webfetch', { url: 'https://example.com' }))).toBe(true);
    expect(adapter.validate(makeCall('websearch_search', { query: 'test' }))).toBe(true);
    expect(adapter.validate(makeCall('websearch_aisearch', { query: 'test' }))).toBe(true);
    expect(adapter.validate(makeCall('unknown', {}))).toBe(false);
  });

  it('should fetch web page content (markdown conversion)', async () => {
    const http = await import('http');
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h2>Section</h2><p>Text with <strong>bold</strong> and <em>italic</em>.</p><a href="https://example.com">Link</a></body></html>');
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as { port: number };

    try {
      const result = await adapter.execute(makeCall('webfetch', {
        url: `http://localhost:${addr.port}`,
        format: 'markdown',
        timeout: 5,
      }));

      expect(result.success).toBe(true);
      const data = result.data as { content: string };
      expect(data.content).toContain('## Section');
      expect(data.content).toContain('**bold**');
      expect(data.content).toContain('*italic*');
      expect(data.content).toContain('[Link](https://example.com)');
    } finally {
      server.close();
    }
  });

  it('should return raw HTML when format is html', async () => {
    const http = await import('http');
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<p>Plain text</p>');
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as { port: number };

    try {
      const result = await adapter.execute(makeCall('webfetch', {
        url: `http://localhost:${addr.port}`,
        format: 'html',
        timeout: 5,
      }));

      expect(result.success).toBe(true);
      const data = result.data as { content: string };
      expect(data.content).toContain('<p>Plain text</p>');
    } finally {
      server.close();
    }
  });

  it('should return error for invalid URL', async () => {
    const result = await adapter.execute(makeCall('webfetch', {
      url: 'http://localhost:1/nonexistent',
      timeout: 1,
    }));
    expect(result.success).toBe(false);
  });

  it('should handle HTTP error responses', async () => {
    const http = await import('http');
    const server = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end('Not Found');
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as { port: number };

    try {
      const result = await adapter.execute(makeCall('webfetch', {
        url: `http://localhost:${addr.port}`,
        timeout: 5,
      }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('404');
    } finally {
      server.close();
    }
  });

  it('should handle websearch with failed network gracefully', async () => {
    // Without network access, should fallback to mock
    const result = await adapter.execute(makeCall('websearch_search', {
      query: 'test search',
      count: 3,
    }));
    expect(result.success).toBe(true);
    const data = result.data as { results: unknown[]; query: string };
    expect(Array.isArray(data.results)).toBe(true);
  }, 25000);

  it('should synthesize AI search from fallback data', async () => {
    const result = await adapter.execute(makeCall('websearch_aisearch', {
      query: 'typescript programming',
    }));
    expect(result.success).toBe(true);
    const data = result.data as { answer: string; sources: unknown[] };
    expect(typeof data.answer).toBe('string');
    expect(data.sources).toBeDefined();
  }, 25000);

  it('should handle empty search gracefully', async () => {
    const result = await adapter.execute(makeCall('websearch_search', {
      query: '',
    }));
    expect(result.success).toBe(true);
  }, 25000);
});
