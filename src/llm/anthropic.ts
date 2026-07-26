import type { LLMProvider, Message, ChatOptions, ChatResponse, ContentBlock, ToolCall, ToolUseBlock } from '@/types';
import { createLogger } from '@/utils/logger';
import { withRetryOnHttpStatus } from '@/utils/retry';
import { RateLimiter } from '@/security/rate_limiter';
import type { RateLimitConfig } from '@/security/rate_limiter';

const logger = createLogger('Anthropic');

export interface AnthropicProviderConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  timeout?: number;
}

interface AnthropicMessage {
  role: string;
  content: string | AnthropicContentPart[];
}

interface AnthropicContentPart {
  type: string;
  text?: string;
  tool_use_id?: string;
  input?: Record<string, unknown>;
  content?: string;
  is_error?: boolean;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: string;
  content: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicStreamChunk {
  type: string;
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    tool_use_id?: string;
    input_stream?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  index?: number;
}

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private config: AnthropicProviderConfig;
  private _streamToolBuffers: Array<{ id: string; name: string; args: string }> = [];
  private rateLimiter: RateLimiter;

  constructor(config: AnthropicProviderConfig, rateLimitConfig?: Partial<RateLimitConfig>) {
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
    const body = this.buildRequestBody(messages, options);

    logger.debug(`Chat request: ${messages.length} messages, model=${this.config.model}`);

    await this.rateLimiter.acquire();
    try {
      this.rateLimiter.recordRequest();

      const response = await this.fetchWithTimeout(`${this.config.baseURL}v1/messages`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as AnthropicResponse;
      return this.parseResponse(data);
    } finally {
      this.rateLimiter.release();
    }
  }

  async *chatStream(messages: Message[], options?: ChatOptions): AsyncIterable<{ type: string; text?: string }> {
    const body = this.buildRequestBody(messages, options);

    logger.debug(`Chat stream request: ${messages.length} messages, model=${this.config.model}`);

    const response = await withRetryOnHttpStatus(
      () => this.fetchWithTimeout(`${this.config.baseURL}v1/messages`, {
        method: 'POST',
        headers: {
          ...this.buildHeaders(),
          'Accept': 'text/event-stream',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      }),
      { maxRetries: 1, baseDelayMs: 500 },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    this._streamToolBuffers = [];
    let stopped = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let i = 0;
        while (i < lines.length) {
          const trimmed = lines[i]?.trim() || '';
          if (!trimmed || !trimmed.startsWith('event: ')) {
            i++;
            continue;
          }

          const eventType = trimmed.slice(7).trim();
          i++; // consume event line

          // Read the next line for data
          const dataLine = lines[i]?.trim() || '';
          if (!dataLine) continue;

          let jsonString = dataLine;
          if (jsonString.startsWith('data: ')) {
            jsonString = jsonString.slice(6);
          }
          i++;

          try {
            const chunk: AnthropicStreamChunk = JSON.parse(jsonString);

            switch (eventType) {
              case 'content_block_start':
                if (chunk.delta?.type === 'input_json') {
                  const idx = chunk.index ?? 0;
                  this._streamToolBuffers[idx] = { id: '', name: '', args: '' };
                } else if (chunk.delta?.type === 'text' && !stopped) {
                  yield { type: 'text_delta', text: chunk.delta.text || '' };
                }
                break;

              case 'content_block_delta':
                if (chunk.delta?.type === 'text' && !stopped) {
                  yield { type: 'text_delta', text: chunk.delta.text || '' };
                } else if (chunk.delta?.type === 'input_json') {
                  const idx = chunk.index ?? 0;
                  const existing = this._streamToolBuffers[idx];
                  if (existing) {
                    existing.args += chunk.delta.partial_json || '';
                    yield { type: 'tool_args_delta', text: `${idx}|${existing.args}` };
                  }
                } else if (chunk.delta?.type === 'stop') {
                  stopped = true;
                  for (let i = 0; i < this._streamToolBuffers.length; i++) {
                    const buf = this._streamToolBuffers[i];
                    if (!buf) continue;
                    if (buf.name && buf.args) {
                      try {
                        yield {
                          type: 'tool_name',
                          text: `${i}|${buf.id}|${buf.name}`,
                        };
                      } catch {
                        // skip
                      }
                    }
                  }
                  this._streamToolBuffers = [];
                }
                break;

              case 'message_delta':
                if (chunk.delta?.type === 'stop' && !stopped) {
                  stopped = true;
                  yield { type: 'stop' };
                }
                break;

              default:
                break;
            }
          } catch {
            // skip malformed chunks
          }
        }
      }

      yield { type: 'stop' };

    } finally {
      this._streamToolBuffers = [];
      reader.releaseLock();
    }
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  getModel(): string {
    return this.config.model;
  }

  private buildRequestBody(messages: Message[], options?: ChatOptions) {
    const anthropicMessages = this.convertMessages(messages);
    const anthropicTools = options?.tools ? this.convertTools(options.tools) : undefined;

    return {
      model: options?.model || this.config.model,
      messages: anthropicMessages,
      ...(anthropicTools ? { tools: anthropicTools } : {}),
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.max_tokens !== undefined ? { max_tokens: options.max_tokens } : {}),
      ...(options?.stop_sequences ? { stop_sequences: options.stop_sequences } : {}),
    };
  }

  private convertMessages(messages: Message[]): AnthropicMessage[] {
    const systemMsg = messages.find((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    const result: AnthropicMessage[] = [];

    if (systemMsg && typeof systemMsg.content === 'string') {
      // System prompt goes in a special field, not in messages array
      // We handle it in buildRequestBody
    }

    for (const msg of nonSystemMessages) {
      if (msg.role === 'assistant' || msg.role === 'user') {
        const content = typeof msg.content === 'string' 
          ? [{ type: 'text', text: msg.content }] 
          : this.convertContentBlocks(msg.content);
        result.push({ role: msg.role, content });
      } else if (msg.role === 'tool') {
        // Convert tool results to assistant/user pattern
        const content = this.convertToolResult(msg);
        result.push({ role: 'user', content });
      }
    }

    return result;
  }

  private convertContentBlocks(blocks: ContentBlock[]): AnthropicContentPart[] {
    return blocks.map((b) => {
      if (b.type === 'text') {
        return { type: 'text', text: (b as { type: 'text'; text: string }).text };
      } else if (b.type === 'tool_use') {
        const tu = b as ToolUseBlock;
        return {
          type: 'tool_use',
          id: tu.id,
          name: tu.name,
          input: tu.input,
        } as AnthropicContentPart;
      } else if (b.type === 'tool_result') {
        const tr = b as { type: 'tool_result'; tool_use_id: string; content: string };
        return {
          type: 'tool_result',
          tool_use_id: tr.tool_use_id,
          content: tr.content,
        } as AnthropicContentPart;
      }
      return { type: 'text', text: String(b) } as AnthropicContentPart;
    });
  }

  private convertToolResult(msg: Message): AnthropicContentPart[] {
    if (typeof msg.content === 'string') {
      return [{ type: 'text', text: msg.content }];
    }
    const blocks = msg.content as ContentBlock[];
    return blocks
      .filter((b) => b.type === 'tool_result')
      .map((b) => ({
        type: 'tool_result',
        tool_use_id: b.tool_use_id,
        content: b.content,
      }));
  }

  private convertTools(tools: import('@/types').ToolDefinition[]): AnthropicTool[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  private parseResponse(data: AnthropicResponse): ChatResponse {
    const content: ContentBlock[] = [];
    const toolCalls: ToolCall[] = [];

    for (const block of data.content) {
      if (block.type === 'text') {
        content.push({ type: 'text', text: block.text || '' });
      } else if (block.type === 'tool_use') {
        const input = block.input || {};
        content.push({
          type: 'tool_use',
          id: block.id || '',
          name: block.name || '',
          input,
        });
        toolCalls.push({
          tool_name: block.name || '',
          parameters: input,
          call_id: block.id || '',
        });
      }
    }

    let finishReason: ChatResponse['finish_reason'] = 'stop';
    if (data.stop_reason === 'tool_use') {
      finishReason = 'tool_use';
    } else if (data.stop_reason === 'max_tokens') {
      finishReason = 'length';
    }

    return {
      id: data.id,
      content,
      tool_calls: toolCalls,
      usage: {
        input_tokens: data.usage?.input_tokens || 0,
        output_tokens: data.usage?.output_tokens || 0,
      },
      finish_reason: finishReason,
    };
  }

  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
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
