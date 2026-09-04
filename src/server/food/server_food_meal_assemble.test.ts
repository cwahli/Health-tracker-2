import { describe, it, expect } from 'vitest';
import {
  buildFallbackItemsBreakdown,
  assembleParsedMealHeader,
  backfillEditCommandEstimates,
  formatMultiItemMealTitle,
  resolveEditedMealTitle,
  appendEditHistoryEntry,
  syncEditScoutItems,
  buildGateInput,
} from './server_food_meal_assemble';

describe('F-8.10 shard 6 — fallback breakdown', () => {
  it('builds estimated rows from scout items and logs once', () => {
    const logs: string[] = [];
    const out = buildFallbackItemsBreakdown({
      visionScoutItems: [{ keyword: 'rice', estimatedWeightGrams: 200 }],
      databaseMatchesArray: [],
      quarantinedIdsSet: new Set(),
      onLog: (m) => logs.push(m),
    });
    expect(out).toHaveLength(1);
    expect(out![0].canonicalDbName).toBe('rice');
    expect(out![0].dbSource).toBe('estimated');
    expect(out![0].weightGrams).toBe('200');
    expect(logs.some((m) => m.includes('LLM truncated'))).toBe(true);
  });

  it('returns null without scout items and never invents a label source', () => {
    const logs: string[] = [];
    expect(buildFallbackItemsBreakdown({
      visionScoutItems: [], databaseMatchesArray: [], quarantinedIdsSet: new Set(), onLog: (m) => logs.push(m),
    })).toBeNull();
    expect(logs).toEqual([]);
    const out = buildFallbackItemsBreakdown({
      visionScoutItems: [{
        keyword: 'oats', estimatedWeightGrams: 60,
        source: 'visual',
        nutritionFacts: { caloriesPer100g: 350, proteinPer100g: 10 },
      }],
      databaseMatchesArray: [],
      quarantinedIdsSet: new Set(),
      onLog: () => {},
    });
    // nutritionFacts alone must not promote the row to a printed label
    expect(out![0].dbSource).toBe('estimated');
    expect(out![0].labelNutrientsPerServing).toBeNull();
  });
});

describe('F-8.10 shard 6 — parsed meal header', () => {
  const base = {
    rawFoodData: {
      name: 'Lunch',
      date: '2026-09-04',
      itemsBreakdown: [{ canonicalDbName: 'Rice', weightGrams: 200 }],
      composition: 'Rice bowl',
      weightGrams: 200,
      quantity: '1 serving',
      message: 'Tasty',
      verdict: { label: 'Good fuel', level: 'good' },
      cookingMethod: 'boiled',
    },
    rawParsed: {},
    imageDates: [],
    message: 'log lunch',
    originalModeIsModify: false,
    activeMeal: null as any,
    language: 'en' as unknown,
  };

  it('assembles names, dates, verdict, and dining env', () => {
    const { parsedData, diningEnvironment } = assembleParsedMealHeader({
      ...base, scoutCookingMethod: 'raw', diningEnvironment: 'home_cooked',
    });
    expect(parsedData.name).toBe('Lunch');
    expect(parsedData.date).toBe('2026-09-04');
    expect(parsedData.weightGrams).toBe(200);
    expect(parsedData.basis_type).toBe('total');
    expect(parsedData.verdict.level).toBe('good');
    expect(parsedData.diningEnvironment).toBe('home_cooked');
    expect(diningEnvironment).toBe('home_cooked');
  });

  it('falls back to the active meal date and dining env on edits', () => {
    const { parsedData, diningEnvironment } = assembleParsedMealHeader({
      ...base,
      rawFoodData: { ...base.rawFoodData, date: undefined },
      originalModeIsModify: true,
      activeMeal: { date: '2026-09-01', diningEnvironment: 'casual_restaurant' },
      diningEnvironment: 'unknown',
    });
    expect(parsedData.date).toBe('2026-09-01');
    expect(diningEnvironment).toBe('casual_restaurant');
  });

  it('sanitizes undefined-ish strings and keeps Q&A message empty-safe', () => {
    const { parsedData } = assembleParsedMealHeader({
      ...base,
      rawFoodData: { name: 'undefined', itemsBreakdown: [] },
      rawParsed: { message: undefined },
    });
    expect(parsedData.name).toBe('Meal Log');
    expect(parsedData.message).toBe('');
  });
});

describe('F-8.10 shard 7 — modify-path seams', () => {
  it('backfills identity-change estimates and throws on invalid commands', () => {
    const withFix = backfillEditCommandEstimates({
      modificationCommand: [{ action: 'replace_identity', itemName: 'soda', newItemName: 'Tea', scoutIndex: 3 }],
      foodData: { itemsBreakdown: [{ canonicalDbName: 'Tea', scoutIndex: 3, correctedNutrients: { calories: 2, protein: 0 }, foodType: 'beverage', cookingMethod: 'raw' }] },
    });
    expect(withFix[0].estimate.calories).toBe(2);
    expect(withFix[0].estimate.foodType).toBe('beverage');
    expect(() => backfillEditCommandEstimates({
      modificationCommand: [{ action: 'add_item', itemName: 'cake' }],
      foodData: { itemsBreakdown: [] },
    })).toThrow(/invalid response/);
    expect(backfillEditCommandEstimates({ modificationCommand: [] })).toEqual([]);
  });

  it('formats multi-item titles and syncs renames from commands', () => {
    expect(formatMultiItemMealTitle([])).toBe('Meal');
    expect(formatMultiItemMealTitle([{ name: 'Rice' }])).toBe('Rice');
    expect(formatMultiItemMealTitle([{ name: 'Rice' }, { name: 'Tea' }])).toBe('Rice and Tea');
    const renamed = resolveEditedMealTitle({
      incomingTitle: 'Rice and Soda',
      items: [{ name: 'Rice' }, { name: 'Unsweetened Tea' }],
      editCommands: [{ action: 'replace_identity', itemName: 'Soda', newItemName: 'Unsweetened Tea' }],
    });
    expect(renamed).toBe('Rice and Unsweetened Tea');
    expect(resolveEditedMealTitle({ incomingTitle: 'Lunch', items: [{ name: 'Rice' }], editCommands: [] })).toBe('Lunch');
    expect(resolveEditedMealTitle({ incomingTitle: null, items: [], editCommands: [] })).toBeNull();
  });

  it('syncs scout chips with ledger renames and fabricates missing rows', () => {
    const out = syncEditScoutItems({
      baseScoutItems: [{ scoutIndex: 0, originalName: 'Es Teh Manis', keyword: 'Es Teh Manis' }],
      resultItems: [{ scoutIndex: 0, canonicalDbName: 'Unsweetened Iced Tea', weightGrams: 300 }],
    });
    expect(out[0].originalName).toBe('Unsweetened Iced Tea');
    expect(out[0].keyword).toBe('Unsweetened Iced Tea');
    const fabricated = syncEditScoutItems({
      baseScoutItems: [],
      resultItems: [{ scoutIndex: 9, name: 'Mystery' }],
    });
    expect(fabricated[0].originalName).toBe('Mystery');
    expect(fabricated[0].cookingMethod).toBe('raw');
  });

  it('appends edit history and shapes gate input', () => {
    const meal: any = {};
    const logs: string[] = [];
    appendEditHistoryEntry({
      activeMeal: meal, message: 'less rice',
      result: { notes: [' halved rice '], beforeItems: [{ name: 'Rice', weightGrams: 200 }], items: [{ name: 'Rice', weightGrams: 100 }] },
      onLog: (m) => logs.push(m),
    });
    expect(meal.historyLog.length).toBe(1);
    expect(meal.historyLog[0].stage).toBe('meal_edit');
    const gate = buildGateInput({
      finalMeal: { id: 'm1', name: 'Lunch', weightGrams: 300, nutrients: { calories: 400, protein: 20, carbohydrates: 50, totalFat: 10 }, itemsBreakdown: [{ originalName: 'Rice', weightGrams: 300 }] },
      jobId: 'j1', imagePayloads: [{}], finalMessage: 'done', previousMeal: null, editCommands: [],
    });
    expect(gate.mealId).toBe('m1');
    expect(gate.calories).toBe(400);
    expect(gate.imageCount).toBe(1);
    expect(gate.items[0].name).toBe('Rice');
  });
});
