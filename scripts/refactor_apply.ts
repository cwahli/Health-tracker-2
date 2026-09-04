import * as fs from 'fs';

let content = fs.readFileSync('server_food_analyze_run.ts', 'utf8');

// Replace the helper functions block (approx 541 to 654)
const helperStart = "    // Helper functions for nutritional data lookup";
const helperEnd = "    const buildWebSearchQuery = (item: any): string | null => {";
const startIndex = content.indexOf(helperStart);
if (startIndex !== -1) {
  let endIndex = content.indexOf("};", content.indexOf(helperEnd)) + 2;
  const chunk = content.substring(startIndex, endIndex);
  console.log("Found chunk to remove, length:", chunk.length);
  content = content.replace(chunk, "");
  
  // Add import at the top
  const importStr = "import { formatUSDANutrients, formatOFFNutrients, extractOFFNutrientsPer100g, isFastFoodChain, buildWebSearchQuery } from './src/server/food/server_food_analyze_helpers.js';\n";
  content = content.replace("import { z } from 'zod';", "import { z } from 'zod';\n" + importStr);
  
  fs.writeFileSync('server_food_analyze_run.ts', content);
  console.log("Replaced successfully!");
} else {
  console.log("Chunk not found!");
}
