export interface TaskConfig {
  task_id: string;
  session_id: string;
  workspace: string;
  autoApprove: boolean;
  configFiles: ConfigFile[];
  env: Record<string, string>;
}

export interface ConfigFile {
  path: string;
  content: string;
}

export type SessionStatus = 'active' | 'idle' | 'terminated';

export interface Session {
  session_id: string;
  task_id: string;
  status: SessionStatus;
  memory_file: string | null;
  created_at: number;
}

export type RuleCategory =
  | 'security'
  | 'behavior'
  | 'code_quality'
  | 'workflow'
  | 'infrastructure'
  | 'git_management'
  | 'project_management';

export interface Rule {
  filename: string;
  category: RuleCategory;
  content: string;
  priority: number;
}

export interface SkillArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface Skill {
  name: string;
  description: string;
  version: string;
  arguments: SkillArgument[];
  instructions: string;
  resource_path: string;
}

export type TerminalStatus = 'running' | 'completed' | 'failed' | 'killed';

export interface BackgroundTerminal {
  terminal_id: string;
  command: string;
  status: TerminalStatus;
  exit_code: number | null;
  created_at: number;
  output_log_path: string;
}

export interface ToolCall {
  tool_name: string;
  parameters: Record<string, unknown>;
  call_id: string;
}

export interface ToolResult {
  call_id: string;
  success: boolean;
  data: unknown;
  error?: string;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  tool_call_id?: string;
}

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface ChatOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  tools?: ToolDefinition[];
  stop_sequences?: string[];
}

export interface ChatResponse {
  id: string;
  content: ContentBlock[];
  tool_calls: ToolCall[];
  usage: TokenUsage;
  finish_reason: 'stop' | 'tool_use' | 'length' | 'error';
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
}

export interface LLMProvider {
  name: string;
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
  chatStream(messages: Message[], options?: ChatOptions): AsyncIterable<{ type: string; text?: string }>;
  countTokens(text: string): number;
}

export interface ModelInfo {
  name: string;
  provider: string;
  limit: {
    context: number;
    output: number;
  };
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatusCodes?: number[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryableStatusCodes: [429, 500, 502, 503, 504],
};
