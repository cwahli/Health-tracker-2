import { describe, it, expect } from "vitest";
import { finalizeDishLedger } from "./server_dish_finalize";

describe("server_dish_finalize", () => {
  it("scales scout baseline nutrients proportionally by R (consumedWeight / nutrientBasisWeight)", async () => {
    const item = {
      scoutIndex: 0,
      originalName: "Grilled Chicken Salad",
      keyword: "chicken salad",
      estimatedWeightGrams: 300,
      nutrientBasisWeight: 300,
      nutrients: {
        calories: 400,
        protein: 30,
        totalFat: 20,
        saturatedFat: 4,
        transFat: 0,
        carbohydrates: 25,
        sodium: 600,
      },
    };

    // User eats 150g (half portion)
    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 300,
      consumedWeight: 150,
    });

    expect(ledger.weightGrams).toBe(150);
    expect(ledger.nutrients.calories).toBe(200);
    expect(ledger.nutrients.protein).toBe(15);
    expect(ledger.nutrients.totalFat).toBe(10);
    expect(ledger.nutrients.saturatedFat).toBe(2);
    expect(ledger.nutrients.carbohydrates).toBe(12.5);
    expect(ledger.nutrients.sodium).toBe(300);
    expect(ledger.nutrients.unsaturatedFat).toBe(8); // 10 - (2 + 0)
    expect(ledger.nutrients.salt).toBe(0.76); // 300 * 2.54 / 1000
    expect(ledger.dbSource).toBe("estimated");
  });

  it("handles standalone condiment cap: scales nutrients once based on post-cap weight", async () => {
    // 80g mayo with nutrients estimated for the 80g portion, capped to 30g
    const item = {
      scoutIndex: 0,
      originalName: "Heinz Mayonnaise",
      keyword: "mayo",
      estimatedWeightGrams: 30,
      nutrientBasisWeight: 80,
      nutrients: {
        calories: 540,
        protein: 1,
        totalFat: 58,
        saturatedFat: 4.5,
        transFat: 0,
        carbohydrates: 2,
        sodium: 400,
      },
    };

    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 80,
      consumedWeight: 30,
    });

    expect(ledger.weightGrams).toBe(30);
    // 540 * (30 / 80) = 202.5 -> 203
    expect(ledger.nutrients.calories).toBe(203);
    expect(ledger.nutrients.totalFat).toBe(21.8); // 58 * 30/80 = 21.75 -> 21.8
  });

  it("locks OCR label nutrition when rawNutritionLabel is present", async () => {
    const item = {
      scoutIndex: 0,
      originalName: "Protein Muffin",
      keyword: "muffin",
      estimatedWeightGrams: 85,
      rawNutritionLabel: {
        calories: "154",
        protein: "16.2g",
        totalFat: "8.5g",
        saturatedFat: "2.1g",
        carbohydrates: "3.2g",
        sodium: "250mg",
        basisType: "per_dish",
      },
    };

    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 85,
      consumedWeight: 85,
    });

    expect(ledger.dbSource).toBe("label");
    expect(ledger.nutrients.calories).toBe(154);
    expect(ledger.nutrients.protein).toBe(16.2);
    expect(ledger.nutrients.totalFat).toBe(8.5);
    expect(ledger.lockedNutrientKeys).toContain("calories");
    expect(ledger.lockedNutrientKeys).toContain("protein");
  });

  it("scales stored brand lock correctly on portion edit (D8) without re-fetching whole dish", async () => {
    // 350g Yolk sandwich with 760 kcal locked
    const storedBrandLock = {
      id: "yolk_chimi_sandwich",
      basisType: "per_dish",
      servingGrams: 350,
      keys: ["calories", "protein", "totalFat"],
      valuesAtBasis: {
        calories: 760,
        protein: 38,
        totalFat: 32,
      },
    };

    const item = {
      scoutIndex: 0,
      originalName: "YOLK Steak Chimi 2.0 Sandwich",
      keyword: "steak sandwich",
      estimatedWeightGrams: 175, // user edited weight to half
      nutrientBasisWeight: 350,
    };

    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 350,
      consumedWeight: 175,
      storedBrandLock,
    });

    expect(ledger.dbSource).toBe("brand_official");
    expect(ledger.weightGrams).toBe(175);
    expect(ledger.nutrients.calories).toBe(380); // 760 * 0.5
    expect(ledger.nutrients.protein).toBe(19); // 38 * 0.5
    expect(ledger.nutrients.totalFat).toBe(16); // 32 * 0.5
    expect(ledger.lockedNutrientKeys).toContain("calories");
  });

  it("computes Atwater flag when carbohydrates is present and flags if discrepancy > 35%", async () => {
    // Bad scout estimate: 1000 kcal with only 10g P, 10g C, 10g F (170 kcal actual)
    const item = {
      scoutIndex: 0,
      originalName: "Mystery Dish",
      estimatedWeightGrams: 200,
      nutrients: {
        calories: 1000,
        protein: 10,
        totalFat: 10,
        carbohydrates: 10,
        sodium: 200,
      },
    };

    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 200,
      consumedWeight: 200,
    });

    expect(ledger.atwaterFlag).not.toBeNull();
    expect(ledger.atwaterFlag?.flagged).toBe(true);
    // Atwater is flagged but does NOT destructively rescale calories
    expect(ledger.nutrients.calories).toBe(1000);
  });

  it("derives carbohydrates from energy without flagging Atwater if C is missing", async () => {
    // 500 kcal, 25g P, 20g F -> carbs missing
    const item = {
      scoutIndex: 0,
      originalName: "Chicken Rice Bowl",
      estimatedWeightGrams: 300,
      nutrients: {
        calories: 500,
        protein: 25,
        totalFat: 20,
        sodium: 500,
      },
    };

    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 300,
      consumedWeight: 300,
    });

    expect(ledger.nutrients.carbohydrates).toBe(55); // (500 - 100 - 180) / 4 = 55
    expect(ledger.atwaterFlag).toBeNull();
  });
});
