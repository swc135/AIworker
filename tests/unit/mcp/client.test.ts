import { describe, it, expect } from 'vitest';
import { MCPDispatcher } from '@/mcp/client';
import { BuiltinAdapter } from '@/mcp/adapters/builtin';
import { InternalAdapter } from '@/mcp/adapters/internal';
import type { ToolCall } from '@/types';

describe('MCPDispatcher', () => {
  it('should register and list adapters', () => {
    const dispatcher = new MCPDispatcher();
    dispatcher.registerAdapter(new BuiltinAdapter());
    dispatcher.registerAdapter(new InternalAdapter());

    const tools = dispatcher.listAllTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((t) => t.name.includes('background_terminal_create'))).toBe(true);
    expect(tools.some((t) => t.name.includes('report_user_abuse'))).toBe(true);
  });

  it('should return error for unknown tool', async () => {
    const dispatcher = new MCPDispatcher();
    const call: ToolCall = {
      tool_name: 'unknown_tool',
      parameters: {},
      call_id: 'test-1',
    };
    const result = await dispatcher.dispatch(call);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Tool not found');
  });

  it('should dispatch to builtin adapter', async () => {
    const dispatcher = new MCPDispatcher();
    dispatcher.registerAdapter(new BuiltinAdapter());

    const call: ToolCall = {
      tool_name: 'mcaiBuiltin_background_terminal_create',
      parameters: { command: 'echo hello' },
      call_id: 'test-2',
    };
    const result = await dispatcher.dispatch(call);
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('terminal_id');
  });

  it('should dispatch to internal adapter', async () => {
    const dispatcher = new MCPDispatcher();
    dispatcher.registerAdapter(new InternalAdapter());

    const call: ToolCall = {
      tool_name: 'monkeycode-ai_internal__report_user_abuse',
      parameters: { abuse_detail: 'Test abuse report for validation' },
      call_id: 'test-3',
    };
    const result = await dispatcher.dispatch(call);
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('reported', true);
  });

  it('should dispatch batch calls', async () => {
    const dispatcher = new MCPDispatcher();
    dispatcher.registerAdapter(new BuiltinAdapter());

    const calls: ToolCall[] = [
      { tool_name: 'mcaiBuiltin_background_terminal_create', parameters: { command: 'echo 1' }, call_id: 'b1' },
      { tool_name: 'mcaiBuiltin_background_terminal_create', parameters: { command: 'echo 2' }, call_id: 'b2' },
    ];
    const results = await dispatcher.dispatchBatch(calls);
    expect(results).toHaveLength(2);
    expect(results[0]!.success).toBe(true);
    expect(results[1]!.success).toBe(true);
  });
});

describe('BuiltinAdapter', () => {
  it('should list tools', () => {
    const adapter = new BuiltinAdapter();
    const tools = adapter.listTools();
    expect(tools.length).toBe(5);
  });

  it('should validate terminal create params', () => {
    const adapter = new BuiltinAdapter();
    const valid: ToolCall = { tool_name: 'mcaiBuiltin_background_terminal_create', parameters: { command: 'ls' }, call_id: 'v1' };
    const invalid: ToolCall = { tool_name: 'mcaiBuiltin_background_terminal_create', parameters: {}, call_id: 'v2' };
    expect(adapter.validate(valid)).toBe(true);
    expect(adapter.validate(invalid)).toBe(false);
  });

  it('should execute terminal create', async () => {
    const adapter = new BuiltinAdapter();
    const call: ToolCall = { tool_name: 'mcaiBuiltin_background_terminal_create', parameters: { command: 'echo test' }, call_id: 'e1' };
    const result = await adapter.execute(call);
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('terminal_id');
  });

  it('should list terminals', async () => {
    const adapter = new BuiltinAdapter();
    // First create a terminal
    await adapter.execute({ tool_name: 'mcaiBuiltin_background_terminal_create', parameters: { command: 'echo x' }, call_id: 'c1' });

    const result = await adapter.execute({ tool_name: 'mcaiBuiltin_background_terminal_list', parameters: {}, call_id: 'l1' });
    expect(result.success).toBe(true);
    expect((result.data as { terminals: unknown[] }).terminals.length).toBeGreaterThan(0);
  });

  it('should get terminal output path', async () => {
    const adapter = new BuiltinAdapter();
    const createResult = await adapter.execute({ tool_name: 'mcaiBuiltin_background_terminal_create', parameters: { command: 'echo hi' }, call_id: 'c2' });
    const terminalId = (createResult.data as { terminal_id: string }).terminal_id;

    const pathResult = await adapter.execute({ tool_name: 'mcaiBuiltin_background_terminal_output_path', parameters: { terminal_id: terminalId }, call_id: 'p1' });
    expect(pathResult.success).toBe(true);
    expect((pathResult.data as { output_path: string }).output_path).toContain(terminalId);
  });
});

describe('InternalAdapter', () => {
  it('should report abuse', async () => {
    const adapter = new InternalAdapter();
    const call: ToolCall = { tool_name: 'monkeycode-ai_internal__report_user_abuse', parameters: { abuse_detail: 'test' }, call_id: 'a1' };
    const result = await adapter.execute(call);
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('reported', true);
  });
});
