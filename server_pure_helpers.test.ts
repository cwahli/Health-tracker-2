import { describe, it, expect } from 'vitest';
import { normalizeChainKey } from './serverBrandMenu';
import { 
  sanitizeMealWeight, 
  jsToYaml, 
  extractBalancedJson, 
  sanitizeString,
  findItemIndexInList,
  extractUSDANutrientsPer100g,
  extractOFFNutrientsPer100g,
  checkIfItemIsAlreadyPrepared,
  checkAtwaterConsistency,
  applyNutrientRealityChecks,
  backfillSolubleFibre
} from './server_pure_helpers';

describe('server_pure_helpers', () => {
  describe('sanitizeMealWeight', () => {
    it('returns fallback for an overlong digit string that causes overflow', () => {
      const overlong = "150" + "0".repeat(30);
      const fallback = 100;
      const result = sanitizeMealWeight(overlong, fallback);
      expect(result).not.toBe(Infinity);
      expect(result).toBe(fallback);
    });

    it('returns rounded number for valid input', () => {
      expect(sanitizeMealWeight("150.4", 100)).toBe(150);
      expect(sanitizeMealWeight(150.6, 100)).toBe(151);
    });
  });

  describe('jsToYaml', () => {
    it('uses literal-block (|) for strings containing newlines', () => {
      const input = "line1\nline2";
      const result = jsToYaml(input);
      expect(result).toBe("|\n  line1\n  line2");
    });
  });

  describe('extractBalancedJson', () => {
    it('recovers the first balanced block from wrapped/garbage input', () => {
      const input = "```json\n{\"a\": 1}\n``` trailing garbage";
      const result = extractBalancedJson(input);
      expect(result).toBe('{"a": 1}');
    });

    it('recovers correctly when nested curly braces are present', () => {
      const input = "Some leading text {\"outer\": {\"inner\": 42}} some trailing text";
      const result = extractBalancedJson(input);
      expect(result).toBe('{"outer": {"inner": 42}}');
    });
  });

  describe('sanitizeString', () => {
    it('uses fallback for null, undefined, or empty/spaces values', () => {
      expect(sanitizeString(null, "fallback")).toBe("fallback");
      expect(sanitizeString(undefined, "fallback")).toBe("fallback");
      expect(sanitizeString("undefined", "fallback")).toBe("fallback");
      expect(sanitizeString("   ", "fallback")).toBe("fallback");
    });

    it('returns valid string unchanged', () => {
      expect(sanitizeString("hello", "fallback")).toBe("hello");
      expect(sanitizeString(123, "fallback")).toBe("123");
    });
  });

  describe('findItemIndexInList', () => {
    const items = [
      { name: "Scrambled Eggs", canonicalDbName: "egg_scrambled", dbId: "123" },
      { name: "Sourdough Toast", canonicalDbName: "bread_sourdough", dbId: "456" },
      { name: "Avocado Slices", canonicalDbName: "avocado_raw", dbId: "789" }
    ];

    it('matches exact dbId first', () => {
      expect(findItemIndexInList(items, "Sourdough Toast", "789")).toBe(2); // Matches dbId 789 (Avocado) despite name mismatch
      expect(findItemIndexInList(items, "Non-existent", "123")).toBe(0); // Matches dbId 123 (Eggs)
    });

    it('matches exact name case-insensitively', () => {
      expect(findItemIndexInList(items, "scrambled eggs", null)).toBe(0);
      expect(findItemIndexInList(items, "Avocado Slices", null)).toBe(2);
    });

    it('matches canonicalDbName case-insensitively', () => {
      expect(findItemIndexInList(items, "egg_scrambled", null)).toBe(0);
      expect(findItemIndexInList(items, "bread_sourdough", null)).toBe(1);
    });

    it('matches prefix or suffix', () => {
      expect(findItemIndexInList(items, "Scrambled", null)).toBe(0); // prefix match
      expect(findItemIndexInList(items, "Toast", null)).toBe(1); // suffix match
    });

    it('matches via classic substring includes fallback', () => {
      expect(findItemIndexInList(items, "Slices", null)).toBe(2);
      expect(findItemIndexInList(items, "ourdo", null)).toBe(1);
    });

    it('matches via word-by-word intersection fallback', () => {
      // "Delicious Sourdough" has word "Sourdough" which is in canonical "bread_sourdough" / "Sourdough Toast"
      expect(findItemIndexInList(items, "Delicious Sourdough", null)).toBe(1);
    });

    it('returns -1 for completely unrecognized names', () => {
      expect(findItemIndexInList(items, "Peanut Butter", null)).toBe(-1);
    });
  });

  describe('extractUSDANutrientsPer100g', () => {
    it('extracts primary and trace nutrients correctly from foodNutrients array', () => {
      const mockUSDAFood = {
        foodNutrients: [
          { nutrientName: "Protein", value: 12.5 },
          { nutrientName: "Total lipid (fat)", value: 9.8 },
          { nutrientName: "Fatty acids, total saturated", value: 3.2 },
          { nutrientName: "Energy", value: 650, unitName: "kJ" }, // Should be converted to kcal (650 / 4.184 = 155)
          { nutrientName: "Sodium, Na", value: 450 },
          { nutrientName: "Iron, Fe", value: 1.8 }
        ]
      };

      const profile = extractUSDANutrientsPer100g(mockUSDAFood);
      expect(profile.protein).toBe(12.5);
      expect(profile.totalFat).toBe(9.8);
      expect(profile.saturatedFat).toBe(3.2);
      expect(profile.calories).toBe(155); // kJ to kcal conversion
      expect(profile.sodium).toBe(450);
      expect(profile.iron).toBe(1.8);
    });

    it('correctly extracts calories from raw corn structure containing both kJ and kcal, preferring kcal or converting properly', () => {
      // Mock raw corn with kJ (358 kJ) and kcal (86 kcal)
      const mockCornFood = {
        foodNutrients: [
          { nutrientId: 1062, nutrientName: "Energy", value: 358, unitName: "kJ" },
          { nutrientId: 1008, nutrientName: "Energy", value: 86, unitName: "kcal" }
        ]
      };
      const profile = extractUSDANutrientsPer100g(mockCornFood);
      expect(profile.calories).toBe(86);

      // And if only kJ is present (358 kJ)
      const mockCornFoodKjOnly = {
        foodNutrients: [
          { nutrientId: 1062, nutrientName: "Energy", value: 358, unitName: "kJ" }
        ]
      };
      const profileKjOnly = extractUSDANutrientsPer100g(mockCornFoodKjOnly);
      expect(profileKjOnly.calories).toBe(86); // 358 / 4.184 = 85.56 => 86
    });

    it('handles empty/missing nutrients gracefully', () => {
      const profile = extractUSDANutrientsPer100g({});
      expect(profile).toEqual({});
    });
  });

  describe('extractOFFNutrientsPer100g', () => {
    it('extracts primary and trace nutrients correctly from nutriments', () => {
      const mockOFFProduct = {
        nutriments: {
          "energy-kcal_100g": 250,
          "proteins_100g": 8.5,
          "fat_100g": 12.0,
          "saturated-fat_100g": 4.5,
          "sodium_100g": 0.35 // OFF sodium is typically in grams, will be scaled to mg (0.35 * 1000 = 350)
        }
      };

      const profile = extractOFFNutrientsPer100g(mockOFFProduct);
      expect(profile.calories).toBe(250);
      expect(profile.protein).toBe(8.5);
      expect(profile.totalFat).toBe(12.0);
      expect(profile.saturatedFat).toBe(4.5);
      expect(profile.sodium).toBe(350);
    });

    it('handles OFF energy in Joules properly', () => {
      const mockOFFProduct = {
        nutriments: {
          "energy_100g": 837 // 837 / 4.184 = 200 kcal
        }
      };
      const profile = extractOFFNutrientsPer100g(mockOFFProduct);
      expect(profile.calories).toBe(200);
    });
  });

  describe('Newline and YAML splitting edge cases', () => {
    it('parses literal \\n strings and real newlines identically', () => {
      const regex = /\r?\n|\\n/;
      const textWithRealNL = "line1\nline2\r\nline3";
      const textWithLiteralNL = "line1\\nline2\\nline3";

      const splitReal = textWithRealNL.split(regex).map(s => s.trim());
      const splitLiteral = textWithLiteralNL.split(regex).map(s => s.trim());

      expect(splitReal).toEqual(["line1", "line2", "line3"]);
      expect(splitLiteral).toEqual(["line1", "line2", "line3"]);
    });
  });

  describe('checkIfItemIsAlreadyPrepared', () => {
    it('detects prepared/pre-seasoned foods correctly', () => {
      expect(checkIfItemIsAlreadyPrepared("McCain Potato Wedges", "potato wedges", "off")).toBe(true);
      expect(checkIfItemIsAlreadyPrepared("Raw Potato", "raw potato", "usda", 5)).toBe(false);
      expect(checkIfItemIsAlreadyPrepared("French Fries", "potato", "usda")).toBe(true);
      expect(checkIfItemIsAlreadyPrepared("Steak with Pepper Sauce", "steak", "usda", 600)).toBe(true);
    });
  });

  describe('checkAtwaterConsistency', () => {
    it('flags and corrects a label-sourced item whose macros do not reconcile with stated calories (the McDonald\'s burger bug)', () => {
      // Milk's label (125 kcal, 9g protein, 4.5g fat) wrongly attached to a 120g fried fish burger.
      const nutrients = { calories: 60, protein: 4.3, totalFat: 2.2, carbohydrates: 12 };
      applyNutrientRealityChecks("Fish Goujon Happy Meal Burger", 120, nutrients, 0, undefined, "label");
      // Derived from macros: 4.3*4 + 12*4 + 2.2*9 = 84.6 kcal vs stated 60 kcal -> 41% deviation, should NOT be silently trusted
      expect(nutrients.totalFat).not.toBe(2.2);
    });

    it('flags fabricated fat on a partially-backfilled label item (the fries bug)', () => {
      // Only calories (237) came from the real label; fat (26.3g) was backfilled from an
      // unrelated DB match and must still be checked because dbSource is "label_partial".
      const nutrients = { calories: 237, protein: 2.6, totalFat: 26.3, carbohydrates: 30 };
      applyNutrientRealityChecks("Small Fries", 75, nutrients, 0, undefined, "label_partial");
      // 2.6*4 + 30*4 + 26.3*9 = 367.1 kcal derived vs 237 stated -> should be rescaled down
      expect(nutrients.totalFat).toBeLessThan(26.3);
    });

    it('does not alter macros that already reconcile with stated calories', () => {
      const nutrients = { calories: 200, protein: 10, totalFat: 8, carbohydrates: 20 };
      // 10*4 + 20*4 + 8*9 = 192 kcal derived vs 200 stated -> 4% deviation, within tolerance
      applyNutrientRealityChecks("Vegetable Rice Bowl", 200, nutrients, 0, undefined, "usda");
      expect(nutrients.totalFat).toBe(8);
      expect(nutrients.protein).toBe(10);
    });

    it('backfills calories from macros when calories are zero but macros are present', () => {
      const nutrients = { calories: 0, protein: 10, totalFat: 5, carbohydrates: 20 };
      applyNutrientRealityChecks("Test Item", 100, nutrients, 0, undefined, "estimated");
      expect(nutrients.calories).toBe(Math.round(10 * 4 + 20 * 4 + 5 * 9));
    });

    it('leaves items with zero calories and zero macros alone', () => {
      const nutrients = { calories: 0, protein: 0, totalFat: 0, carbohydrates: 0 };
      expect(() => applyNutrientRealityChecks("Water", 250, nutrients, 0, undefined, "usda")).not.toThrow();
      expect(nutrients.calories).toBe(0);
    });

    it('handles null or undefined itemNutrients gracefully without throwing TypeError', () => {
      expect(() => checkAtwaterConsistency("Null Item", null as any)).not.toThrow();
      expect(() => checkAtwaterConsistency("Undefined Item", undefined as any)).not.toThrow();
      expect(() => applyNutrientRealityChecks("Null Item", 100, null as any, 0)).not.toThrow();
      expect(() => applyNutrientRealityChecks("Undefined Item", 100, undefined as any, 0)).not.toThrow();
    });
  });

  describe('applyNutrientRealityChecks', () => {
    it('corrects unrealistically high sodium for non-cured items', () => {
      const nutrients = { sodium: 800, protein: 10 };
      applyNutrientRealityChecks("Potato Wedges", 100, nutrients, 200);
      expect(nutrients.sodium).toBe(450); // Adjusted (250 + 200) * (100 / 100)
    });

    it('retains high sodium for cured or salted items', () => {
      const nutrients = { sodium: 1200, protein: 15 };
      applyNutrientRealityChecks("Cured Bacon", 100, nutrients, 150);
      expect(nutrients.sodium).toBe(1200); // Unchanged
    });

    it('caps unrealistically high protein for standard items', () => {
      const nutrients = { sodium: 100, protein: 60 };
      applyNutrientRealityChecks("Beef Steak", 100, nutrients, 50);
      expect(nutrients.protein).toBe(45); // Capped at 45g per 100g
    });

    it('never overrides sodium when dbSource is "label", even for unusual items', () => {
      const nutrients = { sodium: 1110, protein: 3 };
      applyNutrientRealityChecks("HANA Mat Kimchi (Diced Radish Kimchi)", 150, nutrients, 0, undefined, "label");
      expect(nutrients.sodium).toBe(1110); // Unchanged — label data is ground truth
    });

    it('never overrides protein when dbSource is "label"', () => {
      const nutrients = { sodium: 100, protein: 60 };
      applyNutrientRealityChecks("Some Label Item", 100, nutrients, 0, undefined, "label");
      expect(nutrients.protein).toBe(60); // Unchanged — label data is ground truth
    });

    it('rescales wildly undercounted calories for a dessert/candy item (generic, not name-specific)', () => {
      const nutrients = { calories: 4, protein: 0.1 };
      applyNutrientRealityChecks("Dark Chocolate Coating", 9, nutrients, 0);
      expect(nutrients.calories).toBe(35); // ~390 kcal/100g midpoint * 9g
    });

    it('rescales wildly overcounted calories for a grain/snack item', () => {
      const nutrients = { calories: 5000, protein: 5 };
      applyNutrientRealityChecks("Bread Roll", 50, nutrients, 0);
      expect(nutrients.calories).toBe(165); // ~330 kcal/100g midpoint * 50g
    });

    it('leaves a plausible calorie value untouched', () => {
      const nutrients = { calories: 480, protein: 5 };
      applyNutrientRealityChecks("Chocolate Cookie", 100, nutrients, 0);
      expect(nutrients.calories).toBe(480); // Within bakery_dessert bounds
    });

    it('injects a calories field when calories is absent but macros are present', () => {
      const nutrients: Record<string, number> = { sodium: 100, protein: 10 };
      expect(() => applyNutrientRealityChecks("Potato Wedges", 100, nutrients, 200)).not.toThrow();
      expect(nutrients.calories).toBe(40);
    });
  });

  describe('backfillSolubleFibre', () => {
    it('backfills soluble fibre for oats (35% ratio)', () => {
      const nutrients = { totalFibre: 10, solubleFibre: 0 };
      backfillSolubleFibre(nutrients, "Sainsbury Rolled Oats");
      expect(nutrients.solubleFibre).toBe(3.5);
    });

    it('backfills soluble fibre for fruits (30% ratio)', () => {
      const nutrients = { totalFibre: 4.3, solubleFibre: 0 };
      backfillSolubleFibre(nutrients, "Gala Apple");
      expect(nutrients.solubleFibre).toBe(1.29);
    });

    it('backfills soluble fibre for peach/plum/grapes', () => {
      const nutrients = { totalFibre: 2, solubleFibre: 0 };
      backfillSolubleFibre(nutrients, "Donut peach");
      expect(nutrients.solubleFibre).toBe(0.6);
    });

    it('does not overwrite existing non-zero soluble fibre', () => {
      const nutrients = { totalFibre: 10, solubleFibre: 2.5 };
      backfillSolubleFibre(nutrients, "Sainsbury Rolled Oats");
      expect(nutrients.solubleFibre).toBe(2.5);
    });

    it('does nothing if totalFibre is 0 or missing', () => {
      const nutrients = { totalFibre: 0, solubleFibre: 0 };
      backfillSolubleFibre(nutrients, "Water");
      expect(nutrients.solubleFibre).toBe(0);
    });
  });

  describe('normalizeChainKey', () => {
    it('normalizes sainsbury and sainsbury_s to sainsbury', () => {
      expect(normalizeChainKey("Sainsbury")).toBe('sainsbury');
      expect(normalizeChainKey("Sainsbury's")).toBe('sainsbury');
      expect(normalizeChainKey("sainsbury_s")).toBe('sainsbury');
      expect(normalizeChainKey("sainsburys")).toBe('sainsbury');
    });

    it('normalizes mcdonalds variations to mcdonalds', () => {
      expect(normalizeChainKey("McDonald's")).toBe('mcdonalds');
      expect(normalizeChainKey("mcdonald_s")).toBe('mcdonalds');
      expect(normalizeChainKey("mcdonald")).toBe('mcdonalds');
    });

    it('normalizes generic possessive chain names correctly', () => {
      expect(normalizeChainKey("Jack Daniel's")).toBe('jack_daniels');
      expect(normalizeChainKey("jack_daniel_s")).toBe('jack_daniels');
      expect(normalizeChainKey("YOLK")).toBe('yolk');
      expect(normalizeChainKey("Pret A Manger")).toBe('pret_a_manger');
    });
  });
});
