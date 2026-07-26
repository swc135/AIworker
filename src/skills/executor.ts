import { readFile, readdir, access } from 'fs/promises';
import { fileExists } from '@/utils/fs';
import { resolve, basename, join } from 'path';
import { parse as parseYaml } from 'yaml';
import type { Skill, SkillArgument } from '@/types';
import { createLogger } from '@/utils/logger';

const logger = createLogger('SkillSystem');

interface SkillFrontmatter {
  name: string;
  description: string;
  arguments?: SkillArgument[];
}

export function parseFrontmatter(content: string): { metadata: SkillFrontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error('Invalid SKILL.md: missing YAML frontmatter');
  }
  const metadata = parseYaml(match[1]!) as SkillFrontmatter;
  const body = match[2]!;
  return {
    metadata: {
      ...metadata,
      arguments: metadata.arguments ?? [],
    },
    body,
  };
}

export async function skillDirExists(dir: string): Promise<boolean> {
  try {
    await access(resolve(dir, 'SKILL.md'));
    return true;
  } catch {
    return false;
  }
}

export class SkillLoader {
  async loadFromPaths(paths: string[]): Promise<Skill[]> {
    const skills: Skill[] = [];
    for (const basePath of paths) {
      if (!(await fileExists(basePath))) {
        logger.debug(`Skills path not found: ${basePath}`);
        continue;
      }
      const entries = await readdir(basePath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillDir = resolve(basePath, entry.name);
        if (await skillDirExists(skillDir)) {
          const skill = await this.loadSingle(skillDir);
          skills.push(skill);
        }
      }
    }
    logger.info(`Loaded ${skills.length} skills`);
    return skills;
  }

  async loadSingle(skillDir: string): Promise<Skill> {
    const skillMdPath = resolve(skillDir, 'SKILL.md');
    const versionFilePath = resolve(skillDir, '.agent-resource-version');

    const content = await readFile(skillMdPath, 'utf-8');
    const { metadata, body } = parseFrontmatter(content);

    let version = '1.0.0';
    try {
      version = (await readFile(versionFilePath, 'utf-8')).trim();
    } catch {
      // version file optional
    }

    return {
      name: metadata.name,
      description: metadata.description,
      version,
      arguments: metadata.arguments ?? [],
      instructions: body,
      resource_path: skillDir,
    };
  }
}

export interface MatchRule {
  keywords: string[];
  skillName: string;
}

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private matchRules: MatchRule[] = [];

  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
    logger.debug(`Registered skill: ${skill.name}`);
  }

  registerAll(skills: Skill[]): void {
    for (const skill of skills) {
      this.register(skill);
    }
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  addMatchRule(rule: MatchRule): void {
    this.matchRules.push(rule);
  }

  matchBest(query: string): Skill | null {
    const lowerQuery = query.toLowerCase();

    for (const rule of this.matchRules) {
      for (const keyword of rule.keywords) {
        if (lowerQuery.includes(keyword.toLowerCase())) {
          const skill = this.skills.get(rule.skillName);
          if (skill) return skill;
        }
      }
    }

    return null;
  }
}

export class SkillExecutor {
  private registry: SkillRegistry;

  constructor(registry: SkillRegistry) {
    this.registry = registry;
  }

  getInstructions(skillName: string): string {
    const skill = this.registry.get(skillName);
    if (!skill) {
      throw new Error(`Skill not found: ${skillName}`);
    }
    return skill.instructions;
  }

  getSkillArgSchema(skillName: string): SkillArgument[] {
    const skill = this.registry.get(skillName);
    if (!skill) {
      throw new Error(`Skill not found: ${skillName}`);
    }
    return skill.arguments;
  }
}
