import { describe, it, expect } from "vitest";
import { applyNutrientModifiers, computeCaloriesFromMacros, rebalanceNutrientProfile } from "../server_derivation";
import { finalizeDishLedger } from "../server_dish_finalize";
import { checkIfItemIsAlreadyPrepared } from "../server_pure_helpers";

describe("Edit Mode End-to-End Continuity & Aggregation Engine", () => {
  const initialMeal = {
    id: "meal_fish_chips_1",
    name: "Fried Fish Fillet with Wedges, Salad and Iced Tea",
    diningEnvironment: "restaurant",
    itemsBreakdown: [
      {
        scoutIndex: 0,
        name: "Fried Fish Fillet",
        originalName: "Fried Fish Fillet",
        keyword: "fried fish",
        weightGrams: 220,
        foodType: "fish_lean",
        isDishEstimate: true,
        dbSource: "estimated",
        nutrients: {
          protein: 34,
          carbohydrates: 18,
          totalFat: 14,
          saturatedFat: 3,
          transFat: 0,
          sugar: 0,
          addedSugar: 0,
          sodium: 580,
          calories: 334,
        }
      },
      {
        scoutIndex: 1,
        name: "Potato Wedges",
        originalName: "Potato Wedges",
        keyword: "potato wedges",
        weightGrams: 120,
        foodType: "prepared dish",
        isDishEstimate: true,
        dbSource: "estimated",
        nutrients: {
          protein: 3,
          carbohydrates: 30,
          totalFat: 7,
          saturatedFat: 1,
          transFat: 0,
          sugar: 1,
          addedSugar: 0,
          sodium: 320,
          calories: 195,
        }
      },
      {
        scoutIndex: 2,
        name: "Side Salad w/ Tartar",
        originalName: "Side Salad w/ Tartar",
        keyword: "salad",
        weightGrams: 60,
        foodType: "salad",
        isDishEstimate: true,
        dbSource: "estimated",
        nutrients: {
          protein: 1,
          carbohydrates: 4,
          totalFat: 6,
          saturatedFat: 1,
          transFat: 0,
          sugar: 2,
          addedSugar: 0,
          sodium: 210,
          calories: 74,
        }
      },
      {
        scoutIndex: 3,
        name: "Iced Tea",
        originalName: "Iced Tea",
        keyword: "iced tea",
        weightGrams: 300,
        foodType: "beverage",
        isDishEstimate: true,
        dbSource: "estimated",
        nutrients: {
          protein: 0,
          carbohydrates: 18,
          totalFat: 0,
          saturatedFat: 0,
          transFat: 0,
          sugar: 18,
          addedSugar: 18,
          sodium: 5,
          calories: 72,
        }
      }
    ]
  };

  it("Scenario 1: User says 'My tea was unsweatened' -> zeroes drink sugar/carbs/cal, preserves non-edited dishes without phantom fats", async () => {
    // 1. Inherit items from activeMeal
    const visionScoutItems = initialMeal.itemsBreakdown.map((it, idx) => ({
      scoutIndex: it.scoutIndex ?? idx,
      originalName: it.originalName || it.name,
      keyword: it.keyword,
      estimatedWeightGrams: it.weightGrams,
      nutrientBasisWeight: it.weightGrams,
      nutrients: { ...it.nutrients },
      foodType: it.foodType,
      isDishEstimate: true,
      dbSource: it.dbSource,
    }));

    // 2. Run finalizeDishLedger for all items
    const ledgers = await Promise.all(
      visionScoutItems.map(async (vItem, vIdx) => {
        return finalizeDishLedger({
          item: { ...vItem, scoutIndex: vItem.scoutIndex ?? vIdx },
          nutrientBasisWeight: vItem.nutrientBasisWeight || vItem.estimatedWeightGrams,
          consumedWeight: vItem.estimatedWeightGrams,
        });
      })
    );

    const preCalculatedItems = ledgers.map(l => ({
      scoutIndex: l.scoutIndex,
      originalName: l.originalName,
      keyword: l.keyword,
      foodType: l.dishClass,
      estimatedWeightGrams: l.weightGrams,
      nutrients: l.nutrients,
      lockedNutrientKeys: l.lockedNutrientKeys || [],
    }));

    // 3. Apply universal Nutrient Modifier Matrix
    const userMessage = "My tea was unsweatened";
    preCalculatedItems.forEach((pItem) => {
      const modRes = applyNutrientModifiers(pItem.nutrients, {
        message: userMessage,
        foodType: pItem.foodType,
        name: pItem.originalName || pItem.keyword,
      });
      pItem.nutrients = modRes.updatedNutrients;
      if (modRes.lockedKeys.length > 0) {
        pItem.lockedNutrientKeys = Array.from(new Set([...pItem.lockedNutrientKeys, ...modRes.lockedKeys]));
      }
    });

    // Verify Iced Tea numbers
    const tea = preCalculatedItems.find(it => it.originalName === "Iced Tea");
    expect(tea).toBeDefined();
    expect(tea?.nutrients.sugar).toBe(0);
    expect(tea?.nutrients.addedSugar).toBe(0);
    expect(tea?.nutrients.carbohydrates).toBe(0);
    expect(tea?.nutrients.calories).toBe(0);
    expect(tea?.lockedNutrientKeys).toContain("sugar");
    expect(tea?.lockedNutrientKeys).toContain("calories");

    // Verify non-edited items preserved exact initial nutrients without phantom fat
    const fish = preCalculatedItems.find(it => it.originalName === "Fried Fish Fillet");
    expect(fish?.nutrients.totalFat).toBe(14);
    expect(fish?.nutrients.calories).toBe(334);

    const wedges = preCalculatedItems.find(it => it.originalName === "Potato Wedges");
    expect(wedges?.nutrients.totalFat).toBe(7);
    expect(wedges?.nutrients.calories).toBe(195);

    // Verify Total Meal Calories dropped by exactly 72 kcal (334 + 195 + 74 + 0 = 603 vs 675)
    const totalCalories = preCalculatedItems.reduce((sum, it) => sum + it.nutrients.calories, 0);
    expect(totalCalories).toBe(603);
  });

  it("Scenario 2: User scales portion ('I only ate half the fish fillet') -> scales macros proportionally and recalculates calories bottom-up", async () => {
    const origFish = initialMeal.itemsBreakdown[0];
    const newWeight = 110; // Half of 220g

    const finalized = await finalizeDishLedger({
      item: {
        ...origFish,
        estimatedWeightGrams: newWeight,
        nutrientBasisWeight: origFish.weightGrams, // 220g
        nutrients: { ...origFish.nutrients },
      },
      nutrientBasisWeight: origFish.weightGrams,
      consumedWeight: newWeight,
    });

    expect(finalized.weightGrams).toBe(110);
    expect(finalized.nutrients.protein).toBe(17); // 34 * 0.5 = 17
    expect(finalized.nutrients.carbohydrates).toBe(9); // 18 * 0.5 = 9
    expect(finalized.nutrients.totalFat).toBe(7); // 14 * 0.5 = 7
    expect(finalized.nutrients.sodium).toBe(290); // 580 * 0.5 = 290
    // Recalculated bottom-up: 4(17) + 4(9) + 9(7) = 68 + 36 + 63 = 167 kcal
    expect(finalized.nutrients.calories).toBe(167);
  });

  it("Scenario 3: Prepared dish immunity in aggregator -> checkIfItemIsAlreadyPrepared returns true for prepared dishes", () => {
    // Fried fish fillet is a prepared dish
    const isFishPrepared = checkIfItemIsAlreadyPrepared("Fried Fish Fillet", "fried fish", "estimated");
    expect(isFishPrepared).toBe(true);

    // Potato wedges is a prepared dish
    const isWedgesPrepared = checkIfItemIsAlreadyPrepared("Potato Wedges", "potato wedges", "estimated");
    expect(isWedgesPrepared).toBe(true);

    // Side salad is a prepared dish
    const isSaladPrepared = checkIfItemIsAlreadyPrepared("Side Salad w/ Tartar", "salad", "estimated");
    expect(isSaladPrepared).toBe(true);
  });

  it("Scenario 4: User requests multiple modifiers ('no salt and steamed without oil') -> zeroes sodium and removes cooking fats", () => {
    const chickenItem = {
      protein: 30,
      carbohydrates: 0,
      totalFat: 15,
      saturatedFat: 4,
      transFat: 0,
      sodium: 700,
      calories: 255,
    };

    const res = applyNutrientModifiers(chickenItem, {
      message: "Cooked with no salt and steamed without oil",
      foodType: "poultry",
      name: "Chicken Breast"
    });

    expect(res.updatedNutrients.sodium).toBe(0);
    expect(res.updatedNutrients.salt).toBe(0);
    expect(res.updatedNutrients.totalFat).toBe(4.5); // 15 * 0.3 = 4.5
    // Recalculated Calories: 4(30) + 4(0) + 9(4.5) = 120 + 40.5 = 161 kcal
    expect(res.updatedNutrients.calories).toBe(161);
    expect(res.lockedKeys).toContain("sodium");
    expect(res.lockedKeys).toContain("totalFat");
    expect(res.lockedKeys).toContain("calories");
  });
});
