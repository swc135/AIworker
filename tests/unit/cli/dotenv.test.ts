import { describe, it, expect } from 'vitest';
import { DotEnvLoader } from '@/cli/dotenv';
import { writeFile, mkdir } from 'fs/promises';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

describe('DotEnvLoader', () => {
  const testDir = `/tmp/opencode-dotenv-test-${randomUUID()}`;

  it('should load valid env variables', async () => {
    await mkdir(testDir, { recursive: true });
    
    const envContent = [
      'USER_LLM_API_KEY=my-secret-key',
      'USER_LLM_BASE_URL=https://api.openai.com/v1',
      'USER_LLM_MODEL=gpt-4',
      '# This is a comment',
      'EMPTY_VALUE=',
    ].join('\n');
    
    await writeFile(resolve(testDir, '.env'), envContent);
    
    const loader = new DotEnvLoader();
    const result = await loader.load(resolve(testDir, '.env'));
    
    expect(result.loaded).toBe(true);
    expect(result.variables.USER_LLM_API_KEY).toBe('my-secret-key');
    expect(result.variables.USER_LLM_BASE_URL).toBe('https://api.openai.com/v1');
    expect(result.variables.USER_LLM_MODEL).toBe('gpt-4');
    expect(result.variables.EMPTY_VALUE).toBe('');
    expect(loader.has('USER_LLM_API_KEY')).toBe(true);
  });

  it('should handle missing env file gracefully', async () => {
    const loader = new DotEnvLoader();
    const result = await loader.load('/nonexistent/path/.env');
    
    expect(result.loaded).toBe(false);
    expect(result.variables).toEqual({});
  });

  it('should skip comments and empty lines', async () => {
    await mkdir(testDir, { recursive: true });
    
    const envContent = [
      '',
      '# Comment line',
      '   ',
      'KEY=value',
      '# Another comment',
    ].join('\n');
    
    await writeFile(resolve(testDir, '.env.comments'), envContent);
    
    const loader = new DotEnvLoader();
    const result = await loader.load(resolve(testDir, '.env.comments'));
    
    expect(result.loaded).toBe(true);
    expect(Object.keys(result.variables).length).toBe(1);
    expect(result.variables.KEY).toBe('value');
  });

  it('should support quoted values', async () => {
    await mkdir(testDir, { recursive: true });
    
    const envContent = [
      'DOUBLE_QUOTED="hello world"',
      "SINGLE_QUOTED='hello world'",
      'UNQUOTED=no quotes',
    ].join('\n');
    
    await writeFile(resolve(testDir, '.env.quotes'), envContent);
    
    const loader = new DotEnvLoader();
    const result = await loader.load(resolve(testDir, '.env.quotes'));
    
    expect(result.variables.DOUBLE_QUOTED).toBe('hello world');
    expect(result.variables.SINGLE_QUOTED).toBe('hello world');
    expect(result.variables.UNQUOTED).toBe('no quotes');
  });

  it('should not overwrite existing process.env variables', async () => {
    process.env.TEST_OVERRIDE = 'existing-value';
    
    await mkdir(testDir, { recursive: true });
    
    const envContent = 'TEST_OVERRIDE=new-value\nNEW_VAR=added';
    await writeFile(resolve(testDir, '.env.override'), envContent);
    
    const loader = new DotEnvLoader();
    await loader.load(resolve(testDir, '.env.override'));
    
    expect(process.env.TEST_OVERRIDE).toBe('existing-value');
    expect(process.env.NEW_VAR).toBe('added');
    
    delete process.env.TEST_OVERRIDE;
  });
});
