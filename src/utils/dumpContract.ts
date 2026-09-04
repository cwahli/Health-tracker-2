/**
 * Dump oracles — the inner loop for a captured debug.md.
 * Classify the capture (what was wrong). Code probes live in named vitest.
 * Do not call Gemini. Do not POST /loop.
 */

export type DumpFacts = {
  jobId: string | null;
  status: string | null;
  hasFinalizedLedger: boolean;
  dietitianFailedPermanently: boolean;
  matrixCalcStandby: boolean;
  breadcrumbDuplicateRows: number;
  headingDup: string[];
  diag5AutoSend: boolean;
  ledgerKcal: number | null;
  hasHappyPath: boolean;
  sessionSucceeded: boolean;
  analyzeFinishedCount: number;
  hasScoutStall: boolean;
  hasModelFallback: boolean;
  sessionFailed: boolean;
  userRetried: boolean;
};

export type OracleFail = {
  class: string;
  id: string;
  detail: string;
  file: string;
  doNot: string;
};

export function parseDebugMarkdown(md: string): DumpFacts {
  const text = String(md || '');
  const jobId = text.match(/\*\*Job ID:\*\*\s*`([^`]+)`/)?.[1] || null;
  const status = text.match(/\*\*Status:\*\*\s*(\S+)/)?.[1] || null;
  const hasFinalizedLedger = /\[Budget\]\s*Finalized ledger/i.test(text);
  const dietitianFailedPermanently = /Dietitian Failed Permanently/i.test(text);
  const matrixCalcStandby = /\*\*5\.\s*Mathematical Calculation Engine\*\*[^\n]*Standby/i.test(text);
  const diag5AutoSend = /\[DIAG5\]\s*auto-send effect fired/i.test(text);
  const hasHappyPath = /\[MealBuild\]\s*happy-path/i.test(text);
  const sessionSucceeded = /AnalyzeFinished succeeded|result_ready|updateJob succeeded/i.test(text);
  const analyzeFinishedCount = (text.match(/AnalyzeFinished succeeded/g) || []).length;
  const hasScoutStall = /Stream stalled:.*produced no tokens for 90s/i.test(text);
  const hasModelFallback = /falling back to gemini-3\.1-flash-lite/i.test(text);
  const sessionFailed = /JobStore\.apply updateJob failed|JobQueueRunner ServerStatus failed/i.test(text);
  const userRetried = /Retrying job |\{"label":"Retry"\}|USER CONTINUATION/i.test(text);

  const kcalHits = [...text.matchAll(/(?:Calories:|Finalized ledger[^:\n]*:)\s*(\d+(?:\.\d+)?)\s*kcal/gi)];
  const ledgerKcal = kcalHits.length ? Number(kcalHits[kcalHits.length - 1][1]) : null;

  const headingCounts = new Map<string, number>();
  for (const line of text.split('\n')) {
    const h = line.match(/^##\s+(.+)$/);
    if (!h) continue;
    const key = h[1].replace(/\s+/g, ' ').trim();
    headingCounts.set(key, (headingCounts.get(key) || 0) + 1);
  }
  const headingDup = [...headingCounts.entries()].filter(([, n]) => n > 1).map(([k]) => k);

  let breadcrumbDuplicateRows = 0;
  const crumbSeen = new Set<string>();
  for (const line of text.split('\n')) {
    const row = line.match(/^\|\s*(\d{2}:\d{2}:\d{2})\s*\|\s*([^|]+)\|/);
    if (!row) continue;
    const k = line.replace(/\s+/g, ' ').trim();
    if (crumbSeen.has(k)) breadcrumbDuplicateRows += 1;
    else crumbSeen.add(k);
  }

  return {
    jobId,
    status,
    hasFinalizedLedger,
    dietitianFailedPermanently,
    matrixCalcStandby,
    breadcrumbDuplicateRows,
    headingDup,
    diag5AutoSend,
    ledgerKcal,
    hasHappyPath,
    sessionSucceeded,
    analyzeFinishedCount,
    hasScoutStall,
    hasModelFallback,
    sessionFailed,
    userRetried,
  };
}

export function classifyDump(facts: DumpFacts): OracleFail[] {
  const fails: OracleFail[] = [];
  if (facts.hasFinalizedLedger && facts.dietitianFailedPermanently && facts.status && /running|queued|processing/i.test(facts.status)) {
    fails.push({
      class: 'DEGRADE_NOT_TERMINAL',
      id: 'JOB_TERMINAL_IF_LEDGER',
      detail: `status=${facts.status} after Finalized ledger + Dietitian Failed Permanently`,
      file: 'server_food_analyze_run.ts, server_sse_json.ts, serverJobs.ts persist',
      doNot: 'expected.json, ReceptionistCard, LogChat rewrite, FoodCard',
    });
  }
  if (facts.hasFinalizedLedger && facts.matrixCalcStandby) {
    fails.push({
      class: 'DEBUG_MISS',
      id: 'DEBUG_MATCHES_LOG',
      detail: 'pipeline matrix math Standby while logs have Finalized ledger',
      file: 'src/utils/debugPayload.ts',
      doNot: 'FoodCard layout, catalog aliases',
    });
  }
  if (facts.breadcrumbDuplicateRows > 0) {
    fails.push({
      class: 'DEBUG_DUP',
      id: 'HEADING_ONCE',
      detail: `${facts.breadcrumbDuplicateRows} duplicate breadcrumb row(s)`,
      file: 'src/utils/debugPayload.ts',
      doNot: 'G1 expected.json',
    });
  }
  if (facts.headingDup.length) {
    fails.push({
      class: 'DEBUG_DUP',
      id: 'HEADING_ONCE',
      detail: `duplicate ## ${facts.headingDup.join(', ')}`,
      file: 'src/utils/debugPayload.ts',
      doNot: 'G1 expected.json',
    });
  }
  if (facts.diag5AutoSend) {
    fails.push({
      class: 'SIBLING_EFFECT',
      id: 'NO_FOREIGN_EFFECT',
      detail: 'DIAG5 auto-send fired (Front Desk handoff effect) on this food dump',
      file: 'src/utils/chatAutoSend.ts, LogChat.tsx auto-send effect',
      doNot: 'server_food_analyze_run.ts, expected.json',
    });
  }
  if (facts.hasHappyPath && (facts.hasFinalizedLedger || facts.ledgerKcal != null) && !facts.sessionSucceeded) {
    fails.push({
      class: 'DISPLAY_LAG',
      id: 'RESULT_READY_BEFORE_PERSIST',
      detail: `happy-path + ${facts.ledgerKcal} kcal in dump but session never succeeded — poller waited on R2/upsert`,
      file: 'serverJobs.ts publishResultReady, JobQueueRunner (complete once)',
      doNot: 'expected.json, FoodCard rewrite, live Gemini retry',
    });
  }
  if (facts.analyzeFinishedCount > 1) {
    fails.push({
      class: 'COMPLETE_ONCE',
      id: 'ANALYZE_FINISHED_ONCE',
      detail: `AnalyzeFinished succeeded x${facts.analyzeFinishedCount} (upsert storm)`,
      file: 'src/jobs/JobQueueRunner.ts inFlightIds + skip if already succeeded',
      doNot: 'POST /loop, extra persist',
    });
  }
  if (facts.hasScoutStall && !facts.hasModelFallback && (facts.sessionFailed || facts.userRetried || !facts.sessionSucceeded)) {
    fails.push({
      class: 'STALL_NO_FALLBACK',
      id: 'STALL_FALLBACK_SAME_JOB',
      detail: 'Vision Scout 90s stall failed the job / forced Retry — did not hop to gemini-3.1-flash-lite on the same job',
      file: 'server_gemini_retry.ts nextGeminiFallbackEngine, serverJobs.ts loopback retry',
      doNot: 'expected.json, live Gemini inner loop, POST /loop, FoodCard rewrite',
    });
  }
  return fails;
}

export function formatOracleFails(fails: OracleFail[]): string {
  if (!fails.length) return 'dump oracles: none (capture is not a classified red)\n';
  return fails
    .map(
      (f) =>
        `${f.id}  ${f.detail}\n  class: ${f.class}\n  file:  ${f.file}\n  do not: ${f.doNot}`
    )
    .join('\n\n');
}
