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
  it('parses two stages and returns both totals; empty string returns []', () => {
    const logs =
      '[UnifiedLLM-Usage:scout] prompt=812 completion=96 total=908\n' +
      '[UnifiedLLM-Usage:food_resolver] prompt=500 completion=50 total=550';
    expect(parseUnifiedUsageLines(logs)).toEqual([
      { stage: 'scout', input: 812, output: 96, total: 908 },
      { stage: 'food_resolver', input: 500, output: 50, total: 550 },
    ]);
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

  it('tagLinesWithJobId prefixes untagged lines with [jobId] and skips blanks', () => {
    const lines = [
      '[LOG] hello',
      '',
      '   ',
      '[NET POST 400] https://x.test/auth',
      `[${JOB}] already tagged`,
    ];

    expect(lines.map(line => tagJobId(line, JOB))).toEqual([
      `[${JOB}] [LOG] hello`,
      '',
      '   ',
      `[${JOB}] [NET POST 400] https://x.test/auth`,
      `[${JOB}] already tagged`,
    ]);
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

  it('returns scout only with length 1 for food with only scout logs and no prior dispatches', () => {
    const d = extractDispatches(foodInput({
      backendLogs: '[Vision Scout] done\n[Budget] Finalized ledger',
      dispatches: [],
    }));
    expect(d.length).toBe(1);
    expect(d[0].agent).toBe('scout');
    expect(d[0].id).toBe('t1/scout');
    expect(d.some(x => x.agent === 'resolver')).toBe(false);
  });

  it('builds scout and optional resolver from logs when prior dispatches is empty, without inventing edit turns', () => {
    const d = extractDispatches(foodInput({ dispatches: [] }));
    expect(d.some(x => x.agent === 'scout')).toBe(true);
    expect(d.some(x => x.agent === 'resolver')).toBe(true);
    expect(d.map(x => x.id)).toEqual(['t1/scout', 't1/resolver']);
    expect(d.some(x => /^t[23]\//.test(x.id))).toBe(false);
  });
});

describe('hasCallEvidence', () => {
  it('detects dispatch/prompt/usage/timing/answer lines per stage', () => {
    expect(hasCallEvidence('[UnifiedLLM-Prompt:scout] x', 'scout')).toBe(true);
    expect(hasCallEvidence('[UnifiedLLM-Usage:food_resolver] prompt=1 completion=1 total=2', 'resolver')).toBe(true);
    expect(hasCallEvidence('', 'scout')).toBe(false);
  });
  it('returns false for empty logs across scout/resolver/dietitian stages', () => {
    expect(hasCallEvidence('', 'scout')).toBe(false);
    expect(hasCallEvidence('', 'resolver')).toBe(false);
    expect(hasCallEvidence('', 'dietitian' as any)).toBe(false);
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

  it('returns [] for empty and parses food_resolver timing', () => {
    expect(parseUnifiedTimingLines('')).toEqual([]);
    expect(parseUnifiedTimingLines('[UnifiedLLM-Timing:food_resolver] ms=1200'))
      .toEqual([{ stage: 'food_resolver', ms: 1200 }]);
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

  it('tags network lines with jobId when clientNetworkLogs provided', () => {
    const clientNetworkLogs = ['[NET GET 200] https://x.test/api'];
    const tree = buildCanonicalRunTree(foodInput({
      clientNetworkLogs,
      networkErrors: clientNetworkLogs,
    }));
    expect(tree.network).toContain(`[${JOB}] [NET GET 200] https://x.test/api`);
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

  it('keeps three scout turns when prior dispatches array has length 3', () => {
    const input = foodInput({
      rawScout: undefined,
      dispatches: [
        {
          id: 't1/scout',
          turn: 1,
          agent: 'scout',
          user: 'Analyze this meal photo.',
          received: { mode: 'new_log', photoCount: 1 },
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
        {
          id: 't3/scout',
          turn: 3,
          agent: 'scout',
          user: 'Change fried fish to 150g',
          received: { mode: 'edit', userMessage: 'Change fried fish to 150g' },
          systemInstruction: 'Scout Sys 3',
          userPrompt: 'User modification instruction: "Change fried fish to 150g"',
          output: { dishes: [{ dishName: 'Nasi Goreng' }, { dishName: 'Teh Tawar' }, { dishName: 'Fried Fish' }] },
          rawEmission: { dishes: [{ dishName: 'Nasi Goreng' }, { dishName: 'Teh Tawar' }, { dishName: 'Fried Fish' }] },
        },
      ],
    });

    const d = extractDispatches(input);
    const scouts = d.filter(x => x.agent === 'scout');

    expect(scouts.length).toBeGreaterThanOrEqual(3);
    expect(scouts.slice(0, 3).map(x => x.id)).toEqual(['t1/scout', 't2/scout', 't3/scout']);
    expect(scouts.slice(0, 3).map(x => x.user)).toEqual([
      'Analyze this meal photo.',
      'The tea is unsweetened',
      'Change fried fish to 150g',
    ]);
    expect(new Set(scouts.slice(0, 3).map(x => x.user)).size).toBe(3);
  });

  it('locks three scout turns with distinct users when prior dispatches length is 3', () => {
    const t1User = 'Analyze this meal photo.';
    const t2User = 'The tea is unsweetened';
    const t3User = 'Change fried fish to 150g';

    const input = foodInput({
      rawScout: undefined,
      dispatches: [
        {
          id: 't1/scout',
          turn: 1,
          agent: 'scout',
          user: t1User,
          received: { mode: 'new_log', photoCount: 1 },
        },
        {
          id: 't2/scout',
          turn: 2,
          agent: 'scout',
          user: t2User,
          received: { mode: 'edit', userMessage: t2User },
        },
        {
          id: 't3/scout',
          turn: 3,
          agent: 'scout',
          user: t3User,
          received: { mode: 'edit', userMessage: t3User },
        },
      ],
    });

    const d = extractDispatches(input);
    const scouts = d.filter(x => x.agent === 'scout');

    expect(d.length).toBeGreaterThanOrEqual(3);
    expect(scouts.length).toBe(3);
    expect(d.slice(0, 3).map(x => x.id)).toEqual(['t1/scout', 't2/scout', 't3/scout']);
    expect(scouts.map(x => x.user)).toEqual([t1User, t2User, t3User]);
    expect(new Set(scouts.map(x => x.user)).size).toBe(3);
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

  it('preserves jobId tagging and distinct multi-turn dispatch users', () => {
    const t1User = 'Analyze this meal photo.';
    const t2User = 'The tea is unsweetened';
    const t3User = 'Change fried fish to 150g';

    const tree = buildCanonicalRunTree(foodInput({
      rawScout: undefined,
      dispatches: [
        {
          id: 't1/scout',
          turn: 1,
          agent: 'scout',
          user: t1User,
          received: { mode: 'new_log', photoCount: 1 },
        },
        {
          id: 't2/scout',
          turn: 2,
          agent: 'scout',
          user: t2User,
          received: { mode: 'edit', userMessage: t2User },
        },
        {
          id: 't3/scout',
          turn: 3,
          agent: 'scout',
          user: t3User,
          received: { mode: 'edit', userMessage: t3User },
        },
      ],
    }));

    expect(tree.console).toEqual([`[${JOB}] [LOG] hello`]);
    expect(String(tree.backendLogs)).toContain(`[${JOB}] [UnifiedLLM] Calling gemini-3.5-flash-lite`);
    expect(tree.dispatches.slice(0, 3).map(x => x.user)).toEqual([t1User, t2User, t3User]);
    expect(new Set(tree.dispatches.slice(0, 3).map(x => x.user)).size).toBe(3);
  });

  it('builds a medical dispatch and tags console lines for the medical pack', () => {
    const tree = buildCanonicalRunTree(foodInput({
      pack: 'medical',
      message: 'Review my lab results',
      extractedData: { hba1c: 6.1 },
      clientConsoleLogs: ['[LOG] medical payload'],
    }));

    expect(tree.pack).toBe('medical');
    expect(tree.console).toEqual([`[${JOB}] [LOG] medical payload`]);
    expect(tree.dispatches).toHaveLength(1);
    expect(tree.dispatches[0].agent).toBe('medical');
    expect(tree.dispatches[0].id).toBe('t1/medical');
    expect(tree.dispatches.some(d => d.agent === 'scout')).toBe(false);
  });

  it('builds a health coach dispatch for the health_coach pack, not scout', () => {
    const tree = buildCanonicalRunTree(foodInput({
      pack: 'health_coach',
      message: 'Review my weekly habits',
    }));

    expect(tree.pack).toBe('health_coach');
    expect(tree.dispatches).toHaveLength(1);
    expect(tree.dispatches[0].id).toBe('t1/health_coach');
    expect(tree.dispatches[0].agent).toBe('health_coach');
    expect(tree.dispatches.some(d => d.agent === 'scout')).toBe(false);
  });
});

