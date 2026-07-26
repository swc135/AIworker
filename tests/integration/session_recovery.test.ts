import { describe, it, expect } from 'vitest';
import { SessionStore } from '@/core/session_store';
import type { Message, PersistedSession } from '@/types';
import { randomUUID } from 'crypto';

describe('SessionStore Recovery', () => {
  const baseDir = `/tmp/opencode-session-recovery-test-${Date.now()}`;

  it('should recover sessions after store recreation', async () => {
    const store1 = new SessionStore(baseDir);
    const sessionId = randomUUID();
    
    const session: PersistedSession = {
      session_id: sessionId,
      task_id: 'task-1',
      status: 'active' as any,
      messages: [{ role: 'system', content: 'You are an AI assistant.' }],
      created_at: Date.now(),
    };
    
    await store1.save(session);

    // Simulate process restart by creating a new store instance
    const store2 = new SessionStore(baseDir);
    const recovered = await store2.get(sessionId);
    
    expect(recovered).toBeDefined();
    expect(recovered?.messages).toHaveLength(1);
    expect(recovered?.messages[0]?.role).toBe('system');
  });

  it('should truncate old messages during recovery', async () => {
    const store = new SessionStore(baseDir);
    const sessionId = randomUUID();
    
    const messages: Message[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push({ 
        role: i % 2 === 0 ? 'user' : 'assistant', 
        content: `Message ${i}` 
      } as Message);
    }

    const session: PersistedSession = {
      session_id: sessionId,
      task_id: 'task-2',
      status: 'active' as any,
      messages,
      created_at: Date.now(),
    };

    await store.save(session);
    
    // Truncate to last 3 messages
    await store.truncateMessages(sessionId, 3);
    
    const recovered = await store.get(sessionId);
    if (recovered) {
      const nonSystemMsgs = recovered.messages.filter((m) => m.role !== 'system');
      expect(nonSystemMsgs.length).toBeLessThanOrEqual(3);
    }
  });

  it('should handle missing session files gracefully', async () => {
    const store = new SessionStore(baseDir);
    const nonExistentId = 'non-existent-session-id';
    
    const result = await store.get(nonExistentId);
    expect(result).toBeUndefined();
  });

  it('should serialize and deserialize message arrays correctly', async () => {
    const store = new SessionStore(baseDir);
    const sessionId = randomUUID();
    
    const originalMessages: Message[] = [
      { role: 'system', content: 'Be helpful' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    
    const session: PersistedSession = {
      session_id: sessionId,
      task_id: 'task-3',
      status: 'active' as any,
      messages: originalMessages,
      created_at: Date.now(),
    };
    
    await store.save(session);

    const loaded = await store.get(sessionId);
    expect(loaded).toBeDefined();
    expect(loaded?.messages).toEqual(originalMessages);
  });

  it('should list all session IDs', async () => {
    const store = new SessionStore(baseDir);
    const sid1 = randomUUID();
    const sid2 = randomUUID();
    
    const session1: PersistedSession = {
      session_id: sid1,
      task_id: 'task-a',
      status: 'active' as any,
      messages: [],
      created_at: Date.now(),
    };
    
    const session2: PersistedSession = {
      session_id: sid2,
      task_id: 'task-b',
      status: 'idle' as any,
      messages: [],
      created_at: Date.now(),
    };
    
    await store.save(session1);
    await store.save(session2);
    
    const ids = store.listIds();
    expect(ids).toContain(sid1);
    expect(ids).toContain(sid2);
    expect(ids.length).toBeGreaterThanOrEqual(2);
  });

  it('should delete sessions properly', async () => {
    const store = new SessionStore(baseDir);
    const sessionId = randomUUID();
    
    const session: PersistedSession = {
      session_id: sessionId,
      task_id: 'task-del',
      status: 'active' as any,
      messages: [],
      created_at: Date.now(),
    };
    
    await store.save(session);
    expect(store.count()).toBeGreaterThan(0);
    
    await store.delete(sessionId);
    const result = await store.get(sessionId);
    expect(result).toBeUndefined();
  });
});
