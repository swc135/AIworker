import { describe, it, expect } from 'vitest';
import { parseFrontmatter, SkillRegistry } from '@/skills/executor';

describe('parseFrontmatter', () => {
  it('should parse YAML frontmatter', () => {
    const content = `---
name: test-skill
description: A test skill
arguments:
  - name: input
    description: input param
    required: true
---
# Skill Body
Step 1: Do something`;
    const { metadata, body } = parseFrontmatter(content);
    expect(metadata.name).toBe('test-skill');
    expect(metadata.description).toBe('A test skill');
    expect(metadata.arguments).toHaveLength(1);
    expect(metadata.arguments![0]!.name).toBe('input');
    expect(body).toContain('# Skill Body');
  });

  it('should throw on missing frontmatter', () => {
    expect(() => parseFrontmatter('Just text without frontmatter')).toThrow('missing YAML frontmatter');
  });

  it('should handle skills with no arguments', () => {
    const content = `---
name: simple-skill
description: Simple
---
Do something`;
    const { metadata } = parseFrontmatter(content);
    expect(metadata.name).toBe('simple-skill');
    expect(metadata.arguments).toEqual([]);
  });
});

describe('SkillRegistry', () => {
  it('should register and retrieve skills', () => {
    const registry = new SkillRegistry();
    registry.register({
      name: 'test-skill',
      description: 'A test',
      version: '1.0.0',
      arguments: [],
      instructions: 'Do something',
      resource_path: '/path/to/skill',
    });

    expect(registry.has('test-skill')).toBe(true);
    expect(registry.get('test-skill')?.name).toBe('test-skill');
  });

  it('should match skills by keywords', () => {
    const registry = new SkillRegistry();
    registry.register({
      name: 'deploy-website',
      description: 'Deploy and preview web projects',
      version: '1.0.0',
      arguments: [],
      instructions: 'Deploy steps...',
      resource_path: '/path',
    });

    registry.addMatchRule({ keywords: ['deploy', 'preview'], skillName: 'deploy-website' });

    const matched = registry.matchBest('please deploy my website');
    expect(matched).not.toBeNull();
    expect(matched!.name).toBe('deploy-website');
  });

  it('should return null when no skill matches', () => {
    const registry = new SkillRegistry();
    const matched = registry.matchBest('unknown request');
    expect(matched).toBeNull();
  });

  it('should return undefined for unregistered skill', () => {
    const registry = new SkillRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
    expect(registry.has('nonexistent')).toBe(false);
  });
});
