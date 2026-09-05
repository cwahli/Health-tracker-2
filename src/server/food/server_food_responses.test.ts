import { describe, it, expect } from 'vitest';
import {
  buildDiscussionResponse,
  buildEvaluationResponse,
  buildNewLogResponse,
  buildModifyNoMealResponse,
  buildModifyResponse,
} from './server_food_responses';

describe('F-8.10 shard 26 — mode response payloads', () => {
  it('shapes discussion and modify-no-meal fallbacks', () => {
    const d = buildDiscussionResponse({ rawParsed: {}, fullPromptSent: 'P', apiCalls: [] });
    expect(d.mode).toBe('discussion');
    expect(d.text).toContain('details on this meal composition');
    expect(d.data).toBeNull();
    const m = buildModifyNoMealResponse({ rawParsed: {}, apiCalls: [] });
    expect(m.message).toContain("couldn't modify");
    expect(m.data).toBeNull();
  });

  it('shapes evaluation payloads with comparison and scout context', () => {
    const e = buildEvaluationResponse({
      rawParsed: { _internalReasoning: 'r', message: 'pick one' },
      scoutInternalReasoning: 's', rawScoutData: null,
      comparisonData: { groups: [] }, comparisonSet: { id: 'c' },
      scoutItems: [], scoutContentType: 'visual', diningEnvironment: 'home_cooked',
      fullPromptSent: 'P', apiCalls: [],
    });
    expect(e.mode).toBe('evaluation');
    expect(e.message).toBe('pick one');
    expect(e.comparisonSet.id).toBe('c');
  });

  it('shapes new_log payloads with fallback narrative and ledger data', () => {
    const n = buildNewLogResponse({
      rawParsed: {}, parsedData: { name: 'Bowl', quantity: '1 serving' },
      pendingFoodLog: null, mealBuild: {}, gate: { savable: true },
      scoutInternalReasoning: null, rawScoutData: null, scoutContentType: 'visual',
      diningEnvironment: 'home_cooked', fullPromptSent: 'P', scoutItems: [], apiCalls: [],
    });
    expect(n.mode).toBe('new_log');
    expect(n.message).toContain('Bowl');
    expect(n.savable).toBe(true);
    expect(n.data.name).toBe('Bowl');
  });

  it('shapes modify payloads with edit flags', () => {
    const m = buildModifyResponse({
      rawParsed: { _internalReasoning: 'r' }, finalMessage: 'done',
      pendingFoodLog: null, activeMeal: { name: 'Lunch' }, mealBuild: {},
      gate: { savable: true }, editApplied: true, fullPromptSent: 'P', scoutItems: [], apiCalls: [],
    });
    expect(m.mode).toBe('modify');
    expect(m.text).toBe('done');
    expect(m.editApplied).toBe(true);
    expect(m.data.name).toBe('Lunch');
  });
});
