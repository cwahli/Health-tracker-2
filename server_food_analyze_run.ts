/**
 * Food-analyze pipeline (Scout → Finalize → Dietitian → Gate).
 * HTTP adapter is server_routes_food_analyze.ts — keep this file off the route.
 */
import { Type } from '@google/genai';
import { z } from 'zod';
import { formatUSDANutrients, formatOFFNutrients, extractOFFNutrientsPer100g, isFastFoodChain, buildWebSearchQuery, loosenQuery, cleanQuery, detectChainKeyFromText, scoutHasCompletePrintedLabel, enrichScoutComponentsWithMatches, buildPastMealsContext } from './src/server/food/server_food_analyze_helpers.js';
import { foodAnalyzeSchema } from './src/server/food/server_food_analyze_schema.js';
import { buildUserContext, buildTimeContext, buildImageContext, buildHistoryContext, buildVisionScoutContext, buildDatabaseMatchesContext, buildBiomarkersContext, stitchFoodPrompt } from './src/server/food/server_food_prompt_context.js';
import { sanitizeLlmJsonOutput, computeDietitianSkipGates } from './src/server/food/server_food_dietitian_dispatch.js';

import { executeFoodResolverCurator } from './server_food_resolver_curator.js';
import {
  checkCategoryAndStateCompatibility,
  applyServerAverageNutrients,
  checkThermodynamicDensitySanity,
  checkArchetypeMacroBounds,
  applySatFatAndAddedSugarFloor,
  backfillSparseMicronutrients,
  sanitizeMealWeight,
  findItemIndexInList,
  getUSDANutrientValue,
  extractUSDANutrientsPer100g,
  checkIfItemIsAlreadyPrepared,
  applyNutrientRealityChecks,
  applyCommercialSodiumFloor,
  checkAtwaterConsistency,
  synchronizeNarrativeText,
  sanitizeVerdictLabel,
  evaluateNutrientWarnings,
  build31NutrientsMarkdownServer,
  enforceTitlePluralParity,
  formatMealReceiptTable,
} from './server_pure_helpers.js';
import { filterMatchesForQuery, pickQueryScopedMatch } from './server_query_scoped_match.js';
import {
  namesReferToSameFood,
  matchBreakdownItemToScout,
  breakdownAlreadyHasScoutName,
  applySoftReceiptAlignment,
  scoutItemMatchesBreakdownName,
} from './server_scout_reconcile.js';
import { rankAndClassifyCandidates, writeAliasIfHitUnique } from './server_fdc_resolve.js';
import { buildFoodSearchQuerySet } from './server_query_set.js';
import {
  withGeminiRetry,
  isGeminiQuotaError,
  isGeminiUnavailableError,
  assertModelNotInQuotaCooldown,
  noteGeminiQuota,
} from './server_gemini_retry.js';
import {
  resolveInternalFood,
  resolveDishCache,
  upsertFoodItemCandidate,
  upsertFoodAlias,
  upsertDishCacheCandidate,
  recordFoodObservation,
  recordSyncEvent,
  normalizeFoodKey,
  normalizeDishKey,
  getCatalogSyncStatus,
  mergeFoodCatalogItems,
  quarantineAtwaterFailures,
  checkAtwaterValidity,
  getFallbackCategoryProfile,
} from './server_food_catalog.js';
import {
  sanitizeDishTitle,
  cleanupDuplicateBrandMenuItems,
  isGroceryBrandSync,
  selfCleanBrandDatabase,
  isUnofficialOrCompositeDish,
} from './serverBrandMenu.js';
import {
  computeItemBudget,
  reconcileNutrients,
} from './server_budget_reconcile.js';
import {
  buildPortionClarifyPayload,
  applyPortionChoices,
} from './server_portion_clarify.js';
import { extractMostRecentImageDate } from './src/utils/dateUtils.js';
import {
  buildFoodAnalyzeInstruction,
  buildModeAReviewInstruction,
  buildModeAEditInstruction,
  buildModeDCompareInstruction,
  buildModeDEditInstruction,
} from './agents/index.js';
import {
  rebalanceNutrientProfile,
  computeCaloriesFromMacros,
  applyNutrientModifiers,
} from './server_derivation.js';
import {
  attachHappyPathMealBuild,
  markDietitianDegraded,
  buildSavableMealFromParsed,
} from './server_meal_orchestrator.js';
import { toPendingFoodLog, fromEvaluationComparison } from './src/mealBuild/adapters.js';
import { attachSseJsonResponder } from './server_sse_json.js';
import { appendHistory } from './src/mealBuild/consolidate.js';
import { projectDietitianInput } from './src/mealBuild/projectors.js';
import { beginStage, endStage, formatDietitianProjectionBlock } from './src/mealBuild/stageLifecycle.js';
import { reconcileMessageWithLedger } from './src/mealBuild/narration.js';
import {
  detectWeightRefineIntent,
  shouldSkipScoutForWeightRefine,
  applyWeightRefineToScoutItems,
  priorScoutHasLabelLocks,
  REFINE_SCALE_ONLY_LOG,
} from './server_refine_scale.js';
import {
  getTraceNutrientsForFoodType,
  getCookingMethodModifier,
  calculateUniversalAddedNutrients,
  lookupCanonicalBaseFood,
  getCachedUSDAFood,
  setCachedUSDAFood,
} from './server_food_db.js';
import { decidePrepAddition } from './server_prep_policy.js';
import { NUTRIENT_KEYS } from './src/utils/nutrients.js';
import {
  isKnownDatabaseBrand,
  isKnownDatabaseBrandSync,
  fetchAllDatabaseBrands,
  searchBrandMenuItems,
  brandHitFitsQuery,
  consolidateBrandMenuItemsAndChains,
  cleanUnbrandedFoodCatalog,
  getBrandMenuItemById,
} from './serverBrandMenu.js';
import {
  isGenericZeroNutrientDiluent,
  getZeroNutrientVector,
  calculateGenericTokenCoverage,
  evaluateGenericModifierInversionPenalty,
  classifyUniversalPhysicalFormV3,
} from './server_matching_engine.js';
import {
  ScoutItemSchema,
  VisionScoutSchema,
  scoutSystemInstruction,
  mergeScoutItems,
  parseAndHealVisionScout,
  reconcileIngredientsToComponents,
  userSafeScoutFailureMessage,
} from './server_vision_scout.js';
import { buildVisualScoutPrompt, parseBracketedFoodItems } from './agents/scoutInstructions.js';
import { isDishEstimateEnabled } from './server_food_flags.js';
import { finalizeDishLedger } from './server_dish_finalize.js';
import { evaluateMealGate } from './server_meal_gate.js';
import { buildMealFromFinalizeLedgers } from './server_meal_from_finalize.js';
import { applyMealEdits, applyModifierToItemName } from './server_meal_edit.js';
import { matchBrandMenu, isPackagedBindItem, inferChainNameFromPackageLabel } from './server_brand_match.js';
import { classifyDishAtomic } from './server_dish_classify.js';
import { withScoutLanguage, t, interpolate } from './src/utils/i18n.js';
import {
  addDebugLog,
  logSessionStorage,
  streamDebugLogStorage,
  globalDebugLogs,
  sessionDebugLogs,
  callUnifiedLLM,
  asyncParseLLMJSON,
  validateOrFallback,
  getGeminiClient,
  getGeminiApiKey,
  BEVERAGE_RAW_PATTERN,
  SINGLE_STAPLE_RE,
  RouteAgentSchema,
  adminAuth,
  db,
  searchUSDA,
  searchOpenFoodFacts,
  fetchUSDAFoodById,
  fetchOFFProductByBarcode,
  lookupChainMenuSources,
  isUsableWebNutritionHit,
  resolveComparisonGroups,
  retrieveFoodImages,
} from './server.js';
function extractFoodSearchQueriesFromText(message: string): string[] {
  if (!message || typeof message !== 'string') return [];
  let msg = message.trim().toLowerCase();
  // Non-food / greeting check
  const nonFoodPatterns = [
    /^(start|let's start|hello|hi|hey|greetings|help|test|yes|no|ok|okay|clear|reset|menu|why|explain|question|info|please)$/i,
    /\b(alt|ast|cholesterol|ldl|hdl|egfr|creatinine|bilirubin|triglycerides|platelets|wbc|rbc|hemoglobin|hba1c|glucose|blood pressure|systolic|diastolic)\b/i
  ];
  const isNonFood = nonFoodPatterns.some(p => p.test(msg)) && !/\b(eat|ate|eating|had|cooked|fried|grilled|recipe|meal|food|snack|breakfast|lunch|dinner|portion|slice|glass|cup|gram|grams|calorie|calories|nutrient|nutrients)\b/i.test(msg);
  if (isNonFood) return [];
  // Remove portion/weight amounts & units: e.g. "200g", "150 grams", "2 oz", "1 serving", "3 pcs", "2 slices", "1/2 cup"
  msg = msg.replace(/\b\d+(\.\d+)?\s*(g|grams|oz|lbs|kg|servings|serving|pcs|piece|pieces|slice|slices|cup|cups|glass|glasses|tbsp|tsp|bowl|bowls|plate|plates)?\b/gi, ' ');
  msg = msg.replace(/\b(\d+\/\d+)\s*(g|grams|oz|lbs|kg|servings|serving|pcs|piece|pieces|slice|slices|cup|cups|glass|glasses|tbsp|tsp|bowl|bowls|plate|plates)?\b/gi, ' ');
  // Remove punctuation (including apostrophes, commas, quotes, hyphens, colons, brackets)
  msg = msg.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?'"“”\[\]]/g, ' ');
  // List of conversational stop words/phrases to remove
  const stopWords = new Set([
    'it', 'its', 'is', 's', 'that', 'thats', 'this', 'these', 'those', 'there', 'theres', 'they', 'theyre', 'them',
    'i', 'me', 'my', 'you', 'your', 'we', 'our', 'he', 'she', 'his', 'her',
    'am', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'would', 'should', 'could', 'will', 'can',
    'a', 'an', 'the', 'and', 'or', 'with', 'for', 'in', 'on', 'at', 'to', 'from', 'by', 'of', 'some', 'about', 'into', 'through',
    'not', 'no', 'but', 'yes', 'ok', 'okay', 'please', 'thanks', 'thank', 'hello', 'hi', 'hey',
    'eat', 'ate', 'eating', 'had', 'have', 'having', 'food', 'meal', 'snack', 'dinner', 'lunch', 'breakfast', 'item', 'items',
    'portion', 'portions', 'dish', 'dishes', 'plate', 'plates',
    'correction', 'corrections', 'actually', 'instead', 'change', 'modify', 'update', 'correct', 'replace',
    'rather', 'than', 'think', 'believe', 'cooked', 'made', 'make'
  ]);
  // Split into candidate food phrases using conjunctions / separators ("and", ",", "+", ";", "with", "to", "instead of")
  const rawSegments = msg.split(/\b(?:and|with|to|instead of|\+|;|,)\b/gi);
  const queries: string[] = [];
  for (const seg of rawSegments) {
    const words = seg.trim().split(/\s+/).filter(w => w.length > 0);
    // Filter out stop words
    const foodWords = words.filter(w => !stopWords.has(w) && w.length > 1);
    if (foodWords.length > 0) {
      const foodPhrase = foodWords.join(' ').trim();
      if (foodPhrase.length >= 2 && !/^\d+$/.test(foodPhrase)) {
        if (!queries.includes(foodPhrase)) {
          queries.push(foodPhrase);
        }
      }
    }
  }
  return queries;
}
export async function runFoodAnalyze(req: any, res: any) {
  if (!req.headers['x-session-id'] || !req.headers['x-session-id'].toString().startsWith('server-job-')) {
    return res.status(403).json({ error: 'This SSE path is deprecated and strictly reserved for internal loopback execution.' });
  }
  const isStream = req.query.stream === 'true';
  let hasSentHeaders = false;
  const sessionId = logSessionStorage.getStore() || "global";
  const initialLogCount = (sessionDebugLogs[sessionId] || globalDebugLogs).length;
  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();
    hasSentHeaders = true;
    attachSseJsonResponder(res);
  }

  const sendStreamEvent = (data: any) => {
    if (isStream && hasSentHeaders) {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (typeof (res as any).flush === 'function') (res as any).flush();
      } catch (e) {}
    }
  };

  let visionScoutItems: any[] = [];
  let visionScoutContentType: any = 'visual';
  let preCalculatedItems: any[] = [];
  let aggregatedNutrients: any = null;
  let fullPromptSent = "";
  let apiCalls: any[] = [];

  try {
    const {
      message,
      image,
      images,
      imageDates,
      history,
      userProfile,
      engine,
      biomarkersNeedingImprovement,
      remainingAllowance,
      userId,
      activeMeal,
      customSystemInstruction,
      customVariableData,
      foodLogs,
      userSelectedMode,
    } = req.body;

    const activeComparison = req.body.activeComparison || null;

    const sendLog = (type: string, stage: string, message: string, data?: any) => {
      sendStreamEvent({ type: 'log', logType: type, stage, message, data });
    };

    const imagePayloads: any[] = [];
    if (image) {
      imagePayloads.push(image);
    }
    if (Array.isArray(images)) {
      images.forEach((img: any) => {
        if (img && !imagePayloads.includes(img)) {
          imagePayloads.push(img);
        }
      });
    }

    const analysisNutrientKeys = [
      'calories',
      'protein',
      'carbohydrates',
      'totalFat',
      'saturatedFat',
      'transFat',
      'unsaturatedFat',
      'sugar',
      'totalSugar',
      'addedSugar',
      'totalFibre',
      'solubleFibre',
      'sodium',
      'potassium',
      'magnesium',
      'calcium',
      'iron',
      'zinc',
      'selenium',
      'iodine',
      'phosphorus',
      'vitaminD',
      'vitaminB12',
      'folate',
      'vitaminC',
      'vitaminE',
      'vitaminK',
      'vitaminA',
      'vitaminB6',
      'thiamine',
      'riboflavin',
      'niacin',
    ];
    // B5 — Detect weight/portion refine on prior scout (skip Vision Scout + DB when safe).
    // Path A: text-only refine. Path B: images still attached but printed label locks exist.
    const priorScoutForRefine = Array.isArray(req.body.activeScoutItems) ? req.body.activeScoutItems : [];
    const refineDecision = shouldSkipScoutForWeightRefine({
      message,
      imageCount: imagePayloads?.length || 0,
      activeScoutItems: priorScoutForRefine,
      activeMeal,
      explicitSkipScout: req.body.skipScout === true,
    });
    const weightRefineIntent = refineDecision.intent.isRefine
      ? refineDecision.intent
      : detectWeightRefineIntent(message);
    // Pure weight modification: only true if there is an explicit numerical gram weight for the whole meal
    const isPureWeightModification = !!(
      (refineDecision.skip && weightRefineIntent.isRefine && weightRefineIntent.kind === 'absolute_grams' && typeof weightRefineIntent.weightGrams === 'number' && weightRefineIntent.weightGrams > 0 && !weightRefineIntent.targetHint) ||
      (
        activeMeal &&
        (!imagePayloads || imagePayloads.length === 0) &&
        message &&
        weightRefineIntent.isRefine &&
        weightRefineIntent.kind === 'absolute_grams' &&
        typeof weightRefineIntent.weightGrams === 'number' &&
        weightRefineIntent.weightGrams > 0 &&
        !weightRefineIntent.targetHint &&
        !/\b(only|remove|delete|without|except|no|instead|replace|add|plus|with|not|didn't|did\s+not)\b/i.test(message)
      )
    );
    // Frontend sends the user's explicit mode selection (review | compare | edit) from the pill toggle.
    // When the user has explicitly selected "Edit", treat any text-only follow-up as a modification
    // command regardless of wording, instead of relying solely on keyword matching.
    const userExplicitlySelectedEditMode = req.body.userSelectedMode === 'edit' || req.body.userSelectedMode === 'modify';
    const hasNoNewImages = !imagePayloads || imagePayloads.length === 0;
    const hasActiveMealDocument = !!(
      activeMeal &&
      (
        activeMeal.id ||
        (Array.isArray(activeMeal.itemsBreakdown) && activeMeal.itemsBreakdown.length > 0) ||
        (Array.isArray(activeMeal.items) && activeMeal.items.length > 0)
      )
    );
    // One modal = one document. If this modal already has a meal, every later
    // submit (text, extra photos, refine) is edit/merge — never a second new_log.
    const isExplicitModify = !!hasActiveMealDocument;
    addDebugLog(`[Edit Gate] userSelectedMode="${req.body.userSelectedMode || 'undefined'}" | userExplicitlySelectedEditMode=${userExplicitlySelectedEditMode} | activeMeal=${!!activeMeal} | hasImages=${!!(imagePayloads && imagePayloads.length > 0)} | message="${(message || '').substring(0, 50)}" | isExplicitModify=${isExplicitModify} | refineSkip=${refineDecision.skip} reason=${refineDecision.reason}`);
    const isWeightModification = isPureWeightModification || refineDecision.skip;
    const compareOnly = req.body.compareOnly === true;
    const compareItems = Array.isArray(req.body.compareItems) ? req.body.compareItems : [];
    let databaseMatches = "";
    const databaseMatchesArray: any[] = [];
    const quarantinedIdsSet = new Set<string>();
    let visionScoutRanAndReturnedItems = false;
    const isModifySession = Boolean(isPureWeightModification || isExplicitModify || userExplicitlySelectedEditMode || refineDecision.skip || (activeMeal && Boolean(req.body.activeMeal)));
    // Only inherit activeScoutItems if this is an explicit modification command on the active meal
    visionScoutItems = (isPureWeightModification || isExplicitModify || refineDecision.skip) ? (req.body.activeScoutItems || []) : [];
    if (isModifySession && visionScoutItems.length === 0 && activeMeal) {
      const activeList = Array.isArray(activeMeal.itemsBreakdown) && activeMeal.itemsBreakdown.length > 0
        ? activeMeal.itemsBreakdown
        : (Array.isArray(activeMeal.items) ? activeMeal.items : []);
      if (activeList.length > 0) {
        visionScoutItems = activeList.map((it: any, idx: number) => {
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
        visionScoutRanAndReturnedItems = true;
        addDebugLog(`[Edit Continuity] Inherited ${visionScoutItems.length} items from activeMeal into visionScoutItems for edit.`);
      }
    }
    let scoutScratchpad: string | undefined;
    let scoutInternalReasoning: string | null = null;
    let rawScoutData: any = null;
    let scoutConfidenceRating = "High (>90%)";
    let scoutConfidenceComment = "";
    let scoutRecommendedMode: string | null = null;
    let scoutCookingMethod = "";
    visionScoutContentType = 'visual';
    let diningEnvironment = activeMeal?.diningEnvironment || "unknown";
    const dbMatchMap = new Map<string, any>();
    const queriesToSearch: string[] = [];
    const scoutOriginalQueries: string[] = [];
    if (compareOnly) {
      addDebugLog(`[Shortcut] Compare mode detected. Skipping Vision Scout and DB Search.`);
      if (compareItems && compareItems.length > 0) {
        visionScoutItems = compareItems.map((name: string, index: number) => ({
          scoutIndex: index,
          keyword: name,
          originalName: name,
          estimatedWeightGrams: 100,
          source: "compare_request"
        }));
      }
    } else if (isWeightModification || refineDecision.skip) {
      // B5 scale-only: re-use prior scout, apply portionChoices and/or parsed refine grams
      addDebugLog(
        `${REFINE_SCALE_ONLY_LOG} reason=${refineDecision.reason} locks=${priorScoutHasLabelLocks(priorScoutForRefine)} images=${imagePayloads?.length || 0}`
      );
      addDebugLog(`[Shortcut] Weight modification detected on active meal. Skipping Vision Scout and DB Search.`);
      visionScoutItems = Array.isArray(req.body.activeScoutItems) ? [...req.body.activeScoutItems] : visionScoutItems;
      if (req.body.portionChoices) {
        visionScoutItems = applyPortionChoices(visionScoutItems, req.body.portionChoices);
      } else if (weightRefineIntent.isRefine) {
        visionScoutItems = applyWeightRefineToScoutItems(visionScoutItems, weightRefineIntent);
      }
      visionScoutContentType = req.body.scoutContentType || 'visual';
      visionScoutRanAndReturnedItems = visionScoutItems.length > 0;
    } else if (req.body.skipScout || req.body.portionChoices) {
      let priorScout = (Array.isArray(req.body.activeScoutItems) && req.body.activeScoutItems.length > 0)
        ? req.body.activeScoutItems
        : ((Array.isArray(req.body.scoutItems) && req.body.scoutItems.length > 0)
          ? req.body.scoutItems
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
      if (priorScout.length > 0) {
        addDebugLog(`[Shortcut] skipScout or portionChoices is true. Inheriting ${priorScout.length} scout items from previous run.`);
        visionScoutItems = applyPortionChoices(
          priorScout,
          req.body.portionChoices
        );
        visionScoutContentType = req.body.scoutContentType || 'visual';
        if (req.body.diningEnvironment && req.body.diningEnvironment !== 'unknown') {
          diningEnvironment = req.body.diningEnvironment;
        } else if (priorScout?.[0]?.diningEnvironment && priorScout[0].diningEnvironment !== 'unknown') {
          diningEnvironment = priorScout[0].diningEnvironment;
        }
        visionScoutRanAndReturnedItems = true;
      } else {
        addDebugLog(`[PortionChoices] portionChoices provided but priorScout is empty; proceeding with standard pipeline.`);
      }
      // Task 3: Restore pre-resolved DB candidates from turn-1 portionClarify payload.
      // This prevents the DB search from re-running from scratch and avoids cross-match bugs.
      const priorCandidates = Array.isArray(req.body.resolvedDbCandidates) ? req.body.resolvedDbCandidates : [];
      if (priorCandidates.length > 0) {
        addDebugLog(`[PortionResume] Restoring ${priorCandidates.length} pre-resolved DB candidates from turn-1 payload. DB search will be skipped.`);
        priorCandidates.forEach((c: any) => {
          databaseMatchesArray.push(c);
          const cid = String(c.id || c.fdcId || '');
          if (cid) dbMatchMap.set(cid, c.nutrients || c);
        });
      }
    } else {
      const hasImage = imagePayloads && imagePayloads.length > 0;
      if (hasImage) {
        sendStreamEvent({ type: 'status', stage: 'scout', status: 'started', message: 'Reading your photos...' });
        const imageCount = imagePayloads?.length || 0;
        const scoutPromptText = buildVisualScoutPrompt(message || '', imageCount);
        sendLog('scout_instruction', 'scout', `Vision Scout Instruction dispatched (model: ${engine || "gemini-3.5-flash-lite"}). Prompt: "${scoutPromptText}"`);
        addDebugLog(`[Vision Scout] Running Stage 3 lightweight vision scout with retry protection...`);
        let scoutResult: any = null;
        let scoutAttempts = 0;
        const maxScoutAttempts = 3;
        let lastScoutErr: any = null;
        while (scoutAttempts < maxScoutAttempts) {
          scoutAttempts++;
          try {
            if (scoutAttempts > 1) {
              if (isGeminiQuotaError(lastScoutErr)) break;
              const delay = lastScoutErr?.message?.includes('503') || lastScoutErr?.message?.includes('UNAVAILABLE') ? 2000 : 1000;
              addDebugLog(`[Vision Scout] Waiting ${delay}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              addDebugLog(`[Vision Scout] Retrying LLM call (Attempt ${scoutAttempts} of ${maxScoutAttempts})...`);
            }
            const scoutOutput = await callUnifiedLLM({
              modelId: (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite",
              systemInstruction: withScoutLanguage(scoutSystemInstruction, userProfile?.language),
              promptText: scoutPromptText,
              imagePayloads,
              responseMimeType: "application/json",
              maxOutputTokens: 8192,
              temperature: 0.1,
              skipThinking: true,
              logStagePrefix: 'scout',
              onStream: (chunk: string, isThought?: boolean) => {
                if (isStream && hasSentHeaders) {
                  try {
                    res.write(`data: ${JSON.stringify({ type: 'stream', chunk, stage: 'scout' })}\n\n`);
                    if (typeof (res as any).flush === 'function') (res as any).flush();
                  } catch (e) {}
                }
              },
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  _internalReasoning: { type: Type.STRING },
                  contentType: { type: Type.STRING, enum: ["visual", "menu_or_poster", "label", "text"] },
                  diningEnvironment: { type: Type.STRING, enum: ["home_cooked", "casual_restaurant", "fast_food_chain", "fine_dining", "airline", "unknown"] },
                  dishes: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        dishName: { type: Type.STRING },
                        chainName: { type: Type.STRING, nullable: true },
                        packageLabelText: { type: Type.STRING, nullable: true },
                        estimatedWeightGrams: { type: Type.NUMBER },
                        packGrams: { type: Type.NUMBER, nullable: true },
                        cookingMethod: { type: Type.STRING, enum: ["raw", "baked", "grilled", "boiled", "steamed", "deep_fried", "pan_fried", "stir_fried"] },
                        sourceImageIndex: { type: Type.INTEGER },
                        boundingBox2D: {
                          type: Type.ARRAY,
                          items: { type: Type.INTEGER },
                        },
                        isStandaloneCondimentPacket: { type: Type.BOOLEAN, nullable: true },
                        foods: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              foodName: { type: Type.STRING },
                              packageLabelText: { type: Type.STRING, nullable: true },
                              weightGrams: { type: Type.NUMBER },
                              packGrams: { type: Type.NUMBER, nullable: true },
                              sourceImageIndex: { type: Type.INTEGER, nullable: true },
                              rawNutritionLabel: {
                                type: Type.OBJECT,
                                nullable: true,
                                properties: {
                                  servingSize: { type: Type.STRING },
                                  calories: { type: Type.STRING },
                                  protein: { type: Type.STRING },
                                  totalFat: { type: Type.STRING },
                                  saturatedFat: { type: Type.STRING },
                                  transFat: { type: Type.STRING },
                                  totalCarbohydrate: { type: Type.STRING },
                                  sugar: { type: Type.STRING },
                                  addedSugar: { type: Type.STRING },
                                  sodium: { type: Type.STRING },
                                  salt: { type: Type.STRING },
                                  potassium: { type: Type.STRING },
                                  totalFibre: { type: Type.STRING },
                                },
                                required: ["servingSize", "calories"],
                              },
                              nutrients: {
                                type: Type.OBJECT,
                                properties: {
                                  protein: { type: Type.NUMBER },
                                  saturatedFat: { type: Type.NUMBER },
                                  addedSugar: { type: Type.NUMBER },
                                  totalFibre: { type: Type.NUMBER },
                                  sodium: { type: Type.NUMBER },
                                  carbohydrates: { type: Type.NUMBER },
                                },
                                required: ["protein", "saturatedFat", "addedSugar", "totalFibre", "sodium", "carbohydrates"],
                              },
                            },
                            required: ["foodName", "weightGrams", "nutrients"],
                          },
                        },
                        dishNutrients: {
                          type: Type.OBJECT,
                          properties: {
                            saturatedFat: { type: Type.NUMBER },
                            totalFat: { type: Type.NUMBER },
                            totalSugar: { type: Type.NUMBER },
                          },
                          required: ["saturatedFat", "totalFat", "totalSugar"],
                        },
                      },
                      required: ["dishName", "estimatedWeightGrams", "cookingMethod", "boundingBox2D", "foods", "dishNutrients"],
                    },
                  },
                },
                required: ["contentType", "diningEnvironment", "dishes"],
              }
            });
            // Yield to the event loop before heavy synchronous parsing
            await new Promise(resolve => setImmediate(resolve));
            scoutResult = parseAndHealVisionScout(scoutOutput, addDebugLog, userSelectedMode === 'compare', message);
            break; // Success! Break out of the loop
          } catch (scoutErr: any) {
            lastScoutErr = scoutErr;
            addDebugLog(`[Vision Scout Attempt ${scoutAttempts} Failed] Error: ${scoutErr.message}`);
            if (isGeminiQuotaError(scoutErr)) {
              addDebugLog(`[Vision Scout] Aborting further scout retries — 429 quota on this model. Switch model or wait.`);
              break;
            }
          }
        }
        if (!scoutResult) {
          addDebugLog(`[Vision Scout Failed Permanently] Both attempts failed. Last error: ${lastScoutErr?.message}`);
          const raw = userSafeScoutFailureMessage(lastScoutErr);
          const isQuota = /429|RESOURCE_EXHAUSTED|quota exceeded/i.test(String(lastScoutErr?.message || ''));
          const isUnavailable = /503|UNAVAILABLE|overloaded/i.test(String(lastScoutErr?.message || ''));
          if (/Vision Scout Corrupted/i.test(String(lastScoutErr?.message || ''))) {
            throw new Error(t(userProfile?.language, 'analysisFailed'));
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
          scoutInternalReasoning = scoutResult.internalReasoning || scoutResult._internalReasoning || null;
          rawScoutData = scoutResult.rawScoutJson || scoutResult.rawDishes || null;
          if (scoutInternalReasoning) {
            addDebugLog(`[Vision Scout Internal Reasoning] ${scoutInternalReasoning}`);
          }
          visionScoutItems = (scoutResult.items || []).map((item: any) => ({
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
          scoutConfidenceRating = scoutResult.scoutConfidenceRating;
          scoutConfidenceComment = scoutResult.scoutConfidenceComment;
          scoutCookingMethod = scoutResult.scoutCookingMethod;
          visionScoutContentType = scoutResult.visionScoutContentType;
          diningEnvironment = (scoutResult.diningEnvironment && scoutResult.diningEnvironment !== 'unknown')
            ? scoutResult.diningEnvironment
            : (activeMeal?.diningEnvironment || "unknown");
          if (req.body.userSelectedMode === 'review' && !hasActiveMealDocument) {
            scoutRecommendedMode = "new_log";
            addDebugLog(`[Mode Override] User explicitly selected 'review' mode via UI pill. Forcing mode to 'new_log'.`);
          } else if (hasActiveMealDocument && req.body.userSelectedMode === 'review') {
            scoutRecommendedMode = "modify";
            addDebugLog(`[Mode Override] Review pill on an existing modal meal — staying on the same document (edit/merge).`);
          } else if (req.body.userSelectedMode === 'compare') {
            scoutRecommendedMode = "evaluation";
            addDebugLog(`[Mode Override] User explicitly selected 'compare' mode via UI pill. Forcing mode to 'evaluation'.`);
          } else if (visionScoutItems && visionScoutItems.length <= 1 && scoutRecommendedMode === "evaluation") {
            scoutRecommendedMode = "new_log";
          }
          queriesToSearch.push(...scoutResult.queriesToSearch);
          scoutOriginalQueries.push(...scoutResult.queriesToSearch);
          visionScoutRanAndReturnedItems = scoutResult.visionScoutRanAndReturnedItems;
          const scoutItemsSummary = visionScoutItems.map((it: any) => ({
            name: it.originalName || it.keyword,
            keyword: it.keyword,
            weight: it.estimatedWeightGrams
          }));
          const scoutItemsSummaryStr = scoutItemsSummary.map((i: any) => `${i.name} (~${i.weight}g)`).join(', ');
          sendLog('scout_answer', 'scout', `Scout identified ${visionScoutItems.length} item(s): ${scoutItemsSummaryStr}`, {
            items: scoutItemsSummary
          });
          sendStreamEvent({ type: 'status', stage: 'scout', status: 'completed', message: 'Vision Scout completed.' });
          addDebugLog(`[Vision Scout] Exploded high density rows into ${visionScoutItems.length} individual item(s) to process:`);
          if (hasActiveMealDocument && Array.isArray(activeMeal.itemsBreakdown) && activeMeal.itemsBreakdown.length > 0) {
            const existing = activeMeal.itemsBreakdown.map((it: any, idx: number) => ({
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
            visionScoutItems = [...existing, ...newcomers];
            addDebugLog(`[Single-Path] Merged ${newcomers.length} new scout dish(es) into the same meal (${existing.length} existing).`);
          }
          visionScoutItems.forEach((item: any) => {
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
            addDebugLog(`[Vision Scout] - Index: ${item.scoutIndex} | Name: "${item.originalName || item.keyword}" | Keyword: "${item.keyword}"${labelStr}${flagStr}${confStr}`);
          });
      } else if (message) {
        addDebugLog(`[Text Search Extraction] No image supplied. Extracting search terms from message: "${message}"`);
        const extractedQueries = extractFoodSearchQueriesFromText(message);
        if (extractedQueries.length > 0) {
          addDebugLog(`[Text Search Extraction] Extracted clean food search queries: ${JSON.stringify(extractedQueries)}`);
          queriesToSearch.push(...extractedQueries);
          if (!isExplicitModify && !isPureWeightModification) {
            scoutRecommendedMode = "new_log";
            visionScoutItems = extractedQueries.map((q, idx) => ({
              scoutIndex: idx,
              keyword: q,
              originalName: q,
              estimatedWeightGrams: 100,
              source: "text_query",
              cookingMethod: /\b(fried|deep_fried|pan_fried|roasted|grilled|baked|boiled|steamed)\b/i.exec(q)?.[0] || "raw",
              visualIngredients: []
            }));
          }
        } else {
          addDebugLog(`[Text Search Extraction] Message classified as conversational or non-food query. Skipping database matches.`);
        }
      }
    }
    const bracketItems = parseBracketedFoodItems(message || '');
    if (bracketItems.length > 0) {
      addDebugLog(`[Bracket Pre-Extracted] Found ${bracketItems.length} pre-extracted bracket item(s) in message: ${bracketItems.map(b => `"${b.originalName}" (${b.estimatedWeightGrams}g)`).join(', ')}`);
      bracketItems.forEach((bItem: any) => {
        const bName = (bItem.originalName || '').toLowerCase().trim();
        // Remove any scout items that match this bracket item (clean purge of OCR/label reference photos)
        visionScoutItems = visionScoutItems.filter((it: any) => {
          const itName = (it.originalName || it.keyword || '').toLowerCase().trim();
          if (!itName) return true;
          const match = itName === bName || itName.includes(bName) || bName.includes(itName);
          if (match) {
            addDebugLog(`[Bracket Pre-Extracted] Dropping Scout item "${it.originalName || it.keyword}" in favor of pre-extracted bracket item "${bItem.originalName}" (${bItem.estimatedWeightGrams}g).`);
            return false;
          }
          return true;
        });
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
      visionScoutRanAndReturnedItems = visionScoutItems.length > 0;
    }
    // Strip parenthetical local-language notes for cleaner USDA/OFF matching
    // e.g. "raw beef slices (daging empal and blade)" → "raw beef slices"
    const hasImage = imagePayloads && imagePayloads.length > 0;
    // Only treat this as a "big menu browse" for search-skipping purposes when the scout
    // actually recommends evaluation/browsing mode. A menu-board photo taken to log one
    // specific consumed dish (scoutRecommendedMode === "new_log") should still get real
    // nutrition search for that item, even though the source photo is a menu_or_poster.
    const isMenuScale = (visionScoutContentType === "menu_or_poster" || visionScoutContentType === "text") && scoutRecommendedMode !== "new_log";
    if (Array.isArray(req.body.explicitFoodTags) && req.body.explicitFoodTags.length > 0) {
      req.body.explicitFoodTags.forEach((tag: any, idx: number) => {
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
      addDebugLog(`[Explicit Food Tags] Injected ${req.body.explicitFoodTags.length} catalog tags directly into vision items.`);
    }
    // Clean and consolidate queries first
    const uniqueQueries = buildFoodSearchQuerySet(visionScoutItems || []);
    const detectedChainKey =
      visionScoutItems?.map((it: any) => it.originalName || it.keyword || it.name).map(detectChainKeyFromText).find(Boolean) ||
      uniqueQueries.map(detectChainKeyFromText).find(Boolean);
    let registeredChainSources: any[] = [];
    if (detectedChainKey) {
      registeredChainSources = await lookupChainMenuSources(detectedChainKey, 'GB');
      if (registeredChainSources.length > 0) {
        addDebugLog(`[ChainSource] Found ${registeredChainSources.length} source(s) for ${detectedChainKey}: ${registeredChainSources.map((s: any) => s.url).join(' | ')}`);
      } else {
        addDebugLog(`[ChainSource] No registry row for ${detectedChainKey}`);
        addDebugLog(`[ChainSource] No official source for "${detectedChainKey}". Preferring component/USDA path over web_search absolute injection.`);
      }
    }
    const isEvaluationScale = visionScoutItems.length >= 15;
    const packagedBindItems = (visionScoutItems || []).filter((it: any) => isPackagedBindItem(it));
    if (isDishEstimateEnabled(req)) {
      if (packagedBindItems.length > 0) {
        addDebugLog(`[PackagedBind] ${packagedBindItems.length} packaged/OCR item(s) bind via finalize brand/OCR rungs; generic USDA curator still skipped.`);
        for (const it of packagedBindItems) {
          if (!it.chainName && it.packageLabelText) {
            const brandGuess = inferChainNameFromPackageLabel(it.packageLabelText);
            if (brandGuess) {
              it.chainName = brandGuess;
              addDebugLog(`[PackagedBind] Inferred chainName "${brandGuess}" from packageLabelText for "${it.originalName || it.keyword}".`);
            }
          }
        }
      } else {
        addDebugLog('[CuratorSkipped] Dish estimate pipeline active, skipping hot-path database search and resolver curator.');
      }
    }
    const shouldRunDbSearch = !isDishEstimateEnabled(req) && !isWeightModification && !isMenuScale && !isEvaluationScale &&
      databaseMatchesArray.length === 0 && // skip if already restored from turn-1 resolvedDbCandidates
      (visionScoutRanAndReturnedItems || (!hasImage && uniqueQueries.length > 0));
    // Task 1 cont.: DB search runs HERE — before portionClarify check — so candidates are
    // available to embed in the awaiting_user pause payload for carry-forward to turn 2.
    if (shouldRunDbSearch && uniqueQueries.length > 0) {
      sendStreamEvent({ type: 'status', stage: 'db_search', status: 'started', message: 'Searching nutrition databases...' });
      if (typeof (res as any).flush === 'function') (res as any).flush();
      sendLog('db_search', 'db_search', `Querying USDA & OpenFoodFacts databases for: [${uniqueQueries.join(', ')}]`);
      addDebugLog(`[Database Search] Performing USDA & OFF searches for queries: ${JSON.stringify(uniqueQueries)}`);
      const searchPromises = uniqueQueries.map(async (q) => {
        try {
          const cleaned = cleanQuery(q);
          const isBarcode = /^\d{6,}$/.test(cleaned);
          let dataTypes = 'Foundation,SR Legacy,Survey (FNDDS)';
          const isDbBrand = await isKnownDatabaseBrand(cleaned);
          if (isBarcode || visionScoutContentType === 'text' || cleaned.toLowerCase().includes('brand') || isDbBrand) {
            dataTypes = 'Foundation,SR Legacy,Survey (FNDDS),Branded';
          }
          const isGeneric = /^(mayo|mayonnaise|granola|tortilla|salad greens|mixed salad leaves|lettuce|tomato|onion|cucumber|bread|wrap|egg|boiled egg|salt|pepper|oil|butter|sugar|chicken|beef|pork|fish|tuna|salmon|rice|pasta|cheese)$/i.test(cleaned);
          if (isGeneric && !isDbBrand && !isBarcode) {
            dataTypes = 'Foundation,SR Legacy,Survey (FNDDS)'; // Override and lock to generics
            addDebugLog(`[BrandGuard] Using generic USDA types for "${cleaned}" (not a brand — skip branded/OFF catalog)`);
          }
          let offP = Promise.resolve([]);
          if (isBarcode || dataTypes.includes('Branded')) {
            offP = searchOpenFoodFacts(cleaned, 3);
          }
          // BrandGuard: a generic token (e.g. plain "mayonnaise") should not be allowed to
          // match a specific restaurant's branded catalog item (e.g. "Pot of Chimi Mayo")
          // unless that chain was actually detected for this meal. Previously this guard
          // only restricted the USDA/OFF `dataTypes`, but `searchBrandMenuItems` ran
          // unconditionally, polluting gap-resolver candidates with irrelevant chain-specific
          // products for ordinary generic ingredients.
          const brandP = (isGeneric && !isDbBrand && !isBarcode && !detectedChainKey)
            ? Promise.resolve([])
            : searchBrandMenuItems(cleaned, detectedChainKey);
          let [usda, off, brandHits] = await Promise.all([
            searchUSDA(cleaned, 3, dataTypes),
            offP,
            brandP,
          ]);
          const web: any[] = [];
          // If zero results found in main database search, retry with loosened query
          if (usda.length === 0 && off.length === 0 && brandHits.length === 0) {
            const loosened = loosenQuery(cleaned);
            if (loosened && loosened !== cleaned) {
              addDebugLog(`[Database Search Fallback] Zero results for "${cleaned}". Retrying with loosened query "${loosened}"...`);
              let fallbackOffP = Promise.resolve([]);
              if (isBarcode || dataTypes.includes('Branded')) {
                fallbackOffP = searchOpenFoodFacts(loosened, 3);
              }
              const fallbackBrandP = (isGeneric && !isDbBrand && !isBarcode && !detectedChainKey)
                ? Promise.resolve([])
                : searchBrandMenuItems(loosened, detectedChainKey);
              const [fallUSDA, fallOFF, fallBrand] = await Promise.all([
                searchUSDA(loosened, 3, dataTypes),
                fallbackOffP,
                fallbackBrandP
              ]);
              if (fallUSDA.length > 0 || fallOFF.length > 0 || fallBrand.length > 0) {
                addDebugLog(`[Database Search Fallback] Succeeded for "${loosened}". USDA: ${fallUSDA.length}, OFF: ${fallOFF.length}, Brand: ${fallBrand.length}`);
                usda = fallUSDA;
                off = fallOFF;
                brandHits = fallBrand;
              }
            }
          }
          return { query: q, usda, off, brandHits, web };
        } catch (err) {
          return { query: q, usda: [], off: [], brandHits: [], web: [] };
        }
      });
      const searchResultsList = await Promise.all(searchPromises);
      // Ensure explicit food tags from internal catalog are present in databaseMatchesArray
      if (Array.isArray(req.body.explicitFoodTags) && req.body.explicitFoodTags.length > 0) {
        for (const tag of req.body.explicitFoodTags) {
          if (tag.dbId && typeof tag.dbId === 'string' && tag.dbId.startsWith('brand_menu_')) {
            const brandItem = await getBrandMenuItemById(tag.dbId);
            if (brandItem) {
              searchResultsList.push({
                query: tag.name,
                usda: [],
                off: [],
                brandHits: [brandItem],
                web: []
              });
              addDebugLog(`[Explicit Tag] Injected direct brand menu lookup for tag "${tag.name}" (ID: ${tag.dbId})`);
            }
          }
        }
      }
      const list: string[] = [];
      const seenBrandTargets = new Set<string>();
      for (const resItem of searchResultsList) {
        if (resItem.brandHits && Array.isArray(resItem.brandHits)) {
          resItem.brandHits.filter((bmHit: any) => brandHitFitsQuery(resItem.query, bmHit)).forEach((bmHit: any) => {
            const bType = bmHit.basisType || 'per_dish';
            const bmNutrients = {
              ...(bmHit.nutrients || {}),
              basisType: bType,
              calories: Number(bmHit.calories || 0),
              protein: bmHit.protein,
              totalFat: bmHit.fat,
              saturatedFat: bmHit.saturatedFat,
              carbohydrates: bmHit.carbohydrates,
              totalFibre: bmHit.totalFibre,
              sodium: bmHit.sodium
            };
            dbMatchMap.set(bmHit.id, bmNutrients);
            databaseMatchesArray.push({
              ...bmHit,
              searchQuery: resItem.query,
              basisType: bType,
              nutrients: bmNutrients
            });
            const brandKey = `${String(bmHit.chainName || '').toLowerCase()}::${String(bmHit.name || '').toLowerCase()}`;
            if (seenBrandTargets.has(brandKey)) return;
            seenBrandTargets.add(brandKey);
            const bmProteinStr = (bmHit.protein !== undefined && bmHit.protein !== null) ? `${bmHit.protein}g` : 'n/a';
            const bmCarbsStr = (bmHit.carbohydrates !== undefined && bmHit.carbohydrates !== null) ? `${bmHit.carbohydrates}g` : 'n/a';
            const bmFatStr = (bmHit.fat !== undefined && bmHit.fat !== null) ? `${bmHit.fat}g` : 'n/a';
            list.push(`- [Brand Menu (Official)] Chain: ${bmHit.chainName} | Item: ${bmHit.name} | Calories: ${bmHit.calories} | P: ${bmProteinStr} | C: ${bmCarbsStr} | F: ${bmFatStr} | Source: brand_official`);
            addDebugLog(`[Brand DB Match] Found official restaurant/brand menu item for "${resItem.query}" -> "${bmHit.name}" (${bmHit.chainName})`);
          });
        }
        resItem.usda.forEach((food: any) => {
          const fdcIdStr = String(food.fdcId);
          dbMatchMap.set(fdcIdStr, extractUSDANutrientsPer100g(food));
          const parsedNutrients = extractUSDANutrientsPer100g(food);
          const caloriesStr = String(parsedNutrients.calories);
          databaseMatchesArray.push({
            id: fdcIdStr,
            source: "usda",
            searchQuery: resItem.query,
            name: food.description || "",
            servingGrams: 100,
            ...parsedNutrients,
            calories: caloriesStr,
            protein: parsedNutrients.protein,
            fat: parsedNutrients.totalFat,
            saturatedFat: parsedNutrients.saturatedFat,
            sodium: parsedNutrients.sodium,
            carbohydrates: parsedNutrients.carbohydrates,
            totalFibre: parsedNutrients.totalFibre,
            nutrients: parsedNutrients
          });
          list.push(`- [USDA] ID: ${fdcIdStr} | Name: ${food.description} | Nutrients (per 100g): ${formatUSDANutrients(food.foodNutrients)}`);
        });
        resItem.off.forEach((product: any) => {
          const idStr = String(product.barcode || product.id || product.code || "");
          if (idStr) {
            dbMatchMap.set(idStr, extractOFFNutrientsPer100g(product));
            const parsedNutrients = extractOFFNutrientsPer100g(product);
            const caloriesStr = String(parsedNutrients.calories);
            databaseMatchesArray.push({
              id: idStr,
              source: "off",
              searchQuery: resItem.query,
              name: product.product_name || "",
              servingGrams: 100,
              ...parsedNutrients,
              calories: caloriesStr,
              protein: parsedNutrients.protein,
              fat: parsedNutrients.totalFat,
              saturatedFat: parsedNutrients.saturatedFat,
              sodium: parsedNutrients.sodium,
              carbohydrates: parsedNutrients.carbohydrates,
              totalFibre: parsedNutrients.totalFibre,
              nutrients: parsedNutrients
            });
            list.push(`- [OpenFoodFacts] Barcode: ${idStr} | Name: ${product.product_name} (${product.brands || 'No Brand'}) | Nutrients (per 100g): ${formatOFFNutrients(product.nutriments)}`);
          }
        });
        if (resItem.web && Array.isArray(resItem.web)) {
          resItem.web.forEach((webItem: any, wIdx: number) => {
            if (webItem && isUsableWebNutritionHit(webItem)) {
              const webId = `web_search_${resItem.query}_${wIdx}`;
              const isBrandResult = Boolean(resItem.query && isKnownDatabaseBrandSync(resItem.query)) || webItem.source === 'brand_official';
              const webCarbsRaw = webItem.carbohydrates ?? webItem.carbs;
              const webCarbs = webCarbsRaw != null ? Number(webCarbsRaw) : null;
              const webFibreRaw = webItem.fiber ?? webItem.totalFibre;
              const webFibre = webFibreRaw != null ? Number(webFibreRaw) : null;
              const webSugar = webItem.sugar != null ? Number(webItem.sugar) : null;
              const webSalt = webItem.salt != null ? Number(webItem.salt) : null;
              const webSodiumRaw = webItem.sodium ?? (webSalt != null ? Math.round(webSalt * 400) : null);
              const webSodium = webSodiumRaw != null ? Number(webSodiumRaw) : null;
              const webProt = webItem.protein != null ? Number(webItem.protein) : null;
              const webFat = webItem.fat != null ? Number(webItem.fat) : null;
              const webSatFat = webItem.saturatedFat != null ? Number(webItem.saturatedFat) : null;
              const webCals = Number(webItem.calories || 0);
              // NUTRITION BASIS FIX (Aug 2026): live web/brand search results report calories for
              // the WHOLE named dish as sold (e.g. "YOLK Chicken Sandwich: 783 kcal" = one whole
              // sandwich), NOT per 100g. Tag as basisType 'total' so downstream scaling does not
              // re-multiply by weight/100 a second time. Reuses the existing 'basisType' convention
              // already used elsewhere in this file (see the printed-label truthMatch object).
              const nutritionBasisType = isBrandResult ? 'total' : 'per_100g';
              const dbEntry = {
                id: webId,
                source: isBrandResult ? 'brand_official' : (webItem.source || "web_search"),
                searchQuery: resItem.query,
                name: webItem.name || resItem.query,
                calories: String(webCals),
                protein: webProt,
                fat: webFat,
                saturatedFat: webSatFat,
                carbohydrates: webCarbs,
                totalFibre: webFibre,
                sugar: webSugar,
                salt: webSalt,
                sodium: webSodium,
                ingredients: webItem.ingredients || webItem.ingredientsList || webItem.description || '',
                brandPriority: isBrandResult,
                basisType: nutritionBasisType
              };
              databaseMatchesArray.push(dbEntry);
              dbMatchMap.set(webId, {
                servingSizeGrams: 100,
                basisType: nutritionBasisType,
                calories: webCals,
                protein: webProt,
                totalFat: webFat,
                saturatedFat: webSatFat,
                transFat: 0,
                carbohydrates: webCarbs,
                addedSugar: 0,
                sodium: webSodium,
                salt: webSalt,
                potassium: 0,
                totalFibre: webFibre,
                solubleFibre: 0
              });
              list.push(`- [WebSearch${isBrandResult ? ' (Brand Priority)' : ''}] Query: ${resItem.query} | Name: ${webItem.name || resItem.query} | Calories: ${webCals} | P: ${webProt}g | C: ${webCarbs}g | F: ${webFat}g | Provider: ${webItem.source || 'web_search'}`);
            } else if (webItem) {
              addDebugLog(`[WebSearch] Discarded unusable hit for "${resItem.query}" (calories=${webItem.calories ?? 'n/a'}).`);
            }
          });
        }
      }
      if (list.length > 0) {
        databaseMatches = list.slice(0, 50).join("\n");
      } else {
        databaseMatches = "No matches found in USDA or Open Food Facts databases for these queries.";
      }
      sendLog('db_search_complete', 'db_search', `Found ${databaseMatchesArray.length} database match(es) across USDA & OpenFoodFacts.`);
      sendStreamEvent({ type: 'status', stage: 'db_search', status: 'completed', message: 'Database search completed.' });
      // Run Food Resolver Agent only for query gaps that do NOT hit the internal catalog or dish cache
      // and that are NOT covered by a complete printed packaging label (token save + avoid bad USDA).
      const gapsForResolver: Array<{ query: string; candidates: Array<{ id: string; name: string; source: string }> }> = [];
      const labelCompleteQueries = new Set<string>();
      for (const s of visionScoutItems || []) {
        if (!scoutHasCompletePrintedLabel(s)) continue;
        for (const q of [s.originalName, s.keyword, s.name]) {
          if (q && String(q).trim()) labelCompleteQueries.add(String(q).toLowerCase().trim());
        }
        // Parent label is dish truth — skip component gap LLM too (macros locked later from label)
        if (Array.isArray(s.components)) {
          for (const c of s.components) {
            const cq = c?.searchQuery || c?.name || c?.keyword;
            if (cq && String(cq).trim()) labelCompleteQueries.add(String(cq).toLowerCase().trim());
          }
        }
      }
      const internalHits = await Promise.all(searchResultsList.map(async (resItem) => {
        const hit = await resolveInternalFood(resItem.query);
        return { resItem, hit };
      }));
      for (const { resItem, hit } of internalHits) {
        if (hit) {
          const virtualId = hit.food_id || `internal_${hit.food_key}`;
          dbMatchMap.set(virtualId, hit.nutrients_per_100g);
          databaseMatchesArray.push({
            id: virtualId,
            source: 'internal_catalog',
            searchQuery: resItem.query,
            name: hit.display_name || resItem.query,
            servingGrams: 100,
            calories: String(hit.nutrients_per_100g.calories || 0),
            protein: hit.nutrients_per_100g.protein || 0,
            fat: hit.nutrients_per_100g.totalFat || hit.nutrients_per_100g.fat || 0,
            saturatedFat: hit.nutrients_per_100g.saturatedFat || 0,
            sodium: hit.nutrients_per_100g.sodium || 0,
            carbohydrates: hit.nutrients_per_100g.carbohydrates || hit.nutrients_per_100g.carbs || 0,
            totalFibre: hit.nutrients_per_100g.totalFibre || 0,
            nutrients: hit.nutrients_per_100g
          });
          addDebugLog(`[Internal Catalog Hit] Resolved "${resItem.query}" from internal catalog without Food Resolver agent gap.`);
          continue;
        }
        const qNorm = String(resItem.query || '').toLowerCase().trim();
        if (qNorm && labelCompleteQueries.has(qNorm)) {
          addDebugLog(`[Food Resolver Skip] Complete printed label covers "${resItem.query}" — skipping LLM resolver for this gap.`);
          continue;
        }
        const compositeParentDishQueries = new Set<string>();
        for (const s of visionScoutItems || []) {
          if (Array.isArray(s.components) && s.components.length >= 2) {
            for (const q of [s.originalName, s.keyword, s.name]) {
              if (q && String(q).trim()) compositeParentDishQueries.add(String(q).toLowerCase().trim());
            }
          }
        }
        if (qNorm && compositeParentDishQueries.has(qNorm)) {
          addDebugLog(`[Food Resolver Skip] Composite multi-component parent dish "${resItem.query}" is resolved via its sub-components — skipping monolithic LLM resolver gap.`);
          continue;
        }
        const candidates: Array<{ id: string; name: string; source: string }> = [];
        resItem.brandHits?.forEach((item: any) => {
          candidates.push({ id: String(item.id), name: `${item.chainName || ''} ${item.name || item.dish_name || ''}`.trim(), source: "brand_official" });
        });
        const { resolveClass, bestMatch, survivors } = rankAndClassifyCandidates(resItem.query, resItem.usda, 85);
        if (resolveClass === 'HIT_UNIQUE' && bestMatch) {
            addDebugLog(`[ResolveClass] HIT_UNIQUE for "${resItem.query}" -> ${bestMatch.description}`);
            writeAliasIfHitUnique(resolveClass, resItem.query, bestMatch).catch(e => console.error(e));
            // Treat as auto-resolved gap
            const virtualId = String(bestMatch.fdcId);
            const nut = extractUSDANutrientsPer100g(bestMatch);
            dbMatchMap.set(virtualId, nut);
            databaseMatchesArray.push({
              id: virtualId,
              source: "usda",
              searchQuery: resItem.query,
              name: bestMatch.description || resItem.query,
              servingGrams: 100,
              calories: String(nut.calories || 0),
              protein: nut.protein || 0,
              fat: nut.totalFat || nut.fat || 0,
              saturatedFat: nut.saturatedFat || 0,
              sodium: nut.sodium || 0,
              carbohydrates: nut.carbohydrates || nut.carbs || 0,
              totalFibre: nut.totalFibre || 0,
              nutrients: nut
            });
            continue; // Skip adding to gapsForResolver!
        }
        // For MULTI_MATCH or MISS, pass the survivors (or top N if none) to the Curator
        const candidatesToAdd = survivors.length > 0 ? survivors.map(s => s.candidate) : resItem.usda;
        candidatesToAdd.forEach((food: any) => {
          candidates.push({ id: String(food.fdcId), name: food.description || "", source: "usda" });
        });
        resItem.off.forEach((product: any) => {
          const idStr = String(product.barcode || product.id || product.code || "");
          if (idStr) {
            candidates.push({ id: idStr, name: product.product_name || "", source: "off" });
          }
        });
        const cleanGapQuery = sanitizeDishTitle(resItem.query);
        const gapKey = normalizeFoodKey(cleanGapQuery);
        const isDuplicateGap = gapsForResolver.some(g => normalizeFoodKey(sanitizeDishTitle(g.query)) === gapKey);
        if (!isDuplicateGap && cleanGapQuery) {
          gapsForResolver.push({
            query: cleanGapQuery,
            candidates
          });
        }
      }
      if (visionScoutItems && visionScoutItems.length > 0) {
        for (const scoutItem of visionScoutItems) {
          const dishName = scoutItem.originalName || scoutItem.keyword || scoutItem.name;
          if (dishName && (!scoutItem.components || scoutItem.components.length < 2)) {
            const dishHit = await resolveDishCache(dishName);
            if (dishHit) {
              const virtualId = `dish_cache_${dishHit.dish_key}`;
              dbMatchMap.set(virtualId, dishHit.core_nutrients);
              databaseMatchesArray.push({
                id: virtualId,
                source: 'internal_dish_cache',
                searchQuery: dishName,
                name: dishHit.display_name || dishName,
                servingGrams: dishHit.serving_grams || 100,
                calories: String(dishHit.core_nutrients.calories || 0),
                protein: dishHit.core_nutrients.protein || 0,
                fat: dishHit.core_nutrients.totalFat || dishHit.core_nutrients.fat || 0,
                saturatedFat: dishHit.core_nutrients.saturatedFat || 0,
                sodium: dishHit.core_nutrients.sodium || 0,
                carbohydrates: dishHit.core_nutrients.carbohydrates || dishHit.core_nutrients.carbs || 0,
                totalFibre: dishHit.core_nutrients.totalFibre || 0,
                nutrients: dishHit.core_nutrients
              });
              addDebugLog(`[Dish Cache Hit] Resolved dish "${dishName}" from dish_cache.`);
            }
          }
        }
      }
      if (gapsForResolver.length > 0) {
        sendLog('status', 'food_resolver', `Dispatched Food Resolver agent for ${gapsForResolver.length} gap items.`);
        const callLLMFn = async (prompt: string, sysInst: string) => {
          return await callUnifiedLLM({
            modelId: engine || "gemini-3.5-flash-lite",
            systemInstruction: sysInst,
            promptText: prompt,
            logStagePrefix: 'food_resolver',
            temperature: 0.1,
          });
        };
        const fetchFoodDetailsForFdcId = async (fdcId: string): Promise<{ title: string, nutrients: Record<string, number> } | null> => {
          if (dbMatchMap.has(fdcId)) {
            const data = dbMatchMap.get(fdcId);
            return data ? { title: data.name || data.description || data.searchQuery || '', nutrients: data } : null;
          }
          if (/^\d+$/.test(fdcId)) {
            const food = await fetchUSDAFoodById(fdcId);
            if (food) return { title: food.description || '', nutrients: extractUSDANutrientsPer100g(food) };
            if (/^\d{6,}$/.test(fdcId)) {
              const prod = await fetchOFFProductByBarcode(fdcId);
              if (prod) return { title: prod.product_name || '', nutrients: extractOFFNutrientsPer100g(prod) };
            }
          }
          return null;
        };
        const fetchNutrientsForFdcId = async (fdcId: string): Promise<Record<string, number> | null> => {
          if (dbMatchMap.has(fdcId)) {
            return dbMatchMap.get(fdcId) || null;
          }
          if (/^\d+$/.test(fdcId)) {
            const food = await fetchUSDAFoodById(fdcId);
            if (food) return extractUSDANutrientsPer100g(food);
            if (/^\d{6,}$/.test(fdcId)) {
              const prod = await fetchOFFProductByBarcode(fdcId);
              if (prod) return extractOFFNutrientsPer100g(prod);
            }
          }
          return null;
        };
        const resolvedGaps = await executeFoodResolverCurator(
          gapsForResolver,
          addDebugLog,
          callLLMFn,
          fetchNutrientsForFdcId,
          searchUSDA,
          fetchFoodDetailsForFdcId
        );
        // For each resolved item, add it to databaseMatchesArray & dbMatchMap
        resolvedGaps.forEach(rg => {
          if (Array.isArray(rg.quarantinedIds)) {
            rg.quarantinedIds.forEach(id => {
              if (id) {
                const idStr = String(id);
                if (idStr.startsWith('brand_menu_') || idStr.startsWith('internal_')) {
                  addDebugLog(`[Quarantine Guard] Ignored global quarantine for catalog/brand ID ${idStr}`);
                  return;
                }
                if (!quarantinedIdsSet.has(idStr)) {
                  quarantinedIdsSet.add(idStr);
                  addDebugLog(`[Quarantine Sync] Added FDC ID ${idStr} to quarantinedIdsSet from curator.`);
                }
              }
            });
          }
          if (rg.nutrientsPer100g) {
            const virtualId = rg.chosenFdcId ? String(rg.chosenFdcId) : `resolver_${normalizeFoodKey(rg.query)}`;
            if (quarantinedIdsSet.has(virtualId)) {
              addDebugLog(`[Quarantine Block] Refusing to inject nutrients for quarantined FDC ID ${virtualId} ("${rg.query}").`);
              return;
            }
            dbMatchMap.set(virtualId, rg.nutrientsPer100g);
            const caloriesStr = String(rg.nutrientsPer100g.calories || 0);
            databaseMatchesArray.push({
              id: virtualId,
              source: rg.chosenFdcId ? (rg.chosenFdcId.match(/^\d{8,}$/) ? "off" : "usda") : "estimated",
              searchQuery: rg.query,
              name: rg.query,
              servingGrams: 100,
              calories: caloriesStr,
              protein: rg.nutrientsPer100g.protein || 0,
              fat: rg.nutrientsPer100g.totalFat || rg.nutrientsPer100g.fat || 0,
              saturatedFat: rg.nutrientsPer100g.saturatedFat || 0,
              sodium: rg.nutrientsPer100g.sodium || 0,
              carbohydrates: rg.nutrientsPer100g.carbohydrates || rg.nutrientsPer100g.carbs || 0,
              totalFibre: rg.nutrientsPer100g.totalFibre || rg.nutrientsPer100g.fiber || 0,
              nutrients: rg.nutrientsPer100g
            });
            addDebugLog(`[Food Resolver Integration] Injected resolved nutrients for "${rg.query}" into databaseMatchesArray: ${JSON.stringify(rg.nutrientsPer100g)}`);
          }
        });
        // Trigger self-cleaning pass on brand database during Food Resolver review
        try {
          const { supabaseAdmin } = await import('./supabaseAdmin.js');
          if (supabaseAdmin) {
            const cleanResult = await selfCleanBrandDatabase(supabaseAdmin, 'GB', addDebugLog);
            if (cleanResult.removedUnofficialCount > 0 || cleanResult.deletedDuplicatesCount > 0) {
              sendLog('status', 'food_resolver', `Self-healing database pass: Purged ${cleanResult.removedUnofficialCount} non-branded/unofficial item(s) and ${cleanResult.deletedDuplicatesCount} duplicate(s).`);
            }
          }
        } catch (cleanErr: any) {
          addDebugLog(`[Food Resolver Self-Clean] Background cleaning notice: ${cleanErr?.message || cleanErr}`);
        }
        // Record deferred gaps & category fallbacks for queries that couldn't be resolved from candidates
        const resolvedQuerySet = new Set(resolvedGaps.filter(rg => rg.nutrientsPer100g).map(rg => normalizeFoodKey(rg.query)));
        uniqueQueries.forEach(query => {
          const normQ = normalizeFoodKey(query);
          if (resolvedQuerySet.has(normQ)) return;
          const qLower = String(query || '').toLowerCase().trim();
          if (qLower && labelCompleteQueries.has(qLower)) {
            addDebugLog(`[Food Resolver Fallback] skip category fallback; printed label covers "${query}"`);
            return;
          }
          const already = databaseMatchesArray.some((m: any) =>
            normalizeFoodKey(m.searchQuery || '') === normQ &&
            m.source !== 'category_fallback' &&
            !String(m.id || '').startsWith('fallback_')
          );
          if (already) {
            addDebugLog(`[Food Resolver Fallback] skip category fallback; non-fallback match exists for "${query}"`);
            return;
          }
          const fallbackProfile = getFallbackCategoryProfile(query);
            const virtualId = `fallback_${normQ}`;
            dbMatchMap.set(virtualId, fallbackProfile);
            databaseMatchesArray.push({
              id: virtualId,
              source: "category_fallback",
              searchQuery: query,
              name: `Estimated: ${query} (category fallback)`,
              servingGrams: 100,
              calories: String(fallbackProfile.calories || 0),
              protein: fallbackProfile.protein || 0,
              fat: fallbackProfile.totalFat || 0,
              saturatedFat: fallbackProfile.saturatedFat || 0,
              sodium: fallbackProfile.sodium || 0,
              carbohydrates: fallbackProfile.carbohydrates || 0,
              totalFibre: fallbackProfile.totalFibre || 0,
              nutrients: fallbackProfile
            });
            recordFoodObservation({
              event_type: 'deferred_gap',
              payload: { query, fallbackProfile }
            });
            upsertFoodItemCandidate({
              food_id: virtualId,
              food_key: normQ,
              display_name: query,
              nutrients_per_100g: fallbackProfile,
              status: 'category_fallback',
              provenance: 'category_fallback'
            }).catch(err => console.warn('[FallbackPersist] Error saving fallback item:', err));
            upsertFoodAlias({
              alias_key: normQ,
              food_id: virtualId,
              source: 'category_fallback'
            }).catch(err => console.warn('[FallbackPersist] Error saving fallback alias:', err));
            addDebugLog(`[Food Resolver Fallback] Created category fallback for gap "${query}": ${JSON.stringify(fallbackProfile)}`);
        });
      }
    }
    // Enrich scout items & sub-components with resolved brand / database matches before portion clarification
    enrichScoutComponentsWithMatches(visionScoutItems, databaseMatchesArray);
    // Task 2: portionClarify check — now placed AFTER DB search and Resolver so ALL candidates are available.
    // B1 — Pause before nutrient calculation when multi-serve pack portion is ambiguous.
    // Resume path: skipScout + activeScoutItems + portionChoices + resolvedDbCandidates (no second scout/DB).
    const portionClarify =
      !req.body.portionChoices &&
      !req.body.skipPortionClarify &&
      !isWeightModification &&
      !compareOnly &&
      !isExplicitModify &&
      visionScoutRanAndReturnedItems
        ? buildPortionClarifyPayload(visionScoutItems)
        : null;
    if (portionClarify) {
      addDebugLog(
        `[PortionClarify] Pausing for user input on: ${portionClarify.items.map((i) => i.name).join('; ')}`
      );
      // Carry the resolved DB candidates so turn 2 does not re-run DB search from empty.
      // Filter to the meal-relevant candidates only (those belonging to the current scout items
      // or the detected chain brand), capped at 60 to keep the payload manageable.
      const clarifyItemQueries = new Set(visionScoutItems.map((it: any) => String(it.originalName || it.keyword || '').toLowerCase()));
      const resolvedDbCandidates = databaseMatchesArray.filter((c: any) => {
        const cQuery = String(c.searchQuery || c.name || '').toLowerCase();
        return clarifyItemQueries.has(cQuery) ||
          (detectedChainKey && String(c.chainName || '').toLowerCase().includes(detectedChainKey)) ||
          c.source === 'brand_official' ||
          c.source === 'internal_catalog';
      }).slice(0, 60);
      addDebugLog(`[PortionClarify] Embedding ${resolvedDbCandidates.length} pre-resolved DB candidates for turn-2 carry-forward.`);
      sendStreamEvent({
        type: 'status',
        stage: 'portion_clarify',
        status: 'awaiting_user',
        message: portionClarify.promptMessage,
      });
      sendLog(
        'status',
        'scout',
        `[PortionClarify] ${portionClarify.promptMessage}`
      );
      if (isStream && hasSentHeaders) {
        sendStreamEvent({
          type: 'done',
          final: true,
          result: {
            needsPortionClarify: true,
            mode: 'portion_clarify',
            message: portionClarify.promptMessage,
            text: portionClarify.promptMessage,
            scoutItems: visionScoutItems,
            portionClarify,
            resolvedDbCandidates,
            agentResult: {
              scoutItems: visionScoutItems,
              activeStage: 'portion_clarify',
            },
          }
        });
        res.end();
        return;
      }
      return res.json({
        needsPortionClarify: true,
        mode: 'portion_clarify',
        message: portionClarify.promptMessage,
        text: portionClarify.promptMessage,
        scoutItems: visionScoutItems,
        portionClarify,
        resolvedDbCandidates,
        agentResult: {
          scoutItems: visionScoutItems,
          activeStage: 'portion_clarify',
        },
      });
    }
    // Brand Environment Locking logic
    const globalBrands = ["mcdonald", "burger king", "wendy", "kfc", "denny", "starbucks", "subway", "taco bell", "domino", "pizza hut", "chipotle", "panera", "dunkin", "sonic", "popeyes", "arby", "dairy queen", "panda express"];
    let dominantBrand = "";
    const allContextText = (message + " " + JSON.stringify(visionScoutItems)).toLowerCase();
    for (const b of globalBrands) {
      if (allContextText.includes(b) || allContextText.includes(b.replace(/\s+/g, ""))) {
         dominantBrand = b;
         addDebugLog(`[Environment Locking] Detected dominant brand "${b}" in scene context. Restricting matching hierarchy.`);
         break;
      }
    }
    // Verified Scout FDC hint pre-fetch: for components where Vision Scout supplied a
    // suggestedFdcId (only expected for well-known, unambiguous staple foods), do a
    // direct single-ID USDA lookup and validate it with the same relevance check used
    // by the final safety-net gate further below, BEFORE the main per-item loop runs.
    // This keeps the existing synchronous component-matching loop completely untouched
    // (no forEach->for-of conversion, no async/await inside it). Hints that fail to
    // resolve or fail the relevance check are silently dropped — the component falls
    // through to today's normal search pipeline exactly as if no hint had been given.
    const verifiedFdcHintMap = new Map<string, any>();
    {
      const hintFetchTasks: Array<{ key: string; fdcId: string; query: string }> = [];
      visionScoutItems.forEach((item: any, itemIdx: number) => {
        (item.components || []).forEach((comp: any, cIdx: number) => {
          const hintId = comp.suggestedFdcId;
          if (hintId && String(hintId).trim()) {
            const q = comp.searchQuery || comp.name || comp.keyword || "";
            hintFetchTasks.push({ key: `${itemIdx}:${cIdx}`, fdcId: String(hintId).trim(), query: q });
          }
        });
      });
      if (hintFetchTasks.length > 0) {
        const hintResults = await Promise.all(hintFetchTasks.map(async (task) => {
          const food = await fetchUSDAFoodById(task.fdcId);
          return { task, food };
        }));
        hintResults.forEach(({ task, food }) => {
          if (!food || !food.description) {
            addDebugLog(`[ScoutFdcHint] id=${task.fdcId} for query "${task.query}" did not resolve — falling through to normal search.`);
            return;
          }
          // Same relevance check as the final safety-net gate below (Task 1 stopword list).
          const hintStopwords = new Set(['cheese', 'canned', 'sauce', 'sauces', 'salad', 'dressing', 'cream', 'sliced', 'chopped', 'mixed', 'fresh', 'cooked', 'raw', 'shredded', 'grated', 'diced', 'whole', 'baked', 'fried', 'roasted', 'steamed', 'boiled', 'grilled', 'style', 'flavored', 'flavoured', 'plain', 'organic', 'natural', 'sweet', 'spicy', 'crushed', 'minced', 'topping', 'toppings', 'spread', 'filling', 'blend', 'garnish', 'crumbs', 'chunks', 'pieces', 'with', 'and', 'leaf', 'leaves', 'seed', 'seeds', 'green']);
          const qTokens = String(task.query).toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter((t: string) => t.length > 3 && !hintStopwords.has(t));
          const fNameLow = String(food.description || '').toLowerCase();
          const relevant = qTokens.length === 0 || qTokens.some((t: string) => fNameLow.includes(t));
          if (!relevant) {
            addDebugLog(`[ScoutFdcHint] Relevance check rejected hint id=${task.fdcId} ("${food.description}") for query "${task.query}" — falling through to normal search.`);
            return;
          }
          const fdcIdStr = String(food.fdcId || task.fdcId);
          const nutrients100g = extractUSDANutrientsPer100g(food);
          dbMatchMap.set(fdcIdStr, nutrients100g);
          const verifiedHit = {
            id: fdcIdStr,
            source: "usda_direct_hint",
            name: food.description || "",
            calories: String(nutrients100g.calories || 0),
            protein: nutrients100g.protein,
            fat: nutrients100g.totalFat,
            saturatedFat: nutrients100g.saturatedFat,
            sodium: nutrients100g.sodium
          };
          databaseMatchesArray.push(verifiedHit);
          verifiedFdcHintMap.set(task.key, verifiedHit);
          addDebugLog(`[ScoutFdcHint] Verified hint id=${fdcIdStr} ("${food.description}") accepted for query "${task.query}".`);
        });
      }
    }
    { // F-8.9 always finalize (old aggregation host deleted)
      const ledgers = await Promise.all(
        visionScoutItems.map(async (vItem: any, vIdx: number) => {
          if (vItem._alreadyFinalized && vItem.nutrients) {
            addDebugLog(`[Single-Path] Reusing saved ledger for "${vItem.originalName || vItem.keyword}" (untouched, not re-finalized).`);
            return {
              scoutIndex: vItem.scoutIndex ?? vIdx,
              originalName: vItem.originalName || vItem.keyword,
              keyword: vItem.keyword,
              weightGrams: vItem.estimatedWeightGrams || vItem.weightGrams,
              nutrients: vItem.nutrients,
              lockedNutrientKeys: vItem.lockedNutrientKeys || [],
              dbSource: vItem.dbSource || 'estimated',
              dbId: vItem.dbId || null,
              boundingBox2D: vItem.boundingBox2D || null,
              sourceImageIndex: vItem.sourceImageIndex,
              components: vItem.components,
              componentsDetailList: vItem.componentsDetailList || vItem.components || [],
              hasComponents: Boolean(vItem.componentsDetailList && vItem.componentsDetailList.length > 1),
              ingredientsList: vItem.ingredientsList || null,
              visualIngredients: vItem.visualIngredients || null,
              dishClass: vItem.foodType || vItem.dishClass || 'composed',
              brandLock: vItem.brandLock || null,
              atwaterFlag: vItem.atwaterFlag || null,
              ingredients: vItem.ingredients || [],
            };
          }
          return finalizeDishLedger({
            item: { ...vItem, scoutIndex: vItem.scoutIndex ?? vIdx },
            nutrientBasisWeight: vItem.nutrientBasisWeight || vItem.estimatedWeightGrams,
            consumedWeight: vItem.estimatedWeightGrams,
          });
        })
      );
      preCalculatedItems = ledgers.map((l) => {
        addDebugLog(`[Budget] Finalized ledger for "${l.originalName}": ${l.nutrients.calories} kcal (${l.weightGrams}g, source=${l.dbSource})`);
        const vItem = visionScoutItems[l.scoutIndex] || {};
        const comps = l.componentsDetailList || l.components || vItem.componentsDetailList || vItem.components || vItem.compositeSiblings || [];
        return {
          scoutIndex: l.scoutIndex,
          originalName: l.originalName,
          keyword: l.keyword || l.originalName,
          foodType: l.dishClass,
          estimatedWeightGrams: l.weightGrams,
          portionMultiplier: 1.0,
          nutrients: l.nutrients,
          nutrients100g: {},
          lockedNutrientKeys: l.lockedNutrientKeys,
          rawNutritionLabel: (l.dbSource === 'label' ? l.nutrients : vItem.rawNutritionLabel) || null,
          labelNutrientsPerServing: l.brandLock ? l.brandLock.valuesAtBasis : (vItem.labelNutrientsPerServing || null),
          brandLock: l.brandLock,
          dbSource: l.dbSource,
          dbId: l.dbId,
          atwaterFlag: l.atwaterFlag,
          ingredients: l.ingredients,
          visualIngredients: l.visualIngredients,
          ingredientsList: l.ingredientsList || (l.ingredients.length > 0 ? l.ingredients.join(', ') : null),
          boundingBox2D: vItem.boundingBox2D || null,
          sourceImageIndex: vItem.sourceImageIndex ?? 0,
          components: comps.length > 0 ? comps : null,
          componentsDetailList: comps.length > 0 ? comps : [],
          compositeSiblings: comps.length > 0 ? comps : [],
          hasComponents: Boolean(l.hasComponents || comps.length > 1),
        };
      });
      if (isModifySession && preCalculatedItems && preCalculatedItems.length > 0) {
        preCalculatedItems.forEach((pItem: any) => {
          const subComponents: any[] = (pItem.componentsDetailList && pItem.componentsDetailList.length > 0)
            ? pItem.componentsDetailList
            : (pItem.components && pItem.components.length > 0 ? pItem.components : []);
          if (subComponents.length > 1) {
            // Composite dish: try the modifier against each individual sub-ingredient
            // (e.g. "the tea was unsweetened" must target the "Sweet Iced Tea" component,
            // never the whole parent dish name it happens to be embedded in).
            let anySubComponentChanged = false;
            subComponents.forEach((sub: any) => {
              const subNutrients = sub.nutrients || sub;
              const modRes = applyNutrientModifiers(subNutrients, {
                message,
                foodType: sub.foodType || null,
                name: sub.name || sub.searchQuery || sub.keyword || '',
              });
              if (modRes.lockedKeys.length > 0) {
                anySubComponentChanged = true;
                sub.nutrients = { ...(sub.nutrients || {}), ...modRes.updatedNutrients };
                // Row-builder for the nutrition table reads top-level fields, not nested
                // .nutrients — mirror the updated values onto the flattened component too.
                sub.calories = modRes.updatedNutrients.calories;
                sub.sugar = modRes.updatedNutrients.sugar;
                sub.addedSugar = modRes.updatedNutrients.addedSugar;
                sub.carbohydrates = modRes.updatedNutrients.carbohydrates;
                sub.carbs = modRes.updatedNutrients.carbohydrates;
                addDebugLog(`[Nutrient Modifier Matrix] Applied modifiers to sub-component "${sub.name}" inside "${pItem.originalName}": locked keys [${modRes.lockedKeys.join(', ')}]`);
              }
            });
            if (anySubComponentChanged && pItem.nutrients) {
              // Re-sum parent dish totals from the (possibly modified) sub-components so
              // the dish-level total reflects the edited ingredient instead of staying frozen.
              const sumCal = subComponents.reduce((acc, c) => acc + (Number(c.calories) || 0), 0);
              const sumCarbs = subComponents.reduce((acc, c) => acc + (Number(c.carbohydrates ?? c.carbs) || 0), 0);
              const sumSugar = subComponents.reduce((acc, c) => acc + (Number(c.sugar ?? c.nutrients?.sugar) || 0), 0);
              const sumAddedSugar = subComponents.reduce((acc, c) => acc + (Number(c.addedSugar ?? c.nutrients?.addedSugar) || 0), 0);
              pItem.nutrients.calories = Math.round(sumCal);
              pItem.nutrients.carbohydrates = Math.round(sumCarbs * 10) / 10;
              pItem.nutrients.sugar = Math.round(sumSugar * 10) / 10;
              pItem.nutrients.addedSugar = Math.round(sumAddedSugar * 10) / 10;
              pItem.lockedNutrientKeys = Array.from(new Set([...(pItem.lockedNutrientKeys || []), 'calories', 'carbohydrates', 'sugar', 'addedSugar']));
              pItem.componentsDetailList = subComponents;
              pItem.components = subComponents;
              pItem.compositeSiblings = subComponents;
            }
          } else if (pItem.nutrients) {
            // Single-food item (no sub-components) — unchanged behavior from before.
            const modRes = applyNutrientModifiers(pItem.nutrients, {
              message,
              foodType: pItem.foodType,
              name: pItem.originalName || pItem.keyword,
            });
            pItem.nutrients = modRes.updatedNutrients;
            if (modRes.lockedKeys.length > 0) {
              pItem.lockedNutrientKeys = Array.from(new Set([...(pItem.lockedNutrientKeys || []), ...modRes.lockedKeys]));
              addDebugLog(`[Nutrient Modifier Matrix] Applied modifiers to "${pItem.originalName}": locked keys [${modRes.lockedKeys.join(', ')}]`);
            }
          }
        });
      }
    }
    let preCalculatedCtx = "";
    if (preCalculatedItems.length > 0) {
      const mealTotals = preCalculatedItems.reduce((acc: any, it: any) => {
        const n = it.nutrients || {};
        NUTRIENT_KEYS.forEach(k => {
          acc[k] = (acc[k] || 0) + (Number(n[k]) || 0);
        });
        acc.weightGrams = (acc.weightGrams || 0) + (Number(it.estimatedWeightGrams) || 0);
        return acc;
      }, { weightGrams: 0 });
      preCalculatedCtx = "=== BACKEND PRE-CALCULATED AUTHORITATIVE MEAL TOTALS (33-Nutrient Ledger) ===\n" +
        `Total Weight: ${Math.round(mealTotals.weightGrams || 0)}g | Calories: ${Math.round(mealTotals.calories || 0)} kcal | Protein: ${Math.round((mealTotals.protein || 0) * 10) / 10}g | Total Fat: ${Math.round((mealTotals.totalFat || 0) * 10) / 10}g (Sat Fat: ${Math.round((mealTotals.saturatedFat || 0) * 10) / 10}g, Trans Fat: ${Math.round((mealTotals.transFat || 0) * 10) / 10}g) | Carbs: ${Math.round((mealTotals.carbohydrates || 0) * 10) / 10}g (Fiber: ${Math.round(((mealTotals.totalFibre ?? mealTotals.fiber) || 0) * 10) / 10}g, Sugar: ${Math.round((mealTotals.sugar || 0) * 10) / 10}g, Added Sugar: ${Math.round((mealTotals.addedSugar || 0) * 10) / 10}g) | Sodium: ${Math.round(mealTotals.sodium || 0)}mg | Potassium: ${Math.round(mealTotals.potassium || 0)}mg | Calcium: ${Math.round(mealTotals.calcium || 0)}mg | Iron: ${Math.round((mealTotals.iron || 0) * 10) / 10}mg | Cholesterol: ${Math.round(mealTotals.cholesterol || 0)}mg\n\n` +
        "=== BACKEND PRE-CALCULATED ITEM NUTRIENTS (Authoritative Item Breakdown) ===\n" +
        preCalculatedItems.map(item => {
          const n = item.nutrients || {};
          let itemStr = `- "${item.originalName}" (${item.estimatedWeightGrams}g):\n` +
            `  Calories: ${Math.round(n.calories || 0)} kcal\n` +
            `  Protein: ${n.protein || 0}g\n` +
            `  Fat: ${n.totalFat || 0}g (Saturated: ${n.saturatedFat || 0}g)\n` +
            `  Carbs: ${n.carbohydrates || 0}g (Sugar: ${n.sugar || 0}g, Added Sugar: ${n.addedSugar || 0}g)\n` +
            `  Sodium: ${n.sodium || 0}mg\n`;
          if (Array.isArray(item.componentsDetailList) && item.componentsDetailList.length > 0) {
            const hasZeroCalLock = (item.lockedNutrientKeys || []).includes('calories') && (n.calories === 0);
            itemStr += `  Constituent Ingredients Breakdown:\n` +
              item.componentsDetailList.map((c: any) => {
                const cal = hasZeroCalLock ? 0 : (c.calories || 0);
                const carbs = hasZeroCalLock ? 0 : (c.carbohydrates || c.carbs || 0);
                return `    * ${c.name} (${c.weightGrams}g): ${cal} kcal, ${c.protein || 0}g protein, ${c.totalFat || c.fat || 0}g fat, ${carbs}g carbs`;
              }).join('\n') + '\n';
          }
          return itemStr;
        }).join("\n") + "\n\n";
    }
    const userCtx = buildUserContext(userProfile);
    const timeCtx = buildTimeContext({ timezone: req.body.timezone, activeMealDate: activeMeal?.date, hasImageDates: Boolean(imageDates && imageDates.length > 0), message });
    const imageCtx = buildImageContext(imagePayloads, imageDates);
    let historyContext = buildHistoryContext(history);
    const pastMealsCtx = buildPastMealsContext(foodLogs, addDebugLog);
    // 2. Prepend active state to Master System Instructions
    let effectiveActiveMeal = activeMeal;
    const hasUploadedNewImages = imagePayloads && imagePayloads.length > 0;
    // B5: do not wipe active meal when this modal already owns a document.
    if (
      !hasActiveMealDocument &&
      !isWeightModification &&
      ((scoutRecommendedMode === "new_log" && !isExplicitModify && !userExplicitlySelectedEditMode) ||
        (hasUploadedNewImages && !isExplicitModify && !userExplicitlySelectedEditMode))
    ) {
      addDebugLog(`[State Isolation] First submit in this modal. Isolating leftover activeMeal context so Dietitian operates on clean state.`);
      effectiveActiveMeal = null;
      historyContext = "";
    } else if (hasActiveMealDocument) {
      addDebugLog(`[Single-Path] Same modal — keeping meal ${activeMeal?.id || '(unnamed)'} for edit/Q&A/photo-merge.`);
    }
    if (visionScoutItems && visionScoutItems.length > 0) {
      visionScoutItems = visionScoutItems.filter((item: any) => {
        const rawName = (item.keyword || item.originalName || item.name || "").trim().toLowerCase();
        return rawName && rawName !== "unspecified item" && rawName !== "unspecified";
      }).map((item: any) => ({
        ...item,
        name: item.keyword || item.originalName || item.name || "Food Item",
        keyword: item.keyword || item.originalName || item.name || "Food Item"
      }));
    }
    if (effectiveActiveMeal) {
      effectiveActiveMeal = JSON.parse(JSON.stringify(effectiveActiveMeal));
      if (effectiveActiveMeal.itemsBreakdown && Array.isArray(effectiveActiveMeal.itemsBreakdown)) {
        effectiveActiveMeal.itemsBreakdown = effectiveActiveMeal.itemsBreakdown
          .filter((it: any) => {
            const rawName = (it.canonicalDbName || it.originalName || it.keyword || it.name || "").trim().toLowerCase();
            return rawName && rawName !== "unspecified item" && rawName !== "unspecified";
          })
          .map((it: any) => ({
            ...it,
            canonicalDbName: it.keyword || it.originalName || it.canonicalDbName || it.name || "Food Item"
          }));
      }
      if (effectiveActiveMeal.items && Array.isArray(effectiveActiveMeal.items)) {
        effectiveActiveMeal.items = effectiveActiveMeal.items
          .filter((it: any) => {
            const rawName = (it.keyword || it.originalName || it.name || "").trim().toLowerCase();
            return rawName && rawName !== "unspecified item" && rawName !== "unspecified";
          })
          .map((it: any) => ({
            ...it,
            name: it.keyword || it.originalName || it.name || "Food Item"
          }));
      }
    }
    let systemInstruction = "";
    const activeMealState = activeMeal || req.body.activeMealState || null;
    const activeComparisonState = activeComparison || req.body.activeComparisonState || null;
    if (userSelectedMode === 'review' || userSelectedMode === 'edit') {
      if (isExplicitModify || effectiveActiveMeal !== null) {
        systemInstruction = buildModeAEditInstruction({ biomarkersNeedingImprovement, remainingAllowance, activeMeal: effectiveActiveMeal, foodLogs, userProfile });
      } else {
        systemInstruction = buildModeAReviewInstruction({ biomarkersNeedingImprovement, remainingAllowance, foodLogs, userProfile });
      }
    } else if (userSelectedMode === 'compare') {
      if (activeComparisonState !== null) {
        systemInstruction = buildModeDEditInstruction({ biomarkersNeedingImprovement, remainingAllowance, activeComparison: activeComparisonState, foodLogs, userProfile });
      } else {
        systemInstruction = buildModeDCompareInstruction({ biomarkersNeedingImprovement, remainingAllowance, foodLogs, userProfile });
      }
    } else {
      systemInstruction = buildFoodAnalyzeInstruction({
        biomarkersNeedingImprovement,
        remainingAllowance,
        activeMeal: effectiveActiveMeal,
        compareItemCount: userSelectedMode === 'review' ? 0 : (visionScoutItems ? visionScoutItems.length : 0),
        forceModifyMode: isExplicitModify,
        foodLogs,
        userProfile
      });
    }
    // Suppress Scout payload during text-only edits to conserve tokens
    const visionScoutCtx = buildVisionScoutContext({ visionScoutItems, visionScoutContentType, scoutConfidenceRating, scoutConfidenceComment, scoutCookingMethod, diningEnvironment, userSelectedMode, isExplicitModify, hasActiveMeal: effectiveActiveMeal !== null, hasComparison: activeComparisonState !== null, hasImages: Boolean(imagePayloads && imagePayloads.length) });
    const databaseMatchesCtx = buildDatabaseMatchesContext(preCalculatedCtx, databaseMatches);
    const biomarkersCtx = buildBiomarkersContext(biomarkersNeedingImprovement);
    const stitchedPrompt = stitchFoodPrompt({ customSystemInstruction, systemInstruction, userSelectedMode, customVariableData, biomarkersCtx, visionScoutCtx, databaseMatchesCtx, historyContext, pastMealsCtx, userCtx, timeCtx, imageCtx, message });
    const finalSystemInstruction = stitchedPrompt.finalSystemInstruction;
    let promptText = stitchedPrompt.promptText;
    fullPromptSent = stitchedPrompt.fullPromptSent;
    addDebugLog(`[Dietitian Coach] Sending nutrition analysis request to Gemini...`);
    async function callAndParseFoodAnalysis(callArgs: any): Promise<{ textOutput: string; rawParsed: any }> {
      if (isStream) {
        callArgs.onStream = (chunk: string, isThought?: boolean) => {
          try {
            if (isThought) {
              res.write(`data: ${JSON.stringify({ type: 'stream', thought: chunk, stage: 'dietitian' })}\n\n`);
            } else {
              res.write(`data: ${JSON.stringify({ type: 'stream', chunk, stage: 'dietitian' })}\n\n`);
            }
            if (typeof (res as any).flush === 'function') (res as any).flush();
          } catch (e) {}
        };
      }
      const textOutput = await callUnifiedLLM(callArgs);
      const { cleanJson, extractedScratchpad } = sanitizeLlmJsonOutput(textOutput);
      let rawParsed;
      try {
        rawParsed = await asyncParseLLMJSON(cleanJson);
        rawParsed = validateOrFallback(RouteAgentSchema, rawParsed, cleanJson, "RouteAgent", {
          _internalReasoning: "",
          verdict: { label: t(userProfile?.language, 'verdictSupportsMetabolicEnergy'), level: "neutral" },
          message: t(userProfile?.language, 'fallbackAnalyzedLog'),
          foodData: { date: new Date().toISOString().split('T')[0], name: "Meal", itemsBreakdown: [] }
        });
        if (!rawParsed._internalReasoning && extractedScratchpad) {
          rawParsed._internalReasoning = extractedScratchpad;
        }
      } catch (parseErr: any) {
        addDebugLog(`[JSON Parse Error] JSON parse failed: ${parseErr.message}. Attempting robust truncation repair...`);
        try {
          let repaired = cleanJson.trim();
          // 1. Remove trailing comma followed by a half-written key
          repaired = repaired.replace(/,\s*"[^"]*"?\s*$/, "");
          // 2. Handle unescaped double quotes inside an unclosed string
          let quoteCount = 0;
          for (let idx = 0; idx < repaired.length; idx++) {
            if (repaired[idx] === '"' && (idx === 0 || repaired[idx - 1] !== '\\')) {
              quoteCount++;
            }
          }
          if (quoteCount % 2 !== 0) {
            repaired += '"';
          }
          // 3. Remove trailing comma or colon
          if (repaired.endsWith(",")) {
            repaired = repaired.slice(0, -1).trim();
          } else if (repaired.endsWith(":")) {
            repaired += "null";
          }
          // 4. Count open braces and brackets outside strings
          let openBraces = 0;
          let openBrackets = 0;
          let insideStr = false;
          for (let i = 0; i < repaired.length; i++) {
            const char = repaired[i];
            if (char === '"' && (i === 0 || repaired[i - 1] !== '\\')) {
              insideStr = !insideStr;
            }
            if (!insideStr) {
              if (char === '{') openBraces++;
              else if (char === '}') openBraces--;
              else if (char === '[') openBrackets++;
              else if (char === ']') openBrackets--;
            }
          }
          repaired += ']'.repeat(Math.max(0, openBrackets)) + '}'.repeat(Math.max(0, openBraces));
          rawParsed = JSON.parse(repaired);
          if (!rawParsed._internalReasoning && extractedScratchpad) {
            rawParsed._internalReasoning = extractedScratchpad;
          }
          addDebugLog(`[JSON Parse Error] Robust truncation repair succeeded.`);
        } catch (repairErr: any) {
          addDebugLog(`[JSON Parse Error] Robust truncation repair also failed: ${repairErr.message}.`);
          throw parseErr;
        }
      }
      return { textOutput, rawParsed };
    }
    // Pre-dietitian density check: ensure beverage and composite items are rescaled prior to Dietitian prompt payload
    if (Array.isArray(preCalculatedItems)) {
      preCalculatedItems.forEach((it: any) => {
        if (!it || !it.weightGrams || !it.nutrients) return;
        const cals = Number(it.nutrients.calories || 0);
        const nameLower = String(it.name || it.keyword || '').toLowerCase();
        const isBeverage = BEVERAGE_RAW_PATTERN.test(nameLower) || nameLower.includes('latte') || nameLower.includes('coffee') || nameLower.includes('drink');
        if (isBeverage && it.weightGrams >= 150 && cals > 600) {
          const maxAllowedCals = Math.round((it.weightGrams / 100) * 110);
          const factor = maxAllowedCals / cals;
          addDebugLog(`[Pre-Dietitian Reality Check] Rescaling beverage item "${it.name}" from ${cals} kcal -> ${maxAllowedCals} kcal prior to Dietitian prompt payload.`);
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
    addDebugLog('[MealBuild] projector dietitian');
    let dietitianTempMeal = buildSavableMealFromParsed(preCalculatedItems || [], activeMeal, aggregatedNutrients, null);
    const lifeStart = beginStage(dietitianTempMeal, 'dietitian', { actor: 'server' });
    if (!lifeStart.allowed) {
      addDebugLog(`[MealBuild] stage-limits: ${lifeStart.limitReason}`);
    } else {
      addDebugLog('[MealBuild] stage dietitian started');
    }
    const dietitianProjection = projectDietitianInput(dietitianTempMeal, userProfile);
    const precalcBlock = formatDietitianProjectionBlock(dietitianProjection);
    addDebugLog('[MealBuild] projector dietitian applied');
    promptText = `${promptText}\n\n${precalcBlock}`;
    fullPromptSent = `${fullPromptSent}\n\n${precalcBlock}`;
    const llmCallArgs = {
      modelId: (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite", // Updating to flash-lite as recommended
      systemInstruction: finalSystemInstruction,
      promptText,
      imagePayloads: undefined, // Strip redundant image payloads: Dietitian Coach consumes structured JSON nutrition summary
      responseMimeType: "application/json" as const,
      responseSchema: foodAnalyzeSchema,
      maxOutputTokens: 8192, // Boosted to ensure all items fit
      skipThinking: true, // Scout already sets this; dietitian's schema also puts
      logStagePrefix: 'dietitian',
      // _internalReasoning first, which is where the live _internalReasoning text actually
      // comes from — so this does not remove the _internalReasoning. It removes the
      // separate native-thinking output stream, which combined with responseSchema
      // was suspected of causing the model to batch output instead of streaming it.
    };
    sendStreamEvent({ type: 'status', stage: 'dietitian', status: 'started', message: 'Analyzing nutrition payload...' });
    sendLog('dietitian_instruction', 'dietitian', `Dietitian System Instruction & Patient Biomarkers payload dispatched (model: ${engine || 'gemini-3.5-flash-lite'}).`);
    let textOutput: string = "";
    let rawParsed: any;
    const { canSkipDietitianForPureScale, isCreateSession, hasBarcode, hasReceipt, canSkipDietitianForCreate } = computeDietitianSkipGates({
      isPureWeightModification, activeMeal, userSelectedMode, weightRefineIntent, message,
      isModifySession, hasActiveMealDocument, visionScoutRanAndReturnedItems, preCalculatedItems,
      visionScoutItems, imagePayloads, visionScoutContentType, rawScoutData,
    });
    if (canSkipDietitianForPureScale && weightRefineIntent.isRefine && weightRefineIntent.weightGrams) {
      const targetWeight = weightRefineIntent.weightGrams;
      addDebugLog(`[Refine] skip-dietitian: Scaled label-locked meal directly to ${targetWeight}g without LLM call.`);
      sendStreamEvent({ type: 'status', stage: 'dietitian', status: 'completed', message: interpolate(t(userProfile?.language, 'statusScaledPortion'), { grams: targetWeight }) });
      textOutput = JSON.stringify({
        _internalReasoning: `[Refine] scale-only: Scaled meal directly to ${targetWeight}g`,
        verdict: { label: t(userProfile?.language, 'verdictPortionControl'), level: "neutral" },
        message: interpolate(t(userProfile?.language, 'messageScaledPortion'), { grams: targetWeight }),
        mode: "modify",
        modificationCommand: [
          {
            action: "update_weight",
            itemName: "total",
            newWeightGrams: targetWeight
          }
        ]
      });
      rawParsed = JSON.parse(textOutput);
    } else if (canSkipDietitianForCreate) {
      addDebugLog(`[MealAgent] Adaptive single-agent create: skipping Dietitian LLM for ${visionScoutItems.length} dish(es).`);
      sendStreamEvent({ type: 'status', stage: 'dietitian', status: 'completed', message: 'Meal analysis finalized.' });

      const mealName = rawScoutData?.mealName || rawScoutData?.name || (visionScoutItems.length === 1 ? (visionScoutItems[0].originalName || visionScoutItems[0].keyword) : t(userProfile?.language, 'balancedMealFallbackName'));
      
      const totalGrams = preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.estimatedWeightGrams) || 0), 0);
      const totalCals = preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.nutrients?.calories) || 0), 0);
      const totalP = preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.nutrients?.protein) || 0), 0);
      const totalC = preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.nutrients?.carbohydrates) || 0), 0);
      const totalF = preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.nutrients?.totalFat) || 0), 0);
      const totalSugar = preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.nutrients?.sugar ?? it.nutrients?.totalSugar ?? it.nutrients?.addedSugar) || 0), 0);
      const totalAddedSugar = preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.nutrients?.addedSugar) || 0), 0);
      const totalSatFat = preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.nutrients?.saturatedFat) || 0), 0);

      let scoutVerdict = rawScoutData?.verdict;
      if (!scoutVerdict || typeof scoutVerdict !== 'object' || !scoutVerdict.label) {
        if (totalSugar >= 30) {
          scoutVerdict = { label: t(userProfile?.language, 'verdictHighGlycemicSugar'), level: 'warning' };
        } else if (totalSatFat >= 15) {
          scoutVerdict = { label: t(userProfile?.language, 'verdictElevatedSatFat'), level: 'warning' };
        } else if (totalP >= 25) {
          scoutVerdict = { label: t(userProfile?.language, 'verdictLeanMuscle'), level: 'good' };
        } else if (/probiotic|fermented|yogurt|kefir|yakult/i.test(mealName)) {
          scoutVerdict = { label: t(userProfile?.language, 'verdictGutMicrobiome'), level: totalSugar >= 25 ? 'neutral' : 'good' };
        } else {
          scoutVerdict = { label: t(userProfile?.language, 'verdictSupportsMetabolicEnergy'), level: 'neutral' };
        }
      }

      let rawAdvice = rawScoutData?.clinicalAdvice || rawScoutData?.message;
      if (!rawAdvice || String(rawAdvice).trim().length === 0) {
        if (/probiotic|yakult|kefir|yogurt/i.test(mealName)) {
          rawAdvice = t(userProfile?.language, 'adviceProbioticSugar').replace('{grams}', String(Math.round(totalSugar)));
        } else if (totalP >= 20) {
          rawAdvice = t(userProfile?.language, 'adviceSolidProtein').replace('{grams}', String(Math.round(totalP)));
        } else if (totalSugar >= 30) {
          rawAdvice = t(userProfile?.language, 'adviceHighSugar').replace('{grams}', String(Math.round(totalSugar)));
        } else {
          rawAdvice = t(userProfile?.language, 'adviceLoggedBalanced').replace('{name}', String(mealName));
        }
      }

      const formattedMsg = reconcileMessageWithLedger(rawAdvice, {
        mealName,
        weightGrams: totalGrams,
        calories: Math.round(totalCals),
        protein: Math.round(totalP * 10) / 10,
        carbohydrates: Math.round(totalC * 10) / 10,
        totalFat: Math.round(totalF * 10) / 10,
      }, userProfile?.language);

      textOutput = JSON.stringify({
        _internalReasoning: scoutInternalReasoning || '[MealAgent] Single-agent create path',
        mode: 'new_log',
        message: formattedMsg,
        verdict: scoutVerdict,
        foodData: {
          name: mealName,
          weightGrams: String(totalGrams),
          cookingMethod: scoutCookingMethod || t(userProfile?.language, 'cookingMethodUnknown'),
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
      rawParsed = JSON.parse(textOutput);
    } else {
      let dietitianAttempts = 0;
      const maxDietitianAttempts = 3;
      let lastDietitianErr: any = null;
      while (dietitianAttempts < maxDietitianAttempts) {
        dietitianAttempts++;
        try {
          if (dietitianAttempts > 1) {
            const delay = lastDietitianErr?.message?.includes('503') || lastDietitianErr?.message?.includes('429') || lastDietitianErr?.message?.includes('UNAVAILABLE') ? 3000 : 1000;
            addDebugLog(`[Dietitian] Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            addDebugLog(`[Dietitian] Retrying LLM call (Attempt ${dietitianAttempts} of ${maxDietitianAttempts})...`);
          }
          const result = await callAndParseFoodAnalysis(llmCallArgs);
          textOutput = result.textOutput;
          rawParsed = result.rawParsed;
          break;
        } catch (err: any) {
          lastDietitianErr = err;
          const isAbort = err.name === 'AbortError' || (err.message && err.message.toLowerCase().includes('abort'));
          if (isAbort) {
            addDebugLog(`[Dietitian] Fatal error (Timeout) detected. Throwing immediately without retry.`);
            throw err;
          }
          addDebugLog(`[Dietitian Attempt ${dietitianAttempts} Failed] Error: ${err.message}`);
        }
      }
      if (!textOutput) {
        addDebugLog(`[Dietitian Failed Permanently] All attempts failed. Last error: ${lastDietitianErr?.message}`);
        throw lastDietitianErr;
      }
    }
    addDebugLog(`[Dietitian Coach] Received response from Gemini. Length: ${textOutput.length} chars.`);
    if (rawParsed._internalReasoning) {
      addDebugLog(`[Dietitian Internal Reasoning]\n${rawParsed._internalReasoning}`);
    }
    const dietitianScratchpad = rawParsed?._internalReasoning || "";
    sendStreamEvent({ type: 'status', stage: 'dietitian', status: 'completed', message: 'Dietitian evaluation completed.' });
    if (rawParsed && typeof rawParsed === 'object') {
      if (isExplicitModify) {
        rawParsed.mode = 'modify';
      }
      if (userSelectedMode === 'review') {
        if (!rawParsed.mode || rawParsed.mode !== 'modify') rawParsed.mode = isExplicitModify ? 'modify' : 'new_log';
        rawParsed.comparison = null; // Guaranteed 100% clean review card rendering
      } else if (userSelectedMode === 'compare') {
        rawParsed.mode = 'evaluation';
        const existingFd = rawParsed.foodData && typeof rawParsed.foodData === 'object' ? rawParsed.foodData : {};
        const breakdown = Array.isArray(existingFd.itemsBreakdown) && existingFd.itemsBreakdown.length
          ? existingFd.itemsBreakdown
          : (visionScoutItems || []).map((s: any, idx: number) => ({
              name: s.originalName || s.keyword || `item ${idx + 1}`,
              originalName: s.originalName || s.keyword,
              weightGrams: s.estimatedWeightGrams,
              scoutIndex: s.scoutIndex ?? idx,
            }));
        rawParsed.foodData = { ...existingFd, itemsBreakdown: breakdown };
      }
    }
    const originalModeIsModify = !!(
      isExplicitModify ||
      userExplicitlySelectedEditMode ||
      (activeMeal && (!imagePayloads || imagePayloads.length === 0))
    );
    let mode = rawParsed.mode || (originalModeIsModify ? "modify" : "new_log");
    if (userSelectedMode !== 'compare' && visionScoutItems && visionScoutItems.length <= 1 && mode === "evaluation") {
      addDebugLog(`[Mode Override] Overriding mode from 'evaluation' to 'new_log' because only 1 item was identified.`);
      mode = "new_log";
    }
    if (originalModeIsModify && mode !== "discussion" && mode !== "evaluation") {
      mode = "modify";
    }
    apiCalls = [
      ...(hasImage ? [{ type: 'gemini', label: 'Food nutrition agent - Visual Scout (gemini-3.5-flash-lite)' }] : []),
      ...(queriesToSearch && queriesToSearch.length > 0 ? [{ type: 'usda', label: `Food nutrition agent - USDA (${queriesToSearch.length})` }] : []),
      ...((canSkipDietitianForCreate || canSkipDietitianForPureScale) ? [] : [{ type: 'gemini', label: `Food nutrition agent - Dietitian (${(typeof engine === 'object' ? engine?.name || engine?.model : engine) || 'gemini-3.5-flash-lite'})` }])
    ];
    // CASE F: food origin lookup mode
    // CASE B: discussion mode
    if (mode === "discussion") {
      addDebugLog(`[Mode Routing] DISCUSSION mode triggered (0 database operations).`);
      return res.json({
        mode: "discussion",
        dietitianScratchpad: rawParsed._internalReasoning,
        text: rawParsed.message || "Here is the details on this meal composition.",
        message: rawParsed.message || "Here is the details on this meal composition.",
        data: null,
        agentPrompt: fullPromptSent,
        apiCalls
      });
    }
    // CASE D: evaluation mode
    if (mode === "evaluation") {
      addDebugLog(`[Mode Routing] EVALUATION mode triggered.`);
      const comparisonData = rawParsed.comparison || { groups: [] };
      const preCalcByScoutIndex: Record<number, Record<string, number>> = {};
      if (visionScoutItems && visionScoutItems.length > 0) {
        await Promise.all(
          visionScoutItems.map(async (sItem: any, idx: number) => {
            const itemGrams = Number(sItem.weightGrams || sItem.estimatedGrams || sItem.estimatedWeightGrams || sItem.servingGrams || 100) || 100;
            const ledger = await finalizeDishLedger({
              item: sItem,
              nutrientBasisWeight: sItem.nutrientBasisWeight || itemGrams,
              consumedWeight: itemGrams,
            });
            addDebugLog(`[Budget] mode=D idx=${idx} item="${sItem.originalName || sItem.keyword}" kcal=${ledger.nutrients.calories} source=${ledger.dbSource} scoutEst=${sItem.estimatedCalories ?? 'n/a'}`);
            preCalcByScoutIndex[idx] = ledger.nutrients as any;
          })
        );
      }
      const resolvedGroups = resolveComparisonGroups(comparisonData.groups, visionScoutItems, userProfile?.language);
      addDebugLog(`[Comparison Resolve] ${visionScoutItems.length} scout item(s) -> ${resolvedGroups.length} group(s), covering ${resolvedGroups.reduce((sum: number, g: any) => sum + (g.items?.length || 0), 0)} item(s).`);
      comparisonData.groups = applyServerAverageNutrients(resolvedGroups, preCalcByScoutIndex);
      comparisonData.isMenuScale = isMenuScale;
      addDebugLog('[MealBuild] mode=D stream');
      const comparisonSet = fromEvaluationComparison(comparisonData, visionScoutItems, {
        id: req.body.jobId || `cmp_${Date.now()}`,
      });
      const responsePayload = {
        mode: "evaluation",
        dietitianScratchpad: rawParsed._internalReasoning,
        scoutInternalReasoning,
        rawScout: rawScoutData,
        comparison: comparisonData,
        comparisonSet,
        scoutItems: mergeScoutItems(visionScoutItems, rawParsed.scoutItems),
        scoutContentType: visionScoutContentType,
        diningEnvironment,
        agentPrompt: fullPromptSent,
        message: rawParsed.message,
        text: rawParsed.message,
        apiCalls
      };
      return res.json(responsePayload);
    }
    {
      const hasExplicitEditCommands = Array.isArray(rawParsed.editCommands) && rawParsed.editCommands.length > 0;
      const hasLegacyEditCommands = Array.isArray(rawParsed.modificationCommand) && rawParsed.modificationCommand.length > 0;
      if (hasExplicitEditCommands || hasLegacyEditCommands) {
        mode = "modify";
      }
      if (originalModeIsModify && hasActiveMealDocument) {
        mode = "modify";
        if (!hasExplicitEditCommands && !hasLegacyEditCommands) {
          addDebugLog(`[Single-Path] Same meal, empty modificationCommand — Q&A (card unchanged). Not a new meal.`);
        } else {
          addDebugLog(`[Single-Path] Same meal, ${hasExplicitEditCommands ? rawParsed.editCommands.length : rawParsed.modificationCommand.length} edit command(s).`);
        }
      }
    }
    // CASE A: NEW FOOD LOGGING
    if (mode === "new_log") {
      const rawFoodData = rawParsed.foodData || {};
      if (!rawFoodData.itemsBreakdown || rawFoodData.itemsBreakdown.length === 0) {
        // Build itemsBreakdown from Vision Scout output + best DB match per item
        if (visionScoutItems && visionScoutItems.length > 0) {
                    rawFoodData.itemsBreakdown = visionScoutItems.map((item: any) => {
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
          addDebugLog(`[Fallback] Built itemsBreakdown from Vision Scout output (LLM truncated)`);
        }
      }
      const parsedData: any = {};
      const sanitizeString = (val: any, fallback: string) => {
        if (val === null || val === undefined || String(val).toLowerCase() === "undefined" || String(val).trim() === "") {
          return fallback;
        }
        return String(val);
      };
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
        const userMentionsDate = /\b(yesterday|tomorrow|last night|january|february|march|april|may|june|july|august|september|october|november|december|\d{4}-\d{2}-\d{2})\b/i.test(message);
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
        const sanitizedLabel = sanitizeVerdictLabel(rawVerdict.label || t(userProfile?.language, 'verdictSupportsMetabolicEnergy'), rawVerdict.level, parsedData.nutrients, userProfile?.language);
        parsedData.verdict = {
          label: sanitizedLabel,
          level: String(rawVerdict.level || 'neutral')
        };
      } else if (rawFoodData.recommendation && typeof rawFoodData.recommendation === 'string' && rawFoodData.recommendation.trim().length > 0) {
        const sanitizedLabel = sanitizeVerdictLabel(rawFoodData.recommendation, 'neutral', parsedData.nutrients, userProfile?.language);
        parsedData.verdict = {
          label: sanitizedLabel,
          level: 'neutral'
        };
      }
      parsedData.cookingMethod = sanitizeString(rawFoodData.cookingMethod, scoutCookingMethod || t(userProfile?.language, 'cookingMethodUnknown'));
      parsedData.scoutConfidenceRating = sanitizeString(rawFoodData.scoutConfidenceRating, scoutConfidenceRating || "High (>90%)");
      parsedData.scoutConfidenceComment = rawFoodData.scoutConfidenceComment !== undefined ? sanitizeString(rawFoodData.scoutConfidenceComment, "") : (scoutConfidenceComment || "");
      // diningEnvironment is intentionally NOT re-read from the Dietitian's output.
      // The Vision Scout is the sole source of truth for this classification (server.ts:2528).
      if ((!diningEnvironment || diningEnvironment === 'unknown') && activeMeal?.diningEnvironment) {
        diningEnvironment = activeMeal.diningEnvironment;
      }
      parsedData.diningEnvironment = diningEnvironment;
      const useFinalizeDirectMap = Array.isArray(preCalculatedItems) && preCalculatedItems.length > 0;
      if (useFinalizeDirectMap) {
        addDebugLog('[Single-Path] Meal items = finalizeDishLedger.');
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
        addDebugLog('[Single-Path] No finalize ledger; not inventing a second calorie book.');
        if (!Array.isArray(parsedData.itemsBreakdown)) parsedData.itemsBreakdown = [];
        if (!parsedData.nutrients) parsedData.nutrients = {};
      }
      // Ensure composition is always derived from the final itemsBreakdown names & visual ingredient breakdown
      if (parsedData.itemsBreakdown && Array.isArray(parsedData.itemsBreakdown)) {
        parsedData.composition = parsedData.itemsBreakdown.map((it: any) => {
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
      if (!parsedData.imageUrl) {
        if (req.body.photoUrl && typeof req.body.photoUrl === 'string' && req.body.photoUrl.trim() && req.body.photoUrl !== "[base64_image_data_truncated]") {
          parsedData.imageUrl = req.body.photoUrl;
        } else if (req.body.imageUrl && typeof req.body.imageUrl === 'string' && req.body.imageUrl.trim() && req.body.imageUrl !== "[base64_image_data_truncated]") {
          parsedData.imageUrl = req.body.imageUrl;
        } else if (Array.isArray(req.body.imageUrls) && req.body.imageUrls.length > 0 && req.body.imageUrls[0] && req.body.imageUrls[0] !== "[base64_image_data_truncated]") {
          parsedData.imageUrl = req.body.imageUrls[0];
        } else if (Array.isArray(images) && images.length > 0 && images[0] && images[0] !== "[base64_image_data_truncated]") {
          parsedData.imageUrl = images[0];
        } else if (image && typeof image === 'string' && image.trim() && image !== "[base64_image_data_truncated]") {
          parsedData.imageUrl = image;
        } else if (req.body.activeMeal?.imageUrl && req.body.activeMeal.imageUrl !== "[base64_image_data_truncated]") {
          parsedData.imageUrl = req.body.activeMeal.imageUrl;
        } else if (Array.isArray(req.body.activeMeal?.imageUrls) && req.body.activeMeal.imageUrls.length > 0 && req.body.activeMeal.imageUrls[0] !== "[base64_image_data_truncated]") {
          parsedData.imageUrl = req.body.activeMeal.imageUrls[0];
        } else if (req.body.activeMeal?.photoUrl && req.body.activeMeal.photoUrl !== "[base64_image_data_truncated]") {
          parsedData.imageUrl = req.body.activeMeal.photoUrl;
        }
      }
      if (!parsedData.imageUrls || parsedData.imageUrls.length === 0 || parsedData.imageUrls[0] === "[base64_image_data_truncated]") {
        if (Array.isArray(req.body.imageUrls) && req.body.imageUrls.length > 0 && req.body.imageUrls[0] !== "[base64_image_data_truncated]") {
          parsedData.imageUrls = req.body.imageUrls;
        } else if (Array.isArray(images) && images.length > 0 && images[0] !== "[base64_image_data_truncated]") {
          parsedData.imageUrls = images;
        } else if (parsedData.imageUrl && parsedData.imageUrl !== "[base64_image_data_truncated]") {
          parsedData.imageUrls = [parsedData.imageUrl];
        } else if (Array.isArray(req.body.activeMeal?.imageUrls) && req.body.activeMeal.imageUrls.length > 0 && req.body.activeMeal.imageUrls[0] !== "[base64_image_data_truncated]") {
          parsedData.imageUrls = req.body.activeMeal.imageUrls;
        }
      }
      if (originalModeIsModify) {
        parsedData.id = req.body.activeMeal?.id;
        if (!parsedData.imageUrl) parsedData.imageUrl = req.body.activeMeal?.imageUrl || req.body.activeMeal?.imageUrls?.[0];
        if (!parsedData.imageUrls || (parsedData.imageUrls.length > 0 && parsedData.imageUrls[0] === "[base64_image_data_truncated]")) parsedData.imageUrls = req.body.activeMeal?.imageUrls;
        let baseScoutItems = (visionScoutItems && visionScoutItems.length > 0)
          ? visionScoutItems
          : (req.body.activeMeal?.scoutItems || []);
        let updatedScoutItems = mergeScoutItems(baseScoutItems, rawParsed.scoutItems);
        if (parsedData && Array.isArray(parsedData.itemsBreakdown) && parsedData.itemsBreakdown.length > 0) {
          const currentScoutIndices = new Set(parsedData.itemsBreakdown.map((b: any) => b.scoutIndex).filter((i: any) => i !== undefined && i !== null));
          if (currentScoutIndices.size > 0) {
            updatedScoutItems = updatedScoutItems.filter((sItem: any) => currentScoutIndices.has(sItem.scoutIndex));
          }
          updatedScoutItems = updatedScoutItems.map((sItem: any, sIdx: number) => {
            const bItem = parsedData.itemsBreakdown.find((b: any) =>
              b.scoutIndex !== undefined && b.scoutIndex !== null && b.scoutIndex === sItem.scoutIndex
            ) || parsedData.itemsBreakdown.find((b: any) => namesReferToSameFood(b.canonicalDbName || b.name, sItem.originalName || sItem.keyword));
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
        addDebugLog('[MealBuild] modify-path');
        const { mealBuild, pendingFoodLog } = attachHappyPathMealBuild({
          parsedData,
          jobId: req.body.jobId,
          activeMeal: req.body.activeMeal,
          scoutItems: updatedScoutItems,
          diningEnvironment,
        });
        const finalMeal = pendingFoodLog || parsedData;
        const gate = evaluateMealGate({
          mealId: finalMeal?.id || req.body.jobId,
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
          mealHasImages: Boolean(req.body.photoUrl || (imagePayloads && imagePayloads.length > 0)),
          imageCount: (imagePayloads && imagePayloads.length > 0) ? imagePayloads.length : (req.body.photoUrl ? 1 : 0),
          narrative: rawParsed.message,
        });
        return res.json({
          mode: "modify",
          dietitianScratchpad: rawParsed._internalReasoning,
          text: rawParsed.message || `I have updated your meal to reflect the correction.`,
          message: rawParsed.message || `I have updated your meal to reflect the correction.`,
          data: pendingFoodLog || parsedData,
          pendingFoodLog: pendingFoodLog || parsedData,
          mealBuild,
          savable: gate.savable,
          gate,
          agentPrompt: fullPromptSent,
          scoutItems: updatedScoutItems,
          apiCalls
        });
      }
      const isResumedFromImageTurn = !!(
        req.body.portionChoices ||
        req.body.skipScout ||
        req.body.photoUrl ||
        (Array.isArray(req.body.activeScoutItems) && req.body.activeScoutItems.length > 0) ||
        (Array.isArray(visionScoutItems) && visionScoutItems.length > 0) ||
        (Array.isArray(history) && history.some((m: any) => m.data?.photoUrl || m.photoUrl || m.data?.hasImage || m.data?.pendingFoodLog?.imageUrl || m.data?.pendingFoodLog?.imageUrls?.length))
      );
      if (!hasImage && !isResumedFromImageTurn && !parsedData.imageUrl && parsedData.name) {
        try {
          // Remove weight/quantity numbers & units for cleaner search query
          const cleanFoodQuery = parsedData.name.replace(/\d+\s*(g|grams|oz|lbs|kg|servings|pcs|pieces|slice|slices)?/gi, '').trim() || parsedData.name;
          addDebugLog(`[Text Search Image Lookup] Attempting auto image retrieval for text food "${cleanFoodQuery}" (from "${parsedData.name}")...`);
          const fetchedImgs = await retrieveFoodImages(cleanFoodQuery, { mode: "light", count: 1 });
          if (fetchedImgs && fetchedImgs.length > 0 && fetchedImgs[0].imageUrl) {
            parsedData.imageUrl = fetchedImgs[0].imageUrl;
            parsedData.imageUrls = [fetchedImgs[0].imageUrl];
            addDebugLog(`[Text Search Image Lookup] Successfully attached retrieved image for "${parsedData.name}": ${parsedData.imageUrl}`);
          }
        } catch (imgErr: any) {
          addDebugLog(`[Text Search Image Lookup Error] ${imgErr?.message || imgErr}`);
        }
      }
      let finalScoutItems = mergeScoutItems(visionScoutItems, rawParsed.scoutItems);
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
      if (parsedData && Array.isArray(parsedData.itemsBreakdown) && parsedData.itemsBreakdown.length > 0) {
        finalScoutItems = finalScoutItems.map((sItem: any, sIdx: number) => {
          const bItem = parsedData.itemsBreakdown.find((b: any) =>
            b.scoutIndex !== undefined && b.scoutIndex !== null && b.scoutIndex === sItem.scoutIndex
          ) || parsedData.itemsBreakdown.find((b: any) => namesReferToSameFood(b.canonicalDbName || b.name, sItem.originalName || sItem.keyword));
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
      addDebugLog('[MealBuild] happy-path');
      const { mealBuild, pendingFoodLog } = attachHappyPathMealBuild({
        parsedData,
        jobId: req.body.jobId,
        activeMeal: req.body.activeMeal,
        scoutItems: finalScoutItems,
        diningEnvironment,
      });
      const finalMeal = pendingFoodLog || parsedData;
      const gate = evaluateMealGate({
        mealId: finalMeal?.id || req.body.jobId,
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
        mealHasImages: Boolean(req.body.photoUrl || (imagePayloads && imagePayloads.length > 0)),
        imageCount: (imagePayloads && imagePayloads.length > 0) ? imagePayloads.length : (req.body.photoUrl ? 1 : 0),
        narrative: rawParsed.message,
      });
      const responsePayload = {
        mode: "new_log",
        dietitianScratchpad: rawParsed._internalReasoning,
        scoutInternalReasoning,
        rawScout: rawScoutData,
        scoutContentType: visionScoutContentType,
        diningEnvironment,
        text: rawParsed.message || `I have analyzed the food: **${parsedData.name}** (${parsedData.quantity}).`,
        message: rawParsed.message || `I have analyzed the food: **${parsedData.name}** (${parsedData.quantity}).`,
        data: pendingFoodLog || parsedData,
        pendingFoodLog: pendingFoodLog || parsedData,
        mealBuild,
        savable: gate.savable,
        gate,
        agentPrompt: fullPromptSent,
        scoutItems: finalScoutItems,
        apiCalls
      };
      return res.json(responsePayload);
    }
    // CASE C: modification commands mode (Math-only fallbacks)
    if (mode === "modify") {
      addDebugLog(`[Mode Routing] MODIFY mode triggered (Math Fallback).`);
      let activeMeal = req.body.activeMeal;
      if (!activeMeal) {
        addDebugLog(`[Modify Math Error] No active meal exists in Firestore to modify. jobId=${req.body.jobId || 'n/a'} imageCount=${(imagePayloads && imagePayloads.length) || 0} message="${(message || '').substring(0, 80)}"`);
        return res.json({
          text: rawParsed.message || "I couldn't modify the meal because there's no active meal currently logged. Please log a meal first!",
          message: rawParsed.message || "I couldn't modify the meal because there's no active meal currently logged. Please log a meal first!",
          data: null,
          apiCalls
        });
      }
      {
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
        const result = await applyMealEdits({
          items: Array.isArray(activeMeal.itemsBreakdown) ? activeMeal.itemsBreakdown : [],
          commands: Array.isArray(editCommands) ? editCommands : [],
          userMessage: message || '',
        });
        for (const note of result.notes) addDebugLog(`[Single-Path Edit] ${note}`);
        if (result.changed) {
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
            addDebugLog(`[Edit History] Failed to append history entry: ${histErr?.message || histErr}`);
          }
        }
        activeMeal.itemsBreakdown = result.items;
        activeMeal.nutrients = result.nutrients;
        activeMeal.weightGrams = result.weightGrams;
        activeMeal.serving_grams = result.weightGrams;
        activeMeal.receiptTable = result.receiptTable;
        activeMeal.composition = result.items.map((it: any) => it.name).join(', ');
        const formatMultiItemMealTitle = (items: any[]): string => {
          if (!items || items.length === 0) return 'Meal';
          const names = items.map((it: any) => it.name || it.canonicalDbName || 'Item').filter(Boolean);
          if (names.length === 1) return names[0];
          if (names.length === 2) return `${names[0]} and ${names[1]}`;
          return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
        };

        const incomingTitle = rawParsed.foodData?.name;
        if (result.items.length > 1) {
          const isMultiItemTitle = incomingTitle && (incomingTitle.includes(',') || /\b(and|with)\b/i.test(incomingTitle));
          if (incomingTitle && isMultiItemTitle) {
            let updatedTitle = incomingTitle;
            // Synchronize any renamed items in incomingTitle from editCommands
            if (Array.isArray(editCommands)) {
              for (const cmd of editCommands) {
                const oldName = cmd.itemName;
                const newName = cmd.newItemName || (cmd.action === 'update_modifier' || cmd.action === 'set_modifier' ? applyModifierToItemName(oldName, cmd.modifier) : null);
                if (oldName && newName && oldName !== newName) {
                  const reg = new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'gi');
                  updatedTitle = updatedTitle.replace(reg, newName);
                }
              }
            }
            activeMeal.name = updatedTitle;
          } else {
            activeMeal.name = formatMultiItemMealTitle(result.items);
          }
        } else if (incomingTitle) {
          activeMeal.name = incomingTitle;
        } else if (result.items.length === 1) {
          activeMeal.name = result.items[0].name || activeMeal.name;
        }
        // Sync scoutItems (used by the "Meal composition" chips/gallery in the UI)
        // with any name changes applied to itemsBreakdown by this edit. Without this,
        // renames from set_modifier/replace_identity (e.g. "Es Teh Manis" -> "Unsweetened
        // Iced Tea") update the nutrition ledger but the chip label stays on the old name
        // forever, because the chips read scoutItems.originalName/keyword, not itemsBreakdown.
        const baseScoutItemsForEdit = (activeMeal.scoutItems && activeMeal.scoutItems.length > 0)
          ? activeMeal.scoutItems
          : (visionScoutItems || []);
        const syncedScoutItemsForEdit = result.items.map((bItem: any) => {
          const sItem = baseScoutItemsForEdit.find((s: any) =>
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
        activeMeal.scoutItems = syncedScoutItemsForEdit;
        addDebugLog(`[ScoutSync] edit-path renamed scoutItems -> ${JSON.stringify(syncedScoutItemsForEdit.map((s: any) => s.originalName))}`);
        
        const rawMessage = result.qa
          ? (rawParsed.message || 'Here is the detail on this meal.')
          : (rawParsed.message || 'I have updated your meal.');

        const postEditSummary: any = {
          mealName: activeMeal.name,
          weightGrams: result.weightGrams,
          calories: result.nutrients.calories,
          protein: result.nutrients.protein,
          carbohydrates: result.nutrients.carbohydrates,
          totalFat: result.nutrients.totalFat,
          saturatedFat: result.nutrients.saturatedFat,
          addedSugar: result.nutrients.addedSugar,
          sugar: result.nutrients.sugar,
          sodium: result.nutrients.sodium,
          salt: result.nutrients.salt,
        };
        const finalMessage = reconcileMessageWithLedger(rawMessage, postEditSummary, userProfile?.language);
          
        activeMeal.message = finalMessage;
        activeMeal.healthImpact = finalMessage;

        addDebugLog('[MealBuild] edit-path (finalize executor)');
        const { mealBuild, pendingFoodLog } = attachHappyPathMealBuild({
          parsedData: activeMeal,
          jobId: req.body.jobId,
          activeMeal: req.body.activeMeal,
          scoutItems: syncedScoutItemsForEdit,
          diningEnvironment: activeMeal?.diningEnvironment,
        });
        mealBuild.staleDietitianNarrative = false;
        const finalMeal = pendingFoodLog || activeMeal;
        const gate = evaluateMealGate({
          mealId: finalMeal?.id || req.body.jobId,
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
          mealHasImages: Boolean(req.body.photoUrl || (imagePayloads && imagePayloads.length > 0) || activeMeal?.imageUrl),
          imageCount: (imagePayloads && imagePayloads.length > 0) ? imagePayloads.length : (req.body.photoUrl ? 1 : 0),
          narrative: finalMessage,
          previousMeal: req.body.activeMeal,
          commands: Array.isArray(editCommands) ? editCommands : [],
        });
        return res.json({
          mode: "modify",
          dietitianScratchpad: rawParsed._internalReasoning,
          text: finalMessage,
          message: finalMessage,
          data: pendingFoodLog || activeMeal,
          pendingFoodLog: pendingFoodLog || activeMeal,
          mealBuild,
          savable: gate.savable,
          gate,
          editApplied: result.changed,
          agentPrompt: fullPromptSent,
          scoutItems: syncedScoutItemsForEdit,
          apiCalls
        });
      }
    }
  } catch (error: any) {
    console.error("[Food Analyze Error]:", error);
    // Dietitian Degrade logic (Phase 1)
    if (preCalculatedItems && preCalculatedItems.length > 0 && preCalculatedItems.some((p: any) => (p.nutrients && p.nutrients.calories != null) || (p.primaryBase100g && p.primaryBase100g.calories !== undefined))) {
      addDebugLog(`[Dietitian Degrade] Dietitian failed permanently, but pre-calculated math exists. Salvaging meal build.`);
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
      const salvagedMeal = buildSavableMealFromParsed(preCalculatedItems, req.body.activeMeal, salvagedAggregatedNutrients, null);
      const degradedMeal = markDietitianDegraded(salvagedMeal, error.message);
      const payloadData = toPendingFoodLog(degradedMeal);
      const degradeMessage = "Nutrients logged based on core databases, but AI clinical advice is currently unavailable.";
      const successPayload = {
        mode: "new_log",
        data: payloadData,
        pendingFoodLog: payloadData,
        mealBuild: degradedMeal,
        degradedStages: degradedMeal.degradedStages,
        scoutItems: visionScoutItems,
        scoutContentType: visionScoutContentType,
        text: degradeMessage,
        message: degradeMessage,
        agentPrompt: fullPromptSent,
        apiCalls
      };
      addDebugLog(`[Dietitian Degrade] Emitting salvaged meal (kcal=${payloadData?.nutrients?.calories ?? payloadData?.calories ?? '?'}) as succeeded.`);
      return res.json(successPayload);
    }
    const errorPayload: any = {
      error: `Failed to process your request (Error: ${error.message || 'Connection timed out'}). Please try again with a different model from the top-left dropdown.`,
      agentNotAvailable: true
    };
    if (visionScoutItems && visionScoutItems.length > 0) {
      errorPayload.scoutItems = visionScoutItems;
      errorPayload.scoutContentType = visionScoutContentType;
    }
    if (isStream && hasSentHeaders) {
      try {
        res.write(`data: ${JSON.stringify(errorPayload)}\n\n`);
      } catch(errStr: any) {
        res.write(`data: ${JSON.stringify({ error: 'Failed to process your request and serialize error payload.' })}\n\n`);
      }
      return res.end();
    } else {
      return res.status(200).json(errorPayload);
    }
  }
}
