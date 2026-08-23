import { config } from 'dotenv';
config();
async function run() {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${process.env.USDA_API_KEY}&query=potato%20raw&dataType=Foundation,SR%20Legacy&pageSize=1`;
  const response = await fetch(url);
  const data = await response.json();
  const f = data.foods[0];
  console.log('Food:', f.description);
  console.log('Nutrients:', f.foodNutrients.map((n: any) => `${n.nutrientName} (${n.unitName}): ${n.value}`));
}
run();
