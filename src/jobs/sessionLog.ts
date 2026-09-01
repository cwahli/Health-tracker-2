export type SessionWriter =
  | 'LogChat.submit'
  | 'JobQueueRunner'
  | 'poller'
  | 'realtime'
  | 'r2'
  | 'JobStore.apply';

export type SessionAction = 'accepted' | 'ignored_stale_turn' | 'ignored_same_snapshot' | 'completed';

export interface SessionEvent {
  ts: number;
  writer: SessionWriter;
  turn?: number;
  status?: string;
  resultKey?: string;
  action: SessionAction;
}

const MAX = 20;
const logs = new Map<string, SessionEvent[]>();

export function recordSessionEvent(
  jobId: string,
  event: Omit<SessionEvent, 'ts'> & { ts?: number }
): SessionEvent[] {
  if (!jobId) return [];
  const row: SessionEvent = { ts: event.ts ?? Date.now(), ...event };
  const next = [...(logs.get(jobId) || []), row].slice(-MAX);
  logs.set(jobId, next);
  return next;
}

export function getSessionLog(jobId: string): SessionEvent[] {
  return logs.get(jobId) || [];
}

export function formatSessionLog(jobId: string): string {
  return getSessionLog(jobId)
    .map((e) => `${new Date(e.ts).toISOString()} ${e.writer} ${e.action} ${e.status || ''} ${e.resultKey || ''}`.trim())
    .join('\n');
}
