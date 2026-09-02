export interface SugarDeductionInput {
  totalSugar?: number | null;              // g, Total Sugar (printed, DB, or derived)
  addedSugarPrinted?: number | null;       // g, ONLY set if literally printed/explicit; null otherwise
  carbohydrates?: number | null;
  totalFibre?: number | null;
  calories?: number | null;
  protein?: number | null;
  totalFat?: number | null;
  physicalForm?: string | null;            // e.g. 'SOLID_FRUIT_VEG', 'LIQUID_BEVERAGE', 'SOLID_CHEESE_DAIRY', 'SOLID_GRAIN_STARCH', 'SOLID_MEAT_FISH'
  foodType?: string | null;
  ingredientsList?: string | null;
  foodName?: string | null;                // dish / ingredient name for sweetener classification
}

export interface SugarDeductionResult {
  sugar: number;            // g, Total Sugar (mathematically bounded by available carbohydrates)
  addedSugar: number;       // g, Derived or printed Added Sugar (always <= sugar)
  naturalSugar: number;     // g, Natural Sugar (sugar - addedSugar, always >= 0)
  derivationMethod:
    | 'label_explicit'
    | 'whole_food_immunity'
    | 'dairy_lactose_deduction'
    | 'fruit_fructose_deduction'
    | 'no_sweetener_in_ingredients'
    | 'ingredient_sweetener_present'
    | 'carb_remainder_capped'
    | 'designated_sweetener_check'
    | 'savory_starch_matrix'
    | 'unresolved_default_full_sugar';
}

const SWEETENER_REGEX = /\b(sugar|sugars|syrup|honey|fructose|dextrose|sucrose|glucose|maltose|caramel|cane|molasses|agave|nectar|sweetener|corn\s*syrup|isoglucose|treacle|gula|pemanis|sirup|madu)\b/i;
const DESIGNATED_SWEETENER_REGEX = /\b(sugar|syrup|honey|glaze|icing|frosting|sweetener|caramel|jam|jelly|sweet\s*sauce|candy|chocolate|toffee|agave|treacle|marshmallow|sweetened|confectionery|dessert|cookie|cookies|cake|cakes|pastry|doughnut|donut|cinnamon\s*roll|croissant|danish|muffin|muffins|brownie|brownies|cane|boba|milkshake|frappe|soda|cola|es\s*teh\s*manis|sweet\s*tea)\b/i;
const BAKERY_DISH_REGEX = /\b(cinnamon(\s*roll)?|croissant|pastry|danish|donut|doughnut|muffin|muffins|brownie|brownies|cookie|cookies|cake|cakes|glaze|icing)\b/i;
const FRUIT_REGEX = /\b(fruit|fruits|orange|oranges|jeruk|lemon|lime|apple|apples|banana|bananas|grape|grapes|berry|berries|strawberry|strawberries|blueberry|blueberries|raspberry|raspberries|blackberry|blackberries|mango|mangoes|mangos|pineapple|pineapples|papaya|guava|watermelon|melon|cantaloupe|honeydew|coconut|kelapa|peach|peaches|pear|pears|plum|plums|cherry|cherries|juice|jus|smoothie|cider)\b/i;
const DAIRY_REGEX = /\b(milk|susu|yogurt|yoghurt|cheese|keju|latte|cappuccino|creamer|kefir|whey)\b/i;
const STARCH_REGEX = /\b(rice|nasi|potato|potatoes|kentang|pasta|spaghetti|noodle|noodles|mie|bihun|kwetiau|oat|oats|oatmeal|bread|roti|flour|tepung|corn|maize|cassava|singkong|taro|talas)\b/i;
const PURE_PROTEIN_REGEX = /\b(beef|steak|chicken|poultry|turkey|duck|pork|fish|salmon|tuna|catfish|cod|shrimp|prawn|squid|calamari|egg|eggs|tofu|tempeh|ikan|ayam|sapi|daging|telur)\b/i;

const LACTOSE_G_PER_100G = 4.8;

export function deduceSugarBreakdown(input: SugarDeductionInput): SugarDeductionResult {
  const carbs = input.carbohydrates != null && !isNaN(Number(input.carbohydrates)) ? Math.max(0, Number(input.carbohydrates)) : null;
  const fibre = input.totalFibre != null && !isNaN(Number(input.totalFibre)) ? Math.max(0, Number(input.totalFibre)) : 0;
  const availableCarbs = carbs != null ? Math.max(0, carbs - fibre) : null;

  const rawFoodName = String(input.foodName || '').toLowerCase();
  const rawIngredients = String(input.ingredientsList || '').toLowerCase();
  const combinedText = `${rawFoodName} ${rawIngredients} ${input.foodType || ''}`.toLowerCase();
  const form = String(input.physicalForm || '').toUpperCase();

  const isFruit = FRUIT_REGEX.test(combinedText) || form === 'SOLID_FRUIT_VEG';
  const isDairy = DAIRY_REGEX.test(combinedText) || form === 'SOLID_CHEESE_DAIRY';
  const isBakery = BAKERY_DISH_REGEX.test(combinedText);
  const isSweetener = SWEETENER_REGEX.test(rawIngredients) || DESIGNATED_SWEETENER_REGEX.test(rawFoodName);
  const isStarch = STARCH_REGEX.test(combinedText) || form === 'SOLID_GRAIN_STARCH';
  const isPureProtein = PURE_PROTEIN_REGEX.test(combinedText) && !isBakery && !isSweetener;

  let totalSugar = input.totalSugar != null && !isNaN(Number(input.totalSugar)) && Number(input.totalSugar) >= 0
    ? Number(input.totalSugar)
    : null;

  const hasExplicitPrintedAdded = input.addedSugarPrinted != null && !isNaN(Number(input.addedSugarPrinted)) && Number(input.addedSugarPrinted) >= 0;
  const printedAdded = hasExplicitPrintedAdded ? Number(input.addedSugarPrinted) : null;

  // If added sugar is explicitly printed/known, total sugar must be AT LEAST added sugar
  if (printedAdded != null) {
    if (totalSugar == null || totalSugar < printedAdded) {
      totalSugar = printedAdded;
    }
  }

  // 1. Explicit printed label Added Sugar handler (US FDA format)
  if (hasExplicitPrintedAdded && printedAdded != null) {
    let finalTotal = totalSugar ?? printedAdded;
    if (availableCarbs != null && finalTotal > availableCarbs && availableCarbs >= printedAdded) {
      finalTotal = availableCarbs;
    }
    const finalAdded = Math.min(printedAdded, finalTotal);
    const natural = Math.max(0, finalTotal - finalAdded);
    return {
      sugar: round1(finalTotal),
      addedSugar: round1(finalAdded),
      naturalSugar: round1(natural),
      derivationMethod: 'label_explicit',
    };
  }

  // 2. Whole Fresh Fruit / 100% Fruit Juice & Citrus Beverage Matrix
  if (isFruit && !isBakery && !SWEETENER_REGEX.test(rawIngredients)) {
    // If not sweetened with syrup/cane sugar, carbohydrates are natural simple fruit sugars (fructose/glucose)
    const naturalFrac = form === 'LIQUID_BEVERAGE' || /\b(juice|jus|drink|beverage|water|kelapa|es\b)\b/i.test(combinedText) ? 0.90 : 0.85;
    const estNaturalFromCarbs = availableCarbs != null ? Math.max(0, availableCarbs * naturalFrac) : 0;
    const finalSugar = totalSugar != null && totalSugar > 0 ? totalSugar : estNaturalFromCarbs;
    const cappedSugar = availableCarbs != null ? Math.min(finalSugar, availableCarbs) : finalSugar;

    return {
      sugar: round1(cappedSugar),
      addedSugar: 0,
      naturalSugar: round1(cappedSugar),
      derivationMethod: 'fruit_fructose_deduction',
    };
  }

  // 3. Plain Dairy Immunity Rule (lactose deduction)
  if (isDairy && !isBakery && !SWEETENER_REGEX.test(rawIngredients)) {
    const estLactose = availableCarbs != null ? Math.min(availableCarbs, 12.5) : (totalSugar ?? 0);
    const finalSugar = totalSugar != null && totalSugar > 0 ? totalSugar : estLactose;
    const cappedSugar = availableCarbs != null ? Math.min(finalSugar, availableCarbs) : finalSugar;

    return {
      sugar: round1(cappedSugar),
      addedSugar: 0,
      naturalSugar: round1(cappedSugar),
      derivationMethod: 'dairy_lactose_deduction',
    };
  }

  // 4. Whole Non-Sweetened Starch / Grains / Savory Dishes
  if ((isStarch || isPureProtein || form === 'SOLID_MEAT_FISH') && !isSweetener && !isBakery) {
    const estTraceSugar = availableCarbs != null ? Math.min(1.5, Math.max(0, availableCarbs * 0.02)) : (totalSugar ?? 0);
    const finalSugar = totalSugar != null && totalSugar > 0 ? totalSugar : estTraceSugar;
    const cappedSugar = availableCarbs != null ? Math.min(finalSugar, availableCarbs) : finalSugar;

    return {
      sugar: round1(cappedSugar),
      addedSugar: 0,
      naturalSugar: round1(cappedSugar),
      derivationMethod: 'savory_starch_matrix',
    };
  }

  // 5. Sweetened Dishes & Beverages (e.g. Sweet Tea, Brownie, Cakes, Sweetened Fruit Drinks)
  if (isSweetener || isBakery || DESIGNATED_SWEETENER_REGEX.test(rawFoodName)) {
    // If ingredients contain both fruit/dairy and added sweeteners (e.g. Es Jeruk with syrup, fruit smoothie with honey)
    let naturalSugar = 0;
    if (isFruit && availableCarbs != null) {
      naturalSugar = Math.round(availableCarbs * 0.25 * 10) / 10;
    } else if (isDairy && availableCarbs != null) {
      naturalSugar = Math.round(Math.min(availableCarbs * 0.4, 5.0) * 10) / 10;
    }

    const isPureSweetBeverage = (form === 'LIQUID_BEVERAGE' || /\b(tea|teh|soda|cola|coffee|kopi|beverage|drink|syrup|sirup|boba)\b/i.test(combinedText)) && !isFruit && !isDairy && !isBakery;
    const defaultSugarFrac = isPureSweetBeverage ? 1.0 : 0.75;

    let candidateSugar = totalSugar != null && totalSugar > 0 ? totalSugar : (availableCarbs != null ? Math.max(0, availableCarbs * defaultSugarFrac) : 0);
    if (availableCarbs != null && candidateSugar > availableCarbs) {
      candidateSugar = availableCarbs;
    }

    const derivedAdded = Math.max(0, candidateSugar - naturalSugar);
    const finalSugar = Math.max(candidateSugar, derivedAdded + naturalSugar);

    return {
      sugar: round1(finalSugar),
      addedSugar: round1(derivedAdded),
      naturalSugar: round1(naturalSugar),
      derivationMethod: 'ingredient_sweetener_present',
    };
  }

  // 6. Generic Fallback with Strict Bounds
  const fallbackSugar = totalSugar != null && totalSugar > 0
    ? totalSugar
    : (availableCarbs != null ? Math.min(availableCarbs, 2.0) : 0);
  const cappedFallback = availableCarbs != null ? Math.min(fallbackSugar, availableCarbs) : fallbackSugar;

  return {
    sugar: round1(cappedFallback),
    addedSugar: 0,
    naturalSugar: round1(cappedFallback),
    derivationMethod: 'unresolved_default_full_sugar',
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

