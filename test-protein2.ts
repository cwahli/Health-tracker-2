import { config } from 'dotenv';
config();
async function run() {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${process.env.USDA_API_KEY}&query=potato%20raw&dataType=Foundation,SR%20Legacy&pageSize=3`;
  const response = await fetch(url);
  const text = await response.text();
  console.log(text.substring(0, 500));
}
run();
