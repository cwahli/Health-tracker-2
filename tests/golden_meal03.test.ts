import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const DIR = path.join(__dirname, '..', 'golden', 'meal', 'Meal_03_compare');
const cases: any[] = JSON.parse(fs.readFileSync(path.join(DIR, 'expected.json'), 'utf-8'));

const REQUIRED_ALLOWANCE_NUTRIENTS = [
  'calories',
  'saturatedFat',
  'sodium',
  'protein',
  'carbohydrates',
  'totalFibre',
  'potassium',
  'solubleFibre',
  'addedSugar',
  'transFat',
];

describe('Golden Meal_03_compare — Fixtures & Structure', () => {
  it('contains exactly 6 evaluated benchmark cases', () => {
    expect(cases).toHaveLength(6);
    expect(cases.map((c) => c.id)).toEqual(['set1', 'set2', 'set3', 'set4', 'set5', 'set6']);
  });

  it('all listed image files exist in golden/meal/Meal_03_compare', () => {
    const expectedImages = [
      'set1_saybread_bakery_shelf.jpg',
      'set1_silverqueen_chocolate_front.jpg',
      'set1_silverqueen_nutrition_label.jpg',
      'set2_snack_blue_bread_label.jpg',
      'set2_snack_green_bar_label.jpg',
      'set2_snack_pack_front.jpg',
      'set2_snack_yellow_cake_label.jpg',
      'set3_restaurant_menu_page1.jpg',
      'set3_restaurant_menu_page2.jpg',
      'set4_juice_and_beverage_list.jpg',
      'set5_restaurant_banner_menu.jpg',
      'set6_supermarket_chip_aisle_shelf.jpg',
    ];

    for (const img of expectedImages) {
      const p = path.join(DIR, img);
      expect(fs.existsSync(p), `Missing image ${img}`).toBe(true);
      expect(fs.statSync(p).size).toBeGreaterThan(0);
    }
  });

  it('has comprehensive Instruction.md detailing the benchmark setup', () => {
    const p = path.join(DIR, 'Instruction.md');
    expect(fs.existsSync(p)).toBe(true);
    const content = fs.readFileSync(p, 'utf-8');
    expect(content).toContain('Compare Mode (Mode D)');
    expect(content).toContain('Transposed Benchmark Summary Matrix');
  });

  it('has ideal_debug_turn01.md matching canonical debug report contract', () => {
    const p = path.join(DIR, 'ideal_debug_turn01.md');
    expect(fs.existsSync(p)).toBe(true);
    const content = fs.readFileSync(p, 'utf-8');
    expect(content).toContain('End-to-End Diagnostic Report');
    expect(content).toContain('IDEAL · Meal 03 Compare · Turn 01');
    expect(content).toContain('Contract Evaluation');
    expect(content).toContain('Modal Snapshot (Dialog Inventory)');
    expect(content).toContain('Dispatch t1/scout');
    expect(content).toContain('Mathematical & Thermodynamic Validation');
    expect(content).toContain('job_ideal_meal03_compare_turn01');
  });

  it('contains individual debug runs for all 6 benchmark cases in debug_runs/', () => {
    const debugDir = path.join(DIR, 'debug_runs');
    expect(fs.existsSync(debugDir)).toBe(true);
    for (let set = 1; set <= 6; set++) {
      const files = fs.readdirSync(debugDir).filter((f) => f.includes(`set${set}`));
      expect(files.length, `Missing debug run for set ${set}`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('Golden Meal_03_compare — Extraction & Grouping Invariants', () => {
  it('matches extracted item and group counts per case', () => {
    const expectedCounts: Record<string, { items: number; minGroups: number }> = {
      set1: { items: 6, minGroups: 3 },
      set2: { items: 4, minGroups: 2 },
      set3: { items: 95, minGroups: 4 },
      set4: { items: 28, minGroups: 4 },
      set5: { items: 57, minGroups: 3 },
      set6: { items: 14, minGroups: 3 },
    };

    for (const c of cases) {
      const exp = expectedCounts[c.id];
      expect(c.data.items).toHaveLength(exp.items);
      expect(c.data.groups.length).toBeGreaterThanOrEqual(exp.minGroups);
    }
  });

  it('has zero orphaned items (all scoutItemIndices point to existing items)', () => {
    for (const c of cases) {
      const numItems = c.data.items.length;
      for (const grp of c.data.groups) {
        expect(Array.isArray(grp.scoutItemIndices)).toBe(true);
        expect(grp.scoutItemIndices.length).toBeGreaterThan(0);
        for (const idx of grp.scoutItemIndices) {
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThan(numItems);
        }
      }
    }
  });

  it('contains valid normalized bounding box coordinates [ymin, xmin, ymax, xmax]', () => {
    for (const c of cases) {
      for (const grp of c.data.groups) {
        const bbox = grp.boundingBox2D;
        expect(Array.isArray(bbox)).toBe(true);
        expect(bbox).toHaveLength(4);
        const [ymin, xmin, ymax, xmax] = bbox;
        expect(ymin).toBeGreaterThanOrEqual(0);
        expect(ymin).toBeLessThanOrEqual(1000);
        expect(xmin).toBeGreaterThanOrEqual(0);
        expect(xmin).toBeLessThanOrEqual(1000);
        expect(ymax).toBeGreaterThanOrEqual(ymin);
        expect(ymax).toBeLessThanOrEqual(1000);
        expect(xmax).toBeGreaterThanOrEqual(xmin);
        expect(xmax).toBeLessThanOrEqual(1000);
      }
    }
  });
});

describe('Golden Meal_03_compare — 10-Nutrient Profile Allowance Vectors', () => {
  it('every group has complete 10-nutrient allowance vector for per-serving', () => {
    for (const c of cases) {
      for (const grp of c.data.groups) {
        expect(grp.averageNutrients, `${c.id} group ${grp.groupName} missing averageNutrients`).toBeDefined();
        for (const nutrient of REQUIRED_ALLOWANCE_NUTRIENTS) {
          const val = grp.averageNutrients[nutrient];
          expect(
            typeof val === 'number' && !isNaN(val),
            `${c.id} - ${grp.groupName} missing nutrient ${nutrient}`
          ).toBe(true);
        }
      }
    }
  });

  it('every group has averageNutrientsPer100g with valid core macros', () => {
    const coreMacros = ['calories', 'protein', 'totalFat', 'saturatedFat', 'carbohydrates', 'sugar', 'sodium'];
    for (const c of cases) {
      for (const grp of c.data.groups) {
        expect(grp.averageNutrientsPer100g, `${c.id} group ${grp.groupName} missing per100g`).toBeDefined();
        for (const macro of coreMacros) {
          const val = grp.averageNutrientsPer100g[macro];
          expect(
            typeof val === 'number' && !isNaN(val),
            `${c.id} - ${grp.groupName} missing per100g macro ${macro}`
          ).toBe(true);
        }
      }
    }
  });

  it('verifies calorie math consistency: per100g calories are positive and realistic', () => {
    for (const c of cases) {
      for (const grp of c.data.groups) {
        const per100Kcal = grp.averageNutrientsPer100g.calories;
        // Non-beverages should be between 20 and 900 kcal/100g; plain black coffee/unsweetened tea can be ~0-20 kcal/100g
        expect(per100Kcal).toBeGreaterThanOrEqual(0);
        expect(per100Kcal).toBeLessThanOrEqual(900);
      }
    }
  });
});

describe('Golden Meal_03_compare — Clinical Verdict & Recommendation Narratives', () => {
  it('every group has a valid clinical verdict level and non-empty label', () => {
    const validLevels = ['good', 'neutral', 'warning', 'alert'];
    for (const c of cases) {
      for (const grp of c.data.groups) {
        expect(grp.verdict).toBeDefined();
        expect(validLevels).toContain(grp.verdict.level);
        expect(typeof grp.verdict.label).toBe('string');
        expect(grp.verdict.label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('every group provides a comparison sentence and clinical recommendation message', () => {
    for (const c of cases) {
      for (const grp of c.data.groups) {
        expect(typeof grp.comparisonSentence).toBe('string');
        expect(grp.comparisonSentence.trim().length).toBeGreaterThan(10);

        expect(typeof grp.message).toBe('string');
        expect(grp.message.trim().length).toBeGreaterThan(20);
      }
    }
  });

  it('every case identifies a top recommended item', () => {
    for (const c of cases) {
      expect(typeof c.recommended).toBe('string');
      expect(c.recommended.trim().length).toBeGreaterThan(0);
      // The recommended item must appear in c.data.items
      const itemNames = c.data.items.map((i: any) => i.name);
      const isPresent = itemNames.some((name: string) => name.includes(c.recommended) || c.recommended.includes(name));
      expect(isPresent, `${c.id} recommended "${c.recommended}" not found in items`).toBe(true);
    }
  });
});

describe('Golden Meal_03_compare — Live Precision & Recall Benchmarks (6 Cases)', () => {
  const evalPath = path.join(__dirname, '..', 'prototype', 'meallog', 'compare', 'six_cases_precision_eval.json');
  const evalData: any[] = fs.existsSync(evalPath) ? JSON.parse(fs.readFileSync(evalPath, 'utf-8')) : [];

  it('evaluates all 6 benchmark cases from live precision run', () => {
    expect(evalData.length, 'six_cases_precision_eval.json must contain all 6 cases').toBe(6);
    expect(evalData.map((d) => d.id)).toEqual(['set1', 'set2', 'set3', 'set4', 'set5', 'set6']);
  });

  it('exceeds minimum visual extraction recall thresholds per benchmark set', () => {
    // Ground truth targets: set1 (6), set2 (4), set3 (104), set4 (32), set5 (56), set6 (17)
    const minRecallThresholds: Record<string, number> = {
      set1: 6,   // Confectionery + bakery shelf
      set2: 4,   // 4 printed reference nutrition panels (exact)
      set3: 95,  // Dual-page complex laminated menu (>=90% recall on 104 items)
      set4: 28,  // Beverage and dessert price board (>=87.5% recall on 32 items)
      set5: 56,  // Street food hanging banner (100% recall on 56 items)
      set6: 17,  // Supermarket snack aisle (100% reference shelf coverage)
    };

    let totalExtracted = 0;
    for (const d of evalData) {
      const itemsCount = d.data?.allExtractedDishes?.length || d.itemCount;
      totalExtracted += itemsCount;
      const minRequired = minRecallThresholds[d.id];
      expect(
        itemsCount,
        `${d.name} extracted ${itemsCount} items, expected >= ${minRequired}`
      ).toBeGreaterThanOrEqual(minRequired);
    }

    // Combined recall across all 6 cases must be >= 210 items (benchmark ground truth: 219 items)
    expect(totalExtracted).toBeGreaterThanOrEqual(210);
  });

  it('achieves >= 90% extraction recall on the 104-item restaurant menu (Set 3)', () => {
    const set3 = evalData.find((d) => d.id === 'set3');
    expect(set3).toBeDefined();
    const count = set3.data?.allExtractedDishes?.length || set3.itemCount;
    const recallRate = (count / 104) * 100;
    expect(recallRate).toBeGreaterThanOrEqual(90.0);
  });
});

describe('Golden Meal_03_compare — Macro-Variance Strictness & Zero-Orphan Invariant', () => {
  const evalPath = path.join(__dirname, '..', 'prototype', 'meallog', 'compare', 'six_cases_precision_eval.json');
  const evalData: any[] = fs.existsSync(evalPath) ? JSON.parse(fs.readFileSync(evalPath, 'utf-8')) : [];

  it('enforces zero-orphan invariant: 100% of extracted items are assigned to groups', () => {
    for (const d of evalData) {
      const totalItems = d.data?.allExtractedDishes?.length || d.itemCount;
      const groupedItemsCount = d.data.groups.reduce((acc: number, g: any) => acc + (g.items?.length || 0), 0);
      expect(
        groupedItemsCount,
        `${d.id} has orphaned items: ${groupedItemsCount} grouped vs ${totalItems} extracted`
      ).toBe(totalItems);
    }
  });

  it('every group has complete normalized 100g nutrients satisfying thermodynamic bounds', () => {
    for (const d of evalData) {
      for (let i = 0; i < d.data.groups.length; i++) {
        const g = d.data.groups[i];
        const p100 = g.averageNutrientsPer100g;
        expect(p100, `${d.id} group ${i + 1} missing averageNutrientsPer100g`).toBeDefined();
        expect(typeof p100.calories).toBe('number');
        expect(p100.calories).toBeGreaterThanOrEqual(0);
        expect(p100.calories).toBeLessThanOrEqual(900); // Pure fat is 900 kcal/100g

        expect(typeof p100.protein).toBe('number');
        expect(typeof p100.totalFat).toBe('number');
        expect(typeof p100.carbohydrates).toBe('number');
        expect(typeof p100.sodium).toBe('number');

        // Atwater consistency check: 4P + 9F + 4C ≈ cal (within reasonable food matrix margin)
        if (p100.calories > 10) {
          const atwaterEstimate = p100.protein * 4 + p100.totalFat * 9 + p100.carbohydrates * 4;
          const diffRatio = Math.abs(atwaterEstimate - p100.calories) / p100.calories;
          expect(diffRatio, `${d.id} G${i + 1} Atwater macro mismatch (${atwaterEstimate} vs ${p100.calories})`).toBeLessThanOrEqual(0.35);
        }
      }
    }
  });

  it('all group bounding boxes strictly satisfy normalized quadrant bounds [ymin, xmin, ymax, xmax]', () => {
    for (const d of evalData) {
      for (const g of d.data.groups) {
        const box = g.boundingBox2D;
        expect(Array.isArray(box), `${d.id} ${g.groupName} boundingBox2D must be array`).toBe(true);
        expect(box).toHaveLength(4);
        const [ymin, xmin, ymax, xmax] = box;
        expect(ymin).toBeGreaterThanOrEqual(0);
        expect(xmin).toBeGreaterThanOrEqual(0);
        expect(ymax).toBeLessThanOrEqual(1000);
        expect(xmax).toBeLessThanOrEqual(1000);
        expect(ymax).toBeGreaterThan(ymin);
        expect(xmax).toBeGreaterThan(xmin);
      }
    }
  });
});

describe('Golden Meal_03_compare — Clinical Decision Alignment under Active Patient Targets', () => {
  const evalPath = path.join(__dirname, '..', 'prototype', 'meallog', 'compare', 'six_cases_precision_eval.json');
  const evalData: any[] = fs.existsSync(evalPath) ? JSON.parse(fs.readFileSync(evalPath, 'utf-8')) : [];

  // Active targets: +38% Saturated Fat, +50% Added Sugar, +39% Calories, -17% Protein Deficit
  it('Set 1: rejects Tier 4 high-sugar confectionery and recommends savory bakery staple', () => {
    const set1 = evalData.find((d) => d.id === 'set1');
    expect(set1).toBeDefined();
    // Must not recommend candy/chocolate bar (SilverQueen/Magnum/Kinder)
    expect(set1.recommended.toLowerCase()).not.toMatch(/silverqueen|chocolate bar|kinder/i);
    // Must recommend a savory or plain bread item
    expect(set1.recommended.toLowerCase()).toMatch(/say bread|bread/i);
  });

  it('Set 2: recommends controlled calorie-density bread or snack to protect calorie budget', () => {
    const set2 = evalData.find((d) => d.id === 'set2');
    expect(set2).toBeDefined();
    // Recommends Blue Pack Bread (120 kcal, 273 kcal/100g) or Green Pack Snack (90 kcal)
    expect(set2.recommended.toLowerCase()).toMatch(/blue pack|green pack|soft bread/i);
    expect(set2.recommended.toLowerCase()).not.toMatch(/sarikaya|custard/i);
  });

  it('Set 3: elevates low-sodium vegetable soup or clean fish, bypassing deep-fried offal', () => {
    const set3 = evalData.find((d) => d.id === 'set3');
    expect(set3).toBeDefined();
    expect(set3.recommended.toLowerCase()).toMatch(/sayur asem|kembung|ikan/i);
    expect(set3.recommended.toLowerCase()).not.toMatch(/kulit|usus|seblak/i);
  });

  it('Set 4: elevates unsweetened hydrating coconut water over sugar-laden dessert bowls', () => {
    const set4 = evalData.find((d) => d.id === 'set4');
    expect(set4).toBeDefined();
    expect(set4.recommended.toLowerCase()).toMatch(/kelapa muda|coconut/i);
    expect(set4.recommended.toLowerCase()).not.toMatch(/es campur|teler|durian/i);
  });

  it('Set 5: elevates whole poached/grilled fish to close -17% protein deficit', () => {
    const set5 = evalData.find((d) => d.id === 'set5');
    expect(set5).toBeDefined();
    expect(set5.recommended.toLowerCase()).toMatch(/ikan|nila|garang asem/i);
    expect(set5.recommended.toLowerCase()).not.toMatch(/seblak|gorengan/i);
  });

  it('Set 6: elevates unextruded lighter crisps over extruded trans-fat snacks', () => {
    const set6 = evalData.find((d) => d.id === 'set6');
    expect(set6).toBeDefined();
    expect(set6.recommended.toLowerCase()).toMatch(/chitato lite|happy tos/i);
  });
});

describe('Golden Meal_03_compare — Direct OCR Panel Verbatim Faithfulness', () => {
  const evalPath = path.join(__dirname, '..', 'prototype', 'meallog', 'compare', 'six_cases_precision_eval.json');
  const evalData: any[] = fs.existsSync(evalPath) ? JSON.parse(fs.readFileSync(evalPath, 'utf-8')) : [];

  it('Set 1: verbatim locks held on printed SilverQueen chocolate panel', () => {
    const set1 = evalData.find((d) => d.id === 'set1');
    expect(set1).toBeDefined();
    const confGroup = set1.data.groups.find((g: any) => g.items.some((it: string) => it.includes('SilverQueen')));
    expect(confGroup).toBeDefined();
    // Printed nutrition panel: 110 kcal / 20g serving -> 535-550 kcal/100g
    expect(confGroup.averageNutrientsPer100g.calories).toBeGreaterThanOrEqual(520);
    expect(confGroup.averageNutrientsPer100g.calories).toBeLessThanOrEqual(560);
    expect(confGroup.averageNutrientsPer100g.saturatedFat).toBeGreaterThanOrEqual(14);
  });

  it('Set 2: verbatim locks held on all 4 reference nutrition fact panels', () => {
    const set2 = evalData.find((d) => d.id === 'set2');
    expect(set2).toBeDefined();
    expect(set2.data.groups).toHaveLength(4);

    // Blue bread: 120 kcal / 44g serving = 273 kcal/100g
    const blueGroup = set2.data.groups.find((g: any) => g.items.some((it: string) => it.includes('Blue')));
    expect(blueGroup).toBeDefined();
    expect(blueGroup.averageNutrientsPer100g.calories).toBeCloseTo(273, 0);

    // Green snack: 90 kcal / 23g serving = 391 kcal/100g
    const greenGroup = set2.data.groups.find((g: any) => g.items.some((it: string) => it.includes('Green')));
    expect(greenGroup).toBeDefined();
    expect(greenGroup.averageNutrientsPer100g.calories).toBeCloseTo(391, 0);
  });
});

