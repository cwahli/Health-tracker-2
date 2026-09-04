import { getUSDANutrientValue } from '../../../server_pure_helpers.js';

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
