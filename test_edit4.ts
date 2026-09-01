import { buildSavableMealFromParsed } from './server_meal_orchestrator.ts';
import { projectDietitianInput } from './src/mealBuild/projectors.ts';
import { migrateMealSchema } from './src/mealBuild/consolidate.ts';

const activeMeal = {
  name: "Ikan Nilai Bakar",
  itemsBreakdown: [
    { scoutIndex: 0, name: "Ikan Nilai", weightGrams: 200, nutrients: { calories: 200 } },
    { scoutIndex: 1, name: "Es Teh Tawar", weightGrams: 100, nutrients: { calories: 0 } }
  ]
};

// Simulate server_food_analyze_run.ts behavior
let visionScoutItems: any[] = [];
visionScoutItems = activeMeal.itemsBreakdown.map((it: any, idx: number) => {
  return {
    scoutIndex: it.scoutIndex ?? idx,
    originalName: it.name || "Food Item",
    weightGrams: it.weightGrams,
    nutrients: it.nutrients
  };
});

const preCalculatedItems = visionScoutItems.map((vItem: any) => {
  return {
    scoutIndex: vItem.scoutIndex,
    originalName: vItem.originalName,
    weightGrams: vItem.weightGrams,
    nutrients: vItem.nutrients
  };
});

const dietitianTempMeal = buildSavableMealFromParsed(preCalculatedItems, activeMeal, null, null);
const projection = projectDietitianInput(dietitianTempMeal);

console.log("itemsSummary length:", projection.itemsSummary.length);
