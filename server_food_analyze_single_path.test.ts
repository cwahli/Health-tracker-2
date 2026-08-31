import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const pipeline = readFileSync(resolve(__dirname, './server_food_analyze_run.ts'), 'utf8');
const route = readFileSync(resolve(__dirname, './server_routes_food_analyze.ts'), 'utf8');

describe('F-8.9 calorie host deleted from analyze pipeline', () => {
  it('does not contain First-Principles Injection or post-finalize aggregate', () => {
    expect(pipeline).not.toMatch(/First-Principles Injection/);
    expect(pipeline).not.toMatch(/aggregateItemsNutrients\s*\(/);
    expect(pipeline).not.toMatch(/Construct 5-Column Clean First-Principles/);
    expect(pipeline).not.toMatch(/Backend-Side Mathematical Macro Aggregation/);
    expect(route).not.toMatch(/First-Principles Injection/);
    expect(route).not.toMatch(/aggregateItemsNutrients\s*\(/);
  });

  it('create maps from finalize; edit uses applyMealEdits', () => {
    expect(pipeline).toMatch(/buildMealFromFinalizeLedgers/);
    expect(pipeline).toMatch(/applyMealEdits/);
    expect(pipeline).toMatch(/evaluateMealGate/);
  });

  it('packaged items bind via PackagedBind rather than silent CuratorSkipped-only', () => {
    expect(pipeline).toMatch(/PackagedBind/);
    expect(pipeline).toMatch(/isPackagedBindItem/);
  });

  it('does not copy scout estimatedCalories onto compare seed rows', () => {
    expect(pipeline).not.toMatch(/calories:\s*s\.estimatedCalories/);
  });

  it('HTTP adapter is thin and delegates to runFoodAnalyze', () => {
    expect(route).toMatch(/runFoodAnalyze/);
    expect(route.split('\n').filter(Boolean).length).toBeLessThanOrEqual(700);
    expect(route).not.toMatch(/finalizeDishLedger/);
  });
});

describe('F-8 compiler uses finalize not aggregateItemsNutrients', () => {
  const src = readFileSync(resolve(__dirname, './server_meal_compiler.ts'), 'utf8');
  it('compileMealState calls finalizeDishLedger and not aggregateItemsNutrients(', () => {
    expect(src).toMatch(/finalizeDishLedger/);
    expect(src).not.toMatch(/aggregateItemsNutrients\s*\(/);
  });
});
