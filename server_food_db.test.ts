import { describe, it, expect } from 'vitest';
import { getTraceNutrientsForFoodType, getCookingMethodModifier, lookupCanonicalBaseFood, getCachedUSDAFood, setCachedUSDAFood } from './server_food_db';
import { classifyUniversalPhysicalFormV3 } from './server_matching_engine';

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

describe('lookupCanonicalBaseFood (F-1 & F-2 Catalog-First Resolution)', () => {
  it('resolves canonical base foods instantly without network calls', () => {
    const salmon = lookupCanonicalBaseFood('Grilled Salmon');
    expect(salmon).toBeDefined();
    expect(salmon.fdcId).toBe('175168');
    expect(salmon.foodType).toBe('fish_fatty');

    const oats = lookupCanonicalBaseFood('Rolled Oats');
    expect(oats).toBeDefined();
    expect(oats.foodType).toBe('grain');

    const avocado = lookupCanonicalBaseFood('Fresh Avocado');
    expect(avocado).toBeDefined();
    expect(avocado.fdcId).toBe('171705');

    const painAuRaisin = lookupCanonicalBaseFood('Pain au Raisin');
    expect(painAuRaisin).toBeDefined();
    expect(painAuRaisin.fdcId).toBe('canonical_pain_au_raisin');
    expect(painAuRaisin.foodType).toBe('grain');
    expect(painAuRaisin.calories).toBe(355);

    const cinnamonSwirl = lookupCanonicalBaseFood('Cinnamon Swirl');
    expect(cinnamonSwirl).toBeDefined();
    expect(cinnamonSwirl.fdcId).toBe('canonical_cinnamon_swirl');
    expect(cinnamonSwirl.foodType).toBe('grain');

    const plainRaisins = lookupCanonicalBaseFood('Raisins');
    expect(plainRaisins).toBeDefined();
    expect(plainRaisins.fdcId).toBe('169641');
    expect(plainRaisins.foodType).toBe('fruit');
  });

  it('manages local USDA lookup cache for repeat queries', () => {
    setCachedUSDAFood('custom_greek_salad', { fdcId: 'custom_999', calories: 150 });
    const cached = getCachedUSDAFood('custom_greek_salad');
    expect(cached).toBeDefined();
    expect(cached.fdcId).toBe('custom_999');
  });

  it('classifies bakery/pastries with fruit in name as bakery_dessert rather than fruit_vegetable', () => {
    const pastryForm = classifyUniversalPhysicalFormV3({ name: 'Pain au Raisin' });
    expect(pastryForm.primaryCategory).toBe('bakery_dessert');
    expect(pastryForm.physicalForm).toBe('SOLID_GRAIN_BAKERY');

    const swirlForm = classifyUniversalPhysicalFormV3({ name: 'Cinnamon Swirl' });
    expect(swirlForm.primaryCategory).toBe('bakery_dessert');

    const rawFruitForm = classifyUniversalPhysicalFormV3({ name: 'Raisins' });
    expect(rawFruitForm.primaryCategory).toBe('fruit_vegetable');
  });
});

