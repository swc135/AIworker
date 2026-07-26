import { readTextFile, writeFile, fileExists, workspacePath } from '@/utils/fs';
import { createLogger } from '@/utils/logger';

const logger = createLogger('Memory');

export interface MemoryEntry {
  summary: string;
  date: string;
  context: string;
  category?: string;
  instructions: string[];
}

export class MemorySystem {
  private workspace: string;
  private memoryPath: string;
  private entries: MemoryEntry[] = [];

  constructor(workspace: string) {
    this.workspace = workspace;
    this.memoryPath = workspacePath(workspace, '.monkeycode', 'MEMORY.md');
  }

  async load(): Promise<MemoryEntry[]> {
    if (!(await fileExists(this.memoryPath))) {
      logger.debug('No MEMORY.md found');
      return [];
    }

    try {
      const content = await readTextFile(this.memoryPath);
      this.entries = this.parseEntries(content);
      logger.info(`Loaded ${this.entries.length} memory entries`);
      return this.entries;
    } catch (err) {
      logger.warn(`Failed to load MEMORY.md: ${err}`);
      return [];
    }
  }

  async save(entry: MemoryEntry): Promise<void> {
    // Check for duplicates
    const isDuplicate = this.entries.some(
      (e) => e.summary === entry.summary || this.instructionsOverlap(e.instructions, entry.instructions)
    );

    if (isDuplicate) {
      logger.debug(`Skipping duplicate entry: ${entry.summary}`);
      return;
    }

    this.entries.push(entry);
    await this.persist();
    logger.info(`Saved memory entry: ${entry.summary}`);
  }

  private instructionsOverlap(a: string[], b: string[]): boolean {
    const setA = new Set(a.map((s) => s.trim().toLowerCase()));
    const setB = new Set(b.map((s) => s.trim().toLowerCase()));
    const intersection = [...setA].filter((x) => setB.has(x));
    return intersection.length >= Math.min(setA.size, setB.size) * 0.7;
  }

  private async persist(): Promise<void> {
    const content = this.formatFile();
    await writeFile(this.memoryPath, content, 'utf-8');
  }

  private formatFile(): string {
    const lines: string[] = [
      '# 用户指令记忆',
      '',
      '本文件记录了用户的指令、偏好和教导，用于在未来的交互中提供参考。',
      '',
      '## 格式',
      '',
      '#### 用户指令条目',
      '用户指令条目应遵循以下格式：',
      '',
      '[用户指令摘要]',
      '- Date: [YYYY-MM-DD]',
      '- Context: [提及的场景或时间]',
      '- Instructions:',
      '  - [用户教导或指示的内容，逐行描述]',
      '',
      '#### 项目知识条目',
      'Agent 在任务执行过程中发现的条目应遵循以下格式：',
      '',
      '[项目知识摘要]',
      '- Date: [YYYY-MM-DD]',
      '- Context: Agent 在执行 [任务描述] 时发现',
      '- Category: [运维部署|构建方法|测试方法|排错调试|工作流协作|环境配置]',
      '- Instructions:',
      '  - [具体的知识点，逐行描述]',
      '',
      '## 去重策略',
      '- 添加新条目前，检查是否存在相似或相同的指令',
      '- 若发现重复，跳过新条目或与已有条目合并',
      '',
      '## 条目',
      '',
    ];

    for (const entry of this.entries) {
      lines.push(`### ${entry.summary}`);
      lines.push(`- Date: ${entry.date}`);
      lines.push(`- Context: ${entry.context}`);
      if (entry.category) {
        lines.push(`- Category: ${entry.category}`);
      }
      lines.push('- Instructions:');
      for (const inst of entry.instructions) {
        lines.push(`  - ${inst}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private parseEntries(content: string): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    const sections = content.split(/^### /m).slice(1);

    for (const section of sections) {
      const lines = section.split('\n');
      const summary = lines[0]!.trim();

      let date = '';
      let context = '';
      let category: string | undefined;
      const instructions: string[] = [];

      for (const line of lines) {
        if (line.startsWith('- Date:')) date = line.replace('- Date:', '').trim();
        else if (line.startsWith('- Context:')) context = line.replace('- Context:', '').trim();
        else if (line.startsWith('- Category:')) category = line.replace('- Category:', '').trim();
        else if (line.startsWith('  - ')) instructions.push(line.replace('  - ', '').trim());
      }

      if (summary && instructions.length > 0) {
        entries.push({ summary, date, context, category, instructions });
      }
    }

    return entries;
  }
}
