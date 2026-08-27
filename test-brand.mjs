import { matchBrandMenu } from './dist/server_brand_match.js';
(async () => {
  const result = await matchBrandMenu(null, "Boiled Rolled Oats with Water", "Boiled Rolled Oats with Water");
  console.log(result);
})();
