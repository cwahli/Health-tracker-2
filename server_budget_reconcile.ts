/**
 * Pure budget + reconcile helpers for hybrid calorie pipeline.
 * No I/O. Used by Mode A, Edit, and Mode D finalize paths.
 */

export type BudgetSource = 'label' | 'dish_cache' | 'brand' | 'scout' | 'category' | 'none';

export type BudgetResult = {
  budgetKcal: number | null;
  source: BudgetSource;
  hardLock: boolean;
  bandLow: number | null;
  bandHigh: number | null;
};

export type ReconcileAction = 'keep' | 'scale' | 'hard_lock' | 'reject_scale' | 'no_budget';

export type ReconcileResult = {
  action: ReconcileAction;
  finalKcal: number;
  scaleFactor: number;
  foundationKcal: number;
  budgetKcal: number | null;
  nutrients: Record<string, number>;
};

/** Soft category density kcal per 100g for fallback budgets */
export const CATEGORY_KCAL_PER_100G: Record<string, number> = {
  cheese_pasta_dish: 170,
  composed_salad: 130,
  yogurt_cereal_cup: 150,
  produce: 35,
  meat_or_fish: 180,
  starch: 130,
  dairy: 90,
  beverage: 20,
  general_dish: 150,
};

export function inferCategoryKey(name: string): string {
  const q = (name || '').toLowerCase();
  if (/\b(mac|macaroni|pasta|cheese\s*sauce|lasagna|carbonara)\b/.test(q)) return 'cheese_pasta_dish';
  if (/\b(salad|bowl|poke|bento|quinoa|hummus)\b/.test(q)) return 'composed_salad';
  if (/\b(granola|yogurt|yoghurt|parfait|fruit\s*cup|muesli)\b/.test(q)) return 'yogurt_cereal_cup';
  if (/\b(apple|banana|berry|lettuce|spinach|cucumber|tomato|vegetable|fruit)\b/.test(q)) return 'produce';
  if (/\b(chicken|beef|pork|fish|salmon|steak|meat|shrimp)\b/.test(q)) return 'meat_or_fish';
  if (/\b(rice|bread|potato|noodle|oat|cereal)\b/.test(q)) return 'starch';
  if (/\b(milk|cheese|cream|butter|dairy)\b/.test(q)) return 'dairy';
  if (/\b(water|tea|coffee|soda|juice|drink)\b/.test(q)) return 'beverage';
  return 'general_dish';
}

export function parseLabelCalories(raw: any): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'object') {
    const v = raw.calories ?? raw.energy ?? raw.kcal ?? raw['Energy (kcal)'];
    return parseLabelCalories(v);
  }
  const s = String(raw).replace(/,/g, '').trim();

  // 1. Explicit kcal match e.g. "187 kcal" or "187kcal" or "(187 kcal)" or "783 kJ / 187 kcal"
  const kcalMatch = s.match(/(-?\d+(?:\.\d+)?)\s*kcal/i);
  if (kcalMatch) {
    const n = parseFloat(kcalMatch[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }

  // 2. Explicit kJ match e.g. "783 kJ" or "783kJ" -> convert to kcal (1 kcal = 4.184 kJ)
  const kjMatch = s.match(/(-?\d+(?:\.\d+)?)\s*kj/i);
  if (kjMatch) {
    const kj = parseFloat(kjMatch[1]);
    if (Number.isFinite(kj) && kj > 0) {
      return Math.round((kj / 4.184) * 10) / 10;
    }
  }

  // 3. Fallback bare numeric match
  const m = s.match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Compute per-item budget.
 * hardLabelKcal: already scaled to consumed portion if possible.
 * scoutEstimatedCalories: soft item-level estimate from Vision Scout.
 */
export function computeItemBudget(input: {
  itemName: string;
  weightGrams: number;
  hardLabelKcal?: number | null;
  dishCacheKcal?: number | null;
  brandMenuKcal?: number | null;
  scoutEstimatedCalories?: number | null;
  bandPct?: number; // default 0.25 soft band around scout/category
}): BudgetResult {
  const w = Math.max(1, Number(input.weightGrams) || 100);
  const bandPct = input.bandPct ?? 0.25;

  const hard =
    (input.hardLabelKcal != null && input.hardLabelKcal > 0 && input.hardLabelKcal) ||
    (input.brandMenuKcal != null && input.brandMenuKcal > 0 && input.brandMenuKcal) ||
    null;

  if (hard) {
    return {
      budgetKcal: hard,
      source: input.hardLabelKcal ? 'label' : 'brand',
      hardLock: true,
      bandLow: hard,
      bandHigh: hard,
    };
  }

  if (input.dishCacheKcal != null && input.dishCacheKcal > 0) {
    const b = input.dishCacheKcal;
    return {
      budgetKcal: b,
      source: 'dish_cache',
      hardLock: false,
      bandLow: b * (1 - bandPct),
      bandHigh: b * (1 + bandPct),
    };
  }

  if (input.scoutEstimatedCalories != null && input.scoutEstimatedCalories > 0) {
    const b = input.scoutEstimatedCalories;
    return {
      budgetKcal: b,
      source: 'scout',
      hardLock: false,
      bandLow: b * (1 - bandPct),
      bandHigh: b * (1 + bandPct),
    };
  }

  const cat = inferCategoryKey(input.itemName);
  const per100 = CATEGORY_KCAL_PER_100G[cat] ?? CATEGORY_KCAL_PER_100G.general_dish;
  const b = Math.round(per100 * (w / 100));
  if (b > 0) {
    return {
      budgetKcal: b,
      source: 'category',
      hardLock: false,
      bandLow: b * (1 - bandPct),
      bandHigh: b * (1 + bandPct),
    };
  }

  return { budgetKcal: null, source: 'none', hardLock: false, bandLow: null, bandHigh: null };
}

/**
 * Reconcile foundation nutrient map to budget.
 * nutrients should be absolute portion totals (not per-100g).
 */
export function reconcileNutrients(input: {
  nutrients: Record<string, number>;
  budget: BudgetResult;
  formOk?: boolean;
  incompleteAssembly?: boolean;
  weightGrams?: number;
}): ReconcileResult {
  const nutrients = { ...input.nutrients };
  let foundationKcal = Math.max(0, Number(nutrients.calories) || 0);
  let budgetKcal = input.budget.budgetKcal;

  // Density Cap Guard: Cap meal calories at max 6.0 kcal/g (600 kcal per 100g)
  if (input.weightGrams && input.weightGrams > 0 && budgetKcal && budgetKcal > 0) {
    const maxAllowedKcal = Math.round(input.weightGrams * 6.0);
    if (budgetKcal > maxAllowedKcal) {
      budgetKcal = maxAllowedKcal;
    }
  }

  // Zero Macro Backfill: If calories > 0 but protein/fat/carbs are all 0, estimate macros using Atwater distribution (40% C, 30% P, 30% F)
  const p = Number(nutrients.protein) || 0;
  const f = Number(nutrients.totalFat) || 0;
  const c = Number(nutrients.carbohydrates) || 0;
  const targetKcal = budgetKcal || foundationKcal;

  if (targetKcal > 0 && p === 0 && f === 0 && c === 0) {
    nutrients.protein = Math.round((targetKcal * 0.30) / 4 * 10) / 10;
    nutrients.totalFat = Math.round((targetKcal * 0.30) / 9 * 10) / 10;
    nutrients.carbohydrates = Math.round((targetKcal * 0.40) / 4 * 10) / 10;
  }

  const formOk = input.formOk !== false;
  const incomplete = !!input.incompleteAssembly;

  if (input.budget.hardLock && budgetKcal != null && budgetKcal > 0) {
    const factor = foundationKcal > 0 ? budgetKcal / foundationKcal : 1;
    const scaled = scaleNutrientMap(nutrients, factor);
    scaled.calories = budgetKcal;
    return {
      action: 'hard_lock',
      finalKcal: budgetKcal,
      scaleFactor: factor,
      foundationKcal,
      budgetKcal,
      nutrients: scaled,
    };
  }

  if (budgetKcal == null || budgetKcal <= 0) {
    return {
      action: 'no_budget',
      finalKcal: foundationKcal,
      scaleFactor: 1,
      foundationKcal,
      budgetKcal: null,
      nutrients,
    };
  }

  if (foundationKcal <= 0) {
    return {
      action: 'keep',
      finalKcal: budgetKcal,
      scaleFactor: 1,
      foundationKcal: 0,
      budgetKcal,
      nutrients: { ...nutrients, calories: budgetKcal },
    };
  }

  const ratio = foundationKcal / budgetKcal;

  // Incomplete assembly or bad form: do not extreme-scale; caller should rematch first.
  if (incomplete || !formOk) {
    if (ratio >= 0.75 && ratio <= 1.3) {
      return {
        action: 'keep',
        finalKcal: foundationKcal,
        scaleFactor: 1,
        foundationKcal,
        budgetKcal,
        nutrients,
      };
    }
    if (budgetKcal && foundationKcal > 0) {
      const factor = budgetKcal / foundationKcal;
      const scaled = scaleNutrientMap(nutrients, factor);
      scaled.calories = Math.round(budgetKcal * 10) / 10;
      return {
        action: 'scale',
        finalKcal: scaled.calories,
        scaleFactor: factor,
        foundationKcal,
        budgetKcal,
        nutrients: scaled,
      };
    }
    return {
      action: 'reject_scale',
      finalKcal: foundationKcal,
      scaleFactor: 1,
      foundationKcal,
      budgetKcal,
      nutrients,
    };
  }

  if (ratio >= 0.75 && ratio <= 1.3) {
    return {
      action: 'keep',
      finalKcal: foundationKcal,
      scaleFactor: 1,
      foundationKcal,
      budgetKcal,
      nutrients,
    };
  }

  if (ratio >= 0.5 && ratio <= 2.0) {
    const factor = budgetKcal / foundationKcal;
    const scaled = scaleNutrientMap(nutrients, factor);
    scaled.calories = Math.round(budgetKcal * 10) / 10;
    return {
      action: 'scale',
      finalKcal: scaled.calories,
      scaleFactor: factor,
      foundationKcal,
      budgetKcal,
      nutrients: scaled,
    };
  }

  if (ratio < 0.5 && budgetKcal && foundationKcal > 0) {
    const factor = budgetKcal / foundationKcal;
    const scaled = scaleNutrientMap(nutrients, factor);
    scaled.calories = Math.round(budgetKcal * 10) / 10;
    return {
      action: 'scale',
      finalKcal: scaled.calories,
      scaleFactor: factor,
      foundationKcal,
      budgetKcal,
      nutrients: scaled,
    };
  }

  return {
    action: 'reject_scale',
    finalKcal: foundationKcal,
    scaleFactor: 1,
    foundationKcal,
    budgetKcal,
    nutrients,
  };
}

export function scaleNutrientMap(
  nutrients: Record<string, number>,
  factor: number
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(nutrients || {})) {
    const n = Number(v);
    if (!Number.isFinite(n)) {
      out[k] = v as any;
      continue;
    }
    // Do not scale non-mass flags; scale nutrient amounts only
    out[k] = Math.round(n * factor * 10) / 10;
  }
  return out;
}

/** Receipt invariant: component rows must sum to item calories within tol */
export function assertComponentSumMatchesItem(
  componentCalories: number[],
  itemCalories: number,
  tol = 1.1
): { ok: boolean; rowSum: number; itemCalories: number } {
  const rowSum = componentCalories.reduce((a, b) => a + (Number(b) || 0), 0);
  const ok = Math.abs(rowSum - (Number(itemCalories) || 0)) <= tol;
  return { ok, rowSum, itemCalories: Number(itemCalories) || 0 };
}

/** Strictly sum nutrient maps across rows, ensuring non-zero component values are preserved */
export function sumNutrientMapsAdditive(rows: Record<string, number>[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    for (const [key, val] of Object.entries(row || {})) {
      const num = Number(val) || 0;
      if (num > 0) {
        totals[key] = Math.round(((totals[key] || 0) + num) * 10) / 10;
      }
    }
  }
  return totals;
}

/**
 * Mode D / preCalc: scale per-100g map to portion, then optional reconcile to scout budget.
 */
export function portionAndReconcile(input: {
  nutrientsPer100g: Record<string, number>;
  weightGrams: number;
  itemName: string;
  scoutEstimatedCalories?: number | null;
  hardLabelKcal?: number | null;
}): ReconcileResult & { budget: BudgetResult } {
  const w = Math.max(1, Number(input.weightGrams) || 100);
  const factor = w / 100;
  const foundation: Record<string, number> = {};
  for (const [k, v] of Object.entries(input.nutrientsPer100g || {})) {
    foundation[k] = Math.round((Number(v) || 0) * factor * 10) / 10;
  }
  const budget = computeItemBudget({
    itemName: input.itemName,
    weightGrams: w,
    hardLabelKcal: input.hardLabelKcal,
    scoutEstimatedCalories: input.scoutEstimatedCalories,
  });
  const rec = reconcileNutrients({ nutrients: foundation, budget, formOk: true, weightGrams: w });
  return { ...rec, budget };
}

/**
 * Post-reconcile helper: Re-apply truth locks and reconcile reality-check corrections to item and component totals.
 * Pure logic — no I/O.
 */
export function applyPostReconcileTruthLocks(input: {
  sumNutrients: { calories: number; protein: number; totalFat: number; saturatedFat: number; sodium: number; carbohydrates: number };
  ledgerTruth: Record<string, number | string>;
  lockedNutrientKeys?: string[];
  receiptRealityCheckNutrients?: { calories?: number; protein?: number; totalFat?: number; saturatedFat?: number; sodium?: number; carbohydrates?: number };
  isCompositeReceipt?: boolean;
}): {
  nutrients: { calories: number; protein: number; totalFat: number; saturatedFat: number; sodium: number; carbohydrates: number };
  appliedDensityCorrection: boolean;
} {
  const sum = input.sumNutrients || { calories: 0, protein: 0, totalFat: 0, saturatedFat: 0, sodium: 0, carbohydrates: 0 };
  let { calories: sumCal = 0, protein: sumP = 0, totalFat: sumFat = 0, saturatedFat: sumSatFat = 0, sodium: sumNa = 0, carbohydrates: sumCarbs = 0 } = sum;
  const itemLockedKeysSet = new Set<string>(input.lockedNutrientKeys || Object.keys(input.ledgerTruth || {}));
  const receipt = input.receiptRealityCheckNutrients || {};
  let appliedDensityCorrection = false;

  if (!input.isCompositeReceipt) {
    if (!itemLockedKeysSet.has('sodium') && receipt.sodium != null) sumNa = Math.max(0, receipt.sodium);
    if (!itemLockedKeysSet.has('protein') && receipt.protein != null) sumP = Math.max(0, receipt.protein);
    if (!itemLockedKeysSet.has('calories') && receipt.calories != null) sumCal = Math.max(0, receipt.calories);
    if (!itemLockedKeysSet.has('totalFat') && receipt.totalFat != null) sumFat = Math.max(0, receipt.totalFat);
    if (!itemLockedKeysSet.has('saturatedFat') && receipt.saturatedFat != null) sumSatFat = Math.max(0, receipt.saturatedFat);
    if (!itemLockedKeysSet.has('carbohydrates') && receipt.carbohydrates != null) sumCarbs = Math.max(0, receipt.carbohydrates || sumCarbs);
  } else if (!itemLockedKeysSet.has('calories') && receipt.calories != null && sumCal > 0) {
    const diffRatio = Math.abs(receipt.calories - sumCal) / sumCal;
    if (diffRatio > 0.25) {
      sumCal = Math.max(0, receipt.calories);
      if (!itemLockedKeysSet.has('protein') && receipt.protein != null) sumP = Math.max(0, receipt.protein);
      if (!itemLockedKeysSet.has('totalFat') && receipt.totalFat != null) sumFat = Math.max(0, receipt.totalFat);
      if (!itemLockedKeysSet.has('carbohydrates') && receipt.carbohydrates != null) sumCarbs = Math.max(0, receipt.carbohydrates);
      appliedDensityCorrection = true;
    }
  }

  // Force truth locks from ledgerTruth
  Object.entries(input.ledgerTruth || {}).forEach(([key, val]) => {
    const num = Number(val);
    if (!Number.isFinite(num)) return;
    if (key === 'calories') sumCal = num;
    else if (key === 'protein') sumP = num;
    else if (key === 'totalFat') sumFat = num;
    else if (key === 'saturatedFat') sumSatFat = num;
    else if (key === 'sodium') sumNa = num;
    else if (key === 'carbohydrates') sumCarbs = num;
  });

  return {
    nutrients: {
      calories: Math.max(0, sumCal),
      protein: Math.max(0, sumP),
      totalFat: Math.max(0, sumFat),
      saturatedFat: Math.max(0, sumSatFat),
      sodium: Math.max(0, sumNa),
      carbohydrates: Math.max(0, sumCarbs),
    },
    appliedDensityCorrection,
  };
}
