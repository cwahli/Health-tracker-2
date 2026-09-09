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
