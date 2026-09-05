/**
 * F-8.10 shard 9 — scout item sourcing, extracted verbatim from
 * runFoodAnalyze. Decides where visionScoutItems come from when no fresh
 * vision dispatch runs: active-meal inherit, compare mapper, or prior-run
 * (skipScout / portionChoices / history fallback) resolution.
 */

import { getFallbackCategoryProfile } from '../../../server_food_catalog.js';
import { isPackagedBindItem, inferChainNameFromPackageLabel } from '../../../server_brand_match.js';
import { userSafeScoutFailureMessage } from '../../../server_vision_scout.js';
import { t } from '../../utils/i18n.js';
import { applyPortionChoices } from '../../../server_portion_clarify.js';
import {
  applyWeightRefineToScoutItems,
  priorScoutHasLabelLocks,
  REFINE_SCALE_ONLY_LOG,
} from '../../../server_refine_scale.js';

export interface ScoutInheritArgs {
  isModifySession: boolean;
  visionScoutItems: any[];
  activeMeal: any;
  onLog: (msg: string) => void;
}

/** Inherits finalize-shaped items from the active meal as scout items for edits. */
export function inheritActiveMealScoutItems(args: ScoutInheritArgs): {
  items: any[];
  ran: boolean;
} {
  const { isModifySession, visionScoutItems, activeMeal, onLog } = args;
  if (isModifySession && visionScoutItems.length === 0 && activeMeal) {
    const activeList = Array.isArray(activeMeal.itemsBreakdown) && activeMeal.itemsBreakdown.length > 0
      ? activeMeal.itemsBreakdown
      : (Array.isArray(activeMeal.items) ? activeMeal.items : []);
    if (activeList.length > 0) {
      const items = activeList.map((it: any, idx: number) => {
        const sIdx = it.scoutIndex !== undefined && it.scoutIndex !== null ? it.scoutIndex : idx;
        it.scoutIndex = sIdx; // Mutate the original activeMeal item to ensure it matches by scoutIndex during consolidation
        return {
          itemId: it.itemId || it.id || undefined,
          scoutIndex: sIdx,
          originalName: it.originalName || it.canonicalDbName || it.name || "Food Item",
          keyword: it.keyword || it.canonicalDbName || it.originalName || it.name,
          estimatedWeightGrams: Number(it.weightGrams) || 100,
          nutrientBasisWeight: Number(it.weightGrams) || 100,
          nutrients: it.nutrients || it.truthNutrients || null,
          lockedNutrientKeys: it.lockedNutrientKeys || [],
          _alreadyFinalized: Boolean(it.nutrients && (it.lockedNutrientKeys?.length || it.dbSource === 'label' || it.dbSource === 'usda_direct_hint')),
          cookingMethod: it.cookingMethod || 'raw',
          ingredients: it.ingredients || (it.ingredientsList ? String(it.ingredientsList).split(',').map((s: string) => s.trim()) : []),
          visualIngredients: it.visualIngredients || [],
          rawNutritionLabel: it.rawNutritionLabel || null,
          chainName: it.chainName || null,
          dbSource: it.dbSource || 'estimated',
          dbId: it.dbId || null,
          boundingBox2D: it.boundingBox2D || null,
          sourceImageIndex: it.sourceImageIndex ?? 0,
          componentsDetailList: it.componentsDetailList || [],
          components: it.components || [],
          hasComponents: it.hasComponents || false,
        };
      });
      onLog(`[Edit Continuity] Inherited ${items.length} items from activeMeal into visionScoutItems for edit.`);
      return { items, ran: true };
    }
  }
  return { items: visionScoutItems, ran: false };
}

/** Maps compare-mode item names to scout-shaped rows. */
export function mapCompareItemsToScoutItems(compareItems: any): any[] {
  return (compareItems || []).map((name: string, index: number) => ({
    scoutIndex: index,
    keyword: name,
    originalName: name,
    estimatedWeightGrams: 100,
    source: "compare_request"
  }));
}

export interface PriorScoutArgs {
  body: any;
  history: any;
  activeMeal: any;
}

/** Resolves prior-run scout items across activeScoutItems / scoutItems / meal / history. */
export function resolvePriorScoutItems(args: PriorScoutArgs): any[] {  const { body, history, activeMeal } = args;
  let priorScout = (Array.isArray(body.activeScoutItems) && body.activeScoutItems.length > 0)
    ? body.activeScoutItems
    : ((Array.isArray(body.scoutItems) && body.scoutItems.length > 0)
      ? body.scoutItems
      : (Array.isArray(activeMeal?.scoutItems) && activeMeal.scoutItems.length > 0 ? activeMeal.scoutItems : []));
  if (priorScout.length === 0 && Array.isArray(history) && history.length > 0) {
    // Fallback: search history messages for scoutItems or portionClarify items
    const clarifyMsg = [...history].reverse().find((m: any) =>
      (m.data?.scoutItems && m.data.scoutItems.length > 0) ||
      (m.data?.portionClarify?.scoutItems && m.data.portionClarify.scoutItems.length > 0) ||
      (m.data?.portionClarify?.items && m.data.portionClarify.items.length > 0) ||
      (m.data?.agentResult?.scoutItems && m.data.agentResult.scoutItems.length > 0)
    );
    if (clarifyMsg?.data) {
      priorScout = clarifyMsg.data.scoutItems ||
        clarifyMsg.data.portionClarify?.scoutItems ||
        clarifyMsg.data.portionClarify?.items ||
        clarifyMsg.data.agentResult?.scoutItems || [];
    }
  }
  return priorScout;
}

/**
 * F-8.10 shard 10 — scout-prep seams. Mutates the passed arrays in place,
 * exactly as the inline blocks did.
 */

export interface BracketPreExtractArgs {
  bracketItems: any[];
  visionScoutItems: any[];
  queriesToSearch: string[];
  onLog: (msg: string) => void;
}

/** Purges OCR/label duplicates of bracket items and stamps fallback nutrients. */
export function applyBracketPreExtract(args: BracketPreExtractArgs): void {
  const { bracketItems, visionScoutItems, queriesToSearch, onLog } = args;
  bracketItems.forEach((bItem: any) => {
    const bName = (bItem.originalName || '').toLowerCase().trim();
    // Remove any scout items that match this bracket item (clean purge of OCR/label reference photos)
    for (let idx = visionScoutItems.length - 1; idx >= 0; idx--) {
      const it = visionScoutItems[idx];
      const itName = (it.originalName || it.keyword || '').toLowerCase().trim();
      if (!itName) continue;
      const match = itName === bName || itName.includes(bName) || bName.includes(itName);
      if (match) {
        onLog(`[Bracket Pre-Extracted] Dropping Scout item "${it.originalName || it.keyword}" in favor of pre-extracted bracket item "${bItem.originalName}" (${bItem.estimatedWeightGrams}g).`);
        visionScoutItems.splice(idx, 1);
      }
    }
    // Add clean bracket pre-extracted item with standard nutrient breakdown
    const baseNuts = getFallbackCategoryProfile(bItem.originalName || bItem.keyword || '');
    const factor = (bItem.estimatedWeightGrams || 100) / 100;
    const bNuts = {
      calories: Math.round((baseNuts.calories || 389) * factor),
      protein: Math.round((baseNuts.protein || 12.43) * factor * 10) / 10,
      carbohydrates: Math.round((baseNuts.carbohydrates || 67.0) * factor * 10) / 10,
      totalFat: Math.round((baseNuts.totalFat || 6.86) * factor * 10) / 10,
      saturatedFat: Math.round((baseNuts.saturatedFat || 0.57) * factor * 10) / 10,
      transFat: 0,
      totalFibre: Math.round((baseNuts.totalFibre || 10.43) * factor * 10) / 10,
      sodium: Math.round((baseNuts.sodium || 4.29) * factor),
      addedSugar: 0,
      sugar: Math.round((baseNuts.sugar || 1.0) * factor * 10) / 10,
      potassium: Math.round((baseNuts.potassium || 421) * factor),
      calcium: Math.round((baseNuts.calcium || 54) * factor),
      iron: Math.round((baseNuts.iron || 4.7) * factor * 10) / 10,
      magnesium: Math.round((baseNuts.magnesium || 177) * factor),
      vitaminD: 0,
      omega3: 0.1
    };
    bItem.scoutIndex = visionScoutItems.length;
    bItem.source = 'bracket_pre_extracted';
    bItem.isBracketPreExtracted = true;
    bItem.nutrients = bNuts;
    bItem.truthNutrients = { ...bNuts };
    bItem.nutrientBasisWeight = bItem.estimatedWeightGrams;
    bItem.components = [{
      name: bItem.originalName,
      searchQuery: bItem.originalName,
      weightGrams: bItem.estimatedWeightGrams,
      estimatedWeightGrams: bItem.estimatedWeightGrams,
      nutrients: bNuts,
      calories: bNuts.calories,
      protein: bNuts.protein,
      carbohydrates: bNuts.carbohydrates,
      carbs: bNuts.carbohydrates,
      totalFat: bNuts.totalFat,
      fat: bNuts.totalFat,
      saturatedFat: bNuts.saturatedFat,
      sodium: bNuts.sodium,
      dbSource: 'estimated',
      dbId: null,
    }];
    bItem.componentsDetailList = bItem.components;
    bItem.compositeSiblings = bItem.components;
    bItem.ingredients = [bItem.originalName];
    bItem.visualIngredients = [bItem.originalName];
    visionScoutItems.push(bItem);
    const q = bItem.originalName || bItem.keyword;
    if (q && !queriesToSearch.includes(q)) {
      queriesToSearch.push(q);
    }
  });
}

export interface ExplicitTagsArgs {
  visionScoutItems: any[];
  explicitFoodTags: any[];
  onLog: (msg: string) => void;
}

/** Injects catalog tags directly into vision items (unique offset scoutIndex). */
export function injectExplicitFoodTags(args: ExplicitTagsArgs): void {
  const { visionScoutItems, explicitFoodTags, onLog } = args;
  explicitFoodTags.forEach((tag: any, idx: number) => {
    const existing = visionScoutItems.find((vi: any) => vi.dbId === tag.dbId || vi.keyword === tag.name);
    if (!existing) {
      visionScoutItems.push({
        scoutIndex: 1000 + idx, // unique offset
        keyword: tag.name,
        originalName: tag.name,
        estimatedWeightGrams: tag.weightGrams,
        source: 'catalog_tag',
        dbId: tag.dbId,
        dbSource: 'internal_catalog',
      });
    }
  });
  onLog(`[Explicit Food Tags] Injected ${explicitFoodTags.length} catalog tags directly into vision items.`);
}

/** Infers chainName from package labels on packaged-bind items. */
export function inferPackagedBindChains(args: { packagedBindItems: any[]; onLog: (msg: string) => void }): void {
  const { packagedBindItems, onLog } = args;
  for (const it of packagedBindItems) {
    if (!it.chainName && it.packageLabelText) {
      const brandGuess = inferChainNameFromPackageLabel(it.packageLabelText);
      if (brandGuess) {
        it.chainName = brandGuess;
        onLog(`[PackagedBind] Inferred chainName "${brandGuess}" from packageLabelText for "${it.originalName || it.keyword}".`);
      }
    }
  }
}

/** Maps text-search queries to scout-shaped rows with cooking-method sniffing. */
export function mapTextQueriesToScoutItems(extractedQueries: string[]): any[] {
  return extractedQueries.map((q, idx) => ({
    scoutIndex: idx,
    keyword: q,
    originalName: q,
    estimatedWeightGrams: 100,
    source: "text_query",
    cookingMethod: /\b(fried|deep_fried|pan_fried|roasted|grilled|baked|boiled|steamed)\b/i.exec(q)?.[0] || "raw",
    visualIngredients: []
  }));
}

/**
 * F-8.10 shard 11 — scout result handling. The retry loop and LLM call stay
 * inline; classification, state application, meal merge, and item logging
 * move here verbatim.
 */

/** Classifies a dead scout run into the user-facing error (quota/503/corrupt/generic). */
export function buildScoutFailureError(lastScoutErr: any, language?: unknown): Error {
  const raw = userSafeScoutFailureMessage(lastScoutErr);
  const msg = String(lastScoutErr?.message || '');
  const isQuota = /429|RESOURCE_EXHAUSTED|quota exceeded/i.test(msg);
  const isUnavailable = /503|UNAVAILABLE|overloaded/i.test(msg);
  if (/Vision Scout Corrupted/i.test(msg)) {
    throw new Error(t(language, 'analysisFailed'));
  }
  if (isQuota) {
    throw new Error(
      `Vision Scout Failed: Gemini quota (429) on this model — wait the retry-after window or switch model. Not a bad photo. (Details: ${raw})`
    );
  }
  if (isUnavailable) {
    throw new Error(`Vision Scout Failed: Gemini unavailable (503). Retry shortly. (Details: ${raw})`);
  }
  throw new Error(`Vision Scout Failed: Couldn't reliably read this image, please try again or re-upload. (Details: ${raw})`);
}

export interface ScoutResultStateArgs {
  scoutResult: any;
  requestedMode?: string;
  hasActiveMealDocument: boolean;
  activeMealDining?: string;
  currentRecommendedMode?: string | null;
  onLog: (msg: string) => void;
  onEvent: (type: string, stage: string, message: string, data?: any) => void;
  onStream: (event: any) => void;
}

/** Applies a successful scout result to pipeline state (items, confidence, mode, queries). */
export function applyScoutResultState(args: ScoutResultStateArgs): {
  scoutInternalReasoning: string | null;
  rawScoutData: any;
  visionScoutItems: any[];
  scoutConfidenceRating: any;
  scoutConfidenceComment: any;
  scoutCookingMethod: any;
  visionScoutContentType: any;
  diningEnvironment: string;
  scoutRecommendedMode: string | null;
  queriesToSearch: string[];
  visionScoutRanAndReturnedItems: boolean;
} {
  const {
    scoutResult,
    requestedMode,
    hasActiveMealDocument,
    activeMealDining,
    currentRecommendedMode,
    onLog,
    onEvent,
    onStream,
  } = args;
  const scoutInternalReasoning = scoutResult.internalReasoning || scoutResult._internalReasoning || null;
  const rawScoutData = scoutResult.rawScoutJson || scoutResult.rawDishes || null;
  if (scoutInternalReasoning) {
    onLog(`[Vision Scout Internal Reasoning] ${scoutInternalReasoning}`);
  }
  const visionScoutItems = (scoutResult.items || []).map((item: any) => ({
    ...item,
    internalReasoning: scoutInternalReasoning,
    // Vision Scout's schema/prompt never asks the model to populate `source`, so
    // photographed dishes arrive with it undefined. Tag anything without a
    // transcribed printed nutrition label as 'visual' so the single-serve-photo
    // guard in detectPortionAmbiguity() (server_portion_clarify.ts) can actually
    // fire. Items with a genuine rawNutritionLabel (OCR'd package) are left as-is
    // so they still flow through multi-serve-pack portion clarification.
    source: item.source || (item.rawNutritionLabel ? 'label' : 'visual'),
  }));
  const scoutConfidenceRating = scoutResult.scoutConfidenceRating;
  const scoutConfidenceComment = scoutResult.scoutConfidenceComment;
  const scoutCookingMethod = scoutResult.scoutCookingMethod;
  const visionScoutContentType = scoutResult.visionScoutContentType;
  const diningEnvironment = (scoutResult.diningEnvironment && scoutResult.diningEnvironment !== 'unknown')
    ? scoutResult.diningEnvironment
    : (activeMealDining || "unknown");
  let scoutRecommendedMode = currentRecommendedMode ?? null;
  if (requestedMode === 'review' && !hasActiveMealDocument) {
    scoutRecommendedMode = "new_log";
    onLog(`[Mode Override] User explicitly selected 'review' mode via UI pill. Forcing mode to 'new_log'.`);
  } else if (hasActiveMealDocument && requestedMode === 'review') {
    scoutRecommendedMode = "modify";
    onLog(`[Mode Override] Review pill on an existing modal meal — staying on the same document (edit/merge).`);
  } else if (requestedMode === 'compare') {
    scoutRecommendedMode = "evaluation";
    onLog(`[Mode Override] User explicitly selected 'compare' mode via UI pill. Forcing mode to 'evaluation'.`);
  } else if (visionScoutItems && visionScoutItems.length <= 1 && scoutRecommendedMode === "evaluation") {
    scoutRecommendedMode = "new_log";
  }
  const queriesToSearch: string[] = [...(scoutResult.queriesToSearch || [])];
  const visionScoutRanAndReturnedItems = scoutResult.visionScoutRanAndReturnedItems;
  const scoutItemsSummary = visionScoutItems.map((it: any) => ({
    name: it.originalName || it.keyword,
    keyword: it.keyword,
    weight: it.estimatedWeightGrams
  }));
  const scoutItemsSummaryStr = scoutItemsSummary.map((i: any) => `${i.name} (~${i.weight}g)`).join(', ');
  onEvent('scout_answer', 'scout', `Scout identified ${visionScoutItems.length} item(s): ${scoutItemsSummaryStr}`, {
    items: scoutItemsSummary
  });
  onStream({ type: 'status', stage: 'scout', status: 'completed', message: 'Vision Scout completed.' });
  onLog(`[Vision Scout] Exploded high density rows into ${visionScoutItems.length} individual item(s) to process:`);
  return {
    scoutInternalReasoning,
    rawScoutData,
    visionScoutItems,
    scoutConfidenceRating,
    scoutConfidenceComment,
    scoutCookingMethod,
    visionScoutContentType,
    diningEnvironment,
    scoutRecommendedMode,
    queriesToSearch,
    visionScoutRanAndReturnedItems,
  };
}

export interface ScoutMealMergeArgs {
  activeMealItemsBreakdown: any[];
  visionScoutItems: any[];
  onLog: (msg: string) => void;
}

/** Merges fresh scout dishes into the same meal behind existing items (index offset). */
export function mergeScoutIntoActiveMeal(args: ScoutMealMergeArgs): any[] {
  const { activeMealItemsBreakdown, visionScoutItems, onLog } = args;
  const existing = activeMealItemsBreakdown.map((it: any, idx: number) => ({
    scoutIndex: it.scoutIndex ?? idx,
    originalName: it.originalName || it.canonicalDbName || it.name,
    keyword: it.keyword || it.canonicalDbName || it.name,
    estimatedWeightGrams: it.weightGrams || it.estimatedWeightGrams,
    nutrients: it.nutrients || null,
    boundingBox2D: it.boundingBox2D || null,
    sourceImageIndex: it.sourceImageIndex,
    components: it.components || it.componentsDetailList || null,
    componentsDetailList: it.componentsDetailList || it.components || [],
    cookingMethod: it.cookingMethod,
    foodType: it.foodType,
    dbSource: it.dbSource,
    dbId: it.dbId,
    lockedNutrientKeys: it.lockedNutrientKeys,
    _alreadyFinalized: Boolean(it.nutrients && (it.nutrients.calories != null || it.calories != null)),
  }));
  const maxIdx = existing.reduce((m: number, it: any) => Math.max(m, Number(it.scoutIndex) || 0), -1);
  const newcomers = visionScoutItems.map((it: any, i: number) => ({
    ...it,
    scoutIndex: (typeof it.scoutIndex === 'number' ? it.scoutIndex : i) + maxIdx + 1,
  }));
  const merged = [...existing, ...newcomers];
  onLog(`[Single-Path] Merged ${newcomers.length} new scout dish(es) into the same meal (${existing.length} existing).`);
  return merged;
}

/** Per-item scout debug lines (label/confidence/flags). */
export function logScoutItemSummaries(items: any[], onLog: (msg: string) => void): void {
  items.forEach((item: any) => {
    const rawLabelHasRealData = item.rawNutritionLabel && typeof item.rawNutritionLabel === 'object'
      ? Object.keys(item.rawNutritionLabel).some((k: string) => {
          if (k === 'servingSize' || k === 'weight' || k === 'servingsPerContainer') return false;
          const v = item.rawNutritionLabel[k];
          return v !== undefined && v !== null && v !== '' && v !== '-' && v !== '--';
        })
      : false;
    const flagStr = (item.anomalyFlags && item.anomalyFlags.length > 0) ? ` | Flags: [${item.anomalyFlags.join(', ')}]` : '';
    const confStr = item.itemConfidence ? ` | Confidence: ${item.itemConfidence}` : '';
    const labelStr = rawLabelHasRealData ? ` | Nutrition Label: ${JSON.stringify(item.rawNutritionLabel)}` : '';
    onLog(`[Vision Scout] - Index: ${item.scoutIndex} | Name: "${item.originalName || item.keyword}" | Keyword: "${item.keyword}"${labelStr}${flagStr}${confStr}`);
  });
}

/**
 * F-8.10 shard 16 — shortcut-chain seams. B5 scale-only reuse, turn-1
 * candidate restore, and scout retry delay. Streaming/LLM calls stay inline.
 */

export interface WeightModShortcutArgs {
  activeScoutItems: any;
  portionChoices: any;
  weightRefineIntent: any;
  scoutContentType?: string;
  refineDecision: { reason?: string };
  priorScoutForRefine: any[];
  imagePayloads: any;
  onLog: (msg: string) => void;
}

/** B5 scale-only: re-uses prior scout, applies portionChoices or refine grams. */
export function applyWeightModShortcut(args: WeightModShortcutArgs): {
  visionScoutItems: any[];
  visionScoutContentType: string;
  ran: boolean;
} {
  const {
    activeScoutItems,
    portionChoices,
    weightRefineIntent,
    scoutContentType,
    refineDecision,
    priorScoutForRefine,
    imagePayloads,
    onLog,
  } = args;
  // B5 scale-only: re-use prior scout, apply portionChoices and/or parsed refine grams
  onLog(
    `${REFINE_SCALE_ONLY_LOG} reason=${refineDecision.reason} locks=${priorScoutHasLabelLocks(priorScoutForRefine)} images=${imagePayloads?.length || 0}`
  );
  onLog(`[Shortcut] Weight modification detected on active meal. Skipping Vision Scout and DB Search.`);
  let visionScoutItems = Array.isArray(activeScoutItems) ? [...activeScoutItems] : [];
  if (portionChoices) {
    visionScoutItems = applyPortionChoices(visionScoutItems, portionChoices);
  } else if (weightRefineIntent.isRefine) {
    visionScoutItems = applyWeightRefineToScoutItems(visionScoutItems, weightRefineIntent);
  }
  return {
    visionScoutItems,
    visionScoutContentType: scoutContentType || 'visual',
    ran: visionScoutItems.length > 0,
  };
}

export interface TurnOneRestoreArgs {
  resolvedDbCandidates: any;
  databaseMatchesArray: any[];
  dbMatchMap: Map<string, any>;
  onLog: (msg: string) => void;
}

/** Restores pre-resolved DB candidates from the turn-1 portionClarify payload. */
export function restoreTurnOneCandidates(args: TurnOneRestoreArgs): number {
  const { resolvedDbCandidates, databaseMatchesArray, dbMatchMap, onLog } = args;
  // Task 3: Restore pre-resolved DB candidates from turn-1 portionClarify payload.
  // This prevents the DB search from re-running from scratch and avoids cross-match bugs.
  const priorCandidates = Array.isArray(resolvedDbCandidates) ? resolvedDbCandidates : [];
  if (priorCandidates.length > 0) {
    onLog(`[PortionResume] Restoring ${priorCandidates.length} pre-resolved DB candidates from turn-1 payload. DB search will be skipped.`);
    priorCandidates.forEach((c: any) => {
      databaseMatchesArray.push(c);
      const cid = String(c.id || c.fdcId || '');
      if (cid) dbMatchMap.set(cid, c.nutrients || c);
    });
  }
  return priorCandidates.length;
}

/** Scout retry backoff: 503/UNAVAILABLE waits longer than other failures. */
export function computeScoutRetryDelay(lastScoutErr: any): number {
  return lastScoutErr?.message?.includes('503') || lastScoutErr?.message?.includes('UNAVAILABLE') ? 2000 : 1000;
}

export interface SkipScoutShortcutArgs {
  body: any;
  history: any;
  activeMeal: any;
  onLog: (msg: string) => void;
}

/**
 * F-8.10 shard 17 — skipScout/portionChoices branch: inherits prior scout,
 * applies portion choices, resolves dining environment.
 */
export function applySkipScoutShortcut(args: SkipScoutShortcutArgs): {
  visionScoutItems: any[];
  visionScoutContentType: string;
  diningEnvironment?: string;
  ran: boolean;
} {
  const { body, history, activeMeal, onLog } = args;
  const priorScout = resolvePriorScoutItems({ body, history, activeMeal });
  let visionScoutItems: any[] = [];
  let visionScoutContentType = 'visual';
  let diningEnvironment: string | undefined;
  let ran = false;
  if (priorScout.length > 0) {
    onLog(`[Shortcut] skipScout or portionChoices is true. Inheriting ${priorScout.length} scout items from previous run.`);
    visionScoutItems = applyPortionChoices(
      priorScout,
      body.portionChoices
    );
    visionScoutContentType = body.scoutContentType || 'visual';
    if (body.diningEnvironment && body.diningEnvironment !== 'unknown') {
      diningEnvironment = body.diningEnvironment;
    } else if (priorScout?.[0]?.diningEnvironment && priorScout[0].diningEnvironment !== 'unknown') {
      diningEnvironment = priorScout[0].diningEnvironment;
    }
    ran = true;
  } else {
    onLog(`[PortionChoices] portionChoices provided but priorScout is empty; proceeding with standard pipeline.`);
  }
  return { visionScoutItems, visionScoutContentType, diningEnvironment, ran };
}

export interface ResumedTurnArgs {
  body: any;
  visionScoutItems: any;
  history: any;
}

/**
 * F-8.10 shard 20 — resumed-image-turn predicate, extracted verbatim from
 * runFoodAnalyze. True when this turn continues an image-bearing turn.
 */
export function checkResumedFromImageTurn(args: ResumedTurnArgs): boolean {
  const { body, visionScoutItems, history } = args;
  return !!(
    body.portionChoices ||
    body.skipScout ||
    body.photoUrl ||
    (Array.isArray(body.activeScoutItems) && body.activeScoutItems.length > 0) ||
    (Array.isArray(visionScoutItems) && visionScoutItems.length > 0) ||
    (Array.isArray(history) && history.some((m: any) => m.data?.photoUrl || m.photoUrl || m.data?.hasImage || m.data?.pendingFoodLog?.imageUrl || m.data?.pendingFoodLog?.imageUrls?.length))
  );
}
