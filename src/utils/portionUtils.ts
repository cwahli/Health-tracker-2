/**
 * portionUtils.ts - Pure functions for whole-meal and per-dish portion scaling.
 */

export interface FoodLogLike {
  weightGrams?: number;
  calories?: number;
  saturatedFat?: number;
  sodium?: number;
  nutrients?: Record<string, number>;
  itemsBreakdown?: any[];
  portionRatio?: number;
  portionAccepted?: boolean;
  portionDescription?: string;
  receiptTable?: string;
  message?: string;
  description?: string;
  healthImpact?: string;
  [key: string]: any;
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

  const safeAdj = `(?:(?!\\b(?:and|with|plus|or|including|protein|fat|calories|sugar|sodium|carbs|carbohydrates|carbohydrate|fiber|fibre)\\b)[a-zA-Z-]+\\s+){0,2}`;

  // 1. Calories
  const calRe = new RegExp(`\\b([\\d,]+(?:\\.\\d+)?)\\s*(${safeAdj}(?:calories|kcal))\\b`, 'gi');
  updated = updated.replace(calRe, (_match, _num, rest) => `${calVal} ${rest}`);

  // 2. Sodium
  const naRe = new RegExp(`\\b([\\d,]+(?:\\.\\d+)?)\\s*(mg\\s*(?:of\\s+)?${safeAdj}sodium)\\b`, 'gi');
  updated = updated.replace(naRe, (_match, _num, rest) => `${naFormatted}${rest}`);
  updated = updated.replace(/(sodium\s*\([^)]*)([\d,]+(?:\.\d+)?)(\s*mg[^)]*\))/gi, (_match, p1, _num, p3) => `${p1}${naFormatted}${p3}`);
  updated = updated.replace(/(sodium\s*(?:to\s+|is\s+|at\s+|:\s*))([\d,]+(?:\.\d+)?)(\s*mg)/gi, (_match, p1, _num, p3) => `${p1}${naFormatted}${p3}`);

  // 3. Saturated Fat
  const satFatRe = new RegExp(`\\b([\\d,]+(?:\\.\\d+)?)\\s*(g\\s*(?:of\\s+)?${safeAdj}saturated\\s*fat)\\b`, 'gi');
  updated = updated.replace(satFatRe, (_match, _num, rest) => `${satFatVal}${rest}`);
  updated = updated.replace(/(saturated\s*fat\s*\([^)]*)([\d,]+(?:\.\d+)?)(\s*g[^)]*\))/gi, (_match, p1, _num, p3) => `${p1}${satFatVal}${p3}`);
  updated = updated.replace(/(saturated\s*fat\s*:\s*)([\d,]+(?:\.\d+)?)(\s*g)/gi, (_match, p1, _num, p3) => `${p1}${satFatVal}${p3}`);

  // 4. Total Fat
  const fatRe = new RegExp(`\\b([\\d,]+(?:\\.\\d+)?)\\s*(g\\s*(?:of\\s+)?${safeAdj}total\\s*fat)\\b`, 'gi');
  updated = updated.replace(fatRe, (_match, _num, rest) => `${fatVal}${rest}`);

  // 5. Protein
  const pRe = new RegExp(`\\b([\\d,]+(?:\\.\\d+)?)\\s*(g\\s*(?:of\\s+)?${safeAdj}protein)\\b`, 'gi');
  updated = updated.replace(pRe, (_match, _num, rest) => `${pVal}${rest}`);
  updated = updated.replace(/(protein\s*\([^)]*)([\d,]+(?:\.\d+)?)(\s*g[^)]*\))/gi, (_match, p1, _num, p3) => `${p1}${pVal}${p3}`);
  updated = updated.replace(/(protein\s*:\s*)([\d,]+(?:\.\d+)?)(\s*g)/gi, (_match, p1, _num, p3) => `${p1}${pVal}${p3}`);

  // 6. Carbohydrates
  if (grandCarbs !== undefined && grandCarbs > 0) {
    const carbVal = Math.round(grandCarbs * 10) / 10;
    const carbRe = new RegExp(`\\b([\\d,]+(?:\\.\\d+)?)\\s*(g\\s*(?:of\\s+)?${safeAdj}(?:carbohydrates|carbs))\\b`, 'gi');
    updated = updated.replace(carbRe, (_match, _num, rest) => `${carbVal}${rest}`);
  }

  return updated;
}

export function buildReceiptTableFromLog(log: FoodLogLike): string {
  const items = log.itemsBreakdown || [];
  if (!items || items.length === 0) return log.receiptTable || "";

  let md = "### 🧾 Nutrition calculation\n\n";
  md += "| ITEM / INGREDIENT | KCAL | PROTEIN | SAT FAT | SODIUM |\n";
  md += "|:---|:---|:---|:---|:---|\n";

  let grandCal = 0;
  let grandP = 0;
  let grandSatFat = 0;
  let grandNa = 0;
  let grandWeight = 0;

  const fVal = (val: any, unit: string = '', isPlus: boolean = false) => {
    if (val === null || val === undefined) return `0${unit}`;
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (isNaN(num) || Math.abs(num) < 0.05) return `0${unit}`;
    const rounded = Math.round(num * 10) / 10;
    if (rounded === 0) return `0${unit}`;
    const prefix = (isPlus && rounded > 0) ? '+' : '';
    return `${prefix}${rounded}${unit}`;
  };

  items.forEach((it: any, idx: number) => {
    if (!it || typeof it !== 'object') return;
    const itemWeightG = Number(it.weightGrams || it.estimatedWeightGrams || 0);
    const itemCal = Number(it.calories ?? it.nutrients?.calories ?? 0);
    const itemP = Number(it.proteinGrams ?? it.nutrients?.proteinGrams ?? it.nutrients?.protein ?? 0);
    const itemSatFat = Number(it.saturatedFat ?? it.nutrients?.saturatedFat ?? 0);
    const itemNa = Number(it.sodium ?? it.nutrients?.sodium ?? 0);

    grandWeight += itemWeightG;
    grandCal += itemCal;
    grandP += itemP;
    grandSatFat += itemSatFat;
    grandNa += itemNa;

    const dishTitle = (
      it.originalName ||
      it.originalLocalName ||
      it.keyword ||
      it.name ||
      it.canonicalDbName ||
      `Item ${idx + 1}`
    );

    const badge = it.dbSource === 'estimated_override'
      ? ` ⚠️ [SANITY CHECK OVERRIDE: ${it.overrideReason || 'Adjusted Value'}]`
      : (it.isUnverified ? " ⚠️ (Est)" : "");

    let visualBreakdownStr = "";
    if (it.visualIngredients && Array.isArray(it.visualIngredients) && it.visualIngredients.length > 0) {
      visualBreakdownStr = ` (${it.visualIngredients.join(', ')})`;
    } else if (it.components && Array.isArray(it.components) && it.components.length > 0) {
      visualBreakdownStr = ` (${it.components.map((c: any) => typeof c === 'string' ? c : c.searchQuery || c.name || c.keyword).join(', ')})`;
    }

    md += `| **${idx + 1}. ${dishTitle}**${badge} - ${itemWeightG}g${visualBreakdownStr} | - | - | - | - |\n`;
    md += `| Estimated ${dishTitle} - ${itemWeightG}g | ${fVal(itemCal)} | ${fVal(itemP, "g")} | ${fVal(itemSatFat, "g")} | ${fVal(itemNa, "mg")} |\n`;
    md += `| **Item Sub-Total - ${itemWeightG}g** | **${fVal(itemCal)}** | **${fVal(itemP, "g")}** | **${fVal(itemSatFat, "g")}** | **${fVal(itemNa, "mg")}** |\n`;
  });

  if (items.length > 1 || log.receiptTable?.includes('GRAND MEAL TOTAL')) {
    const finalW = log.weightGrams ?? grandWeight;
    const finalCal = log.calories ?? grandCal;
    const finalP = log.nutrients?.proteinGrams ?? log.nutrients?.protein ?? grandP;
    const finalSatFat = log.nutrients?.saturatedFat ?? grandSatFat;
    const finalNa = log.nutrients?.sodium ?? grandNa;

    md += `| **🏆 GRAND MEAL TOTAL - ${finalW}g** | **${fVal(finalCal)}** | **${fVal(finalP, "g")}** | **${fVal(finalSatFat, "g")}** | **${fVal(finalNa, "mg")}** |\n`;
  }

  return md;
}

function scaleNutrientObj(obj?: Record<string, any>, factor: number = 1.0): Record<string, any> | undefined {
  if (!obj || typeof obj !== 'object') return obj;
  const res: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' && !isNaN(v)) {
      res[k] = Math.round(v * factor * 10) / 10;
    } else {
      res[k] = v;
    }
  }
  return res;
}

export function scaleMealPortion<T extends FoodLogLike>(currentLog: T, ratio: number): T {
  const baseScale = currentLog.portionRatio || 1.0;
  const factor = ratio / baseScale;

  const updatedNutrients = scaleNutrientObj(currentLog.nutrients, factor) || {};

  const updatedItems = (currentLog.itemsBreakdown || []).map((it: any) => {
    const itemWeight = it.weightGrams || it.estimatedWeightGrams;
    const itemEstWeight = it.estimatedWeightGrams || it.weightGrams;
    const newWeight = itemWeight ? Math.round(itemWeight * factor) : itemWeight;
    const newEstWeight = itemEstWeight ? Math.round(itemEstWeight * factor) : itemEstWeight;

    const scaledItemNutrients = scaleNutrientObj(it.nutrients || it.nutritionFacts, factor);
    const scaledTruthNutrients = scaleNutrientObj(it.truthNutrients, factor);

    return {
      ...it,
      weightGrams: newWeight,
      estimatedWeightGrams: newEstWeight,
      calories: it.calories ? Math.round(it.calories * factor) : (scaledItemNutrients?.calories || it.calories),
      saturatedFat: it.saturatedFat ? Math.round(it.saturatedFat * factor * 10) / 10 : (scaledItemNutrients?.saturatedFat || it.saturatedFat),
      sodium: it.sodium ? Math.round(it.sodium * factor) : (scaledItemNutrients?.sodium || it.sodium),
      proteinGrams: it.proteinGrams ? Math.round(it.proteinGrams * factor * 10) / 10 : (scaledItemNutrients?.proteinGrams || it.proteinGrams),
      carbsGrams: it.carbsGrams ? Math.round(it.carbsGrams * factor * 10) / 10 : (scaledItemNutrients?.carbsGrams || it.carbsGrams),
      fatGrams: it.fatGrams ? Math.round(it.fatGrams * factor * 10) / 10 : (scaledItemNutrients?.fatGrams || it.fatGrams),
      nutrients: scaledItemNutrients || it.nutrients,
      truthNutrients: scaledTruthNutrients || it.truthNutrients,
      portionRatio: ratio,
      portionDescription: newWeight ? `${newWeight}g` : `${ratio}x`
    };
  });

  const updatedWeight = currentLog.weightGrams ? Math.round(currentLog.weightGrams * factor) : currentLog.weightGrams;
  const updatedCalories = currentLog.calories ? Math.round(currentLog.calories * factor) : (updatedNutrients.calories || 0);

  const rawScout = (currentLog as any).scoutItems || (currentLog as any).scoutSnapshot || [];
  const updatedScoutItems = Array.isArray(rawScout) && rawScout.length > 0
    ? rawScout.map((sItem: any, idx: number) => {
        const matchingBreakdown = updatedItems[idx] || updatedItems.find((it: any) => it.scoutIndex === sItem.scoutIndex) || sItem;
        return {
          ...sItem,
          weightGrams: matchingBreakdown.weightGrams,
          estimatedWeightGrams: matchingBreakdown.estimatedWeightGrams,
          portionRatio: matchingBreakdown.portionRatio,
          portionDescription: matchingBreakdown.portionDescription,
          calories: matchingBreakdown.calories,
          saturatedFat: matchingBreakdown.saturatedFat,
          sodium: matchingBreakdown.sodium,
          proteinGrams: matchingBreakdown.proteinGrams,
          carbsGrams: matchingBreakdown.carbsGrams,
          fatGrams: matchingBreakdown.fatGrams,
          nutrients: matchingBreakdown.nutrients || sItem.nutrients,
          nutritionFacts: matchingBreakdown.nutrients || sItem.nutritionFacts,
        };
      })
    : updatedItems;

  const resLog: T = {
    ...currentLog,
    weightGrams: updatedWeight,
    calories: updatedCalories,
    nutrients: updatedNutrients,
    itemsBreakdown: updatedItems,
    scoutItems: updatedScoutItems,
    portionRatio: ratio,
    portionAccepted: true,
    portionDescription: updatedWeight ? `${updatedWeight}g` : `${ratio}x`
  };

  if (currentLog.receiptTable || updatedItems.length > 0) {
    resLog.receiptTable = buildReceiptTableFromLog(resLog);
  }

  const grandCal = updatedCalories;
  const grandP = updatedNutrients.proteinGrams ?? updatedNutrients.protein ?? 0;
  const grandFat = updatedNutrients.fatGrams ?? updatedNutrients.totalFat ?? 0;
  const grandSatFat = updatedNutrients.saturatedFat ?? 0;
  const grandNa = updatedNutrients.sodium ?? 0;
  const grandCarbs = updatedNutrients.carbsGrams ?? updatedNutrients.carbohydrates ?? 0;

  if (resLog.message) {
    resLog.message = synchronizeNarrativeText(resLog.message, grandCal, grandP, grandFat, grandSatFat, grandNa, grandCarbs);
  }
  if (resLog.description) {
    resLog.description = synchronizeNarrativeText(resLog.description, grandCal, grandP, grandFat, grandSatFat, grandNa, grandCarbs);
  }

  return resLog;
}

export function scaleSingleDishPortion<T extends FoodLogLike>(currentLog: T, dishIdx: number, ratio: number): T {
  const items = [...(currentLog.itemsBreakdown || [])];
  if (!items[dishIdx]) return currentLog;

  const targetItem = items[dishIdx];
  const prevRatio = targetItem.portionRatio || 1.0;
  const factor = ratio / prevRatio;

  const itemWeight = targetItem.weightGrams || targetItem.estimatedWeightGrams;
  const itemEstWeight = targetItem.estimatedWeightGrams || targetItem.weightGrams;
  const newWeight = itemWeight ? Math.round(itemWeight * factor) : itemWeight;
  const newEstWeight = itemEstWeight ? Math.round(itemEstWeight * factor) : itemEstWeight;

  const scaledItemNutrients = scaleNutrientObj(targetItem.nutrients || targetItem.nutritionFacts, factor);
  const scaledTruthNutrients = scaleNutrientObj(targetItem.truthNutrients, factor);

  const updatedDish = {
    ...targetItem,
    weightGrams: newWeight,
    estimatedWeightGrams: newEstWeight,
    calories: targetItem.calories ? Math.round(targetItem.calories * factor) : (scaledItemNutrients?.calories || targetItem.calories),
    saturatedFat: targetItem.saturatedFat ? Math.round(targetItem.saturatedFat * factor * 10) / 10 : (scaledItemNutrients?.saturatedFat || targetItem.saturatedFat),
    sodium: targetItem.sodium ? Math.round(targetItem.sodium * factor) : (scaledItemNutrients?.sodium || targetItem.sodium),
    proteinGrams: targetItem.proteinGrams ? Math.round(targetItem.proteinGrams * factor * 10) / 10 : (scaledItemNutrients?.proteinGrams || targetItem.proteinGrams),
    carbsGrams: targetItem.carbsGrams ? Math.round(targetItem.carbsGrams * factor * 10) / 10 : (scaledItemNutrients?.carbsGrams || targetItem.carbsGrams),
    fatGrams: targetItem.fatGrams ? Math.round(targetItem.fatGrams * factor * 10) / 10 : (scaledItemNutrients?.fatGrams || targetItem.fatGrams),
    nutrients: scaledItemNutrients || targetItem.nutrients,
    truthNutrients: scaledTruthNutrients || targetItem.truthNutrients,
    portionRatio: ratio,
    portionDescription: newWeight ? `${newWeight}g` : `${ratio}x`
  };
  items[dishIdx] = updatedDish;

  const newTotalWeight = items.reduce((acc, it) => acc + (Number(it.weightGrams || it.estimatedWeightGrams) || 0), 0);
  const newTotalCalories = items.reduce((acc, it) => acc + (Number(it.calories) || 0), 0);
  const newTotalSatFat = Math.round(items.reduce((acc, it) => acc + (Number(it.saturatedFat) || 0), 0) * 10) / 10;
  const newTotalSodium = items.reduce((acc, it) => acc + (Number(it.sodium) || 0), 0);

  const aggregateNutrients: Record<string, number> = { ...(currentLog.nutrients || {}) };
  aggregateNutrients.calories = newTotalCalories;
  aggregateNutrients.saturatedFat = newTotalSatFat;
  aggregateNutrients.sodium = newTotalSodium;

  const allNutrientKeys = new Set<string>();
  items.forEach(it => {
    if (it.nutrients && typeof it.nutrients === 'object') {
      Object.keys(it.nutrients).forEach(k => allNutrientKeys.add(k));
    }
  });

  allNutrientKeys.forEach(k => {
    const keySum = items.reduce((acc, it) => {
      const val = it.nutrients?.[k];
      return acc + (typeof val === 'number' ? val : 0);
    }, 0);
    aggregateNutrients[k] = Math.round(keySum * 10) / 10;
  });

  const rawScout = (currentLog as any).scoutItems || (currentLog as any).scoutSnapshot || [];
  const updatedScoutItems = Array.isArray(rawScout) && rawScout.length > 0
    ? rawScout.map((sItem: any, idx: number) => {
        const matchingBreakdown = items[idx] || items.find((it: any) => it.scoutIndex === sItem.scoutIndex) || sItem;
        return {
          ...sItem,
          weightGrams: matchingBreakdown.weightGrams,
          estimatedWeightGrams: matchingBreakdown.estimatedWeightGrams,
          portionRatio: matchingBreakdown.portionRatio,
          portionDescription: matchingBreakdown.portionDescription,
          calories: matchingBreakdown.calories,
          saturatedFat: matchingBreakdown.saturatedFat,
          sodium: matchingBreakdown.sodium,
          proteinGrams: matchingBreakdown.proteinGrams,
          carbsGrams: matchingBreakdown.carbsGrams,
          fatGrams: matchingBreakdown.fatGrams,
          nutrients: matchingBreakdown.nutrients || sItem.nutrients,
          nutritionFacts: matchingBreakdown.nutrients || sItem.nutritionFacts,
        };
      })
    : items;

  const oldTotalWeight = (currentLog.itemsBreakdown || []).reduce((acc, it) => {
    const w = it.weightGrams || it.estimatedWeightGrams;
    return acc + (Number(w) || 0);
  }, 0);
  const overallRatio = oldTotalWeight > 0 && newTotalWeight > 0 ? Math.round((newTotalWeight / oldTotalWeight) * 100) / 100 : (currentLog.portionRatio || 1.0);

  const resLog: T = {
    ...currentLog,
    weightGrams: newTotalWeight,
    calories: newTotalCalories,
    nutrients: aggregateNutrients,
    itemsBreakdown: items,
    scoutItems: updatedScoutItems,
    portionRatio: overallRatio,
    portionAccepted: true,
  };

  if (currentLog.receiptTable || items.length > 0) {
    resLog.receiptTable = buildReceiptTableFromLog(resLog);
  }

  const grandCal = newTotalCalories;
  const grandP = aggregateNutrients.proteinGrams ?? aggregateNutrients.protein ?? 0;
  const grandFat = aggregateNutrients.fatGrams ?? aggregateNutrients.totalFat ?? 0;
  const grandSatFat = newTotalSatFat;
  const grandNa = newTotalSodium;
  const grandCarbs = aggregateNutrients.carbsGrams ?? aggregateNutrients.carbohydrates ?? 0;

  if (resLog.message) {
    resLog.message = synchronizeNarrativeText(resLog.message, grandCal, grandP, grandFat, grandSatFat, grandNa, grandCarbs);
  }
  if (resLog.description) {
    resLog.description = synchronizeNarrativeText(resLog.description, grandCal, grandP, grandFat, grandSatFat, grandNa, grandCarbs);
  }

  return resLog;
}

