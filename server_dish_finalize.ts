/**
 * server_dish_finalize.ts
 *
 * Core mathematical engine and truth hierarchy resolver for dish estimates:
 * - One scaler rule: R = consumedWeight / nutrientBasisWeight
 * - 3-rung truth hierarchy: OCR -> Brand Menu -> Scout Direct Nutrients
 * - Atomic staple USDA overlay without component assembly
 * - Post-Atwater pure TypeScript derivation of unsaturated fat, salt, and carbohydrate fallback
 */

import { classifyDishAtomic } from './server_dish_classify';
import { matchBrandMenu, BrandMatchResult } from './server_brand_match';
import {
  computeUnsaturatedFat,
  computeSaltFromSodium,
  deriveCarbohydratesFromEnergy,
} from './server_derivation';

export interface FinalizeInput {
  item: any;
  nutrientBasisWeight?: number;
  consumedWeight?: number;
  storedBrandLock?: {
    id: string;
    basisType: 'per_dish' | 'per_100g' | string;
    servingGrams: number | null;
    keys: string[];
    valuesAtBasis: Record<string, number>;
    per100g?: Record<string, number> | null;
  } | null;
  storedOcrLock?: {
    basisType: 'per_dish' | 'per_100g' | string;
    servingGrams: number | null;
    keys: string[];
    valuesAtBasis: Record<string, number>;
  } | null;
}

export interface DishLedger {
  scoutIndex: number;
  originalName: string;
  keyword?: string;
  chainName: string | null;
  weightGrams: number;
  nutrientBasisWeight: number;
  ingredients: string[];
  visualIngredients: string[];
  nutrients: Record<string, number | null>;
  lockedNutrientKeys: string[];
  brandLock?: FinalizeInput['storedBrandLock'];
  dishClass: 'atomic' | 'composed';
  dbSource: 'label' | 'brand_official' | 'usda' | 'estimated';
  dbId: string | null;
  atwaterFlag: { deviationPct: number; flagged: boolean } | null;
  usdaQueries: string[];
}

const ATWATER_TOLERANCE = 0.35;

export async function finalizeDishLedger(input: FinalizeInput): Promise<DishLedger> {
  const item = input.item || {};
  const scoutIndex = Number(item.scoutIndex ?? 0);
  const originalName = String(item.originalName || item.keyword || 'Dish');
  const keyword = item.keyword ? String(item.keyword) : undefined;
  const chainName = item.chainName ? String(item.chainName) : null;

  const consumedWeight = Math.max(1, Math.round(Number(input.consumedWeight ?? item.estimatedWeightGrams ?? 100)));
  const nutrientBasisWeight = Math.max(1, Math.round(Number(input.nutrientBasisWeight ?? item.nutrientBasisWeight ?? item.estimatedWeightGrams ?? consumedWeight)));
  const R = consumedWeight / nutrientBasisWeight;

  const ingredients: string[] = Array.isArray(item.ingredients) ? item.ingredients : [];
  const visualIngredients: string[] = Array.isArray(item.visualIngredients) && item.visualIngredients.length > 0
    ? item.visualIngredients
    : (ingredients.length > 0 ? ingredients : []);

  const dishClass = classifyDishAtomic({ originalName, keyword, ingredients });

  const nutrients: Record<string, number | null> = {};
  const lockedNutrientKeys: string[] = [];
  let dbSource: 'label' | 'brand_official' | 'usda' | 'estimated' = 'estimated';
  let dbId: string | null = null;
  let brandLock: FinalizeInput['storedBrandLock'] = input.storedBrandLock || null;
  const usdaQueries: string[] = [];

  // 1. Check OCR label truth
  const rawLabel = item.rawNutritionLabel || item.nutritionFacts;
  const hasOcr = rawLabel && (typeof rawLabel === 'object') && (rawLabel.calories != null || rawLabel.energy != null || rawLabel.kcal != null);

  if (hasOcr || input.storedOcrLock) {
    dbSource = 'label';
    const isPer100g = rawLabel?.basisType === 'per_100g' ||
      rawLabel?.servingSize === '100g' ||
      rawLabel?.serving === '100g' ||
      (input.storedOcrLock && input.storedOcrLock.basisType === 'per_100g');
    
    let ocrServingGrams: number | null = null;
    if (rawLabel?.servingGrams && Number(rawLabel.servingGrams) > 0) {
      ocrServingGrams = Number(rawLabel.servingGrams);
    } else if (rawLabel?.servingSize) {
      const match = String(rawLabel.servingSize).match(/([\d.]+)\s*g/i);
      if (match) ocrServingGrams = parseFloat(match[1]);
    }

    const ocrScale = isPer100g
      ? (consumedWeight / 100)
      : ((ocrServingGrams && ocrServingGrams > 0) ? (consumedWeight / ocrServingGrams) : R);
    
    // Process OCR nutrients
    const rawCalStr = rawLabel?.calories ?? rawLabel?.energy ?? rawLabel?.kcal;
    const ocrCal = typeof rawCalStr === 'number'
      ? rawCalStr
      : (rawCalStr ? parseFloat(String(rawCalStr).replace(/[^0-9.]/g, '')) : NaN);
    if (Number.isFinite(ocrCal) && ocrCal > 0) {
      nutrients.calories = Math.round(ocrCal * ocrScale);
      lockedNutrientKeys.push('calories');
    }

    const OCR_FIELDS = ['protein', 'totalFat', 'saturatedFat', 'transFat', 'carbohydrates', 'sugar', 'totalSugar', 'sodium', 'salt', 'totalFibre', 'potassium'];
    for (const f of OCR_FIELDS) {
      const v = rawLabel?.[f] ? parseFloat(String(rawLabel[f]).replace(/[^0-9.]/g, '')) : NaN;
      if (Number.isFinite(v)) {
        const normKey = f === 'totalSugar' ? 'sugar' : f;
        nutrients[normKey] = Math.round(v * ocrScale * 10) / 10;
        if (!lockedNutrientKeys.includes(normKey)) lockedNutrientKeys.push(normKey);
      }
    }
  }

  // 2. Check Brand database truth (if not locked by OCR)
  if (dbSource !== 'label') {
    if (brandLock) {
      // Re-rating an already-stored brand lock (Portion edit or D8)
      dbSource = 'brand_official';
      dbId = brandLock.id;
      for (const [k, v] of Object.entries(brandLock.valuesAtBasis)) {
        if (brandLock.basisType === 'per_100g') {
          nutrients[k] = Math.round(v * (consumedWeight / 100) * 10) / 10;
        } else {
          nutrients[k] = Math.round(v * R * 10) / 10;
        }
        if (!lockedNutrientKeys.includes(k)) lockedNutrientKeys.push(k);
      }
      if (nutrients.calories) nutrients.calories = Math.round(nutrients.calories);
    } else {
      // First analyze match
      const brandMatch: BrandMatchResult = await matchBrandMenu(chainName, originalName, keyword);
      if (brandMatch.matched && brandMatch.hit) {
        dbSource = 'brand_official';
        dbId = String(brandMatch.hit.id || brandMatch.hit.dish_name || originalName);
        brandLock = {
          id: dbId,
          basisType: brandMatch.basisType || 'per_dish',
          servingGrams: brandMatch.servingGrams || null,
          keys: brandMatch.lockedKeys || [],
          valuesAtBasis: brandMatch.valuesAtBasis || {},
        };
        for (const [k, v] of Object.entries(brandLock.valuesAtBasis)) {
          if (brandLock.basisType === 'per_100g') {
            nutrients[k] = Math.round(v * (consumedWeight / 100) * 10) / 10;
          } else {
            // per_dish at basis portion
            nutrients[k] = Math.round(v * R * 10) / 10;
          }
          if (!lockedNutrientKeys.includes(k)) lockedNutrientKeys.push(k);
        }
        if (nutrients.calories) nutrients.calories = Math.round(nutrients.calories);
      }
    }
  }

  // 3. Fill remaining unlocked nutrients from Scout base estimates scaled by R
  const scoutNutrients = item.nutrients || {};
  const SCOUT_KEYS = [
    'calories', 'protein', 'totalFat', 'saturatedFat', 'transFat',
    'addedSugar', 'totalSugar', 'sugar', 'totalFibre', 'sodium',
    'carbohydrates', 'potassium', 'omega3', 'calcium', 'iron',
    'magnesium', 'vitaminD'
  ];

  for (const k of SCOUT_KEYS) {
    const targetKey = k === 'totalSugar' ? 'sugar' : k;
    if (lockedNutrientKeys.includes(targetKey)) continue;

    const rawVal = scoutNutrients[k] ?? (k === 'calories' ? item.estimatedCalories : null);
    if (rawVal !== undefined && rawVal !== null && Number.isFinite(Number(rawVal))) {
      const numVal = Number(rawVal);
      nutrients[targetKey] = targetKey === 'calories' || targetKey === 'sodium' || targetKey === 'potassium' || targetKey === 'calcium' || targetKey === 'magnesium'
        ? Math.round(numVal * R)
        : Math.round(numVal * R * 10) / 10;
    } else {
      if (nutrients[targetKey] === undefined) {
        nutrients[targetKey] = null;
      }
    }
  }

  // Fallback if scout nutrients were absent and not locked by OCR/Brand
  if (nutrients.calories == null || !(nutrients.calories > 0)) {
    const hay = `${originalName} ${keyword || ''}`.toLowerCase();
    const isDrink = /\b(drink|juice|tea|coffee|soda|water|beverage|iced|smoothie|es\b)/i.test(hay);
    const isNoodleRice = /\b(noodle|noodles|rice|pasta|mie|bihun|kwetiau|spaghetti)\b/i.test(hay);
    const isMeatDumpling = /\b(dumpling|dumplings|siomay|dim sum|wonton|chicken|beef|pork|fish|meat)\b/i.test(hay);

    if (isDrink) {
      nutrients.calories = Math.round(consumedWeight * 0.45);
      nutrients.carbohydrates = Math.round(consumedWeight * 0.11 * 10) / 10;
      nutrients.sugar = Math.round(consumedWeight * 0.10 * 10) / 10;
      nutrients.protein = 0;
      nutrients.totalFat = 0;
      nutrients.saturatedFat = 0;
      nutrients.sodium = Math.round(consumedWeight * 0.05);
    } else if (isNoodleRice) {
      nutrients.calories = Math.round(consumedWeight * 1.8);
      nutrients.carbohydrates = Math.round(consumedWeight * 0.30 * 10) / 10;
      nutrients.protein = Math.round(consumedWeight * 0.06 * 10) / 10;
      nutrients.totalFat = Math.round(consumedWeight * 0.04 * 10) / 10;
      nutrients.saturatedFat = Math.round(consumedWeight * 0.01 * 10) / 10;
      nutrients.sodium = Math.round(consumedWeight * 2.5);
    } else if (isMeatDumpling) {
      nutrients.calories = Math.round(consumedWeight * 1.9);
      nutrients.protein = Math.round(consumedWeight * 0.12 * 10) / 10;
      nutrients.totalFat = Math.round(consumedWeight * 0.08 * 10) / 10;
      nutrients.saturatedFat = Math.round(consumedWeight * 0.02 * 10) / 10;
      nutrients.carbohydrates = Math.round(consumedWeight * 0.15 * 10) / 10;
      nutrients.sodium = Math.round(consumedWeight * 3.5);
    } else {
      nutrients.calories = Math.round(consumedWeight * 1.6);
      nutrients.carbohydrates = Math.round(consumedWeight * 0.20 * 10) / 10;
      nutrients.protein = Math.round(consumedWeight * 0.08 * 10) / 10;
      nutrients.totalFat = Math.round(consumedWeight * 0.05 * 10) / 10;
      nutrients.saturatedFat = Math.round(consumedWeight * 0.01 * 10) / 10;
      nutrients.sodium = Math.round(consumedWeight * 2.0);
    }
  }

  // 4. Atwater Consistency & Carbohydrate Derivation
  const p = nutrients.protein ?? 0;
  const f = nutrients.totalFat ?? 0;
  const cal = nutrients.calories ?? 0;
  let atwaterFlag: { deviationPct: number; flagged: boolean } | null = null;

  if (nutrients.carbohydrates !== null && nutrients.carbohydrates !== undefined && Number.isFinite(Number(nutrients.carbohydrates))) {
    const c = Number(nutrients.carbohydrates);
    const atwaterKcal = 4 * p + 4 * c + 9 * f;
    const deviation = cal > 0 ? Math.abs(atwaterKcal - cal) / cal : 0;
    const flagged = deviation > ATWATER_TOLERANCE;
    atwaterFlag = {
      deviationPct: Math.round(deviation * 100),
      flagged,
    };
  } else {
    // Derive carbohydrates from energy when missing
    nutrients.carbohydrates = deriveCarbohydratesFromEnergy(cal, p, f);
    atwaterFlag = null;
  }

  // 5. Derive Unsaturated Fat and Salt
  nutrients.unsaturatedFat = computeUnsaturatedFat(nutrients.totalFat, nutrients.saturatedFat, nutrients.transFat);
  nutrients.salt = computeSaltFromSodium(nutrients.sodium);

  return {
    scoutIndex,
    originalName,
    keyword,
    chainName,
    weightGrams: consumedWeight,
    nutrientBasisWeight,
    ingredients,
    visualIngredients,
    nutrients,
    lockedNutrientKeys,
    brandLock,
    dishClass,
    dbSource,
    dbId,
    atwaterFlag,
    usdaQueries,
  };
}
