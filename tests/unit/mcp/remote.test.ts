import { describe, it, expect } from 'vitest';
import { RemoteAdapter } from '@/mcp/adapters/remote';

describe('RemoteAdapter', () => {
  it('should list all remote tools', () => {
    const adapter = new RemoteAdapter(true);
    const tools = adapter.listTools();

    expect(tools.length).toBeGreaterThan(10);
    expect(tools.some((t) => t.name.includes('websearch_search'))).toBe(true);
    expect(tools.some((t) => t.name.includes('docparse_parse'))).toBe(true);
    expect(tools.some((t) => t.name.includes('image_analysis'))).toBe(true);
    expect(tools.some((t) => t.name.includes('query-docs'))).toBe(true);
  });

  it('should validate required parameters', () => {
    const adapter = new RemoteAdapter(true);

    // Missing required 'query' parameter
    expect(adapter.validate({
      tool_name: 'monkeycode-ai_MonkeyCode__websearch_search',
      parameters: {},
      call_id: '1',
    })).toBe(false);

    // Has required 'query' parameter
    expect(adapter.validate({
      tool_name: 'monkeycode-ai_MonkeyCode__websearch_search',
      parameters: { query: 'test' },
      call_id: '2',
    })).toBe(true);
  });

  it('should execute websearch mock', async () => {
    const adapter = new RemoteAdapter(true);
    const result = await adapter.execute({
      tool_name: 'monkeycode-ai_MonkeyCode__websearch_search',
      parameters: { query: 'test query' },
      call_id: '3',
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('results');
  });

  it('should execute docparse mock', async () => {
    const adapter = new RemoteAdapter(true);
    const result = await adapter.execute({
      tool_name: 'monkeycode-ai_MonkeyCode__docparse_parse',
      parameters: { url: 'https://example.com/doc.pdf' },
      call_id: '4',
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('document_id');
    expect(result.data).toHaveProperty('status', 'processing');
  });

  it('should execute image analysis mock', async () => {
    const adapter = new RemoteAdapter(true);
    const result = await adapter.execute({
      tool_name: 'monkeycode-ai_MonkeyCode__image_analysis_create_task',
      parameters: { url: 'https://example.com/image.png' },
      call_id: '5',
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('task_id');
  });

  it('should resolve library ID mock', async () => {
    const adapter = new RemoteAdapter(true);
    const result = await adapter.execute({
      tool_name: 'monkeycode-ai_MonkeyCode__resolve-library-id',
      parameters: { libraryName: 'React', query: 'How to use hooks' },
      call_id: '6',
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('results');
  });

  it('should return error for unknown tool', async () => {
    const adapter = new RemoteAdapter(true);
    const result = await adapter.execute({
      tool_name: 'monkeycode-ai_MonkeyCode__nonexistent_tool',
      parameters: {},
      call_id: '7',
    });

    expect(result.success).toBe(false);
  });
});
