import type { Message, ToolCall, ToolDefinition, ChatResponse, ContentBlock, ToolResultBlock, ToolUseBlock } from '@/types';
import type { LLMProvider } from '@/types';
import { MCPDispatcher } from '@/mcp/client';
import { createLogger } from '@/utils/logger';
import { MetricsCollector } from '@/utils/metrics';
import { ContextWindowManager } from './context_manager';
import { type TaskProgressTracker } from './progress';

const logger = createLogger('AgentLoop');

const MAX_ITERATIONS = 50;

export class AgentLoop {
  private llmProvider: LLMProvider;
  private mcpDispatcher: MCPDispatcher;
  private metrics?: MetricsCollector;
  private maxTokens?: number;
  private contextManager: ContextWindowManager;
  private progressTracker?: TaskProgressTracker;
  private currentTaskId?: string;

  constructor(llmProvider: LLMProvider, mcpDispatcher: MCPDispatcher) {
    this.llmProvider = llmProvider;
    this.mcpDispatcher = mcpDispatcher;
    this.contextManager = new ContextWindowManager();
  }

  setMaxTokens(maxTokens: number): void {
    this.maxTokens = maxTokens;
  }

  setContextManager(contextManager: ContextWindowManager): void {
    this.contextManager = contextManager;
  }

  getContextManager(): ContextWindowManager {
    return this.contextManager;
  }

  setMetrics(metrics: MetricsCollector): void {
    this.metrics = metrics;
  }

  setProgressTracker(tracker: TaskProgressTracker, taskId: string): void {
    this.progressTracker = tracker;
    this.currentTaskId = taskId;
  }

  async run(context: AgentContext): Promise<{ messages: Message[]; finalContent: string }> {
    const messages: Message[] = [...context.messages];
    const tools = context.tools;
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      logger.debug(`Agent iteration ${iterations}`);

      if (this.progressTracker && this.currentTaskId) {
        this.progressTracker.recordIteration(this.currentTaskId, iterations, MAX_ITERATIONS);
      }

      // Trim context if needed before each API call
      const trimmedMessages = this.contextManager.trimToFit(messages, this.maxTokens || 190000);

      const response = await this.llmProvider.chat(trimmedMessages, { tools, max_tokens: this.maxTokens });

      if (this.metrics) {
        this.metrics.recordTokens(this.llmProvider.name, response.usage.input_tokens, response.usage.output_tokens);
      }

      if (this.progressTracker && this.currentTaskId) {
        this.progressTracker.recordTokens(this.currentTaskId, response.usage.input_tokens, response.usage.output_tokens);
      }

      const toolUseBlocks: ToolUseBlock[] = response.tool_calls.map((tc) => ({
        type: 'tool_use',
        id: tc.call_id,
        name: tc.tool_name,
        input: tc.parameters as Record<string, unknown>,
      }));
      
      const assistantMsg: Message = {
        role: 'assistant',
        content: response.content.length > 0 && toolUseBlocks.length === 0 ? response.content : [...response.content, ...toolUseBlocks],
      };
      messages.push(assistantMsg);

      if (response.finish_reason === 'stop') {
        return { messages, finalContent: this.extractText(response.content) };
      }

      if (response.tool_calls.length > 0) {
        const results = await this.mcpDispatcher.dispatchBatch(response.tool_calls);
        if (this.progressTracker && this.currentTaskId) {
          for (const tc of response.tool_calls) {
            const result = results.find((r) => r.call_id === tc.call_id);
            this.progressTracker.recordToolCall(this.currentTaskId, tc.tool_name, tc.call_id);
            if (result) {
              this.progressTracker.recordToolResult(this.currentTaskId, tc.tool_name, tc.call_id, result.success);
            }
          }
        }
        const resultBlocks: ToolResultBlock[] = results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.call_id,
          content: r.success ? JSON.stringify(r.data) : `Error: ${r.error}`,
          is_error: !r.success,
        }));

        const toolMsg: Message = {
          role: 'tool',
          content: resultBlocks as ContentBlock[],
        };
        messages.push(toolMsg);
        continue;
      }

      return { messages, finalContent: this.extractText(response.content) };
    }

    throw new Error(`Max iterations (${MAX_ITERATIONS}) exceeded`);
  }

  private extractText(content: ContentBlock[]): string {
    return content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
}

export interface AgentContext {
  messages: Message[];
  tools: ToolDefinition[];
  systemPrompt: string;
}
