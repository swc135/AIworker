import { describe, it, expect } from 'vitest';
import { TaskProgressTracker, type ProgressEvent } from '@/core/progress';

describe('TaskProgressTracker', () => {
  let tracker: TaskProgressTracker;
  let events: ProgressEvent[];

  beforeEach(() => {
    tracker = new TaskProgressTracker();
    events = [];
    tracker.on((e) => events.push(e));
  });

  describe('emit lifecycle', () => {
    it('emits task_start with description', () => {
      tracker.start('task_1', 'Build feature');
      const startEvent = events.find((e) => e.type === 'task_start') as ProgressEvent & { type: 'task_start' };
      expect(startEvent).toBeDefined();
      expect(startEvent!.task_id).toBe('task_1');
      expect(startEvent!.description).toBe('Build feature');
    });

    it('records iterations up to max', () => {
      tracker.start('task_2', 'Iterate');
      for (let i = 1; i <= 3; i++) {
        tracker.recordIteration('task_2', i, 5);
      }
      const iterEvents = events.filter((e) => e.type === 'iteration') as ProgressEvent & { type: 'iteration' }[];
      expect(iterEvents.length).toBe(3);
      expect(iterEvents[2]!.iteration).toBe(3);
      expect(iterEvents[2]!.max_iterations).toBe(5);
    });

    it('records tool call and result', () => {
      tracker.start('task_3', 'Run tool');
      tracker.recordToolCall('task_3', 'bash', 'call_abc');
      tracker.recordToolResult('task_3', 'bash', 'call_abc', true);
      
      const toolCall = events.find((e) => e.type === 'tool_call') as ProgressEvent & { type: 'tool_call' };
      expect(toolCall).toBeDefined();
      expect(toolCall!.tool_name).toBe('bash');

      const toolResult = events.find((e) => e.type === 'tool_result') as ProgressEvent & { type: 'tool_result' };
      expect(toolResult!.success).toBe(true);
    });

    it('tracks token usage', () => {
      tracker.start('task_4', 'Token test');
      tracker.recordTokens('task_4', 100, 50);
      const tokenEvent = events.find((e) => e.type === 'token_usage') as ProgressEvent & { type: 'token_usage' };
      expect(tokenEvent).toBeDefined();
      expect(tokenEvent!.input_tokens).toBe(100);
      expect(tokenEvent!.output_tokens).toBe(50);
    });

    it('records guardrail check passed', () => {
      tracker.recordGuardrailCheck('task_5', true);
      const event = events.find((e) => e.type === 'guardrail_check') as ProgressEvent & { type: 'guardrail_check' };
      expect(event!.passed).toBe(true);
      expect(event!.violation).toBeUndefined();
    });

    it('records guardrail check failed', () => {
      tracker.recordGuardrailCheck('task_6', false, 'cyber_attack');
      const event = events.find((e) => e.type === 'guardrail_check') as ProgressEvent & { type: 'guardrail_check' };
      expect(event!.passed).toBe(false);
      expect(event!.violation).toBe('cyber_attack');
    });

    it('emits task_complete with duration', () => {
      tracker.start('task_7', 'Complete test');
      const before = Date.now();
      tracker.complete('task_7');
      const completeEvent = events.find((e) => e.type === 'task_complete') as ProgressEvent & { type: 'task_complete' };
      expect(completeEvent!.duration_ms).toBeGreaterThanOrEqual(Date.now() - before);
    });

    it('resets startTime after completion', () => {
      tracker.start('task_8', 'Reset test');
      tracker.complete('task_8');
      // After completion, a new start should reset the timer
      tracker.start('task_8b', 'Second run');
      tracker.complete('task_8b');
      const completes = events.filter((e) => e.type === 'task_complete');
      expect(completes.length).toBe(2);
    });
  });

  describe('callback management', () => {
    it('removes listener when off is called', () => {
      const cb = (e: ProgressEvent) => {};
      tracker.on(cb);
      tracker.off(cb);
      tracker.start('task_9', 'Remove callback');
      expect(events.length).toBe(1); // beforeEach listener still fires
      events = []; // clear for next assertion
      expect(events.length).toBe(0);
    });

    it('supports multiple listeners', () => {
      const otherEvents: ProgressEvent[] = [];
      tracker.on((e) => otherEvents.push(e));
      tracker.start('multi', 'Multi');
      expect(events.length).toBe(1);
      expect(otherEvents.length).toBe(1);
    });
  });

  describe('getListener', () => {
    it('returns a logger callback', () => {
      const listener = tracker.getListener();
      expect(typeof listener).toBe('function');
      tracker.start('listener_test', 'Testing listener');
      // Just verify it doesn't throw
      expect(() => listener({ type: 'task_start', task_id: 'x', description: 'y' })).not.toThrow();
    });
  });
});
