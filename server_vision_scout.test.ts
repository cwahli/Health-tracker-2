import { describe, it, expect } from "vitest";
import { parseAndHealVisionScout, mergeScoutItems } from "./server_vision_scout";

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
      expect(result.queriesToSearch).toContain("french fries");
      expect(result.visionScoutRanAndReturnedItems).toBe(true);
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
              totalFat: "4g",
              totalCarbohydrate: "0g" // 0g carbohydrates, expected = (4*9) + (5*4) = 56. Discrepancy <= 20%
            }
          }
        ]
      };

      const result = parseAndHealVisionScout(mockOutput, () => {});
      // Discrepancy is Math.abs(56 - 60)/56 = 7.1% (<= 20%).
      // Carbs should heal to: (60 - 36 - 20) / 4 = 1g.
      expect(result.items[0].rawNutritionLabel.totalCarbohydrate).toBe(1);
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
});
