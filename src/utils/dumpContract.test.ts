import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseDebugMarkdown, classifyDump } from './dumpContract';
import { shouldRunHandoffAutoSend } from './chatAutoSend';
import { buildDebugMarkdownReport } from './debugPayload';
import { attachSseJsonResponder, parseSseFinalResult } from '../../server_sse_json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAPTURE = path.join(__dirname, '../../tests/captures/job_1788538012316_m9wm9cs9a.md');

describe('dumpContract — display lag and complete-once', () => {
  it('flags happy-path with kcal but no session succeeded', () => {
    const facts = parseDebugMarkdown(`
- **Job ID:** \`job_lag\`
[backend] [Budget] Finalized ledger for "Soto": 337 kcal
[backend] [MealBuild] happy-path
## ⚙️ Job Session Event Trail
\`\`\`
JobStore.apply updateJob running
\`\`\`
`);
    const fails = classifyDump(facts);
    expect(fails.some((f) => f.id === 'RESULT_READY_BEFORE_PERSIST')).toBe(true);
  });

  it('flags 90s scout stall that failed the job without a 3.1 hop', () => {
    const facts = parseDebugMarkdown(`
- **Job ID:** \`job_stall\`
[error] Stream stalled: Vision Scout (gemini-3.5-flash-lite) produced no tokens for 90s after the prompt. Switch to gemini-3.1-flash-lite.
## ⚙️ Job Session Event Trail
\`\`\`
JobStore.apply updateJob failed
JobQueueRunner ServerStatus failed
\`\`\`
[JobQueueRunner] Retrying job job_stall (Attempt 2/3)
`);
    expect(facts.hasScoutStall).toBe(true);
    expect(facts.hasModelFallback).toBe(false);
    expect(classifyDump(facts).some((f) => f.id === 'STALL_FALLBACK_SAME_JOB')).toBe(true);
  });

  it('does not flag a stall that already hopped to 3.1 on the same job', () => {
    const facts = parseDebugMarkdown(`
[error] Stream stalled: Vision Scout (gemini-3.5-flash-lite) produced no tokens for 90s after the prompt.
[backend] [UnifiedLLM] gemini-3.5-flash-lite stalled/unavailable — falling back to gemini-3.1-flash-lite on the same job (no user retry).
JobStore.apply updateJob succeeded
`);
    expect(facts.hasModelFallback).toBe(true);
    expect(classifyDump(facts).some((f) => f.id === 'STALL_FALLBACK_SAME_JOB')).toBe(false);
  });

  it('flags AnalyzeFinished more than once', () => {
    const facts = parseDebugMarkdown(`
JobQueueRunner AnalyzeFinished succeeded
JobQueueRunner AnalyzeFinished succeeded
JobQueueRunner AnalyzeFinished succeeded
JobQueueRunner AnalyzeFinished succeeded
`);
    expect(facts.analyzeFinishedCount).toBe(4);
    expect(classifyDump(facts).some((f) => f.id === 'ANALYZE_FINISHED_ONCE')).toBe(true);
  });
});

describe('dumpContract — Soto capture classifies without Gemini', () => {
  const md = fs.readFileSync(CAPTURE, 'utf8');
  const facts = parseDebugMarkdown(md);
  const fails = classifyDump(facts);

  it('reads job still running after ledger + dietitian 503', () => {
    expect(facts.jobId).toBe('job_1788538012316_m9wm9cs9a');
    expect(facts.status).toBe('running');
    expect(facts.hasFinalizedLedger).toBe(true);
    expect(facts.dietitianFailedPermanently).toBe(true);
    expect(fails.some((f) => f.id === 'JOB_TERMINAL_IF_LEDGER')).toBe(true);
  });

  it('flags matrix standby, duplicate crumbs, DIAG5', () => {
    expect(facts.matrixCalcStandby).toBe(true);
    expect(facts.breadcrumbDuplicateRows).toBeGreaterThan(0);
    expect(facts.diag5AutoSend).toBe(true);
    expect(fails.map((f) => f.id).sort()).toEqual(
      expect.arrayContaining(['DEBUG_MATCHES_LOG', 'HEADING_ONCE', 'NO_FOREIGN_EFFECT'])
    );
  });
});

describe('code probes — inner loop (must be green without a new live run)', () => {
  it('food composer never runs Front Desk auto-send', () => {
    const r = shouldRunHandoffAutoSend({
      isOpen: true,
      type: 'food',
      agentType: null,
      autoSendMessage: null,
      hasHandoffPayload: false,
      effectiveAutoSend: null,
    });
    expect(r.run).toBe(false);
    expect(r.reason).toBe('food_chat');
  });

  it('debug markdown marks calc connected when logs have Finalized ledger even without pendingFoodLog', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_salvage',
      status: 'succeeded',
      backendLogs: '[Budget] Finalized ledger for "Soto Daging Santan": 380 kcal (400g, source=estimated)',
      scoutItems: [{ originalName: 'Soto Daging Santan', estimatedWeightGrams: 400 }],
    });
    expect(md).toMatch(/Mathematical Calculation Engine\*\*.*Connected/);
    expect(md).not.toMatch(/Mathematical Calculation Engine\*\*.*Standby/);
  });

  it('debug markdown drops duplicate breadcrumb rows', () => {
    const crumb = { timestamp: '2026-09-04T16:06:52.316Z', action: 'click', target: 'button', details: { label: 'Log Meal' } };
    const md = buildDebugMarkdownReport({
      jobId: 'job_crumbs',
      userActionBreadcrumbs: [
        crumb,
        crumb,
        { timestamp: '2026-09-04T16:07:33.000Z', action: 'submit_meal_job', target: 'chat_compose_dock', details: { imageCount: 3 } },
      ],
    });
    expect((md.match(/Log Meal/g) || []).length).toBe(1);
    expect(md).toMatch(/submit_meal_job/);
  });

  it('serverJobs hops to 3.1 on stall instead of failing the job', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../serverJobs.ts'), 'utf8');
    expect(src).toMatch(/nextGeminiFallbackEngine/);
    expect(src).toMatch(/falling back to \$\{next\} on the same job/);
  });

  it('publishResultReady marks succeeded before R2', async () => {
    const { inMemoryServerJobs, publishResultReady, getInMemoryServerJob } = await import('../../serverJobs');
    inMemoryServerJobs.set('job_lag', { id: 'job_lag', status: 'running', clean_result: null, sessionEvents: [] });
    publishResultReady('job_lag', { pendingFoodLog: { nutrients: { calories: 571 } } });
    expect(getInMemoryServerJob('job_lag').status).toBe('succeeded');
  });

  it('SSE wrap still emits salvage as final+result', () => {
    const writes: string[] = [];
    const res: any = { headersSent: true, write: (c: string) => writes.push(c), end: () => {} };
    attachSseJsonResponder(res);
    res.json({ pendingFoodLog: { nutrients: { calories: 648 } }, degradedStages: ['dietitian'] });
    const result = parseSseFinalResult(writes[0]);
    expect(result.degradedStages).toEqual(['dietitian']);
    expect(result.pendingFoodLog.nutrients.calories).toBe(648);
  });
});
