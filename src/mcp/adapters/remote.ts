import type { ToolCall, ToolResult, ToolDefinition } from '../../types';
import type { ToolAdapter } from '../client';
import { createLogger } from '@/utils/logger';

const logger = createLogger('RemoteAdapter');

interface RemoteEndpoint {
  baseURL: string;
  tools: ToolDefinition[];
}

export class RemoteAdapter implements ToolAdapter {
  namespace = 'monkeycode-ai_MonkeyCode';
  private endpoints: Map<string, RemoteEndpoint> = new Map();
  private mockMode: boolean;

  constructor(mockMode = true) {
    this.mockMode = mockMode;
    this.registerEndpoints();
  }

  private registerEndpoints(): void {
    this.endpoints.set('websearch_search', {
      baseURL: 'https://search.monkeycode-ai.online/v1',
      tools: [
        {
          name: 'monkeycode-ai_MonkeyCode__websearch_search',
          description: 'Search the web for public web pages',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query text' },
              count: { type: 'number', description: 'Max results (1-50)' },
              time_range: { type: 'string', description: 'Time range filter' },
            },
            required: ['query'],
          },
        },
      ],
    });

    this.endpoints.set('websearch_aisearch', {
      baseURL: 'https://search.monkeycode-ai.online/v1',
      tools: [
        {
          name: 'monkeycode-ai_MonkeyCode__websearch_aisearch',
          description: 'AI-powered web search with synthesized answers',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query text' },
              count: { type: 'number', description: 'Max results (1-50)' },
            },
            required: ['query'],
          },
        },
      ],
    });

    this.endpoints.set('docparse_parse', {
      baseURL: 'https://docparse.monkeycode-ai.online/v1',
      tools: [
        {
          name: 'monkeycode-ai_MonkeyCode__docparse_parse',
          description: 'Parse document to Markdown/OCR',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'Document HTTP(S) URL' },
            },
            required: ['url'],
          },
        },
        {
          name: 'monkeycode-ai_MonkeyCode__docparse_get_doc_upload_url',
          description: 'Get document upload URL (10 min valid)',
          parameters: {
            type: 'object',
            properties: {
              file_name: { type: 'string', description: 'File name with extension' },
            },
            required: ['file_name'],
          },
        },
        {
          name: 'monkeycode-ai_MonkeyCode__docparse_get_parse_result',
          description: 'Query document parse result',
          parameters: {
            type: 'object',
            properties: {
              document_id: { type: 'number', description: 'Document ID' },
            },
            required: ['document_id'],
          },
        },
      ],
    });

    this.endpoints.set('image_analysis', {
      baseURL: 'https://image.monkeycode-ai.online/v1',
      tools: [
        {
          name: 'monkeycode-ai_MonkeyCode__image_analysis_create_task',
          description: 'Create async image analysis task',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'Image HTTP(S) URL' },
              prompt: { type: 'string', description: 'Custom analysis prompt' },
            },
            required: ['url'],
          },
        },
        {
          name: 'monkeycode-ai_MonkeyCode__image_analysis_get_result',
          description: 'Query image analysis result',
          parameters: {
            type: 'object',
            properties: {
              task_id: { type: 'string', description: 'Task ID' },
            },
            required: ['task_id'],
          },
        },
        {
          name: 'monkeycode-ai_MonkeyCode__image_generate_text_to_image',
          description: 'Text to image generation',
          parameters: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: 'Generation prompt' },
              ratio: { type: 'string', description: 'Aspect ratio' },
            },
            required: ['prompt'],
          },
        },
        {
          name: 'monkeycode-ai_MonkeyCode__image_generate_query_task',
          description: 'Query image generation result',
          parameters: {
            type: 'object',
            properties: {
              task_id: { type: 'string', description: 'Task ID' },
            },
            required: ['task_id'],
          },
        },
        {
          name: 'monkeycode-ai_MonkeyCode__imgsearch_search',
          description: 'Search images by text query',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              count: { type: 'number', description: 'Max results (1-5)' },
            },
            required: ['query'],
          },
        },
      ],
    });

    this.endpoints.set('query_docs', {
      baseURL: 'https://context7.com/api',
      tools: [
        {
          name: 'monkeycode-ai_MonkeyCode__resolve-library-id',
          description: 'Resolve library name to Context7 ID',
          parameters: {
            type: 'object',
            properties: {
              libraryName: { type: 'string', description: 'Library name' },
              query: { type: 'string', description: 'Task description' },
            },
            required: ['libraryName', 'query'],
          },
        },
        {
          name: 'monkeycode-ai_MonkeyCode__query-docs',
          description: 'Query library documentation',
          parameters: {
            type: 'object',
            properties: {
              libraryId: { type: 'string', description: 'Context7 library ID' },
              query: { type: 'string', description: 'Documentation query' },
            },
            required: ['libraryId', 'query'],
          },
        },
      ],
    });
  }

  listTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const endpoint of this.endpoints.values()) {
      tools.push(...endpoint.tools);
    }
    return tools;
  }

  validate(call: ToolCall): boolean {
    const toolName = call.tool_name.replace('monkeycode-ai_MonkeyCode__', '');
    for (const endpoint of this.endpoints.values()) {
      const tool = endpoint.tools.find((t) => t.name === call.tool_name);
      if (tool) {
        const required = tool.parameters.required;
        return required.every((p) => call.parameters[p] !== undefined);
      }
    }
    return false;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const toolName = call.tool_name.replace('monkeycode-ai_MonkeyCode__', '');

    if (this.mockMode) {
      return this.mockExecute(toolName, call);
    }

    // Production: HTTP call to remote endpoint
    for (const [key, endpoint] of this.endpoints) {
      if (endpoint.tools.some((t) => t.name === call.tool_name)) {
        try {
          const response = await fetch(`${endpoint.baseURL}/${toolName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(call.parameters),
          });
          const data = await response.json();
          return { call_id: call.call_id, success: response.ok, data };
        } catch (err) {
          logger.error(`Remote call failed: ${toolName} - ${err}`);
          return {
            call_id: call.call_id,
            success: false,
            data: null,
            error: err instanceof Error ? err.message : 'Network error',
          };
        }
      }
    }

    return {
      call_id: call.call_id,
      success: false,
      data: null,
      error: `Unknown tool: ${call.tool_name}`,
    };
  }

  private mockExecute(toolName: string, call: ToolCall): ToolResult {
    switch (toolName) {
      case 'websearch_search':
        return {
          call_id: call.call_id,
          success: true,
          data: {
            results: [
              { title: 'Mock Result 1', url: 'https://example.com/1', snippet: 'Mock search result for ' + call.parameters.query },
              { title: 'Mock Result 2', url: 'https://example.com/2', snippet: 'Another mock result' },
            ],
          },
        };

      case 'websearch_aisearch':
        return {
          call_id: call.call_id,
          success: true,
          data: {
            answer: `AI synthesized answer for query: ${call.parameters.query}`,
            sources: [{ title: 'Source 1', url: 'https://example.com' }],
          },
        };

      case 'docparse_parse':
        return {
          call_id: call.call_id,
          success: true,
          data: { document_id: Date.now(), filename: 'document.pdf', status: 'processing' },
        };

      case 'docparse_get_doc_upload_url':
        return {
          call_id: call.call_id,
          success: true,
          data: { upload_url: `https://upload.example.com/${Date.now()}`, url: `https://files.example.com/${call.parameters.file_name}` },
        };

      case 'docparse_get_parse_result':
        return {
          call_id: call.call_id,
          success: true,
          data: { status: 'completed', result_url: `https://results.example.com/${call.parameters.document_id}` },
        };

      case 'image_analysis_create_task':
        return {
          call_id: call.call_id,
          success: true,
          data: { task_id: `img_${Date.now()}` },
        };

      case 'image_analysis_get_result':
        return {
          call_id: call.call_id,
          success: true,
          data: { done: true, status: 'succeeded', text: 'Mock image analysis result' },
        };

      case 'image_generate_text_to_image':
        return {
          call_id: call.call_id,
          success: true,
          data: { task_id: `gen_${Date.now()}` },
        };

      case 'image_generate_query_task':
        return {
          call_id: call.call_id,
          success: true,
          data: { status: 'completed', image_urls: ['https://images.example.com/generated.png'] },
        };

      case 'imgsearch_search':
        return {
          call_id: call.call_id,
          success: true,
          data: { results: [{ url: 'https://images.example.com/1.jpg', alt: 'Mock image' }] },
        };

      case 'resolve-library-id':
        return {
          call_id: call.call_id,
          success: true,
          data: {
            results: [{
              libraryId: '/mock/repo',
              name: call.parameters.libraryName,
              description: 'Mock library',
              codeSnippets: 42,
              sourceReputation: 'High',
              benchmarkScore: 95,
              versions: ['v1.0.0', 'v2.0.0'],
            }],
          },
        };

      case 'query-docs':
        return {
          call_id: call.call_id,
          success: true,
          data: { content: `Documentation for ${call.parameters.libraryId}: Mock documentation content.`, sources: [] },
        };

      default:
        return { call_id: call.call_id, success: false, data: null, error: `Unknown tool: ${toolName}` };
    }
  }
}
