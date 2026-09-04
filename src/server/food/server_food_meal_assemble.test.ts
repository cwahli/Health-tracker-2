import { describe, it, expect } from 'vitest';
import { buildFallbackItemsBreakdown, assembleParsedMealHeader } from './server_food_meal_assemble';

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
