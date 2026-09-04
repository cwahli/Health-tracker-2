import {
  sanitizeMealWeight,
  evaluateNutrientWarnings,
  enforceTitlePluralParity,
  sanitizeVerdictLabel,
} from '../../../server_pure_helpers.js';
import { pickQueryScopedMatch } from '../../../server_query_scoped_match.js';
import { extractMostRecentImageDate } from '../../utils/dateUtils.js';
import { t } from '../../utils/i18n.js';

/**
 * F-8.10 shard 6 — new_log meal assembly, extracted verbatim from
 * runFoodAnalyze. Pure shaping; finalize mapping, gate, and streaming stay
 * in the pipeline.
 */

const sanitizeString = (val: any, fallback: string) => {
  if (val === null || val === undefined || String(val).toLowerCase() === "undefined" || String(val).trim() === "") {
    return fallback;
  }
  return String(val);
};

export interface FallbackBreakdownArgs {
  visionScoutItems: any;
  databaseMatchesArray: any;
  quarantinedIdsSet: Set<string>;
  onLog: (msg: string) => void;
}

/** Fallback itemsBreakdown from Vision Scout output when the LLM truncates. */
export function buildFallbackItemsBreakdown(args: FallbackBreakdownArgs): any[] | null {
  const { visionScoutItems, databaseMatchesArray, quarantinedIdsSet, onLog } = args;
  if (!visionScoutItems || visionScoutItems.length === 0) return null;
  const breakdown = visionScoutItems.map((item: any) => {
    const bestMatch = pickQueryScopedMatch(item.keyword || item.originalName || '', databaseMatchesArray, [], quarantinedIdsSet);
    // nutritionFacts is a general-purpose estimate field, never evidence of a
    // real printed label — do not let it set dbSource:'label'. Only item.source
    // === 'label' (scout OCR) or a brand_official match may do that.
    let labelNutrients = null;
    if (item.source === 'label' && item.nutritionFacts && Object.keys(item.nutritionFacts).length > 0) {
      labelNutrients = {
        servingSizeGrams: 100,
        calories: Number(item.nutritionFacts.caloriesPer100g) || 0,
        protein: Number(item.nutritionFacts.proteinPer100g) || 0,
        totalFat: Number(item.nutritionFacts.fatPer100g) || 0,
        saturatedFat: Number(item.nutritionFacts.saturatedFatPer100g) || 0,
        transFat: Number(item.nutritionFacts.transFatPer100g) || 0,
        carbohydrates: Number(item.nutritionFacts.carbsPer100g) || 0,
        addedSugar: Number(item.nutritionFacts.addedSugarPer100g) || 0,
        sodium: Number(item.nutritionFacts.sodiumPer100g) || 0,
        potassium: Number(item.nutritionFacts.potassiumPer100g) || 0,
        totalFibre: Number(item.nutritionFacts.totalFibrePer100g) || 0,
        solubleFibre: Number(item.nutritionFacts.solubleFibrePer100g) || 0
      };
    }
    return {
      canonicalDbName: item.keyword,
      weightGrams: String(sanitizeMealWeight(item.estimatedWeightGrams, 100)),
      dbSource: labelNutrients ? 'label' : (bestMatch ? (bestMatch.source === 'usda' ? 'usda' : 'off') : 'estimated'),
      dbId: bestMatch ? bestMatch.id : null,
      labelNutrientsPerServing: labelNutrients,
      warnings: evaluateNutrientWarnings(labelNutrients),
      foodType: 'unknown'
    };
  });
  onLog(`[Fallback] Built itemsBreakdown from Vision Scout output (LLM truncated)`);
  return breakdown;
}

export interface ParsedMealHeaderArgs {
  rawFoodData: any;
  rawParsed: any;
  imageDates: any;
  message?: string;
  originalModeIsModify: boolean;
  activeMeal: any;
  scoutCookingMethod?: string;
  scoutConfidenceRating?: string;
  scoutConfidenceComment?: string;
  diningEnvironment?: string;
  language?: unknown;
}

/** parsedData header: names, dates, verdict, cooking/confidence, dining env. */
export function assembleParsedMealHeader(args: ParsedMealHeaderArgs): {
  parsedData: any;
  diningEnvironment?: string;
} {
  const {
    rawFoodData,
    rawParsed,
    imageDates,
    message,
    originalModeIsModify,
    activeMeal,
    scoutCookingMethod,
    scoutConfidenceRating,
    scoutConfidenceComment,
    diningEnvironment: diningIn,
    language,
  } = args;
  let diningEnvironment = diningIn;
  const parsedData: any = {};
  parsedData.name = sanitizeString(rawFoodData.name, "Meal Log");
  // Enforce singular/plural parity between the composite title and each item's own
  // canonicalDbName in itemsBreakdown (the LLM is only asked to do this via prompt
  // instruction, with no code-level enforcement — see agents/dietitianInstructions.ts).
  if (Array.isArray(rawFoodData.itemsBreakdown) && rawFoodData.itemsBreakdown.length > 0) {
    parsedData.name = enforceTitlePluralParity(parsedData.name, rawFoodData.itemsBreakdown);
  }
  const mostRecentImageDate = extractMostRecentImageDate(imageDates);
  parsedData.date = sanitizeString(rawFoodData.date, mostRecentImageDate || new Date().toISOString().split("T")[0]);
  if (mostRecentImageDate && (!rawFoodData.date || rawFoodData.date === 'undefined' || String(rawFoodData.date).trim() === '')) {
    parsedData.date = mostRecentImageDate;
  }
  if (originalModeIsModify && activeMeal && activeMeal.date && (!imageDates || imageDates.length === 0)) {
    const userMentionsDate = /\b(yesterday|tomorrow|last night|january|february|march|april|may|june|july|august|september|october|november|december|\d{4}-\d{2}-\d{2})\b/i.test(message || '');
    if (!userMentionsDate) {
      parsedData.date = activeMeal.date;
    }
  }
  parsedData.composition = sanitizeString(rawFoodData.composition, "Unspecified ingredients");
  const itemsWeightSum = Array.isArray(rawFoodData.itemsBreakdown)
    ? rawFoodData.itemsBreakdown.reduce((sum: number, it: any) => sum + (Number(it.weightGrams) || 0), 0)
    : 0;
  const weightFallback = itemsWeightSum > 0 ? itemsWeightSum : 150;
  const totalWeightGrams = sanitizeMealWeight(rawFoodData.weightGrams, weightFallback);
  parsedData.weightGrams = totalWeightGrams;
  parsedData.basis_type = 'total';
  parsedData.serving_grams = totalWeightGrams;
  parsedData.quantity = sanitizeString(rawFoodData.quantity, "1 serving");
  parsedData.benefits = sanitizeString(rawFoodData.benefits, "");
  parsedData.risks = sanitizeString(rawFoodData.risks, "");
  parsedData.healthImpact = sanitizeString(rawFoodData.healthImpact, "");
  parsedData.recommendation = sanitizeString(rawFoodData.recommendation, "");
  parsedData.message = sanitizeString(rawParsed.message || rawFoodData.message || "", "");
  const rawVerdict = rawParsed.verdict || rawFoodData.verdict;
  if (rawVerdict && typeof rawVerdict === 'object') {
    const sanitizedLabel = sanitizeVerdictLabel(rawVerdict.label || t(language, 'verdictSupportsMetabolicEnergy'), rawVerdict.level, parsedData.nutrients, language);
    parsedData.verdict = {
      label: sanitizedLabel,
      level: String(rawVerdict.level || 'neutral')
    };
  } else if (rawFoodData.recommendation && typeof rawFoodData.recommendation === 'string' && rawFoodData.recommendation.trim().length > 0) {
    const sanitizedLabel = sanitizeVerdictLabel(rawFoodData.recommendation, 'neutral', parsedData.nutrients, language);
    parsedData.verdict = {
      label: sanitizedLabel,
      level: 'neutral'
    };
  }
  parsedData.cookingMethod = sanitizeString(rawFoodData.cookingMethod, scoutCookingMethod || t(language, 'cookingMethodUnknown'));
  parsedData.scoutConfidenceRating = sanitizeString(rawFoodData.scoutConfidenceRating, scoutConfidenceRating || "High (>90%)");
  parsedData.scoutConfidenceComment = rawFoodData.scoutConfidenceComment !== undefined ? sanitizeString(rawFoodData.scoutConfidenceComment, "") : (scoutConfidenceComment || "");
  // diningEnvironment is intentionally NOT re-read from the Dietitian's output.
  // The Vision Scout is the sole source of truth for this classification (server.ts:2528).
  if ((!diningEnvironment || diningEnvironment === 'unknown') && activeMeal?.diningEnvironment) {
    diningEnvironment = activeMeal.diningEnvironment;
  }
  parsedData.diningEnvironment = diningEnvironment;
  return { parsedData, diningEnvironment };
}
