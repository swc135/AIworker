import { execSync } from 'child_process';
import { fileExists, readTextFile, workspacePath } from '@/utils/fs';
import { createLogger } from '@/utils/logger';
import { basename } from 'path';

const logger = createLogger('Git');

export class GitHelper {
  private workspace: string;

  constructor(workspace: string) {
    this.workspace = workspace;
  }

  exec(args: string): string {
    try {
      return execSync(`git ${args}`, {
        cwd: this.workspace,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30_000,
      }).trim();
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? String(err);
      logger.warn(`Git command failed: git ${args} - ${stderr}`);
      throw err;
    }
  }

  async hasSubmodules(): Promise<boolean> {
    return fileExists(workspacePath(this.workspace, '.gitmodules'));
  }

  async initSubmodules(): Promise<void> {
    if (!(await this.hasSubmodules())) {
      logger.debug('No submodules found');
      return;
    }

    try {
      this.exec('submodule update --init --recursive --depth 1');
      logger.info('Submodules initialized');
    } catch {
      logger.warn('Failed to initialize submodules');
    }
  }

  async getChangedSubmodules(): Promise<string[]> {
    if (!(await this.hasSubmodules())) return [];

    try {
      const output = this.exec('submodule foreach --quiet \'if [ -n "$(git status --porcelain)" ]; then echo "$sm_path"; fi\'');
      return output.split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  getCurrentBranch(): string {
    try {
      return this.exec('rev-parse --abbrev-ref HEAD');
    } catch {
      return 'unknown';
    }
  }

  getStatus(): { staged: string[]; unstaged: string[]; untracked: string[] } {
    try {
      const output = this.exec('status --porcelain');
      const staged: string[] = [];
      const unstaged: string[] = [];
      const untracked: string[] = [];

      for (const line of output.split('\n').filter(Boolean)) {
        const status = line.substring(0, 2);
        const file = line.substring(3);
        if (status.trim().length === 0) continue;
        if (status[0] !== ' ') staged.push(file);
        if (status[1] !== ' ') unstaged.push(file);
        if (status === '??') untracked.push(file);
      }

      return { staged, unstaged, untracked };
    } catch {
      return { staged: [], unstaged: [], untracked: [] };
    }
  }

  createBranch(name: string): void {
    this.exec(`checkout -b ${name}`);
    logger.info(`Created branch: ${name}`);
  }

  stageAll(): void {
    this.exec('add .');
  }

  commit(message: string): void {
    this.exec(`commit -m "${message.replace(/"/g, '\\"')}"`);
    logger.info(`Committed: ${message}`);
  }

  push(branch: string): void {
    try {
      this.exec(`push -u origin ${branch}`);
      logger.info(`Pushed branch: ${branch}`);
    } catch {
      logger.warn(`Failed to push branch: ${branch}`);
    }
  }

  async getCommitHistory(count = 10): Promise<string[]> {
    try {
      const output = this.exec(`log --oneline -${count}`);
      return output.split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  async hasUncommittedChanges(): Promise<boolean> {
    try {
      const output = this.exec('status --porcelain');
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  generateBranchName(type: 'feat' | 'fix' | 'chore' | 'refactor', description: string): string {
    const now = new Date();
    const dateStr = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const slug = description.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    return `${dateStr}-${type}-${slug}`;
  }
}

export class CredentialHelper {
  static async getCredentialHelper(): Promise<string | null> {
    try {
      const output = execSync('git config --get credential.helper', {
        encoding: 'utf-8',
        timeout: 5_000,
      }).trim();
      return output || null;
    } catch {
      return null;
    }
  }

  static async getCredentials(host: string): Promise<{ username: string; password: string } | null> {
    try {
      const input = `protocol=https\nhost=${host}\n`;
      const output = execSync('git credential fill', {
        encoding: 'utf-8',
        timeout: 10_000,
        input,
      });

      const username = output.match(/username=(.+)/)?.[1];
      const password = output.match(/password=(.+)/)?.[1];

      if (username && password) {
        return { username, password };
      }
      return null;
    } catch {
      return null;
    }
  }
}
