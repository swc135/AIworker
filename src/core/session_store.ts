import type { Message, TaskConfig } from '@/types';
import { createLogger } from '@/utils/logger';
import { fileExists, readTextFile, writeFile } from '@/utils/fs';
import { resolve } from 'path';

const logger = createLogger('SessionStore');

export interface PersistedSession {
  session_id: string;
  task_id: string;
  created_at: number;
  messages: Message[];
}

export class SessionStore {
  private storePath: string;
  private sessions: Map<string, PersistedSession> = new Map();

  constructor(workspace: string) {
    this.storePath = resolve(workspace, '.monkeycode', 'sessions');
  }

  async loadAll(): Promise<PersistedSession[]> {
    const dirPath = this.storePath;
    if (!await fileExists(dirPath)) return [];

    const fs = await import('fs/promises');
    const entries = await fs.readdir(dirPath);
    const results: PersistedSession[] = [];

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const content = await fs.readFile(resolve(dirPath, entry), 'utf-8');
        const session = JSON.parse(content) as PersistedSession;
        this.sessions.set(session.session_id, session);
        results.push(session);
      } catch {
        logger.debug(`Skipping corrupted session: ${entry}`);
      }
    }

    results.sort((a, b) => b.created_at - a.created_at);
    logger.info(`Loaded ${results.length} sessions from disk`);
    return results;
  }

  async save(session: PersistedSession): Promise<void> {
    await this.sessions.set(session.session_id, session);
    const filePath = resolve(this.storePath, `${session.session_id}.json`);

    // Ensure directory exists
    const dir = await import('fs/promises');
    const { mkdir } = await import('fs/promises');
    await mkdir(this.storePath, { recursive: true });

    await writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
    logger.debug(`Saved session: ${session.session_id}`);
  }

  async get(sessionId: string): Promise<PersistedSession | undefined> {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }

    const filePath = resolve(this.storePath, `${sessionId}.json`);
    if (await fileExists(filePath)) {
      try {
        const content = await readTextFile(filePath);
        const session = JSON.parse(content) as PersistedSession;
        this.sessions.set(sessionId, session);
        return session;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  async delete(sessionId: string): Promise<void> {
    const filePath = resolve(this.storePath, `${sessionId}.json`);
    const fs = await import('fs/promises');
    try {
      await fs.rm(filePath, { force: true });
      this.sessions.delete(sessionId);
      logger.debug(`Deleted session: ${sessionId}`);
    } catch {
      this.sessions.delete(sessionId);
    }
  }

  async truncateMessages(sessionId: string, maxMessages: number = 50): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const allMsgs = [...session.messages];
    const keepSystem = allMsgs.filter((m) => m.role === 'system');
    const recentUserMsgs = allMsgs.filter((m) => m.role !== 'system').slice(-maxMessages);

    session.messages = [...keepSystem, ...recentUserMsgs];
    await this.save(session);
  }

  count(): number {
    return this.sessions.size;
  }

  listIds(): string[] {
    return Array.from(this.sessions.keys());
  }
}
