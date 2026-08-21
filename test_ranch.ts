import { resolveInternalFood } from './server_food_catalog.js';

async function test() {
  const result = await resolveInternalFood("ranch dressing");
  console.log("Result:", result);
}
test();
