import type { ToolCall, ToolResult, ToolDefinition } from '@/types';
import { createLogger } from '@/utils/logger';
import { RateLimiter } from '@/security/rate_limiter';

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
    this.rateLimiter = new RateLimiter({ maxRequests: 60, windowMs: 60_000 });
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
    let idx = toolName.indexOf('__');
    if (idx >= 0) return toolName.substring(0, idx);
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

    try {
      await this.rateLimiter.acquire();
      this.rateLimiter.recordRequest();
      const result = await adapter.execute(call);
      this.rateLimiter.release();
      return result;
    } catch (err) {
      this.rateLimiter.release();
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
