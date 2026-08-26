export interface FoodNutrientInput {
  protein: number;
  saturatedFat: number;
  addedSugar: number;
  totalFibre: number;
  sodium: number;
  carbohydrates: number;
}

export interface FoodItemInput {
  foodName: string;
  weightGrams?: number;
  estimatedWeightGrams?: number;
  packGrams?: number | null;
  cookingMethod?: string;
  sourceImageIndex?: number | null;
  rawNutritionLabel?: Record<string, any> | null;
  nutrients: FoodNutrientInput;
}

export interface DishNutrientsInput {
  saturatedFat: number;
  totalFat: number;
  totalSugar: number;
  potassium: number;
  omega3: number;
  calcium: number;
  iron: number;
  magnesium: number;
  vitaminD: number;
}

export interface DishInput {
  dishName: string;
  chainName?: string | null;
  estimatedWeightGrams: number;
  cookingMethod: string;
  sourceImageIndex?: number;
  boundingBox2D?: number[];
  isStandaloneCondimentPacket?: boolean | null;
  foods: FoodItemInput[];
  dishNutrients: DishNutrientsInput;
}

export interface ProcessedFoodItem {
  foodName: string;
  estimatedWeightGrams: number;
  cookingMethod: string;
  protein: number;
  carbohydrates: number;
  saturatedFat: number;
  addedSugar: number;
  totalFibre: number;
  sodium: number;
  estimatedCalories: number;
}

export interface ProcessedDish {
  dishName: string;
  chainName?: string | null;
  estimatedWeightGrams: number;
  cookingMethod: string;
  foods: ProcessedFoodItem[];
  // Calculated & Combined Nutrients
  calories: number;
  protein: number;
  carbohydrates: number;
  totalFat: number;
  saturatedFat: number;
  unsaturatedFat: number;
  totalSugar: number;
  addedSugar: number;
  totalFibre: number;
  sodium: number;
  saltGrams: number;
  potassium: number;
  omega3: number;
  calcium: number;
  iron: number;
  magnesium: number;
  vitaminD: number;
}

export interface ProcessedMeal {
  dishes: ProcessedDish[];
  totalMealWeightGrams: number;
  totals: {
    calories: number;
    protein: number;
    carbohydrates: number;
    totalFat: number;
    saturatedFat: number;
    unsaturatedFat: number;
    totalSugar: number;
    addedSugar: number;
    totalFibre: number;
    sodium: number;
    saltGrams: number;
    potassium: number;
    omega3: number;
    calcium: number;
    iron: number;
    magnesium: number;
    vitaminD: number;
  };
}

/**
 * Pure TypeScript deterministic backend calculation engine for the hierarchical Dish-Food schema.
 */
export function calculateMealNutrients(dishes: DishInput[]): ProcessedMeal {
  const processedDishes: ProcessedDish[] = [];

  for (const dish of dishes) {
    const processedFoods: ProcessedFoodItem[] = [];
    let dishProtein = 0;
    let dishCarbs = 0;
    let dishAddedSugar = 0;
    let dishFibre = 0;
    let dishSodium = 0;

    for (const food of dish.foods || []) {
      const p = Math.max(0, food.nutrients?.protein || 0);
      const c = Math.max(0, food.nutrients?.carbohydrates || 0);
      const satFat = Math.max(0, food.nutrients?.saturatedFat || 0);
      const addSug = Math.max(0, food.nutrients?.addedSugar || 0);
      const fib = Math.max(0, food.nutrients?.totalFibre || 0);
      const sod = Math.max(0, food.nutrients?.sodium || 0);

      dishProtein += p;
      dishCarbs += c;
      dishAddedSugar += addSug;
      dishFibre += fib;
      dishSodium += sod;

      // Bottom-up food calorie estimate using 4P + 4C + 9*SatFat (minimum floor)
      const foodCal = Math.round((4 * p) + (4 * c) + (9 * satFat));

      processedFoods.push({
        foodName: food.foodName,
        estimatedWeightGrams: food.weightGrams ?? food.estimatedWeightGrams ?? 0,
        cookingMethod: food.cookingMethod || dish.cookingMethod || "unknown",
        protein: round1(p),
        carbohydrates: round1(c),
        saturatedFat: round1(satFat),
        addedSugar: round1(addSug),
        totalFibre: round1(fib),
        sodium: round0(sod),
        estimatedCalories: foodCal,
      });
    }

    const dishTotalFat = Math.max(0, dish.dishNutrients?.totalFat || 0);
    const dishSatFat = Math.max(
      dish.dishNutrients?.saturatedFat || 0,
      processedFoods.reduce((sum, f) => sum + f.saturatedFat, 0)
    );
    const dishUnsatFat = Math.max(0, dishTotalFat - dishSatFat);
    const dishTotalSugar = Math.max(dish.dishNutrients?.totalSugar || 0, dishAddedSugar);
    const dishPotassium = Math.max(0, dish.dishNutrients?.potassium || 0);
    const dishOmega3 = Math.max(0, dish.dishNutrients?.omega3 || 0);
    const dishCalcium = Math.max(0, dish.dishNutrients?.calcium || 0);
    const dishIron = Math.max(0, dish.dishNutrients?.iron || 0);
    const dishMagnesium = Math.max(0, dish.dishNutrients?.magnesium || 0);
    const dishVitaminD = Math.max(0, dish.dishNutrients?.vitaminD || 0);

    // Strict Atwater Formula (4 * Protein + 4 * Carbs + 9 * TotalFat)
    const dishCalories = Math.round((4 * dishProtein) + (4 * dishCarbs) + (9 * dishTotalFat));
    const saltGrams = round2((dishSodium * 2.5) / 1000);

    processedDishes.push({
      dishName: dish.dishName,
      chainName: dish.chainName || null,
      estimatedWeightGrams: dish.estimatedWeightGrams || 0,
      cookingMethod: dish.cookingMethod || "unknown",
      foods: processedFoods,
      calories: dishCalories,
      protein: round1(dishProtein),
      carbohydrates: round1(dishCarbs),
      totalFat: round1(dishTotalFat),
      saturatedFat: round1(dishSatFat),
      unsaturatedFat: round1(dishUnsatFat),
      totalSugar: round1(dishTotalSugar),
      addedSugar: round1(dishAddedSugar),
      totalFibre: round1(dishFibre),
      sodium: round0(dishSodium),
      saltGrams,
      potassium: round0(dishPotassium),
      omega3: round2(dishOmega3),
      calcium: round1(dishCalcium),
      iron: round2(dishIron),
      magnesium: round1(dishMagnesium),
      vitaminD: round2(dishVitaminD),
    });
  }

  // Roll up total meal
  const totalMealWeightGrams = processedDishes.reduce((sum, d) => sum + d.estimatedWeightGrams, 0);
  const totals = {
    calories: processedDishes.reduce((sum, d) => sum + d.calories, 0),
    protein: round1(processedDishes.reduce((sum, d) => sum + d.protein, 0)),
    carbohydrates: round1(processedDishes.reduce((sum, d) => sum + d.carbohydrates, 0)),
    totalFat: round1(processedDishes.reduce((sum, d) => sum + d.totalFat, 0)),
    saturatedFat: round1(processedDishes.reduce((sum, d) => sum + d.saturatedFat, 0)),
    unsaturatedFat: round1(processedDishes.reduce((sum, d) => sum + d.unsaturatedFat, 0)),
    totalSugar: round1(processedDishes.reduce((sum, d) => sum + d.totalSugar, 0)),
    addedSugar: round1(processedDishes.reduce((sum, d) => sum + d.addedSugar, 0)),
    totalFibre: round1(processedDishes.reduce((sum, d) => sum + d.totalFibre, 0)),
    sodium: round0(processedDishes.reduce((sum, d) => sum + d.sodium, 0)),
    saltGrams: round2(processedDishes.reduce((sum, d) => sum + d.saltGrams, 0)),
    potassium: round0(processedDishes.reduce((sum, d) => sum + d.potassium, 0)),
    omega3: round2(processedDishes.reduce((sum, d) => sum + d.omega3, 0)),
    calcium: round1(processedDishes.reduce((sum, d) => sum + d.calcium, 0)),
    iron: round2(processedDishes.reduce((sum, d) => sum + d.iron, 0)),
    magnesium: round1(processedDishes.reduce((sum, d) => sum + d.magnesium, 0)),
    vitaminD: round2(processedDishes.reduce((sum, d) => sum + d.vitaminD, 0)),
  };

  return {
    dishes: processedDishes,
    totalMealWeightGrams,
    totals,
  };
}

/**
 * Rescales a meal by a given multiplier (e.g. 0.5 for half, 2.0 for double)
 * in pure TypeScript with zero API calls.
 */
export function rescaleMealPortion(meal: ProcessedMeal, multiplier: number): ProcessedMeal {
  return {
    totalMealWeightGrams: Math.round(meal.totalMealWeightGrams * multiplier),
    dishes: meal.dishes.map(d => ({
      ...d,
      estimatedWeightGrams: Math.round(d.estimatedWeightGrams * multiplier),
      calories: Math.round(d.calories * multiplier),
      protein: round1(d.protein * multiplier),
      carbohydrates: round1(d.carbohydrates * multiplier),
      totalFat: round1(d.totalFat * multiplier),
      saturatedFat: round1(d.saturatedFat * multiplier),
      unsaturatedFat: round1(d.unsaturatedFat * multiplier),
      totalSugar: round1(d.totalSugar * multiplier),
      addedSugar: round1(d.addedSugar * multiplier),
      totalFibre: round1(d.totalFibre * multiplier),
      sodium: Math.round(d.sodium * multiplier),
      saltGrams: round2(d.saltGrams * multiplier),
      potassium: Math.round(d.potassium * multiplier),
      omega3: round2(d.omega3 * multiplier),
      calcium: round1(d.calcium * multiplier),
      iron: round2(d.iron * multiplier),
      magnesium: round1(d.magnesium * multiplier),
      vitaminD: round2(d.vitaminD * multiplier),
      foods: d.foods.map(f => ({
        ...f,
        estimatedWeightGrams: Math.round(f.estimatedWeightGrams * multiplier),
        estimatedCalories: Math.round(f.estimatedCalories * multiplier),
        protein: round1(f.protein * multiplier),
        carbohydrates: round1(f.carbohydrates * multiplier),
        saturatedFat: round1(f.saturatedFat * multiplier),
        addedSugar: round1(f.addedSugar * multiplier),
        totalFibre: round1(f.totalFibre * multiplier),
        sodium: Math.round(f.sodium * multiplier),
      })),
    })),
    totals: {
      calories: Math.round(meal.totals.calories * multiplier),
      protein: round1(meal.totals.protein * multiplier),
      carbohydrates: round1(meal.totals.carbohydrates * multiplier),
      totalFat: round1(meal.totals.totalFat * multiplier),
      saturatedFat: round1(meal.totals.saturatedFat * multiplier),
      unsaturatedFat: round1(meal.totals.unsaturatedFat * multiplier),
      totalSugar: round1(meal.totals.totalSugar * multiplier),
      addedSugar: round1(meal.totals.addedSugar * multiplier),
      totalFibre: round1(meal.totals.totalFibre * multiplier),
      sodium: Math.round(meal.totals.sodium * multiplier),
      saltGrams: round2(meal.totals.saltGrams * multiplier),
      potassium: Math.round(meal.totals.potassium * multiplier),
      omega3: round2(meal.totals.omega3 * multiplier),
      calcium: round1(meal.totals.calcium * multiplier),
      iron: round2(meal.totals.iron * multiplier),
      magnesium: round1(meal.totals.magnesium * multiplier),
      vitaminD: round2(meal.totals.vitaminD * multiplier),
    }
  };
}

function round0(val: number): number {
  return Math.round(val);
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}
