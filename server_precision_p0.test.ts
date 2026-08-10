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
});
