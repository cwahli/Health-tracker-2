import { describe, it, expect } from 'vitest';
import { resolveFoodAnalyzeMode, buildFoodApiCalls, normalizeParsedPostDietitian } from './server_food_mode_routing';

describe('F-8.10 shard 5 — mode routing matrix', () => {
  const base = {
    originalModeIsModify: false,
    userSelectedMode: 'review',
    visionScoutItemCount: 3,
    hasActiveMealDocument: false,
    editCommandCount: 0,
    onLog: (_m: string) => {},
  };

  it('honors explicit discussion and evaluation modes', () => {
    expect(resolveFoodAnalyzeMode({ ...base, rawMode: 'discussion' })).toBe('discussion');
    expect(resolveFoodAnalyzeMode({ ...base, rawMode: 'evaluation' })).toBe('evaluation');
  });

  it('demotes single-item evaluation to new_log but never a missing scout list', () => {
    const logs: string[] = [];
    expect(resolveFoodAnalyzeMode({
      ...base, rawMode: 'evaluation', visionScoutItemCount: 1, onLog: (m) => logs.push(m),
    })).toBe('new_log');
    expect(logs.some((m) => m.includes('Mode Override'))).toBe(true);
    expect(resolveFoodAnalyzeMode({ ...base, rawMode: 'evaluation', visionScoutItemCount: undefined })).toBe('evaluation');
  });

  it('forces modify for edit sessions and edit commands, never for discussion', () => {
    expect(resolveFoodAnalyzeMode({ ...base, originalModeIsModify: true })).toBe('modify');
    expect(resolveFoodAnalyzeMode({ ...base, rawMode: 'new_log', editCommandCount: 2 })).toBe('modify');
    // Discussion returns before the override block in the caller — resolver must not flip it.
    expect(resolveFoodAnalyzeMode({ ...base, rawMode: 'discussion', editCommandCount: 2 })).toBe('discussion');
    expect(resolveFoodAnalyzeMode({
      ...base, rawMode: 'evaluation', visionScoutItemCount: 3, editCommandCount: 2,
    })).toBe('evaluation');
  });

  it('logs Q&A vs edit-command single-path outcomes', () => {
    const logs: string[] = [];
    resolveFoodAnalyzeMode({
      ...base, originalModeIsModify: true, hasActiveMealDocument: true, editCommandCount: 0,
      onLog: (m) => logs.push(m),
    });
    expect(logs.some((m) => m.includes('Q&A'))).toBe(true);
    const logs2: string[] = [];
    resolveFoodAnalyzeMode({
      ...base, originalModeIsModify: true, hasActiveMealDocument: true, editCommandCount: 3,
      onLog: (m) => logs2.push(m),
    });
    expect(logs2.some((m) => m.includes('3 edit command(s)'))).toBe(true);
  });

  it('defaults missing mode to modify for edit sessions, new_log otherwise', () => {
    expect(resolveFoodAnalyzeMode({ ...base })).toBe('new_log');
    expect(resolveFoodAnalyzeMode({ ...base, originalModeIsModify: true })).toBe('modify');
  });
});

describe('F-8.10 shard 5 — apiCalls ledger', () => {
  it('lists scout, USDA, and dietitian legs; omits dietitian on skip', () => {
    const full = buildFoodApiCalls({
      hasImage: true, queriesToSearch: ['a', 'b'],
      canSkipDietitianForCreate: false, canSkipDietitianForPureScale: false, engine: 'gemini-x',
    });
    expect(full.map((c) => c.type)).toEqual(['gemini', 'usda', 'gemini']);
    expect(full[2].label).toContain('Dietitian');
    const skipped = buildFoodApiCalls({
      hasImage: false, queriesToSearch: [],
      canSkipDietitianForCreate: true, canSkipDietitianForPureScale: false, engine: 'gemini-x',
    });
    expect(skipped).toEqual([]);
  });
});

describe('F-8.10 shard 18 — post-dietitian normalization', () => {
  it('forces modify for explicit edits and cleans review cards', () => {
    const raw: any = { mode: 'new_log', comparison: { groups: [] } };
    normalizeParsedPostDietitian({ rawParsed: raw, isExplicitModify: true, userSelectedMode: 'chat', visionScoutItems: [] });
    expect(raw.mode).toBe('modify');
    const review: any = { comparison: { groups: [] } };
    normalizeParsedPostDietitian({ rawParsed: review, isExplicitModify: false, userSelectedMode: 'review', visionScoutItems: [] });
    expect(review.mode).toBe('new_log');
    expect(review.comparison).toBeNull();
  });

  it('builds comparison breakdown from scout items when the model omits it', () => {
    const raw: any = {};
    normalizeParsedPostDietitian({
      rawParsed: raw, isExplicitModify: false, userSelectedMode: 'compare',
      visionScoutItems: [{ originalName: 'Oats', keyword: 'oats', estimatedWeightGrams: 60, scoutIndex: 0 }],
    });
    expect(raw.mode).toBe('evaluation');
    expect(raw.foodData.itemsBreakdown).toEqual([
      { name: 'Oats', originalName: 'Oats', weightGrams: 60, scoutIndex: 0 },
    ]);
  });
});
