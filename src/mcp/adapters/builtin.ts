import type { ToolCall, ToolResult, ToolDefinition } from '@/types';
import type { ToolAdapter } from '@/mcp/client';
import { createLogger } from '@/utils/logger';
import { execSync, spawn } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import { mkdirSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { resolve } from 'path';
import type { BackgroundTerminal } from '@/types';
import { readTextFile } from '@/utils/fs';

const logger = createLogger('BuiltinAdapter');

const LOG_DIR = '/tmp/opencode';

interface TerminalEntry {
  terminal: BackgroundTerminal;
  process: ReturnType<typeof spawn> | null;
}

export class BuiltinAdapter implements ToolAdapter {
  namespace = 'mcaiBuiltin';
  private terminals: Map<string, TerminalEntry> = new Map();

  constructor() {
    try {
      mkdirSync(LOG_DIR, { recursive: true });
    } catch {
      logger.warn(`Failed to create log directory: ${LOG_DIR}`);
    }
  }

  listTools(): ToolDefinition[] {
    return [
      {
        name: 'mcaiBuiltin_background_terminal_create',
        description: 'Execute a shell command in the background',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The shell command to execute' },
            timeout: { type: 'number', description: 'Timeout in milliseconds' },
          },
          required: ['command'],
        },
      },
      {
        name: 'mcaiBuiltin_background_terminal_list',
        description: 'List all managed terminals',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'mcaiBuiltin_background_terminal_output_path',
        description: 'Get the output file path of a background terminal',
        parameters: {
          type: 'object',
          properties: {
            terminal_id: { type: 'string', description: 'The terminal ID' },
          },
          required: ['terminal_id'],
        },
      },
      {
        name: 'mcaiBuiltin_background_terminal_kill',
        description: 'Kill a background terminal process',
        parameters: {
          type: 'object',
          properties: {
            terminal_id: { type: 'string', description: 'The terminal ID to kill' },
          },
          required: ['terminal_id'],
        },
      },
      {
        name: 'mcaiBuiltin_request_preview',
        description: 'Request a preview URL for a local web server port',
        parameters: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'Local port number (1-65535)' },
          },
          required: ['port'],
        },
      },
    ];
  }

  validate(call: ToolCall): boolean {
    const required: Record<string, string[]> = {
      'mcaiBuiltin_background_terminal_create': ['command'],
      'mcaiBuiltin_background_terminal_kill': ['terminal_id'],
      'mcaiBuiltin_background_terminal_output_path': ['terminal_id'],
      'mcaiBuiltin_request_preview': ['port'],
    };
    const req = required[call.tool_name];
    if (!req) return true;
    return req.every((p) => call.parameters[p] !== undefined);
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const method = call.tool_name.replace('mcaiBuiltin_', '');
    try {
      let data: unknown;
      switch (method) {
        case 'background_terminal_create':
          data = this.handleTerminalCreate(call.parameters);
          break;
        case 'background_terminal_list':
          data = this.handleTerminalList();
          break;
        case 'background_terminal_output_path':
          data = this.handleTerminalOutputPath(call.parameters);
          break;
        case 'background_terminal_kill':
          data = this.handleTerminalKill(call.parameters);
          break;
        case 'request_preview':
          data = this.handleRequestPreview(call.parameters);
          break;
        default:
          return { call_id: call.call_id, success: false, data: null, error: `Unknown tool: ${method}` };
      }
      return { call_id: call.call_id, success: true, data };
    } catch (err) {
      return {
        call_id: call.call_id,
        success: false,
        data: null,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  private handleTerminalCreate(params: Record<string, unknown>): { terminal_id: string } {
    const command = params.command as string;
    const terminalId = `term_${uuidv4().slice(0, 8)}`;
    const logPath = resolve(LOG_DIR, `${terminalId}.log`);

    try {
      // Execute synchronously and capture output for simple commands
      const stdout = execSync(command, {
        timeout: (params.timeout as number) || 120_000,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });

      writeFile(logPath, stdout, 'utf-8').catch(() => {});

      const terminal: BackgroundTerminal = {
        terminal_id: terminalId,
        command,
        status: 'completed',
        exit_code: 0,
        created_at: Date.now(),
        output_log_path: logPath,
      };
      this.terminals.set(terminalId, { terminal, process: null });
      logger.info(`Terminal ${terminalId} completed: ${command}`);

      return { terminal_id: terminalId };
    } catch (err: unknown) {
      const exitCode = (err as { status?: number; stderr?: string })?.status ?? 1;
      const stderr = (err as { stderr?: string })?.stderr ?? String(err);

      writeFile(logPath, stderr, 'utf-8').catch(() => {});

      const terminal: BackgroundTerminal = {
        terminal_id: terminalId,
        command,
        status: 'failed',
        exit_code: exitCode,
        created_at: Date.now(),
        output_log_path: logPath,
      };
      this.terminals.set(terminalId, { terminal, process: null });
      logger.warn(`Terminal ${terminalId} failed (exit ${exitCode}): ${command}`);

      return { terminal_id: terminalId };
    }
  }

  private handleTerminalList(): { terminals: BackgroundTerminal[] } {
    return {
      terminals: Array.from(this.terminals.values()).map((e) => e.terminal),
    };
  }

  private handleTerminalOutputPath(params: Record<string, unknown>): { output_path: string } {
    const terminalId = params.terminal_id as string;
    const entry = this.terminals.get(terminalId);
    if (!entry) {
      throw new Error(`Terminal not found: ${terminalId}`);
    }
    return { output_path: entry.terminal.output_log_path };
  }

  private handleTerminalKill(params: Record<string, unknown>): { killed: boolean } {
    const terminalId = params.terminal_id as string;
    const entry = this.terminals.get(terminalId);
    if (!entry) {
      throw new Error(`Terminal not found: ${terminalId}`);
    }
    if (entry.process) {
      entry.process.kill('SIGTERM');
    }
    entry.terminal.status = 'killed';
    return { killed: true };
  }

  private handleRequestPreview(params: Record<string, unknown>): { access_url: string; preview_id: string } {
    const port = params.port as number;
    const previewId = `preview_${uuidv4().slice(0, 8)}`;
    // In production, the platform intercepts this and provides actual preview URLs.
    // This implementation is a stub that returns a placeholder URL recognized by the platform.
    const accessUrl = `${previewId}://preview.local:${port}`;
    logger.info(`Preview requested for port ${port}: id=${previewId}`);
    return { access_url: accessUrl, preview_id: previewId };
  }
}
