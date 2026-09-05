import { describe, it, expect } from 'vitest';
import {
  computeDietitianSkipGates,
  decideScoutVerdict,
  decideScoutAdvice,
  buildPureScaleResponse,
  sumPrecalcTotals,
  applyPreDietitianDensityCheck,
  buildCreateSkipResponse,
  sumSalvagedAggregates,
} from './server_food_dietitian_dispatch';
import { NUTRIENT_KEYS } from '../../utils/nutrients';

describe('F-8.10 shard 4 — dietitian skip gates (pure-scale refine)', () => {
  const baseArgs = {
    isPureWeightModification: false,
    activeMeal: null,
    userSelectedMode: 'review',
    weightRefineIntent: {},
    message: 'log lunch',
  };

  it('allows pure-scale refine skip only for clean single-item absolute grams', () => {
    const ok = computeDietitianSkipGates({
      ...baseArgs,
      isPureWeightModification: true,
      activeMeal: { itemsBreakdown: [{ name: 'oats' }] },
      weightRefineIntent: { isRefine: true, weightGrams: 150, kind: 'absolute_grams' },
      message: 'make it 150g',
    });
    expect(ok.canSkipDietitianForPureScale).toBe(true);

    const withVerb = computeDietitianSkipGates({
      ...baseArgs,
      isPureWeightModification: true,
      activeMeal: { itemsBreakdown: [{ name: 'oats' }] },
      weightRefineIntent: { isRefine: true, weightGrams: 150, kind: 'absolute_grams' },
      message: 'remove the oats',
    });
    expect(withVerb.canSkipDietitianForPureScale).toBe(false);

    const multiItem = computeDietitianSkipGates({
      ...baseArgs,
      isPureWeightModification: true,
      activeMeal: { itemsBreakdown: [{ name: 'oats' }, { name: 'milk' }] },
      weightRefineIntent: { isRefine: true, weightGrams: 150, kind: 'absolute_grams' },
      message: 'make it 150g',
    });
    expect(multiItem.canSkipDietitianForPureScale).toBe(false);
  });
});

describe('F-8.10 shard 15 — scout verdict and advice ladders', () => {
  it('walks the verdict ladder and passes existing verdicts through', () => {
    const t = (totals: any, mealName = 'Bowl', scoutVerdict: any = null) =>
      decideScoutVerdict({ scoutVerdict, totals, mealName, language: 'en' });
    expect(t({ totalSugar: 40, totalSatFat: 0, totalP: 0 }).level).toBe('warning');
    expect(t({ totalSugar: 0, totalSatFat: 20, totalP: 0 }).level).toBe('warning');
    expect(t({ totalSugar: 0, totalSatFat: 0, totalP: 30 }).level).toBe('good');
    expect(t({ totalSugar: 5, totalSatFat: 0, totalP: 5 }, 'Yakult').level).toBe('good');
    expect(t({ totalSugar: 0, totalSatFat: 0, totalP: 5 }).level).toBe('neutral');
    expect(t({ totalSugar: 99, totalSatFat: 99, totalP: 99 }, 'X', { label: 'Kept', level: 'good' })).toEqual({ label: 'Kept', level: 'good' });
  });

  it('walks the advice ladder and passes existing advice through', () => {
    const t = (totals: any, mealName = 'Bowl', rawAdvice: any = '') =>
      decideScoutAdvice({ rawAdvice, totals, mealName, language: 'en' });
    expect(t({ totalSugar: 5, totalSatFat: 0, totalP: 5 }, 'Yakult')).toContain('5');
    expect(t({ totalSugar: 0, totalSatFat: 0, totalP: 25 })).toContain('25');
    expect(t({ totalSugar: 40, totalSatFat: 0, totalP: 0 })).toContain('40');
    expect(t({ totalSugar: 0, totalSatFat: 0, totalP: 0 }, 'Rice')).toContain('Rice');
    expect(t({ totalSugar: 0, totalSatFat: 0, totalP: 0 }, 'Rice', 'Custom note')).toBe('Custom note');
  });
});

describe('F-8.10 shard 18 — skip-path builders', () => {
  it('builds the pure-scale refine payload without an LLM call', () => {
    const { textOutput, rawParsed } = buildPureScaleResponse({ targetWeightGrams: 150, language: 'en' });
    expect(rawParsed.mode).toBe('modify');
    expect(rawParsed.modificationCommand[0].newWeightGrams).toBe(150);
    expect(JSON.parse(textOutput)).toEqual(rawParsed);
    expect(rawParsed.message).toContain('150');
  });

  it('sums precalc totals for the create path', () => {
    const totals = sumPrecalcTotals([
      { estimatedWeightGrams: 200, nutrients: { calories: 260, protein: 10, carbohydrates: 30, totalFat: 5, sugar: 2, addedSugar: 1, saturatedFat: 1 } },
      { estimatedWeightGrams: 100, nutrients: { calories: 50, protein: 2, carbohydrates: 10, totalFat: 1, sugar: 8, addedSugar: 8, saturatedFat: 0 } },
    ]);
    expect(totals).toEqual({ totalGrams: 300, totalCals: 310, totalP: 12, totalC: 40, totalF: 6, totalSugar: 10, totalAddedSugar: 9, totalSatFat: 1 });
  });
});

describe('F-8.10 shard 19 — pre-dietitian density check', () => {
  it('rescales implausible beverage calories and rolls up aggregates', () => {
    const logs: string[] = [];
    const items: any[] = [{
      name: 'Cola Drink', weightGrams: 500,
      nutrients: { calories: 2000, protein: 0, carbohydrates: 130, totalFat: 0, sodium: 10 },
    }];
    const agg = applyPreDietitianDensityCheck({
      preCalculatedItems: items, aggregatedNutrients: null,
      beveragePattern: /cola|drink/i, onLog: (m) => logs.push(m),
    });
    // 500g cap: 5 * 110 = 550 kcal
    expect(items[0].nutrients.calories).toBe(550);
    expect(agg.calories).toBe(550);
    expect(logs.some((m) => m.includes('Reality Check'))).toBe(true);
  });
});

describe('F-8.10 shard 28 — create-skip synthesis and salvaged aggregates', () => {
  it('synthesizes the single-agent response from totals', () => {
    const out = buildCreateSkipResponse({
      rawScoutData: {},
      visionScoutItems: [{ originalName: 'Rice', keyword: 'rice' }],
      preCalculatedItems: [{
        keyword: 'rice', originalName: 'Rice', estimatedWeightGrams: 200,
        dbSource: 'estimated', nutrients: { calories: 260, protein: 5, carbohydrates: 55, totalFat: 1 },
      }],
      totals: { totalGrams: 200, totalCals: 260, totalP: 5, totalC: 55, totalF: 1, totalSugar: 0, totalAddedSugar: 0, totalSatFat: 0 },
      scoutVerdict: { label: 'Good fuel', level: 'good' },
      rawAdvice: 'Eat up',
      language: 'en',
    });
    expect(out.rawParsed.mode).toBe('new_log');
    expect(out.rawParsed.foodData.itemsBreakdown).toHaveLength(1);
    expect(out.rawParsed.foodData.name).toBe('Rice');
    expect(JSON.parse(out.textOutput)).toEqual(out.rawParsed);
  });

  it('sums salvaged aggregates across items', () => {
    const agg = sumSalvagedAggregates([
      { nutrients: { calories: 100, protein: 10 } },
      { nutrients: { calories: 50, protein: 5 } },
      {},
    ]);
    expect(agg.calories).toBe(150);
    expect(agg.protein).toBe(15);
    expect(agg.sodium).toBe(0);
    const empty = sumSalvagedAggregates(null);
    expect(empty.calories).toBe(0);
    expect(Object.keys(empty)).toHaveLength(NUTRIENT_KEYS.length);
  });
});
