/**
 * Food #n tape actions (Q-6.4). Preview only — never PATCHes remaining / queue / all_green.
 */
export type TapeReplayMode = 'log' | 'catalog';

export type TapeReplayBody = {
  replayMode?: TapeReplayMode;
  jobId?: string | null;
  logText?: string;
  foodLog?: unknown;
  scout?: unknown;
  backendLogsUrl?: string;
  extraIssues?: string[];
};

export function buildTapeReplayBody(opts: {
  mode: TapeReplayMode;
  jobId?: string | null;
  logText?: string;
  foodLog?: unknown;
  scout?: unknown;
  debugUrl?: string | null;
  extraIssues?: string[];
}): TapeReplayBody {
  const body: TapeReplayBody = {
    jobId: opts.jobId || undefined,
    logText: opts.logText || undefined,
    foodLog: opts.foodLog || undefined,
    scout: opts.scout || undefined,
    extraIssues: opts.extraIssues,
  };
  if (opts.mode === 'catalog') body.replayMode = 'catalog';
  const url = String(opts.debugUrl || '');
  if (/^https?:\/\//i.test(url)) body.backendLogsUrl = url;
  return body;
}

/** Catalog / log preview must not write queue status. */
export function tapeReplayTouchesQueue(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return b.queue != null || b.remaining != null || b.all_green != null || b.status === 'fixed';
}

export function reanalyzeJobId(evidence: { job_id?: string | null; jobId?: string | null } | null | undefined): string | null {
  const id = String(evidence?.job_id || evidence?.jobId || '').trim();
  return id || null;
}
