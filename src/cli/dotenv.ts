import { readTextFile, fileExists } from '@/utils/fs';
import { createLogger } from '@/utils/logger';
import { resolve } from 'path';

const logger = createLogger('DotEnv');

export interface DotEnvConfig {
  loaded: boolean;
  variables: Record<string, string>;
}

export class DotEnvLoader {
  private vars: Record<string, string> = {};

  async load(envPath?: string): Promise<DotEnvConfig> {
    const paths = envPath ? [envPath] : ['.env', '.env.local'];
    
    for (const path of paths) {
      const fullPath = resolve(process.cwd(), path);
      if (await fileExists(fullPath)) {
        try {
          const content = await readTextFile(fullPath);
          this.parse(content);
          logger.info(`Loaded .env from ${fullPath}`);
          return { loaded: true, variables: { ...this.vars } };
        } catch (err) {
          logger.warn(`Failed to load ${path}: ${err}`);
        }
      }
    }

    return { loaded: false, variables: {} };
  }

  private parse(content: string): void {
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      // Match KEY=VALUE or KEY="VALUE" or KEY='VALUE'
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match) {
        let value = match[2];
        
        // Remove quotes
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        
        this.vars[match[1]] = value;
      }
    }
    
    // Inject into process.env
    for (const [key, value] of Object.entries(this.vars)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }

  getVariables(): Record<string, string> {
    return { ...this.vars };
  }

  has(key: string): boolean {
    return key in this.vars || key in process.env;
  }

  get(key: string): string | undefined {
    return this.vars[key] || process.env[key];
  }
}
