import { describe, it, expect } from "vitest";

describe("Dietitian Clinical Adjustment & Weight Calibration", () => {
  const NUTRIENT_KEYS = [
    'calories', 'protein', 'totalFat', 'saturatedFat', 'transFat', 'unsaturatedFat',
    'carbohydrates', 'sugar', 'addedSugar', 'totalFibre', 'sodium', 'potassium'
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

  it("calibrates Siomay portion weight from 150g (3x50g) to 100g (3x33g) and proportionally scales baseline macros", () => {
    // Scout emitted Siomay at 150g with 280 kcal
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

    // Dietitian clinical review adjusts weight to 100g (regional norm: ~33g/piece for 3 pieces)
    const dietitianItem = {
      scoutIndex: 1,
      canonicalDbName: "steamed chicken dumplings",
      weightGrams: 100,
      dbSource: "estimated"
    };

    const finalized = simulateDietitianInjection(preMatch, dietitianItem);

    expect(finalized.weightGrams).toBe(100);
    // 280 * (100 / 150) = 186.67
    expect(finalized.nutrients.calories).toBe(186.67);
    // 16 * (100 / 150) = 10.67
    expect(finalized.nutrients.protein).toBe(10.67);
    // 10 * (100 / 150) = 6.67
    expect(finalized.nutrients.totalFat).toBe(6.67);
    // 520 * (100 / 150) = 346.67
    expect(finalized.nutrients.sodium).toBe(346.67);
    // 100g synthetic baseline reflects the exact 100g values
    expect(finalized.syntheticBase100g.calories).toBe(186.67);
    expect(finalized.syntheticBase100g.protein).toBe(10.67);
  });

  it("applies clinical corrections when Dietitian explicitly overrides baseline nutrients with note", () => {
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
        sodium: 520
      }
    };

    const dietitianItem = {
      scoutIndex: 1,
      canonicalDbName: "steamed chicken dumplings",
      weightGrams: 100,
      dbSource: "estimated",
      correctedNutrients: {
        calories: 180,
        protein: 12,
        totalFat: 6,
        saturatedFat: 1.8,
        sodium: 380
      },
      clinicalCorrectionNote: "Calibrated 3 pcs siomay to 100g total (33g/pc) and adjusted fat/sodium to regional fast-casual steamed chicken dumplings norm."
    };

    const finalized = simulateDietitianInjection(preMatch, dietitianItem);

    expect(finalized.weightGrams).toBe(100);
    expect(finalized.nutrients.calories).toBe(180);
    expect(finalized.nutrients.protein).toBe(12);
    expect(finalized.nutrients.totalFat).toBe(6);
    expect(finalized.nutrients.saturatedFat).toBe(1.8);
    expect(finalized.nutrients.sodium).toBe(380);
    expect(finalized.clinicalCorrectionNote).toContain("Calibrated 3 pcs siomay to 100g");
  });
});
