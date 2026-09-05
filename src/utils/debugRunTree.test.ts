import { describe, it, expect } from 'vitest';
import {
  parseUnifiedUsageLines,
  tagJobId,
  extractDispatches,
  buildCanonicalRunTree,
} from './debugRunTree';

const JOB = 'job_test_123';

function foodInput(over: any = {}) {
  return {
    jobId: JOB,
    status: 'succeeded',
    lastUserAction: { details: { prompt: 'steak' } },
    backendLogs: [
      '[UnifiedLLM] Calling gemini-3.5-flash-lite',
      '[Vision Scout] done in 1500ms',
      '[UnifiedLLM-Usage:scout] prompt=812 completion=96 total=908',
      '[Budget] Finalized ledger',
      '[UnifiedLLM-Usage:dietitian] prompt=3012 completion=918 total=3930',
    ].join('\n'),
    scoutItems: [{ keyword: 'Steak', name: 'Steak' }],
    pendingFoodLog: { id: 'meal_1', nutrients: { calories: 398 } },
    rawScout: { dishes: [{ dishName: 'Steak', foods: [{ foodName: 'Steak' }] }], _internalReasoning: 'saw steak' },
    clientConsoleLogs: ['[LOG] hello'],
    networkErrors: ['[NET POST 400] https://x.test/auth'],
    ...over,
  };
}

describe('parseUnifiedUsageLines', () => {
  it('parses per-stage usage, last per stage wins', () => {
    const u = parseUnifiedUsageLines(
      '[UnifiedLLM-Usage:scout] prompt=100 completion=10 total=110\n' +
      '[UnifiedLLM-Usage:scout] prompt=812 completion=96 total=908'
    );
    expect(u).toEqual([{ stage: 'scout', input: 812, output: 96, total: 908 }]);
  });
  it('returns [] without usage lines', () => {
    expect(parseUnifiedUsageLines('no usage here')).toEqual([]);
    expect(parseUnifiedUsageLines('')).toEqual([]);
  });
});

describe('tagJobId', () => {
  it('prefixes untagged lines, skips blanks/already-tagged/unknown', () => {
    expect(tagJobId('hello', JOB)).toBe(`[${JOB}] hello`);
    expect(tagJobId('', JOB)).toBe('');
    expect(tagJobId(`[${JOB}] hello`, JOB)).toBe(`[${JOB}] hello`);
    expect(tagJobId('hello', 'unknown')).toBe('hello');
  });
});

describe('extractDispatches (food)', () => {
  it('attaches tokens per stage and rawEmission without replacing output', () => {
    const d = extractDispatches(foodInput());
    const scout = d.find(x => x.agent === 'scout')!;
    const diet = d.find(x => x.agent === 'dietitian')!;
    expect(scout.tokens).toBe(908);
    expect(diet.tokens).toBe(3930);
    expect(scout.rawEmission).toEqual(foodInput().rawScout);
    expect(scout.output).toEqual([{ keyword: 'Steak', name: 'Steak' }]);
  });
  it('leaves tokens undefined when no usage lines exist', () => {
    const d = extractDispatches(foodInput({ backendLogs: '[Vision Scout] done' }));
    expect(d.find(x => x.agent === 'scout')!.tokens).toBeUndefined();
  });
});

describe('buildCanonicalRunTree jobId tagging', () => {
  it('tags console, network and backend lines with the job id', () => {
    const tree = buildCanonicalRunTree(foodInput());
    expect(tree.console).toEqual([`[${JOB}] [LOG] hello`]);
    expect(tree.network).toEqual([`[${JOB}] [NET POST 400] https://x.test/auth`]);
    const lines = String((tree as any).backendLogs).split('\n');
    expect(lines[0]).toBe(`[${JOB}] [UnifiedLLM] Calling gemini-3.5-flash-lite`);
    expect(tree.dispatches.find(x => x.agent === 'scout')!.tokens).toBe(908);
  });
});
