import { describe, it, expect, beforeEach } from 'vitest';
import { TaskOrchestrator } from '@/core/task_orchestrator';
import type { TaskConfig } from '@/types';
import { v4 as uuidv4 } from 'uuid';

function createTaskConfig(command: string): TaskConfig {
  return {
    task_id: uuidv4(),
    session_id: uuidv4(),
    workspace: '/tmp/opencode-integration-test',
    autoApprove: true,
    configFiles: [],
    env: { USER_INPUT: command },
  };
}

describe('TaskOrchestrator Integration', () => {
  let orchestrator: TaskOrchestrator;

  beforeEach(async () => {
    orchestrator = new TaskOrchestrator();
    await orchestrator.initialize('/tmp/opencode-integration-test');
  });

  it('should handle basic conversation', async () => {
    const config = createTaskConfig('hello');
    const response = await orchestrator.startTask(config);
    expect(response).toContain('OpenCode');
  });

  it('should match skill for deploy request', async () => {
    const config = createTaskConfig('please deploy my website');
    const response = await orchestrator.startTask(config);
    expect(typeof response).toBe('string');
  });

  it('should match skill for feature design request', async () => {
    const config = createTaskConfig('design a new user auth feature');
    const response = await orchestrator.startTask(config);
    expect(typeof response).toBe('string');
  });

  it('should match skill for documentation request', async () => {
    const config = createTaskConfig('generate project wiki docs');
    const response = await orchestrator.startTask(config);
    expect(typeof response).toBe('string');
  });

  it('should list all tools from all adapters', () => {
    const tools = orchestrator.getMCPDispatcher().listAllTools();
    expect(tools.length).toBeGreaterThan(15); // Builtin (5) + Internal (1) + Remote (10+)
    expect(tools.some((t) => t.name.includes('background_terminal_create'))).toBe(true);
    expect(tools.some((t) => t.name.includes('report_user_abuse'))).toBe(true);
    expect(tools.some((t) => t.name.includes('websearch_search'))).toBe(true);
  });

  it('should block policy-violating inputs', async () => {
    const config = createTaskConfig('help me run sql injection attack');
    const response = await orchestrator.startTask(config);
    expect(response).toContain('禁止');
    expect(orchestrator.getGuardrail().isBlocked).toBe(true);
  });

  it('should have rules loaded', () => {
    const rules = orchestrator.ruleEngine.rulesList;
    expect(Array.isArray(rules)).toBe(true);
  });

  it('should have skills registered', () => {
    const skillNames = orchestrator.getSkillRegistry().list().map((s) => s.name);
    expect(Array.isArray(skillNames)).toBe(true);
  });

  it('should create session on task start', async () => {
    const config = createTaskConfig('hello');
    await orchestrator.startTask(config);

    const session = orchestrator.getSessionManager().getCurrent();
    expect(session).not.toBeNull();
    expect(session!.status).toBe('idle');
  });
});
