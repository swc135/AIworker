import { createLogger } from '@/utils/logger';

const logger = createLogger('TaskProgress');

export type ProgressEvent =
  | { type: 'task_start'; task_id: string; description: string }
  | { type: 'iteration'; task_id: string; iteration: number; max_iterations: number }
  | { type: 'tool_call'; task_id: string; tool_name: string; call_id: string }
  | { type: 'tool_result'; task_id: string; tool_name: string; call_id: string; success: boolean }
  | { type: 'token_usage'; task_id: string; input_tokens: number; output_tokens: number }
  | { type: 'guardrail_check'; task_id: string; passed: boolean; violation?: string }
  | { type: 'task_complete'; task_id: string; duration_ms: number };

export interface ProgressCallback {
  (event: ProgressEvent): void;
}

export class TaskProgressTracker {
  private callbacks: ProgressCallback[] = [];
  private startTime?: number;

  on(callback: ProgressCallback): void {
    this.callbacks.push(callback);
  }

  off(callback: ProgressCallback): void {
    const idx = this.callbacks.indexOf(callback);
    if (idx >= 0) this.callbacks.splice(idx, 1);
  }

  emit(event: ProgressEvent): void {
    for (const cb of this.callbacks) {
      try {
        cb(event);
      } catch (err) {
        logger.warn(`Progress callback error: ${err}`);
      }
    }
  }

  start(taskId: string, description: string): void {
    this.startTime = Date.now();
    this.emit({ type: 'task_start', task_id: taskId, description });
  }

  recordIteration(taskId: string, iteration: number, maxIterations: number): void {
    this.emit({ type: 'iteration', task_id: taskId, iteration, max_iterations: maxIterations });
  }

  recordToolCall(taskId: string, toolName: string, callId: string): void {
    this.emit({ type: 'tool_call', task_id: taskId, tool_name: toolName, call_id: callId });
  }

  recordToolResult(taskId: string, toolName: string, callId: string, success: boolean): void {
    this.emit({ type: 'tool_result', task_id: taskId, tool_name: toolName, call_id: callId, success });
  }

  recordTokens(taskId: string, inputTokens: number, outputTokens: number): void {
    this.emit({ type: 'token_usage', task_id: taskId, input_tokens: inputTokens, output_tokens: outputTokens });
  }

  recordGuardrailCheck(taskId: string, passed: boolean, violation?: string): void {
    this.emit({ type: 'guardrail_check', task_id: taskId, passed, violation });
  }

  complete(taskId: string): void {
    const duration = this.startTime ? Date.now() - this.startTime : undefined;
    this.emit({ type: 'task_complete', task_id: taskId, duration_ms: duration || 0 });
    this.startTime = undefined;
  }

  getListener(): ProgressCallback {
    return (event: ProgressEvent) => {
      logger.info(`[progress] ${event.type}: ${JSON.stringify(event).slice(0, 200)}`);
    };
  }
}
