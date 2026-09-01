import { buildSavableMealFromParsed } from './server_meal_orchestrator.ts';
import { projectDietitianInput } from './src/mealBuild/projectors.ts';
import { formatDietitianProjectionBlock } from './src/mealBuild/stageLifecycle.ts';
import { migrateMealSchema } from './src/mealBuild/consolidate.ts';

const activeMeal = {
  name: "Ikan Nilai Bakar",
  itemsBreakdown: [
    { scoutIndex: 0, originalName: "Ikan Nilai", weightGrams: 200, nutrients: { calories: 200 } }
  ]
};

console.log("migrateMealSchema.items length:", migrateMealSchema(activeMeal).items?.length);

const preCalc = [
  { scoutIndex: 0, originalName: "Ikan Nilai", weightGrams: 200, nutrients: { calories: 200 } }
];

const meal = buildSavableMealFromParsed(preCalc, activeMeal, null, null);
console.log("buildSavableMealFromParsed items length:", meal.items?.length);
console.log("buildSavableMealFromParsed items:", JSON.stringify(meal.items));

const projection = projectDietitianInput(meal);
console.log("formatDietitianProjectionBlock:\n", formatDietitianProjectionBlock(projection));
