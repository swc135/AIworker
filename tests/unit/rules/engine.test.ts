import { describe, it, expect } from 'vitest';
import { inferCategory, ContextInjector } from '@/rules/engine';

describe('inferCategory', () => {
  it('should infer security category for guardrail', () => {
    const result = inferCategory('guardrail.md');
    expect(result.category).toBe('security');
    expect(result.priority).toBe(100);
  });

  it('should infer behavior category for agent-identity', () => {
    const result = inferCategory('agent-identity.md');
    expect(result.category).toBe('behavior');
    expect(result.priority).toBe(60);
  });

  it('should return default category for unknown files', () => {
    const result = inferCategory('unknown-thing.md');
    expect(result.category).toBe('project_management');
    expect(result.priority).toBe(10);
  });

  it('should handle filenames without extension', () => {
    const result = inferCategory('guardrail');
    expect(result.category).toBe('security');
  });
});

describe('ContextInjector', () => {
  it('should inject rules into context', () => {
    const injector = new ContextInjector();
    const rules = [
      { filename: 'rule1.md', category: 'behavior' as const, content: 'Be nice', priority: 60 },
      { filename: 'rule2.md', category: 'security' as const, content: 'No attacks', priority: 100 },
    ];
    const result = injector.inject(rules, 'Base context');
    expect(result).toContain('Base context');
    expect(result).toContain('Instructions from: rule1.md');
    expect(result).toContain('Instructions from: rule2.md');
    expect(result).toContain('Be nice');
    expect(result).toContain('No attacks');
  });

  it('should estimate tokens', () => {
    const injector = new ContextInjector();
    const rules = [
      { filename: 'rule.md', category: 'behavior' as const, content: 'Be nice and helpful to all users', priority: 60 },
    ];
    const tokens = injector.estimateTokens(rules);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBe(Math.ceil('Be nice and helpful to all users'.length / 4));
  });
});
