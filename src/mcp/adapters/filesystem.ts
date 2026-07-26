import type { ToolCall, ToolResult, ToolDefinition } from '@/types';
import type { ToolAdapter } from '@/mcp/client';
import { createLogger } from '@/utils/logger';
import { readdir, readFile, writeFile, stat, mkdir } from 'fs/promises';
import type { Dirent } from 'fs';
import { existsSync } from 'fs';
import { resolve, dirname, join, relative, basename } from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const logger = createLogger('FileSystemAdapter');

const MAX_READ_LINES = 200;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

interface GlobEntry {
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
}

export class FileSystemAdapter implements ToolAdapter {
  namespace = 'filesystem';
  private workspace: string;

  constructor(workspace: string = process.cwd()) {
    this.workspace = workspace;
  }

  setWorkspace(workspace: string): void {
    this.workspace = workspace;
  }

  listTools(): ToolDefinition[] {
    return [
      {
        name: 'read',
        description: 'Read a file from the local filesystem. Supports offset and limit for partial reads.',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Absolute path to the file' },
            offset: { type: 'number', description: 'Line number to start from (1-indexed)' },
            limit: { type: 'number', description: 'Maximum number of lines to read' },
          },
          required: ['filePath'],
        },
      },
      {
        name: 'write',
        description: 'Write content to a file, creating parent directories if needed.',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Absolute path to write to' },
            content: { type: 'string', description: 'Content to write' },
          },
          required: ['filePath', 'content'],
        },
      },
      {
        name: 'edit',
        description: 'Perform exact string replacements in a file.',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Absolute path to the file' },
            oldString: { type: 'string', description: 'The text to replace' },
            newString: { type: 'string', description: 'The replacement text' },
            replaceAll: { type: 'boolean', description: 'Replace all occurrences' },
          },
          required: ['filePath', 'oldString', 'newString'],
        },
      },
      {
        name: 'glob',
        description: 'Find files matching a glob pattern.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Glob pattern (e.g. "src/**/*.ts")' },
            path: { type: 'string', description: 'Directory to search in. Defaults to workspace.' },
          },
          required: ['pattern'],
        },
      },
      {
        name: 'grep',
        description: 'Search file contents using regular expressions.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Regex pattern to search for' },
            path: { type: 'string', description: 'Directory to search in. Defaults to workspace.' },
            include: { type: 'string', description: 'File pattern filter (e.g. "*.ts")' },
          },
          required: ['pattern'],
        },
      },
    ];
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const base = { call_id: call.call_id, success: false, data: null };

    try {
      switch (call.tool_name) {
        case 'read':
          return await this.handleRead(call, base);
        case 'write':
          return await this.handleWrite(call, base);
        case 'edit':
          return await this.handleEdit(call, base);
        case 'glob':
          return await this.handleGlob(call, base);
        case 'grep':
          return await this.handleGrep(call, base);
        default:
          return { ...base, error: `Unknown tool: ${call.tool_name}` };
      }
    } catch (err) {
      return { ...base, error: (err as Error).message };
    }
  }

  validate(call: ToolCall): boolean {
    const validTools = ['read', 'write', 'edit', 'glob', 'grep'];
    return validTools.includes(call.tool_name);
  }

  private resolvePath(filePath: string): string {
    if (filePath.startsWith('/')) return filePath;
    return resolve(this.workspace, filePath);
  }

  private async handleRead(call: ToolCall, base: { call_id: string; success: boolean; data: unknown }): Promise<ToolResult> {
    const filePath = this.resolvePath(call.parameters.filePath as string);
    const offset = (call.parameters.offset as number) || 1;
    const limit = (call.parameters.limit as number) || MAX_READ_LINES;

    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const totalLines = lines.length;
    const start = offset - 1;
    const end = Math.min(start + limit, totalLines);
    const selected = lines.slice(start, end);

    const result = selected.map((line, i) => `${start + i + 1}: ${line}`).join('\n');
    return {
      ...base,
      success: true,
      data: { content: result, totalLines, offset, limit, filePath },
    };
  }

  private async handleWrite(call: ToolCall, base: { call_id: string; success: boolean; data: unknown }): Promise<ToolResult> {
    const filePath = this.resolvePath(call.parameters.filePath as string);
    const content = call.parameters.content as string;

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf-8');
    logger.info(`Wrote file: ${filePath}`);

    return { ...base, success: true, data: { path: filePath, size: Buffer.byteLength(content, 'utf-8') } };
  }

  private async handleEdit(call: ToolCall, base: { call_id: string; success: boolean; data: unknown }): Promise<ToolResult> {
    const filePath = this.resolvePath(call.parameters.filePath as string);
    const oldString = call.parameters.oldString as string;
    const newString = call.parameters.newString as string;
    const replaceAll = call.parameters.replaceAll as boolean;

    const content = await readFile(filePath, 'utf-8');

    if (!content.includes(oldString)) {
      return { ...base, error: 'oldString not found in content' };
    }

    let count = 0;
    let replacement = content;
    if (replaceAll) {
      const parts = content.split(oldString);
      count = parts.length - 1;
      replacement = parts.join(newString);
    } else {
      const firstIndex = content.indexOf(oldString);
      if (content.indexOf(oldString, firstIndex + 1) !== -1) {
        return { ...base, error: 'Found multiple matches for oldString. Provide more surrounding context.' };
      }
      count = 1;
      replacement = content.slice(0, firstIndex) + newString + content.slice(firstIndex + oldString.length);
    }

    await writeFile(filePath, replacement, 'utf-8');
    logger.info(`Edited file: ${filePath} (${count} replacements)`);

    return { ...base, success: true, data: { path: filePath, replacements: count } };
  }

  private async handleGlob(call: ToolCall, base: { call_id: string; success: boolean; data: unknown }): Promise<ToolResult> {
    const pattern = call.parameters.pattern as string;
    const searchPath = call.parameters.path ? this.resolvePath(call.parameters.path as string) : this.workspace;
    const entries = await this.globSearch(searchPath, pattern);

    return { ...base, success: true, data: { entries, count: entries.length, pattern, path: searchPath } };
  }

  private async handleGrep(call: ToolCall, base: { call_id: string; success: boolean; data: unknown }): Promise<ToolResult> {
    const pattern = call.parameters.pattern as string;
    const searchPath = call.parameters.path ? this.resolvePath(call.parameters.path as string) : this.workspace;
    const include = call.parameters.include as string | undefined;

    const regex = new RegExp(pattern);
    const results = await this.grepSearch(searchPath, regex, include);

    return { ...base, success: true, data: { matches: results, count: results.length, pattern, path: searchPath } };
  }

  private async globSearch(dir: string, pattern: string): Promise<GlobEntry[]> {
    const results: GlobEntry[] = [];
    const regex = this.globToRegex(pattern);

    async function walk(current: string, basePath: string) {
      let entries: Dirent[];
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = join(current, entry.name);
        const relPath = '/' + relative(basePath, fullPath);

        if (entry.isDirectory()) {
          if (regex.test(relPath + '/') || regex.test(relPath)) {
            try {
              const st = await stat(fullPath);
              results.push({ path: relPath, type: 'directory', size: st.size, modified: st.mtime.toISOString() });
            } catch { /* skip */ }
          }
          await walk(fullPath, basePath);
        } else if (entry.isFile()) {
          if (regex.test(relPath)) {
            try {
              const st = await stat(fullPath);
              results.push({ path: relPath, type: 'file', size: st.size, modified: st.mtime.toISOString() });
            } catch { /* skip */ }
          }
        }
      }
    }

    await walk(dir, dir);
    results.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
    return results;
  }

  private async grepSearch(dir: string, regex: RegExp, include?: string): Promise<{ filePath: string; line: number; content: string }[]> {
    const results: { filePath: string; line: number; content: string }[] = [];
    const includeRegex = include ? this.globToRegex(include) : null;

    async function walk(current: string) {
      let entries: Dirent[];
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = join(current, entry.name);
        const relPath = '/' + relative(dir, fullPath);

        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== '.git') {
            await walk(fullPath);
          }
        } else if (entry.isFile()) {
          if (includeRegex && !includeRegex.test(entry.name) && !includeRegex.test(relPath)) continue;

          try {
            const st = await stat(fullPath);
            if (st.size > MAX_FILE_SIZE) continue;
          } catch {
            continue;
          }

          try {
            const stream = createReadStream(fullPath, { encoding: 'utf-8' });
            const rl = createInterface({ input: stream, crlfDelay: Infinity });
            let lineNum = 0;
            for await (const line of rl) {
              lineNum++;
              if (regex.test(line)) {
                results.push({ filePath: relPath, line: lineNum, content: line.slice(0, 500) });
              }
            }
          } catch { /* skip unreadable files */ }
        }
      }
    }

    await walk(dir);
    return results;
  }

  private globToRegex(pattern: string): RegExp {
    let regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/{{GLOBSTAR}}/g, '.*');
    return new RegExp('^' + regex + '$');
  }
}
