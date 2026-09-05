import {
  sanitizeMealWeight,
  evaluateNutrientWarnings,
  enforceTitlePluralParity,
  sanitizeVerdictLabel,
} from '../../../server_pure_helpers.js';
import { pickQueryScopedMatch } from '../../../server_query_scoped_match.js';
import { extractMostRecentImageDate } from '../../utils/dateUtils.js';
import { t } from '../../utils/i18n.js';
import { applyModifierToItemName } from '../../../server_meal_edit.js';
import { appendHistory } from '../../mealBuild/consolidate.js';
import { buildMealFromFinalizeLedgers } from '../../../server_meal_from_finalize.js';
import { finalizeDishLedger } from '../../../server_dish_finalize.js';
import { mergeScoutItems } from '../../../server_vision_scout.js';
import { namesReferToSameFood } from '../../../server_scout_reconcile.js';

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

/**
 * F-8.10 shard 7 — modify-path seams, extracted verbatim from runFoodAnalyze.
 */

/** Backfills missing `estimate` on identity-changing commands from corrected nutrients. Throws on invalid responses. */
export function backfillEditCommandEstimates(rawParsed: any): any[] {
  let editCommands = rawParsed.editCommands || rawParsed.modificationCommand || rawParsed.data?.editCommands || rawParsed.data?.modificationCommand || [];
  if (Array.isArray(editCommands) && Array.isArray(rawParsed.foodData?.itemsBreakdown)) {
    editCommands = editCommands.map((cmd: any) => {
      if ((cmd.action === 'replace_identity' || cmd.action === 'add_item' || cmd.action === 'replace_item') && !cmd.estimate) {
        const targetName = String(cmd.newItemName || cmd.replacementItemName || cmd.itemName || '').trim().toLowerCase();
        const match = rawParsed.foodData?.itemsBreakdown?.find((b: any) => {
          const bName = String(b.canonicalDbName || b.name || '').trim().toLowerCase();
          return (bName && bName === targetName) || (b.scoutIndex != null && b.scoutIndex === cmd.scoutIndex);
        });
        if (match && match.correctedNutrients) {
          return { ...cmd, estimate: { ...match.correctedNutrients, foodType: match.foodType, cookingMethod: match.cookingMethod } };
        }
        throw new Error(`A ${cmd.action} command emitted without "estimate" is an invalid response. You MUST populate it with a complete, realistic nutrient profile for the NEW identity on every single ${cmd.action} command, with no exceptions.`);
      }
      return cmd;
    });
  }
  return editCommands;
}

export function formatMultiItemMealTitle(items: any[]): string {
  if (!items || items.length === 0) return 'Meal';
  const names = items.map((it: any) => it.name || it.canonicalDbName || 'Item').filter(Boolean);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

export interface EditedMealTitleArgs {
  incomingTitle: any;
  items: any[];
  editCommands: any;
}

/** Resolves the post-edit meal title, syncing renames from edit commands. */
export function resolveEditedMealTitle(args: EditedMealTitleArgs): string | null {
  const { incomingTitle, items, editCommands } = args;
  if (items.length > 1) {
    const isMultiItemTitle = incomingTitle && (incomingTitle.includes(',') || /\b(and|with)\b/i.test(incomingTitle));
    if (incomingTitle && isMultiItemTitle) {
      let updatedTitle = incomingTitle;
      // Synchronize any renamed items in incomingTitle from editCommands
      if (Array.isArray(editCommands)) {
        for (const cmd of editCommands) {
          const oldName = cmd.itemName;
          const newName = cmd.newItemName || (cmd.action === 'update_modifier' || cmd.action === 'set_modifier' ? applyModifierToItemName(oldName, cmd.modifier) : null);
          if (oldName && newName && oldName !== newName) {
            const reg = new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
            updatedTitle = updatedTitle.replace(reg, newName);
          }
        }
      }
      return updatedTitle;
    }
    return formatMultiItemMealTitle(items);
  }
  if (incomingTitle) return incomingTitle;
  if (items.length === 1) return items[0].name || null;
  return null;
}

/** Appends the edit summary to the meal history log (mutates activeMeal, as inline). */
export function appendEditHistoryEntry(args: {
  activeMeal: any;
  message?: string;
  result: { notes: string[]; beforeItems?: any[]; items: any[] };
  onLog: (msg: string) => void;
}): void {
  const { activeMeal, message, result, onLog } = args;
  try {
    const summarize = (arr: any[]) => (Array.isArray(arr) ? arr : []).map((it: any) => ({
      name: it.name || it.canonicalDbName || 'Item',
      weightGrams: it.weightGrams ?? it.estimatedWeightGrams ?? null,
      calories: it.nutrients?.calories ?? it.calories ?? null,
    }));
    const historySource: any = { historyLog: Array.isArray(activeMeal.historyLog) ? activeMeal.historyLog : [] };
    const updatedHistorySource = appendHistory(historySource, {
      type: 'user_action',
      timestamp: new Date().toISOString(),
      stage: 'meal_edit',
      message: result.notes.join('; ') || 'Meal edited',
      details: {
        userMessage: message || '',
        before: summarize(result.beforeItems),
        after: summarize(result.items),
      },
    } as any);
    activeMeal.historyLog = updatedHistorySource.historyLog;
  } catch (histErr: any) {
    onLog(`[Edit History] Failed to append history entry: ${histErr?.message || histErr}`);
  }
}

export interface EditScoutSyncArgs {
  baseScoutItems: any[];
  resultItems: any[];
}

/**
 * Syncs scoutItems (UI chips/gallery) with edit-path renames. Without this,
 * renames update the ledger but chip labels stay on the old name forever,
 * because chips read scoutItems.originalName/keyword, not itemsBreakdown.
 */
export function syncEditScoutItems(args: EditScoutSyncArgs): any[] {
  const { baseScoutItems, resultItems } = args;
  return resultItems.map((bItem: any) => {
    const sItem = baseScoutItems.find((s: any) =>
      (bItem.scoutIndex !== undefined && bItem.scoutIndex !== null && s.scoutIndex === bItem.scoutIndex) ||
      (s.originalName && (s.originalName === bItem.name || s.originalName === bItem.canonicalDbName)) ||
      (s.keyword && (s.keyword === bItem.name || s.keyword === bItem.canonicalDbName))
    );
    const newName = bItem.canonicalDbName || bItem.name || sItem?.originalName || 'Item';
    if (sItem) {
      return {
        ...sItem,
        originalName: newName,
        keyword: newName,
        estimatedWeightGrams: bItem.weightGrams || sItem.estimatedWeightGrams,
        packGrams: bItem.packGrams ?? sItem.packGrams ?? null,
        components: bItem.components || sItem.components,
        componentsDetailList: bItem.componentsDetailList || sItem.componentsDetailList,
        nutrients: bItem.nutrients || sItem.nutrients,
        sourceImageIndex: bItem.sourceImageIndex ?? sItem.sourceImageIndex,
        boundingBox2D: bItem.boundingBox2D ?? sItem.boundingBox2D,
      };
    }
    return {
      scoutIndex: bItem.scoutIndex,
      originalName: newName,
      keyword: newName,
      estimatedWeightGrams: bItem.weightGrams || 100,
      packGrams: bItem.packGrams ?? null,
      components: bItem.components || [],
      componentsDetailList: bItem.componentsDetailList || [],
      nutrients: bItem.nutrients || {},
      sourceImageIndex: bItem.sourceImageIndex ?? null,
      boundingBox2D: bItem.boundingBox2D ?? null,
      cookingMethod: bItem.cookingMethod || 'raw',
    };
  });
}

export interface GateInputArgs {
  finalMeal: any;
  jobId?: string;
  photoUrl?: string;
  imagePayloads: any;
  finalMessage: string;
  previousMeal: any;
  editCommands: any;
}

/** Shapes the evaluateMealGate input from the edited meal. */
export function buildGateInput(args: GateInputArgs): any {
  const { finalMeal, jobId, photoUrl, imagePayloads, finalMessage, previousMeal, editCommands } = args;
  return {
    mealId: finalMeal?.id || jobId,
    name: finalMeal?.name,
    weightGrams: finalMeal?.weightGrams,
    calories: finalMeal?.nutrients?.calories ?? finalMeal?.calories,
    protein: finalMeal?.nutrients?.protein ?? finalMeal?.protein,
    carbohydrates: finalMeal?.nutrients?.carbohydrates ?? finalMeal?.carbohydrates,
    totalFat: finalMeal?.nutrients?.totalFat ?? finalMeal?.totalFat,
    items: (finalMeal?.itemsBreakdown || []).map((it: any) => ({
      name: it.originalName || it.canonicalDbName || it.name || 'Item',
      weightGrams: it.weightGrams ?? it.estimatedWeightGrams,
      calories: it.nutrients?.calories ?? it.calories,
      protein: it.nutrients?.protein ?? it.protein,
      carbohydrates: it.nutrients?.carbohydrates ?? it.carbohydrates,
      totalFat: it.nutrients?.totalFat ?? it.totalFat,
      sourceImageIndex: it.sourceImageIndex,
      boundingBox2D: it.boundingBox2D,
      lockedNutrientKeys: it.lockedNutrientKeys,
      dbSource: it.dbSource,
    })),
    mealHasImages: Boolean(photoUrl || (imagePayloads && imagePayloads.length > 0) || finalMeal?.imageUrl),
    imageCount: (imagePayloads && imagePayloads.length > 0) ? imagePayloads.length : (photoUrl ? 1 : 0),
    narrative: finalMessage,
    previousMeal,
    commands: Array.isArray(editCommands) ? editCommands : [],
  };
}

/**
 * F-8.10 shard 8 — new_log tail seams, extracted verbatim from runFoodAnalyze.
 */

/** Derives the composition string from final itemsBreakdown names + visual ingredients. */
export function deriveMealComposition(itemsBreakdown: any): string {
  if (!itemsBreakdown || !Array.isArray(itemsBreakdown)) return "";
  return itemsBreakdown.map((it: any) => {
    let ingStr = "";
    const nameLower = String(it.canonicalDbName || it.name || "").toLowerCase();
    const isLabelItem = it.dbSource === 'label' || it.source === 'label' || String(it.dbId).startsWith('printed_packaging_label');
    if (isLabelItem) {
      it.visualIngredients = [];
    }
    let visList = isLabelItem ? [] : (it.visualIngredients || []);
    if (!isLabelItem && (!Array.isArray(visList) || visList.length === 0) && it.components && Array.isArray(it.components)) {
      visList = it.components.map((c: any) => typeof c === 'string' ? c : c.name || c.searchQuery || c.keyword).filter(Boolean);
    }
    if (Array.isArray(visList) && visList.length > 0) {
      // Filter out sauces, dressings, glazes, condiments per Round 2 Addendum
      const lexicons = ["sauce", "mayonnaise", "dressing", "glaze", "gravy", "ketchup", "mustard", "vinaigrette", "mayo"];
      visList = visList.filter((vis: any) => {
        const vLower = String(vis || "").toLowerCase();
        return !lexicons.some(lex => vLower.includes(lex));
      });
      // Filter out ingredients that are already in the name to prevent redundancy
      const remainingVis = visList.filter((vis: any) => {
        const vLower = String(vis).toLowerCase();
        if (nameLower.includes(vLower)) return false;
        // Handle common abbreviations/substrings
        if (vLower === "mayo" && nameLower.includes("mayonnaise")) return false;
        if (vLower === "mayonnaise" && nameLower.includes("mayo")) return false;
        if (vLower === "potato" && nameLower.includes("potato wedges")) return false;
        if (vLower === "beef" && nameLower.includes("beef steak")) return false;
        return true;
      });
      if (remainingVis.length > 0) {
        ingStr = ` (${remainingVis.join(", ")})`;
      }
    }
    return `${it.canonicalDbName || it.name}${ingStr}`;
  }).join(", ");
}

export interface MealImageArgs {
  body: any;
  images: any;
  image: any;
  parsedData: any;
}

/** Resolves imageUrl/imageUrls from the request payload chain (mutates parsedData, as inline). */
export function resolveMealImageUrls(args: MealImageArgs): void {
  const { body, images, image, parsedData } = args;
  if (!parsedData.imageUrl) {
    if (body.photoUrl && typeof body.photoUrl === 'string' && body.photoUrl.trim() && body.photoUrl !== "[base64_image_data_truncated]") {
      parsedData.imageUrl = body.photoUrl;
    } else if (body.imageUrl && typeof body.imageUrl === 'string' && body.imageUrl.trim() && body.imageUrl !== "[base64_image_data_truncated]") {
      parsedData.imageUrl = body.imageUrl;
    } else if (Array.isArray(body.imageUrls) && body.imageUrls.length > 0 && body.imageUrls[0] && body.imageUrls[0] !== "[base64_image_data_truncated]") {
      parsedData.imageUrl = body.imageUrls[0];
    } else if (Array.isArray(images) && images.length > 0 && images[0] && images[0] !== "[base64_image_data_truncated]") {
      parsedData.imageUrl = images[0];
    } else if (image && typeof image === 'string' && image.trim() && image !== "[base64_image_data_truncated]") {
      parsedData.imageUrl = image;
    } else if (body.activeMeal?.imageUrl && body.activeMeal.imageUrl !== "[base64_image_data_truncated]") {
      parsedData.imageUrl = body.activeMeal.imageUrl;
    } else if (Array.isArray(body.activeMeal?.imageUrls) && body.activeMeal.imageUrls.length > 0 && body.activeMeal.imageUrls[0] !== "[base64_image_data_truncated]") {
      parsedData.imageUrl = body.activeMeal.imageUrls[0];
    } else if (body.activeMeal?.photoUrl && body.activeMeal.photoUrl !== "[base64_image_data_truncated]") {
      parsedData.imageUrl = body.activeMeal.photoUrl;
    }
  }
  if (!parsedData.imageUrls || parsedData.imageUrls.length === 0 || parsedData.imageUrls[0] === "[base64_image_data_truncated]") {
    if (Array.isArray(body.imageUrls) && body.imageUrls.length > 0 && body.imageUrls[0] !== "[base64_image_data_truncated]") {
      parsedData.imageUrls = body.imageUrls;
    } else if (Array.isArray(images) && images.length > 0 && images[0] !== "[base64_image_data_truncated]") {
      parsedData.imageUrls = images;
    } else if (parsedData.imageUrl && parsedData.imageUrl !== "[base64_image_data_truncated]") {
      parsedData.imageUrls = [parsedData.imageUrl];
    } else if (Array.isArray(body.activeMeal?.imageUrls) && body.activeMeal.imageUrls.length > 0 && body.activeMeal.imageUrls[0] !== "[base64_image_data_truncated]") {
      parsedData.imageUrls = body.activeMeal.imageUrls;
    }
  }
}

export interface FinalScoutMergeArgs {
  visionScoutItems: any;
  dietitianScoutItems: any;
  preCalculatedItems: any;
  itemsBreakdown: any;
}

/** Merges scout items with dietitian output, overlays precalc nutrients, renames to ledger names. */
export function mergeFinalScoutItems(args: FinalScoutMergeArgs): any[] {
  const { visionScoutItems, dietitianScoutItems, preCalculatedItems, itemsBreakdown } = args;
  let finalScoutItems = mergeScoutItems(visionScoutItems, dietitianScoutItems);
  if (preCalculatedItems && Array.isArray(preCalculatedItems)) {
    finalScoutItems = finalScoutItems.map((sItem: any) => {
      const preCalc = preCalculatedItems.find((p: any) => p.scoutIndex === sItem.scoutIndex);
      if (preCalc && preCalc.nutrients) {
        return {
          ...sItem,
          nutrients: preCalc.nutrients,
          preCalcNutrients: preCalc.nutrients,
        };
      }
      return sItem;
    });
  }
  if (itemsBreakdown && Array.isArray(itemsBreakdown) && itemsBreakdown.length > 0) {
    finalScoutItems = finalScoutItems.map((sItem: any, sIdx: number) => {
      const bItem = itemsBreakdown.find((b: any) =>
        b.scoutIndex !== undefined && b.scoutIndex !== null && b.scoutIndex === sItem.scoutIndex
      ) || itemsBreakdown.find((b: any) => namesReferToSameFood(b.canonicalDbName || b.name, sItem.originalName || sItem.keyword));
      if (bItem && (bItem.canonicalDbName || bItem.name)) {
        const newName = bItem.canonicalDbName || bItem.name;
        return {
          ...sItem,
          originalName: newName,
          keyword: newName,
          estimatedWeightGrams: bItem.weightGrams || sItem.estimatedWeightGrams
        };
      }
      return sItem;
    });
  }
  return finalScoutItems;
}

export interface NewLogGateArgs {
  finalMeal: any;
  jobId?: string;
  photoUrl?: string;
  imagePayloads: any;
  narrative: any;
}

/** Shapes the evaluateMealGate input for new_log AND the modify fallback (identical shape). */
export function buildNewLogGateInput(args: NewLogGateArgs): any {
  const { finalMeal, jobId, photoUrl, imagePayloads, narrative } = args;
  return {
    mealId: finalMeal?.id || jobId,
    name: finalMeal?.name,
    weightGrams: finalMeal?.weightGrams,
    calories: finalMeal?.nutrients?.calories ?? finalMeal?.calories,
    protein: finalMeal?.nutrients?.protein ?? finalMeal?.protein,
    carbohydrates: finalMeal?.nutrients?.carbohydrates ?? finalMeal?.carbohydrates,
    totalFat: finalMeal?.nutrients?.totalFat ?? finalMeal?.totalFat,
    items: (finalMeal?.itemsBreakdown || []).map((it: any) => ({
      name: it.originalName || it.canonicalDbName || it.name || 'Item',
      weightGrams: it.weightGrams ?? it.estimatedWeightGrams,
      calories: it.nutrients?.calories ?? it.calories,
      protein: it.nutrients?.protein ?? it.protein,
      carbohydrates: it.nutrients?.carbohydrates ?? it.carbohydrates,
      totalFat: it.nutrients?.totalFat ?? it.totalFat,
      sourceImageIndex: it.sourceImageIndex,
      lockedNutrientKeys: it.lockedNutrientKeys,
      dbSource: it.dbSource,
    })),
    mealHasImages: Boolean(photoUrl || (imagePayloads && imagePayloads.length > 0)),
    imageCount: (imagePayloads && imagePayloads.length > 0) ? imagePayloads.length : (photoUrl ? 1 : 0),
    narrative,
  };
}

export interface FinalizeMapArgs {
  preCalculatedItems: any[];
  rawFoodData: any;
  diningEnvironment?: string;
  parsedData: any;
  rawParsed: any;
  onLog: (msg: string) => void;
  sendLog: (type: string, stage: string, message: string, data?: any) => void;
}

/**
 * F-8.10 shard 19 — finalize-to-meal mapping, extracted verbatim from
 * runFoodAnalyze. Maps precalc ledgers onto parsedData (mutates in place).
 */
export function mapFinalizeToMeal(args: FinalizeMapArgs): void {
  const { preCalculatedItems, rawFoodData, diningEnvironment, parsedData, rawParsed, onLog, sendLog } = args;
  const useFinalizeDirectMap = Array.isArray(preCalculatedItems) && preCalculatedItems.length > 0;
  if (useFinalizeDirectMap) {
    onLog('[Single-Path] Meal items = finalizeDishLedger.');
    const mapped = buildMealFromFinalizeLedgers(preCalculatedItems, {
      dietitianItems: rawFoodData.itemsBreakdown,
      diningEnvironment,
      mealName: parsedData.name,
      date: parsedData.date,
    });
    parsedData.itemsBreakdown = mapped.items;
    parsedData.nutrients = mapped.nutrients;
    parsedData.weightGrams = mapped.weightGrams;
    parsedData.serving_grams = mapped.weightGrams;
    parsedData.receiptTable = mapped.receiptTable;
    parsedData.name = mapped.name || parsedData.name;
    sendLog('dietitian_answer', 'dietitian', rawParsed?.message || 'Dietitian generated clinical advice.', {
      mode: rawParsed?.mode
    });
  } else {
    onLog('[Single-Path] No finalize ledger; not inventing a second calorie book.');
    if (!Array.isArray(parsedData.itemsBreakdown)) parsedData.itemsBreakdown = [];
    if (!parsedData.nutrients) parsedData.nutrients = {};
  }
}

export interface ModifyScoutMergeArgs {
  visionScoutItems: any;
  activeMealScoutItems: any;
  dietitianScoutItems: any;
  itemsBreakdown: any;
}

/**
 * F-8.10 shard 20 — modify-path scout merge, extracted verbatim from
 * runFoodAnalyze. Merges dietitian items over the base list, prunes to
 * ledger indices, and renames to ledger names.
 */
export function mergeModifyPathScoutItems(args: ModifyScoutMergeArgs): any[] {
  const { visionScoutItems, activeMealScoutItems, dietitianScoutItems, itemsBreakdown } = args;
  const baseScoutItems = (visionScoutItems && visionScoutItems.length > 0)
    ? visionScoutItems
    : (activeMealScoutItems || []);
  let updatedScoutItems = mergeScoutItems(baseScoutItems, dietitianScoutItems);
  if (itemsBreakdown && Array.isArray(itemsBreakdown) && itemsBreakdown.length > 0) {
    const currentScoutIndices = new Set(itemsBreakdown.map((b: any) => b.scoutIndex).filter((i: any) => i !== undefined && i !== null));
    if (currentScoutIndices.size > 0) {
      updatedScoutItems = updatedScoutItems.filter((sItem: any) => currentScoutIndices.has(sItem.scoutIndex));
    }
    updatedScoutItems = updatedScoutItems.map((sItem: any, sIdx: number) => {
      const bItem = itemsBreakdown.find((b: any) =>
        b.scoutIndex !== undefined && b.scoutIndex !== null && b.scoutIndex === sItem.scoutIndex
      ) || itemsBreakdown.find((b: any) => namesReferToSameFood(b.canonicalDbName || b.name, sItem.originalName || sItem.keyword));
      if (bItem && (bItem.canonicalDbName || bItem.name)) {
        const newName = bItem.canonicalDbName || bItem.name;
        return {
          ...sItem,
          originalName: newName,
          keyword: newName,
          estimatedWeightGrams: bItem.weightGrams || sItem.estimatedWeightGrams
        };
      }
      return sItem;
    });
  }
  return updatedScoutItems;
}

export interface EvaluationFinalizeArgs {
  visionScoutItems: any[];
  diningEnvironment?: string;
  onLog: (msg: string) => void;
}

/**
 * F-8.10 shard 24 — Mode-D evaluation finalize loop, extracted verbatim
 * from runFoodAnalyze. Finalizes each scout item and indexes nutrients by
 * position for the comparison resolver.
 */
export async function runEvaluationFinalize(args: EvaluationFinalizeArgs): Promise<Record<number, Record<string, number>>> {
  const { visionScoutItems, diningEnvironment, onLog } = args;
  const preCalcByScoutIndex: Record<number, Record<string, number>> = {};
  if (visionScoutItems && visionScoutItems.length > 0) {
    await Promise.all(
      visionScoutItems.map(async (sItem: any, idx: number) => {
        const itemGrams = Number(sItem.weightGrams || sItem.estimatedGrams || sItem.estimatedWeightGrams || sItem.servingGrams || 100) || 100;
        const ledger = await finalizeDishLedger({
          item: sItem,
          nutrientBasisWeight: sItem.nutrientBasisWeight || itemGrams,
          consumedWeight: itemGrams,
          diningEnvironment: diningEnvironment || sItem.diningEnvironment,
        });
        onLog(`[Budget] mode=D idx=${idx} item="${sItem.originalName || sItem.keyword}" kcal=${ledger.nutrients.calories} source=${ledger.dbSource} scoutEst=${sItem.estimatedCalories ?? 'n/a'}`);
        preCalcByScoutIndex[idx] = ledger.nutrients as any;
      })
    );
  }
  return preCalcByScoutIndex;
}
