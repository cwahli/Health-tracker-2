import { describe, it, expect } from 'vitest';
import { isCompositeDishForm, decidePrepAddition, buildFoodMatrix } from './server_prep_policy.js';

describe('server_prep_policy', () => {
  it('correctly identifies composite dish forms', () => {
    expect(isCompositeDishForm({ dishName: 'Honi Poke Salmon Poke Bowl', componentCount: 4 })).toBe(true);
    expect(isCompositeDishForm({ keyword: 'salmon poke bowl' })).toBe(true);
    expect(isCompositeDishForm({ dishName: 'Chicken Caesar Salad' })).toBe(true);
    expect(isCompositeDishForm({ dishName: 'Steak with Pepper Sauce', componentCount: 1 })).toBe(false);
  });

  it('suppresses prep oil/salt on Honi-like composite bowl', () => {
    const res = decidePrepAddition({
      weightGrams: 450,
      cookingMethod: 'baked',
      dishName: 'Honi Poke Salmon Poke Bowl',
      keyword: 'Honi Poke Salmon Poke Bowl with Quinoa and Edamame',
      canonicalDbName: 'cooked glazed salmon',
      diningEnvironment: 'fast_food_chain',
      componentCount: 4,
      cookingAdded: { addedCalories: 227, addedFat: 25, addedSaturatedFat: 5, addedSodium: 126 },
    });
    expect(res.addedCalories).toBe(0);
    expect(res.addedFat).toBe(0);
    expect(res.addedSaturatedFat).toBe(0);
    expect(res.addedSodium).toBe(0);
    expect(res.reason).toBe('composite_dish_suppress_top_level_prep');
  });

  it('returns zero when hasLockedTruth is true', () => {
    const res = decidePrepAddition({
      weightGrams: 200,
      cookingMethod: 'grilled',
      dishName: 'Sirloin Steak',
      hasLockedTruth: true,
    });
    expect(res.addedCalories).toBe(0);
    expect(res.reason).toBe('locked_truth');
  });

  it('preserves cookingAdded for a single non-composite item like grilled steak', () => {
    const res = decidePrepAddition({
      weightGrams: 200,
      cookingMethod: 'grilled',
      dishName: 'Sirloin Steak',
      componentCount: 0,
      cookingAdded: { addedCalories: 50, addedFat: 5.5, addedSaturatedFat: 1.1, addedSodium: 120 },
    });
    expect(res.addedCalories).toBe(50);
    expect(res.addedFat).toBe(5.5);
    expect(res.addedSodium).toBe(120);
    expect(res.reason).toBe('explicit_cooking_added');
  });

  it('allows explicit user fat override on composite dish', () => {
    const res = decidePrepAddition({
      weightGrams: 450,
      cookingMethod: 'baked',
      dishName: 'Honi Poke Salmon Poke Bowl',
      userText: 'pan-fried in oil',
      componentCount: 4,
    });
    expect(res.addedCalories).toBeGreaterThan(0);
    expect(res.reason).toBe('calculated_prep');
  });

  it('suppresses prep oil with [PrepXOR] if dish has fat-bearing components', () => {
    let logged = false;
    const res = decidePrepAddition({
      weightGrams: 200,
      cookingMethod: 'grilled',
      hasFatBearingComponent: true,
      addDebugLog: (msg) => {
        if (msg.includes('[PrepXOR]')) logged = true;
      }
    });
    expect(res.addedCalories).toBe(0);
    expect(res.reason).toBe('prep_xor_fat_bearing');
    expect(logged).toBe(true);
  });

  it('applies higher lipid/Na for fast_food_chain vs home_cooked on deep_fried (F-10.6)', () => {
    const base = {
      weightGrams: 200,
      cookingMethod: 'deep_fried',
      dishName: 'Chicken Breast',
      keyword: 'chicken',
      componentCount: 0,
    };
    const home = decidePrepAddition({ ...base, diningEnvironment: 'home_cooked' });
    const ff = decidePrepAddition({ ...base, diningEnvironment: 'fast_food_chain' });
    expect(home.reason).toBe('calculated_prep');
    expect(ff.reason).toBe('calculated_prep');
    expect(ff.addedFat).toBeGreaterThan(home.addedFat);
    expect(ff.addedSodium).toBeGreaterThan(home.addedSodium);
  });

  it('zeros prep when cookingMethod is unknown (F-10.6)', () => {
    const res = decidePrepAddition({
      weightGrams: 200,
      dishName: 'Chicken Breast',
      keyword: 'chicken',
      componentCount: 0,
    });
    expect(res.addedFat).toBe(0);
    expect(res.addedSodium).toBe(0);
    expect(res.reason).toBe('method_unknown');
  });
});
