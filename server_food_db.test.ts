import { describe, it, expect } from 'vitest';
import { getTraceNutrientsForFoodType, getCookingMethodModifier } from './server_food_db';

describe('getTraceNutrientsForFoodType', () => {
  it('returns base values at 100g', () => {
    const result = getTraceNutrientsForFoodType('red_meat', 100);
    expect(result.iron).toBeCloseTo(2.5, 2);
    expect(result.magnesium).toBeCloseTo(22, 2);
  });

  it('scales down linearly below 100g', () => {
    const result = getTraceNutrientsForFoodType('red_meat', 50);
    expect(result.iron).toBeCloseTo(1.25, 2);
  });

  it('scales up linearly above 100g', () => {
    const result = getTraceNutrientsForFoodType('leafy_veg', 200);
    expect(result.vitaminC).toBeCloseTo(100, 2);
  });

  it('falls back to the "unknown" profile for an unrecognized foodType', () => {
    const result = getTraceNutrientsForFoodType('not_a_real_type', 100);
    const unknown = getTraceNutrientsForFoodType('unknown', 100);
    expect(result).toEqual(unknown);
  });

  it('returns all zeros at weightGrams = 0', () => {
    const result = getTraceNutrientsForFoodType('fish_fatty', 0);
    expect(result.omega3).toBe(0);
    expect(result.vitaminD).toBe(0);
  });
});

describe('getCookingMethodModifier', () => {
  it('returns exact modifiers for direct keys', () => {
    const deepFried = getCookingMethodModifier('deep_fried');
    expect(deepFried.addedFatPer100g).toBe(10.0);
    expect(deepFried.addedCaloriesPer100g).toBe(90.0);

    const steamed = getCookingMethodModifier('steamed');
    expect(steamed.addedFatPer100g).toBe(0);
  });

  it('fuzzy matches lowercase/uppercase/substrings', () => {
    const deep = getCookingMethodModifier('DEEP fried');
    expect(deep.addedFatPer100g).toBe(10.0);

    const pan = getCookingMethodModifier('panfried chicken');
    expect(pan.addedFatPer100g).toBe(5.0);

    const boil = getCookingMethodModifier('boiled beef');
    expect(boil.addedFatPer100g).toBe(0.0);
  });

  it('defaults to unknown for empty/null/unrecognized methods', () => {
    const empty = getCookingMethodModifier(null);
    expect(empty.addedFatPer100g).toBe(0.0);

    const unrecognized = getCookingMethodModifier('magical_spell');
    expect(unrecognized.addedFatPer100g).toBe(0.0);
  });
});

