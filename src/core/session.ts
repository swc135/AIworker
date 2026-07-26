import type { Session, SessionStatus, TaskConfig } from '@/types';
import { createLogger } from '@/utils/logger';

const logger = createLogger('SessionManager');

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private currentSession: Session | null = null;

  create(taskConfig: TaskConfig): Session {
    const session: Session = {
      session_id: taskConfig.session_id,
      task_id: taskConfig.task_id,
      status: 'active',
      memory_file: null,
      created_at: Date.now(),
    };
    this.sessions.set(session.session_id, session);
    this.currentSession = session;
    logger.info(`Session created: ${session.session_id}`);
    return session;
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getCurrent(): Session | null {
    return this.currentSession;
  }

  updateStatus(sessionId: string, status: SessionStatus): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
      logger.info(`Session ${sessionId} status → ${status}`);
    }
  }

  terminate(sessionId: string): void {
    this.updateStatus(sessionId, 'terminated');
    if (this.currentSession?.session_id === sessionId) {
      this.currentSession = null;
    }
  }
}
