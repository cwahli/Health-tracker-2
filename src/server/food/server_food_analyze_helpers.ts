import { getUSDANutrientValue } from '../../../server_pure_helpers.js';
import { isKnownDatabaseBrandSync, normalizeChainKey } from '../../../serverBrandMenu.js';

export const formatUSDANutrients = (nutrients: any[]): string => {
  if (!nutrients || !Array.isArray(nutrients)) return "No nutrients available";

  const findNutrient = (namePatterns: string[]) => {
    const exactMatch = nutrients.find(n => {
      const name = (n.nutrientName || (n.nutrient && n.nutrient.name) || "").toLowerCase().trim();
      return namePatterns.some(p => name === p.toLowerCase().trim());
    });
    if (exactMatch) {
      const val = getUSDANutrientValue(exactMatch);
      const unit = exactMatch.unitName || (exactMatch.nutrient && exactMatch.nutrient.unitName) || "";
      return `${val}${unit}`;
    }

    const nut = nutrients.find(n => {
      const name = (n.nutrientName || (n.nutrient && n.nutrient.name) || "").toLowerCase();
      return namePatterns.some(p => {
        const cleanP = p.toLowerCase().trim();
        if (cleanP === "fat" && name.includes("fatty")) {
          return false;
        }
        return name.includes(cleanP);
      });
    });
    if (!nut) return null;
    const val = getUSDANutrientValue(nut);
    const unit = nut.unitName || (nut.nutrient && nut.nutrient.unitName) || "";
    return `${val}${unit}`;
  };

  const mapped: string[] = [];
  const kcal = findNutrient(["energy", "calories"]);
  const protein = findNutrient(["protein"]);
  const fat = findNutrient(["total lipid", "fat"]);
  const satFat = findNutrient(["saturated fat", "fatty acids, total saturated"]);
  const sodium = findNutrient(["sodium"]);

  if (kcal) mapped.push(`Calories: ${kcal}`);
  if (protein) mapped.push(`Protein: ${protein}`);
  if (fat) mapped.push(`Fat: ${fat}`);
  if (satFat) mapped.push(`SatFat: ${satFat}`);
  if (sodium) mapped.push(`Sodium: ${sodium}`);

  return mapped.join(", ");
};

export const formatOFFNutrients = (nutriments: any): string => {
  if (!nutriments) return "No nutrients available";
  const mapped: string[] = [];

  const formatVal = (val: any) => {
    if (val === undefined || val === null) return null;
    const num = Number(val);
    return isNaN(num) ? val : Math.round(num * 100) / 100;
  };

  const kcal = nutriments["energy-kcal_100g"] !== undefined 
    ? formatVal(nutriments["energy-kcal_100g"]) 
    : (nutriments["energy_100g"] !== undefined ? formatVal(Math.round(nutriments["energy_100g"] / 4.184)) : null);
  const protein = formatVal(nutriments["proteins_100g"]);
  const fat = formatVal(nutriments["fat_100g"]);
  const satFat = formatVal(nutriments["saturated-fat_100g"]);
  const sodium = formatVal(nutriments["sodium_100g"]);

  if (kcal !== null) mapped.push(`Calories: ${kcal}kcal`);
  if (protein !== null) mapped.push(`Protein: ${protein}g`);
  if (fat !== null) mapped.push(`Fat: ${fat}g`);
  if (satFat !== null) mapped.push(`SatFat: ${satFat}g`);
  if (sodium !== null) mapped.push(`Sodium: ${sodium}g`);

  return mapped.join(", ");
};

export const extractOFFNutrientsPer100g = (product: any): Record<string, number> => {
  const profile: Record<string, number> = {};
  const n = product.nutriments;
  if (!n) return profile;

  const setNum = (key: string, field: string, scale: number = 1) => {
    if (n[field] !== undefined && n[field] !== null) {
      const val = Number(n[field]) * scale;
      if (!isNaN(val)) profile[key] = Math.round(val * 100) / 100;
    }
  };

  setNum('calories', 'energy-kcal_100g');
  if (profile.calories === undefined) {
    setNum('calories', 'energy_100g', 1 / 4.184); // kJ to kcal fallback
  }

  setNum('protein', 'proteins_100g');
  setNum('totalFat', 'fat_100g');
  setNum('saturatedFat', 'saturated-fat_100g');
  setNum('transFat', 'trans-fat_100g');
  setNum('carbohydrates', 'carbohydrates_100g');
  setNum('sugar', 'sugars_100g');
  setNum('totalFibre', 'fiber_100g');
  setNum('sodium', 'sodium_100g', 1000); // g to mg
  setNum('cholesterol', 'cholesterol_100g', 1000); // g to mg

  return profile;
};

export const isFastFoodChain = (query: string): boolean => {
  const chains = ['mcdonald', 'kfc', 'burger king', 'subway', 'domino', 'pizza hut', 'wendy', 'taco bell', 'starbucks', 'greggs', 'nando'];
  const q = query.toLowerCase();
  return chains.some(c => q.includes(c));
};

export const buildWebSearchQuery = (item: any): string | null => {
  if (!item) return null;
  const name = item.keyword || item.originalName || item.name;
  if (!name) return null;
  const chain = item.chainName || item.brandOwner;
  if (chain && !name.toLowerCase().includes(chain.toLowerCase())) {
    return `${chain} ${name} nutrition facts`;
  }
  return `${name} nutrition facts`;
};

/**
 * F-8.10 shard 1 — DB-search query normalization, extracted verbatim from
 * runFoodAnalyze. Pure string transforms; no request/streaming closure deps.
 */
export const loosenQuery = (query: string): string => {
  if (!query) return "";
  let q = query.toLowerCase().trim();
  // Strip common brand adjectives and prefixes
  q = q.replace(/\b(sainsburys?|tesco|morrisons?|asda|aldi|lidl|waitrose|marks\s*&\s*spencer|m&s|official|fresh|raw|cooked|baked|fried|roasted|steamed|boiled|grilled|organic|natural|wild|sweet|spicy|pure|premium|classic|canned|frozen|delicious|tasty|freshly)\b/g, '');
  // Normalize plurals (simple s/es stripping for common words, especially fruits/vegetables)
  q = q.replace(/\b(clementines|mandarins|tangerines|oranges|berries|raspberries|strawberries|blueberries|grapes|apples|pears|peaches|plums|bananas|lemons|limes|tomatoes|cucumbers|radishes|onions|carrots|potatoes|mushrooms|peas|beans)\b/g, (match) => {
    if (match === 'berries') return 'berry';
    if (match === 'raspberries') return 'raspberry';
    if (match === 'strawberries') return 'strawberry';
    if (match === 'blueberries') return 'blueberry';
    if (match === 'tomatoes') return 'tomato';
    if (match === 'potatoes') return 'potato';
    if (match === 'radishes') return 'radish';
    if (match.endsWith('es')) return match.slice(0, -2);
    if (match.endsWith('s')) return match.slice(0, -1);
    return match;
  });
  q = q.replace(/\s+/g, ' ').trim();
  return q;
};

export const cleanQuery = (raw: string) => {
  let clean = raw.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase();
  clean = clean.replace(/\b(soda|can|bottle|pack|tub|slice|cubes|pieces|portion|raw|cooked|boiled|baked|grilled|steamed)\b/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) clean = raw.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase();
  const indonesianToEnglish: Record<string, string> = {
    "potongan ikan": "raw fish fillet",
    "ikan potongan": "raw fish fillet",
    "ikan": "raw fish",
    "daging sapi": "raw beef",
    "daging": "raw beef",
    "ayam": "raw chicken",
    "sayur": "vegetables",
    "nasi": "cooked rice",
    "telur": "egg",
    "tempe": "tempeh",
    "tahu": "tofu",
    "kentang": "potato",
    "wortel": "carrot"
  };
  for (const [indo, eng] of Object.entries(indonesianToEnglish)) {
    const regex = new RegExp(`\\b${indo}\\b`, 'g');
    if (regex.test(clean)) {
      clean = clean.replace(regex, eng);
    }
  }
  // Automatically prepend "raw" to meats to prevent fetching salted/cooked versions, unless it's a known chain or already specified
  const meats = ["beef", "chicken", "pork", "fish", "steak", "lamb", "mutton", "veal", "salmon", "tuna", "cod", "shrimp", "prawn", "duck"];
  const preparedModifiers = ["raw", "cooked", "fried", "roasted", "grilled", "baked", "boiled", "smoked", "cured", "canned"];
  const chainModifiers = ["mcdonald", "kfc", "burger king", "subway", "brand"];
  const isMeat = meats.some(m => clean.includes(m));
  const hasPreparation = preparedModifiers.some(p => clean.includes(p));
  const isChain = chainModifiers.some(c => clean.includes(c));
  if (isMeat && !hasPreparation && !isChain) {
    clean = "raw " + clean;
  }
  return clean;
};

export const chainPatterns: [string, RegExp][] = [
  ['sainsbury', /\bsainsbury\b/i],
  ['yolk', /\byolk\b/i],
  ['mcdonalds', /mcdonald|maccas|麦当劳/i],
  ['kfc', /\bkfc\b|kentucky/i],
  ['coco_di_mama', /coco\s*di\s*mama|cocodimama/i],
  ['costa', /\bcosta\b/i],
  ['wasabi', /\bwasabi\b/i],
  ['itsu', /\bitsu\b/i],
  ['honi_poke', /honi\s*poke|honipoke/i],
  ['pret', /\bpret\b/i],
  ['starbucks', /starbucks/i],
  ['quaker', /\bquaker\b/i],
  ['jack_daniels', /jack\s*daniel/i],
];

export const detectChainKeyFromText = (str: string): string | undefined => {
  const s = String(str || '').toLowerCase();
  const matched = chainPatterns.find(([, rx]) => rx.test(s));
  if (matched) return matched[0];
  // Dynamic database brand match
  if (isKnownDatabaseBrandSync(s)) {
    const words = s.split(/[^a-z0-9]+/);
    for (const w of words) {
      if (w.length >= 3 && isKnownDatabaseBrandSync(w)) {
        return normalizeChainKey(w);
      }
    }
  }
  return undefined;
};
