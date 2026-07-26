import { describe, it, expect, beforeEach } from 'vitest';
import { MemorySystem } from '@/core/memory';
import { workspacePath } from '@/utils/fs';
import { mkdir, writeFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

const testWorkspace = '/tmp/opencode-test-memory';
const memoryDir = resolve(testWorkspace, '.monkeycode');
const memoryFile = resolve(memoryDir, 'MEMORY.md');

beforeEach(async () => {
  if (existsSync(testWorkspace)) {
    await rm(testWorkspace, { recursive: true, force: true });
  }
  await mkdir(memoryDir, { recursive: true });
});

describe('MemorySystem', () => {
  it('should return empty when no MEMORY.md exists', async () => {
    const mem = new MemorySystem(testWorkspace);
    const entries = await mem.load();
    expect(entries).toEqual([]);
  });

  it('should load existing entries', async () => {
    await writeFile(memoryFile, `# 用户指令记忆

## 条目

### Test Memory
- Date: 2026-07-26
- Context: Testing
- Instructions:
  - Always respond in Chinese
  - Run tests before committing
`, 'utf-8');

    const mem = new MemorySystem(testWorkspace);
    const entries = await mem.load();
    expect(entries.length).toBe(1);
    expect(entries[0]!.summary).toBe('Test Memory');
    expect(entries[0]!.instructions).toContain('Always respond in Chinese');
  });

  it('should save new entries', async () => {
    const mem = new MemorySystem(testWorkspace);
    await mem.load();

    await mem.save({
      summary: 'New Instruction',
      date: '2026-07-26',
      context: 'User request',
      instructions: ['Use pnpm instead of npm'],
    });

    const entries = await mem.load();
    expect(entries.length).toBeGreaterThan(0);
  });

  it('should skip duplicate entries', async () => {
    const mem = new MemorySystem(testWorkspace);
    await mem.load();

    const entry = {
      summary: 'Use pnpm',
      date: '2026-07-26',
      context: 'User request',
      instructions: ['Use pnpm for all package operations'],
    };

    await mem.save(entry);
    await mem.save(entry); // Duplicate

    const entries = await mem.load();
    // Should still be 1 entry, not 2
    expect(entries.length).toBe(1);
  });

  it('should handle multiple entries', async () => {
    const mem = new MemorySystem(testWorkspace);
    await mem.load();

    await mem.save({
      summary: 'Entry 1',
      date: '2026-07-26',
      context: 'Context 1',
      instructions: ['Rule 1', 'Rule 2'],
    });

    await mem.save({
      summary: 'Entry 2',
      date: '2026-07-26',
      context: 'Context 2',
      instructions: ['Rule A', 'Rule B'],
    });

    const entries = await mem.load();
    expect(entries.length).toBe(2);
  });
});
