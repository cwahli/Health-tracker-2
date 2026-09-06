import { resolveInternalFood } from './server_food_catalog.ts';
async function main() {
  console.log(await resolveInternalFood('donut malaysia matcha'));
}
main();
