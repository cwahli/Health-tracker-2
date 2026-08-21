/**
 * Food #n tape actions (Q-6.4). Preview only — never PATCHes remaining / queue / all_green.
 */
import { buildScoreboard } from './goldenScoreboard';
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

/** skipScout ids are not agent_jobs rows until persisted to R2. */
export function isSyntheticTapeJobId(jobId: string | null | undefined): boolean {
  return /^golden_/i.test(String(jobId || '').trim());
}

export function tapeJobCandidatesFromDetail(detail: any): string[] {
  const out: string[] = [];
  const push = (id?: string | null) => {
    const s = String(id || '').trim();
    if (!s || out.includes(s)) return;
    if (!/^(job_|golden_)/i.test(s) && s.length < 8) return;
    out.push(s);
  };
  const ev =
    detail?.now?.current_evidence ||
    detail?.bug?.current_evidence ||
    detail?.work_item?.current_evidence ||
    detail?.current_evidence ||
    null;
  push(ev?.job_id || ev?.jobId);
  push(detail?.jobId || detail?.job_id);
  const commits = detail?.commits || detail?.now?.commits || detail?.work_item?.commits || [];
  for (let i = commits.length - 1; i >= 0; i--) {
    push(commits[i]?.evidence?.job_id);
  }
  for (const h of detail?.work_item?.hold_refs || ev?.hold_refs || []) {
    push(h);
  }
  return out;
}

/** Pull tape fields off /api/jobs/status (clean_result). Public R2 URLs may be 403. */
export function tapeFromJobRecord(job: any): {
  foodLog: unknown;
  scout: unknown;
  logText: string;
  logsUrl: string | null;
  debugUrl: string | null;
  jobId: string | null;
} {
  const row = job || {};
  const cr = row.clean_result && typeof row.clean_result === 'object' ? row.clean_result : {};
  const data = row.data && typeof row.data === 'object' ? row.data : {};
  const foodLog = cr.pendingFoodLog || cr.foodLog || data.pendingFoodLog || data.foodLog || null;
  const scout = cr.scoutItems || cr.scout || data.scoutItems || data.scout || null;
  const logText = String(cr.backendLogs || data.backendLogs || row.backendLogs || '');
  const logsUrl = cr.backendLogsUrl || data.backendLogsUrl || null;
  const debugUrl = cr.debugUrl || cr.debug_url || row.debug_url || null;
  return {
    foodLog,
    scout,
    logText,
    logsUrl: logsUrl ? String(logsUrl) : null,
    debugUrl: debugUrl ? String(debugUrl) : null,
    jobId: row.id ? String(row.id) : null,
  };
}

export function scoreLocalTape(opts: {
  foodLog?: unknown;
  scout?: unknown;
  logText?: string;
  extraIssues?: string[];
}) {
  return buildScoreboard({
    foodLog: opts.foodLog,
    scout: opts.scout,
    logText: opts.logText || '',
    extraIssues: opts.extraIssues || [],
  });
}

/** True when Replay log actually loaded pipeline logs, not a hollow golden_* preview. */
export function tapeBoardIsHydrated(board: any): boolean {
  if (!board) return false;
  const books = Array.isArray(board.ledger?.books) ? board.ledger.books : [];
  const hasLogBooks = books.some(
    (x: any) => (x?.id === 'foundation' || x?.id === 'reconcile') && x?.kcal != null
  );
  if (hasLogBooks) return true;
  if (board.tapeHydrated === true || Number(board.logChars) > 800) return true;
  const journey = Array.isArray(board.journey) ? board.journey : [];
  const bound = journey.filter((r: any) =>
    r?.phase === 'catalog' || r?.phase === 'label_truth' || r?.phase === 'usda_live'
  ).length;
  if (bound >= 3) return true;
  const inv = Array.isArray(board.invariants) ? board.invariants : [];
  if (inv.length && inv.every((i: any) => /trial balance incomplete/i.test(String(i.label || '')))) {
    return false;
  }
  if (inv.length >= 2) return true;
  return false;
}

/** Prefer the board that actually resolved scout rows and has ledger books. */
export function pickTapeBoard(a: any, b: any): any {
  const score = (board: any) => {
    if (!board) return -1;
    const journey = Array.isArray(board.journey) ? board.journey : [];
    const resolved = journey.filter(
      (r: any) => r?.phase && r.phase !== 'scouted' && r.phase !== 'no_match' && r.phase !== 'fallback'
    ).length;
    const inv = Array.isArray(board.invariants) ? board.invariants.length : 0;
    const books = (board.ledger?.books || []).filter((x: any) => x && x.kcal != null).length;
    const hasLogBooks = (board.ledger?.books || []).some(
      (x: any) => (x?.id === 'foundation' || x?.id === 'reconcile') && x?.kcal != null
    );
    const logish = board.tapeHydrated || Number(board.logChars) > 800 || hasLogBooks ? 400 : 0;
    return resolved * 20 + inv * 2 + books * 5 + logish;
  };
  return score(a) >= score(b) ? a || b : b;
}
