import type { Message } from '@/types';
import { createLogger } from '@/utils/logger';

const logger = createLogger('ContextWindow');

const TOKENS_PER_MESSAGE = 4;
const TOKENS_PER_ROLE = { system: 3, user: 4, assistant: 4, tool: 10 };

export class ContextWindowManager {
  private maxTokens: number;

  constructor(maxTokens: number = 200_000) {
    this.maxTokens = maxTokens;
  }

  estimateMessageTokens(messages: Message[]): number {
    let total = 0;
    for (const msg of messages) {
      const contentLen = typeof msg.content === 'string' ? msg.content.length : JSON.stringify(msg.content).length;
      const roleTokens = TOKENS_PER_ROLE[msg.role] || 4;
      const contentTokens = Math.ceil(contentLen / 4);
      total += roleTokens + contentTokens;
    }
    return total;
  }

  trimToFit(messages: Message[], maxTokens: number): Message[] {
    if (maxTokens > this.maxTokens) maxTokens = this.maxTokens;
    if (this.estimateMessageTokens(messages) <= maxTokens) return messages;

    const keepSystem = messages.filter((m) => m.role === 'system');
    const keepSystemCount = this.estimateMessageTokens(keepSystem);
    const availableForChat = maxTokens - keepSystemCount;

    const chatMessages = messages.filter((m) => m.role !== 'system');
    const trimmed = this.trimMessages(chatMessages, availableForChat);
    return [...keepSystem, ...trimmed];
  }

  private trimMessages(messages: Message[], budgetTokens: number): Message[] {
    if (budgetTokens <= 0) return [];

    const result: Message[] = [];
    let usedTokens = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]!;
      const msgTokens = this.estimateMessageTokens([msg]);

      if (usedTokens + msgTokens > budgetTokens) break;

      usedTokens += msgTokens;
      result.unshift(msg);
    }

    if (result.length < messages.length && result.length > 0) {
      logger.info(`Trimmed ${messages.length - result.length} messages to fit context window`);
    } else if (result.length === 0) {
      // Force-keep the most recent message even if it exceeds budget, otherwise API will fail anyway
      const lastMsg = messages[messages.length - 1];
      if (lastMsg) {
        result.push(lastMsg);
        logger.info(`Forced inclusion of oversized message to prevent empty context`);
      }
    }

    return result;
  }

  summarizeHistory(messages: Message[]): string {
    const toolResults = messages.filter((m) => m.role === 'tool');
    const assistantMsgs = messages.filter((m) => m.role === 'assistant');

    const summaries: string[] = [];
    for (const tool of toolResults) {
      const content = typeof tool.content === 'string' ? tool.content : JSON.stringify(tool.content);
      if (content.length > 500) {
        summaries.push(`[Tool result truncated: ${content.slice(0, 200)}...]`);
      }
    }

    for (const assistant of assistantMsgs) {
      const content = typeof assistant.content === 'string' ? assistant.content : '';
      if (typeof assistant.content === 'object' && Array.isArray(assistant.content)) {
        const textBlocks = assistant.content.filter((b): b is { type: 'text'; text: string } => typeof b === 'object' && b !== null && (b as unknown as Record<string, unknown>).type === 'text');
        for (const block of textBlocks) {
          const text = block.text || '';
          if (text.length > 300) {
            summaries.push(`[Assistant response truncated: ${text.slice(0, 150)}...]`);
          } else if (text) {
            summaries.push(text);
          }
        }
      } else if (content && content.length > 300) {
        summaries.push(content.slice(0, 150) + '...');
      } else if (content) {
        summaries.push(content);
      }
    }

    return summaries.join('\n');
  }
}
