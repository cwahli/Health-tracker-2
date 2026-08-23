import { config } from 'dotenv';
config();

async function run() {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${process.env.USDA_API_KEY}&query=potato%20raw&dataType=Foundation,SR%20Legacy&pageSize=10`;
  const response = await fetch(url);
  const data = await response.json();
  const rawFoods = data.foods || [];
  
  const filtered = rawFoods.filter((f: any) => {
    const kcalNutrient = f.foodNutrients?.find((n: any) => n.nutrientName === "Energy" && String(n.unitName || "").toLowerCase() === "kcal");
    const kcal = kcalNutrient ? parseFloat(kcalNutrient.value) : 0;
    const proteinNutrient = f.foodNutrients?.find((n: any) => n.nutrientName === "Protein" && String(n.unitName || "").toLowerCase() === "g");
    const protein = proteinNutrient ? parseFloat(proteinNutrient.value) : 0;
    
    if (kcal === 0) console.log('KCAL=0 for', f.description, 'because nutrient was not found or 0');
    return true;
  });
}
run();
