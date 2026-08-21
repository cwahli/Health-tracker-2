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


describe('FALSE_FRIEND class examples', () => {
  it('pomegranate seeds does not steal sesame seed FDC ID (170150)', () => {
    const p = lookupCanonicalBaseFood('pomegranate seeds');
    // We changed it to 169134 (or brand_menu...) so it should not be 170150!
    expect(p?.fdcId).not.toBe('170150');
  });

  it('individual berry species resolve to distinct base food references rather than falling back to generic mixed berries', () => {
    const s = lookupCanonicalBaseFood('strawberry');
    const b = lookupCanonicalBaseFood('blueberry');
    const r = lookupCanonicalBaseFood('raspberry');
    expect(s?.fdcId).toBe('167762');
    expect(b?.fdcId).toBe('171711');
    expect(r?.fdcId).toBe('167755');
    expect(s?.fdcId).not.toBe(b?.fdcId);
    expect(r?.fdcId).not.toBe(b?.fdcId);
  });

  it('mixed fruit cup query returns canonical fruit cup instead of actimel or yogurt drink', () => {
    const res = lookupCanonicalBaseFood('mixed fruit cup');
    expect(res?.fdcId).toBe('mixed_fruit_cup_canonical');
  });

  it('american cheese has comprehensive micronutrient profile populated', () => {
    const cheese = lookupCanonicalBaseFood('american cheese');
    expect(cheese).toBeDefined();
    expect(cheese!.vitaminC).toBeDefined();
    expect(cheese!.vitaminE).toBeDefined();
    expect(cheese!.vitaminK).toBeDefined();
    expect(cheese!.vitaminA).toBeDefined();
    expect(cheese!.iron).toBeDefined();
    expect(cheese!.calcium).toBeDefined();
    expect(cheese!.phosphorus).toBeDefined();
  });

  it('macaroni and cheese has comprehensive micronutrient profile populated', () => {
    const mac = lookupCanonicalBaseFood('macaroni and cheese');
    expect(mac).toBeDefined();
    expect(mac?.calcium).toBeGreaterThan(0);
    expect(mac?.iron).toBeGreaterThan(0);
    expect(mac?.magnesium).toBeGreaterThan(0);
    expect(mac?.zinc).toBeGreaterThan(0);
    expect(mac?.phosphorus).toBeGreaterThan(0);
  });

  it('crispy onion query returns canonical crispy onion instead of category fallback', () => {
    const res = lookupCanonicalBaseFood('crispy onion');
    expect(res?.fdcId).toBe('crispy_onion_canonical');
  });

  it('ranch dressing query returns canonical ranch dressing instead of category fallback', () => {
    const res = lookupCanonicalBaseFood('ranch dressing');
    expect(res?.fdcId).toBe('ranch_dressing_canonical');
  });

  it('gherkin query returns canonical gherkin instead of category fallback', () => {
    const res = lookupCanonicalBaseFood('gherkin');
    expect(res?.fdcId).toBe('gherkin_canonical');
  });

  it('cobb salad query returns canonical cobb salad instead of salad dressing', () => {
    const res = lookupCanonicalBaseFood('cobb salad');
    expect(res?.fdcId).toBe('cobb_salad_canonical');
  });

  it('resolves cooked bacon query to canonical bacon entry', () => {
    const res = lookupCanonicalBaseFood('cooked bacon');
    expect(res?.fdcId).toBe('172550');
  });
});
