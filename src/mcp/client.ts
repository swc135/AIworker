import type { ToolCall, ToolResult, ToolDefinition } from '@/types';
import { createLogger } from '@/utils/logger';

const logger = createLogger('MCP');

export class ToolError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ToolError';
  }
}

export interface ToolAdapter {
  namespace: string;
  listTools(): ToolDefinition[];
  execute(call: ToolCall): Promise<ToolResult>;
  validate(call: ToolCall): boolean;
}

export class MCPDispatcher {
  private adapters: Map<string, ToolAdapter> = new Map();
  private rateLimiter: RateLimiter;

  constructor() {
    this.rateLimiter = new RateLimiter();
  }

  getAdapter(namespace: string): ToolAdapter | undefined {
    return this.adapters.get(namespace);
  }

  registerAdapter(adapter: ToolAdapter): void {
    this.adapters.set(adapter.namespace, adapter);
    logger.debug(`Registered MCP adapter: ${adapter.namespace}`);
  }

  listAdapters(): string[] {
    return [...this.adapters.keys()];
  }

  private extractNamespace(toolName: string): string {
    // Try double-underscore first (complex namespaces like monkeycode-ai_internal)
    let idx = toolName.indexOf('__');
    if (idx >= 0) return toolName.substring(0, idx);
    // Fall back to single underscore (simple namespaces like mcaiBuiltin)
    idx = toolName.indexOf('_');
    return idx >= 0 ? toolName.substring(0, idx) : toolName;
  }

  async dispatch(call: ToolCall): Promise<ToolResult> {
    const namespace = this.extractNamespace(call.tool_name);
    const adapter = this.adapters.get(namespace);

    if (!adapter) {
      return {
        call_id: call.call_id,
        success: false,
        data: null,
        error: `Tool not found: ${call.tool_name} (namespace: ${namespace})`,
      };
    }

    if (!adapter.validate(call)) {
      return {
        call_id: call.call_id,
        success: false,
        data: null,
        error: `Invalid parameters for tool: ${call.tool_name}`,
      };
    }

    const allowed = await this.rateLimiter.checkLimit(call.tool_name);
    if (!allowed) {
      return {
        call_id: call.call_id,
        success: false,
        data: null,
        error: `Rate limited: ${call.tool_name}`,
      };
    }

    try {
      const result = await adapter.execute(call);
      return result;
    } catch (err) {
      logger.error(`Tool execution failed: ${call.tool_name} - ${err}`);
      return {
        call_id: call.call_id,
        success: false,
        data: null,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  async dispatchBatch(calls: ToolCall[]): Promise<ToolResult[]> {
    const results: Promise<ToolResult>[] = calls.map((call) => this.dispatch(call));
    return Promise.all(results);
  }

  listAllTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const adapter of this.adapters.values()) {
      tools.push(...adapter.listTools());
    }
    return tools;
  }
}

export class RateLimiter {
  private limits: Map<string, number[]> = new Map();
  private maxCallsPerMinute = 60;

  async checkLimit(toolName: string): Promise<boolean> {
    const now = Date.now();
    const windowMs = 60_000;

    let calls = this.limits.get(toolName);
    if (!calls) {
      calls = [];
      this.limits.set(toolName, calls);
    }

    calls = calls.filter((t) => now - t < windowMs);
    this.limits.set(toolName, calls);

    if (calls.length >= this.maxCallsPerMinute) {
      return false;
    }

    calls.push(now);
    return true;
  }
}
