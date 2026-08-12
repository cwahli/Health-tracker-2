import fs from 'fs';
import path from 'path';

function assertIn(file, text) {
  const content = fs.readFileSync(file, 'utf8');
  if (!content.includes(text)) {
    console.error(`Assertion failed: "${text}" not found in ${file}`);
    process.exit(1);
  }
}

try {
  // P0
  assertIn('server_query_set.ts', 'buildFoodSearchQuerySet');
  assertIn('server.ts', 'buildFoodSearchQuerySet');
  assertIn('server.ts', 'BrandGuard');
  // P1
  assertIn('server_fdc_resolve.ts', 'ResolveClass');
  // P2
  assertIn('server_food_resolver_curator.ts', 'merge_duplicates');
  assertIn('server_food_resolver_curator.ts', 'quarantine');
  assertIn('agents/foodResolverInstructions.ts', 'merge_duplicates');
  // P3
  assertIn('server_nutrient_basis.ts', 'normalizeToPer100g');
  assertIn('server_nutrient_basis.ts', 'isPlausibleNutrients');
  // P4
  assertIn('server_prep_policy.ts', 'PrepXOR');
  
  console.log('All M30 assertions passed.');
  process.exit(0);
} catch (e) {
  console.error(e);
  process.exit(1);
}
