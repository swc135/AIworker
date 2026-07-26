import type { LLMProvider, Message, ChatOptions, ChatResponse, ContentBlock, ToolCall, ToolUseBlock } from '@/types';
import { createLogger } from '@/utils/logger';
import { withRetryOnHttpStatus } from '@/utils/retry';
import { RateLimiter } from '@/security/rate_limiter';
import type { RateLimitConfig } from '@/security/rate_limiter';

const logger = createLogger('OpenAI');

export interface OpenAIProviderConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  timeout?: number;
}

interface OpenAIMessage {
  role: string;
  content: string | OpenAIContentPart[];
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIContentPart {
  type: string;
  text?: string;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIResponse {
  id: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamChunk {
  id: string;
  choices: {
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: {
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }[];
    };
    finish_reason: string | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private config: OpenAIProviderConfig;
  private _streamToolBuffers: Array<{ id: string; name: string; args: string }> = [];
  private rateLimiter: RateLimiter;

  constructor(config: OpenAIProviderConfig, rateLimitConfig?: Partial<RateLimitConfig>) {
    this.config = {
      timeout: 120000,
      ...config,
    };
    if (!this.config.baseURL.endsWith('/')) {
      this.config.baseURL += '/';
    }
    this.rateLimiter = new RateLimiter(rateLimitConfig);
  }

  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const body = this.buildRequestBody(messages, options, false);

    logger.debug(`Chat request: ${messages.length} messages, model=${this.config.model}`);

    await this.rateLimiter.acquire();
    try {
      this.rateLimiter.recordRequest();

      const response = await this.fetchWithTimeout(`${this.config.baseURL}chat/completions`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as OpenAIResponse;
      return this.parseResponse(data);
    } finally {
      this.rateLimiter.release();
    }
  }

  async *chatStream(messages: Message[], options?: ChatOptions): AsyncIterable<{ type: string; text?: string }> {
    const body = this.buildRequestBody(messages, options, true);

    logger.debug(`Chat stream request: ${messages.length} messages, model=${this.config.model}`);

    const response = await withRetryOnHttpStatus(
      () => this.fetchWithTimeout(`${this.config.baseURL}chat/completions`, {
        method: 'POST',
        headers: { ...this.buildHeaders(), Accept: 'text/event-stream' },
        body: JSON.stringify(body),
      }),
      { maxRetries: 1, baseDelayMs: 500 },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    this._streamToolBuffers = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            yield { type: 'stop' };
            return;
          }

          try {
            const chunk: OpenAIStreamChunk = JSON.parse(data);
            const delta = chunk.choices[0]?.delta;
            if (delta?.content) {
              yield { type: 'text_delta', text: delta.content };
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.function?.name) {
                  yield { type: 'tool_name', text: `${tc.index}|${tc.id}|${tc.function.name}` };
                }
                if (tc.function?.arguments && tc.index !== undefined) {
                  const existing = this._streamToolBuffers[tc.index] || { id: '', name: '', args: '' };
                  if (tc.id) existing.id = tc.id;
                  if (tc.function.name) existing.name = tc.function.name;
                  existing.args += tc.function.arguments;
                  this._streamToolBuffers[tc.index] = existing;
                  yield { type: 'tool_args_delta', text: `${tc.index}|${existing.args}` };
                }
              }
            }
          } catch {
            // skip malformed chunks
          }
        }
        }
      } finally {
        this._streamToolBuffers = [];
        reader.releaseLock();
      }
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
  }

  getModel(): string {
    return this.config.model;
  }

  private buildRequestBody(messages: Message[], options?: ChatOptions, stream?: boolean) {
    const openaiMessages = this.convertMessages(messages);
    const openaiTools = options?.tools ? this.convertTools(options.tools) : undefined;

    return {
      model: options?.model || this.config.model,
      messages: openaiMessages,
      ...(openaiTools ? { tools: openaiTools, tool_choice: 'auto' } : {}),
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.max_tokens !== undefined ? { max_tokens: options.max_tokens } : {}),
      ...(this.config.timeout !== undefined ? { timeout: this.config.timeout } : {}),
      ...(options?.stop_sequences ? { stop: options.stop_sequences } : {}),
      ...(stream ? { stream: true } : {}),
    };
  }

  private convertMessages(messages: Message[]): OpenAIMessage[] {
    return messages.map((m) => {
      if (m.role === 'system') {
        return { role: 'system', content: typeof m.content === 'string' ? m.content : this.blocksToText(m.content) };
      }
      if (m.role === 'user') {
        return { role: 'user', content: typeof m.content === 'string' ? m.content : this.blocksToText(m.content) };
      }
      if (m.role === 'tool') {
        if (typeof m.content === 'string') {
          return { role: 'tool', content: m.content, tool_call_id: m.tool_call_id || '' };
        }
        const blocks = m.content as ContentBlock[];
        const resultBlocks = blocks.filter((b) => b.type === 'tool_result');
        if (resultBlocks.length === 1) {
          const tb = resultBlocks[0]! as { type: 'tool_result'; tool_use_id: string; content: string };
          return { role: 'tool', content: tb.content, tool_call_id: tb.tool_use_id };
        }
        return {
          role: 'tool',
          content: JSON.stringify(resultBlocks.map((b) => {
            const tb = b as { type: 'tool_result'; tool_use_id: string; content: string };
            return { tool_use_id: tb.tool_use_id, content: tb.content };
          })),
          tool_call_id: m.tool_call_id || '',
        };
      }
      // assistant
      const toolCalls: OpenAIToolCall[] = [];
      const textParts: string[] = [];

      if (typeof m.content === 'string') {
        textParts.push(m.content);
      } else {
        for (const block of m.content as ContentBlock[]) {
          if (block.type === 'text') {
            textParts.push((block as { type: 'text'; text: string }).text);
          } else if (block.type === 'tool_use') {
            const tu = block as ToolUseBlock;
            toolCalls.push({
              id: tu.id,
              type: 'function',
              function: { name: tu.name, arguments: JSON.stringify(tu.input) },
            });
          }
        }
      }

      return {
        role: 'assistant',
        content: textParts.join('\n') || '',
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      };
    });
  }

  private convertTools(tools: import('@/types').ToolDefinition[]): OpenAITool[] {
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  private blocksToText(blocks: ContentBlock[]): string {
    return blocks
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }

  private parseResponse(data: OpenAIResponse): ChatResponse {
    const choice = data.choices[0];
    if (!choice) {
      throw new Error('No choices in OpenAI response');
    }

    const content: ContentBlock[] = [];
    const toolCalls: ToolCall[] = [];
    let finishReason: ChatResponse['finish_reason'] = 'stop';

    if (choice.message.content) {
      content.push({ type: 'text', text: choice.message.content });
    }

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments || '{}'),
        });
        toolCalls.push({
          tool_name: tc.function.name,
          parameters: JSON.parse(tc.function.arguments || '{}'),
          call_id: tc.id,
        });
      }
      finishReason = 'tool_use';
    }

    if (choice.finish_reason === 'length') {
      finishReason = 'length';
    } else if (choice.finish_reason === 'stop' && toolCalls.length === 0) {
      finishReason = 'stop';
    }

    return {
      id: data.id,
      content,
      tool_calls: toolCalls,
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0,
      },
      finish_reason: finishReason,
    };
  }

  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
    };
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      return await withRetryOnHttpStatus(
        () => {
          init.signal = controller.signal;
          return fetch(url, init);
        },
        { maxRetries: 2, baseDelayMs: 500 },
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
