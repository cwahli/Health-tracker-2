import fs from 'fs';
let code = fs.readFileSync('server_pure_helpers.test.ts', 'utf8');

// For applySatFatAndAddedSugarFloor tests
code = code.replace(
  /applySatFatAndAddedSugarFloor\("Cheeseburger", nutrients, "estimated"\)/g,
  'applySatFatAndAddedSugarFloor("Cheeseburger", nutrients, undefined)'
);
code = code.replace(
  /applySatFatAndAddedSugarFloor\("Butter Croissant", nutrients, "estimated"\)/g,
  'applySatFatAndAddedSugarFloor("Butter Croissant", nutrients, undefined)'
);
code = code.replace(
  /applySatFatAndAddedSugarFloor\("Chocolate Cake", nutrients, "estimated"\)/g,
  'applySatFatAndAddedSugarFloor("Chocolate Cake", nutrients, undefined)'
);

// For applyNutrientRealityChecks test
code = code.replace(
  /applyNutrientRealityChecks\('Fruit Jelly Dessert', 120, nutrients, 50, undefined, 'estimated'\)/g,
  'applyNutrientRealityChecks(\'Fruit Jelly Dessert\', 120, nutrients, 50, undefined, undefined)'
);

fs.writeFileSync('server_pure_helpers.test.ts', code);
console.log("Patched tests.");
