import type { ToolCall, ToolResult, ToolDefinition } from '@/types';
import type { ToolAdapter } from '@/mcp/client';
import { createLogger } from '@/utils/logger';
import { withRetryOnHttpStatus } from '@/utils/retry';

const logger = createLogger('WebAdapter');

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export class WebAdapter implements ToolAdapter {
  namespace = 'web';
  private userAgent = 'OpenCode-AIWorker/1.0';

  listTools(): ToolDefinition[] {
    return [
      {
        name: 'webfetch',
        description: 'Fetch content from a URL and return as markdown or text.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to fetch' },
            format: { type: 'string', description: 'Output format: markdown, text, or html' },
            timeout: { type: 'number', description: 'Timeout in seconds (max 120)' },
          },
          required: ['url'],
        },
      },
      {
        name: 'websearch_search',
        description: 'Search public web pages and return results.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            count: { type: 'number', description: 'Max results (1-50)' },
            time_range: { type: 'string', description: 'Time range: day, week, month, year' },
          },
          required: ['query'],
        },
      },
      {
        name: 'websearch_aisearch',
        description: 'AI-powered web search that synthesizes answers from multiple sources.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            count: { type: 'number', description: 'Max source results (1-10)' },
          },
          required: ['query'],
        },
      },
    ];
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const base = { call_id: call.call_id, success: false, data: null };

    try {
      switch (call.tool_name) {
        case 'webfetch':
          return await this.handleWebFetch(call, base);
        case 'websearch_search':
          return await this.handleSearch(call, base);
        case 'websearch_aisearch':
          return await this.handleAISearch(call, base);
        default:
          return { ...base, error: `Unknown tool: ${call.tool_name}` };
      }
    } catch (err) {
      return { ...base, error: (err as Error).message };
    }
  }

  validate(call: ToolCall): boolean {
    return ['webfetch', 'websearch_search', 'websearch_aisearch'].includes(call.tool_name);
  }

  private async handleWebFetch(call: ToolCall, base: { call_id: string; success: boolean; data: unknown }): Promise<ToolResult> {
    const url = call.parameters.url as string;
    const format = (call.parameters.format as string) || 'markdown';
    const timeout = ((call.parameters.timeout as number) || 30) * 1000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await withRetryOnHttpStatus(
        () => fetch(url, {
          headers: { 'User-Agent': this.userAgent },
          signal: controller.signal,
          redirect: 'follow',
        }),
        { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 10000 },
      );

      if (!response.ok) {
        return { ...base, error: `HTTP ${response.status}: ${response.statusText}` };
      }

      const contentType = response.headers.get('content-type') || '';
      let content: string;

      if (format === 'html') {
        content = await response.text();
      } else {
        content = await response.text();
        if (format === 'markdown' && contentType.includes('text/html')) {
          content = this.htmlToMarkdown(content);
        }
      }

      // Truncate very long content
      if (content.length > 100000) {
        content = content.slice(0, 100000) + '\n\n[Content truncated at 100KB]';
      }

      return { ...base, success: true, data: { url, format, content, contentType } };
    } finally {
      clearTimeout(timer);
    }
  }

  private async handleSearch(call: ToolCall, base: { call_id: string; success: boolean; data: unknown }): Promise<ToolResult> {
    const query = call.parameters.query as string;
    const count = (call.parameters.count as number) || 10;

    try {
      const results = await this.duckduckgoSearch(query, Math.min(count, 20));
      if (results.length > 0) {
        return { ...base, success: true, data: { results, query, count: results.length } };
      }
    } catch (err) {
      logger.debug(`Web search failed: ${err}, returning available results`);
    }

    // Fallback: empty results structure so consumers know search was attempted
    return { ...base, success: true, data: { results: [], query, count: 0, network_unavailable: true } };
  }

  private async handleAISearch(call: ToolCall, base: { call_id: string; success: boolean; data: unknown }): Promise<ToolResult> {
    const query = call.parameters.query as string;
    const count = (call.parameters.count as number) || 10;

    try {
      const results = await this.duckduckgoSearch(query, Math.min(count, 10));
      if (results.length === 0) {
        return { ...base, success: true, data: { answer: `No results found for "${query}". Network or API unavailable.`, sources: [] } };
      }

      const answer = this.synthesizeAnswer(query, results);
      return {
        ...base,
        success: true,
        data: {
          answer,
          sources: results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })),
        },
      };
    } catch (err) {
      logger.debug(`AI search failed: ${err}`);
      return {
        ...base,
        success: true,
        data: {
          answer: `Unable to synthesize results for "${query}". Search network unavailable.`,
          sources: [],
        },
      };
    }
  }

  private async duckduckgoSearch(query: string, maxResults: number): Promise<SearchResult[]> {
    const timeout = Math.max(3000, 15000);
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await withRetryOnHttpStatus(
        () => fetch(url, {
          headers: { 'User-Agent': this.userAgent },
          signal: controller.signal,
        }),
        { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 10000 },
      );

      if (!response.ok) {
        throw new Error(`Search returned HTTP ${response.status}`);
      }

      const html = await response.text();
      return this.parseDDGResults(html, maxResults);
    } finally {
      clearTimeout(timer);
    }
  }

  private parseDDGResults(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    // Parse DuckDuckGo HTML results
    const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    let match;
    const urls: string[] = [];
    const titles: string[] = [];

    while ((match = resultRegex.exec(html)) !== null) {
      urls.push(this.cleanDDGUrl(match[1]!));
      titles.push(match[2]!.trim());
    }

    const snippets: string[] = [];
    while ((match = snippetRegex.exec(html)) !== null) {
      snippets.push(match[1]!.replace(/<[^>]*>/g, '').trim());
    }

    for (let i = 0; i < Math.min(urls.length, maxResults); i++) {
      if (urls[i]) {
        results.push({
          title: titles[i] || 'Untitled',
          url: urls[i]!,
          snippet: snippets[i] || '',
        });
      }
    }

    return results;
  }

  private cleanDDGUrl(url: string): string {
    // DuckDuckGo wraps URLs with redirects like //duckduckgo.com/l/?uddg=REAL_URL&...
    const uddgMatch = url.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      return decodeURIComponent(uddgMatch[1]!);
    }
    if (url.startsWith('//')) {
      return 'https:' + url;
    }
    return url;
  }

  private synthesizeAnswer(query: string, results: SearchResult[]): string {
    const parts: string[] = [
      `Search results for: "${query}"`,
      '',
    ];

    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      parts.push(`${i + 1}. **${r.title}**`);
      parts.push(`   ${r.url}`);
      if (r.snippet) {
        parts.push(`   ${r.snippet}`);
      }
      parts.push('');
    }

    parts.push('---');
    parts.push(`Based on ${results.length} web sources. For more accurate synthesis, configure an LLM provider.`);

    return parts.join('\n');
  }

  private htmlToMarkdown(html: string): string {
    // Simple HTML to Markdown conversion for common elements
    let md = html;

    // Remove scripts and styles
    md = md.replace(/<script[\s\S]*?<\/script>/gi, '');
    md = md.replace(/<style[\s\S]*?<\/style>/gi, '');
    md = md.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

    // Headers
    md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n');
    md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n');
    md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n');
    md = md.replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, '#### $1\n\n');

    // Bold and italic
    md = md.replace(/<strong[^>]*>([^<]*)<\/strong>/gi, '**$1**');
    md = md.replace(/<b[^>]*>([^<]*)<\/b>/gi, '**$1**');
    md = md.replace(/<em[^>]*>([^<]*)<\/em>/gi, '*$1*');
    md = md.replace(/<i[^>]*>([^<]*)<\/i>/gi, '*$1*');

    // Links
    md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

    // Paragraphs and line breaks
    md = md.replace(/<br\s*\/?>/gi, '\n');
    md = md.replace(/<\/p>/gi, '\n\n');

    // Lists
    md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');

    // Remove remaining tags
    md = md.replace(/<[^>]*>/g, '');

    // Clean up whitespace
    md = md.replace(/\n{3,}/g, '\n\n');
    md = md.replace(/[ \t]+/g, ' ');
    md = md.trim();

    return md;
  }
}
