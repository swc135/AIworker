import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigLoader } from '@/cli/config';
import { writeFile, mkdir, rm } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';

const testDir = '/tmp/opencode-test-config';
const configPath = resolve(testDir, 'opencode.json');

beforeEach(async () => {
  if (existsSync(testDir)) {
    await rm(testDir, { recursive: true, force: true });
  }
  await mkdir(testDir, { recursive: true });
});

describe('ConfigLoader', () => {
  it('should return defaults when no config file exists', async () => {
    const loader = new ConfigLoader(testDir);
    const config = await loader.load();
    expect(config.model).toBe('monkeycode-ai/monkeycode-basic/qwen3.5-plus');
    expect(config.instructions).toContain('rules/*.md');
  });

  it('should load from existing config file', async () => {
    await writeFile(configPath, JSON.stringify({
      model: 'custom/model',
      instructions: ['custom/rules/*.md'],
    }), 'utf-8');

    const loader = new ConfigLoader(testDir);
    const config = await loader.load();
    expect(config.model).toBe('custom/model');
    expect(config.instructions).toContain('custom/rules/*.md');
  });

  it('should load from custom path', async () => {
    const customPath = resolve(testDir, 'custom-config.json');
    await writeFile(customPath, JSON.stringify({
      model: 'path/model',
      skills: { paths: ['my-skills/'] },
    }), 'utf-8');

    const loader = new ConfigLoader(testDir);
    const config = await loader.loadFromPath(customPath);
    expect(config.model).toBe('path/model');
    expect(config.skills.paths).toContain('my-skills/');
  });

  it('should merge partial config with defaults', async () => {
    await writeFile(configPath, JSON.stringify({
      model: 'partial-model',
    }), 'utf-8');

    const loader = new ConfigLoader(testDir);
    const config = await loader.load();
    expect(config.model).toBe('partial-model');
    expect(config.skills.paths).toEqual(['skills/']); // default preserved
    expect(config.instructions).toEqual(['rules/*.md']); // default preserved
  });
});
