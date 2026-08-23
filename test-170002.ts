import { config } from 'dotenv';
config();
async function run() {
  const response = await fetch(`https://api.nal.usda.gov/fdc/v1/food/170002?api_key=${process.env.USDA_API_KEY}`);
  const data = await response.json();
  const kcalNutrient = data.foodNutrients?.find((n: any) => n.nutrient?.name === "Energy" && String(n.nutrient?.unitName || "").toLowerCase() === "kcal");
  const proteinNutrient = data.foodNutrients?.find((n: any) => n.nutrient?.name === "Protein" && String(n.nutrient?.unitName || "").toLowerCase() === "g");
  console.log('Title:', data.description, 'kcal:', kcalNutrient?.amount, 'protein:', proteinNutrient?.amount);
}
run();
