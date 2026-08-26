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
  [key: string]: any;
}

export function scaleMealPortion<T extends FoodLogLike>(currentLog: T, ratio: number): T {
  const baseScale = currentLog.portionRatio || 1.0;
  const factor = ratio / baseScale;

  const updatedNutrients: Record<string, number> = {};
  if (currentLog.nutrients) {
    Object.entries(currentLog.nutrients).forEach(([k, v]) => {
      if (typeof v === 'number') {
        updatedNutrients[k] = Math.round(v * factor * 10) / 10;
      }
    });
  }

  const updatedItems = (currentLog.itemsBreakdown || []).map((it: any) => ({
    ...it,
    weightGrams: it.weightGrams ? Math.round(it.weightGrams * factor) : it.weightGrams,
    calories: it.calories ? Math.round(it.calories * factor) : it.calories,
    saturatedFat: it.saturatedFat ? Math.round(it.saturatedFat * factor * 10) / 10 : it.saturatedFat,
    sodium: it.sodium ? Math.round(it.sodium * factor) : it.sodium,
    portionRatio: ratio,
    portionDescription: `${ratio}x portion`
  }));

  const updatedWeight = currentLog.weightGrams ? Math.round(currentLog.weightGrams * factor) : currentLog.weightGrams;
  const updatedCalories = currentLog.calories ? Math.round(currentLog.calories * factor) : (updatedNutrients.calories || 0);

  return {
    ...currentLog,
    weightGrams: updatedWeight,
    calories: updatedCalories,
    nutrients: updatedNutrients,
    itemsBreakdown: updatedItems,
    portionRatio: ratio,
    portionAccepted: true,
    portionDescription: `${ratio}x portion`
  };
}

export function scaleSingleDishPortion<T extends FoodLogLike>(currentLog: T, dishIdx: number, ratio: number): T {
  const items = [...(currentLog.itemsBreakdown || [])];
  if (!items[dishIdx]) return currentLog;

  const targetItem = items[dishIdx];
  const prevRatio = targetItem.portionRatio || 1.0;
  const factor = ratio / prevRatio;

  const updatedDish = {
    ...targetItem,
    weightGrams: targetItem.weightGrams ? Math.round(targetItem.weightGrams * factor) : targetItem.weightGrams,
    calories: targetItem.calories ? Math.round(targetItem.calories * factor) : targetItem.calories,
    saturatedFat: targetItem.saturatedFat ? Math.round(targetItem.saturatedFat * factor * 10) / 10 : targetItem.saturatedFat,
    sodium: targetItem.sodium ? Math.round(targetItem.sodium * factor) : targetItem.sodium,
    portionRatio: ratio,
    portionDescription: `${ratio}x portion`
  };
  items[dishIdx] = updatedDish;

  const newTotalWeight = items.reduce((acc, it) => acc + (Number(it.weightGrams) || 0), 0);
  const newTotalCalories = items.reduce((acc, it) => acc + (Number(it.calories) || 0), 0);
  const newTotalSatFat = Math.round(items.reduce((acc, it) => acc + (Number(it.saturatedFat) || 0), 0) * 10) / 10;
  const newTotalSodium = items.reduce((acc, it) => acc + (Number(it.sodium) || 0), 0);

  const updatedNutrients = {
    ...(currentLog.nutrients || {}),
    calories: newTotalCalories,
    saturatedFat: newTotalSatFat,
    sodium: newTotalSodium,
  };

  return {
    ...currentLog,
    weightGrams: newTotalWeight,
    calories: newTotalCalories,
    nutrients: updatedNutrients,
    itemsBreakdown: items,
    portionAccepted: true,
  };
}
