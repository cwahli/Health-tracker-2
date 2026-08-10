import { describe, it, expect } from 'vitest';
import { applyPortionChoices } from './server_portion_clarify';

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
