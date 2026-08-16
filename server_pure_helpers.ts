// Pure, side-effect-free helpers extracted from server.ts so they can be unit
// tested without importing server.ts (which starts a live HTTP server and
// initializes Firebase Admin as soon as the module loads).
// Do not add imports here that create side effects (firebase, fs, express).
// Extracted verbatim on 2026-07-20 — do not change behavior.

import { classifyUniversalPhysicalFormV3 } from "./server_matching_engine";
import { isGroceryBrandSync, isKnownDatabaseBrandSync } from "./serverBrandMenu.js";

// Simple and robust custom JS object-to-YAML stringifier
export function jsToYaml(val: any, indent: number = 0): string {
  const spaces = " ".repeat(indent);
  if (val === null) return "null";
  if (val === undefined) return "null";
  if (typeof val === "string") {
    if (val.includes("\n")) {
      return "|\n" + val.split("\n").map(line => spaces + "  " + line).join("\n");
    }
    if (val.includes(":") || val.includes("#") || val.startsWith("-")) {
      return `"${val.replace(/"/g, '\\"')}"`;
    }
    return val;
  }
  if (typeof val === "number" || typeof val === "boolean") {
    return String(val);
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return "[]";
    let out = "";
    for (const item of val) {
      if (typeof item === "object" && item !== null) {
        const inner = jsToYaml(item, indent + 2);
        const lines = inner.split("\n");
        out += `\n${spaces}- ${lines[0].trim()}`;
        if (lines.length > 1) {
          out += "\n" + lines.slice(1).join("\n");
        }
      } else {
        out += `\n${spaces}- ${jsToYaml(item, indent + 2)}`;
      }
    }
    return out;
  }
  if (typeof val === "object") {
    const keys = Object.keys(val);
    if (keys.length === 0) return "{}";
    let out = "";
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = val[k];
      const prefix = i === 0 && indent > 0 ? "" : spaces;
      if (typeof v === "object" && v !== null) {
        out += `${prefix}${k}:${Array.isArray(v) ? "" : "\n"}${jsToYaml(v, indent + (Array.isArray(v) ? 0 : 2))}\n`;
      } else {
        out += `${prefix}${k}: ${jsToYaml(v, indent + 2)}\n`;
      }
    }
    return out.trim();
  }
  return String(val);
}

export function extractBalancedJson(text: string): string {
  let cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const startIdx = cleaned.indexOf("{");
  if (startIdx !== -1) {
    let braceDepth = 0;
    let bracketDepth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIdx; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
      } else {
        if (char === '"') {
          inString = true;
        } else if (char === "{") {
          braceDepth++;
        } else if (char === "}") {
          braceDepth--;
        } else if (char === "[") {
          bracketDepth++;
        } else if (char === "]") {
          bracketDepth--;
        }
      }

      if (braceDepth < 0 || bracketDepth < 0) {
        break;
      }

      if (braceDepth === 0 && bracketDepth === 0 && !inString) {
        return cleaned.substring(startIdx, i + 1);
      }
    }
  }
  return cleaned;
}

// Defensive numeric guard for weight values coming from LLM output.
// Number(x) alone is not safe here: an overlong digit string overflows to
// Infinity, and "Infinity || fallback" still evaluates to Infinity because
// Infinity is truthy. This rejects non-finite and unreasonably large values.
export function sanitizeMealWeight(value: any, fallback: number, maxGrams: number = 10000): number {
  const raw = value;
  const debugMeta = { originalData: Array.isArray(raw) ? raw : [raw] };
  const n = Number(debugMeta.originalData[0]);
  if (!Number.isFinite(n) || n <= 0 || n > maxGrams) return fallback;
  return Math.round(n);
}

export function sanitizeString(val: any, fallback: string): string {
  if (val === null || val === undefined || String(val).toLowerCase() === "undefined" || String(val).trim() === "") {
    return fallback;
  }
  return String(val);
}

export function findItemIndexInList(itemsBreakdown: any[], itemNameStr: string, targetDbId: string | null): number {
  if (!itemsBreakdown || !Array.isArray(itemsBreakdown)) return -1;
  const nameLower = itemNameStr.trim().toLowerCase();
  // Sanitize targetDbId: strip all non-printable/non-ASCII characters (e.g. emoji variation selectors)
  const cleanDbId = targetDbId ? String(targetDbId).replace(/[^\x20-\x7E]/g, '').trim() : null;
  if (!nameLower && !cleanDbId) return -1;

  // 1. Exact match by dbId
  if (cleanDbId) {
    const idx = itemsBreakdown.findIndex((it: any) => it.dbId && String(it.dbId) === cleanDbId);
    if (idx !== -1) return idx;
  }

  // 2. Exact match by item name (case-insensitive)
  const exactIdx = itemsBreakdown.findIndex((it: any) => it.name && it.name.trim().toLowerCase() === nameLower);
  if (exactIdx !== -1) return exactIdx;

  // 3. Exact match by canonical name if present
  const canonicalIdx = itemsBreakdown.findIndex((it: any) => it.canonicalDbName && it.canonicalDbName.trim().toLowerCase() === nameLower);
  if (canonicalIdx !== -1) return canonicalIdx;

  // 4. Substring prefix/suffix match (e.g. startsWith or endsWith)
  const wordMatchIdx = itemsBreakdown.findIndex((it: any) => {
    const itName = (it.name || "").trim().toLowerCase();
    return itName.startsWith(nameLower) || itName.endsWith(nameLower);
  });
  if (wordMatchIdx !== -1) return wordMatchIdx;

  // 5. Classic includes fallback (fuzzy substring, first match wins)
  const includesIdx = itemsBreakdown.findIndex((it: any) => {
    const itName = (it.name || "").trim().toLowerCase();
    return itName.includes(nameLower) || nameLower.includes(itName);
  });
  if (includesIdx !== -1) return includesIdx;

  // 6. Word-by-word intersection match as ultimate fallback
  const words = nameLower.split(/\s+/).filter(w => w.length > 2);
  if (words.length > 0) {
    const wordMatch = itemsBreakdown.findIndex((it: any) => {
      const itName = (it.name || "").trim().toLowerCase();
      const itCanon = (it.canonicalDbName || "").trim().toLowerCase();
      return words.some(word => itName.includes(word) || itCanon.includes(word));
    });
    if (wordMatch !== -1) return wordMatch;
  }

  return -1;
}

export function getUSDANutrientValue(n: any): number {
  if (!n) return 0;
  if (typeof n === 'number') return isNaN(n) ? 0 : n;
  if (typeof n.value === 'number') return isNaN(n.value) ? 0 : n.value;
  if (typeof n.amount === 'number') return isNaN(n.amount) ? 0 : n.amount;
  if (n.value && typeof n.value === 'number') return n.value;
  if (n.value && typeof n.value === 'object' && typeof n.value.amount === 'number') return n.value.amount;
  if (n.amount && typeof n.amount === 'object' && typeof n.amount.value === 'number') return n.amount.value;
  const raw = n.value !== undefined ? n.value : n.amount;
  if (raw !== undefined && raw !== null) {
    const parsed = parseFloat(String(raw));
    if (!isNaN(parsed)) return parsed;
  }
  return 0;
}

const SATFAT_RATIO_BY_TYPE: Record<string, number> = {
  red_meat: 0.40,
  poultry: 0.30,
  dairy: 0.60,
  fish_fatty: 0.25,
  fish_lean: 0.20,
  grain: 0.20,
  legume: 0.15,
  leafy_veg: 0.10,
  root_veg: 0.10,
  ultra_processed: 0.35,
  other: 0.20
};

export function getSaturatedFatRatio(description: string): number {
  const d = String(description || "").toLowerCase();
  if (d.includes("avocado")) return 0.15;
  if (d.includes("steak") || d.includes("beef") || d.includes("lamb") || d.includes("pork") || d.includes("mutton") || d.includes("veal") || d.includes("daging")) return SATFAT_RATIO_BY_TYPE.red_meat;
  if (d.includes("chicken") || d.includes("turkey") || d.includes("duck") || d.includes("poultry") || d.includes("ayam")) return SATFAT_RATIO_BY_TYPE.poultry;
  if (d.includes("salmon") || d.includes("tuna") || d.includes("mackerel") || d.includes("sardine") || d.includes("herring") || d.includes("fatty fish")) return SATFAT_RATIO_BY_TYPE.fish_fatty;
  if (d.includes("cod") || d.includes("halibut") || d.includes("snapper") || d.includes("bass") || d.includes("tilapia") || d.includes("fish") || d.includes("ikan")) return SATFAT_RATIO_BY_TYPE.fish_lean;
  if (d.includes("milk") || d.includes("cheese") || d.includes("butter") || d.includes("yogurt") || d.includes("dairy")) return SATFAT_RATIO_BY_TYPE.dairy;
  if (d.includes("rice") || d.includes("bread") || d.includes("oat") || d.includes("wheat") || d.includes("grain") || d.includes("corn") || d.includes("maize") || d.includes("pasta") || d.includes("noodle")) return SATFAT_RATIO_BY_TYPE.grain;
  if (d.includes("bean") || d.includes("lentil") || d.includes("pea") || d.includes("chickpea") || d.includes("legume") || d.includes("tempeh") || d.includes("tofu")) return SATFAT_RATIO_BY_TYPE.legume;
  if (d.includes("potato") || d.includes("carrot") || d.includes("onion") || d.includes("garlic") || d.includes("beet") || d.includes("radish") || d.includes("yam") || d.includes("tuber") || d.includes("root") || d.includes("kentang") || d.includes("wortel")) return SATFAT_RATIO_BY_TYPE.root_veg;
  if (d.includes("spinach") || d.includes("kale") || d.includes("lettuce") || d.includes("cabbage") || d.includes("leaf") || d.includes("leaves") || d.includes("sayur") || d.includes("kangkung") || d.includes("pakchoy") || d.includes("mustard green") || d.includes("broccoli") || d.includes("cauliflower")) return SATFAT_RATIO_BY_TYPE.leafy_veg;
  if (d.includes("donut") || d.includes("candy") || d.includes("chocolate") || d.includes("chip") || d.includes("french fry") || d.includes("french fries") || d.includes("processed") || d.includes("nugget")) return SATFAT_RATIO_BY_TYPE.ultra_processed;
  return SATFAT_RATIO_BY_TYPE.other;
}

export function extractUSDANutrientsPer100g(food: any): Record<string, number> {
  const profile: Record<string, number> = {};
  if (!food || !food.foodNutrients) return profile;
  
  const findNut = (namePatterns: string[]) => {
    const exactMatch = food.foodNutrients.find((n: any) => {
      const name = (n.nutrientName || (n.nutrient && n.nutrient.name) || "").toLowerCase().trim();
      return namePatterns.some(p => name === p.toLowerCase().trim());
    });
    if (exactMatch) return exactMatch;

    return food.foodNutrients.find((n: any) => {
      const name = (n.nutrientName || (n.nutrient && n.nutrient.name) || "").toLowerCase();
      return namePatterns.some(p => {
        const cleanP = p.toLowerCase().trim();
        if (cleanP === "fat" && name.includes("fatty")) {
          return false;
        }
        return name.includes(cleanP);
      });
    });
  };
  
  const setVal = (key: string, namePatterns: string[]) => {
    const nut = findNut(namePatterns);
    if (nut) {
      profile[key] = getUSDANutrientValue(nut);
    }
  };
  
  // Find energy/calories. We prefer Kilocalories (ID 1008) over Kilojoules (ID 1062).
  let kcalNut = food.foodNutrients.find((n: any) => {
    const id = Number(n.nutrientId || (n.nutrient && n.nutrient.id));
    const num = String(n.nutrientNumber || "");
    const name = (n.nutrientName || (n.nutrient && n.nutrient.name) || "").toLowerCase();
    const unit = (n.unitName || (n.nutrient && n.nutrient.unitName) || "").toLowerCase();
    return id === 1008 || num === "208" || name.includes("kcal") || name.includes("kilocalories") || (name === "energy" && unit === "kcal");
  });

  let kjNut = food.foodNutrients.find((n: any) => {
    const id = Number(n.nutrientId || (n.nutrient && n.nutrient.id));
    const num = String(n.nutrientNumber || "");
    const name = (n.nutrientName || (n.nutrient && n.nutrient.name) || "").toLowerCase();
    const unit = (n.unitName || (n.nutrient && n.nutrient.unitName) || "").toLowerCase();
    return id === 1062 || num === "268" || name.includes("kj") || name.includes("kilojoules") || (name === "energy" && unit === "kj");
  });

  if (kcalNut) {
    const val = getUSDANutrientValue(kcalNut);
    profile["calories"] = Math.round(val);
  } else if (kjNut) {
    const val = getUSDANutrientValue(kjNut);
    profile["calories"] = Math.round(val / 4.184);
  } else {
    // Fallback to standard name matching
    const energyNut = findNut(["energy", "calories"]);
    if (energyNut) {
      const val = getUSDANutrientValue(energyNut);
      const unit = (energyNut.unitName || (energyNut.nutrient && energyNut.nutrient.unitName) || "").toLowerCase();
      const name = (energyNut.nutrientName || (energyNut.nutrient && energyNut.nutrient.name) || "").toLowerCase();
      if (unit === "kj" || name.includes("kilojoules") || name.includes("kj")) {
        profile["calories"] = Math.round(val / 4.184);
      } else {
        profile["calories"] = Math.round(val);
      }
    }
  }
  
  setVal("protein", ["protein"]);
  setVal("totalFat", ["total lipid", "fat"]);
  setVal("saturatedFat", ["saturated fat", "fatty acids, total saturated"]);
  setVal("transFat", ["trans fat", "fatty acids, total trans"]);

  // Deterministic Saturated Fat Fallback (Bug 4)
  if (profile["saturatedFat"] === undefined || profile["saturatedFat"] === null || isNaN(profile["saturatedFat"])) {
    const totalFat = profile["totalFat"] || 0;
    if (totalFat > 0) {
      const desc = food.description || food.name || "";
      const ratio = getSaturatedFatRatio(desc);
      profile["saturatedFat"] = parseFloat((totalFat * ratio).toFixed(2));
    } else {
      profile["saturatedFat"] = 0;
    }
  }
  
  if (profile["totalFat"] !== undefined) {
     profile["unsaturatedFat"] = Math.max(0, profile["totalFat"] - (profile["saturatedFat"] || 0) - (profile["transFat"] || 0));
  }
  
  setVal("omega3", ["omega-3", "omega 3", "n-3 fatty acid"]);
  setVal("carbohydrates", ["carbohydrate, by difference"]);
  setVal("addedSugar", ["added sugar"]);
  setVal("sugar", ["sugars, total including nlea", "sugars, total", "sugar", "total sugars"]);

  const dLower = (food.description || food.name || "").toLowerCase();

  // If the item is a sweet baking ingredient or pure sugar, all its sugar is Added Sugar
  if (!profile["addedSugar"] && profile["sugar"] > 0) {
    if (/\b(sugar|syrup|honey|molasses|agave|frosting|icing|jam|jelly|marmalade|candy|caramel)\b/i.test(dLower)) {
      profile["addedSugar"] = profile["sugar"];
    }
  }

  setVal("totalFibre", ["fiber, total dietary", "fibre"]);
  if (profile["totalFibre"] === undefined || profile["totalFibre"] === null) {
    if (/\b(quinoa|oat|oats|oatmeal|brown rice|wild rice|barley|farro|buckwheat|millet)\b/i.test(dLower)) {
      profile["totalFibre"] = 2.8;
    } else if (/\b(white rice|rice|pasta|macaroni|noodle|noodles|bread|flour)\b/i.test(dLower)) {
      profile["totalFibre"] = 0.4;
    } else if (/\b(edamame|bean|beans|lentils|chickpeas|soy|soybean|hummus)\b/i.test(dLower)) {
      profile["totalFibre"] = 5.5;
    } else if (/\b(cabbage|broccoli|kale|cauliflower|slaw|coleslaw|sprouts)\b/i.test(dLower)) {
      profile["totalFibre"] = 2.5;
    }
  }
  setVal("solubleFibre", ["fiber, soluble", "soluble fiber"]);
  setVal("sodium", ["sodium"]);
  setVal("potassium", ["potassium"]);
  setVal("magnesium", ["magnesium"]);
  setVal("calcium", ["calcium"]);
  setVal("iron", ["iron"]);
  setVal("zinc", ["zinc"]);
  setVal("selenium", ["selenium"]);
  setVal("iodine", ["iodine"]);
  setVal("phosphorus", ["phosphorus"]);
  setVal("vitaminD", ["vitamin d"]);
  setVal("vitaminB12", ["vitamin b-12", "vitamin b12"]);
  setVal("folate", ["folate"]);
  setVal("vitaminC", ["vitamin c", "ascorbic acid"]);
  setVal("vitaminE", ["vitamin e", "tocopherol"]);
  setVal("vitaminK", ["vitamin k"]);
  setVal("vitaminA", ["vitamin a"]);
  setVal("vitaminB6", ["vitamin b-6", "vitamin b6"]);
  setVal("thiamine", ["thiamine"]);
  setVal("riboflavin", ["riboflavin"]);
  setVal("niacin", ["niacin"]);
  
  return profile;
}

export function extractOFFNutrientsPer100g(product: any): Record<string, number> {
  const profile: Record<string, number> = {};
  if (!product || !product.nutriments) return profile;
  const n = product.nutriments;
  
  if (n["energy-kcal_100g"] !== undefined) {
    profile["calories"] = Number(n["energy-kcal_100g"]) || 0;
  } else if (n["energy_100g"] !== undefined) {
    profile["calories"] = Math.round(Number(n["energy_100g"]) / 4.184) || 0;
  }
  
  const setNum = (key: string, field: string, scale: number = 1) => {
    if (n[field] !== undefined) {
      profile[key] = (Number(n[field]) || 0) * scale;
    }
  };

  setNum("protein", "proteins_100g");
  setNum("totalFat", "fat_100g");
  setNum("saturatedFat", "saturated-fat_100g");
  setNum("transFat", "trans-fat_100g");

  // Deterministic Saturated Fat Fallback (Bug 4)
  if (profile["saturatedFat"] === undefined || profile["saturatedFat"] === null || isNaN(profile["saturatedFat"])) {
    const totalFat = profile["totalFat"] || 0;
    if (totalFat > 0) {
      const desc = product.product_name || "";
      const ratio = getSaturatedFatRatio(desc);
      profile["saturatedFat"] = parseFloat((totalFat * ratio).toFixed(2));
    } else {
      profile["saturatedFat"] = 0;
    }
  }
  
  if (profile["totalFat"] !== undefined) {
    profile["unsaturatedFat"] = Math.max(0, profile["totalFat"] - (profile["saturatedFat"] || 0) - (profile["transFat"] || 0));
  }
  
  setNum("omega3", "omega-3_100g");
  setNum("carbohydrates", "carbohydrates_100g");
  setNum("addedSugar", "added_sugars_100g");
  setNum("sugar", "sugars_100g");
  setNum("totalFibre", "fiber_100g");
  setNum("solubleFibre", "soluble-fiber_100g");
  
  setNum("sodium", "sodium_100g", 1000);
  setNum("potassium", "potassium_100g", 1000);
  setNum("magnesium", "magnesium_100g", 1000);
  setNum("calcium", "calcium_100g", 1000);
  setNum("iron", "iron_100g", 1000);
  setNum("zinc", "zinc_100g", 1000);
  setNum("selenium", "selenium_100g");
  setNum("iodine", "iodine_100g");
  setNum("phosphorus", "phosphorus_100g", 1000);
  setNum("vitaminD", "vitamin-d_100g");
  setNum("vitaminB12", "vitamin-b12_100g");
  setNum("folate", "folate_100g");
  setNum("vitaminC", "vitamin-c_100g", 1000);
  setNum("vitaminE", "vitamin-e_100g", 1000);
  setNum("vitaminK", "vitamin-k_100g");
  setNum("vitaminA", "vitamin-a_100g");
  setNum("vitaminB6", "vitamin-b6_100g", 1000);
  setNum("thiamine", "thiamine_100g", 1000);
  setNum("riboflavin", "riboflavin_100g", 1000);
  setNum("niacin", "niacin_100g", 1000);

  return profile;
}

export function checkIfItemIsAlreadyPrepared(
  name: string,
  keyword: string,
  dbSource?: string,
  baselineSodium?: number
): boolean {
  const nameLower = (name || "").toLowerCase();
  const kwLower = (keyword || "").toLowerCase();
  
  // 1. Branded, Open Food Facts, or printed label sources are always prepared/packaged
  if (dbSource === "off" || dbSource === "label") return true;

  // 2. High baseline sodium (> 200mg per 100g) indicates pre-seasoned / processed base ingredient.
  // Only trust this heuristic when the sodium value came from a verified match (USDA/OFF/label/
  // canonical reference) — NOT from the generic Tier-3 "estimated" fallback, whose sodium guess
  // is not real evidence that the ingredient is already prepared/seasoned.
  if (dbSource && dbSource !== "estimated" && baselineSodium !== undefined && baselineSodium > 200) return true;

  // 3. Keywords in name or keyword that indicate prepared, seasoned, processed base product (sauces/mayo handled separately)
  const preparedKeywords = [
    "fries", "french fry", "french fries", "wedge", "wedges", "chip", "chips", "nugget", "nuggets",
    "patty", "patties", "burger", "burgers",
    "processed", "seasoned", "canned", "fried", "cured",
    "bacon", "ham", "sausage", "sausages", "meatball", "meatballs", "toasted", "instant", "salted",
    "bowl", "bowls", "poke", "salad", "salads", "bento", "combo", "platter", "box", "wrap", "wraps",
    "burrito", "burritos", "taco", "tacos", "curry", "stew", "casserole", "sandwich", "sandwiches",
    "roll", "rolls", "sushi", "tartare", "poke_bowl", "compound_meal"
  ];

  if (preparedKeywords.some(kw => nameLower.includes(kw) || kwLower.includes(kw))) {
    return true;
  }

  // 4. Known chains or brands from database
  if (isKnownDatabaseBrandSync(nameLower) || isKnownDatabaseBrandSync(kwLower)) {
    return true;
  }

  return false;
}

export function evaluateNutrientWarnings(nutrients: any) {
  const warnings: string[] = [];
  if (!nutrients) return warnings;
  if (nutrients.sodium > 500) warnings.push("High Sodium (>500mg)");
  if (nutrients.totalFat < (nutrients.saturatedFat + nutrients.transFat)) warnings.push("Fat Thermodynamics Mismatch");
  if (nutrients.protein > 45) warnings.push("Unusually High Protein (>45g)");
  if (nutrients.calories === 0) warnings.push("Zero Calories Detected");
  return warnings;
}

// Atwater general factors (4 kcal/g protein, 4 kcal/g carb, 9 kcal/g fat). Applied with a
// generous tolerance band because rounding, fibre, and alcohol all shift the true figure —
// this is a coarse "is this physically possible" net, not a precise validator. Runs on every
// item unconditionally, including label-sourced ones, because a physical impossibility is a
// physical impossibility regardless of where the number came from (OCR misread, wrong DB
// match, wrong component sum, etc. can all produce one).
const ATWATER_TOLERANCE = 0.35; // allow 35% deviation before intervening

export function checkAtwaterConsistency(
  itemName: string,
  itemNutrients: Record<string, number>,
  addDebugLog?: (msg: string) => void
): void {
  if (!itemNutrients || typeof itemNutrients !== 'object') return;
  const protein = itemNutrients.protein || 0;
  let carbs = itemNutrients.carbohydrates || 0;
  const fat = itemNutrients.totalFat || 0;
  const statedCalories = itemNutrients.calories || 0;

  if (statedCalories <= 0 && (protein > 0 || carbs > 0 || fat > 0)) {
    // Macros present but zero calories logged — definitely wrong, not just imprecise.
    const derivedCalories = Math.round(protein * 4 + carbs * 4 + fat * 9);
    if (addDebugLog) {
      addDebugLog(`[Atwater Check] "${itemName}" has macros (P=${protein}g C=${carbs}g F=${fat}g) but ${statedCalories} stated kcal. Correcting calories to ${derivedCalories} kcal (derived from macros).`);
    }
    itemNutrients.calories = derivedCalories;
    return;
  }

  if (statedCalories <= 0) return; // nothing to compare against

  if (protein <= 0 && carbs <= 0 && fat <= 0 && statedCalories > 0) {
    const estCarbs = Math.round(((statedCalories * 0.45) / 4) * 10) / 10;
    const estFat = Math.round(((statedCalories * 0.35) / 9) * 10) / 10;
    const estProtein = Math.round(((statedCalories * 0.20) / 4) * 10) / 10;
    itemNutrients.carbohydrates = estCarbs;
    itemNutrients.totalFat = estFat;
    itemNutrients.protein = estProtein;
    if (addDebugLog) {
      addDebugLog(`[Atwater Anchor Engine] "${itemName}" had ${statedCalories} stated kcal but no macros. Applied category macro prior (45% Carbs, 35% Fat, 20% Protein): C=${estCarbs}g, F=${estFat}g, P=${estProtein}g.`);
    }
    return;
  }

  const isAlcoholicBeverage = /\b(wine|brut|prosecco|champagne|chardonnay|cabernet|merlot|pinot|sauvignon|syrah|shiraz|rosé|rose|beer|ale|lager|stout|cider|vodka|whiskey|whisky|rum|gin|tequila|cognac|brandy|bourbon|liquor|spirit|cocktail|margarita|martini)\b/i.test(itemName);
  if (isAlcoholicBeverage) {
    if (addDebugLog) {
      addDebugLog(`[Atwater Check] "${itemName}" identified as alcoholic beverage. Skipping Atwater macro rescaling to preserve authentic alcohol caloric contribution.`);
    }
    return;
  }

  const isGrainItem = /\b(rice|bread|ciabatta|bun|sandwich|wrap|pasta|noodle|grain|oat|bagel|pancake|waffle|flour|dough|roll|toast|croissant)\b/i.test(
    itemName
  );

  if (carbs <= 0 && isGrainItem && statedCalories > 0) {
    const residualCarbs = Math.max(
      0,
      Math.round(((statedCalories - (protein * 4 + fat * 9)) / 4) * 10) / 10
    );
    if (residualCarbs > 0) {
      if (addDebugLog) {
        addDebugLog(
          `[Atwater Check] Preserved/estimated carbs=${residualCarbs}g before rescale for grain-containing item ("${itemName}").`
        );
      }
      carbs = residualCarbs;
      itemNutrients.carbohydrates = residualCarbs;
    }
  }

  const derivedCalories = protein * 4 + carbs * 4 + fat * 9;
  if (derivedCalories <= 0) return; // no macros to check against stated calories

  const deviation = Math.abs(derivedCalories - statedCalories) / statedCalories;
  if (deviation > ATWATER_TOLERANCE) {
    // Macros and stated calories disagree by more than physically plausible rounding/fibre
    // error can explain. Trust the calories (usually the most reliably sourced single number —
    // printed on labels/menus, or the primary DB field) and rescale the macros proportionally
    // rather than guessing which individual macro is wrong.
    const scaleRatio = derivedCalories > 0 ? statedCalories / derivedCalories : 1;
    const newProtein = Math.round(protein * scaleRatio * 10) / 10;
    const newCarbs = Math.round(carbs * scaleRatio * 10) / 10;
    const newFat = Math.round(fat * scaleRatio * 10) / 10;
    if (addDebugLog) {
      addDebugLog(`[Atwater Check] "${itemName}": macros (P=${protein}g C=${carbs}g F=${fat}g -> ${Math.round(derivedCalories)} kcal) don't reconcile with stated ${statedCalories} kcal (${Math.round(deviation * 100)}% deviation). Rescaling macros to match stated calories: P=${newProtein}g C=${newCarbs}g F=${newFat}g.`);
    }
    itemNutrients.protein = newProtein;
    itemNutrients.carbohydrates = newCarbs;
    itemNutrients.totalFat = newFat;
    if ((itemNutrients as any).truthNutrients && typeof (itemNutrients as any).truthNutrients === 'object') {
      (itemNutrients as any).truthNutrients.protein = newProtein;
      (itemNutrients as any).truthNutrients.carbohydrates = newCarbs;
      (itemNutrients as any).truthNutrients.totalFat = newFat;
    }
    const satFat = itemNutrients.saturatedFat || 0;
    const transFat = itemNutrients.transFat || 0;
    itemNutrients.unsaturatedFat = parseFloat(Math.max(0, newFat - satFat - transFat).toFixed(2));
  }
}

export function applyCommercialSodiumFloor(
  itemName: string,
  itemNutrients: Record<string, number>,
  dbSource?: string,
  addDebugLog?: (msg: string) => void,
  ctx?: {
    originalName?: string | null;
    keyword?: string | null;
    componentCount?: number;
    physicalForm?: string | null;
    chainName?: string | null;
  }
): void {
  if (!itemNutrients || typeof itemNutrients !== 'object') return;
  const canonicalName = itemName;
  const identityForChecks = [
    ctx?.originalName,
    ctx?.keyword,
    itemName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const isGroceryBrand =
    ctx?.chainName != null && isGroceryBrandSync(ctx.chainName);
  const isFastFoodOrChain =
    (ctx?.chainName != null && !isGroceryBrand) ||
    isKnownDatabaseBrandSync(identityForChecks) ||
    /\b(kebab|tikka|wrap)\b/i.test(identityForChecks);

  const isWholeFood = ctx?.physicalForm === 'SOLID_FRUIT_VEG' || dbSource === 'canonical_dict';

  if (isFastFoodOrChain && !isWholeFood && (itemNutrients.calories || 0) > 0) {
    const currentSodium = itemNutrients.sodium || 0;
    const commercialSodiumFloor = Math.round((itemNutrients.calories || 0) * 1.8);
    if (currentSodium < commercialSodiumFloor) {
      if (addDebugLog) {
        addDebugLog(
          `[Commercial Sodium Floor] Sodium for fast-food item "${canonicalName}" (${currentSodium}mg) was below commercial floor (1.8mg/kcal). Adjusted sodium to ${commercialSodiumFloor}mg floor for ${itemNutrients.calories} kcal.`
        );
      }
      itemNutrients.sodium = commercialSodiumFloor;
    }
  }
}

export function applyNutrientRealityChecks(
  itemName: string,
  itemWeight: number,
  itemNutrients: Record<string, number>,
  addedSodium: number,
  addDebugLog?: (msg: string) => void,
  dbSource?: string,
  ctx?: {
    originalName?: string | null;
    keyword?: string | null;
    componentCount?: number;
    physicalForm?: string | null;
    chainName?: string | null;
  }
): void {
  if (!itemNutrients || typeof itemNutrients !== 'object') return;
  // Physics-based check first, unconditionally — no dbSource value, current or future,
  // exempts an item from basic thermodynamic plausibility.
  checkAtwaterConsistency(itemName, itemNutrients, addDebugLog);

  // Values sourced directly from a scanned/printed nutrition label or kiosk screen/menu
  // are verified ground truth and must never be overridden by heuristic sanity checks.
  // Skip heuristic (category/keyword-based) checks for label/kiosk/screen/menu sourced items,
  // including partial backfills — but NOT the Atwater check above, which already ran.
  const isLabelOrScreenSource = dbSource === "label" || 
    dbSource === "kiosk" || 
    dbSource === "screen" || 
    dbSource === "menu" || 
    (typeof dbSource === "string" && dbSource.startsWith("label") && dbSource !== "label_partial");

  if (isLabelOrScreenSource) {
    if (addDebugLog) {
      addDebugLog(`[Dietitian Reality Check] Heuristic checks skipped for "${itemName}" — dbSource is "${dbSource}" (printed label/screen/menu is ground truth). Atwater consistency check still applied.`);
    }
    return;
  }

  const nameLower = itemName.toLowerCase();
  const canonicalName = itemName;

  const identityForChecks = [
    ctx?.originalName,
    ctx?.keyword,
    itemName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const componentCount = ctx?.componentCount ?? 0;
  const form = String(ctx?.physicalForm || "").toUpperCase();

  const isCompositeDish =
    componentCount >= 2 ||
    form === "COMPOUND_MEAL" ||
    Boolean(ctx?.chainName && componentCount >= 1) ||
    /\b(burgers?|sandwich(es)?|buns?|rolls?|wraps?|pies?|nuggets?|pizzas?|dumplings?|patties|patty|tacos?|burritos?|noodles?|rice|soup|fried|batter|breaded|bowls?|poke|salad|salads|combos?|meals?|platters?|boxes?|bentos?|currys?|curries|stews?|casseroles?|pastas?|spaghetti|macaroni|risotto|paella|teriyaki|stir-?fry|mix|mixed|dish|dishes|entrees?|compounds?|sets?|surimi)\b/i.test(
      identityForChecks
    );

  // Use identityForChecks (not only itemName) for meat/fish detection on the *dish*
  const cleanNameLower = identityForChecks || canonicalName.toLowerCase();

  // 1. Meat / Fish Protein Reality Check (< 10% protein by weight for pure solid fish/meat)
  const isMeatOrFish = !isCompositeDish && (
    cleanNameLower.includes('fish') || cleanNameLower.includes('salmon') || cleanNameLower.includes('steak') || 
    cleanNameLower.includes('chicken') || cleanNameLower.includes('beef') || cleanNameLower.includes('pork') || 
    cleanNameLower.includes('ayam') || cleanNameLower.includes('ikan') || cleanNameLower.includes('daging') || 
    cleanNameLower.includes('bebek') || cleanNameLower.includes('udang') || cleanNameLower.includes('cumi')
  );

  if (isMeatOrFish && itemWeight > 10) {
    const proteinRatio = (itemNutrients.protein || 0) / itemWeight;
    if (proteinRatio < 0.10) {
      // Scale protein realistically to ~22g per 100g of detected meat/fish component weight
      const adjustedProtein = Math.round(itemWeight * 0.22 * 10) / 10;
      
      const minFat = Math.round(itemWeight * 0.05 * 10) / 10;
      if ((itemNutrients.totalFat || 0) < minFat) {
         itemNutrients.totalFat = minFat;
      }
      
      if (addDebugLog) addDebugLog(`[Dietitian Reality Check] Protein for "${canonicalName}" (${itemNutrients.protein}g per ${itemWeight}g) was unrealistically low for pure meat/fish. Adjusted protein to ${adjustedProtein}g, fat to ${itemNutrients.totalFat}g.`);
      itemNutrients.protein = adjustedProtein;
      const derivedMeatCal = Math.round(itemNutrients.protein * 4 + (itemNutrients.carbohydrates || 0) * 4 + (itemNutrients.totalFat || 0) * 9);
      if (derivedMeatCal > (itemNutrients.calories || 0)) {
        itemNutrients.calories = derivedMeatCal;
      }
      // Re-run Atwater check to reconcile macros with stated calories without artificially inflating calories
      checkAtwaterConsistency(itemName, itemNutrients, addDebugLog);
    }
  }
  
  // 3. Egg / Tofu Protein Reality Check
  const isEggplant = cleanNameLower.includes('eggplant') || cleanNameLower.includes('aubergine') || cleanNameLower.includes('terong');
  const isEggOrTofu = !isEggplant && !isCompositeDish && /\b(eggs?|telur|tofu|tahu|tempeh)\b/i.test(cleanNameLower);
  if (isEggOrTofu && itemWeight > 10) {
    const proteinRatio = (itemNutrients.protein || 0) / itemWeight;
    if (proteinRatio < 0.05) { // If less than 5% protein, it's severely undercounted
      const adjustedProtein = Math.round(itemWeight * 0.12 * 10) / 10;
      
      const minFat = Math.round(itemWeight * 0.07 * 10) / 10;
      if ((itemNutrients.totalFat || 0) < minFat) {
         itemNutrients.totalFat = minFat;
      }
      
      if (addDebugLog) addDebugLog(`[Dietitian Reality Check] Protein for "${canonicalName}" (${itemNutrients.protein}g per ${itemWeight}g) was unrealistically low for egg/tofu. Adjusted protein to ${adjustedProtein}g, fat to ${itemNutrients.totalFat}g.`);
      itemNutrients.protein = adjustedProtein;
      const derivedEggCal = Math.round(itemNutrients.protein * 4 + (itemNutrients.carbohydrates || 0) * 4 + (itemNutrients.totalFat || 0) * 9);
      if (derivedEggCal > (itemNutrients.calories || 0)) {
        itemNutrients.calories = derivedEggCal;
      }
      checkAtwaterConsistency(itemName, itemNutrients, addDebugLog);
    }
  }

  // 4. Sodium Reality Check
  const isCuredOrSalted = nameLower.includes('cured') || nameLower.includes('bacon') || nameLower.includes('ham') || 
                          nameLower.includes('sausage') || nameLower.includes('soy sauce') || nameLower.includes('salted') || 
                          nameLower.includes('anchovy') || nameLower.includes('pickle') || nameLower.includes('fish sauce');
  const sodiumPer100g = (itemNutrients.sodium / itemWeight) * 100;
  if (!isCuredOrSalted && sodiumPer100g > 500) {
    const realisticSodium = Math.round((250 + (addedSodium / (itemWeight / 100) || 150)) * (itemWeight / 100));
    if (addDebugLog) {
      addDebugLog(`[Dietitian Reality Check] Sodium for "${itemName}" (${itemNutrients.sodium}mg) was unrealistically high for a non-cured item. Reality check adjusted sodium from ${itemNutrients.sodium}mg to ${realisticSodium}mg.`);
    }

    itemNutrients.sodium = realisticSodium;
  }

  // 4b. Fast-Food Commercial Sodium Floor (Tier 3 Guardrail)
  applyCommercialSodiumFloor(itemName, itemNutrients, dbSource, addDebugLog, ctx);

  // 2. Fibre Reality Check (Specific for Kimchi / Radish)
  const isKimchiOrRadish = nameLower.includes('kimchi') || nameLower.includes('radish') || nameLower.includes('daikon') || nameLower.includes('kkakdugi');
  if (isKimchiOrRadish && (!itemNutrients.totalFibre || itemNutrients.totalFibre < 0.5)) {
    const expectedFibre = parseFloat(((1.6 / 100) * itemWeight).toFixed(2));
    const expectedSoluble = parseFloat(((0.5 / 100) * itemWeight).toFixed(2));
    if (addDebugLog) {
      addDebugLog(`[Dietitian Reality Check] Applied fibre estimation for "${itemName}" (kimchi/radish). Added ${expectedFibre}g total fibre, ${expectedSoluble}g soluble fibre.`);
    }
    itemNutrients.totalFibre = Math.max(itemNutrients.totalFibre || 0, expectedFibre);
    itemNutrients.solubleFibre = Math.max(itemNutrients.solubleFibre || 0, expectedSoluble);
  }

  // Backfill missing/zero soluble fibre based on food category when totalFibre > 0
  backfillSolubleFibre(itemNutrients, identityForChecks || itemName, addDebugLog);


  // 2. Protein Reality Check
  const proteinPer100g = (itemNutrients.protein / itemWeight) * 100;
  const isProteinPowder = nameLower.includes('powder') || nameLower.includes('isolate') || nameLower.includes('whey');
  if (!isProteinPowder && proteinPer100g > 45) {
     const realisticProtein = 45 * (itemWeight / 100);
     if (addDebugLog) {
       addDebugLog(`[Dietitian Reality Check] Protein for "${itemName}" (${itemNutrients.protein}g) exceeded 45g/100g ceiling. Capped to ${realisticProtein}g.`);
     }
     itemNutrients.protein = realisticProtein;
  }

  // 5. GENERIC Caloric Density Plausibility Check (applies to ALL food categories,
  // not name-specific). Catches wrong DB matches / hallucinated LLM estimates that
  // produce a physically implausible kcal-per-100g for the food's general category.
  // Intentionally wide bounds with extra margin — this is a coarse safety net for
  // gross errors (e.g. 400% off), not a precise validator, to avoid false positives.
  if (typeof itemNutrients.calories === 'number' && itemWeight > 0) {
    const CALORIC_DENSITY_BOUNDS: Record<string, [number, number]> = {
      bakery_dessert: [180, 600],
      meat_seafood: [60, 450],
      dairy_solid: [250, 750],
      raw_ingredient_dry_fat: [200, 900],
      grain_bakery_snack: [100, 560],
      fruit_vegetable: [10, 180],
      beverage: [0, 220],
      sauce_condiment: [20, 750],
    };
    const pfClass = classifyUniversalPhysicalFormV3({ name: itemName, canonicalDbName: itemName, keyword: itemName });
    const bounds = CALORIC_DENSITY_BOUNDS[pfClass.primaryCategory];
    if (bounds) {
      const [floor, ceiling] = bounds;
      const caloriesPer100g = (itemNutrients.calories / itemWeight) * 100;
      if (caloriesPer100g < floor * 0.5 || caloriesPer100g > ceiling * 1.6) {
        const midpointPer100g = (floor + ceiling) / 2;
        const realisticCalories = Math.round(midpointPer100g * (itemWeight / 100));
        const oldCal = itemNutrients.calories || 1;
        const scaleRatio = realisticCalories / oldCal;
        if (addDebugLog) {
          addDebugLog(`[Dietitian Reality Check] Caloric density for "${itemName}" (${Math.round(caloriesPer100g)} kcal/100g) was implausible for category "${pfClass.primaryCategory}" (expected ~${floor}-${ceiling} kcal/100g). Rescaled ${itemNutrients.calories} kcal -> ${realisticCalories} kcal for ${itemWeight}g.`);
        }
        itemNutrients.calories = realisticCalories;

        if (itemNutrients.totalFat) {
          itemNutrients.totalFat = Math.round(itemNutrients.totalFat * scaleRatio * 10) / 10;
        }
        if (itemNutrients.saturatedFat !== undefined && itemNutrients.saturatedFat !== null) {
          const ratio = getSaturatedFatRatio(itemName);
          const maxSatFat = (itemNutrients.totalFat || 0) * ratio;
          itemNutrients.saturatedFat = Math.min(
            Math.round(itemNutrients.saturatedFat * scaleRatio * 10) / 10,
            Math.round(maxSatFat * 10) / 10
          );
        }
        if (itemNutrients.protein) {
          itemNutrients.protein = Math.round(itemNutrients.protein * scaleRatio * 10) / 10;
        }
        if (itemNutrients.carbohydrates) {
          itemNutrients.carbohydrates = Math.round(itemNutrients.carbohydrates * scaleRatio * 10) / 10;
        }
        checkAtwaterConsistency(itemName, itemNutrients, addDebugLog);
      }
    }
  }
}

export function synchronizeNarrativeText(
  text: string,
  grandCal: number,
  grandP: number,
  grandFat: number,
  grandSatFat: number,
  grandNa: number,
  grandCarbs?: number
): string {
  if (!text || typeof text !== 'string') return text;

  let updated = text;

  const calVal = Math.round(grandCal);
  const pVal = Math.round(grandP * 10) / 10;
  const fatVal = Math.round(grandFat * 10) / 10;
  const satFatVal = Math.round(grandSatFat * 10) / 10;
  const naVal = Math.round(grandNa);
  const naFormatted = naVal.toLocaleString('en-US');

  // 1. Calories
  updated = updated.replace(/(roughly\s+|approximately\s+|about\s+)?\b[\d,]+(\.\d+)?\s*(calories|kcal)\b/gi, (match, prefix) => {
    return `${prefix || ''}${calVal} calories`;
  });

  // 2. Sodium
  updated = updated.replace(/\b[\d,]+(\.\d+)?\s*mg\s*(of\s*)?sodium\b/gi, `${naFormatted}mg of sodium`);
  updated = updated.replace(/sodium\s*\([^)]*[\d,]+(\.\d+)?\s*mg[^)]*\)/gi, `sodium (${naFormatted}mg)`);
  updated = updated.replace(/sodium\s*:\s*[\d,]+(\.\d+)?\s*mg/gi, `sodium: ${naFormatted}mg`);

  // 3. Saturated Fat
  updated = updated.replace(/\b[\d,]+(\.\d+)?\s*g\s*(of\s*)?saturated\s*fat\b/gi, `${satFatVal}g of saturated fat`);
  updated = updated.replace(/saturated\s*fat\s*\([^)]*[\d,]+(\.\d+)?\s*g[^)]*\)/gi, `saturated fat (${satFatVal}g)`);
  updated = updated.replace(/saturated\s*fat\s*:\s*[\d,]+(\.\d+)?\s*g/gi, `saturated fat: ${satFatVal}g`);

  // 4. Total Fat
  updated = updated.replace(/\b[\d,]+(\.\d+)?\s*g\s*(of\s*)?total\s*fat\b/gi, `${fatVal}g of total fat`);

  // 5. Protein
  updated = updated.replace(/\b[\d,]+(\.\d+)?\s*g\s*(of\s*)?protein\b/gi, `${pVal}g of protein`);
  updated = updated.replace(/protein\s*\([^)]*[\d,]+(\.\d+)?\s*g[^)]*\)/gi, `protein (${pVal}g)`);
  updated = updated.replace(/protein\s*:\s*[\d,]+(\.\d+)?\s*g/gi, `protein: ${pVal}g`);
  updated = updated.replace(/(roughly|approximately|about|around|~)\s*[\d,]+(\.\d+)?\s*g\s*(of\s*)?protein\b/gi, `~$pVal}g of protein`.replace('$pVal', String(pVal)));

  // 6. Carbohydrates
  if (grandCarbs !== undefined && grandCarbs > 0) {
    const carbVal = Math.round(grandCarbs * 10) / 10;
    updated = updated.replace(/\b[\d,]+(\.\d+)?\s*g\s*(of\s*)?(carbohydrates|carbs)\b/gi, `${carbVal}g of carbohydrates`);
  }

  return updated;
}



// Quantity words that make the plural/singular form already visible in a title
// grammatically correct regardless of itemsBreakdown's own canonical form
// (e.g. "Two Croissants" is correct even if canonicalDbName is singular "Croissant";
// "A Croissant" is correct even if canonicalDbName is plural "Croissants").
const TITLE_PARITY_SINGULAR_QUANTITY_RE = /^(a|an|one|1)$/i;
const TITLE_PARITY_PLURAL_QUANTITY_RE = /^(\d+|two|three|four|five|six|seven|eight|nine|ten|couple|few|several|many)$/i;

function pluralizeSimpleWord(word: string): string {
  if (/[sxz]$/i.test(word) || /(ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

function singularizeSimpleWord(word: string): string {
  if (/ies$/i.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|xes|zes|ses)$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word) && !/ss$/i.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * Enforces singular/plural parity between the composite meal title and each item's own
 * canonicalDbName/name in itemsBreakdown, per the system-prompt rule that requires them to
 * match exactly (e.g. itemsBreakdown "Croissant" (singular) but title says "Croissants").
 * The LLM is only asked to do this via prompt instruction with no code-level enforcement,
 * so mismatches slip through. Skips correction when a quantity word already visible in the
 * title (e.g. "Two", "A", "3") independently justifies the form that's already there.
 */
export function enforceTitlePluralParity(title: string, itemsBreakdown: any[]): string {
  if (!title || typeof title !== 'string' || !Array.isArray(itemsBreakdown) || itemsBreakdown.length === 0) {
    return title;
  }

  let updated = title;

  for (const it of itemsBreakdown) {
    const canonicalName = String((it && (it.canonicalDbName || it.name)) || '').trim();
    if (!canonicalName) continue;

    const words = canonicalName.split(/\s+/);
    const lastWord = words[words.length - 1];
    const restPrefix = words.slice(0, -1).join(' ');

    const singularLast = singularizeSimpleWord(lastWord);
    const pluralLast = pluralizeSimpleWord(singularLast);
    const canonicalIsPlural = lastWord.toLowerCase() === pluralLast.toLowerCase();
    const wrongFormLast = canonicalIsPlural ? singularLast : pluralLast;
    if (!wrongFormLast || wrongFormLast.toLowerCase() === lastWord.toLowerCase()) continue;

    const wrongPhrase = restPrefix ? `${restPrefix} ${wrongFormLast}` : wrongFormLast;
    const correctPhrase = restPrefix ? `${restPrefix} ${lastWord}` : lastWord;
    const escaped = wrongPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const re = new RegExp(`(\\S+\\s+)?\\b${escaped}\\b`, 'gi');
    updated = updated.replace(re, (match: string, precedingWord: string) => {
      const token = precedingWord ? precedingWord.trim() : '';
      if (canonicalIsPlural && TITLE_PARITY_SINGULAR_QUANTITY_RE.test(token)) return match;
      if (!canonicalIsPlural && TITLE_PARITY_PLURAL_QUANTITY_RE.test(token)) return match;
      return precedingWord ? `${precedingWord}${correctPhrase}` : correctPhrase;
    });
  }

  return updated;
}

export function build31NutrientsMarkdownServer(nutrients: Record<string, any>): string {
  if (!nutrients) return '';

  const coreList = [
    { key: 'calories', label: 'Calories', unit: 'kcal' },
    { key: 'protein', label: 'Protein', unit: 'g' },
    { key: 'carbohydrates', label: 'Carbohydrates', unit: 'g' },
    { key: 'totalFat', label: 'Total Fat', unit: 'g' },
    { key: 'saturatedFat', label: 'Saturated Fat', unit: 'g' },
    { key: 'transFat', label: 'Trans Fat', unit: 'g' },
    { key: 'addedSugar', label: 'Added Sugar', unit: 'g' },
    { key: 'sodium', label: 'Sodium', unit: 'mg' },
    { key: 'potassium', label: 'Potassium', unit: 'mg' },
    { key: 'totalFibre', label: 'Total Fibre', unit: 'g' },
    { key: 'solubleFibre', label: 'Soluble Fibre', unit: 'g' },
  ];

  const additionalList = [
    { key: 'unsaturatedFat', label: 'Unsaturated Fat', unit: 'g' },
    { key: 'omega3', label: 'Omega-3', unit: 'g' },
    { key: 'salt', label: 'Salt', unit: 'g' },
    { key: 'magnesium', label: 'Magnesium', unit: 'mg' },
    { key: 'calcium', label: 'Calcium', unit: 'mg' },
    { key: 'iron', label: 'Iron', unit: 'mg' },
    { key: 'zinc', label: 'Zinc', unit: 'mg' },
    { key: 'selenium', label: 'Selenium', unit: 'mcg' },
    { key: 'iodine', label: 'Iodine', unit: 'mcg' },
    { key: 'phosphorus', label: 'Phosphorus', unit: 'mg' },
    { key: 'vitaminD', label: 'Vitamin D', unit: 'IU' },
    { key: 'vitaminB12', label: 'Vitamin B12', unit: 'mcg' },
    { key: 'folate', label: 'Folate (B9)', unit: 'mcg' },
    { key: 'vitaminC', label: 'Vitamin C', unit: 'mg' },
    { key: 'vitaminE', label: 'Vitamin E', unit: 'mg' },
    { key: 'vitaminK', label: 'Vitamin K', unit: 'mcg' },
    { key: 'vitaminA', label: 'Vitamin A', unit: 'mcg' },
    { key: 'vitaminB6', label: 'Vitamin B6', unit: 'mg' },
    { key: 'thiamine', label: 'Thiamine (B1)', unit: 'mg' },
    { key: 'riboflavin', label: 'Riboflavin (B2)', unit: 'mg' },
    { key: 'niacin', label: 'Niacin (B3)', unit: 'mg' },
  ];

  const fmt = (v: any, unit: string) => {
    if (v === undefined || v === null || isNaN(Number(v))) return '--';
    const num = Math.round(Number(v) * 100) / 100;
    return unit ? `${num} ${unit}` : `${num}`;
  };

  const coreRows = coreList.map(item => `| ${item.label} | ${fmt(nutrients[item.key], item.unit)} |`);
  const populatedAdd = additionalList.filter(item => {
    const val = nutrients[item.key];
    return val !== undefined && val !== null && !isNaN(Number(val)) && Number(val) > 0;
  });
  const addRows = populatedAdd.map(item => `| ${item.label} | ${fmt(nutrients[item.key], item.unit)} |`);

  const lines = [
    "\n\n### 📋 Comprehensive Nutrient Values (31 Nutrients)\n",
    "#### Core Nutrients (11)",
    "| Nutrient | Value |",
    "|---|---|",
    ...coreRows
  ];

  if (addRows.length > 0) {
    lines.push(
      `\n#### Additional Nutrients (${addRows.length})`,
      "| Nutrient | Value |",
      "|---|---|",
      ...addRows
    );
  }

  return lines.join("\n");
}

export function backfillSolubleFibre(
  itemNutrients: Record<string, number>,
  itemName: string,
  addDebugLog?: (msg: string) => void
): void {
  if (!itemNutrients || typeof itemNutrients !== 'object') return;
  const totalF = Number(itemNutrients.totalFibre) || 0;
  const currentSoluble = Number(itemNutrients.solubleFibre) || 0;

  if (totalF > 0 && currentSoluble === 0) {
    const nameLower = (itemName || "").toLowerCase();
    let ratio = 0.20; // Default: 20% of total fiber is soluble

    if (/\b(oat|oats|oatmeal|porridge|psyllium|barley|rye)\b/i.test(nameLower)) {
      ratio = 0.35; // Beta-glucan rich oats/barley
    } else if (/\b(apple|apples|pear|pears|peach|peaches|plum|plums|grape|grapes|berry|berries|strawberry|strawberries|blueberry|blueberries|raspberry|raspberries|orange|oranges|citrus|banana|bananas|kiwi|kiwis|melon|melons|mango|mangoes|nectarine|nectarines|apricot|apricots|fig|figs|date|dates|prune|prunes|cherry|cherries|fruit|fruits)\b/i.test(nameLower)) {
      ratio = 0.30; // Pectin rich fresh/dried fruits
    } else if (/\b(bean|beans|lentil|lentils|chickpea|chickpeas|hummus|pea|peas|edamame|soy|soya)\b/i.test(nameLower)) {
      ratio = 0.30; // Legumes
    } else if (/\b(carrot|carrots|broccoli|brussels|sprout|sprouts|sweet potato|potato|potatoes|squash|onion|onions|radish|radishes|beet|beets|spinach|kale|cabbage|cauliflower|vegetable|veg|vegetables)\b/i.test(nameLower)) {
      ratio = 0.25; // Vegetables
    } else if (/\b(chia|flax|flaxseed|flaxseeds|almond|almonds|walnut|walnuts|seed|seeds|nut|nuts)\b/i.test(nameLower)) {
      ratio = 0.25; // Nuts & seeds
    } else if (/\b(wheat|quinoa|rice|bread|breads|cereal|cereals|granola|pasta|noodle|noodles)\b/i.test(nameLower)) {
      ratio = 0.20; // Whole grains/cereals
    }

    const calculated = parseFloat((totalF * ratio).toFixed(2));
    if (calculated > 0) {
      itemNutrients.solubleFibre = Math.min(totalF, calculated);
      if (addDebugLog) {
        addDebugLog(`[Soluble Fibre Backfill] "${itemName}": backfilled soluble fibre (${itemNutrients.solubleFibre}g) from total fibre (${totalF}g) using ratio ${(ratio * 100).toFixed(0)}% for food category.`);
      }
    }
  }
}

export function checkCategoryAndStateCompatibility(
  query: string,
  candidateName: string
): { compatible: boolean; reason?: string } {
  if (!query || !candidateName) return { compatible: true };
  const q = query.toLowerCase().trim();
  const c = candidateName.toLowerCase().trim();

  // 1. Beverage vs Solid
  const isQBeverage = /\b(beverage|beverages|drink|water|juice|beer|wine|soda|cola|tea|coffee|latte|mocha|macchiato|smoothie|shake|milk|oat\s*milk|almond\s*milk|soy\s*milk|coconut\s*milk|seltzer|powerade|gatorade)\b/i.test(q);
  const isCBeverage = /\b(beverage|beverages|drink|water|juice|beer|wine|soda|cola|tea|coffee|latte|mocha|macchiato|smoothie|shake|milk|oat\s*milk|almond\s*milk|soy\s*milk|coconut\s*milk|seltzer|powerade|gatorade)\b/i.test(c);
  const isQSolid = /\b(egg|eggs|yogurt|cheese|meat|chicken|steak|fish|salad|greens|bread|pastry|cake|cookie|tortilla|rice|pasta|grain|granola)\b/i.test(q);
  const isCSolid = /\b(egg|eggs|yogurt|cheese|meat|chicken|steak|fish|salad|greens|bread|pastry|cake|cookie|tortilla|rice|pasta|grain|granola)\b/i.test(c);

  if (isQBeverage && isCSolid && !isCBeverage) {
    return { compatible: false, reason: `Blocked solid candidate ("${candidateName}") for beverage query ("${query}")` };
  }
  if (isQSolid && isCBeverage && !isQBeverage) {
    return { compatible: false, reason: `Blocked beverage candidate ("${candidateName}") for solid food query ("${query}")` };
  }

  // 2. Pastry/Bakery vs Dairy/Yogurt/Produce
  const isBakery = /\b(pastry|pastries|danish|donut|doughnut|muffin|croissant|cake|pie|tart|cookie|cookies|brownie|scone|biscuit)\b/i.test(c);
  const isDairyOrProduce = /\b(yogurt|greek\s*yogurt|curd|milk|cheese|cottage\s*cheese|salad|greens|lettuce|spinach|kale|cabbage|apple|banana|orange|berry|berries)\b/i.test(q);
  if (isBakery && isDairyOrProduce && !/\b(pastry|cake|pie|tart)\b/i.test(q)) {
    return { compatible: false, reason: `Blocked bakery/pastry candidate ("${candidateName}") for dairy/produce query ("${query}")` };
  }

  // 3. Meat/Seafood vs Produce/Vegetables
  const isMeatSeafoodCandidate = /\b(beef|steak|pork|bacon|ham|sausage|chicken|turkey|duck|fish|salmon|tuna|cod|shrimp|prawn|crab|lobster|clams|seafood)\b/i.test(c);
  const isVegProduceQuery = /\b(salad|greens|lettuce|spinach|kale|cabbage|broccoli|cauliflower|carrot|cucumber|tomato|zucchini|pepper|onion)\b/i.test(q);
  if (isMeatSeafoodCandidate && isVegProduceQuery && !/\b(chicken|beef|steak|pork|bacon|ham|fish|salmon|tuna|shrimp|prawn|crab|turkey|duck|seafood)\b/i.test(q)) {
    return { compatible: false, reason: `Blocked meat/seafood candidate ("${candidateName}") for plain greens/vegetable query ("${query}")` };
  }

  // 4. Spice/Seasoning vs Fresh/Whole/Meat
  const isSpiceCandidate = /\b(spice|spices|seasoning|seasonings|powder|extract|flavoring|flavouring)\b/i.test(c);
  const isFreshWholeQuery = /\b(fresh|raw|whole|leaf|leaves|fruit|vegetable)\b/i.test(q);
  const isMeatSeafoodQuery = /\b(beef|steak|pork|bacon|ham|sausage|chicken|turkey|duck|fish|salmon|tuna|cod|shrimp|prawn|crab|lobster|clams|seafood)\b/i.test(q);
  if (isSpiceCandidate && isFreshWholeQuery && !/\b(spice|seasoning|powder|extract)\b/i.test(q)) {
    return { compatible: false, reason: `Blocked spice/seasoning candidate ("${candidateName}") for fresh/whole food query ("${query}")` };
  }
  if (isSpiceCandidate && isMeatSeafoodQuery && !/\b(spice|seasoning|powder|extract)\b/i.test(q)) {
    return { compatible: false, reason: `Blocked spice/seasoning candidate ("${candidateName}") for meat/seafood query ("${query}")` };
  }

  // 4b. Salt vs Butter/Fat
  const isSaltQuery = /\b(salt|table salt|sea salt|sodium chloride)\b/i.test(q);
  const isFatCandidate = /\b(butter|margarine|oil|ghee|shortening|lard)\b/i.test(c);
  if (isSaltQuery && isFatCandidate && !/\b(butter|margarine|oil|ghee|shortening|lard)\b/i.test(q)) {
    return { compatible: false, reason: `Blocked fat/butter candidate ("${candidateName}") for salt query ("${query}")` };
  }

  // 4c. Raw Flour/Grain vs Baked/Bread/Tortilla
  const isRawFlourQuery = /\b(flour|wheat flour|all-purpose flour|bread flour|cake flour|rye flour|semolina|cornmeal|raw grain|yeast)\b/i.test(q);
  const isBakedGoodCandidate = /\b(tortilla|tortillas|bread|flatbread|pita|naan|bun|buns|roll|rolls|croissant|pastry|muffin|cake|cookie|donut|doughnut|scone|biscuit|cracker|crackers)\b/i.test(c);
  if (isRawFlourQuery && isBakedGoodCandidate && !/\b(tortilla|bread|pita|naan|bun|roll|croissant|pastry|muffin|cake|cookie|donut|scone|biscuit|cracker)\b/i.test(q)) {
    return { compatible: false, reason: `Blocked baked/bread/tortilla candidate ("${candidateName}") for raw flour/grain query ("${query}")` };
  }

  // 5. Dried/Powder vs Fresh/Cooked
  const isDriedCandidate = /\b(dried|dehydrated|powder|powdered|freeze-dried|flakes)\b/i.test(c);
  const isCookedFreshQuery = /\b(fresh|raw|cooked|boiled|hard-boiled|steamed|grilled|baked|poached)\b/i.test(q);
  if (isDriedCandidate && isCookedFreshQuery && !/\b(dried|dehydrated|powder|powdered|flake|flakes)\b/i.test(q)) {
    return { compatible: false, reason: `Blocked dried/powder candidate ("${candidateName}") for fresh/cooked query ("${query}")` };
  }

  // 6. Condiment vs Produce
  const isCondimentCandidate = /\b(sauce|sauces|dressing|dressings|condiment|condiments|ketchup|mayo|mayonnaise|mustard|syrup|syrups)\b/i.test(c);
  const isProduceQuery = /\b(lettuce|spinach|apple|apples|strawberry|strawberries|kale|cabbage|broccoli|cauliflower|cucumber|cucumbers|tomato|tomatoes|zucchini|onion|onions|garlic)\b/i.test(q);
  if (isCondimentCandidate && isProduceQuery && !/\b(sauce|dressing|condiment|ketchup|mayo|mayonnaise|mustard|syrup)\b/i.test(q)) {
    return { compatible: false, reason: `Blocked condiment candidate ("${candidateName}") for fresh/whole produce query ("${query}")` };
  }

  return { compatible: true };
}

export function applyServerAverageNutrients(
  groups: any[],
  preCalcByScoutIndex: Record<number, Record<string, number>>
): any[] {
  if (!Array.isArray(groups)) return [];
  return groups.map((g) => {
    const indices: number[] = Array.isArray(g.scoutItemIndices) ? g.scoutItemIndices : [];
    if (indices.length === 0) {
      return g;
    }
    const sumMap: Record<string, number> = {};
    let count = 0;
    indices.forEach((idx) => {
      const nutrients = preCalcByScoutIndex[idx];
      if (nutrients) {
        count++;
        for (const [k, v] of Object.entries(nutrients)) {
          const num = Number(v) || 0;
          sumMap[k] = (sumMap[k] || 0) + num;
        }
      }
    });

    if (count > 0) {
      const avgMap: Record<string, number> = {};
      for (const [k, v] of Object.entries(sumMap)) {
        avgMap[k] = Math.round((v / count) * 10) / 10;
      }
      return {
        ...g,
        averageNutrients: avgMap,
      };
    }
    return g;
  });
}
