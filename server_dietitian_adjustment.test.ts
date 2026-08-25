import { describe, it, expect } from "vitest";
import { rebalanceNutrientProfile, applyNutrientModifiers } from "./server_derivation";

describe("Dietitian Clinical Adjustment & Weight Calibration", () => {
  const NUTRIENT_KEYS = [
    'calories', 'protein', 'totalFat', 'saturatedFat', 'transFat', 'unsaturatedFat',
    'carbohydrates', 'sugar', 'addedSugar', 'totalFibre', 'sodium', 'potassium', 'salt'
  ];

  function simulateDietitianInjection(preMatch: any, dietitianItem: any) {
    const weight = dietitianItem.weightGrams;
    const originalBasisWeight = Number(preMatch.estimatedWeightGrams || preMatch.weightGrams || preMatch.nutrientBasisWeight || weight);
    const weightScaleFactor = (originalBasisWeight > 0 && Math.abs(weight - originalBasisWeight) > 0.01)
      ? (weight / originalBasisWeight)
      : 1.0;

    const n = { ...preMatch.nutrients };
    if (weightScaleFactor !== 1.0) {
      NUTRIENT_KEYS.forEach(k => {
        if (n[k] !== undefined && n[k] !== null && Number.isFinite(Number(n[k]))) {
          n[k] = Number(((Number(n[k])) * weightScaleFactor).toFixed(2));
        }
      });
    }

    if (dietitianItem.correctedNutrients && typeof dietitianItem.correctedNutrients === 'object') {
      Object.entries(dietitianItem.correctedNutrients).forEach(([k, v]) => {
        if (v !== null && v !== undefined && Number.isFinite(Number(v))) {
          n[k] = Number(v);
        }
      });
      // Pure TS rebalancing: recalculates Calories (4P+4C+9F), Unsat Fat, Salt, and density bounds
      const rebalanced = rebalanceNutrientProfile(n, weight);
      Object.assign(n, rebalanced);
    }

    const scale = 100 / weight;
    const injectedLabel: Record<string, number> = { servingSizeGrams: 100 };
    NUTRIENT_KEYS.forEach(k => {
      injectedLabel[k] = parseFloat(((n[k] || 0) * scale).toFixed(2));
    });

    return {
      ...dietitianItem,
      weightGrams: weight,
      syntheticBase100g: injectedLabel,
      truthNutrients: n,
      nutrients: n,
      clinicalCorrectionNote: dietitianItem.clinicalCorrectionNote || null
    };
  }

  it("calibrates portion weight and proportionally scales baseline macros", () => {
    const preMatch = {
      scoutIndex: 1,
      originalName: "SIOMAY",
      keyword: "steamed chicken dumplings",
      estimatedWeightGrams: 150,
      nutrients: {
        calories: 280,
        protein: 16,
        totalFat: 10,
        saturatedFat: 3,
        carbohydrates: 30,
        sugar: 1,
        addedSugar: 0,
        totalFibre: 1,
        sodium: 520,
        potassium: 150
      }
    };

    const dietitianItem = {
      scoutIndex: 1,
      canonicalDbName: "steamed chicken dumplings",
      weightGrams: 100,
      dbSource: "estimated"
    };

    const finalized = simulateDietitianInjection(preMatch, dietitianItem);

    expect(finalized.weightGrams).toBe(100);
    expect(finalized.nutrients.calories).toBe(186.67);
    expect(finalized.nutrients.protein).toBe(10.67);
    expect(finalized.nutrients.totalFat).toBe(6.67);
    expect(finalized.nutrients.sodium).toBe(346.67);
  });

  it("applies clinical corrections and rebalances dependent metrics (Calories = 4P+4C+9F, Unsat Fat, Salt)", () => {
    const preMatch = {
      scoutIndex: 1,
      originalName: "Fried Fish Fillet",
      keyword: "fried fish",
      estimatedWeightGrams: 200,
      nutrients: {
        protein: 24,
        carbohydrates: 20,
        totalFat: 12,
        saturatedFat: 2.5,
        transFat: 0,
        sodium: 400,
      }
    };

    // Dietitian observes deep-fried oil absorption undercounted -> adjusts totalFat to 22g and satFat to 5g
    const dietitianItem = {
      scoutIndex: 1,
      canonicalDbName: "Fried Fish Fillet",
      weightGrams: 200,
      dbSource: "estimated",
      correctedNutrients: {
        totalFat: 22,
        saturatedFat: 5,
        sodium: 600,
      },
      clinicalCorrectionNote: "Increased total fat by 10g for batter oil absorption and updated sodium."
    };

    const finalized = simulateDietitianInjection(preMatch, dietitianItem);

    expect(finalized.weightGrams).toBe(200);
    expect(finalized.nutrients.totalFat).toBe(22);
    expect(finalized.nutrients.saturatedFat).toBe(5);
    expect(finalized.nutrients.unsaturatedFat).toBe(17); // 22 - 5 = 17
    expect(finalized.nutrients.sodium).toBe(600);
    expect(finalized.nutrients.salt).toBe(1.52); // (600 * 2.54) / 1000 = 1.52
    // Bottom-Up Calories automatically recalculated: 4(24) + 4(20) + 9(22) = 96 + 80 + 198 = 374 kcal!
    expect(finalized.nutrients.calories).toBe(374);
    expect(finalized.clinicalCorrectionNote).toContain("batter oil absorption");
  });

  it("handles unsweetened beverage edits via universal applyNutrientModifiers", () => {
    const teaNutrients = {
      protein: 0,
      carbohydrates: 18,
      totalFat: 0,
      saturatedFat: 0,
      transFat: 0,
      sugar: 18,
      addedSugar: 18,
      sodium: 5,
      calories: 72
    };

    const res = applyNutrientModifiers(teaNutrients, {
      message: "My tea was unsweatened",
      foodType: "beverage",
      name: "Iced Tea"
    });

    expect(res.updatedNutrients.sugar).toBe(0);
    expect(res.updatedNutrients.addedSugar).toBe(0);
    expect(res.updatedNutrients.carbohydrates).toBe(0);
    expect(res.updatedNutrients.calories).toBe(0);
    expect(res.lockedKeys).toContain("sugar");
    expect(res.lockedKeys).toContain("calories");
  });

  it("handles zero-sodium and oil-free modifiers universally without food-specific hardcoding", () => {
    const dishNutrients = {
      protein: 25,
      carbohydrates: 10,
      totalFat: 20,
      saturatedFat: 6,
      transFat: 0,
      sodium: 850,
      calories: 320
    };

    // User says "no salt and steamed without oil"
    const res = applyNutrientModifiers(dishNutrients, {
      message: "Cooked with no salt and steamed without oil",
      foodType: "protein",
      name: "Chicken Breast"
    });

    expect(res.updatedNutrients.sodium).toBe(0);
    expect(res.updatedNutrients.salt).toBe(0);
    expect(res.updatedNutrients.totalFat).toBe(6); // 20 * 0.3 = 6
    // Recalculated Calories bottom up: 4(25) + 4(10) + 9(6) = 100 + 40 + 54 = 194 kcal!
    expect(res.updatedNutrients.calories).toBe(194);
    expect(res.lockedKeys).toContain("sodium");
    expect(res.lockedKeys).toContain("totalFat");
  });
});


