import { describe, it, expect } from 'vitest';
import {
  sanitizeLlmJsonOutput,
  computeDietitianSkipGates,
  decideScoutVerdict,
  decideScoutAdvice,
} from './server_food_dietitian_dispatch';

describe('F-8.10 shard 4 — LLM JSON repair', () => {
  it('collapses runaway decimals and trims repeating foodType', () => {
    const raw = '{"weightGrams": "350.0000000000", "calories": 150.00000000000003, "foodType": "protein grain vegetable fruit dairy snack condiment prepared dish entree other extra words here"} ```json';
    const { cleanJson, extractedScratchpad } = sanitizeLlmJsonOutput(raw);
    expect(cleanJson).toContain('"350"');
    expect(cleanJson).toContain(': 150');
    expect(cleanJson).toContain('"foodType": "protein"');
    expect(extractedScratchpad).toBe('');
    expect(() => JSON.parse(cleanJson)).not.toThrow();
  });

  it('preserves significant fractional digits and scratchpad text', () => {
    const raw = 'reasoning notes here {"protein": 22.5, "sodium": 300}';
    const { cleanJson, extractedScratchpad } = sanitizeLlmJsonOutput(raw);
    expect(cleanJson).toContain('22.5');
    expect(extractedScratchpad).toContain('reasoning notes here');
  });
});

describe('F-8.10 shard 4 — dietitian skip gates (F-10 adaptive law)', () => {
  const baseArgs = {
    isPureWeightModification: false,
    activeMeal: null,
    userSelectedMode: 'review',
    weightRefineIntent: {},
    message: 'log lunch',
    isModifySession: false,
    hasActiveMealDocument: false,
    visionScoutRanAndReturnedItems: true,
    preCalculatedItems: [{ estimatedWeightGrams: 300 }],
    visionScoutItems: [{ keyword: 'rice' }],
    imagePayloads: [{}],
    visionScoutContentType: 'visual',
    rawScoutData: {},
  };

  it('allows single-agent create skip on a simple one-dish scout', () => {
    const gates = computeDietitianSkipGates(baseArgs);
    expect(gates.isCreateSession).toBe(true);
    expect(gates.hasBarcode).toBe(false);
    expect(gates.hasReceipt).toBe(false);
    expect(gates.canSkipDietitianForCreate).toBe(true);
    expect(gates.canSkipDietitianForPureScale).toBe(false);
  });

  it('forces dietitian expansion via barcode, receipt, and multi-dish signals', () => {
    const barcode = computeDietitianSkipGates({
      ...baseArgs,
      visionScoutItems: [{ keyword: '8992761111059' }],
    });
    expect(barcode.hasBarcode).toBe(true);
    expect(barcode.canSkipDietitianForCreate).toBe(false);

    const receipt = computeDietitianSkipGates({ ...baseArgs, visionScoutContentType: 'receipt' });
    expect(receipt.hasReceipt).toBe(true);
    expect(receipt.canSkipDietitianForCreate).toBe(false);
  });

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
