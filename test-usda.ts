import { config } from 'dotenv';
config();
async function run() {
  const query = 'potato raw';
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${process.env.USDA_API_KEY}&query=${encodeURIComponent(query)}&dataType=Foundation,SR%20Legacy&pageSize=3`;
  const res = await fetch(url);
  console.log('Status:', res.status, res.statusText);
  const text = await res.text();
  console.log('Body:', text.substring(0, 100));
}
run();
