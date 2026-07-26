import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionStore } from '@/core/session_store';
import type { PersistedSession } from '@/core/session_store';
import { rm } from 'fs/promises';
import { existsSync } from 'fs';

const testDir = '/tmp/opencode-session-store-test';

beforeEach(async () => {
  if (existsSync(testDir)) await rm(testDir, { recursive: true, force: true });
});

afterEach(async () => {
  if (existsSync(testDir)) await rm(testDir, { recursive: true, force: true });
});

const sampleSession: PersistedSession = {
  session_id: 'sess-001',
  task_id: 'task-001',
  created_at: Date.now(),
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' },
  ],
};

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore(testDir);
  });

  it('should save and load a session', async () => {
    await store.save(sampleSession);
    const loaded = await store.get('sess-001');

    expect(loaded).toBeDefined();
    expect(loaded!.session_id).toBe('sess-001');
    expect(loaded!.messages).toHaveLength(3);
    expect(loaded!.messages[0]!.role).toBe('system');
    expect(loaded!.messages[2]!.role).toBe('assistant');
  });

  it('should load all sessions from disk', async () => {
    await store.save({ ...sampleSession, session_id: 'sess-a' });
    await store.save({ ...sampleSession, session_id: 'sess-b' });

    const store2 = new SessionStore(testDir);
    const allSessions = await store2.loadAll();

    expect(allSessions).toHaveLength(2);
    // Should be sorted by creation time descending
    expect(allSessions[0]!.created_at).toBeGreaterThanOrEqual(allSessions[1]!.created_at);
  });

  it('should return empty array when no sessions exist', async () => {
    const sessions = await store.loadAll();
    expect(sessions).toEqual([]);
  });

  it('should delete a session', async () => {
    await store.save(sampleSession);
    await store.delete('sess-001');

    const loaded = await store.get('sess-001');
    expect(loaded).toBeUndefined();
    expect(store.count()).toBe(0);
  });

  it('should truncate old messages while keeping system messages', async () => {
    const fullSession: PersistedSession = {
      ...sampleSession,
      session_id: 'sess-trunc',
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Msg 1' },
        { role: 'assistant', content: 'Reply 1' },
        { role: 'user', content: 'Msg 2' },
        { role: 'assistant', content: 'Reply 2' },
        { role: 'user', content: 'Msg 3' },
        { role: 'assistant', content: 'Reply 3' },
        { role: 'user', content: 'Msg 4' },
        { role: 'assistant', content: 'Reply 4' },
        { role: 'user', content: 'Msg 5' },
        { role: 'assistant', content: 'Reply 5' },
      ],
    };

    await store.save(fullSession);
    await store.truncateMessages('sess-trunc', 2);

    const loaded = await store.get('sess-trunc');
    expect(loaded!.messages.length).toBeLessThan(5);
    const hasSystem = loaded!.messages.some((m) => m.role === 'system');
    expect(hasSystem).toBe(true);
  });

  it('should list session IDs', async () => {
    await store.save({ ...sampleSession, session_id: 'x' });
    await store.save({ ...sampleSession, session_id: 'y' });
    expect(store.listIds()).toHaveLength(2);
  });
});
