export interface SugarDeductionInput {
  totalSugar: number;              // g, required — Total Sugar (printed, DB, or derived)
  addedSugarPrinted?: number | null; // g — ONLY set if literally printed/explicit; null otherwise
  carbohydrates?: number | null;
  totalFibre?: number | null;
  calories?: number | null;
  protein?: number | null;
  totalFat?: number | null;
  physicalForm?: string | null;    // reuse classifyUniversalPhysicalFormV3 output, e.g. 'SOLID_FRUIT_VEG'
  ingredientsList?: string | null;
}

export interface SugarDeductionResult {
  sugar: number;            // g, Total Sugar (possibly capped by carb-remainder check)
  addedSugar: number;       // g, derived Added Sugar
  naturalSugar: number;     // g
  derivationMethod:
    | 'label_explicit'
    | 'whole_food_immunity'
    | 'dairy_lactose_deduction'
    | 'no_sweetener_in_ingredients'
    | 'ingredient_sweetener_present'
    | 'carb_remainder_capped'
    | 'unresolved_default_full_sugar';
}

const SWEETENER_REGEX = /\b(sugar|sugars|syrup|honey|fructose|dextrose|sucrose|glucose|maltose|caramel|cane|molasses|agave|nectar|sweetener|corn\s*syrup|isoglucose|treacle)\b/i;

const LACTOSE_G_PER_100G = 4.5;

export function deduceSugarBreakdown(input: SugarDeductionInput): SugarDeductionResult {
  let totalSugar = Math.max(0, Number(input.totalSugar) || 0);

  // Carbohydrate remainder upper bound (applies regardless of path below)
  const carbs = input.carbohydrates != null ? Number(input.carbohydrates) : null;
  const fibre = input.totalFibre != null ? Number(input.totalFibre) : 0;
  if (carbs != null && !isNaN(carbs)) {
    const maxAvailable = Math.max(0, carbs - (fibre || 0));
    if (totalSugar > maxAvailable) {
      totalSugar = maxAvailable;
    }
  }

  // 1. Explicit printed Added Sugar always wins (US FDA "Includes Xg Added Sugars")
  if (input.addedSugarPrinted != null && !isNaN(Number(input.addedSugarPrinted))) {
    const added = Math.min(Math.max(0, Number(input.addedSugarPrinted)), totalSugar);
    return {
      sugar: round1(totalSugar),
      addedSugar: round1(added),
      naturalSugar: round1(Math.max(0, totalSugar - added)),
      derivationMethod: 'label_explicit',
    };
  }

  const form = String(input.physicalForm || '').toUpperCase();

  // 2. Whole Food Immunity Rule
  if (form === 'SOLID_FRUIT_VEG' || form === 'SOLID_MEAT_FISH') {
    return {
      sugar: round1(totalSugar),
      addedSugar: 0,
      naturalSugar: round1(totalSugar),
      derivationMethod: 'whole_food_immunity',
    };
  }

  // 3. Plain Dairy Immunity Rule (lactose deduction)
  if (form === 'SOLID_CHEESE_DAIRY') {
    const natural = Math.min(LACTOSE_G_PER_100G, totalSugar);
    const added = Math.max(0, totalSugar - natural);
    return {
      sugar: round1(totalSugar),
      addedSugar: round1(added),
      naturalSugar: round1(natural),
      derivationMethod: 'dairy_lactose_deduction',
    };
  }

  // 4. Ingredient sweetener check
  const hasSweetener = input.ingredientsList ? SWEETENER_REGEX.test(input.ingredientsList) : null;
  if (hasSweetener === false) {
    return {
      sugar: round1(totalSugar),
      addedSugar: 0,
      naturalSugar: round1(totalSugar),
      derivationMethod: 'no_sweetener_in_ingredients',
    };
  }
  if (hasSweetener === true) {
    return {
      sugar: round1(totalSugar),
      addedSugar: round1(totalSugar),
      naturalSugar: 0,
      derivationMethod: 'ingredient_sweetener_present',
    };
  }

  // 5. Unresolved: no ingredients list, no whole-food/dairy classification, no printed added sugar.
  // Conservative default: treat as fully added (matches pre-fix behavior for genuinely unknown
  // processed items, but whole foods/dairy/ingredient-checked items never reach this branch).
  return {
    sugar: round1(totalSugar),
    addedSugar: round1(totalSugar),
    naturalSugar: 0,
    derivationMethod: 'unresolved_default_full_sugar',
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
