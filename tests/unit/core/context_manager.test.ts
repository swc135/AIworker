import { describe, it, expect } from 'vitest';
import { ContextWindowManager } from '@/core/context_manager';

describe('ContextWindowManager', () => {
  const manager = new ContextWindowManager(200_000);

  describe('estimateMessageTokens', () => {
    it('counts tokens for system messages', () => {
      const messages = [
        { role: 'system' as const, content: 'You are an AI assistant.' },
      ];
      const tokens = manager.estimateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('counts tokens for user messages with long content', () => {
      const longContent = 'a'.repeat(1000);
      const messages = [
        { role: 'user' as const, content: longContent },
      ];
      const tokens = manager.estimateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(100);
    });

    it('counts tokens for tool result messages', () => {
      const messages = [
        { role: 'tool' as const, content: JSON.stringify({ data: 'value' }) },
      ];
      const tokens = manager.estimateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('sums all message tokens correctly', () => {
      const messages = [
        { role: 'system' as const, content: 'Be helpful.' },
        { role: 'user' as const, content: 'Hello!' },
        { role: 'assistant' as const, content: 'Hi there!' },
      ];
      const total = manager.estimateMessageTokens(messages);
      expect(total).toBeGreaterThan(0);
    });
  });

  describe('trimToFit', () => {
    it('returns unmodified if within budget', () => {
      const messages = [
        { role: 'system' as const, content: 'Be helpful.' },
        { role: 'user' as const, content: 'Hi' },
      ];
      const result = manager.trimToFit(messages, 50000);
      expect(result).toEqual(messages);
    });

    it('always keeps system messages', () => {
      const messages = [
        { role: 'system' as const, content: 'Always respond in Chinese.' },
        { role: 'user' as const, content: 'a'.repeat(5000) },
        { role: 'assistant' as const, content: 'b'.repeat(5000) },
        { role: 'user' as const, content: 'c'.repeat(5000) },
      ];
      const result = manager.trimToFit(messages, 500);
      const hasSystem = result.some((m) => m.role === 'system');
      expect(hasSystem).toBe(true);
    });

    it('trims older messages when over budget', () => {
      const messages: Array<{ role: string; content: string }> = [
        { role: 'system' as const, content: 'Be helpful.' },
        { role: 'user' as const, content: 'old question'.repeat(100) },
        { role: 'assistant' as const, content: 'old answer'.repeat(100) },
        { role: 'user' as const, content: 'new question'.repeat(50) },
        { role: 'assistant' as const, content: 'recent answer'.repeat(50) },
      ];
      const result = manager.trimToFit(messages, 200);
      expect(result.length).toBeLessThan(messages.length);
    });

    it('handles empty messages array', () => {
      const result = manager.trimToFit([], 1000);
      expect(result).toEqual([]);
    });

    it('respects maxTokens cap at constructor value', () => {
      const messages: Array<{ role: string; content: string }> = [];
      for (let i = 0; i < 100; i++) {
        messages.push({ role: 'user', content: 'x'.repeat(100) });
      }
      const result = manager.trimToFit(messages, 999_999_999);
      expect(result.length).toBeLessThanOrEqual(messages.length);
    });
  });

  describe('summarizeHistory', () => {
    it('produces truncated summaries for long messages', () => {
      const messages = [
        { role: 'assistant' as const, content: [{ type: 'text', text: 'A'.repeat(400) }] },
        { role: 'tool' as const, content: JSON.stringify({ result: 'B'.repeat(600) }) },
      ];
      const summary = manager.summarizeHistory(messages);
      expect(summary.length).toBeGreaterThan(0);
    });

    it('handles short messages without truncation', () => {
      const messages = [
        { role: 'assistant' as const, content: [{ type: 'text', text: 'Short reply.' }] },
      ];
      const summary = manager.summarizeHistory(messages);
      expect(summary).toContain('Short reply.');
    });

    it('handles empty array', () => {
      const summary = manager.summarizeHistory([]);
      expect(summary).toBe('');
    });

    it('handles string content messages', () => {
      const messages = [
        { role: 'assistant' as const, content: 'String content here.' },
      ];
      const summary = manager.summarizeHistory(messages);
      expect(summary).toContain('String content here.');
    });

    it('truncates very long tool results', () => {
      const messages = [
        { role: 'tool' as const, content: JSON.stringify({ output: 'Z'.repeat(600) }) },
      ];
      const summary = manager.summarizeHistory(messages);
      expect(summary).toContain('[Tool result truncated');
    });
  });
});
