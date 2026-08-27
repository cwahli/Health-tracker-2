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

  it('correctly labels Whole pack as actual pack weight (85g) when label is per 100g', () => {
    const item = {
      scoutIndex: 1,
      originalName: 'Southern Style Chicken Bites',
      keyword: 'southern fried chicken bites',
      estimatedWeightGrams: 85,
      rawNutritionLabel: {
        servingSize: '100g',
        calories: '210 kcal',
        protein: '19.0g',
        totalFat: '9.5g',
        totalCarbohydrate: '12g',
      },
    };
    const res = detectPortionAmbiguity(item, 1);
    expect(res).not.toBeNull();
    expect(res?.name).toBe('Southern Style Chicken Bites');
    // Whole pack option should be 85g, NOT 100g
    const wholePackOpt = res?.options.find((o) => o.label.startsWith('Whole pack'));
    expect(wholePackOpt).toBeDefined();
    expect(wholePackOpt?.weightGrams).toBe(85);
    expect(wholePackOpt?.label).toBe('Whole pack (85g)');

    // 100g option should be labeled as nutrition panel basis
    const panelOpt = res?.options.find((o) => o.weightGrams === 100);
    expect(panelOpt).toBeDefined();
    expect(panelOpt?.label).toContain('100g');
    expect(panelOpt?.label).not.toContain('Whole pack');
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

// Bug #9 regressions — visual-source single-serve items
describe('Bug #9 — visual-source portion-clarify guard', () => {
  it('does NOT trigger portionClarify for a visual-source single wrap (no explicit unit count)', () => {
    // "Crispy chicken wrap" — user sees 1 wrap; source=visual; no leading number in name.
    // Expect: return null so scout's 200g estimate is used directly.
    const item = {
      scoutIndex: 2,
      originalName: 'Crispy chicken wrap',
      keyword: 'crispy chicken wrap',
      estimatedWeightGrams: 200,
      estimatedCalories: 450,
      source: 'visual',
      ingredientsList: 'chicken, lettuce, crispy onion, gherkins, spicy mayonnaise',
    };
    expect(detectPortionAmbiguity(item, 2)).toBeNull();
  });

  it('does NOT trigger portionClarify for visual single-serve ice cream cone', () => {
    const item = {
      scoutIndex: 0,
      originalName: 'Yogurt Ice Cream Cone with Yogurt Soft Serve, Waffle Cone',
      keyword: 'Yogurt Ice Cream Cone with Yogurt Soft Serve, Waffle Cone',
      estimatedWeightGrams: 120,
      contentType: 'visual',
      rawNutritionLabel: null,
    };
    expect(detectPortionAmbiguity(item, 0)).toBeNull();
  });

  it('uses leading digit from name for "2 butter croissants" (never the biscuit-default of 6)', () => {
    // Before fix: unitNoun='piece' → default 6 units. After fix: detectedUnits=2 from name.
    const item = {
      scoutIndex: 1,
      originalName: '2 butter croissants',
      keyword: 'croissants',
      estimatedWeightGrams: 130,
      estimatedCalories: 500,
      source: 'visual',
    };
    const res = detectPortionAmbiguity(item, 1);
    expect(res).not.toBeNull();
    // reason must mention 2 units, never 6
    expect(res?.reason).toContain('2');
    expect(res?.reason).not.toContain('6');
    // Must offer a 1-unit option
    expect(res?.options.some((o) => o.label.startsWith('1 '))).toBe(true);
    // Must offer a 2-unit option
    expect(res?.options.some((o) => o.label.startsWith('2 '))).toBe(true);
  });
});


describe('applyPortionChoices', () => {
  it('updates estimatedWeightGrams and sets nutrientBasisWeight while preserving rawNutritionLabel', () => {
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
    expect(out[0].nutrientBasisWeight).toBe(200);
    expect(out[0].rawNutritionLabel).toEqual({ calories: '200 kcal / 100g' });
    expect(out[0].portionChoiceApplied).toBe(100);
  });

  it('scales legacy estimatedCalories when FOOD_DISH_ESTIMATE is 0', () => {
    const prevEnv = process.env.FOOD_DISH_ESTIMATE;
    try {
      process.env.FOOD_DISH_ESTIMATE = '0';
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
    } finally {
      process.env.FOOD_DISH_ESTIMATE = prevEnv;
    }
  });

  it('no-ops when choices empty', () => {
    const items = [{ scoutIndex: 0, estimatedWeightGrams: 150, estimatedCalories: 300 }];
    expect(applyPortionChoices(items, null)).toEqual(items);
    expect(applyPortionChoices(items, {})).toEqual(items);
  });
});
