import { readTextFile, fileExists } from '@/utils/fs';
import { createLogger } from '@/utils/logger';
import { resolve } from 'path';

const logger = createLogger('Config');

export interface LLMProviderConfig {
  npm: string;
  name: string;
  options: {
    baseURL: string;
    apiKey?: string;
  };
  models: Record<string, {
    limit: { context: number; output: number };
  }>;
}

export interface SkillConfig {
  paths: string[];
}

export interface OpenCodeConfig {
  snapshot: boolean;
  model: string;
  agent: { title: { disable: boolean } };
  provider: Record<string, LLMProviderConfig>;
  disabled_providers: string[];
  instructions: string[];
  skills: SkillConfig;
  modelConfig?: {
    provider: string;
    model?: string;
    baseURL?: string;
    apiKey?: string;
  };
}

const DEFAULT_CONFIG: OpenCodeConfig = {
  snapshot: false,
  model: 'monkeycode-ai/monkeycode-basic/qwen3.5-plus',
  agent: { title: { disable: true } },
  provider: {
    'monkeycode-ai': {
      npm: '@ai-sdk/anthropic',
      name: 'monkeycode-ai',
      options: { baseURL: 'https://proxy.monkeycode-ai.com/v1' },
      models: {
        'monkeycode-basic/qwen3.5-plus': {
          limit: { context: 200000, output: 32000 },
        },
      },
    },
  },
  disabled_providers: ['openai', 'opencode'],
  instructions: ['rules/*.md'],
  skills: { paths: ['skills/'] },
};

export class ConfigLoader {
  private configPath: string;

  constructor(basePath: string) {
    this.configPath = resolve(basePath, 'opencode.json');
  }

  async load(): Promise<OpenCodeConfig> {
    if (await fileExists(this.configPath)) {
      try {
        const raw = await readTextFile(this.configPath);
        const config = JSON.parse(raw) as Partial<OpenCodeConfig>;
        logger.info(`Loaded config from ${this.configPath}`);

        return {
          ...DEFAULT_CONFIG,
          ...config,
          agent: { ...DEFAULT_CONFIG.agent, ...config.agent },
          skills: { ...DEFAULT_CONFIG.skills, ...config.skills },
          provider: config.provider || DEFAULT_CONFIG.provider,
          modelConfig: config.modelConfig,
        };
      } catch (err) {
        logger.warn(`Failed to load config, using defaults: ${err}`);
      }
    }

    logger.info('No config file found, using defaults');
    return { ...DEFAULT_CONFIG };
  }

  async loadFromPath(path: string): Promise<OpenCodeConfig> {
    const raw = await readTextFile(path);
    const config = JSON.parse(raw) as Partial<OpenCodeConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...config,
      agent: { ...DEFAULT_CONFIG.agent, ...config.agent },
      skills: { ...DEFAULT_CONFIG.skills, ...config.skills },
      provider: config.provider || DEFAULT_CONFIG.provider,
      modelConfig: config.modelConfig,
    };
  }
}
