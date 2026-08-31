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
  computeCaloriesFromMacros,
  computeUnsaturatedFat,
  computeSaltFromSodium,
  deriveCarbohydratesFromEnergy,
  decomposeSaucedEntree,
} from './server_derivation';
import { backfillSparseMicronutrients } from './server_pure_helpers';
import { deduceSugarBreakdown } from './server_sugar_engine';

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
  /** Brand-rung residual: HIT / MULTI / MISS / SKIPPED. Honest MISS does not invent micronutrients. */
  bindStatus?: 'HIT' | 'MULTI' | 'MISS' | 'SKIPPED' | null;
  atwaterFlag: { deviationPct: number; flagged: boolean } | null;
  usdaQueries: string[];
  components?: any[];
  componentsDetailList?: any[];
  compositeSiblings?: any[];
  hasComponents?: boolean;
  ingredientsList?: string | null;
}

const ATWATER_TOLERANCE = 0.35;

export function parseOcrLabel(rawLabel: any, targetWeight: number, defaultR: number, storedOcrLock?: any) {
  const ocrNutrients: Record<string, number> = {};
  const lockedKeys: string[] = [];
  
  if (!rawLabel || typeof rawLabel !== 'object') {
    return { ocrNutrients, lockedKeys };
  }

  const isPer100g = rawLabel.basisType === 'per_100g' ||
    rawLabel.servingSize === '100g' ||
    rawLabel.serving === '100g' ||
    (storedOcrLock && storedOcrLock.basisType === 'per_100g');
      
  let ocrServingGrams: number | null = null;
  if (rawLabel.servingGrams && Number(rawLabel.servingGrams) > 0) {
    ocrServingGrams = Number(rawLabel.servingGrams);
  } else if (rawLabel.servingSize) {
    const match = String(rawLabel.servingSize).match(/([\d.]+)\s*(?:g|grams?|ml|mL|milliliters?|fl\s*oz)?/i);
    if (match && match[1]) {
      const parsedNum = parseFloat(match[1]);
      if (Number.isFinite(parsedNum) && parsedNum > 0) {
        if (/fl\s*oz/i.test(String(rawLabel.servingSize))) {
          ocrServingGrams = Math.round(parsedNum * 29.57);
        } else {
          ocrServingGrams = parsedNum;
        }
      }
    }
  } else if (rawLabel.servingsPerContainer && Number(rawLabel.servingsPerContainer) > 1 && targetWeight > 50) {
    ocrServingGrams = Math.round(targetWeight / Number(rawLabel.servingsPerContainer));
  }
  const ocrScale = isPer100g
    ? (targetWeight / 100)
    : ((ocrServingGrams && ocrServingGrams > 0) ? (targetWeight / ocrServingGrams) : defaultR);
      
  const rawCalStr = rawLabel.calories ?? rawLabel.energy ?? rawLabel.kcal ?? rawLabel.energyKcal;
  const ocrCal = typeof rawCalStr === 'number'
    ? rawCalStr
    : (rawCalStr ? parseFloat(String(rawCalStr).replace(/[^0-9.]/g, '')) : NaN);
  if (Number.isFinite(ocrCal) && ocrCal > 0) {
    ocrNutrients.calories = Math.round(ocrCal * ocrScale);
    lockedKeys.push('calories');
  }

  const OCR_FIELD_ALIASES: Record<string, string[]> = {
    protein: ['protein', 'proteins'],
    totalFat: ['totalFat', 'fat', 'total_fat', 'lipids'],
    saturatedFat: ['saturatedFat', 'satFat', 'saturated_fat', 'sat_fat'],
    transFat: ['transFat', 'trans_fat'],
    carbohydrates: ['carbohydrates', 'totalCarbohydrate', 'totalCarbohydrates', 'carbohydrate', 'carbs', 'totalCarb', 'total_carbohydrate'],
    sugar: ['sugar', 'sugars', 'totalSugar', 'totalSugars', 'total_sugar'],
    addedSugar: ['addedSugar', 'addedSugars', 'added_sugar', 'includesAddedSugars'],
    sodium: ['sodium', 'na'],
    salt: ['salt'],
    totalFibre: ['totalFibre', 'totalFiber', 'fiber', 'fibre', 'dietaryFiber', 'dietary_fiber'],
    solubleFibre: ['solubleFibre', 'solubleFiber'],
    potassium: ['potassium', 'k'],
    calcium: ['calcium', 'ca'],
    iron: ['iron', 'fe'],
    magnesium: ['magnesium', 'mg'],
    vitaminD: ['vitaminD', 'vitD', 'vitamin_d'],
    omega3: ['omega3', 'omega_3'],
  };

  for (const [normKey, aliases] of Object.entries(OCR_FIELD_ALIASES)) {
    let rawVal: any = undefined;
    for (const alias of aliases) {
      if (rawLabel[alias] !== undefined && rawLabel[alias] !== null && rawLabel[alias] !== '' && rawLabel[alias] !== '-' && rawLabel[alias] !== '--') {
        rawVal = rawLabel[alias];
        break;
      }
    }
    if (rawVal !== undefined && rawVal !== null) {
      const v = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal).replace(/[^0-9.]/g, ''));
      if (Number.isFinite(v)) {
        ocrNutrients[normKey] = (normKey === 'sodium' || normKey === 'potassium' || normKey === 'calcium' || normKey === 'magnesium')
          ? Math.round(v * ocrScale)
          : Math.round(v * ocrScale * 10) / 10;
        lockedKeys.push(normKey);
      }
    }
  }
  if (ocrNutrients.salt != null && (ocrNutrients.sodium == null || !lockedKeys.includes('sodium'))) {
    ocrNutrients.sodium = Math.round(Number(ocrNutrients.salt) * 400);
    lockedKeys.push('sodium');
  }
  return { ocrNutrients, lockedKeys };
}

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
  let bindStatus: DishLedger['bindStatus'] = null;
  const usdaQueries: string[] = [];

  // 1. Check OCR label truth
  const rawLabel = item.rawNutritionLabel || item.nutritionFacts;
  const hasOcr = rawLabel && (typeof rawLabel === 'object') && (rawLabel.calories != null || rawLabel.energy != null || rawLabel.kcal != null);

  if (hasOcr || input.storedOcrLock) {
    dbSource = 'label';
    const { ocrNutrients, lockedKeys } = parseOcrLabel(rawLabel, consumedWeight, R, input.storedOcrLock);
    
    for (const [k, v] of Object.entries(ocrNutrients)) {
      nutrients[k] = v;
    }
    for (const key of lockedKeys) {
      if (!lockedNutrientKeys.includes(key)) lockedNutrientKeys.push(key);
    }
  }

  // 2. Check Brand database truth (if not locked by OCR)
  if (dbSource !== 'label') {
    if (brandLock) {
      // Re-rating an already-stored brand lock (Portion edit or D8)
      dbSource = 'brand_official';
      bindStatus = 'HIT';
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
      const hasSubcomponents = item.hasComponents || (Array.isArray(item.componentsDetailList) && item.componentsDetailList.length > 0) || (Array.isArray(item.components) && item.components.length > 0) || (Array.isArray(item.compositeSiblings) && item.compositeSiblings.length > 0);
      const shouldAttemptBrandMatch = !hasSubcomponents || Boolean(chainName);
      
      let brandMatch: BrandMatchResult = { matched: false, status: 'MISS' };
      if (shouldAttemptBrandMatch) {
        brandMatch = await matchBrandMenu(chainName, originalName, keyword);
        bindStatus = brandMatch.status;
      } else {
        bindStatus = 'SKIPPED';
      }

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

  // 3. Fill remaining unlocked nutrients from Scout base estimates scaled by R (or calorie-adjusted R for brand locks)
  const scoutNutrients = item.nutrients || {};
  const scoutCal = Number(scoutNutrients.calories ?? item.estimatedCalories ?? 0);
  const brandCal = nutrients.calories != null ? Number(nutrients.calories) : null;
  const effectiveR = (dbSource === 'brand_official' && brandCal && scoutCal > 0)
    ? (brandCal / scoutCal)
    : R;

  const SCOUT_KEYS = [
    'calories', 'protein', 'totalFat', 'saturatedFat', 'transFat', 'unsaturatedFat',
    'carbohydrates', 'sugar', 'totalSugar', 'addedSugar', 'totalFibre', 'solubleFibre',
    'sodium', 'potassium', 'magnesium', 'calcium', 'iron', 'zinc', 'selenium', 'iodine',
    'phosphorus', 'vitaminD', 'vitaminB12', 'folate', 'vitaminC', 'vitaminE', 'vitaminK',
    'vitaminA', 'vitaminB6', 'thiamine', 'riboflavin', 'niacin', 'omega3'
  ];

  for (const k of SCOUT_KEYS) {
    const targetKey = k === 'totalSugar' ? 'sugar' : k;
    if (lockedNutrientKeys.includes(targetKey)) continue;

    const rawVal = scoutNutrients[k] ?? (k === 'calories' ? item.estimatedCalories : null);
    if (rawVal !== undefined && rawVal !== null && Number.isFinite(Number(rawVal))) {
      const numVal = Number(rawVal);
      nutrients[targetKey] = targetKey === 'calories' || targetKey === 'sodium' || targetKey === 'potassium' || targetKey === 'calcium' || targetKey === 'magnesium'
        ? Math.round(numVal * effectiveR)
        : Math.round(numVal * effectiveR * 10) / 10;
    } else {
      if (nutrients[targetKey] === undefined) {
        nutrients[targetKey] = null;
      }
    }
  }

  // Fallback if scout nutrients were absent and not locked by OCR/Brand
  const hasValidMacros = (nutrients.protein != null || nutrients.carbohydrates != null || nutrients.totalFat != null);
  if (!hasValidMacros && (nutrients.calories == null || !(nutrients.calories > 0))) {
    const hay = `${originalName} ${keyword || ''}`.toLowerCase();
    const isCoconutWater = /\b(coconut\s*water|coconut\s*juice|air\s*kelapa|kelapa\s*muda|raw\s*coconut)\b/i.test(hay) && !/\b(milk|santan|curry|cream)\b/i.test(hay);
    const isDrink = /\b(drink|juice|tea|coffee|soda|water|beverage|iced|smoothie|es\b)/i.test(hay);
    const isNoodleRice = /\b(noodle|noodles|rice|pasta|mie|bihun|kwetiau|spaghetti)\b/i.test(hay);
    const isMeatDumpling = /\b(dumpling|dumplings|siomay|dim sum|wonton|chicken|beef|pork|fish|meat)\b/i.test(hay);

    if (isCoconutWater) {
      nutrients.carbohydrates = Math.round(consumedWeight * 0.04 * 10) / 10;
      nutrients.sugar = Math.round(consumedWeight * 0.03 * 10) / 10;
      nutrients.addedSugar = 0;
      nutrients.protein = Math.round(consumedWeight * 0.007 * 10) / 10;
      nutrients.totalFat = Math.round(consumedWeight * 0.002 * 10) / 10;
      nutrients.saturatedFat = 0;
      nutrients.potassium = Math.round(consumedWeight * 2.5);
      nutrients.sodium = Math.round(consumedWeight * 0.25);
    } else if (isDrink) {
      nutrients.carbohydrates = Math.round(consumedWeight * 0.11 * 10) / 10;
      nutrients.sugar = Math.round(consumedWeight * 0.10 * 10) / 10;
      nutrients.protein = 0;
      nutrients.totalFat = 0;
      nutrients.saturatedFat = 0;
      nutrients.sodium = Math.round(consumedWeight * 0.05);
      nutrients.calories = computeCaloriesFromMacros(nutrients.protein, nutrients.carbohydrates, nutrients.totalFat);
    } else if (isNoodleRice) {
      nutrients.carbohydrates = Math.round(consumedWeight * 0.30 * 10) / 10;
      nutrients.protein = Math.round(consumedWeight * 0.06 * 10) / 10;
      nutrients.totalFat = Math.round(consumedWeight * 0.04 * 10) / 10;
      nutrients.saturatedFat = Math.round(consumedWeight * 0.01 * 10) / 10;
      nutrients.sodium = Math.round(consumedWeight * 2.5);
      nutrients.calories = computeCaloriesFromMacros(nutrients.protein, nutrients.carbohydrates, nutrients.totalFat);
    } else if (isMeatDumpling) {
      nutrients.protein = Math.round(consumedWeight * 0.12 * 10) / 10;
      nutrients.totalFat = Math.round(consumedWeight * 0.08 * 10) / 10;
      nutrients.saturatedFat = Math.round(consumedWeight * 0.02 * 10) / 10;
      nutrients.carbohydrates = Math.round(consumedWeight * 0.15 * 10) / 10;
      nutrients.sodium = Math.round(consumedWeight * 3.5);
      nutrients.calories = computeCaloriesFromMacros(nutrients.protein, nutrients.carbohydrates, nutrients.totalFat);
    } else {
      nutrients.carbohydrates = Math.round(consumedWeight * 0.20 * 10) / 10;
      nutrients.protein = Math.round(consumedWeight * 0.08 * 10) / 10;
      nutrients.totalFat = Math.round(consumedWeight * 0.05 * 10) / 10;
      nutrients.saturatedFat = Math.round(consumedWeight * 0.01 * 10) / 10;
      nutrients.sodium = Math.round(consumedWeight * 2.0);
      nutrients.calories = computeCaloriesFromMacros(nutrients.protein, nutrients.carbohydrates, nutrients.totalFat);
    }
  }

  // 4. Bottom-Up Calorie Derivation & Atwater Consistency
  if (dbSource === 'estimated' && !lockedNutrientKeys.includes('protein')) {
    const decomp = decomposeSaucedEntree(originalName, consumedWeight, nutrients.protein);
    if (decomp.boundedProtein !== null) {
      nutrients.protein = decomp.boundedProtein;
    }
  }

  const p = nutrients.protein ?? 0;
  const f = nutrients.totalFat ?? 0;
  let atwaterFlag: { deviationPct: number; flagged: boolean } | null = null;

  if (!lockedNutrientKeys.includes('calories')) {
    // Bottom-Up standard: compute calories directly from macros
    if (nutrients.carbohydrates == null) {
      nutrients.carbohydrates = deriveCarbohydratesFromEnergy(nutrients.calories, p, f);
    }
    const c = nutrients.carbohydrates ?? 0;
    nutrients.calories = computeCaloriesFromMacros(p, c, f);
  } else {
    // Calories locked by OCR or Brand Menu
    const cal = nutrients.calories ?? 0;
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
      // Derive carbohydrates from energy when missing on label
      nutrients.carbohydrates = deriveCarbohydratesFromEnergy(cal, p, f);
      atwaterFlag = null;
    }
  }

  // 5. Derive Unsaturated Fat and Salt
  nutrients.unsaturatedFat = computeUnsaturatedFat(nutrients.totalFat, nutrients.saturatedFat, nutrients.transFat);
  nutrients.salt = computeSaltFromSodium(nutrients.sodium);

  // 6. Complete Micronutrient Backfill for Sparse Composite Estimates
  backfillSparseMicronutrients(originalName, consumedWeight, nutrients, dbSource, originalName);

  // 7. Structure Composite Components with Scaled Weights and Nutrients
  const rawComps = Array.isArray(item.componentsDetailList) && item.componentsDetailList.length > 0
    ? item.componentsDetailList
    : (Array.isArray(item.components) && item.components.length > 0 ? item.components : (Array.isArray(item.compositeSiblings) ? item.compositeSiblings : []));

  let componentsDetailList: any[] | undefined = undefined;
  if (rawComps.length > 0) {
    const origWeight = Math.max(1, Number(item.estimatedWeightGrams || nutrientBasisWeight || consumedWeight));
    const scale = consumedWeight / origWeight;
    componentsDetailList = rawComps.map((c: any) => {
      const cName = String(c.name || c.searchQuery || c.keyword || 'Ingredient').trim();
      const origCW = Number(c.weightGrams ?? c.estimatedWeightGrams ?? (c.volumePercentage ? Math.round(origWeight * (c.volumePercentage / 100)) : 0));
      const cWeight = Math.max(1, Math.round(origCW * scale));
      const cBasisWeight = Math.max(1, Number(c.nutrientBasisWeight ?? c.estimatedWeightGrams ?? origCW));
      const cR = cWeight / cBasisWeight;

      const cNuts = c.nutrients || {};
      const cProtRaw = Number(c.protein ?? cNuts.protein ?? 0);
      const cFatRaw = Number(c.totalFat ?? c.fat ?? cNuts.totalFat ?? cNuts.fat ?? cNuts.saturatedFat ?? 0);
      const cSatRaw = Number(c.saturatedFat ?? cNuts.saturatedFat ?? 0);
      const cCarbsRaw = Number(c.carbohydrates ?? c.carbs ?? cNuts.carbohydrates ?? 0);
      const cNaRaw = Number(c.sodium ?? cNuts.sodium ?? 0);
      const cCalsRaw = Number(c.calories ?? cNuts.calories ?? Math.round(4 * cProtRaw + 4 * cCarbsRaw + 9 * cFatRaw));

      let cProt = Math.round(cProtRaw * cR * 10) / 10;
      let cFat = Math.round(cFatRaw * cR * 10) / 10;
      let cSat = Math.round(cSatRaw * cR * 10) / 10;
      let cCarbs = Math.round(cCarbsRaw * cR * 10) / 10;
      let cNa = Math.round(cNaRaw * cR);
      let cCals = Math.round(cCalsRaw * cR);
      let childDbSource = c.dbSource || 'estimated';

      const childRawLabel = c.rawNutritionLabel;
      const childHasOcr = childRawLabel && typeof childRawLabel === 'object' && (childRawLabel.calories != null || childRawLabel.energy != null || childRawLabel.kcal != null);
      if (childHasOcr) {
        const { ocrNutrients } = parseOcrLabel(childRawLabel, cWeight, cR);
        if (ocrNutrients.calories != null) cCals = ocrNutrients.calories;
        if (ocrNutrients.protein != null) cProt = ocrNutrients.protein;
        if (ocrNutrients.totalFat != null) cFat = ocrNutrients.totalFat;
        if (ocrNutrients.saturatedFat != null) cSat = ocrNutrients.saturatedFat;
        if (ocrNutrients.carbohydrates != null) cCarbs = ocrNutrients.carbohydrates;
        if (ocrNutrients.sodium != null) cNa = ocrNutrients.sodium;
        childDbSource = 'label';
        Object.assign(cNuts, ocrNutrients);
      }

      const base100g = cBasisWeight > 0 ? {
        calories: Math.round((cCalsRaw / cBasisWeight) * 100),
        protein: Math.round((cProtRaw / cBasisWeight) * 100 * 10) / 10,
        totalFat: Math.round((cFatRaw / cBasisWeight) * 100 * 10) / 10,
        saturatedFat: Math.round((cSatRaw / cBasisWeight) * 100 * 10) / 10,
        carbohydrates: Math.round((cCarbsRaw / cBasisWeight) * 100 * 10) / 10,
        sodium: Math.round((cNaRaw / cBasisWeight) * 100),
      } : null;

      return {
        ...c,
        name: cName,
        searchQuery: c.searchQuery || cName,
        weightGrams: cWeight,
        estimatedWeightGrams: cWeight,
        nutrientBasisWeight: cWeight, // lock to new weight
        calories: cCals,
        protein: cProt,
        totalFat: cFat,
        fat: cFat,
        saturatedFat: cSat,
        carbohydrates: cCarbs,
        carbs: cCarbs,
        sodium: cNa,
        nutrients: {
          ...cNuts,
          calories: cCals,
          protein: cProt,
          totalFat: cFat,
          saturatedFat: cSat,
          carbohydrates: cCarbs,
          sodium: cNa
        },
        dbSource: childDbSource,
        dbId: c.dbId || null,
        baseNutrients100g: c.baseNutrients100g || base100g,
      };
    });

    // Subcomponent truth takes precedence. We must physically sum the children
    // to derive the precise parent macros, rather than relying on top-level AI estimates.
    if (componentsDetailList && componentsDetailList.length > 0 && dbSource !== 'label') {
      let sumCal = 0;
      let sumProt = 0;
      let sumFat = 0;
      let sumSat = 0;
      let sumCarbs = 0;
      let sumNa = 0;
      for (const c of componentsDetailList) {
        sumCal += (c.calories || 0);
        sumProt += (c.protein || 0);
        sumFat += (c.totalFat || 0);
        sumSat += (c.saturatedFat || 0);
        sumCarbs += (c.carbohydrates || 0);
        sumNa += (c.sodium || 0);
      }
      nutrients.calories = Math.round(sumCal);
      nutrients.protein = Math.round(sumProt * 10) / 10;
      nutrients.totalFat = Math.round(sumFat * 10) / 10;
      nutrients.saturatedFat = Math.round(sumSat * 10) / 10;
      nutrients.carbohydrates = Math.round(sumCarbs * 10) / 10;
      nutrients.sodium = Math.round(sumNa);
      
      // Update missing locks
      ['calories', 'protein', 'totalFat', 'saturatedFat', 'carbohydrates', 'sodium'].forEach(k => {
        if (!lockedNutrientKeys.includes(k)) lockedNutrientKeys.push(k);
      });
    }
  }

  // 8. Sugar and Added Sugar Breakdown
  if (!lockedNutrientKeys.includes('addedSugar')) {
    const candidateAdded = nutrients.addedSugar != null && !isNaN(Number(nutrients.addedSugar)) && Number(nutrients.addedSugar) > 0 ? Number(nutrients.addedSugar) : null;
    let rawSugar = Number(nutrients.sugar ?? nutrients.totalSugar ?? 0);
    if (candidateAdded != null && candidateAdded > rawSugar) {
      rawSugar = candidateAdded;
    }
    const componentNames = [
      ingredients.join(', '),
      ...(Array.isArray(item.components) ? item.components.map((c: any) => (typeof c === 'string' ? c : c.searchQuery || c.name || '')) : []),
      ...(Array.isArray(componentsDetailList) ? componentsDetailList.map((c: any) => c.name || c.searchQuery || '') : []),
    ].filter(Boolean).join(', ');
    const sugarResult = deduceSugarBreakdown({
      totalSugar: rawSugar,
      addedSugarPrinted: candidateAdded,
      carbohydrates: nutrients.carbohydrates,
      totalFibre: nutrients.totalFibre,
      ingredientsList: componentNames || item.ingredientsList,
      foodName: originalName || keyword,
    });
    nutrients.sugar = sugarResult.sugar;
    nutrients.addedSugar = sugarResult.addedSugar;
  }

  const finalIngredientsList = ingredients.length > 0 ? ingredients.join(', ') : (item.ingredientsList || (componentsDetailList ? componentsDetailList.map((c: any) => c.name).join(', ') : null));

  return {
    scoutIndex,
    originalName,
    keyword,
    chainName,
    weightGrams: consumedWeight,
    nutrientBasisWeight,
    ingredients: ingredients.length > 0 ? ingredients : (componentsDetailList ? componentsDetailList.map((c: any) => c.name) : []),
    visualIngredients: visualIngredients.length > 0 ? visualIngredients : (componentsDetailList ? componentsDetailList.map((c: any) => c.name) : []),
    nutrients,
    lockedNutrientKeys,
    brandLock,
    dishClass,
    dbSource,
    dbId,
    bindStatus,
    atwaterFlag,
    usdaQueries,
    components: componentsDetailList || item.components || undefined,
    componentsDetailList: componentsDetailList || undefined,
    compositeSiblings: componentsDetailList || undefined,
    hasComponents: Boolean(componentsDetailList && componentsDetailList.length > 1),
    ingredientsList: finalIngredientsList,
  };
}
