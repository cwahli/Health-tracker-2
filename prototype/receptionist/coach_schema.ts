/**
 * Health Coach (Health Baseline) Agent Schema
 * Directly reflects the production schema defined in server_routes_medical_gemini.ts (healthBaselineAnalyzeSchema)
 * rendered by HealthBaselineCard.tsx.
 */

export interface NutrientTargetItem {
  nutrientKey: string;
  targetValue: string;
  rationale: string;
}

export interface DailyActivityItem {
  activity: string;
  target: string;
}

export interface RiskCategoryItem {
  categoryName: string;
  level: "Low" | "Moderate" | "Elevated" | "High";
  targetTrajectory: string;
  nutrientTargets: NutrientTargetItem[];
  dailyActivities: DailyActivityItem[];
}

export interface GeneralNutrientTargets {
  calories: string;
  totalFat: string;
  solubleFibre: string;
  saturatedFat: string;
  protein: string;
  potassium: string;
  transFat: string;
  addedSugar: string;
  carbohydrates: string;
  totalFibre: string;
  sodium: string;
  unsaturatedFat: string;
  omega3: string;
  magnesium: string;
  calcium: string;
  iron: string;
  zinc: string;
  selenium: string;
  iodine: string;
  phosphorus: string;
  vitaminD: string;
  vitaminB12: string;
  folate: string;
  vitaminC: string;
  vitaminE: string;
  vitaminK: string;
  vitaminA: string;
  vitaminB6: string;
  thiamine: string;
  riboflavin: string;
  niacin: string;
  [key: string]: string;
}

export interface HealthCoachReport {
  timelineToOptimal: string;
  riskCategories: RiskCategoryItem[];
  topNutrientTargets: NutrientTargetItem[];
  topWeeklyNutrientTargets: NutrientTargetItem[];
  generalNutrientTargets: GeneralNutrientTargets;
}

export interface HealthCoachOutput {
  report: HealthCoachReport;
}
