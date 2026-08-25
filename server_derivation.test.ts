import { describe, it, expect } from "vitest";
import {
  computeCaloriesFromMacros,
  computeUnsaturatedFat,
  computeSaltFromSodium,
  deriveCarbohydratesFromEnergy,
  calculateDerivedNutrients,
  rebalanceNutrientProfile,
  decomposeSaucedEntree,
} from "./server_derivation";

describe("server_derivation", () => {
  describe("computeCaloriesFromMacros", () => {
    it("computes exact bottom-up calories using 4P + 4C + 9F", () => {
      // 25g P (100) + 50g C (200) + 20g F (180) = 480 kcal
      expect(computeCaloriesFromMacros(25, 50, 20)).toBe(480);
      // Lean steak: 35g P (140) + 0g C (0) + 10g F (90) = 230 kcal
      expect(computeCaloriesFromMacros(35, 0, 10)).toBe(230);
    });

    it("handles null/undefined gracefully", () => {
      expect(computeCaloriesFromMacros(null, null, null)).toBe(0);
      expect(computeCaloriesFromMacros(10, null, 5)).toBe(85);
    });
  });

  describe("computeUnsaturatedFat", () => {
    it("correctly computes unsaturated fat from total, sat, and trans", () => {
      expect(computeUnsaturatedFat(14, 4.5, 0.5)).toBe(9);
      expect(computeUnsaturatedFat(20, 5, 0)).toBe(15);
    });

    it("clamps negative values to 0", () => {
      expect(computeUnsaturatedFat(5, 6, 0)).toBe(0);
      expect(computeUnsaturatedFat(0, 5, 0)).toBe(0);
    });

    it("handles null/undefined gracefully", () => {
      expect(computeUnsaturatedFat(null, null, null)).toBe(0);
      expect(computeUnsaturatedFat(10, null, undefined)).toBe(10);
    });
  });

  describe("computeSaltFromSodium", () => {
    it("correctly converts sodium mg to salt g (mg * 2.54 / 1000)", () => {
      expect(computeSaltFromSodium(1000)).toBe(2.54);
      expect(computeSaltFromSodium(500)).toBe(1.27);
      expect(computeSaltFromSodium(0)).toBe(0);
    });

    it("handles null/undefined gracefully", () => {
      expect(computeSaltFromSodium(null)).toBe(0);
    });
  });

  describe("deriveCarbohydratesFromEnergy", () => {
    it("derives carbs using (kcal - 4P - 9F) / 4", () => {
      // 500 kcal, 25g P (100 kcal), 20g F (180 kcal) -> 220 kcal carbs -> 55g carbs
      expect(deriveCarbohydratesFromEnergy(500, 25, 20)).toBe(55);
    });

    it("clamps negative carbs to 0", () => {
      // 100 kcal, 30g P (120 kcal), 10g F (90 kcal) -> negative -> 0
      expect(deriveCarbohydratesFromEnergy(100, 30, 10)).toBe(0);
    });
  });

  describe("calculateDerivedNutrients", () => {
    it("calculates bottom-up calories and preserves explicit carbs", () => {
      const result = calculateDerivedNutrients({
        protein: 25,
        totalFat: 20,
        saturatedFat: 5,
        transFat: 0,
        sodium: 400,
        carbohydrates: 50,
      });
      expect(result.calories).toBe(480);
      expect(result.carbohydrates).toBe(50);
      expect(result.unsaturatedFat).toBe(15);
      expect(result.salt).toBe(1.02);
    });

    it("derives carbohydrates if omitted or null", () => {
      const result = calculateDerivedNutrients({
        calories: 500,
        protein: 25,
        totalFat: 20,
        saturatedFat: 5,
        transFat: 0,
        sodium: 400,
        carbohydrates: null,
      });
      expect(result.carbohydrates).toBe(55);
      expect(result.unsaturatedFat).toBe(15);
      expect(result.salt).toBe(1.02);
    });
  });

  describe("rebalanceNutrientProfile", () => {
    it("recalculates calories and dependent metrics when macros are updated", () => {
      const input = {
        protein: 30,
        carbohydrates: 40,
        totalFat: 15,
        saturatedFat: 5,
        transFat: 0,
        sodium: 800,
      };
      const result = rebalanceNutrientProfile(input, 200);
      expect(result.calories).toBe(415); // (4*30) + (4*40) + (9*15) = 120 + 160 + 135 = 415
      expect(result.unsaturatedFat).toBe(10);
      expect(result.salt).toBe(2.03);
    });

    it("clamps excessive carbs to physical density maximum if weight is provided", () => {
      const input = {
        protein: 10,
        carbohydrates: 300, // impossible on a 100g item
        totalFat: 5,
      };
      const result = rebalanceNutrientProfile(input, 100);
      expect(result.carbohydrates).toBe(95); // clamped to 100 * 0.95 = 95
      expect(result.calories).toBe(465); // (4*10) + (4*95) + (9*5) = 40 + 380 + 45 = 465
    });
  });

  describe("decomposeSaucedEntree", () => {
    it("decomposes sauced protein dishes and bounds protein to biological meat capacity", () => {
      // 250g steak with black pepper sauce, estimated 42g protein
      // 250g * 60% = 150g net solid meat. Max protein = (150 * 0.24) + (100 * 0.015) = 36 + 1.5 = 37.5g
      const result = decomposeSaucedEntree("Sizzling Steak with Black Pepper Sauce", 250, 42);
      expect(result.netSolidWeightGrams).toBe(150);
      expect(result.netSauceWeightGrams).toBe(100);
      expect(result.boundedProtein).toBe(37.5);
    });

    it("passes through non-sauced or normal protein dishes without adjustment", () => {
      const result = decomposeSaucedEntree("Grilled Salmon Fillet", 180, 36);
      expect(result.netSolidWeightGrams).toBe(180);
      expect(result.netSauceWeightGrams).toBe(0);
      expect(result.boundedProtein).toBe(36);
    });
  });
});


