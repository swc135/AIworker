import type { Message, ToolCall, ToolDefinition, ChatResponse, ContentBlock, ToolResultBlock, ToolUseBlock } from '@/types';
import type { LLMProvider } from '@/types';
import { MCPDispatcher } from '@/mcp/client';
import { createLogger } from '@/utils/logger';

const logger = createLogger('AgentLoop');

const MAX_ITERATIONS = 50;

export class AgentLoop {
  private llmProvider: LLMProvider;
  private mcpDispatcher: MCPDispatcher;

  constructor(llmProvider: LLMProvider, mcpDispatcher: MCPDispatcher) {
    this.llmProvider = llmProvider;
    this.mcpDispatcher = mcpDispatcher;
  }

  async run(context: AgentContext): Promise<{ messages: Message[]; finalContent: string }> {
    const messages: Message[] = [...context.messages];
    const tools = context.tools;
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      logger.debug(`Agent iteration ${iterations}`);

      const response = await this.llmProvider.chat(messages, { tools });

      const assistantMsg: Message = {
        role: 'assistant',
        content: response.content,
      };
      messages.push(assistantMsg);

      if (response.finish_reason === 'stop') {
        return { messages, finalContent: this.extractText(response.content) };
      }

      if (response.tool_calls.length > 0) {
        const results = await this.mcpDispatcher.dispatchBatch(response.tool_calls);
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
