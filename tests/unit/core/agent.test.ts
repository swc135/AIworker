import { describe, it, expect } from 'vitest';
import { SessionManager } from '@/core/session';
import { AgentLoop } from '@/core/agent';
import { MockLLMProvider } from '@/llm/provider';
import { MCPDispatcher, BuiltinAdapter } from '@/mcp/index';

describe('SessionManager', () => {
  it('should create a session', () => {
    const manager = new SessionManager();
    const session = manager.create({
      task_id: 'task-1',
      session_id: 'session-1',
      workspace: '/test',
      autoApprove: true,
      configFiles: [],
      env: {},
    });

    expect(session.status).toBe('active');
    expect(session.task_id).toBe('task-1');
  });

  it('should update session status', () => {
    const manager = new SessionManager();
    const session = manager.create({
      task_id: 'task-1',
      session_id: 'session-1',
      workspace: '/test',
      autoApprove: true,
      configFiles: [],
      env: {},
    });

    manager.updateStatus('session-1', 'idle');
    expect(session.status).toBe('idle');
  });

  it('should terminate session', () => {
    const manager = new SessionManager();
    manager.create({
      task_id: 'task-1',
      session_id: 'session-1',
      workspace: '/test',
      autoApprove: true,
      configFiles: [],
      env: {},
    });

    manager.terminate('session-1');
    expect(manager.getCurrent()).toBeNull();
  });
});

describe('AgentLoop', () => {
  it('should run with mock LLM', async () => {
    const llm = new MockLLMProvider();
    llm.setResponse('hello', ['Hello, world!']);

    const dispatcher = new MCPDispatcher();
    dispatcher.registerAdapter(new BuiltinAdapter());

    const loop = new AgentLoop(llm, dispatcher);
    const result = await loop.run({
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      systemPrompt: 'You are a helpful assistant.',
    });

    expect(result.finalContent).toContain('Hello');
  });
});

describe('MockLLMProvider', () => {
  it('should return matching response', async () => {
    const llm = new MockLLMProvider();
    llm.setResponse('test', ['Test response']);

    const response = await llm.chat([{ role: 'user', content: 'this is a test message' }]);
    expect(response.finish_reason).toBe('stop');
    expect(response.content[0]).toHaveProperty('type', 'text');
    expect((response.content[0] as { text: string }).text).toBe('Test response');
  });

  it('should return default response for unknown input', async () => {
    const llm = new MockLLMProvider();
    const response = await llm.chat([{ role: 'user', content: 'unknown request' }]);
    expect((response.content[0] as { text: string }).text).toContain('cannot process');
  });

  it('should count tokens', () => {
    const llm = new MockLLMProvider();
    const tokens = llm.countTokens('hello world');
    expect(tokens).toBeGreaterThan(0);
  });
});
