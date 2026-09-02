import { describe, it, expect } from "vitest";
import {
  computeCaloriesFromMacros,
  computeUnsaturatedFat,
  computeSaltFromSodium,
  computeSolubleFibre,
  deriveCarbohydratesFromEnergy,
  calculateDerivedNutrients,
  rebalanceNutrientProfile,
  decomposeSaucedEntree,
  applyNutrientModifiers,
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

  describe("computeSolubleFibre", () => {
    it("returns 0 for zero or negative total fiber", () => {
      expect(computeSolubleFibre(0)).toBe(0);
      expect(computeSolubleFibre(null)).toBe(0);
      expect(computeSolubleFibre(-5)).toBe(0);
    });

    it("returns 0 for pure animal products", () => {
      expect(computeSolubleFibre(2, "Grilled Chicken Breast")).toBe(0);
      expect(computeSolubleFibre(3, "Salmon Fillet")).toBe(0);
      expect(computeSolubleFibre(1, "Scrambled Eggs")).toBe(0);
    });

    it("derives high soluble fiber (~38%) for oats, legumes, apples, berries, chia", () => {
      // 10g fiber in oatmeal -> 3.8g soluble fiber
      expect(computeSolubleFibre(10, "Rolled Oats Oatmeal")).toBe(3.8);
      // 8g fiber in black beans -> 3.0g soluble fiber
      expect(computeSolubleFibre(8, "Black Beans")).toBe(3.0);
      // 4g fiber in fresh apple -> 1.5g soluble fiber
      expect(computeSolubleFibre(4, "Fuji Apple")).toBe(1.5);
    });

    it("derives standard botanical soluble fiber (~28%) for cooked vegetables and mixed dishes", () => {
      // French fries (3.8g fiber) -> 1.1g soluble fiber
      expect(computeSolubleFibre(3.8, "French Fries")).toBe(1.1);
      // Water spinach (3.0g fiber) -> 0.8g soluble fiber
      expect(computeSolubleFibre(3.0, "Tumis Kangkung Water Spinach")).toBe(0.8);
      // Brownie (2.0g fiber) -> 0.6g soluble fiber
      expect(computeSolubleFibre(2.0, "Chocolate Brownie")).toBe(0.6);
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
        totalFibre: 5,
      });
      expect(result.calories).toBe(480);
      expect(result.carbohydrates).toBe(50);
      expect(result.unsaturatedFat).toBe(15);
      expect(result.salt).toBe(1.02);
      expect(result.solubleFibre).toBe(1.4);
    });

    it("ignores agent-emitted calories when protein, carbs, and fat are present (F-10.2 Atwater law)", () => {
      // Agent emitted 999 kcal, but physical macros are 20g P, 30g C, 10g F -> 4*20 + 4*30 + 9*10 = 290 kcal
      const result = calculateDerivedNutrients({
        calories: 999,
        protein: 20,
        carbohydrates: 30,
        totalFat: 10,
        saturatedFat: 3,
        transFat: 0,
        sodium: 500,
      });
      expect(result.calories).toBe(290);
      expect(result.carbohydrates).toBe(30);
      expect(result.unsaturatedFat).toBe(7);
      expect(result.salt).toBe(1.27);
    });

    it("handles zero carbs explicitly without triggering energy fallback", () => {
      // 30g P, 0g C, 10g F -> 4*30 + 4*0 + 9*10 = 210 kcal
      const result = calculateDerivedNutrients({
        calories: 999,
        protein: 30,
        carbohydrates: 0,
        totalFat: 10,
      });
      expect(result.calories).toBe(210);
      expect(result.carbohydrates).toBe(0);
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

    it('ignores agent calories when P/C/F are present (F-10.2)', () => {
      const out = calculateDerivedNutrients({
        calories: 9999, protein: 25, carbohydrates: 50, totalFat: 20,
        saturatedFat: 5, transFat: 0, sodium: 400,
      });
      expect(out.calories).toBe(480);
      expect(out.unsaturatedFat).toBe(15);
      expect(out.salt).toBeCloseTo(1.02, 2);
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

  describe("applyNutrientModifiers", () => {
    it("zeros sugar, carbs, and calories for sweet tea when user says unsweetened", () => {
      const teaNutrients = { calories: 84, protein: 0, totalFat: 0, carbohydrates: 21, sugar: 20, addedSugar: 20, sodium: 5 };
      const res = applyNutrientModifiers(teaNutrients, {
        message: "the tea is unsweatened",
        foodType: "beverage",
        name: "Sweet Iced Tea",
      });
      expect(res.updatedNutrients.calories).toBe(0);
      expect(res.updatedNutrients.carbohydrates).toBe(0);
      expect(res.updatedNutrients.sugar).toBe(0);
      expect(res.updatedNutrients.addedSugar).toBe(0);
      expect(res.lockedKeys).toContain("calories");
      expect(res.lockedKeys).toContain("sugar");
    });

    it("does NOT modify Water Spinach or vegetables when user says the tea is unsweetened", () => {
      const spinachNutrients = { calories: 43, protein: 3, totalFat: 0.8, carbohydrates: 6, sugar: 1, addedSugar: 0, sodium: 350 };
      const res = applyNutrientModifiers(spinachNutrients, {
        message: "the tea is unsweatened",
        foodType: "vegetable",
        name: "Water Spinach",
      });
      expect(res.updatedNutrients.calories).toBe(43);
      expect(res.updatedNutrients.carbohydrates).toBe(6);
      expect(res.updatedNutrients.sugar).toBe(1);
      expect(res.lockedKeys.length).toBe(0);
    });

    it("does NOT treat watercress or watermelon as beverages", () => {
      const cressNutrients = { calories: 25, protein: 2, totalFat: 0.2, carbohydrates: 4, sugar: 2, addedSugar: 0, sodium: 40 };
      const res = applyNutrientModifiers(cressNutrients, {
        message: "unsweetened please",
        name: "Watercress Salad",
      });
      expect(res.updatedNutrients.calories).toBe(25);
      expect(res.updatedNutrients.carbohydrates).toBe(4);
      expect(res.lockedKeys.length).toBe(0);
    });
  });
});


it('ignores agent calories when P/C/F are present (F-10.2)', () => {
  const out = calculateDerivedNutrients({
    calories: 9999, protein: 25, carbohydrates: 50, totalFat: 20,
    saturatedFat: 5, transFat: 0, sodium: 400,
  });
  expect(out.calories).toBe(480);
  expect(out.unsaturatedFat).toBe(15);
  expect(out.salt).toBeCloseTo(1.02, 2);
});
