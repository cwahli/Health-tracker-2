import { describe, it, expect } from "vitest";
import { applyNutrientRealityChecks } from "./server_pure_helpers";
import { decidePrepAddition } from "./server_prep_policy";

describe("P0 precision pack", () => {
  it("does not force pure-meat protein on Honi bowl identity", () => {
    const n: any = { calories: 600, protein: 42, totalFat: 20, saturatedFat: 4, sodium: 300, carbohydrates: 50 };
    applyNutrientRealityChecks(
      "Fish, salmon, Atlantic, farmed, cooked, dry heat",
      450,
      n,
      0,
      () => {},
      "usda",
      {
        originalName: "Honi Poke Salmon Poke Bowl",
        keyword: "salmon poke bowl",
        componentCount: 4,
        physicalForm: "COMPOUND_MEAL",
        chainName: "Honi Poke",
      }
    );
    expect(n.protein).toBe(42);
    expect(n.protein).toBeLessThan(90);
  });

  it("still can adjust true single fish fillet with low protein", () => {
    const n: any = { calories: 100, protein: 5, totalFat: 2, saturatedFat: 0.5, sodium: 50, carbohydrates: 0 };
    applyNutrientRealityChecks("Salmon fillet", 200, n, 0, () => {}, "usda", {
      originalName: "Salmon fillet",
      componentCount: 0,
    });
    // pure single fish may be raised toward ~22g/100g
    expect(n.protein).toBeGreaterThan(5);
  });

  it("composite prep oil remains zero", () => {
    const r = decidePrepAddition({
      weightGrams: 450,
      cookingMethod: "baked",
      dishName: "Honi Poke Salmon Poke Bowl",
      componentCount: 4,
      diningEnvironment: "fast_food_chain",
      cookingAdded: { addedCalories: 227, addedFat: 25, addedSaturatedFat: 5, addedSodium: 126 },
    });
    expect(r.addedCalories).toBe(0);
  });

  it("enforces mass conservation guard when macro sum exceeds item weight", () => {
    const n: any = { calories: 717, protein: 0.9, totalFat: 81.1, saturatedFat: 51.4, sodium: 643, carbohydrates: 0 };
    applyNutrientRealityChecks(
      "Anchor Butter Packet",
      10,
      n,
      0,
      () => {},
      "usda",
      {
        originalName: "Anchor Butter Packet",
        componentCount: 0,
      }
    );
    expect(n.totalFat).toBeLessThanOrEqual(10);
    expect(n.saturatedFat).toBeLessThanOrEqual(n.totalFat);
    expect(n.protein + n.carbohydrates + n.totalFat).toBeLessThanOrEqual(10);
    expect(n.calories).toBeLessThanOrEqual(100);
  });

  it("synchronizes saturated fat and sugar when macros are rescaled under Atwater check", () => {
    const n: any = { calories: 130, protein: 9, totalFat: 3.2, saturatedFat: 2.0, sodium: 220, carbohydrates: 49 };
    applyNutrientRealityChecks(
      "Airline Bread Roll",
      45,
      n,
      0,
      () => {},
      "usda",
      {
        originalName: "Airline Bread Roll",
        componentCount: 0,
      }
    );
    expect(n.carbohydrates).toBeLessThanOrEqual(45);
    expect(n.totalFat).toBeLessThanOrEqual(45);
    expect(n.saturatedFat).toBeLessThanOrEqual(n.totalFat);
  });
});
