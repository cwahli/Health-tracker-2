import { describe, it, expect } from "vitest";
import { compileMealState, mintItemId, detectTextInteractionIntent, compileComparisonOptionSet, MealState, StructuralOp } from "../server_meal_compiler";

describe("compileMealState (Code State Compiler Architecture)", () => {
  const sampleInitialState: MealState = {
    stateVersion: 1,
    itemsBreakdown: [
      {
        itemId: "item_fish_123",
        canonicalDbName: "white fish",
        name: "white fish",
        originalName: "cooked white fish",
        weightGrams: 150,
        cookingMethod: "boiled",
        dbSource: "usda"
      },
      {
        itemId: "item_rice_456",
        canonicalDbName: "white rice",
        name: "white rice",
        originalName: "steamed white rice",
        weightGrams: 120,
        cookingMethod: "boiled",
        dbSource: "usda"
      },
      {
        itemId: "item_salad_789",
        canonicalDbName: "garden salad",
        name: "garden salad",
        originalName: "fresh garden salad",
        weightGrams: 80,
        cookingMethod: "raw",
        dbSource: "usda"
      }
    ]
  };

  it("mints unique itemIds when itemIds are missing", () => {
    const id1 = mintItemId(undefined, 0);
    const id2 = mintItemId("", 1);
    const id3 = mintItemId("existing_id_999", 2);

    expect(id1).toMatch(/^item_\d+_0_[a-z0-9]+$/);
    expect(id2).toMatch(/^item_\d+_1_[a-z0-9]+$/);
    expect(id3).toBe("existing_id_999");
  });

  it("applies set_weight op while preserving all other items (Stage 3)", async () => {
    const ops: StructuralOp[] = [
      { op: "set_weight", targetId: "item_rice_456", weightGrams: 200 }
    ];

    const result = await compileMealState(sampleInitialState, ops);

    expect(result.success).toBe(true);
    expect(result.state).toBeDefined();
    expect(result.state?.stateVersion).toBe(2);
    expect(result.state?.itemsBreakdown).toHaveLength(3);

    // Rice weight updated
    const rice = result.state?.itemsBreakdown.find((it) => it.itemId === "item_rice_456");
    expect(rice?.weightGrams).toBe(200);

    // Fish & salad preserved untouched
    const fish = result.state?.itemsBreakdown.find((it) => it.itemId === "item_fish_123");
    const salad = result.state?.itemsBreakdown.find((it) => it.itemId === "item_salad_789");
    expect(fish?.weightGrams).toBe(150);
    expect(salad?.weightGrams).toBe(80);
  });

  it("applies remove op and preserves remaining itemIds", async () => {
    const ops: StructuralOp[] = [
      { op: "remove", targetId: "item_rice_456" }
    ];

    const result = await compileMealState(sampleInitialState, ops);

    expect(result.success).toBe(true);
    expect(result.state?.itemsBreakdown).toHaveLength(2);

    const itemIds = result.state?.itemsBreakdown.map((it) => it.itemId);
    expect(itemIds).toEqual(["item_fish_123", "item_salad_789"]);
  });

  it("applies rename op with mandatory DB rematch", async () => {
    const ops: StructuralOp[] = [
      { op: "rename", targetId: "item_fish_123", newName: "cod" }
    ];

    const result = await compileMealState(sampleInitialState, ops);

    expect(result.success).toBe(true);
    const fish = result.state?.itemsBreakdown.find((it) => it.itemId === "item_fish_123");
    expect(fish?.canonicalDbName).toBe("cod");
    expect(fish?.dbSource).toBe("estimated");
  });

  it("enforces all-or-nothing batch atomicity on stale targetId", async () => {
    const ops: StructuralOp[] = [
      { op: "set_weight", targetId: "item_fish_123", weightGrams: 200 },
      { op: "remove", targetId: "non_existent_item_999" }
    ];

    const result = await compileMealState(sampleInitialState, ops);

    expect(result.success).toBe(false);
    expect(result.clarificationRequired).toBe(true);
    expect(result.clarificationMessage).toContain("non_existent_item_999");
  });

  it("returns clarification prompt when target search is ambiguous", async () => {
    const ambiguousState: MealState = {
      stateVersion: 1,
      itemsBreakdown: [
        { itemId: "sauce_1", canonicalDbName: "soy sauce", weightGrams: 10 },
        { itemId: "sauce_2", canonicalDbName: "teriyaki sauce", weightGrams: 15 }
      ]
    };

    const ops: StructuralOp[] = [
      { op: "set_weight", targetName: "sauce", weightGrams: 30 }
    ];

    const result = await compileMealState(ambiguousState, ops);

    expect(result.success).toBe(false);
    expect(result.clarificationRequired).toBe(true);
    expect(result.clarificationMessage).toContain("multiple items matching \"sauce\"");
  });

  it("appends HIGH_SODIUM_WARNING when sodium exceeds threshold", async () => {
    const highSodiumState: MealState = {
      stateVersion: 1,
      itemsBreakdown: [
        { 
          itemId: "item_1", 
          canonicalDbName: "soy sauce", 
          weightGrams: 100,
          primaryBase100g: { calories: 50, protein: 5, totalFat: 0, saturatedFat: 0, carbohydrates: 5, addedSugar: 0, sodium: 5000 } 
        }
      ]
    };

    const ops: StructuralOp[] = [
      { op: "set_weight", targetId: "item_1", weightGrams: 100 }
    ];

    const result = await compileMealState(highSodiumState, ops);

    expect(result.success).toBe(true);
    expect(result.state?.dangerBadges).toContain("HIGH_SODIUM_WARNING");
    expect(result.state?.biomarkerStatus).toMatch(/caution|avoid/);
  });

  it("correctly classifies Mode B query vs Mode C edit intent (Stage 4)", () => {
    expect(detectTextInteractionIntent("Is broccoli safe for my chronic kidney disease?")).toBe("query");
    expect(detectTextInteractionIntent("Why is sodium high in this meal?")).toBe("query");
    expect(detectTextInteractionIntent("What are the benefits of salmon?")).toBe("query");

    expect(detectTextInteractionIntent("Correct apple juice to heineken")).toBe("edit");
    expect(detectTextInteractionIntent("Swap white rice for brown rice")).toBe("edit");
    expect(detectTextInteractionIntent("Double the broccoli")).toBe("edit");
    expect(detectTextInteractionIntent("Remove the bread roll")).toBe("edit");
  });

  it("appends visual image delta items while preserving existing active meal items (Stage 6)", async () => {
    const existingActiveMeal: MealState = {
      stateVersion: 1,
      itemsBreakdown: [
        { itemId: "item_steak_1", canonicalDbName: "grilled steak", weightGrams: 200 },
        { itemId: "item_rice_2", canonicalDbName: "steamed rice", weightGrams: 150 }
      ]
    };

    const visualDeltaOps: StructuralOp[] = [
      { op: "add", item: { canonicalDbName: "chocolate cake", weightGrams: 100 } }
    ];

    const result = await compileMealState(existingActiveMeal, visualDeltaOps);

    expect(result.success).toBe(true);
    expect(result.state?.itemsBreakdown).toHaveLength(3);

    const names = result.state?.itemsBreakdown.map((it) => it.canonicalDbName);
    expect(names).toEqual(["grilled steak", "steamed rice", "chocolate cake"]);
    expect(result.state?.itemsBreakdown[0].itemId).toBe("item_steak_1");
    expect(result.state?.itemsBreakdown[1].itemId).toBe("item_rice_2");
  });

  it("customizes target card and dynamically re-ranks Mode D options (Stage 7)", async () => {
    const optionCards = [
      {
        optionId: 1,
        optionTitle: "Option 1: Grilled Chicken",
        biomarkerStatus: "recommended" as const,
        itemsBreakdown: [{ itemId: "item_opt1", canonicalDbName: "grilled chicken", weightGrams: 150 }]
      },
      {
        optionId: 2,
        optionTitle: "Option 2: Fish Tacos",
        biomarkerStatus: "caution" as const,
        itemsBreakdown: [{ itemId: "item_opt2", canonicalDbName: "fish taco", weightGrams: 180 }]
      },
      {
        optionId: 3,
        optionTitle: "Option 3: Beef Bowl",
        biomarkerStatus: "recommended" as const,
        itemsBreakdown: [{ itemId: "item_opt3", canonicalDbName: "beef bowl", weightGrams: 200 }]
      }
    ];

    // Add 100g soy sauce to Option 3 -> triggers HIGH_SODIUM_WARNING -> flips to avoid
    const ops: StructuralOp[] = [
      {
        op: "add",
        item: {
          canonicalDbName: "soy sauce",
          weightGrams: 100,
          primaryBase100g: { calories: 50, protein: 5, totalFat: 0, saturatedFat: 0, carbohydrates: 5, addedSugar: 0, sodium: 5000 }
        }
      }
    ];

    const result = await compileComparisonOptionSet(optionCards, 3, ops);

    expect(result.success).toBe(true);
    expect(result.options).toHaveLength(3);

    // Option 1 should remain Rank 1 (recommended)
    expect(result.options?.[0].optionId).toBe(1);
    expect(result.options?.[0].rank).toBe(1);

    // Option 3 should shift down to Avoid (Rank 3) due to high sodium
    const option3Card = result.options?.find(c => c.optionId === 3);
    expect(option3Card?.biomarkerStatus).toBe("avoid");
    expect(option3Card?.dangerBadges).toContain("HIGH_SODIUM_WARNING");
    expect(option3Card?.rank).toBe(3);
  });
});
