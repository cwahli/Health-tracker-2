import { searchFoodCatalog } from './server_food_catalog.js';

async function run() {
  console.log("oat:", await searchFoodCatalog('oat'));
  console.log("mr oat:", await searchFoodCatalog('mr oat'));
}
run();
