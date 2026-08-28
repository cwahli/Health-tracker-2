import { searchFoodCatalog } from './server_food_catalog.js';

async function run() {
  console.log("g of mr oat:", await searchFoodCatalog('g of mr oat', 5));
  console.log("mr oat:", await searchFoodCatalog('mr oat', 5));
  console.log("oat:", await searchFoodCatalog('oat', 5));
}
run();
