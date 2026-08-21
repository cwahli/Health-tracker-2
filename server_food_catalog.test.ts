import { describe, it, expect } from 'vitest';
import { normalizeFoodKey, normalizeDishKey, resolveInternalFood, checkAtwaterValidity, getFallbackCategoryProfile, upsertFoodAlias, mergeFoodCatalogItems } from './server_food_catalog';
import { applyServerAverageNutrients } from './server_pure_helpers';
import { NUTRIENT_KEYS } from './src/utils/nutrients';

describe('Food Catalog Normalization & Resolution (PASS 2 - R7)', () => {
  it('normalizes mac & cheese synonyms correctly', () => {
    expect(normalizeDishKey('Mac & Cheese')).toBe('macaroni_and_cheese');
    expect(normalizeDishKey('mac and cheese')).toBe('macaroni_and_cheese');
    expect(normalizeDishKey('Mac_N_Cheese')).toBe('macaroni_and_cheese');
    expect(normalizeDishKey('macaroni cheese')).toBe('macaroni_and_cheese');
  });

  it('resolves internal canonical food items', async () => {
    const match = await resolveInternalFood('Chicken Breast');
    expect(match).not.toBeNull();
    expect(match?.food_key).toBe('chicken_breast');
    expect(match?.source).toBe('canonical_local');
    expect(match?.nutrients_per_100g.protein).toBeGreaterThan(20);

    const cobbMatch = await resolveInternalFood('Cobb Salad');
    expect(cobbMatch).not.toBeNull();
    expect(cobbMatch?.source).toBe('canonical_local');
    expect(cobbMatch?.fdc_id).toBe('cobb_salad_canonical');

    const caesarMatch = await resolveInternalFood('Caesar Dressing');
    expect(caesarMatch).not.toBeNull();
    expect(caesarMatch?.source).toBe('canonical_local');
    expect(caesarMatch?.nutrients_per_100g.totalFat).toBeGreaterThan(40);

    const balsamicMatch = await resolveInternalFood('Balsamic Vinaigrette');
    expect(balsamicMatch).not.toBeNull();
    expect(balsamicMatch?.source).toBe('canonical_local');
    expect(balsamicMatch?.nutrients_per_100g.calories).toBeGreaterThan(200);
  });

  it('normalizes arbitrary food names consistently', () => {
    expect(normalizeFoodKey('  Granola Fruit Cup! ')).toBe('granola_fruit_cup');
    expect(normalizeFoodKey('Whole-Wheat Bread')).toBe('whole_wheat_bread');
  });

  it('validates Atwater macronutrient-to-calorie consistency', () => {
    // Valid item: 10g P (40cal) + 20g C (80cal) + 5g F (45cal) = 165 cal stated vs 165 cal calculated
    const valid = checkAtwaterValidity({ calories: 165, protein: 10, carbohydrates: 20, totalFat: 5 });
    expect(valid.valid).toBe(true);

    // Invalid item: stated 500 cal vs calculated (10*4 + 20*4 + 5*9 = 165) -> ~67% diff
    const invalid = checkAtwaterValidity({ calories: 500, protein: 10, carbohydrates: 20, totalFat: 5 });
    expect(invalid.valid).toBe(false);
  });

  it('returns appropriate fallback category profiles with complete NUTRIENT_KEYS set', () => {
    const poultryProfile = getFallbackCategoryProfile('grilled chicken breast');
    expect(poultryProfile.protein).toBe(31);

    // Verify all NUTRIENT_KEYS are present in fallback profile
    NUTRIENT_KEYS.forEach(key => {
      expect(poultryProfile).toHaveProperty(key);
      expect(typeof poultryProfile[key]).toBe('number');
    });

    const beverageProfile = getFallbackCategoryProfile('black tea drink');
    expect(beverageProfile.calories).toBe(0);

    const produceProfile = getFallbackCategoryProfile('fresh apple slice');
    expect(produceProfile.carbohydrates).toBe(9);

    const pickleProfile = getFallbackCategoryProfile('dill pickle spear');
    expect(pickleProfile.calories).toBeLessThanOrEqual(45);
    expect(pickleProfile.sodium).toBeGreaterThan(500);

    const crispyShallotProfile = getFallbackCategoryProfile('crispy shallots garnish');
    expect(crispyShallotProfile.calories).toBeGreaterThan(450);
    expect(crispyShallotProfile.totalFat).toBeGreaterThan(30);
  });

  it('supports alias creation via upsertFoodAlias', async () => {
    const result = await upsertFoodAlias({
      alias_key: 'test_custom_alias',
      food_key: 'chicken_breast',
      source: 'manual_test'
    });
    expect(result.success).toBe(true);
  });

  it('calculates average nutrients for comparison groups correctly via applyServerAverageNutrients', () => {
    const groups = [
      { groupName: 'Group A', scoutItemIndices: [0, 1] }
    ];
    const preCalcByScoutIndex = {
      0: { calories: 100, protein: 10, totalFat: 2, carbohydrates: 15 },
      1: { calories: 200, protein: 20, totalFat: 4, carbohydrates: 25 }
    };
    const res = applyServerAverageNutrients(groups, preCalcByScoutIndex);
    expect(res[0].averageNutrients).toEqual({
      calories: 150,
      protein: 15,
      totalFat: 3,
      carbohydrates: 20
    });
  });

  it('rejects merge of incompatible food form tags in mergeFoodCatalogItems', async () => {
    const mergeRes = await mergeFoodCatalogItems({
      target_id: 'item_bar_1',
      source_id: 'item_loose_1',
      form_tags_target: ['bar'],
      form_tags_source: ['loose/cup']
    });
    expect(mergeRes.success).toBe(false);
    expect(mergeRes.error).toContain('Incompatible physical form tags');
  });
});
