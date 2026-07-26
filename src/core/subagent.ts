import { createLogger } from '@/utils/logger';
import type { Message, ToolCall, ToolResult, ToolDefinition, ChatResponse, ContentBlock } from '@/types';
import type { LLMProvider } from '@/types';
import { MCPDispatcher } from '@/mcp/client';
import { AgentLoop } from './agent';
import { ContextWindowManager } from './context_manager';

const logger = createLogger('Subagent');

export type SubagentStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface SubagentTask {
  task_id: string;
  description: string;
  prompt: string;
  tools?: string[];
  maxIterations?: number;
  status: SubagentStatus;
  result?: string;
  error?: string;
  created_at: number;
  completed_at?: number;
}

export class SubagentOrchestrator {
  private tasks: Map<string, SubagentTask> = new Map();
  private mcpDispatcher: MCPDispatcher;
  private llmProvider: LLMProvider;

  constructor(llmProvider: LLMProvider, mcpDispatcher: MCPDispatcher) {
    this.llmProvider = llmProvider;
    this.mcpDispatcher = mcpDispatcher;
  }

  async submit(task: Omit<SubagentTask, 'status' | 'created_at'>): Promise<string> {
    const task_id = task.task_id || `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const subagentTask: SubagentTask = {
      ...task,
      status: 'pending',
      created_at: Date.now(),
    };
    this.tasks.set(task_id, subagentTask);
    logger.info(`Submitted subagent task: ${task.description} (${task_id})`);
    return task_id;
  }

  async execute(taskId: string): Promise<string> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Subagent task not found: ${taskId}`);

    task.status = 'running';
    task.created_at = Date.now();

    try {
      // Build system message with context window limits
      const contextManager = new ContextWindowManager();
      const maxTokens = contextManager['maxTokens'];

      const messages: Message[] = [
        { role: 'system', content: task.prompt },
        { role: 'user', content: `Execute the following task: ${task.description}` },
      ];

      const tools = this.filterTools(task.tools);
      let iterations = 0;
      const maxIter = task.maxIterations || 30;

      while (iterations < maxIter) {
        iterations++;
        const trimmed = contextManager.trimToFit(messages, maxTokens || 190000);

        const response = await this.llmProvider.chat(trimmed, { tools });
        
        const toolUseBlocks: Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }> = response.tool_calls.map((tc) => ({
          type: 'tool_use',
          id: tc.call_id,
          name: tc.tool_name,
          input: tc.parameters as Record<string, unknown>,
        }));
        
        const allContent = toolUseBlocks.length > 0 ? [...response.content, ...toolUseBlocks] : response.content;
        messages.push({ role: 'assistant', content: allContent });

        if (response.finish_reason === 'stop') {
          const textBlocks = response.content.filter((b) => b.type === 'text') as Array<{ type: 'text'; text: string }>;
          task.result = textBlocks.map((b) => b.text).join('\n');
          break;
        }

        if (response.tool_calls.length > 0) {
          const results = await this.mcpDispatcher.dispatchBatch(response.tool_calls);
          const toolMsg: Message = {
            role: 'tool',
            content: results.map((r) => ({
              type: 'tool_result' as const,
              tool_use_id: r.call_id,
              content: r.success ? JSON.stringify(r.data) : `Error: ${r.error}`,
              is_error: !r.success,
            })) as ContentBlock[],
          };
          messages.push(toolMsg);
          continue;
        }
        break;
      }

      task.status = 'completed';
      task.completed_at = Date.now();
      logger.info(`Subagent task completed: ${taskId} (${iterations} iterations)`);
      return task.result || '';
    } catch (err) {
      task.status = 'failed';
      task.error = err instanceof Error ? err.message : 'Unknown error';
      task.completed_at = Date.now();
      logger.error(`Subagent task failed: ${taskId} - ${task.error}`);
      throw err;
    }
  }

  filterTools(includeNames?: string[]): ToolDefinition[] {
    if (!includeNames || includeNames.length === 0) {
      return this.mcpDispatcher.listAllTools();
    }
    const allTools = this.mcpDispatcher.listAllTools();
    return allTools.filter((t) => includeNames.some((n) => t.name.includes(n)));
  }

  getTask(taskId: string): SubagentTask | undefined {
    return this.tasks.get(taskId);
  }

  listTasks(): SubagentTask[] {
    return [...this.tasks.values()];
  }

  async executeBatch(tasks: Omit<SubagentTask, 'status' | 'created_at'>[]): Promise<Map<string, string>> {
    const results = new Map<string, string>();

    for (const task of tasks) {
      const taskId = await this.submit(task);
      const result = await this.execute(taskId);
      results.set(taskId, result);
    }

    return results;
  }
}
