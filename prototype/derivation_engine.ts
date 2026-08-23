export interface BaseNutrients {
  calories: number;
  protein: number;
  totalFat: number;
  saturatedFat: number;
  transFat: number;
  addedSugar: number;
  totalSugar: number;
  totalFibre: number;
  sodium: number;
  potassium: number;
  omega3: number;
  calcium: number;
  iron: number;
  magnesium: number;
  vitaminD: number;
}

export interface DerivedNutrients {
  carbohydrates: number;
  unsaturatedFat: number;
  salt: number;
}

export interface CoreKeyNutrients extends BaseNutrients, DerivedNutrients {}

export interface ExtendedNutrients {
  solubleFibre: number;
  vitaminA: number;
  thiamine: number;
  riboflavin: number;
  niacin: number;
  vitaminB6: number;
  folate: number;
  vitaminB12: number;
  vitaminC: number;
  vitaminE: number;
  vitaminK: number;
  zinc: number;
  selenium: number;
  iodine: number;
  phosphorus: number;
}

export interface FullMealNutrients extends CoreKeyNutrients, ExtendedNutrients {}

/**
 * Calculates derived nutrients from base estimated nutrients.
 * Formulae:
 * - Carbohydrates (g): Math.max(0, (Calories - (4 * Protein) - (9 * TotalFat)) / 4)
 * - Unsaturated Fat (g): Math.max(0, TotalFat - (SaturatedFat + TransFat))
 * - Salt (g): (Sodium in mg * 2.54) / 1000
 */
export function calculateDerivedNutrients(base: BaseNutrients): DerivedNutrients {
  const calories = base.calories || 0;
  const protein = base.protein || 0;
  const totalFat = base.totalFat || 0;
  const saturatedFat = base.saturatedFat || 0;
  const transFat = base.transFat || 0;
  const sodium = base.sodium || 0;

  // Carbohydrates derived from energy equation
  const rawCarbs = (calories - 4 * protein - 9 * totalFat) / 4;
  const carbohydrates = Math.max(0, Math.round(rawCarbs * 10) / 10);

  // Unsaturated Fat derived from total minus sat and trans
  const rawUnsat = totalFat - (saturatedFat + transFat);
  const unsaturatedFat = Math.max(0, Math.round(rawUnsat * 10) / 10);

  // Salt in grams from Sodium in mg
  const rawSalt = (sodium * 2.54) / 1000;
  const salt = Math.round(rawSalt * 100) / 100;

  return {
    carbohydrates,
    unsaturatedFat,
    salt,
  };
}

/**
 * Compute full Core + Key nutrients for a single dish by combining base estimates with derived nutrients.
 */
export function computeDishCoreKeyNutrients(base: BaseNutrients): CoreKeyNutrients {
  const derived = calculateDerivedNutrients(base);
  return {
    ...base,
    ...derived,
  };
}

/**
 * Aggregate Core + Key nutrients across an array of dishes.
 */
export function aggregateDishNutrients(dishes: CoreKeyNutrients[]): CoreKeyNutrients {
  const totals: CoreKeyNutrients = {
    calories: 0,
    protein: 0,
    totalFat: 0,
    saturatedFat: 0,
    transFat: 0,
    addedSugar: 0,
    totalSugar: 0,
    totalFibre: 0,
    sodium: 0,
    potassium: 0,
    omega3: 0,
    calcium: 0,
    iron: 0,
    magnesium: 0,
    vitaminD: 0,
    carbohydrates: 0,
    unsaturatedFat: 0,
    salt: 0,
  };

  for (const dish of dishes) {
    totals.calories += dish.calories || 0;
    totals.protein += dish.protein || 0;
    totals.totalFat += dish.totalFat || 0;
    totals.saturatedFat += dish.saturatedFat || 0;
    totals.transFat += dish.transFat || 0;
    totals.addedSugar += dish.addedSugar || 0;
    totals.totalSugar += dish.totalSugar || 0;
    totals.totalFibre += dish.totalFibre || 0;
    totals.sodium += dish.sodium || 0;
    totals.potassium += dish.potassium || 0;
    totals.omega3 += dish.omega3 || 0;
    totals.calcium += dish.calcium || 0;
    totals.iron += dish.iron || 0;
    totals.magnesium += dish.magnesium || 0;
    totals.vitaminD += dish.vitaminD || 0;
    totals.carbohydrates += dish.carbohydrates || 0;
    totals.unsaturatedFat += dish.unsaturatedFat || 0;
    totals.salt += dish.salt || 0;
  }

  // Round aggregated totals to clean decimal places
  return {
    calories: Math.round(totals.calories),
    protein: Math.round(totals.protein * 10) / 10,
    totalFat: Math.round(totals.totalFat * 10) / 10,
    saturatedFat: Math.round(totals.saturatedFat * 10) / 10,
    transFat: Math.round(totals.transFat * 10) / 10,
    addedSugar: Math.round(totals.addedSugar * 10) / 10,
    totalSugar: Math.round(totals.totalSugar * 10) / 10,
    totalFibre: Math.round(totals.totalFibre * 10) / 10,
    sodium: Math.round(totals.sodium),
    potassium: Math.round(totals.potassium),
    omega3: Math.round(totals.omega3 * 100) / 100,
    calcium: Math.round(totals.calcium),
    iron: Math.round(totals.iron * 10) / 10,
    magnesium: Math.round(totals.magnesium),
    vitaminD: Math.round(totals.vitaminD * 10) / 10,
    carbohydrates: Math.round(totals.carbohydrates * 10) / 10,
    unsaturatedFat: Math.round(totals.unsaturatedFat * 10) / 10,
    salt: Math.round(totals.salt * 100) / 100,
  };
}
