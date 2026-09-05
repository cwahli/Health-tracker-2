import { t, interpolate } from '../../utils/i18n.js';
import { NUTRIENT_KEYS } from '../../utils/nutrients.js';
import { reconcileMessageWithLedger } from '../../mealBuild/narration.js';

/**
 * F-8.10 shard 4 — dietitian dispatch seams, extracted verbatim from
 * runFoodAnalyze. Pure input→output units; streaming/LLM calls stay inline.
 */

export interface DietitianSkipArgs {
  isPureWeightModification: boolean;
  activeMeal: any;
  userSelectedMode?: string;
  weightRefineIntent: { isRefine?: boolean; weightGrams?: number; targetHint?: string; kind?: string };
  message?: string;
}

/** Pure-scale refine gate: label-locked weight refines scale without an LLM call.
 * (The single-agent-create gate is gone with the dietitian call — every create
 * goes through the projector.) */
export function computeDietitianSkipGates(args: DietitianSkipArgs): {
  canSkipDietitianForPureScale: boolean;
} {
  const {
    isPureWeightModification,
    activeMeal,
    userSelectedMode,
    weightRefineIntent,
    message,
  } = args;
  const canSkipDietitianForPureScale = Boolean(
    isPureWeightModification &&
    activeMeal &&
    userSelectedMode !== 'compare' &&
    weightRefineIntent.isRefine &&
    typeof weightRefineIntent.weightGrams === 'number' &&
    weightRefineIntent.weightGrams > 0 &&
    !weightRefineIntent.targetHint &&
    (weightRefineIntent.kind === 'absolute_grams' || weightRefineIntent.kind === 'whole_pack') &&
    (!Array.isArray(activeMeal.itemsBreakdown) || activeMeal.itemsBreakdown.length <= 1) &&
    !/\b(only|remove|delete|without|except|no|instead|replace|add|plus|with|not|didn't|did\s+not)\b/i.test(message || '')
  );
  return { canSkipDietitianForPureScale };
}

export interface ScoutTotals {
  totalSugar: number;
  totalSatFat: number;
  totalP: number;
}

/**
 * F-8.10 shard 15 — single-agent-create verdict ladder, extracted verbatim
 * from runFoodAnalyze. Existing scout verdicts pass through untouched.
 */
export function decideScoutVerdict(args: {
  scoutVerdict: any;
  totals: ScoutTotals;
  mealName?: string;
  language?: unknown;
}): any {
  const { totals, mealName, language } = args;
  let scoutVerdict = args.scoutVerdict;
  if (!scoutVerdict || typeof scoutVerdict !== 'object' || !scoutVerdict.label) {
    if (totals.totalSugar >= 30) {
      scoutVerdict = { label: t(language, 'verdictHighGlycemicSugar'), level: 'warning' };
    } else if (totals.totalSatFat >= 15) {
      scoutVerdict = { label: t(language, 'verdictElevatedSatFat'), level: 'warning' };
    } else if (totals.totalP >= 25) {
      scoutVerdict = { label: t(language, 'verdictLeanMuscle'), level: 'good' };
    } else if (/probiotic|fermented|yogurt|kefir|yakult/i.test(mealName || '')) {
      scoutVerdict = { label: t(language, 'verdictGutMicrobiome'), level: totals.totalSugar >= 25 ? 'neutral' : 'good' };
    } else {
      scoutVerdict = { label: t(language, 'verdictSupportsMetabolicEnergy'), level: 'neutral' };
    }
  }
  return scoutVerdict;
}

/**
 * F-8.10 shard 15 — single-agent-create advice ladder, extracted verbatim
 * from runFoodAnalyze. Existing scout advice passes through untouched.
 */
export function decideScoutAdvice(args: {
  rawAdvice: any;
  totals: ScoutTotals;
  mealName?: string;
  language?: unknown;
}): string {
  const { totals, mealName, language } = args;
  let rawAdvice = args.rawAdvice;
  if (!rawAdvice || String(rawAdvice).trim().length === 0) {
    if (/probiotic|yakult|kefir|yogurt/i.test(mealName || '')) {
      rawAdvice = t(language, 'adviceProbioticSugar').replace('{grams}', String(Math.round(totals.totalSugar)));
    } else if (totals.totalP >= 20) {
      rawAdvice = t(language, 'adviceSolidProtein').replace('{grams}', String(Math.round(totals.totalP)));
    } else if (totals.totalSugar >= 30) {
      rawAdvice = t(language, 'adviceHighSugar').replace('{grams}', String(Math.round(totals.totalSugar)));
    } else {
      rawAdvice = t(language, 'adviceLoggedBalanced').replace('{name}', String(mealName));
    }
  }
  return rawAdvice;
}

/** Pure-scale refine response: label-locked meal scaled without an LLM call. */
export function buildPureScaleResponse(args: { targetWeightGrams: number; language?: unknown }): {
  textOutput: string;
  rawParsed: any;
} {
  const { targetWeightGrams: targetWeight, language } = args;
  const textOutput = JSON.stringify({
    _internalReasoning: `[Refine] scale-only: Scaled meal directly to ${targetWeight}g`,
    verdict: { label: t(language, 'verdictPortionControl'), level: "neutral" },
    message: interpolate(t(language, 'messageScaledPortion'), { grams: targetWeight }),
    mode: "modify",
    modificationCommand: [
      {
        action: "update_weight",
        itemName: "total",
        newWeightGrams: targetWeight
      }
    ]
  });
  return { textOutput, rawParsed: JSON.parse(textOutput) };
}

/** Sums precalc ledgers into create-path totals. */
export function sumPrecalcTotals(preCalculatedItems: any): {
  totalGrams: number;
  totalCals: number;
  totalP: number;
  totalC: number;
  totalF: number;
  totalSugar: number;
  totalAddedSugar: number;
  totalSatFat: number;
} {
  return {
    totalGrams: preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.estimatedWeightGrams) || 0), 0),
    totalCals: preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.nutrients?.calories) || 0), 0),
    totalP: preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.nutrients?.protein) || 0), 0),
    totalC: preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.nutrients?.carbohydrates) || 0), 0),
    totalF: preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.nutrients?.totalFat) || 0), 0),
    totalSugar: preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.nutrients?.sugar ?? it.nutrients?.totalSugar ?? it.nutrients?.addedSugar) || 0), 0),
    totalAddedSugar: preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.nutrients?.addedSugar) || 0), 0),
    totalSatFat: preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.nutrients?.saturatedFat) || 0), 0),
  };
}

export interface DensityCheckArgs {
  preCalculatedItems: any[];
  aggregatedNutrients: any;
  beveragePattern: RegExp;
  onLog: (msg: string) => void;
}

/**
 * F-8.10 shard 19 — pre-dietitian density check, extracted verbatim from
 * runFoodAnalyze. Rescales implausible beverage calories and rolls up
 * aggregated nutrients. Mutates items in place, as inline.
 */
export function applyPreDietitianDensityCheck(args: DensityCheckArgs): Record<string, number> {
  const { preCalculatedItems, aggregatedNutrients: incoming, beveragePattern, onLog } = args;
  let aggregatedNutrients = incoming;
  if (Array.isArray(preCalculatedItems)) {
    preCalculatedItems.forEach((it: any) => {
      if (!it || !it.weightGrams || !it.nutrients) return;
      const cals = Number(it.nutrients.calories || 0);
      const nameLower = String(it.name || it.keyword || '').toLowerCase();
      const isBeverage = beveragePattern.test(nameLower) || nameLower.includes('latte') || nameLower.includes('coffee') || nameLower.includes('drink');
      if (isBeverage && it.weightGrams >= 150 && cals > 600) {
        const maxAllowedCals = Math.round((it.weightGrams / 100) * 110);
        const factor = maxAllowedCals / cals;
        onLog(`[Pre-Dietitian Reality Check] Rescaling beverage item "${it.name}" from ${cals} kcal -> ${maxAllowedCals} kcal prior to Dietitian prompt payload.`);
        NUTRIENT_KEYS.forEach(k => {
          if (it.nutrients[k] != null && typeof it.nutrients[k] === 'number') {
            it.nutrients[k] = Math.round(it.nutrients[k] * factor * 10) / 10;
          }
        });
      }
    });
    if (preCalculatedItems.length > 0) {
      if (!aggregatedNutrients || typeof aggregatedNutrients !== 'object') {
        aggregatedNutrients = {};
      }
      NUTRIENT_KEYS.forEach(k => {
        const sum = preCalculatedItems.reduce((acc: number, item: any) => acc + (Number(item?.nutrients?.[k]) || 0), 0);
        aggregatedNutrients[k] = Math.round(sum * 10) / 10;
      });
    }
  }
  return aggregatedNutrients;
}

export interface CreateSkipSynthesisArgs {
  rawScoutData: any;
  visionScoutItems: any[];
  preCalculatedItems: any[];
  totals: {
    totalGrams: number; totalCals: number; totalP: number; totalC: number;
    totalF: number; totalSugar: number; totalAddedSugar: number; totalSatFat: number;
  };
  scoutVerdict: any;
  rawAdvice: string;
  scoutConfidenceRating?: string;
  scoutConfidenceComment?: string;
  scoutCookingMethod?: string;
  scoutInternalReasoning?: string | null;
  diningEnvironment?: string;
  language?: unknown;
}

/**
 * F-8.10 shard 28 — single-agent-create synthesis, extracted verbatim from
 * runFoodAnalyze. Reconciles the message with the ledger and serializes
 * the dietitian-shaped response (which the caller re-parses, as inline).
 */
export function buildCreateSkipResponse(args: CreateSkipSynthesisArgs): {
  textOutput: string;
  rawParsed: any;
} {
  const {
    rawScoutData, visionScoutItems, preCalculatedItems, totals, scoutVerdict, rawAdvice,
    scoutConfidenceRating, scoutConfidenceComment, scoutCookingMethod,
    scoutInternalReasoning, diningEnvironment, language,
  } = args;
  const { totalGrams, totalCals, totalP, totalC, totalF } = totals;
  const mealName = rawScoutData?.mealName || rawScoutData?.name || (visionScoutItems.length === 1 ? (visionScoutItems[0].originalName || visionScoutItems[0].keyword) : t(language, 'balancedMealFallbackName'));
  const formattedMsg = reconcileMessageWithLedger(rawAdvice, {
    mealName,
    weightGrams: totalGrams,
    calories: Math.round(totalCals),
    protein: Math.round(totalP * 10) / 10,
    carbohydrates: Math.round(totalC * 10) / 10,
    totalFat: Math.round(totalF * 10) / 10,
  }, language);
  // preCalculatedItems is captured from the caller scope via totals source
  const textOutput = JSON.stringify({
    _internalReasoning: scoutInternalReasoning || '[MealAgent] Single-agent create path',
    mode: 'new_log',
    message: formattedMsg,
    verdict: scoutVerdict,
    foodData: {
      name: mealName,
      weightGrams: String(totalGrams),
      cookingMethod: scoutCookingMethod || t(language, 'cookingMethodUnknown'),
      scoutConfidenceRating: scoutConfidenceRating || 'High (>90%)',
      scoutConfidenceComment: scoutConfidenceComment || '',
      diningEnvironment: diningEnvironment || 'unknown',
      itemsBreakdown: preCalculatedItems.map((p: any) => ({
        canonicalDbName: p.keyword || p.originalName,
        originalName: p.originalName,
        weightGrams: String(p.estimatedWeightGrams),
        dbSource: p.dbSource || 'estimated',
        dbId: p.dbId || null,
        foodType: p.foodType || 'composed',
        rawNutritionLabel: p.rawNutritionLabel || null,
        labelNutrientsPerServing: p.labelNutrientsPerServing || null,
      }))
    }
  });
  return { textOutput, rawParsed: JSON.parse(textOutput) };
}

/**
 * F-8.10 shard 28 — salvaged aggregates, extracted verbatim from
 * runFoodAnalyze. Zero-fills and sums the 31 keys over precalc items.
 */
export function sumSalvagedAggregates(preCalculatedItems: any): Record<string, number> {
  const salvagedAggregatedNutrients: Record<string, number> = {};
  NUTRIENT_KEYS.forEach(k => salvagedAggregatedNutrients[k] = 0);
  if (preCalculatedItems && Array.isArray(preCalculatedItems)) {
    preCalculatedItems.forEach((p: any) => {
      if (p.nutrients) {
        NUTRIENT_KEYS.forEach(k => {
          salvagedAggregatedNutrients[k] = parseFloat(((salvagedAggregatedNutrients[k] || 0) + (Number(p.nutrients[k]) || 0)).toFixed(2));
        });
      }
    });
  }
  return salvagedAggregatedNutrients;
}

