import { describe, it, expect } from 'vitest';
import {
  inheritActiveMealScoutItems,
  mapCompareItemsToScoutItems,
  resolvePriorScoutItems,
  applyBracketPreExtract,
  injectExplicitFoodTags,
  inferPackagedBindChains,
  mapTextQueriesToScoutItems,
  buildScoutFailureError,
  applyScoutResultState,
  mergeScoutIntoActiveMeal,
  logScoutItemSummaries,
} from './server_food_scout_source';
import { visionScoutResponseSchema } from './server_food_analyze_schema';

describe('F-8.10 shard 9 — scout item sourcing', () => {
  it('inherits finalized items from the active meal for edits', () => {
    const logs: string[] = [];
    const activeMeal = {
      itemsBreakdown: [{ canonicalDbName: 'Rice', weightGrams: 200, nutrients: { calories: 260 }, dbSource: 'estimated' }],
    };
    const out = inheritActiveMealScoutItems({ isModifySession: true, visionScoutItems: [], activeMeal, onLog: (m) => logs.push(m) });
    expect(out.ran).toBe(true);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].keyword).toBe('Rice');
    expect(out.items[0].estimatedWeightGrams).toBe(200);
    expect(out.items[0].scoutIndex).toBe(0);
    expect(logs.some((m) => m.includes('Edit Continuity'))).toBe(true);
  });

  it('passes through when not a modify session or nothing to inherit', () => {
    const logs: string[] = [];
    const existing = [{ keyword: 'x' }];
    expect(inheritActiveMealScoutItems({ isModifySession: false, visionScoutItems: existing, activeMeal: {}, onLog: (m) => logs.push(m) }))
      .toEqual({ items: existing, ran: false });
    expect(inheritActiveMealScoutItems({ isModifySession: true, visionScoutItems: [], activeMeal: { itemsBreakdown: [] }, onLog: (m) => logs.push(m) }).ran).toBe(false);
    expect(logs).toEqual([]);
  });

  it('maps compare names to scout rows', () => {
    expect(mapCompareItemsToScoutItems(['Oats', 'Cake'])).toEqual([
      { scoutIndex: 0, keyword: 'Oats', originalName: 'Oats', estimatedWeightGrams: 100, source: 'compare_request' },
      { scoutIndex: 1, keyword: 'Cake', originalName: 'Cake', estimatedWeightGrams: 100, source: 'compare_request' },
    ]);
  });

  it('resolves prior scout across body, meal, and history fallbacks', () => {
    const items = [{ keyword: 'rice' }];
    expect(resolvePriorScoutItems({ body: { activeScoutItems: items }, history: [], activeMeal: null })).toBe(items);
    expect(resolvePriorScoutItems({ body: { scoutItems: items }, history: [], activeMeal: null })).toBe(items);
    expect(resolvePriorScoutItems({ body: {}, history: [], activeMeal: { scoutItems: items } })).toBe(items);
    const fromHistory = resolvePriorScoutItems({
      body: {}, history: [{ data: { portionClarify: { items } } }], activeMeal: null,
    });
    expect(fromHistory).toBe(items);
    expect(resolvePriorScoutItems({ body: {}, history: [], activeMeal: null })).toEqual([]);
  });
});

describe('F-8.10 shard 9 — scout schema invariants', () => {
  it('requires identity, weight, method, box, foods, and dish nutrients', () => {
    const schema: any = visionScoutResponseSchema;
    expect(schema.required).toEqual(['contentType', 'diningEnvironment', 'dishes']);
    const dish = schema.properties.dishes.items;
    expect(dish.required).toEqual(['dishName', 'estimatedWeightGrams', 'cookingMethod', 'boundingBox2D', 'foods', 'dishNutrients']);
    expect(dish.properties.cookingMethod.enum).toContain('deep_fried');
    const nutrients = dish.properties.foods.items.properties.nutrients;
    expect(nutrients.required).toEqual(['protein', 'saturatedFat', 'addedSugar', 'totalFibre', 'sodium', 'carbohydrates']);
    expect(nutrients.required).not.toContain('calories');
    expect(dish.properties.foods.items.properties.rawNutritionLabel.required).toEqual(['servingSize', 'calories']);
  });
});

describe('F-8.10 shard 10 — scout-prep seams', () => {
  it('purges OCR duplicates of bracket items and stamps fallback nutrients', () => {
    const logs: string[] = [];
    const vision: any[] = [{ originalName: 'Oat Bar', keyword: 'oat bar' }];
    const queries: string[] = [];
    applyBracketPreExtract({
      bracketItems: [{ originalName: 'Oat Bar', estimatedWeightGrams: 200 }],
      visionScoutItems: vision, queriesToSearch: queries, onLog: (m) => logs.push(m),
    });
    expect(vision).toHaveLength(1);
    expect(vision[0].source).toBe('bracket_pre_extracted');
    expect(vision[0].nutrients.calories).toBeGreaterThan(0);
    expect(vision[0].components).toHaveLength(1);
    expect(queries).toEqual(['Oat Bar']);
    expect(logs.some((m) => m.includes('Dropping Scout item'))).toBe(true);
  });

  it('injects catalog tags once and infers packaged chains', () => {
    const logs: string[] = [];
    const vision: any[] = [{ dbId: 'a', keyword: 'Oats' }];
    injectExplicitFoodTags({
      visionScoutItems: vision,
      explicitFoodTags: [{ dbId: 'a', name: 'Oats' }, { dbId: 'b', name: 'Cake', weightGrams: 50 }],
      onLog: (m) => logs.push(m),
    });
    expect(vision).toHaveLength(2);
    expect(vision[1].scoutIndex).toBe(1001);
    expect(vision[1].dbSource).toBe('internal_catalog');

    const items: any[] = [{ originalName: 'Drink', packageLabelText: 'Acme Citrus | Vitamin Drink 330ml' }];
    const logs2: string[] = [];
    inferPackagedBindChains({ packagedBindItems: items, onLog: (m) => logs2.push(m) });
    expect(items[0].chainName).toBe('Acme Citrus');
  });

  it('maps text queries with cooking-method sniffing', () => {
    expect(mapTextQueriesToScoutItems(['grilled salmon', 'rice'])).toEqual([
      { scoutIndex: 0, keyword: 'grilled salmon', originalName: 'grilled salmon', estimatedWeightGrams: 100, source: 'text_query', cookingMethod: 'grilled', visualIngredients: [] },
      { scoutIndex: 1, keyword: 'rice', originalName: 'rice', estimatedWeightGrams: 100, source: 'text_query', cookingMethod: 'raw', visualIngredients: [] },
    ]);
  });
});

describe('F-8.10 shard 11 — scout result handling', () => {
  it('classifies dead scout runs into quota/503/corrupt/generic errors', () => {
    expect(() => buildScoutFailureError({ message: '429 RESOURCE_EXHAUSTED' }, 'en')).toThrow(/quota \(429\)/);
    expect(() => buildScoutFailureError({ message: '503 UNAVAILABLE' }, 'en')).toThrow(/503/);
    expect(() => buildScoutFailureError({ message: 'Vision Scout Corrupted output' }, 'en')).toThrow();
    expect(() => buildScoutFailureError({ message: 'weird' }, 'en')).toThrow(/re-upload/);
  });

  it('applies scout state with source defaulting and mode overrides', () => {
    const logs: string[] = [];
    const events: any[] = [];
    const streams: any[] = [];
    const state = applyScoutResultState({
      scoutResult: {
        internalReasoning: 'r',
        items: [
          { keyword: 'rice', originalName: 'Rice', estimatedWeightGrams: 200 },
          { keyword: 'cola', originalName: 'Cola', estimatedWeightGrams: 330, rawNutritionLabel: { calories: '100' } },
        ],
        scoutConfidenceRating: 'High',
        visionScoutContentType: 'visual',
        diningEnvironment: 'unknown',
        queriesToSearch: ['rice', 'cola'],
        visionScoutRanAndReturnedItems: true,
      },
      requestedMode: 'review',
      hasActiveMealDocument: false,
      activeMealDining: 'casual_restaurant',
      currentRecommendedMode: null,
      onLog: (m) => logs.push(m),
      onEvent: (t, s, m, d) => events.push([t, s, m]),
      onStream: (e) => streams.push(e),
    });
    expect(state.visionScoutItems[0].source).toBe('visual');
    expect(state.visionScoutItems[1].source).toBe('label');
    expect(state.diningEnvironment).toBe('casual_restaurant');
    expect(state.scoutRecommendedMode).toBe('new_log');
    expect(state.queriesToSearch).toEqual(['rice', 'cola']);
    expect(events[0][0]).toBe('scout_answer');
    expect(streams[0].stage).toBe('scout');
  });

  it('merges fresh dishes behind existing meal items with index offset', () => {
    const logs: string[] = [];
    const merged = mergeScoutIntoActiveMeal({
      activeMealItemsBreakdown: [{ canonicalDbName: 'Rice', weightGrams: 200, scoutIndex: 0 }],
      visionScoutItems: [{ keyword: 'tea', scoutIndex: 0 }],
      onLog: (m) => logs.push(m),
    });
    expect(merged).toHaveLength(2);
    expect(merged[0].keyword).toBe('Rice');
    expect(merged[1].scoutIndex).toBe(1);
    expect(logs.some((m) => m.includes('same meal'))).toBe(true);
  });

  it('logs per-item summaries with label and flag chrome', () => {
    const logs: string[] = [];
    logScoutItemSummaries([
      { scoutIndex: 0, keyword: 'cola', rawNutritionLabel: { calories: '100', servingSize: '330ml' }, anomalyFlags: ['big'] },
    ], (m) => logs.push(m));
    expect(logs[0]).toContain('Nutrition Label:');
    expect(logs[0]).toContain('Flags: [big]');
  });
});
