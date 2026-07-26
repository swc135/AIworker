import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileSystemAdapter } from '@/mcp/adapters/filesystem';
import { mkdir, writeFile, rm } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';

const testDir = '/tmp/opencode-fs-adapter-test';

beforeEach(async () => {
  if (existsSync(testDir)) {
    await rm(testDir, { recursive: true, force: true });
  }
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  if (existsSync(testDir)) {
    await rm(testDir, { recursive: true, force: true });
  }
});

function makeCall(tool: string, params: Record<string, unknown>) {
  return { tool_name: tool, parameters: params, call_id: `call_${Date.now()}` };
}

describe('FileSystemAdapter', () => {
  let adapter: FileSystemAdapter;

  beforeEach(() => {
    adapter = new FileSystemAdapter(testDir);
  });

  it('should list all tools', () => {
    const tools = adapter.listTools();
    expect(tools).toHaveLength(5);
    expect(tools.map((t) => t.name).sort()).toEqual(['edit', 'glob', 'grep', 'read', 'write']);
  });

  it('should validate known tools', () => {
    expect(adapter.validate(makeCall('read', { filePath: '/test' }))).toBe(true);
    expect(adapter.validate(makeCall('write', { filePath: '/test', content: 'x' }))).toBe(true);
    expect(adapter.validate(makeCall('unknown', {}))).toBe(false);
  });

  describe('read', () => {
    it('should read file with line numbers', async () => {
      await writeFile(resolve(testDir, 'test.txt'), 'line1\nline2\nline3', 'utf-8');

      const result = await adapter.execute(makeCall('read', { filePath: resolve(testDir, 'test.txt') }));
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('content');
      expect(result.data).toHaveProperty('totalLines', 3);
    });

    it('should support offset and limit', async () => {
      const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n');
      await writeFile(resolve(testDir, 'big.txt'), lines, 'utf-8');

      const result = await adapter.execute(makeCall('read', { filePath: resolve(testDir, 'big.txt'), offset: 3, limit: 2 }));
      expect(result.success).toBe(true);
      const data = result.data as { totalLines: number };
      expect(data.totalLines).toBe(10);
    });

    it('should handle missing file', async () => {
      const result = await adapter.execute(makeCall('read', { filePath: resolve(testDir, 'missing.txt') }));
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('write', () => {
    it('should write content to file', async () => {
      const filePath = resolve(testDir, 'output.txt');
      const result = await adapter.execute(makeCall('write', { filePath, content: 'Hello World' }));
      expect(result.success).toBe(true);

      const content = await import('fs/promises').then((m) => m.readFile(filePath, 'utf-8'));
      expect(content).toBe('Hello World');
    });

    it('should create parent directories', async () => {
      const filePath = resolve(testDir, 'deep/nested/file.txt');
      const result = await adapter.execute(makeCall('write', { filePath, content: 'deep' }));
      expect(result.success).toBe(true);
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('edit', () => {
    it('should replace single occurrence', async () => {
      const filePath = resolve(testDir, 'edit.txt');
      await writeFile(filePath, 'Hello World', 'utf-8');

      const result = await adapter.execute(makeCall('edit', { filePath, oldString: 'World', newString: 'Universe' }));
      expect(result.success).toBe(true);
      const data = result.data as { replacements: number };
      expect(data.replacements).toBe(1);

      const content = await import('fs/promises').then((m) => m.readFile(filePath, 'utf-8'));
      expect(content).toBe('Hello Universe');
    });

    it('should replace all occurrences', async () => {
      const filePath = resolve(testDir, 'edit2.txt');
      await writeFile(filePath, 'foo bar foo', 'utf-8');

      const result = await adapter.execute(makeCall('edit', { filePath, oldString: 'foo', newString: 'baz', replaceAll: true }));
      expect(result.success).toBe(true);
      const data = result.data as { replacements: number };
      expect(data.replacements).toBe(2);

      const content = await import('fs/promises').then((m) => m.readFile(filePath, 'utf-8'));
      expect(content).toBe('baz bar baz');
    });

    it('should error on oldString not found', async () => {
      const filePath = resolve(testDir, 'edit3.txt');
      await writeFile(filePath, 'hello', 'utf-8');

      const result = await adapter.execute(makeCall('edit', { filePath, oldString: 'xyz', newString: 'abc' }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should error on multiple matches without replaceAll', async () => {
      const filePath = resolve(testDir, 'edit4.txt');
      await writeFile(filePath, 'dup dup dup', 'utf-8');

      const result = await adapter.execute(makeCall('edit', { filePath, oldString: 'dup', newString: 'x' }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('multiple');
    });
  });

  describe('glob', () => {
    it('should find files matching pattern', async () => {
      await writeFile(resolve(testDir, 'a.ts'), 'a', 'utf-8');
      await writeFile(resolve(testDir, 'b.js'), 'b', 'utf-8');
      await mkdir(resolve(testDir, 'sub'), { recursive: true });
      await writeFile(resolve(testDir, 'sub/c.ts'), 'c', 'utf-8');

      const result = await adapter.execute(makeCall('glob', { pattern: '**/*.ts' }));
      expect(result.success).toBe(true);
      const data = result.data as { entries: unknown[] };
      expect(data.entries.length).toBe(2);
    });

    it('should handle directory patterns', async () => {
      await mkdir(resolve(testDir, 'subdir'), { recursive: true });
      await writeFile(resolve(testDir, 'subdir/file.ts'), 'data', 'utf-8');

      const result = await adapter.execute(makeCall('glob', { pattern: '**/*' }));
      expect(result.success).toBe(true);
      const data = result.data as { entries: unknown[] };
      expect(data.entries.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('grep', () => {
    it('should find matching lines', async () => {
      await writeFile(resolve(testDir, 'grep.txt'), 'Hello World\nFoo Bar\nHello Again\n', 'utf-8');

      const result = await adapter.execute(makeCall('grep', { pattern: 'Hello' }));
      expect(result.success).toBe(true);
      const data = result.data as { matches: unknown[] };
      expect(data.matches.length).toBe(2);
    });

    it('should support include filter', async () => {
      await writeFile(resolve(testDir, 'a.ts'), 'const x = 1;\n', 'utf-8');
      await writeFile(resolve(testDir, 'b.js'), 'const y = 2;\n', 'utf-8');

      const result = await adapter.execute(makeCall('grep', { pattern: 'const', include: '*.ts' }));
      expect(result.success).toBe(true);
      const data = result.data as { matches: unknown[] };
      expect(data.matches.length).toBe(1);
    });

    it('should skip node_modules directory', async () => {
      await mkdir(resolve(testDir, 'node_modules/pkg'), { recursive: true });
      await writeFile(resolve(testDir, 'node_modules/pkg/index.js'), 'secret\n', 'utf-8');
      await writeFile(resolve(testDir, 'src.ts'), 'public\n', 'utf-8');

      const secretResult = await adapter.execute(makeCall('grep', { pattern: 'secret' }));
      expect((secretResult.data as { matches: unknown[] }).matches.length).toBe(0);

      const publicResult = await adapter.execute(makeCall('grep', { pattern: 'public' }));
      expect((publicResult.data as { matches: unknown[] }).matches.length).toBe(1);
    });
  });
});
