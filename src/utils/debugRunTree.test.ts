import { describe, it, expect } from 'vitest';
import {
  parseUnifiedUsageLines,
  parseUnifiedTimingLines,
  hasCallEvidence,
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
      'Food Resolver agent',
      '[UnifiedLLM-Usage:food_resolver] prompt=500 completion=50 total=550',
      '[UnifiedLLM-Timing:food_resolver] ms=1200',
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
  it('attaches tokens per stage and prefers raw scout output over processed items', () => {
    const d = extractDispatches(foodInput());
    const scout = d.find(x => x.agent === 'scout')!;
    const resolver = d.find(x => x.agent === 'resolver')!;
    expect(scout.tokens).toBe(908);
    expect(scout.rawEmission).toEqual(foodInput().rawScout);
    // "Output:" in the Agent Dispatches card must show the exact raw LLM
    // response (rawScout), not the fully-processed/merged scoutItems list —
    // showing the processed list here is what caused "raw and processed
    // mixed up" in the Sept 5 debug export. rawScout is preferred whenever
    // it's present; scoutItems remains a fallback for older logs/paths that
    // never captured a raw emission.
    expect(scout.output).toEqual(foodInput().rawScout);
    expect(resolver).toBeDefined();
    expect(resolver.tokens).toBe(550);
    expect(resolver.latency_ms).toBe(1200);
    expect(resolver.called).toBe(true);
  });
  it('leaves tokens undefined when no usage lines exist', () => {
    const d = extractDispatches(foodInput({ backendLogs: '[Vision Scout] done' }));
    expect(d.find(x => x.agent === 'scout')!.tokens).toBeUndefined();
  });
  it('prefers measured timing over regex/default latency', () => {
    const d = extractDispatches(foodInput({
      backendLogs: '[Vision Scout] done in 1500ms\n[UnifiedLLM-Timing:scout] ms=5231\n[Budget] Finalized ledger',
    }));
    expect(d.find(x => x.agent === 'scout')!.latency_ms).toBe(5231);
  });
  it('omits resolver when no gap resolution occurred', () => {
    const d = extractDispatches(foodInput({
      backendLogs: '[Vision Scout] done\n[Budget] Finalized ledger',
    }));
    expect(d.find(x => x.agent === 'resolver')).toBeUndefined();
  });
});

describe('hasCallEvidence', () => {
  it('detects dispatch/prompt/usage/timing/answer lines per stage', () => {
    expect(hasCallEvidence('[UnifiedLLM-Prompt:scout] x', 'scout')).toBe(true);
    expect(hasCallEvidence('[UnifiedLLM-Usage:food_resolver] prompt=1 completion=1 total=2', 'resolver')).toBe(true);
    expect(hasCallEvidence('', 'scout')).toBe(false);
  });
  it('does NOT count instruction/answer lines logged on skip paths', () => {
    expect(hasCallEvidence('[dietitian_answer] Solid protein intake', 'resolver')).toBe(false);
    expect(hasCallEvidence('[dietitian_instruction] Dietitian Instruction dispatched (model: x)', 'resolver')).toBe(false);
  });
});

describe('parseUnifiedTimingLines', () => {
  it('parses ms per stage, last wins', () => {
    expect(parseUnifiedTimingLines('[UnifiedLLM-Timing:scout] ms=100\n[UnifiedLLM-Timing:scout] ms=5231'))
      .toEqual([{ stage: 'scout', ms: 5231 }]);
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

  it('preserves and enriches pre-existing multi-turn dispatches array', () => {
    const multiTurnInput = foodInput({
      dispatches: [
        {
          id: 't1/scout',
          turn: 1,
          agent: 'scout',
          user: 'Analyze this meal photo.',
          received: { mode: 'new_log' },
          systemInstruction: 'Scout Sys 1',
          userPrompt: 'Scout Usr 1',
          output: { dishes: [{ dishName: 'Nasi Goreng' }] },
          rawEmission: { dishes: [{ dishName: 'Nasi Goreng' }] },
        },
        {
          id: 't2/scout',
          turn: 2,
          agent: 'scout',
          user: 'The tea is unsweetened',
          received: { mode: 'edit', userMessage: 'The tea is unsweetened' },
          systemInstruction: 'Scout Sys 2',
          userPrompt: 'User modification instruction: "The tea is unsweetened"',
          output: { dishes: [{ dishName: 'Nasi Goreng' }, { dishName: 'Teh Tawar' }] },
          rawEmission: { dishes: [{ dishName: 'Nasi Goreng' }, { dishName: 'Teh Tawar' }] },
        },
      ],
    });
    const d = extractDispatches(multiTurnInput);
    expect(d.length).toBe(3); // 2 scout turns + 1 resolver from logs
    expect(d[0].id).toBe('t1/scout');
    expect(d[0].user).toBe('Analyze this meal photo.');
    expect(d[1].id).toBe('t2/scout');
    expect(d[1].user).toBe('The tea is unsweetened');
    expect(d[1].rawEmission).toBeDefined();
  });

  it('filters out UI debug download button text from dispatch user prompt', () => {
    const inputWithButtonUser = foodInput({
      lastUserAction: { action: 'debug_download', details: { prompt: 'Download Debug Logs' } },
      dispatches: [
        {
          id: 't1/scout',
          turn: 1,
          agent: 'scout',
          user: 'Download Debug Logs',
          received: { userMessage: 'Analyze this meal photo.' },
        },
      ],
    });
    const d = extractDispatches(inputWithButtonUser);
    expect(d[0].user).toBe('Analyze this meal photo.');
  });
});

