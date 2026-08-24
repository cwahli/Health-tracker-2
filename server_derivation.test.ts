import { describe, it, expect } from "vitest";
import {
  computeUnsaturatedFat,
  computeSaltFromSodium,
  deriveCarbohydratesFromEnergy,
  calculateDerivedNutrients,
} from "./server_derivation";

describe("server_derivation", () => {
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
    it("preserves emitted carbohydrates if provided", () => {
      const result = calculateDerivedNutrients({
        calories: 500,
        protein: 25,
        totalFat: 20,
        saturatedFat: 5,
        transFat: 0,
        sodium: 400,
        carbohydrates: 50, // explicit
      });
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
});
