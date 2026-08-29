const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const missingFunc = `
export const getHeadNoun = (name: string): string => {
  let n = (name || "").trim();
  n = n.split(",")[0];
  const connectors = [" made with ", " made from ", " prepared with ", " with ", " and "];
  for (const connector of connectors) {
    const idx = n.toLowerCase().indexOf(connector);
    if (idx !== -1) {
      n = n.substring(0, idx);
    }
  }
  return n.trim();
};

export const getClinicalDefaultNutrients100g = (name: string): Record<string, number> => {
  const { isGenericZeroNutrientDiluent } = require("./server_matching_engine.js");
  const { getFallbackCategoryProfile } = require("./server_food_catalog.js");
  const { NUTRIENT_KEYS } = require("./server_food_catalog.js");
  
  if (isGenericZeroNutrientDiluent(name)) {
    const zeroProf: Record<string, number> = {};
    NUTRIENT_KEYS.forEach((k: string) => { zeroProf[k] = 0; });
    return zeroProf;
  }
  const base = getFallbackCategoryProfile(name);
  const n = name.toLowerCase();
  let overrides: Partial<Record<string, number>> = {};
  if (n.includes("mayo") || n.includes("mayonnaise")) {
    overrides = { calories: 680, protein: 1, totalFat: 75, saturatedFat: 12, sodium: 600, carbohydrates: 1, transFat: 0, addedSugar: 0, potassium: 20, totalFibre: 0, solubleFibre: 0 };
  } else if (n.includes("sauce") || n.includes("dressing")) {
    overrides = { calories: 150, protein: 1, totalFat: 10, saturatedFat: 1.5, sodium: 800, carbohydrates: 15, transFat: 0, addedSugar: 5, potassium: 50, totalFibre: 0, solubleFibre: 0 };
  } else if (n.includes("sausage") || n.includes("salami") || n.includes("chorizo") || n.includes("pepperoni") || n.includes("frankfurter") || n.includes("bacon") || n.includes("pastrami") || n.includes("ham") || n.includes("cured")) {
    overrides = { calories: 320, protein: 18, totalFat: 26, saturatedFat: 9, sodium: 850, carbohydrates: 3, transFat: 0.3, addedSugar: 0, potassium: 250, totalFibre: 0, solubleFibre: 0 };
  } else if (n.includes("pizza") || n.includes("crust")) {
    overrides = { calories: 280, protein: 9, totalFat: 8, saturatedFat: 2.5, sodium: 550, carbohydrates: 42, transFat: 0, addedSugar: 2, potassium: 120, totalFibre: 2.5, solubleFibre: 0.5 };
  } else if (n.includes("beef") || n.includes("steak") || n.includes("meat")) {
    overrides = { calories: 250, protein: 26, totalFat: 15, saturatedFat: 6, sodium: 70, carbohydrates: 0, transFat: 0.1, addedSugar: 0, potassium: 350, totalFibre: 0, solubleFibre: 0 };
  } else if (n.includes("chicken") || n.includes("poultry") || n.includes("ayam")) {
    overrides = { calories: 165, protein: 31, totalFat: 3.6, saturatedFat: 1, sodium: 70, carbohydrates: 0, transFat: 0, addedSugar: 0, potassium: 220, totalFibre: 0, solubleFibre: 0 };
  } else if (n.includes("fish") || n.includes("ikan") || n.includes("salmon") || n.includes("tuna") || n.includes("shrimp") || n.includes("prawn")) {
    overrides = { calories: 120, protein: 20, totalFat: 4, saturatedFat: 1, sodium: 80, carbohydrates: 0, transFat: 0, addedSugar: 0, potassium: 300, totalFibre: 0, solubleFibre: 0 };
  } else if (n.includes("juice") || n.includes("beverage") || n.includes("drink")) {
    overrides = { calories: 45, protein: 0.5, totalFat: 0.1, saturatedFat: 0, sodium: 5, carbohydrates: 11, transFat: 0, addedSugar: 0, potassium: 150, totalFibre: 0.2, solubleFibre: 0 };
  } else if (n.includes("fruit") || n.includes("apple") || n.includes("melon") || n.includes("berry") || n.includes("orange") || n.includes("banana")) {
    overrides = { calories: 50, protein: 0.5, totalFat: 0.2, saturatedFat: 0, sodium: 1, carbohydrates: 13, transFat: 0, addedSugar: 0, potassium: 150, totalFibre: 2, solubleFibre: 0.5 };
  } else if (n.includes("cucumber") || n.includes("lettuce") || n.includes("tomato") || n.includes("leaf") || n.includes("salad") || n.includes("greens")) {
    overrides = { calories: 15, protein: 1, totalFat: 0.2, saturatedFat: 0, sodium: 5, carbohydrates: 3, transFat: 0, addedSugar: 0, potassium: 150, totalFibre: 1, solubleFibre: 0.2 };
  } else if (/\\boil\\b/.test(n) || n.includes("ghee") || n.includes("lard") || n.includes("shortening")) {
    overrides = { calories: 884, protein: 0, totalFat: 100, saturatedFat: 14, sodium: 2, carbohydrates: 0, transFat: 0, addedSugar: 0, potassium: 1, totalFibre: 0, solubleFibre: 0 };
  } else if (n.includes("pea") || n.includes("bean") || n.includes("lentil") || n.includes("corn") || n.includes("carrot") || n.includes("vegetable") || n.includes("veg")) {
    overrides = { calories: 65, protein: 3, totalFat: 0.5, saturatedFat: 0.1, sodium: 30, carbohydrates: 12, transFat: 0, addedSugar: 0, potassium: 200, totalFibre: 2, solubleFibre: 0.5 };
  } else if (n.includes("potato") || n.includes("wedge") || n.includes("yam")) {
    overrides = { calories: 90, protein: 2, totalFat: 0.1, saturatedFat: 0.02, sodium: 10, carbohydrates: 21, transFat: 0, addedSugar: 0, potassium: 400, totalFibre: 1.5, solubleFibre: 0.5 };
  } else if (n.includes("brownie") || n.includes("cake") || n.includes("cookie") || n.includes("chocolate") || n.includes("candy") || n.includes("dessert") || n.includes("tart") || n.includes("pie") || n.includes("fudge") || n.includes("biscuit") || n.includes("sweet")) {
    overrides = { calories: 450, protein: 5, totalFat: 24, saturatedFat: 12, sodium: 200, carbohydrates: 55, transFat: 0, addedSugar: 30, potassium: 150, totalFibre: 2, solubleFibre: 0.4 };
  } else if (n.includes("croissant") || n.includes("pastry") || n.includes("danish") || n.includes("brioche") || n.includes("muffin") || n.includes("scone") || n.includes("donut")) {
    overrides = { calories: 410, protein: 8, totalFat: 21, saturatedFat: 12, sodium: 450, carbohydrates: 46, transFat: 0, addedSugar: 8, potassium: 120, totalFibre: 2, solubleFibre: 0.4 };
  } else if (n.includes("bread") || n.includes("baguette") || n.includes("roll") || n.includes("bun") || n.includes("toast") || n.includes("dough")) {
    overrides = { calories: 250, protein: 8, totalFat: 3, saturatedFat: 0.5, sodium: 400, carbohydrates: 50, transFat: 0, addedSugar: 2, potassium: 100, totalFibre: 3, solubleFibre: 0.5 };
  } else if (n.includes("egg") || n.includes("omelet")) {
    overrides = { calories: 150, protein: 12, totalFat: 10, saturatedFat: 3, sodium: 130, carbohydrates: 1, transFat: 0, addedSugar: 0, potassium: 130, totalFibre: 0, solubleFibre: 0 };
  } else if (n.includes("braised") || n.includes("glazed") || n.includes("teriyaki") || n.includes("kung pao") || n.includes("sweet and sour") || n.includes("soy sauce")) {
    if (n.includes("tofu") || n.includes("tahu")) {
      overrides = { calories: 95, protein: 8.5, totalFat: 4.5, saturatedFat: 0.8, sodium: 480, carbohydrates: 5, transFat: 0, addedSugar: 2, potassium: 160, totalFibre: 1, solubleFibre: 0.2 };
    } else if (n.includes("chicken") || n.includes("beef") || n.includes("pork") || n.includes("meat")) {
      overrides = { calories: 200, protein: 24, totalFat: 8, saturatedFat: 2.5, sodium: 600, carbohydrates: 6, transFat: 0, addedSugar: 3, potassium: 280, totalFibre: 0.5, solubleFibre: 0 };
    } else if (n.includes("mushroom") || n.includes("vegetable") || n.includes("veg")) {
      overrides = { calories: 55, protein: 2.5, totalFat: 2, saturatedFat: 0.3, sodium: 420, carbohydrates: 7, transFat: 0, addedSugar: 2, potassium: 250, totalFibre: 1.5, solubleFibre: 0.3 };
    } else {
      overrides = { calories: 120, protein: 6, totalFat: 4, saturatedFat: 0.8, sodium: 500, carbohydrates: 12, transFat: 0, addedSugar: 3, potassium: 200, totalFibre: 1, solubleFibre: 0.2 };
    }
  } else if (n.includes("tofu") || n.includes("tahu")) {
    overrides = { calories: 75, protein: 8, totalFat: 4.5, saturatedFat: 0.5, sodium: 10, carbohydrates: 2, transFat: 0, addedSugar: 0, potassium: 120, totalFibre: 1, solubleFibre: 0 };
  } else if (n.includes("wine") || n.includes("champagne") || n.includes("prosecco") || n.includes("cava") || n.includes("sparkling")) {
    overrides = { calories: 64, protein: 0.07, totalFat: 0, saturatedFat: 0, sodium: 7, carbohydrates: 1, transFat: 0, addedSugar: 0, potassium: 80, totalFibre: 0, solubleFibre: 0 };
  } else if (n.includes("beer") || n.includes("ale") || n.includes("lager") || n.includes("stout") || n.includes("cider")) {
    overrides = { calories: 43, protein: 0.5, totalFat: 0, saturatedFat: 0, sodium: 4, carbohydrates: 3.5, transFat: 0, addedSugar: 0, potassium: 30, totalFibre: 0, solubleFibre: 0 };
  } else if (n.includes("liquor") || n.includes("spirits") || n.includes("vodka") || n.includes("gin") || n.includes("rum") || n.includes("whiskey") || n.includes("tequila")) {
    overrides = { calories: 231, protein: 0, totalFat: 0, saturatedFat: 0, sodium: 1, carbohydrates: 0, transFat: 0, addedSugar: 0, potassium: 2, totalFibre: 0, solubleFibre: 0 };
  } else if (n.includes("cocktail") || n.includes("mixed drink") || n.includes("margarita") || n.includes("mojito")) {
    overrides = { calories: 150, protein: 0.1, totalFat: 0.1, saturatedFat: 0, sodium: 20, carbohydrates: 15, transFat: 0, addedSugar: 12, potassium: 30, totalFibre: 0, solubleFibre: 0 };
  } else if (n.includes("soup") || n.includes("broth")) {
    overrides = { calories: 60, protein: 3, totalFat: 2.5, saturatedFat: 1, sodium: 600, carbohydrates: 6, transFat: 0, addedSugar: 0, potassium: 120, totalFibre: 0.5, solubleFibre: 0 };
  }

  const merged = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) {
      merged[k] = v;
    }
  }
  return merged;
};
`;

code = code.replace(/import \{ extractBalancedJson \} from "\.\/server_pure_helpers\.js";/, `import { extractBalancedJson } from "./server_pure_helpers.js";\n${missingFunc}`);

fs.writeFileSync('server.ts', code);
console.log("Re-added getClinicalDefaultNutrients100g");
