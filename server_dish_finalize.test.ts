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
    // Bottom-Up: 4(0.4) + 4(0.8) + 9(21.8) = 1.6 + 3.2 + 196.2 = 201 kcal
    expect(ledger.nutrients.calories).toBe(201);
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
    expect(ledger.lockedNutrientKeys).toContain("calories");
    expect(ledger.nutrients.calories).toBe(154);
    expect(ledger.nutrients.protein).toBe(16.2);
    expect(ledger.nutrients.totalFat).toBe(8.5);
    expect(ledger.nutrients.carbohydrates).toBe(3.2);
    expect(ledger.nutrients.unsaturatedFat).toBe(6.4); // 8.5 - 2.1 = 6.4
    expect(ledger.nutrients.salt).toBe(0.64); // 250 * 2.54 / 1000 = 0.635 -> 0.64
  });

  it("recognizes Gemini totalCarbohydrate alias in OCR label and scales correctly for user portion edit", async () => {
    const item = {
      scoutIndex: 0,
      originalName: "Snack Bar",
      keyword: "bar",
      estimatedWeightGrams: 50,
      rawNutritionLabel: {
        calories: "200",
        protein: "10g",
        totalFat: "8g",
        saturatedFat: "2g",
        totalCarbohydrate: "22g", // Gemini output format
        sodium: "100mg",
        basisType: "per_dish",
      },
    };

    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 50,
      consumedWeight: 100, // User edited to 100g (2x portion)
    });

    expect(ledger.dbSource).toBe("label");
    expect(ledger.weightGrams).toBe(100);
    expect(ledger.nutrients.calories).toBe(400);
    expect(ledger.nutrients.protein).toBe(20);
    expect(ledger.nutrients.totalFat).toBe(16);
    expect(ledger.nutrients.carbohydrates).toBe(44);
    expect(ledger.nutrients.salt).toBe(0.51);
  });

  it("scales stored brand lock correctly on portion edit (D8) without re-fetching whole dish", async () => {
    const item = {
      scoutIndex: 0,
      originalName: "Big Mac",
      keyword: "burger",
      chainName: "McDonald's",
      estimatedWeightGrams: 215,
      nutrients: {
        calories: 550,
        protein: 25,
        totalFat: 30,
        carbohydrates: 45,
        sodium: 1000,
        potassium: 350,
      },
    };

    const storedBrandLock = {
      id: "brand-mcd-big-mac",
      basisType: "per_dish",
      servingGrams: 215,
      keys: ["calories", "protein", "totalFat", "saturatedFat", "carbohydrates", "sodium"],
      valuesAtBasis: {
        calories: 550,
        protein: 25,
        totalFat: 30,
        saturatedFat: 10,
        carbohydrates: 45,
        sodium: 1000,
      },
      per100g: null,
    };

    const ledger = await finalizeDishLedger({
      item,
      storedBrandLock,
      nutrientBasisWeight: 215,
      consumedWeight: 107.5, // 0.5x portion
    });

    expect(ledger.dbSource).toBe("brand_official");
    expect(ledger.weightGrams).toBe(108); // Rounded
    expect(ledger.nutrients.calories).toBe(276); // 550 * 108 / 215 = 276.28 -> 276
    expect(ledger.nutrients.protein).toBe(12.6); // 25 * 108 / 215 = 12.56 -> 12.6
    expect(ledger.nutrients.totalFat).toBe(15.1); // 30 * 108 / 215 = 15.07 -> 15.1
    expect(ledger.nutrients.carbohydrates).toBe(22.6); // 45 * 108 / 215 = 22.6
    expect(ledger.nutrients.sodium).toBe(502.3); // 1000 * 108 / 215 = 502.32 -> 502.3
    // Unlocked micronutrient potassium scales by effective R (108 / 215)
    expect(ledger.nutrients.potassium).toBe(176);
  });

  it("computes bottom-up calories on estimated dishes and flags Atwater on OCR labels with discrepancy > 35%", async () => {
    // 1. Estimated dish: computes bottom-up calories
    const estimatedItem = {
      scoutIndex: 0,
      originalName: "Mystery Dish",
      estimatedWeightGrams: 200,
      nutrients: {
        protein: 10,
        totalFat: 10,
        carbohydrates: 10,
        sodium: 200,
      },
    };

    const estimatedLedger = await finalizeDishLedger({
      item: estimatedItem,
      nutrientBasisWeight: 200,
      consumedWeight: 200,
    });

    // 4(10) + 4(10) + 9(10) = 170 kcal
    expect(estimatedLedger.nutrients.calories).toBe(170);

    // 2. OCR label with high discrepancy: locks label calories and flags Atwater
    const ocrItem = {
      scoutIndex: 1,
      originalName: "Mislabeled Bar",
      estimatedWeightGrams: 100,
      rawNutritionLabel: {
        calories: "1000",
        protein: "10g",
        totalFat: "10g",
        carbohydrates: "10g",
        basisType: "per_dish",
      },
    };

    const ocrLedger = await finalizeDishLedger({
      item: ocrItem,
      nutrientBasisWeight: 100,
      consumedWeight: 100,
    });

    expect(ocrLedger.atwaterFlag).not.toBeNull();
    expect(ocrLedger.atwaterFlag?.flagged).toBe(true);
    expect(ocrLedger.nutrients.calories).toBe(1000);
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

  it("proportionally scales unprovided micronutrients by brand calorie adjustment ratio", async () => {
    // Stored brand lock provides Calories (780 kcal) and Protein (45g), but no micronutrients
    const storedBrandLock = {
      id: "brand_menu_yolk_sandwich",
      basisType: "per_dish" as const,
      servingGrams: 300,
      keys: ["calories", "protein", "totalFat"],
      valuesAtBasis: {
        calories: 780,
        protein: 45,
        totalFat: 30,
      },
    };

    // Scout estimated 650 kcal with micronutrients for a 300g portion
    const item = {
      scoutIndex: 0,
      originalName: "Yolk Chicken Sandwich",
      keyword: "chicken sandwich",
      chainName: "Yolk",
      estimatedWeightGrams: 300,
      nutrientBasisWeight: 300,
      nutrients: {
        calories: 650,
        protein: 35,
        totalFat: 25,
        sodium: 1000,
        potassium: 300,
        calcium: 150,
      },
    };

    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 300,
      consumedWeight: 300,
      storedBrandLock,
    });

    expect(ledger.dbSource).toBe("brand_official");
    expect(ledger.nutrients.calories).toBe(780);
    expect(ledger.nutrients.protein).toBe(45);
    expect(ledger.nutrients.totalFat).toBe(30);
    // Ratio = 780 / 650 = 1.2
    // Sodium: 1000 * 1.2 = 1200
    expect(ledger.nutrients.sodium).toBe(1200);
    // Potassium: 300 * 1.2 = 360
    expect(ledger.nutrients.potassium).toBe(360);
    // Calcium: 150 * 1.2 = 180
    expect(ledger.nutrients.calcium).toBe(180);
    // Derived Atwater Carbs: (780 - 4(45) - 9(30)) / 4 = (780 - 180 - 270) / 4 = 330 / 4 = 82.5
    expect(ledger.nutrients.carbohydrates).toBe(82.5);
  });

  it("canned drink with chainName and no OCR still attempts brand (honest BIND_MISS, no invented vitamin C)", async () => {
    const item = {
      scoutIndex: 0,
      originalName: "Acme Citrus Vitamin Drink",
      keyword: "vitamin drink",
      chainName: "Acme",
      estimatedWeightGrams: 330,
      nutrients: {
        protein: 0,
        carbohydrates: 25,
        totalFat: 0,
        sodium: 20,
      },
    };
    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 330,
      consumedWeight: 330,
    });
    expect(ledger.bindStatus).toBe("MISS");
    expect(ledger.dbSource).toBe("estimated");
    expect(ledger.nutrients.calories).toBe(100);
    expect(ledger.nutrients.vitaminC == null || ledger.nutrients.vitaminC === 0).toBe(true);
  });
});
