import { config } from 'dotenv';
config();

async function searchUSDA(query: string) {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${process.env.USDA_API_KEY}&query=${encodeURIComponent(query)}&dataType=Foundation,SR%20Legacy&pageSize=10`;
  const response = await fetch(url);
  const data = await response.json();
  const rawFoods = data.foods || [];
  console.log('Raw hits:', rawFoods.length);
  
  const queryHasOil = query.includes("oil");
  const queryHasPowder = query.includes("powder");

  const filtered = rawFoods.filter((f: any) => {
    const kcalNutrient = f.foodNutrients?.find((n: any) => n.nutrientName === "Energy" && String(n.unitName || "").toLowerCase() === "kcal");
    const kcal = kcalNutrient ? parseFloat(kcalNutrient.value) : 0;
    const proteinNutrient = f.foodNutrients?.find((n: any) => n.nutrientName === "Protein" && String(n.unitName || "").toLowerCase() === "g");
    const protein = proteinNutrient ? parseFloat(proteinNutrient.value) : 0;
    
    const name = (f.description || "").toLowerCase();
    const isExpectedZero = ["water", "tea", "coffee", "vinegar", "mustard", "diet", "zero", "salt", "spices", "herb", "seasoning", "broth", "bouillon", "extract", "flavoring"].some(k => name.includes(k) || query.includes(k));
    
    if (kcal === 0 && protein < 0.5 && !isExpectedZero) return false;
    if (!queryHasOil && name.includes("oil")) return false;
    if (!queryHasPowder && (name.includes("powder") || name.includes("mix, dry"))) return false;

    return true;
  });
  console.log('Filtered hits:', filtered.length);
  if (filtered.length > 0) console.log(filtered.map((f: any) => f.description));
}
searchUSDA('potato raw');
