import { describe, it, expect, beforeEach } from 'vitest';
import { TaskOrchestrator } from '@/core/task_orchestrator';
import { createLogger } from '@/utils/logger';

const logger = createLogger('CLITest');

describe('CLI Integration', () => {
  let orchestrator: TaskOrchestrator;

  beforeEach(async () => {
    if (orchestrator) return;
    orchestrator = new TaskOrchestrator();
    await orchestrator.initialize('/tmp/opencode-cli-test');
  });

  it('should display system info via info command', async () => {
    const mcpDispatcher = orchestrator.getMCPDispatcher();
    const tools = mcpDispatcher.listAllTools();
    const adapters = mcpDispatcher.listAdapters();

    expect(tools.length).toBeGreaterThan(0);
    expect(adapters.length).toBeGreaterThan(0);
    expect(adapters.some((a) => a === 'mcaiBuiltin')).toBe(true);
    expect(adapters.some((a) => a === 'filesystem')).toBe(true);
    expect(adapters.some((a) => a === 'web')).toBe(true);
  });

  it('should have metrics collector available', () => {
    expect(orchestrator.metrics).toBeDefined();
    const snap = orchestrator.metrics.getSnapshot();
    expect(snap).toHaveProperty('taskCount');
    expect(snap).toHaveProperty('apiCallCount');
    expect(snap).toHaveProperty('tokenMetrics');
  });

  it('should show rule count in info', () => {
    const rules = orchestrator.ruleEngine.rulesList;
    expect(Array.isArray(rules)).toBe(true);
  });

  it('should list all registered skills', () => {
    const skills = orchestrator.getSkillRegistry().list();
    expect(Array.isArray(skills)).toBe(true);
  });
});
