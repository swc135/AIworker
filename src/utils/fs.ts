import { readFile, access, writeFile as fsWriteFile, mkdir } from 'fs/promises';
import { resolve, join, dirname } from 'path';
import { existsSync } from 'fs';
import type { Rule, RuleCategory, Skill, TaskConfig } from '@/types';

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function fileExistsSync(path: string): boolean {
  return existsSync(path);
}

export async function readTextFile(path: string): Promise<string> {
  return readFile(path, 'utf-8');
}

export async function safeReadTextFile(path: string): Promise<string | null> {
  try {
    return await readTextFile(path);
  } catch {
    return null;
  }
}

export function workspacePath(workspace: string, ...segments: string[]): string {
  return resolve(workspace, ...segments);
}

export async function writeFile(path: string, data: string, _encoding?: string): Promise<void> {
  return fsWriteFile(path, data, 'utf-8');
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}
