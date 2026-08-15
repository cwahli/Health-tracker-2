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
  foodName?: string | null;        // dish / ingredient name for sweetener classification
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
    | 'designated_sweetener_check'
    | 'unresolved_default_full_sugar';
}

const SWEETENER_REGEX = /\b(sugar|sugars|syrup|honey|fructose|dextrose|sucrose|glucose|maltose|caramel|cane|molasses|agave|nectar|sweetener|corn\s*syrup|isoglucose|treacle)\b/i;
const DESIGNATED_SWEETENER_REGEX = /\b(sugar|syrup|honey|glaze|icing|frosting|sweetener|caramel|jam|jelly|sweet\s*sauce|candy|chocolate|toffee|agave|treacle|marshmallow|sweetened|confectionery|dessert|cookie|cake|pastry|doughnut|donut|cinnamon\s*roll|croissant|danish|muffin|brownie|cane)\b/i;
const BAKERY_DISH_REGEX = /\b(cinnamon(\s*roll)?|croissant|pastry|danish|donut|doughnut|muffin|brownie|cookie|cake|glaze|icing|cane\s*sugar)\b/i;

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

  // 2. Whole Food Immunity Rule — not for bakery / glazed pastry (cinnamon roll, croissant)
  const bakeryName = BAKERY_DISH_REGEX.test(String(input.foodName || '')) || BAKERY_DISH_REGEX.test(String(input.ingredientsList || ''));
  if (!bakeryName && (form === 'SOLID_FRUIT_VEG' || form === 'SOLID_MEAT_FISH' || form === 'SOLID_GRAIN_STARCH')) {
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

  // 5. Designated sweetener foodName check
  if (input.foodName) {
    const isDesignated = DESIGNATED_SWEETENER_REGEX.test(input.foodName);
    if (!isDesignated) {
      // Non-sweetener whole dish/savory component defaults to natural sugar
      return {
        sugar: round1(totalSugar),
        addedSugar: 0,
        naturalSugar: round1(totalSugar),
        derivationMethod: 'designated_sweetener_check',
      };
    }
  }

  // 6. Unresolved default: for designated sweets without ingredients, treat as added sugar
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
