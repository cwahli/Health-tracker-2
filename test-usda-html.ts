import { config } from 'dotenv';
config();
async function run() {
  const response = await fetch(`https://api.nal.usda.gov/fdc/v1/food/170002?api_key=${process.env.USDA_API_KEY}`);
  const text = await response.text();
  console.log(text.substring(0, 300));
}
run();
