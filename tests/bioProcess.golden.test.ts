/**
 * Q-8.4 — Biomarker process board.
 * Dummy SSE/status/Apply rows. No Gemini. Does not replace golden_biomarker.test.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { attachSseJsonResponder, parseSseFinalResult } from '../server_sse_json';
import { inMemoryServerJobs, publishResultReady, getInMemoryServerJob } from '../serverJobs';
import { nextGeminiFallbackEngine, GEMINI_FALLBACK_ENGINE } from '../server_gemini_retry';
import { buildCanonicalRunTree } from '../src/utils/debugRunTree';
import { classifyDump } from '../src/utils/dumpContract';
import { shouldRunHandoffAutoSend } from '../src/utils/chatAutoSend';
import {
  convertViaTable,
  enrichReviewModificationCommands,
  applyModificationCommands,
  shouldAbortTablePath,
  leftoverTextFromTrace,
} from '../src/utils/biomarkerLifecycle';

/** QUALITY.md §1.3.1 biomarker process exits — walk every worker exit onto this board. */
const BIO_EXITS = [
  { exit: 'Medical SSE wrap {final,result}', classId: 'DEGRADE_NOT_TERMINAL' },
  { exit: 'Salvage terminal (extractedData + agent dead → job terminal)', classId: 'DEGRADE_NOT_TERMINAL' },
  { exit: 'Apply writes keep observationMeta raw', classId: 'APPLY_MISS' },
  { exit: 'Leftover vs table abort (0 high-confidence names)', classId: 'CONFORMANCE_SHAPE' },
  { exit: 'DIAG5 auto-send does not fire on a lab chat', classId: 'SIBLING_EFFECT' },
  { exit: 'Shared stall hop on 503 (same helper as food)', classId: 'STALL_NO_FALLBACK' },
] as const;

const APPLY_HISTORY = [
  { id: '1', date: '14-08-2026', biomarkers: { hdl: 50, triglycerides: 125, ldl: 130, creatinine: 0.9, total_bilirubin: 0.8 } },
  { id: '2', date: '02-08-2026', biomarkers: { hdl: 1.43, triglycerides: 1.07, ldl: 4.2, creatinine: 100, total_bilirubin: 16 } },
];

const CATALOG_UNITS = {
  hdl: 'mmol/L',
  triglycerides: 'mmol/L',
  ldl: 'mmol/L',
  creatinine: 'umol/L',
  total_bilirubin: 'umol/L',
};

describe('Q-8.4 biomarker process board — §1.3.1 bio exits', () => {
  it('audits every QUALITY.md §1.3.1 biomarker process exit', () => {
    expect(BIO_EXITS.map((r) => r.exit)).toEqual([
      'Medical SSE wrap {final,result}',
      'Salvage terminal (extractedData + agent dead → job terminal)',
      'Apply writes keep observationMeta raw',
      'Leftover vs table abort (0 high-confidence names)',
      'DIAG5 auto-send does not fire on a lab chat',
      'Shared stall hop on 503 (same helper as food)',
    ]);
    expect(new Set(BIO_EXITS.map((r) => r.classId)).size).toBeGreaterThanOrEqual(4);
  });

  it('Medical SSE wrap emits {final,result} for a medical-shaped payload', () => {
    const writes: string[] = [];
    const res: any = { headersSent: true, write: (c: string) => writes.push(c), end: () => writes.push('END') };
    attachSseJsonResponder(res);
    res.json({
      extractedData: [{ biomarker: 'hdl', value: 50, unit: 'mg/dL' }],
      agentType: 'medical',
      degradedStages: ['lab_parser'],
    });
    expect(writes[0]).toMatch(/^data: /);
    const wrapped = JSON.parse(writes[0].slice('data: '.length).trim());
    expect(wrapped.final).toBe(true);
    const result = parseSseFinalResult(writes[0]);
    expect(result.extractedData[0].biomarker).toBe('hdl');
    expect(result.degradedStages).toEqual(['lab_parser']);
    expect(writes).toContain('END');
  });

  it('salvage terminal: extract + agent dead + succeeded is not DEGRADE_NOT_TERMINAL; running after extract is', () => {
    const terminal = buildCanonicalRunTree({
      pack: 'medical',
      jobId: 'job_med_salvage',
      status: 'succeeded',
      extractedData: [{ biomarker: 'hdl', value: 50 }],
      backendLogs: 'Lab Parser Failed Permanently\nresult_ready',
      dispatches: [{
        id: 't1/medical',
        agent: 'medical',
        model: 'gemini-3.5-flash-lite',
        latency_ms: 900,
        error: '503 UNAVAILABLE',
      }],
    });
    expect(terminal.pack).toBe('medical');
    expect(classifyDump(terminal).some((f) => f.class === 'DEGRADE_NOT_TERMINAL')).toBe(false);

    const awaiting = buildCanonicalRunTree({
      pack: 'medical',
      jobId: 'job_med_await',
      status: 'awaiting_apply',
      extractedData: [{ biomarker: 'hdl', value: 50 }],
      backendLogs: 'Lab Parser Failed Permanently',
      dispatches: [{
        id: 't1/medical',
        agent: 'medical',
        model: 'gemini-3.5-flash-lite',
        latency_ms: 900,
        error: 'agent dead',
      }],
    });
    expect(classifyDump(awaiting).some((f) => f.class === 'DEGRADE_NOT_TERMINAL')).toBe(false);

    const stuck = buildCanonicalRunTree({
      pack: 'medical',
      jobId: 'job_med_stuck',
      status: 'running',
      extractedData: [{ biomarker: 'hdl', value: 50 }],
      backendLogs: 'Lab Parser Failed Permanently',
      dispatches: [{
        id: 't1/medical',
        agent: 'medical',
        model: 'gemini-3.5-flash-lite',
        latency_ms: 900,
        error: '503 UNAVAILABLE',
      }],
    });
    expect(classifyDump(stuck).some((f) => f.id === 'JOB_TERMINAL_IF_LEDGER')).toBe(true);
    expect(stuck.contract.find((e) => e.law === 'SSE {final,result}')?.fault).toBe('WRONG_TIME');
  });

  it('publishResultReady terminals a medical dummy once extractedData exists', () => {
    inMemoryServerJobs.set('job_med_pub', {
      id: 'job_med_pub',
      status: 'running',
      progress_percent: 20,
      clean_result: null,
      sessionEvents: [],
    });
    const published = publishResultReady('job_med_pub', {
      extractedData: [{ biomarker: 'hdl', value: 50 }],
      agentType: 'medical',
    });
    expect(published).toBe(true);
    const job = getInMemoryServerJob('job_med_pub');
    expect(job.status).toBe('succeeded');
    expect(job.clean_result.extractedData[0].biomarker).toBe('hdl');
  });

  it('APPLY_MISS: convertViaTable locks + enrichReviewModificationCommands keep observationMeta raw', () => {
    const hdl = convertViaTable('hdl', 50, 'mg/dL', 'mmol/L');
    const tg = convertViaTable('triglycerides', 125, 'mg/dL', 'mmol/L');
    const ldl = convertViaTable('ldl', 130, 'mg/dL', 'mmol/L');
    const creat = convertViaTable('creatinine', 0.9, 'mg/dL', 'umol/L');
    const bili = convertViaTable('total_bilirubin', 0.8, 'mg/dL', 'umol/L');
    expect(hdl.ok).toBe(true);
    if (hdl.ok) expect(hdl.value).toBeCloseTo(1.293, 2);
    expect(tg.ok).toBe(true);
    if (tg.ok) expect(tg.value).toBeCloseTo(1.411, 2);
    expect(ldl.ok).toBe(true);
    if (ldl.ok) expect(ldl.value).toBeCloseTo(3.362, 2);
    expect(creat.ok).toBe(true);
    if (creat.ok) expect(creat.value).toBeCloseTo(79.56, 1);
    expect(bili.ok).toBe(true);
    if (bili.ok) expect(bili.value).toBeCloseTo(13.68, 1);

    const cmds = enrichReviewModificationCommands([], APPLY_HISTORY, CATALOG_UNITS);
    const byKey = Object.fromEntries(cmds.map((c) => [c.keyName, c]));
    expect(Number(byKey.hdl.newValue)).toBeCloseTo(1.293, 2);
    expect(Number(byKey.triglycerides.newValue)).toBeCloseTo(1.411, 2);
    expect(Number(byKey.ldl.newValue)).toBeCloseTo(3.362, 2);
    expect(Number(byKey.creatinine.newValue)).toBeCloseTo(79.56, 1);
    expect(Number(byKey.total_bilirubin.newValue)).toBeCloseTo(13.68, 1);
    expect(Number(byKey.hdl.oldValue)).toBe(50);

    const { history: after } = applyModificationCommands(APPLY_HISTORY as any, [], CATALOG_UNITS);
    const log14 = after.find((h) => h.date === '14-08-2026')!;
    expect(Number(log14.biomarkers.hdl)).toBeCloseTo(1.293, 2);
    expect(log14.observationMeta?.hdl?.rawValue).toBe(50);
    expect(log14.observationMeta?.triglycerides?.rawValue).toBe(125);
    expect(log14.observationMeta?.ldl?.rawValue).toBe(130);
    expect(log14.observationMeta?.creatinine?.rawValue).toBe(0.9);
    expect(log14.observationMeta?.total_bilirubin?.rawValue).toBe(0.8);
    const log02 = after.find((h) => h.date === '02-08-2026')!;
    expect(log02.biomarkers.hdl).toBe(1.43);
  });

  it('table abort when 0 high-confidence names; leftover does not send Parser a high-confidence name', () => {
    expect(shouldAbortTablePath({ sourceKind: 'table', highConfidenceCount: 0, unmatchedCount: 4 })).toBe(true);
    expect(shouldAbortTablePath({ unmatchedCount: 3, highConfidenceCount: 0 })).toBe(true);
    expect(shouldAbortTablePath({ sourceKind: 'table', highConfidenceCount: 2, unmatchedCount: 1 })).toBe(false);

    const leftover = leftoverTextFromTrace({
      rows: [
        { bucket: 'high_confidence', printedName: 'Serum sodium', rawValue: 143, rawUnit: 'mmol/L' },
        { bucket: 'unmatched', printedName: 'Chlamydia DNA detection', comment: '"09-Jun-2026","Chlamydia DNA detection","","","NEGATIVE"' },
      ],
    } as any);
    expect(leftover).toMatch(/Chlamydia/i);
    expect(leftover).not.toMatch(/Serum sodium/i);
  });

  it('DIAG5 auto-send does not fire on a lab chat', () => {
    expect(shouldRunHandoffAutoSend({
      isOpen: true,
      type: 'medical',
      agentType: 'agent1',
      autoSendMessage: 'continue',
      hasHandoffPayload: true,
    })).toEqual({ run: false, reason: 'excluded_agent' });
    expect(shouldRunHandoffAutoSend({
      isOpen: true,
      type: 'medical',
      agentType: 'biomarker_review',
      autoSendMessage: 'continue',
      hasHandoffPayload: true,
    }).run).toBe(false);
    expect(shouldRunHandoffAutoSend({
      isOpen: true,
      type: 'medical',
      agentType: 'data_review',
      autoSendMessage: 'continue',
      hasHandoffPayload: true,
    }).run).toBe(false);
    expect(shouldRunHandoffAutoSend({
      isOpen: true,
      type: 'front_desk',
      agentType: 'front_desk',
      autoSendMessage: 'continue',
      hasHandoffPayload: true,
    }).run).toBe(true);
  });

  it('shared stall hop still hops on 503 for a medical dummy tree', () => {
    expect(nextGeminiFallbackEngine('gemini-3.5-flash-lite', new Error('503 UNAVAILABLE high demand'), false))
      .toBe(GEMINI_FALLBACK_ENGINE);

    const hopped = buildCanonicalRunTree({
      pack: 'medical',
      jobId: 'job_med_stall',
      status: 'succeeded',
      extractedData: [{ biomarker: 'hdl', value: 50 }],
      backendLogs: '503 Service Unavailable\nfalling back to gemini-3.1-flash-lite on the same job',
      dispatches: [{
        id: 't1/medical',
        agent: 'medical',
        model: 'gemini-3.1-flash-lite',
        latency_ms: 1400,
      }],
    });
    const stallLaw = hopped.contract.find((e) => e.law === 'Stall/503/quota -> 3.1 hop, same job');
    expect(stallLaw?.result).toBe('PASS');
    expect(classifyDump(hopped).some((f) => f.class === 'STALL_NO_FALLBACK')).toBe(false);
  });
});

describe('Q-8.4 in-memory medical publish isolation', () => {
  beforeEach(() => {
    inMemoryServerJobs.clear();
  });

  it('does not treat empty medical dummy as food ledger', () => {
    const tree = buildCanonicalRunTree({
      pack: 'medical',
      jobId: 'job_med_na',
      status: 'succeeded',
      extractedData: [{ biomarker: 'hdl', value: 50 }],
    });
    expect(tree.contract.find((e) => e.law === 'pendingFoodLog -> succeeded before R2')?.result).toBe('n/a');
    expect(tree.contract.find((e) => e.law === 'Matrix calc matches ledger')?.result).toBe('n/a');
    expect(tree.dispatches.some((d) => d.agent === 'scout')).toBe(false);
  });
});
