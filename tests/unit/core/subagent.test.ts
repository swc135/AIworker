import { describe, it, expect } from 'vitest';
import { SubagentOrchestrator } from '@/core/subagent';
import { MockLLMProvider } from '@/llm/provider';

describe('SubagentOrchestrator', () => {
  let mockLlm: MockLLLMProvider;
  let orchestrator: SubagentOrchestrator;

  beforeEach(() => {
    mockLlm = new MockLLMProvider();
    const mcpDispatcher = {
      listAllTools: () => [],
      dispatchBatch: async (calls: Array<{ tool_name: string; parameters: Record<string, unknown>; call_id: string }>) => {
        return calls.map((c) => ({ call_id: c.call_id, success: true, data: null }));
      },
    };
    // @ts-ignore - minimal dispatcher for tests
    orchestrator = new SubagentOrchestrator(mockLlm, mcpDispatcher);
  });

  describe('submit', () => {
    it('creates a pending task with auto-generated id', async () => {
      const taskId = await orchestrator.submit({
        task_id: '',
        description: 'test task',
        prompt: 'Do something',
      });
      expect(taskId).toBeTruthy();
      const task = orchestrator.getTask(taskId);
      expect(task).toBeDefined();
      expect(task!.status).toBe('pending');
    });

    it('uses provided task_id when given', async () => {
      const taskId = await orchestrator.submit({
        task_id: 'custom_id_123',
        description: 'named task',
        prompt: 'Named',
      });
      expect(taskId).toBe('custom_id_123');
    });
  });

  describe('execute', () => {
    it('runs a simple text-only task', async () => {
      mockLlm.setResponse('simple test', ['Done!']);
      const taskId = await orchestrator.submit({
        task_id: 'simple',
        description: 'simple test',
        prompt: 'You are a subagent. Your task: do the task.',
      });
      const result = await orchestrator.execute(taskId);
      expect(result).toContain('Done');
      const task = orchestrator.getTask(taskId);
      expect(task!.status).toBe('completed');
    });

    it('reports error for missing task', async () => {
      await expect(orchestrator.execute('nonexistent')).rejects.toThrow('not found');
    });

    it('tracks completed_at timestamp', async () => {
      mockLlm.setResponse('task description', ['Done for timing']);
      const taskId = await orchestrator.submit({
        task_id: 'timed',
        description: 'timing test',
        prompt: 'Task description here. Reply with Done for timing.',
      });
      await orchestrator.execute(taskId);
      const task = orchestrator.getTask(taskId)!;
      expect(task.completed_at).toBeDefined();
      expect(typeof task.completed_at).toBe('number');
    });

    it('respects maxIterations limit', async () => {
      mockLlm.setResponse('Always call tools', [
        { type: 'tool_use', id: 't1', name: 'bash', input: {} },
      ] as any);
      const taskId = await orchestrator.submit({
        task_id: 'limited',
        description: 'iteration limit test',
        prompt: 'Your prompt: Always call tools. Reply with this exact phrase.',
        maxIterations: 3,
      });
      const result = await orchestrator.execute(taskId);
      expect(result).toBeTruthy();
    });
  });

  describe('filterTools', () => {
    it('returns empty array when no tools registered', () => {
      const tools = orchestrator.filterTools();
      expect(tools).toEqual([]);
    });

    it('includes tasks without filter', () => {
      const tools = orchestrator.filterTools(undefined);
      expect(Array.isArray(tools)).toBe(true);
    });
  });

  describe('listTasks', () => {
    it('returns all submitted tasks', async () => {
      await orchestrator.submit({ task_id: 'a', description: 'A', prompt: 'A' });
      await orchestrator.submit({ task_id: 'b', description: 'B', prompt: 'B' });
      const tasks = orchestrator.listTasks();
      expect(tasks.length).toBe(2);
    });
  });

  describe('executeBatch', () => {
    it('executes tasks sequentially', async () => {
      mockLlm.setResponse('Task: Batch 1', ['Done batch 1']);
      mockLlm.setResponse('Task: Batch 2', ['Done batch 2']);
      const tasks = [
        { task_id: 'bt1', description: 'Batch 1', prompt: 'Task: Batch 1. Reply with Done batch 1.' },
        { task_id: 'bt2', description: 'Batch 2', prompt: 'Task: Batch 2. Reply with Done batch 2.' },
      ];
      const results = await orchestrator.executeBatch(tasks);
      expect(results.size).toBe(2);
    });
  });
});
