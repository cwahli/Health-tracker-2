import { describe, it, expect } from 'vitest';
import { applyPortionChoices, detectPortionAmbiguity, buildPortionClarifyPayload } from './server_portion_clarify';

describe('detectPortionAmbiguity & buildPortionClarifyPayload', () => {
  it('detects multipack cereal bar box as portion ambiguous', () => {
    const item = {
      scoutIndex: 2,
      originalName: 'Skinny Crunch Light Raspberry & White Choc',
      keyword: 'raspberry white chocolate cereal bar',
      estimatedWeightGrams: 19,
      rawNutritionLabel: {
        servingSize: '100g',
        calories: '329 kcal',
        protein: '4.8g',
        totalFat: '4.8g',
        totalCarbohydrate: '54g',
      },
    };
    const res = detectPortionAmbiguity(item, 2);
    expect(res).not.toBeNull();
    expect(res?.name).toBe('Skinny Crunch Light Raspberry & White Choc');
    expect(res?.options.length).toBeGreaterThanOrEqual(3);
    expect(res?.options.some((o) => o.weightGrams === 19)).toBe(true);
    expect(res?.options.some((o) => o.weightGrams === 38)).toBe(true);
  });

  it('builds generic multi-item clarification payload when multiple foods have ambiguous portions', () => {
    const items = [
      {
        scoutIndex: 0,
        originalName: 'Turkey Cold Cuts Deli Tub',
        keyword: 'turkey slices',
        estimatedWeightGrams: 50,
        rawNutritionLabel: {
          servingSize: '100g',
          calories: '120 kcal',
          protein: '22g',
          totalFat: '2g',
          totalCarbohydrate: '1g',
        },
      },
      {
        scoutIndex: 1,
        originalName: 'Skinny Crunch Light Raspberry & White Choc',
        keyword: 'raspberry white chocolate cereal bar',
        estimatedWeightGrams: 19,
        rawNutritionLabel: {
          servingSize: '100g',
          calories: '329 kcal',
          protein: '4.8g',
          totalFat: '4.8g',
          totalCarbohydrate: '54g',
        },
      },
    ];
    const payload = buildPortionClarifyPayload(items);
    expect(payload).not.toBeNull();
    expect(payload?.items).toHaveLength(2);
    expect(payload?.promptMessage).toContain('Confirm portions for:');
  });
});

describe('applyPortionChoices', () => {
  it('scales estimatedCalories with weight and preserves rawNutritionLabel', () => {
    const items = [
      {
        scoutIndex: 0,
        estimatedWeightGrams: 200,
        estimatedCalories: 400,
        rawNutritionLabel: { calories: '200 kcal / 100g' },
        keyword: 'granola',
      },
    ];
    const out = applyPortionChoices(items, { '0': 100 });
    expect(out[0].estimatedWeightGrams).toBe(100);
    expect(out[0].estimatedCalories).toBe(200);
    expect(out[0].rawNutritionLabel).toEqual({ calories: '200 kcal / 100g' });
    expect(out[0].portionChoiceApplied).toBe(100);
  });

  it('no-ops when choices empty', () => {
    const items = [{ scoutIndex: 0, estimatedWeightGrams: 150, estimatedCalories: 300 }];
    expect(applyPortionChoices(items, null)).toEqual(items);
    expect(applyPortionChoices(items, {})).toEqual(items);
  });
});
