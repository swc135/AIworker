import { globSync } from 'fs';
import { resolve, basename } from 'path';
import type { Rule, RuleCategory } from '@/types';
import { readTextFile } from '@/utils/fs';
import { createLogger } from '@/utils/logger';

const logger = createLogger('RuleEngine');

const CATEGORY_PRIORITIES: Record<string, { category: RuleCategory; priority: number }> = {
  guardrail: { category: 'security', priority: 100 },
  'no-read-llm-env': { category: 'security', priority: 95 },
  'no-system-admin': { category: 'security', priority: 90 },
  'no-delete': { category: 'security', priority: 85 },
  'agent-identity': { category: 'behavior', priority: 60 },
  'talk-normal': { category: 'behavior', priority: 55 },
  'no-emoji': { category: 'behavior', priority: 54 },
  'simplified-chinese': { category: 'behavior', priority: 53 },
  'auto-use-skills': { category: 'workflow', priority: 40 },
  'auto-deploy': { category: 'workflow', priority: 35 },
  'auto-feature': { category: 'workflow', priority: 34 },
  'user-teaching': { category: 'workflow', priority: 33 },
  'code-quality': { category: 'code_quality', priority: 50 },
  'submodule': { category: 'git_management', priority: 15 },
  'go-mod': { category: 'git_management', priority: 14 },
  git: { category: 'git_management', priority: 13 },
  frontend: { category: 'infrastructure', priority: 20 },
  vite: { category: 'infrastructure', priority: 19 },
  global: { category: 'infrastructure', priority: 18 },
  local: { category: 'infrastructure', priority: 17 },
  mermaid: { category: 'infrastructure', priority: 16 },
  mcp: { category: 'infrastructure', priority: 15 },
  shell: { category: 'infrastructure', priority: 14 },
};

export function inferCategory(filename: string): { category: RuleCategory; priority: number } {
  const name = basename(filename, '.md').toLowerCase();
  for (const [key, value] of Object.entries(CATEGORY_PRIORITIES)) {
    if (name.includes(key)) {
      return value;
    }
  }
  return { category: 'project_management', priority: 10 };
}

export class RuleLoader {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async loadAll(globPattern: string): Promise<Rule[]> {
    const fullPattern = resolve(this.basePath, globPattern);
    const files = globSync(fullPattern);
    logger.info(`Loading ${files.length} rules from ${fullPattern}`);

    const rules: Rule[] = [];
    for (const filePath of files) {
      try {
        const content = await readTextFile(filePath);
        const { category, priority } = inferCategory(basename(filePath));
        rules.push({
          filename: basename(filePath),
          category,
          content,
          priority,
        });
      } catch (err) {
        logger.warn(`Failed to load rule ${filePath}: ${err}`);
      }
    }

    return rules.sort((a, b) => b.priority - a.priority);
  }
}

export class ContextInjector {
  inject(rules: Rule[], baseContext: string): string {
    const instructions = rules
      .map((rule) => `Instructions from: ${rule.filename}\n\n${rule.content}`)
      .join('\n\n---\n\n');

    return `${baseContext}\n\n${instructions}`;
  }

  estimateTokens(rules: Rule[]): number {
    return rules.reduce((sum, rule) => sum + Math.ceil(rule.content.length / 4), 0);
  }
}

export class RuleEngine {
  private rules: Rule[] = [];
  private loader: RuleLoader;
  private injector: ContextInjector;

  constructor(basePath: string) {
    this.loader = new RuleLoader(basePath);
    this.injector = new ContextInjector();
  }

  get rulesList(): Rule[] {
    return [...this.rules];
  }

  async loadFromGlob(globPattern: string): Promise<void> {
    this.rules = await this.loader.loadAll(globPattern);
  }

  injectToContext(baseContext: string): string {
    return this.injector.inject(this.rules, baseContext);
  }

  filterByCategory(category: RuleCategory): Rule[] {
    return this.rules.filter((r) => r.category === category);
  }
}
