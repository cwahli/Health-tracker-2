import { searchBrandMenuItems } from './serverBrandMenu.js';
async function run() {
  const results = await searchBrandMenuItems("Sainsbury oat", "sainsbury");
  console.log(JSON.stringify(results, null, 2));
}
run();
