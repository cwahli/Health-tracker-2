import { describe, it, expect } from 'vitest';
import { classifyUniversalPhysicalFormV3 } from './server_matching_engine';
import { aggregateItemsNutrients } from './server_nutrient_aggregation';

describe('server_honi_poke_prep golden regression', () => {
  it('classifies Honi Poke bowl with 4 components as COMPOUND_MEAL', () => {
    const classification = classifyUniversalPhysicalFormV3({
      name: 'Honi Poke Salmon Poke Bowl',
      keyword: 'Honi Poke Salmon Poke Bowl with Quinoa and Edamame',
      components: ['Glazed Salmon', 'Quinoa', 'Edamame', 'Cabbage Slaw'],
    });

    expect(classification.physicalForm).toBe('COMPOUND_MEAL');
  });

  it('aggregates multi-component bowl without double-counting +227 prep calories', () => {
    const mockHoniItem = {
      scoutIndex: 0,
      name: 'Honi Poke Salmon Poke Bowl',
      originalName: 'Honi Poke Salmon Poke Bowl',
      keyword: 'Honi Poke Salmon Poke Bowl',
      chainName: 'Honi Poke',
      cookingMethod: 'baked',
      weightGrams: 450,
      foodType: 'compound_meal',
      diningEnvironment: 'fast_food_chain',
      cookingAdded: { addedCalories: 227, addedFat: 25, addedSaturatedFat: 5, addedSodium: 126 },
      components: [
        { name: 'Glazed Salmon', volumePercentage: 30, calories: 250, protein: 22, totalFat: 14, saturatedFat: 3, sodium: 300, carbohydrates: 2 },
        { name: 'Quinoa', volumePercentage: 40, calories: 200, protein: 7, totalFat: 3, saturatedFat: 0.5, sodium: 10, carbohydrates: 35 },
        { name: 'Edamame', volumePercentage: 15, calories: 80, protein: 8, totalFat: 3.5, saturatedFat: 0.5, sodium: 5, carbohydrates: 6 },
        { name: 'Cabbage Slaw', volumePercentage: 15, calories: 30, protein: 1, totalFat: 0.2, saturatedFat: 0, sodium: 15, carbohydrates: 6 },
      ],
      primaryBase100g: {
        calories: 124,
        protein: 8.4,
        totalFat: 4.6,
        saturatedFat: 0.8,
        sodium: 73,
      }
    };

    const result = aggregateItemsNutrients([mockHoniItem], 450, new Map(), [], () => {});

    expect(result.itemsBreakdown.length).toBe(1);
    const breakdown = result.itemsBreakdown[0];

    // chainName must be preserved
    expect(breakdown.chainName).toBe('Honi Poke');

    // Total calories should be component sum (~560), NOT component sum + 227!
    expect(breakdown.calories).toBeLessThan(700);
    expect(breakdown.calories).toBeGreaterThan(500);
  });

  it('classifies French Baguette as SOLID_GRAIN_BAKERY even if raw ingredient components exist', () => {
    const classification = classifyUniversalPhysicalFormV3({
      name: 'French Baguette',
      canonicalDbName: 'French Baguette',
      components: ['Wheat Flour', 'Water', 'Salt', 'Yeast'],
    });

    expect(classification.physicalForm).toBe('SOLID_GRAIN_BAKERY');
  });
});
