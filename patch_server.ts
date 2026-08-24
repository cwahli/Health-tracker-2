import fs from 'fs';
let code = fs.readFileSync('server.ts', 'utf8');

// Find the function definition
const defMatch = code.match(/export const getHeadNoun = \([\s\S]*?      export const getClinicalDefaultNutrients100g = \([\s\S]*?\n      };\n/);
if (defMatch) {
  const funcDef = defMatch[0];
  // Remove from current place
  code = code.replace(funcDef, '');
  // Place it near the top (e.g., after the imports)
  code = code.replace(/import \{ NUTRIENT_KEYS \} from '\.\/server_food_catalog\.js';\n/, "import { NUTRIENT_KEYS } from './server_food_catalog.js';\n\n" + funcDef.replace(/      export/g, 'export') + "\n");
  fs.writeFileSync('server.ts', code);
  console.log("Moved successfully.");
} else {
  console.log("Not found.");
}
