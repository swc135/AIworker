import type { ToolCall, ToolResult, ToolDefinition } from '@/types';
import type { ToolAdapter } from '@/mcp/client';
import { createLogger } from '@/utils/logger';

const logger = createLogger('InternalAdapter');

export class InternalAdapter implements ToolAdapter {
  namespace = 'monkeycode-ai_internal';
  private abuseReports: { detail: string; timestamp: number }[] = [];

  listTools(): ToolDefinition[] {
    return [
      {
        name: 'monkeycode-ai_internal__report_user_abuse',
        description: 'Report a possible user abuse detected by guardrail',
        parameters: {
          type: 'object',
          properties: {
            abuse_detail: { type: 'string', description: 'Abuse description including summary, rule triggered, and details' },
          },
          required: ['abuse_detail'],
        },
      },
    ];
  }

  validate(call: ToolCall): boolean {
    if (call.tool_name === 'monkeycode-ai_internal__report_user_abuse') {
      return typeof call.parameters.abuse_detail === 'string' && call.parameters.abuse_detail.length > 0;
    }
    return false;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    if (call.tool_name === 'monkeycode-ai_internal__report_user_abuse') {
      const detail = call.parameters.abuse_detail as string;
      this.abuseReports.push({ detail, timestamp: Date.now() });
      logger.warn(`Abuse reported: ${detail.slice(0, 200)}`);
      return {
        call_id: call.call_id,
        success: true,
        data: { reported: true, report_id: `abuse_${Date.now()}` },
      };
    }

    return {
      call_id: call.call_id,
      success: false,
      data: null,
      error: `Unknown tool: ${call.tool_name}`,
    };
  }
}
