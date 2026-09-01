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
  packageLabelText?: string | null;
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

export interface SummaryNutrientsInput {
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

export interface ScoutMealResponse {
  _internalReasoning: string;
  contentType: string;
  diningEnvironment: string;
  mealName: string;
  dishes: DishInput[];
  verdict: {
    label: string;
    level: "good" | "warning" | "alert" | "neutral";
  };
  message: string;
  summaryNutrients: SummaryNutrientsInput;
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
  boundingBox2D?: number[];
  foods: ProcessedFoodItem[];
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

export interface ProcessedCompleteMeal {
  mealName: string;
  diningEnvironment: string;
  contentType: string;
  _internalReasoning: string;
  verdict: {
    label: string;
    level: "good" | "warning" | "alert" | "neutral";
  };
  message: string;
  dishes: ProcessedDish[];
  totalMealWeightGrams: number;
  totals: {
    // Macronutrients & Core Ledger
    calories: number;
    protein: number;
    carbohydrates: number;
    totalFat: number;
    saturatedFat: number;
    unsaturatedFat: number;
    transFat: number;
    totalSugar: number;
    addedSugar: number;
    totalFibre: number;
    sodium: number;
    saltGrams: number;
    // Dish level minerals & vitamins
    potassium: number;
    omega3: number;
    calcium: number;
    iron: number;
    magnesium: number;
    vitaminD: number;
    // 15 Summary Micronutrients
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
  };
}

function round0(n: number): number {
  return Math.round(n);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calculateCompleteMeal(scoutOutput: ScoutMealResponse): ProcessedCompleteMeal {
  const processedDishes: ProcessedDish[] = [];

  for (const dish of scoutOutput.dishes || []) {
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

    const dishCalories = Math.round((4 * dishProtein) + (4 * dishCarbs) + (9 * dishTotalFat));
    const saltGrams = round2((dishSodium * 2.5) / 1000);

    processedDishes.push({
      dishName: dish.dishName,
      chainName: dish.chainName || null,
      estimatedWeightGrams: dish.estimatedWeightGrams || 0,
      cookingMethod: dish.cookingMethod || "unknown",
      boundingBox2D: dish.boundingBox2D,
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

  const totalMealWeightGrams = processedDishes.reduce((sum, d) => sum + d.estimatedWeightGrams, 0);
  const totalProtein = round1(processedDishes.reduce((sum, d) => sum + d.protein, 0));
  const totalCarbs = round1(processedDishes.reduce((sum, d) => sum + d.carbohydrates, 0));
  const totalFat = round1(processedDishes.reduce((sum, d) => sum + d.totalFat, 0));
  const totalSatFat = round1(processedDishes.reduce((sum, d) => sum + d.saturatedFat, 0));
  const totalUnsatFat = round1(Math.max(0, totalFat - totalSatFat));
  const totalCalories = Math.round((4 * totalProtein) + (4 * totalCarbs) + (9 * totalFat));

  const totalSugar = round1(processedDishes.reduce((sum, d) => sum + d.totalSugar, 0));
  const totalAddedSugar = round1(processedDishes.reduce((sum, d) => sum + d.addedSugar, 0));
  const totalFibre = round1(processedDishes.reduce((sum, d) => sum + d.totalFibre, 0));
  const totalSodium = round0(processedDishes.reduce((sum, d) => sum + d.sodium, 0));
  const totalSaltGrams = round2((totalSodium * 2.5) / 1000);

  const totalPotassium = round0(processedDishes.reduce((sum, d) => sum + d.potassium, 0));
  const totalOmega3 = round2(processedDishes.reduce((sum, d) => sum + d.omega3, 0));
  const totalCalcium = round1(processedDishes.reduce((sum, d) => sum + d.calcium, 0));
  const totalIron = round2(processedDishes.reduce((sum, d) => sum + d.iron, 0));
  const totalMagnesium = round1(processedDishes.reduce((sum, d) => sum + d.magnesium, 0));
  const totalVitaminD = round2(processedDishes.reduce((sum, d) => sum + d.vitaminD, 0));

  const sn = scoutOutput.summaryNutrients || ({} as SummaryNutrientsInput);

  return {
    mealName: scoutOutput.mealName || "Analyzed Meal",
    diningEnvironment: scoutOutput.diningEnvironment || "unknown",
    contentType: scoutOutput.contentType || "visual",
    _internalReasoning: scoutOutput._internalReasoning || "",
    verdict: scoutOutput.verdict || { label: "Balanced meal", level: "good" },
    message: scoutOutput.message || "",
    dishes: processedDishes,
    totalMealWeightGrams,
    totals: {
      calories: totalCalories,
      protein: totalProtein,
      carbohydrates: totalCarbs,
      totalFat,
      saturatedFat: totalSatFat,
      unsaturatedFat: totalUnsatFat,
      transFat: 0,
      totalSugar,
      addedSugar: totalAddedSugar,
      totalFibre,
      sodium: totalSodium,
      saltGrams: totalSaltGrams,
      potassium: totalPotassium,
      omega3: totalOmega3,
      calcium: totalCalcium,
      iron: totalIron,
      magnesium: totalMagnesium,
      vitaminD: totalVitaminD,
      // 15 Summary Micronutrients
      solubleFibre: round1(sn.solubleFibre || 0),
      vitaminA: round1(sn.vitaminA || 0),
      thiamine: round2(sn.thiamine || 0),
      riboflavin: round2(sn.riboflavin || 0),
      niacin: round1(sn.niacin || 0),
      vitaminB6: round2(sn.vitaminB6 || 0),
      folate: round1(sn.folate || 0),
      vitaminB12: round2(sn.vitaminB12 || 0),
      vitaminC: round1(sn.vitaminC || 0),
      vitaminE: round1(sn.vitaminE || 0),
      vitaminK: round1(sn.vitaminK || 0),
      zinc: round1(sn.zinc || 0),
      selenium: round1(sn.selenium || 0),
      iodine: round1(sn.iodine || 0),
      phosphorus: round1(sn.phosphorus || 0),
    },
  };
}
