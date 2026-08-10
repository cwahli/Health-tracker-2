export const NUTRIENT_KEYS = [
  "calories", "protein", "totalFat", "saturatedFat", "transFat", "unsaturatedFat", "omega3", 
  "carbohydrates", "sugar", "addedSugar", "totalFibre", "solubleFibre", "sodium", "potassium", 
  "magnesium", "calcium", "iron", "zinc", "selenium", "iodine", "phosphorus", 
  "vitaminD", "vitaminB12", "folate", "vitaminC", "vitaminE", "vitaminK", 
  "vitaminA", "vitaminB6", "thiamine", "riboflavin", "niacin"
];

export const CORE_NUTRIENT_KEYS = [
  "calories", "solubleFibre", "saturatedFat", "protein", "potassium", "transFat", "addedSugar", "carbohydrates", "totalFibre", "sodium"
];

export const ADDITIONAL_NUTRIENT_KEYS = [
  "unsaturatedFat", "omega3", "magnesium", "calcium", "iron", "zinc", "selenium", "iodine", "phosphorus",
  "vitaminD", "vitaminB12", "folate", "vitaminC", "vitaminE", "vitaminK", "vitaminA", "vitaminB6", "thiamine", "riboflavin", "niacin"
];

export const PRIMARY_NUTRIENTS = ["calories", "saturatedFat", "sodium"];

export const isCoreNutrient = (key: string): boolean => {
  if (!key) return false;
  const clean = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (clean === 'carbs' || clean === 'fibre' || clean === 'calorie') return true;
  return CORE_NUTRIENT_KEYS.some(k => k.toLowerCase().replace(/[^a-z0-9]/g, '') === clean);
};

export const isAdditionalNutrient = (key: string): boolean => {
  if (!key) return false;
  const clean = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['vitaminb9', 'vitaminb1', 'vitaminb2', 'vitaminb3', 'omega3fattyacids'].includes(clean)) return true;
  return ADDITIONAL_NUTRIENT_KEYS.some(k => k.toLowerCase().replace(/[^a-z0-9]/g, '') === clean);
};

export function cleanNutrientVal(val: any): number {
  if (val === null || val === undefined || isNaN(Number(val))) return 0;
  let num = Number(val);
  if (num < 0) num = 0;
  // Eliminate floating point representation noise (e.g., 61.699999999999996 -> 61.7)
  num = Math.round(num * 100) / 100;
  if (num >= 10) {
    num = Math.round(num * 10) / 10;
  }
  return num;
}

export function formatNutrientDisplayValue(val: any, unit: string = ''): string {
  if (val === null || val === undefined || isNaN(Number(val))) return '--';
  const cleaned = cleanNutrientVal(val);
  return unit ? `${cleaned} ${unit}` : `${cleaned}`;
}



