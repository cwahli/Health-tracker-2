import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseDebugMarkdown, classifyDump, evaluateContracts } from './dumpContract';
import { shouldRunHandoffAutoSend } from './chatAutoSend';
import { buildDebugMarkdownReport } from './debugPayload';
import { buildCanonicalRunTree } from './debugRunTree';
import { attachSseJsonResponder, parseSseFinalResult } from '../../server_sse_json';
import { inMemoryServerJobs, publishResultReady, getInMemoryServerJob } from '../../serverJobs';

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

  it('publishResultReady marks succeeded before R2', () => {
    inMemoryServerJobs.clear();
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

describe('Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13)', () => {
  it('evaluates all 13 §9 contract laws directly on CanonicalRunTree', () => {
    const tree = buildCanonicalRunTree({
      jobId: 'job_tree_test',
      status: 'succeeded',
      backendLogs: '[Vision Scout] ok (1200ms)\n[Budget] Finalized ledger: 420 kcal\nAnalyzeFinished succeeded',
      pendingFoodLog: { nutrients: { calories: 420, protein: 30 } },
      dialogInventory: {
        open: true,
        title: 'Lunch',
        on_card: { kcal: 420, protein: 30 },
        visible: ['View Analysis', 'Download Debug'],
        hidden: ['Retry', 'Attempt 1 of 3'],
        composer: { photo: 1, add_image: 1, paste: 1, send: 1 },
      },
      dispatches: [
        { id: 't1/scout', agent: 'scout', model: 'gemini-3.5-flash-lite', latency_ms: 1200 },
        { id: 't1/dietitian', agent: 'dietitian', model: 'gemini-3.5-flash-lite', latency_ms: 2100 },
      ],
    });

    const evals = evaluateContracts(tree);
    expect(evals.length).toBe(13);

    const sseLaw = evals.find(e => e.law === 'SSE {final,result}');
    expect(sseLaw?.result).toBe('PASS');

    const afLaw = evals.find(e => e.law === 'AnalyzeFinished count = 1');
    expect(afLaw?.result).toBe('PASS');

    const cardLaw = evals.find(e => e.law === 'Dialog on_card kcal = ledger');
    expect(cardLaw?.result).toBe('PASS');

    const composerLaw = evals.find(e => e.law === 'Composer controls count = 1');
    expect(composerLaw?.result).toBe('PASS');

    const fails = classifyDump(tree);
    expect(fails.length).toBe(0);
  });

  it('detects dialog on_card kcal mismatch with ledger', () => {
    const tree = buildCanonicalRunTree({
      jobId: 'job_card_mismatch',
      status: 'succeeded',
      backendLogs: '[Budget] Finalized ledger: 350 kcal',
      pendingFoodLog: { nutrients: { calories: 350 } },
      dialogInventory: {
        open: true,
        on_card: { kcal: 500 }, // Disagrees with 350 kcal ledger
        visible: ['View Analysis'],
        composer: { photo: 1, send: 1 },
      },
    });

    const cardLaw = tree.contract.find(e => e.law === 'Dialog on_card kcal = ledger');
    expect(cardLaw?.result).toBe('FAIL');
    expect(cardLaw?.fault).toBe('WRONG_TIME');

    const fails = classifyDump(tree);
    expect(fails.some(f => f.id === 'UI_ON_CARD_MISMATCH')).toBe(true);
  });

  it('detects Retry button visible when job succeeded', () => {
    const tree = buildCanonicalRunTree({
      jobId: 'job_retry_leak',
      status: 'succeeded',
      pendingFoodLog: { nutrients: { calories: 300 } },
      dialogInventory: {
        open: true,
        visible: ['Retry', 'Download Debug'], // Retry should be hidden
        composer: { photo: 1, send: 1 },
      },
    });

    const retryLaw = tree.contract.find(e => e.law === 'Retry hidden if succeeded or kcal in logs');
    expect(retryLaw?.result).toBe('FAIL');
    expect(retryLaw?.fault).toBe('WRONG_TIME');
  });

  it('detects duplicate composer controls in dialog inventory', () => {
    const tree = buildCanonicalRunTree({
      jobId: 'job_dup_controls',
      status: 'running',
      dialogInventory: {
        open: true,
        composer: { photo: 2, send: 1 }, // photo x2 duplicate
      },
    });

    const composerLaw = tree.contract.find(e => e.law === 'Composer controls count = 1');
    expect(composerLaw?.result).toBe('FAIL');
    expect(composerLaw?.fault).toBe('DUPLICATE');

    const fails = classifyDump(tree);
    expect(fails.some(f => f.id === 'UI_COMPOSER_CONTROLS')).toBe(true);
  });

  it('detects dispatch missing model or latency telemetry', () => {
    const tree = buildCanonicalRunTree({
      jobId: 'job_missing_telemetry',
      status: 'succeeded',
      dispatches: [
        { id: 't1/scout', agent: 'scout' }, // Missing model and latency_ms
      ],
    });

    const dispatchLaw = tree.contract.find(e => e.law === 'Each dispatch has model + latency_ms');
    expect(dispatchLaw?.result).toBe('FAIL');
    expect(dispatchLaw?.fault).toBe('MISSING');

    const fails = classifyDump(tree);
    expect(fails.some(f => f.id === 'DISPATCH_SIGNALS_MISSING')).toBe(true);
  });

  it('evaluates handoff contract and verifies matching jobId', () => {
    const tree = buildCanonicalRunTree({
      jobId: 'job_handoff_ok',
      status: 'succeeded',
      handoffChain: ['Front Desk', 'Health Coach'],
      handoffPayload: { targetAgent: 'health_coach' },
    });

    expect(tree.handoffs.length).toBe(1);
    expect(tree.handoffs[0].jobId).toBe('job_handoff_ok');
    const handoffLaw = tree.contract.find(e => e.law === 'Handoff from/to + same jobId if transfer');
    expect(handoffLaw?.result).toBe('PASS');
  });

  it('detects QUEUE_LIE when submit reports queued instead of running', () => {
    const tree = buildCanonicalRunTree({
      jobId: 'job_queue_lie',
      status: 'running',
      backendLogs: 'Submit JSON queued: status=queued',
    });

    const submitLaw = tree.contract.find(e => e.law === 'Submit JSON running');
    expect(submitLaw?.result).toBe('FAIL');
    expect(submitLaw?.fault).toBe('WRONG_TIME');

    const fails = classifyDump(tree);
    expect(fails.some(f => f.id === 'SUBMIT_NOT_QUEUED')).toBe(true);
  });

  it('receptionist pack marks food ledger/scout laws n/a (Q-8.5)', () => {
    const tree = buildCanonicalRunTree({
      pack: 'receptionist',
      jobId: 'job_fd_na',
      status: 'succeeded',
      agentType: 'front_desk',
    });
    expect(tree.pack).toBe('receptionist');
    expect(tree.dispatches[0]?.id).toBe('fd/front_desk');
    expect(tree.contract.find(e => e.law === 'pendingFoodLog -> succeeded before R2')?.result).toBe('n/a');
    expect(tree.contract.find(e => e.law === 'Matrix calc matches ledger')?.result).toBe('n/a');
    expect(tree.contract.find(e => e.law === 'Dialog on_card kcal = ledger')?.result).toBe('n/a');
    expect(tree.contract.find(e => e.law === 'AnalyzeFinished count = 1')?.result).toBe('n/a');
    expect(tree.contract.find(e => e.law === 'Meal scout tape off non-food pack')?.result).toBe('PASS');
    expect(classifyDump(tree).length).toBe(0);
  });

  it('medical pack flags meal scout tape as WRONG_PLACE (Q-8.5)', () => {
    const tree = buildCanonicalRunTree({
      pack: 'medical',
      jobId: 'job_med_scout',
      status: 'succeeded',
      extractedData: [{ name: 'HDL', value: 50 }],
      scoutItems: [{ originalName: 'Soto' }],
    });
    const law = tree.contract.find(e => e.law === 'Meal scout tape off non-food pack');
    expect(law?.result).toBe('FAIL');
    expect(law?.fault).toBe('WRONG_PLACE');
    expect(classifyDump(tree).some(f => f.id === 'SCOUT_ON_NON_FOOD')).toBe(true);
  });
});

