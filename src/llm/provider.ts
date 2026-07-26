import type { LLMProvider, Message, ChatOptions, ChatResponse, ToolDefinition } from '@/types';
import { createLogger } from '@/utils/logger';

const logger = createLogger('LLM');

export class MockLLMProvider implements LLMProvider {
  name = 'mock';
  private responses: Map<string, string[]> = new Map();

  setResponse(inputPattern: string, responses: string[]) {
    this.responses.set(inputPattern, responses);
  }

  async chat(messages: Message[], _options?: ChatOptions): Promise<ChatResponse> {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    const input = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';

    let text = 'I cannot process this request.';
    for (const [pattern, responses] of this.responses) {
      if (input.includes(pattern)) {
        text = responses[Math.floor(Math.random() * responses.length)] ?? text;
        break;
      }
    }

    logger.debug(`Mock LLM response for "${input.slice(0, 50)}..."`);

    return {
      id: `mock-${Date.now()}`,
      content: [{ type: 'text', text }],
      tool_calls: [],
      usage: { input_tokens: input.length, output_tokens: text.length },
      finish_reason: 'stop',
    };
  }

  async *chatStream(messages: Message[], _options?: ChatOptions): AsyncIterable<{ type: string; text?: string }> {
    const response = await this.chat(messages, _options);
    const text = response.content.find((b) => b.type === 'text') as { type: 'text'; text: string } | undefined;
    if (text) {
      for (const char of text.text) {
        yield { type: 'text_delta', text: char };
      }
    }
    yield { type: 'stop' };
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

export function createProviderFromConfig(config: {
  name: string;
  baseURL: string;
  apiKey?: string;
}): LLMProvider | null {
  logger.info(`Creating LLM provider: ${config.name} → ${config.baseURL}`);
  // Production would use @ai-sdk/anthropic or similar SDK
  // For now, use MockLLMProvider for development
  return new MockLLMProvider();
}
