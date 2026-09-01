import { describe, it, expect } from "vitest";
import { parseAndHealVisionScout, mergeScoutItems, canMergeScoutLabelIntoFood, resolvePackageAndContextItems, reconcileIngredientsToComponents, clusterSpatialCompositeDishes } from "./server_vision_scout";

describe("server_vision_scout", () => {
  describe("mergeScoutItems", () => {
    it("should return visionItems if llmItems are empty", () => {
      const visionItems = [{ name: "item1", scoutIndex: 0 }];
      const result = mergeScoutItems(visionItems, []);
      expect(result).toEqual(visionItems);
    });

    it("should return llmItems if visionItems are empty", () => {
      const llmItems = [{ name: "item1" }];
      const result = mergeScoutItems([], llmItems);
      expect(result).toEqual(llmItems);
    });

    it("should correctly merge properties preserving rich vision metadata", () => {
      const visionItems = [
        {
          scoutIndex: 12,
          keyword: "bread",
          rawNutritionLabel: { servingSize: "50g" },
          nutritionFacts: { calories: 150 },
          ingredientsList: "wheat flour",
          boundingBox2D: [1, 2, 3, 4],
          sourceImageIndex: 0,
          source: "label"
        }
      ];

      const llmItems = [
        {
          scoutIndex: 12,
          keyword: "wheat bread", // updated keyword
          customProperty: "foo"
        }
      ];

      const merged = mergeScoutItems(visionItems, llmItems);
      expect(merged).toHaveLength(1);
      expect(merged[0].scoutIndex).toBe(12);
      expect(merged[0].keyword).toBe("wheat bread");
      expect(merged[0].customProperty).toBe("foo");
      expect(merged[0].rawNutritionLabel).toEqual({ servingSize: "50g" });
      expect(merged[0].boundingBox2D).toEqual([1, 2, 3, 4]);
    });

    it("preserves vision estimatedCalories, weight, components, and rawNutritionLabel over LLM overwrite", () => {
      const visionItems = [
        {
          scoutIndex: 0,
          keyword: "poke bowl",
          estimatedCalories: 550,
          estimatedWeightGrams: 400,
          components: [{ searchQuery: "rice", volumePercentage: 50 }],
          rawNutritionLabel: { calories: "450 kcal" },
        },
      ];
      const llmItems = [
        {
          scoutIndex: 0,
          keyword: "poke",
          estimatedCalories: 900,
          estimatedWeightGrams: 100,
          components: [],
          rawNutritionLabel: { calories: "999" },
        },
      ];
      const merged = mergeScoutItems(visionItems, llmItems);
      expect(merged).toHaveLength(1);
      expect(merged[0].estimatedCalories).toBe(550);
      expect(merged[0].estimatedWeightGrams).toBe(400);
      expect(merged[0].rawNutritionLabel).toEqual({ calories: "450 kcal" });
      expect(merged[0].components).toEqual([{ searchQuery: "rice", volumePercentage: 50 }]);
      expect(merged[0].keyword).toBe("poke");
    });

    it("falls back to LLM estimatedCalories when vision soft cal is null/undefined", () => {
      const visionItems = [{ scoutIndex: 1, estimatedCalories: undefined, estimatedWeightGrams: undefined }];
      const llmItems = [{ scoutIndex: 1, estimatedCalories: 420, estimatedWeightGrams: 300 }];
      const merged = mergeScoutItems(visionItems, llmItems);
      expect(merged[0].estimatedCalories).toBe(420);
      expect(merged[0].estimatedWeightGrams).toBe(300);
    });
  });

  describe("parseAndHealVisionScout", () => {
    it("parses standard scout output correctly", () => {
      const mockOutput = {
        recommendedMode: "new_log",
        contentType: "visual",
        cookingMethod: "deep-fried",
        items: [
          {
            keyword: "french fries",
            originalName: "Kentang Goreng",
            itemConfidence: "High",
            estimatedWeightGrams: 150,
            source: "visual",
            boundingBox2D: [100, 100, 500, 500],
            sourceImageIndex: 0
          }
        ]
      };

      const logs: string[] = [];
      const result = parseAndHealVisionScout(mockOutput, (msg) => logs.push(msg));

      expect(result.items).toHaveLength(1);
      expect(result.items[0].keyword).toBe("french fries");
      expect(result.items[0].originalName).toBe("Kentang Goreng");
      expect(result.scoutConfidenceRating).toBe("High (>90%)");
      expect(result.scoutCookingMethod).toBe("deep-fried");
      expect(result.visionScoutContentType).toBe("visual");
      expect(result.scoutRecommendedMode).toBe("new_log");
      expect(result.queriesToSearch).toHaveLength(0); // Generic items like 'french fries' without chainName shouldn't be pre-searched
      expect(result.visionScoutRanAndReturnedItems).toBe(true);
    });

    it("splits fry-fat onto components without writing Atwater kcal (finalize owns persisted calories)", () => {
      const mockOutput = {
        dishes: [
          {
            dishName: "Crispy Tofu Plate",
            estimatedWeightGrams: 250,
            cookingMethod: "deep_fried",
            dishNutrients: { protein: 20, carbohydrates: 30, totalFat: 28, saturatedFat: 5 },
            foods: [
              { foodName: "Crispy Tofu", weightGrams: 150, nutrients: { protein: 18, carbohydrates: 8, totalFat: 8 } },
              { foodName: "Seasoned Fries", weightGrams: 100, nutrients: { protein: 2, carbohydrates: 22, totalFat: 2.5 } },
            ],
          },
        ],
      };
      const result = parseAndHealVisionScout(mockOutput, () => {});
      expect(result.items).toHaveLength(1);
      const dish = result.items[0];
      const comps = dish.components || dish.componentsDetailList || [];
      expect(comps.length).toBe(2);
      const sumFat = comps.reduce((acc: number, c: any) => acc + Number(c.totalFat || 0), 0);
      expect(sumFat).toBeCloseTo(28, 0);
      expect(dish.nutrients.calories == null || dish.nutrients.calories === undefined).toBe(true);
      expect(comps.every((c: any) => c.calories == null)).toBe(true);
    });

    it("applies the fat overflow correction to raw nutrition label", () => {
      const mockOutput = {
        items: [
          {
            keyword: "butter",
            originalName: "Butter",
            rawNutritionLabel: {
              totalFat: "10g",
              saturatedFat: "12g", // Saturated fat exceeds total fat!
              calories: 120
            }
          }
        ]
      };

      const result = parseAndHealVisionScout(mockOutput, () => {});
      expect(result.items[0].rawNutritionLabel.totalFat).toBe(12); // corrected to match saturated fat
      expect(result.items[0].anomalyFlags).toContain("fat overflow corrected: totalFat increased from 10 to 12");
    });

    it("applies the algebraic healer to compute missing carbohydrates when discrepancy is within 20%", () => {
      const mockOutput = {
        items: [
          {
            keyword: "yogurt",
            originalName: "Yogurt",
            rawNutritionLabel: {
              calories: 60,
              protein: "5g",
              totalFat: "4g"
              // totalCarbohydrate omitted (missing) -> (60 - 36 - 20) / 4 = 1g
            }
          }
        ]
      };

      const result = parseAndHealVisionScout(mockOutput, () => {});
      // Discrepancy is Math.abs(56 - 60)/56 = 7.1% (<= 20%).
      // Carbs should heal to: (60 - 36 - 20) / 4 = 1g.
      expect(result.items[0].rawNutritionLabel.totalCarbohydrate).toBe(1);
    });

    it("preserves explicitly declared 0g totalFat on label without injecting non-zero fat", () => {
      const mockOutput = {
        items: [
          {
            keyword: "yakult",
            originalName: "Yakult Probiotic Drink",
            rawNutritionLabel: {
              calories: 50,
              protein: "1g",
              totalFat: "0g",
              totalCarbohydrate: "11g"
            }
          }
        ]
      };

      const result = parseAndHealVisionScout(mockOutput, () => {});
      // All 3 macros present (fat: 0g, protein: 1g, carbs: 11g). Total fat must remain 0.
      expect(result.items[0].rawNutritionLabel.totalFat).toBe("0g");
    });

    it("explodes list formatted items with commas into multiple items if not bearing printed macros", () => {
      const mockOutput = {
        items: [
          {
            keyword: "fruit platter",
            originalName: "Apple, Orange, Banana", // commas splitting
            estimatedWeightGrams: 300,
            rawNutritionLabel: {} // No printed macros
          }
        ]
      };

      const result = parseAndHealVisionScout(mockOutput, () => {});
      expect(result.items).toHaveLength(3);
      expect(result.items[0].originalName).toBe("Apple");
      expect(result.items[1].originalName).toBe("Orange");
      expect(result.items[2].originalName).toBe("Banana");
    });

    it("successfully parses compact spreadsheet formats into standalone items", () => {
      const mockOutput = {
        compactSpreadsheet: [
          "Snacks|Potato Chips|Lay's Classic|120g|10,10,90,90",
          "Beverages|Soda|Coca Cola|250ml|100,100,400,400",
          "Snacks|Tiny Treat|Mini Pack|30g|20,20,80,80"
        ]
      };

      const result = parseAndHealVisionScout(mockOutput, () => {});
      expect(result.items).toHaveLength(3);
      expect(result.items[0].keyword).toBe("Potato Chips");
      expect(result.items[0].originalName).toBe("[Snacks] Lay's Classic");
      expect(result.items[0].estimatedWeightGrams).toBe(120);
      expect(result.items[0].boundingBox2D).toEqual([10, 10, 90, 90]);

      expect(result.items[1].keyword).toBe("Soda");
      expect(result.items[1].originalName).toBe("[Beverages] Coca Cola");
      expect(result.items[1].estimatedWeightGrams).toBe(250);
      expect(result.items[1].boundingBox2D).toEqual([100, 100, 400, 400]);

      // 30g is <= 50, so it should fall back/scale to 300g per the backend rule
      expect(result.items[2].keyword).toBe("Tiny Treat");
      expect(result.items[2].estimatedWeightGrams).toBe(300);
    });

    it("rejects corrupted/overlong strings and throws sanity check errors", () => {
      const corruptedOutput = {
        recommendedMode: "new_log",
        contentType: "visual",
        items: [
          {
            keyword: "A".repeat(160), // Exceeds 150 limit
            originalName: "Overlong Name",
            estimatedWeightGrams: 100,
            boundingBox2D: [0, 0, 100, 100]
          }
        ]
      };

      expect(() => parseAndHealVisionScout(corruptedOutput, () => {})).toThrow("[Vision Scout Corrupted]");
    });

    it("rejects visualIngredients containing JSON heuristics", () => {
      const corruptedOutput = {
        recommendedMode: "new_log",
        contentType: "visual",
        items: [
          {
            keyword: "food",
            originalName: "Food Item",
            estimatedWeightGrams: 100,
            boundingBox2D: [0, 0, 100, 100],
            visualIngredients: ["ingredientsList", "components: ["] // contains key name heuristics
          }
        ]
      };

      expect(() => parseAndHealVisionScout(corruptedOutput, () => {})).toThrow("[Vision Scout Corrupted]");
    });

    it("merges separate standalone label item into primary packaged food item and clears visualIngredients", () => {
      const mockOutput = {
        items: [
          {
            keyword: "traditional crackers",
            originalName: "Kerupuk Crackers",
            estimatedWeightGrams: 200,
            sourceImageIndex: 0,
            rawNutritionLabel: {}
          },
          {
            keyword: "nutrition facts",
            originalName: "Informasi Nilai Gizi",
            estimatedWeightGrams: 100,
            sourceImageIndex: 1,
            rawNutritionLabel: { calories: 150, protein: "3g", totalFat: "6g", totalCarbohydrate: "21g" },
            ingredientsList: "Tapioca starch, salt, palm oil"
          }
        ]
      };

      const result = parseAndHealVisionScout(mockOutput, () => {});
      expect(result.items).toHaveLength(1);
      expect(result.items[0].originalName).toBe("Kerupuk Crackers");
      expect(result.items[0].rawNutritionLabel.calories).toBe('150 kcal');
      expect(result.items[0].ingredientsList).toBe("Tapioca starch, salt, palm oil");
      expect(result.items[0].visualIngredients).toEqual([]);
    });
  });

  describe("explicit user weights on two drinks", () => {
    it("does not apply 1L to the lassi after 500ml was already claimed", () => {
      const items = [
        { originalName: "Mango Lassi Yogurt Drink", keyword: "mango lassi", estimatedWeightGrams: 500, components: [] },
        { originalName: "Low Fat Yogurt Drink", keyword: "yogurt drink", estimatedWeightGrams: 500, components: [] },
      ];
      const out = resolvePackageAndContextItems(items, () => {}, "Lassi is 500ml the other is 1L", true);
      const lassi = out.find((i) => /lassi/i.test(i.originalName));
      const other = out.find((i) => /low fat/i.test(i.originalName));
      expect(lassi?.estimatedWeightGrams).toBe(500);
      expect(other?.estimatedWeightGrams).toBe(1000);
    });
  });

  describe("canMergeScoutLabelIntoFood", () => {
    it("does not glue a reformed-ham label onto Serrano", () => {
      const d = canMergeScoutLabelIntoFood(
        { originalName: "Reformed Ham Nutrition Facts Label" },
        { originalName: "Gran Reserva Serrano Ham 50% Duroc Breed", keyword: "serrano ham" }
      );
      expect(d.ok).toBe(false);
      expect(d.reason).toMatch(/conflict|generic|weak/i);
    });

    it("still merges a milk label onto the matching milk carton", () => {
      const d = canMergeScoutLabelIntoFood(
        { originalName: "Organic Semi-Skimmed Milk Nutrition Facts Label" },
        { originalName: "Organic Semi-Skimmed Milk" }
      );
      expect(d.ok).toBe(true);
    });

    it("merges a same-named ham label onto that ham", () => {
      const d = canMergeScoutLabelIntoFood(
        { originalName: "Co-op Formed Ham Nutrition Facts Label" },
        { originalName: "Co-op Formed Ham" }
      );
      expect(d.ok).toBe(true);
    });
  });

  describe("cross-photo deduplication guards", () => {
    it("does not merge two distinct items sharing flavor words when printed calories or labels differ", () => {
      const mockOutput = {
        items: [
          {
            keyword: "sweet chilli chicken wrap",
            originalName: "Sweet Chilli Chicken Wrap",
            estimatedWeightGrams: 220,
            sourceImageIndex: 0,
            rawNutritionLabel: { calories: "453 kcal" }
          },
          {
            keyword: "mycoprotein sweet chilli mini fillets",
            originalName: "Sweet Chilli Mini Fillets",
            estimatedWeightGrams: 138,
            sourceImageIndex: 1,
            rawNutritionLabel: { calories: "98 kcal" }
          }
        ]
      };

      const result = parseAndHealVisionScout(mockOutput, () => {});
      expect(result.items).toHaveLength(2);
      expect(result.items[0].originalName).toBe("Sweet Chilli Chicken Wrap");
      expect(result.items[1].originalName).toBe("Sweet Chilli Mini Fillets");
    });
  });

  describe("reconcileIngredientsToComponents", () => {
    it("allocates non-zero volume percentage for detected ranch dressing in ingredients list", () => {
      const item = {
        keyword: "chicken avocado salad",
        originalName: "Chicken Cobb Salad",
        ingredientsList: "Feta cheese, avocado, bacon, chicken, red onion, cherry tomato, eggs, mix leaves, ranch dressing",
        components: [
          { searchQuery: "mixed salad leaves", volumePercentage: 35 },
          { searchQuery: "grilled chicken breast", volumePercentage: 20 },
          { searchQuery: "avocado", volumePercentage: 15 },
          { searchQuery: "hard boiled egg", volumePercentage: 10 },
          { searchQuery: "feta cheese", volumePercentage: 10 },
          { searchQuery: "cherry tomato", volumePercentage: 5 },
          { searchQuery: "bacon bits", volumePercentage: 3 },
          { searchQuery: "red onion", volumePercentage: 2 },
        ]
      };

      reconcileIngredientsToComponents(item);

      const ranchComp = item.components.find((c: any) => c.searchQuery.includes("ranch"));
      expect(ranchComp).toBeDefined();
      expect(ranchComp?.volumePercentage).toBeGreaterThanOrEqual(5);

      const totalPct = item.components.reduce((sum: number, c: any) => sum + (c.volumePercentage || 0), 0);
      expect(totalPct).toBeGreaterThanOrEqual(95);
      expect(totalPct).toBeLessThanOrEqual(105);
    });

    it("does not duplicate condiment if already present in components", () => {
      const item = {
        keyword: "salad with ranch",
        components: [
          { searchQuery: "mixed greens", volumePercentage: 80 },
          { searchQuery: "ranch dressing", volumePercentage: 20 }
        ],
        ingredientsList: "mixed greens, ranch dressing"
      };

      const initialCount = item.components.length;
      reconcileIngredientsToComponents(item);
      expect(item.components.length).toBe(initialCount);
    });
  });

  describe("canMergeScoutLabelIntoFood & spatial clustering", () => {
    it("does not merge sweet chilli mini fillets label", () => {
      const label = { originalName: "Quorn Sweet Chilli Mini Fillets Nutrition Facts Label" };
      const food = { originalName: "Quorn Sweet Chilli Mini Fillets" };
      const d = canMergeScoutLabelIntoFood(label, food);
      expect(d.ok).toBe(true);
    });
    it("uses Scout Dedupe for True Friends", () => {
      const label = { originalName: "Tesco Vegan Chicken Nuggets Nutrition Facts Label" };
      const food = { originalName: "Tesco Vegan Chicken Nuggets" };
      const d = canMergeScoutLabelIntoFood(label, food);
      expect(d.ok).toBe(true);
    });

    it("preserves parenthetical comma lists without exploding and keeps direct nutrients intact", () => {
      const mockOutput = {
        items: [
          {
            keyword: "mixed vegetables",
            originalName: "Mixed Vegetables (Corn, Peas, Carrots)",
            estimatedWeightGrams: 120,
            nutrients: {
              protein: 4,
              carbohydrates: 18,
              totalFat: 4,
              sodium: 120
            }
          }
        ]
      };

      const result = parseAndHealVisionScout(mockOutput, () => {});
      expect(result.items).toHaveLength(1);
      expect(result.items[0].originalName).toBe("Mixed Vegetables (Corn, Peas, Carrots)");
      expect(result.items[0].estimatedWeightGrams).toBe(120);
      expect(result.items[0].nutrientBasisWeight).toBe(120);
      expect(result.items[0].nutrients.protein).toBe(4);
    });

    it("re-anchors nutrientBasisWeight and merges nutrients in clusterSpatialCompositeDishes", () => {
      const items = [
        {
          originalName: "Grilled Chicken",
          keyword: "grilled chicken",
          estimatedWeightGrams: 150,
          nutrientBasisWeight: 150,
          boundingBox2D: [100, 100, 400, 400],
          sourceImageIndex: 0,
          nutrients: { protein: 30, carbohydrates: 0, totalFat: 5 }
        },
        {
          originalName: "Steamed Rice",
          keyword: "steamed rice",
          estimatedWeightGrams: 200,
          nutrientBasisWeight: 200,
          boundingBox2D: [120, 110, 410, 410],
          sourceImageIndex: 0,
          nutrients: { protein: 5, carbohydrates: 50, totalFat: 1 }
        }
      ];

      const clustered = clusterSpatialCompositeDishes(items, () => {});
      expect(clustered).toHaveLength(1);
      expect(clustered[0].estimatedWeightGrams).toBe(350);
      expect(clustered[0].nutrientBasisWeight).toBe(350);
      expect(clustered[0].nutrients.protein).toBe(35);
      expect(clustered[0].nutrients.carbohydrates).toBe(50);
      expect(clustered[0].nutrients.totalFat).toBe(6);
    });

    it("combines weights and nutrients for duplicate visual items across separate photos", () => {
      const mockOutput = {
        items: [
          {
            keyword: "potato wedges",
            originalName: "Potato Wedges",
            estimatedWeightGrams: 100,
            sourceImageIndex: 0,
            boundingBox2D: [500, 100, 900, 400],
            nutrients: { protein: 2.5, carbohydrates: 26, totalFat: 7, sodium: 200 }
          },
          {
            keyword: "potato wedges",
            originalName: "Potato Wedges",
            estimatedWeightGrams: 90,
            sourceImageIndex: 1,
            boundingBox2D: [400, 50, 800, 500],
            nutrients: { protein: 2.2, carbohydrates: 23, totalFat: 6, sodium: 180 }
          }
        ]
      };

      const result = parseAndHealVisionScout(mockOutput, () => {});
      expect(result.items).toHaveLength(1);
      expect(result.items[0].estimatedWeightGrams).toBe(190);
      expect(result.items[0].nutrientBasisWeight).toBe(190);
      expect(result.items[0].nutrients.protein).toBe(4.7);
      expect(result.items[0].nutrients.carbohydrates).toBe(49);
      expect(result.items[0].nutrients.totalFat).toBe(13);
      expect(result.items[0].nutrients.sodium).toBe(380);
    });

    it("does not merge separate plates or distinct dishes with their own components", () => {
      const items = [
        {
          originalName: "Uncooked Plate Ingredients",
          keyword: "uncooked plate ingredients",
          estimatedWeightGrams: 300,
          boundingBox2D: [390, 0, 990, 439],
          sourceImageIndex: 0,
          components: [
            { name: "Broccoli", weightGrams: 250 },
            { name: "Baby Corn", weightGrams: 50 }
          ]
        },
        {
          originalName: "Raw Egg",
          keyword: "raw egg",
          estimatedWeightGrams: 65,
          boundingBox2D: [790, 350, 990, 489],
          sourceImageIndex: 0,
          components: [
            { name: "Chicken Egg", weightGrams: 65 }
          ]
        }
      ];

      const clustered = clusterSpatialCompositeDishes(items, () => {});
      // Raw egg and plate ingredients on separate coordinates should remain distinct dishes
      expect(clustered).toHaveLength(2);
      expect(clustered[0].originalName).toBe("Uncooked Plate Ingredients");
      expect(clustered[1].originalName).toBe("Raw Egg");
    });

    it("consolidates duplicate scout items with identical names from the same image even with default boxes", () => {
      const items = [
        {
          originalName: "Almond Glazed Donut",
          keyword: "donut",
          estimatedWeightGrams: 80,
          boundingBox2D: [100, 100, 400, 400],
          sourceImageIndex: 0,
        },
        {
          originalName: "Yakult Rasa Stroberi",
          keyword: "probiotic drink",
          estimatedWeightGrams: 65,
          boundingBox2D: [0, 0, 1000, 1000],
          sourceImageIndex: 0,
        },
        {
          originalName: "Yakult Rasa Stroberi",
          keyword: "probiotic drink",
          estimatedWeightGrams: 65,
          boundingBox2D: [0, 0, 1000, 1000],
          sourceImageIndex: 0,
        },
      ];

      const clustered = clusterSpatialCompositeDishes(items, () => {});
      expect(clustered).toHaveLength(2);
      expect(clustered[0].originalName).toBe("Almond Glazed Donut");
      expect(clustered[1].originalName).toBe("Yakult Rasa Stroberi");
      expect(clustered[1].estimatedWeightGrams).toBe(130);
    });
  });

  describe("bracketed content handling", () => {
    it("should parse bracketed food items with name and weight", async () => {
      const { parseBracketedFoodItems } = await import("./agents/scoutInstructions");
      const items = parseBracketedFoodItems("[Mr Oat Rolled Oats 70g] + identify all barcode");
      expect(items).toHaveLength(1);
      expect(items[0].originalName).toBe("Mr Oat Rolled Oats");
      expect(items[0].estimatedWeightGrams).toBe(70);
      expect(items[0].source).toBe("bracket_pre_extracted");
    });

    it("should filter out scout dishes matching bracketed items in parseAndHealVisionScout", async () => {
      const { parseAndHealVisionScout } = await import("./server_vision_scout");
      const mockScoutOutput = {
        dishes: [
          {
            dishName: "Seafood Soup Pot",
            estimatedWeightGrams: 800,
            cookingMethod: "boiled",
            foods: [
              { foodName: "Squid", weightGrams: 200, nutrients: { protein: 30, saturatedFat: 0.5, addedSugar: 0, totalFibre: 0, sodium: 80, carbohydrates: 0 } }
            ]
          },
          {
            dishName: "Mr Oat Rolled Oats",
            estimatedWeightGrams: 70,
            cookingMethod: "raw",
            foods: [
              { foodName: "Mr Oat Rolled Oats", weightGrams: 70, nutrients: { protein: 3, saturatedFat: 0.5, addedSugar: 0, totalFibre: 0, sodium: 0, carbohydrates: 21 } }
            ]
          }
        ]
      };
      const result = parseAndHealVisionScout(mockScoutOutput, () => {}, false, "I had [Mr Oat Rolled Oats 70g] with all food in the picture");
      expect(result.items.some((it: any) => it.originalName === "Mr Oat Rolled Oats")).toBe(false);
      expect(result.items.some((it: any) => it.originalName === "Seafood Soup Pot")).toBe(true);
    });
  });
});

