/**
 * Food-analyze pipeline (Scout → Finalize → Dietitian → Gate).
 * HTTP adapter is server_routes_food_analyze.ts — keep this file off the route.
 */
import { Type } from '@google/genai';
import { z } from 'zod';
import { formatUSDANutrients, formatOFFNutrients, extractOFFNutrientsPer100g, isFastFoodChain, buildWebSearchQuery, loosenQuery, cleanQuery, detectChainKeyFromText, scoutHasCompletePrintedLabel, enrichScoutComponentsWithMatches, buildPastMealsContext } from './src/server/food/server_food_analyze_helpers.js';
import { computeDietitianSkipGates, decideScoutVerdict, decideScoutAdvice, buildPureScaleResponse, sumPrecalcTotals, buildCreateSkipResponse, sumSalvagedAggregates, applyPreDietitianDensityCheck, resolveCreateMealTitle } from './src/server/food/server_food_dietitian_dispatch.js';
import { resolveFoodAnalyzeMode, buildFoodApiCalls, normalizeParsedPostDietitian } from './src/server/food/server_food_mode_routing.js';
import { buildFallbackItemsBreakdown, assembleParsedMealHeader, backfillEditCommandEstimates, resolveEditedMealTitle, resolveModifyIncomingTitle, appendEditHistoryEntry, syncEditScoutItems, buildGateInput, deriveMealComposition, resolveMealImageUrls, mergeFinalScoutItems, buildNewLogGateInput, mapFinalizeToMeal, mergeModifyPathScoutItems, runEvaluationFinalize, assembleEvaluationComparison } from './src/server/food/server_food_meal_assemble.js';
import { inheritActiveMealScoutItems, mapCompareItemsToScoutItems, resolvePriorScoutItems, applyBracketPreExtract, injectExplicitFoodTags, inferPackagedBindChains, buildScoutFailureError, applyScoutResultState, mergeScoutIntoActiveMeal, logScoutItemSummaries, applyWeightModShortcut, restoreTurnOneCandidates, computeScoutRetryDelay, applySkipScoutShortcut, checkResumedFromImageTurn, applyTextQueryShortcut, checkMenuScaleBypass, buildScoutCallArgs, runScoutRetryLoop } from './src/server/food/server_food_scout_source.js';
import { collectImagePayloads, decideWeightRefine } from './src/server/food/server_food_session_setup.js';
import { shouldPauseForPortionClarify, filterPortionCarryCandidates, detectDominantBrand, collectFdcHintTasks, isFdcHintRelevant, mapLedgersToPrecalcItems, applyMealModifiers } from './src/server/food/server_food_precalc.js';
import { runDatabaseSearchStage } from './src/server/food/server_food_db_search.js';
import { buildTimeContext, buildUserContext, buildHistoryContext, buildImageContext, buildVisionScoutContext, buildBiomarkersContext, selectSystemInstruction, stitchFoodPrompt, buildDatabaseMatchesContext, assemblePrecalcPromptBlock } from "./src/server/food/server_food_prompt_context.js";
import { buildDiscussionResponse, buildEvaluationResponse, buildNewLogResponse, buildModifyNoMealResponse, buildModifyResponse, buildDegradeResponse } from './src/server/food/server_food_responses.js';

import { executeFoodResolverCurator } from './server_food_resolver_curator.js';
import {
  checkCategoryAndStateCompatibility,
  checkThermodynamicDensitySanity,
  checkArchetypeMacroBounds,
  applySatFatAndAddedSugarFloor,
  backfillSparseMicronutrients,
  findItemIndexInList,
  getUSDANutrientValue,
  extractUSDANutrientsPer100g,
  checkIfItemIsAlreadyPrepared,
  applyNutrientRealityChecks,
  applyCommercialSodiumFloor,
  checkAtwaterConsistency,
  synchronizeNarrativeText,
  build31NutrientsMarkdownServer,
  formatMealReceiptTable,
  sanitizeVerdictLabel,
} from './server_pure_helpers.js';
import {
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
} from './server_portion_clarify.js';
import {
  rebalanceNutrientProfile,
  computeCaloriesFromMacros,
} from './server_derivation.js';
import {
  attachHappyPathMealBuild,
  markDietitianDegraded,
  buildSavableMealFromParsed,
} from './server_meal_orchestrator.js';
import { toPendingFoodLog } from './src/mealBuild/adapters.js';
import { attachSseJsonResponder } from './server_sse_json.js';
import { reconcileMessageWithLedger } from './src/mealBuild/narration.js';
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
  mergeScoutItems,
  parseAndHealVisionScout,
  reconcileIngredientsToComponents,
} from './server_vision_scout.js';
import { buildVisualScoutPrompt, parseBracketedFoodItems } from './agents/scoutInstructions.js';
import { isDishEstimateEnabled } from './server_food_flags.js';
import { finalizeDishLedger } from './server_dish_finalize.js';
import { evaluateMealGate } from './server_meal_gate.js';
import { buildMealFromFinalizeLedgers } from './server_meal_from_finalize.js';
import { applyMealEdits } from './server_meal_edit.js';
import { getInMemoryServerJob } from './serverJobs.js';
import {
  buildEditExpertDispatch,
  formatLockedSlotsForPrompt,
} from './server_edit_patch_ledger.js';
import { matchBrandMenu, isPackagedBindItem } from './server_brand_match.js';
import { classifyDishAtomic } from './server_dish_classify.js';
import { t, interpolate, withScoutLanguage } from './src/utils/i18n.js';
import { scoutSystemInstruction } from './agents/scoutInstructions.js';
import { takeUnifiedUsage, takeUnifiedTiming, formatUnifiedUsage } from './src/utils/unifiedUsage.js';
import {
  addDebugLog,
  logSessionStorage,
  streamDebugLogStorage,
  globalDebugLogs,
  sessionDebugLogs,
  callUnifiedLLM,
  getGeminiClient,
  getGeminiApiKey,
  BEVERAGE_RAW_PATTERN,
  SINGLE_STAPLE_RE,
  adminAuth,
  db,
  searchUSDA,
  searchOpenFoodFacts,
  fetchUSDAFoodById,
  fetchOFFProductByBarcode,
  lookupChainMenuSources,
  isUsableWebNutritionHit,
  retrieveFoodImages,
} from './server.js';
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
  // Hoisted so the Scout instruction text survives to the response
  // payload as `agentInstructions` below (previously the Scout prompt was
  // only a local const inside the `if (hasImage)` block and discarded once
  // Scout finished, so the debug export's per-dispatch Instruction field
  // was never populated on the async job-queue path).
  let scoutInstructionForDebug: any;
  let apiCalls: any[] = [];
  let accumulatedDispatches: any[] = [];

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


    const sendLog = (type: string, stage: string, message: string, data?: any) => {
      sendStreamEvent({ type: 'log', logType: type, stage, message, data });
    };

    // Re-emit the stage's token usage into the STREAMED log channel (the only
    // channel the job runner accumulates for the debug export). takeUnifiedUsage
    // consumes the record stashed by callUnifiedLLMInternal right after the
    // awaited call; null = the stage made no LLM call (projector path).
    const emitStageUsage = (stage: string) => {
      try {
        const u = takeUnifiedUsage(stage);
        if (u) sendLog('info', stage, formatUnifiedUsage(stage, u));
        const ms = takeUnifiedTiming(stage);
        if (ms != null) sendLog('info', stage, `[UnifiedLLM-Timing:${stage.toLowerCase()}] ms=${ms}`);
      } catch { /* usage re-emit must never break the meal flow */ }
    };

    const imagePayloads: any[] = collectImagePayloads(image, images);

    // B5 — Detect weight/portion refine on prior scout (skip Vision Scout + DB when safe).
    // Path A: text-only refine. Path B: images still attached but printed label locks exist.
    const { priorScoutForRefine, refineDecision, weightRefineIntent, isPureWeightModification } = decideWeightRefine({
      body: req.body, message, imagePayloads, activeMeal,
    });
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
    // Hydrate patch-ledger locks from prior turn result / in-memory job when the client omits them.
    if (activeMeal && (!Array.isArray(activeMeal.userLockedSlots) || activeMeal.userLockedSlots.length === 0)) {
      const memJob = req.body.jobId ? getInMemoryServerJob(String(req.body.jobId)) : null;
      const priorLocks =
        req.body?.pendingFoodLog?.userLockedSlots ||
        req.body?.activeMeal?.mealBuild?.userLockedSlots ||
        req.body?.priorUserLockedSlots ||
        memJob?.userLockedSlots ||
        memJob?.clean_result?.pendingFoodLog?.userLockedSlots ||
        memJob?.clean_result?.userLockedSlots ||
        null;
      if (Array.isArray(priorLocks) && priorLocks.length > 0) {
        activeMeal.userLockedSlots = priorLocks;
        addDebugLog(`[PatchLedger] hydrated ${priorLocks.length} lock(s) from prior result/job`);
      }
    }
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
      const inherited = inheritActiveMealScoutItems({ isModifySession, visionScoutItems, activeMeal, onLog: addDebugLog });
      visionScoutItems = inherited.items;
      if (inherited.ran) visionScoutRanAndReturnedItems = true;
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

    if (req.body.resolvedDbCandidates) {
      restoreTurnOneCandidates({
        resolvedDbCandidates: req.body.resolvedDbCandidates,
        databaseMatchesArray,
        dbMatchMap,
        onLog: addDebugLog,
      });
    }

    if (compareOnly) {
      addDebugLog(`[Shortcut] Compare mode detected. Skipping Vision Scout and DB Search.`);
      if (compareItems && compareItems.length > 0) {
        visionScoutItems = mapCompareItemsToScoutItems(compareItems);
      }
    } else {
      let skipScoutApplied = false;
      if (req.body.skipScout || req.body.portionChoices) {
        const skipOut = applySkipScoutShortcut({
          body: req.body,
          history,
          activeMeal,
          onLog: addDebugLog,
        });
        if (skipOut.ran) {
          visionScoutItems = skipOut.visionScoutItems;
          visionScoutContentType = skipOut.visionScoutContentType;
          if (skipOut.diningEnvironment) diningEnvironment = skipOut.diningEnvironment;
          visionScoutRanAndReturnedItems = true;
          logScoutItemSummaries(visionScoutItems, addDebugLog);
          skipScoutApplied = true;
        }
      }

      if (!skipScoutApplied && isWeightModification && visionScoutItems.length > 0) {
        const weightModOut = applyWeightModShortcut({
          activeScoutItems: visionScoutItems,
          portionChoices: req.body.portionChoices,
          weightRefineIntent,
          scoutContentType: req.body.scoutContentType,
          refineDecision,
          priorScoutForRefine: visionScoutItems,
          imagePayloads,
          onLog: addDebugLog,
        });
        if (weightModOut.ran) {
          visionScoutItems = weightModOut.visionScoutItems;
          visionScoutContentType = weightModOut.visionScoutContentType;
          visionScoutRanAndReturnedItems = true;
          logScoutItemSummaries(visionScoutItems, addDebugLog);
          skipScoutApplied = true;
        }
      }

      if (!skipScoutApplied) {
        const hasImage = imagePayloads && imagePayloads.length > 0;
        const isEditOrText = Boolean(message || isModifySession || hasActiveMealDocument);

        if (hasImage || isEditOrText) {
          sendStreamEvent({ type: 'status', stage: 'scout', status: 'started', message: isModifySession ? 'Refining meal with Scout agent...' : 'Reading your photos...' });
        const imageCount = imagePayloads?.length || 0;
        let scoutPromptText = '';
        if (isModifySession && (activeMeal || (req.body.activeScoutItems && req.body.activeScoutItems.length > 0))) {
          const priorMealItems = activeMeal?.itemsBreakdown || activeMeal?.items || req.body.activeScoutItems || [];
          const priorSummary = priorMealItems.map((it: any) => `${it.originalName || it.keyword || it.name || 'Dish'} (${it.estimatedWeightGrams || it.weightGrams || 100}g): ${JSON.stringify(it.components || it.foods || [])}`).join('; ');
          const lockPrompt = formatLockedSlotsForPrompt(activeMeal?.userLockedSlots);
          scoutPromptText = `The user is modifying/refining an existing logged meal.\n` +
            `User modification instruction: "${(message || '').trim()}".\n` +
            `Prior Meal Dishes: ${priorSummary}.\n` + (lockPrompt || '') + `\n` +
            `CRITICAL INSTRUCTIONS FOR MODIFICATION:\n` +
            `1. TARGETED DISH UPDATE ONLY: Follow the prototype model where only the edited, added, or substituted food item is returned in the dishes[] array. DO NOT re-emit unchanged dishes from the prior meal. If the user adds an item (e.g. 'There was also an es teh tawar'), output ONLY that new dish in dishes[]. If the user modifies an item portion or substitutes an item, output ONLY that modified/substituted dish in dishes[]. If the user asks to remove an item, emit an empty dishes[] array.\n` +
            `2. INGREDIENT & DISH SUBSTITUTION/RENAME: If the user changes, corrects, or substitutes an ingredient or dish (e.g. 'ikan is nila', 'unsweetened tea', 'chicken instead of beef'), you MUST update the dishName, genericEnglishName, and foods[].foodName to the new substituted food (e.g. 'Ikan Nila' / 'tilapia' instead of 'Cakalang' / 'Cendro') and adjust the nutrients (calories, protein, fat, carbs, sugar) accordingly.\n` +
            `3. SEPARATE DISHES: Keep distinct plated items, sides, and beverages as separate distinct dishes in the dishes[] array. Never merge drinks into food dishes.\n` +
            `4. CLINICAL ADVICE & NARRATIVE: Provide an updated constructive 35-70 word clinicalAdvice in 2nd person ("You got...") covering key nutritional assets of the updated meal, metabolic/glycemic impact of the change, and actionable next steps/movement.`;
        } else {
          scoutPromptText = buildVisualScoutPrompt(message || '', imageCount);
        }
        const resolvedScoutSystemInstruction = withScoutLanguage(scoutSystemInstruction, userProfile?.language);
        scoutInstructionForDebug = {
          systemInstruction: resolvedScoutSystemInstruction,
          userPrompt: scoutPromptText,
        };
        sendLog('scout_instruction', 'scout', `Vision Scout Instruction dispatched (model: ${engine || "gemini-3.5-flash-lite"}). Prompt length: ${scoutPromptText.length} chars — see [UnifiedLLM-Prompt:scout] below for full text.`);
        sendLog('scout_system_instruction', 'scout', `Vision Scout System Instruction dispatched (model: ${engine || "gemini-3.5-flash-lite"}) — see [UnifiedLLM-Prompt:scout] below for full text.`);
        addDebugLog(`[Vision Scout] Running Stage 3 lightweight vision scout with retry protection...`);
        let { scoutResult, lastScoutErr } = await runScoutRetryLoop({
          engine,
          language: userProfile?.language,
          scoutPromptText,
          imagePayloads,
          isCompare: userSelectedMode === 'compare',
          message,
          callUnifiedLLM,
          sleep: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
          onLog: addDebugLog,
          onStreamChunk: (chunk: string, isThought?: boolean) => {
            if (isStream && hasSentHeaders) {
              try {
                res.write(`data: ${JSON.stringify({ type: 'stream', chunk, stage: 'scout' })}\n\n`);
                if (typeof (res as any).flush === 'function') (res as any).flush();
              } catch (e) {}
            }
          },
        });
        if (!scoutResult) {
          addDebugLog(`[Vision Scout Failed Permanently] Both attempts failed. Last error: ${lastScoutErr?.message}`);
          throw buildScoutFailureError(lastScoutErr, userProfile?.language);
        }
        const scoutState = applyScoutResultState({
          scoutResult,
          requestedMode: req.body.userSelectedMode,
          hasActiveMealDocument,
          activeMealDining: activeMeal?.diningEnvironment,
          currentRecommendedMode: scoutRecommendedMode,
          onLog: addDebugLog,
          onEvent: (type, stage, message, data) => sendLog(type, stage, message, data),
          onStream: (event) => sendStreamEvent(event),
        });
        scoutInternalReasoning = scoutState.scoutInternalReasoning;
        rawScoutData = scoutState.rawScoutData;
        visionScoutItems = scoutState.visionScoutItems;
        scoutConfidenceRating = scoutState.scoutConfidenceRating;
        scoutConfidenceComment = scoutState.scoutConfidenceComment;
        scoutCookingMethod = scoutState.scoutCookingMethod;
        visionScoutContentType = scoutState.visionScoutContentType;
        diningEnvironment = scoutState.diningEnvironment;
        scoutRecommendedMode = scoutState.scoutRecommendedMode;
        queriesToSearch.push(...scoutState.queriesToSearch);
        scoutOriginalQueries.push(...scoutState.queriesToSearch);
        visionScoutRanAndReturnedItems = scoutState.visionScoutRanAndReturnedItems;
        if (hasActiveMealDocument && Array.isArray(activeMeal.itemsBreakdown) && activeMeal.itemsBreakdown.length > 0) {
          visionScoutItems = mergeScoutIntoActiveMeal({ activeMealItemsBreakdown: activeMeal.itemsBreakdown, visionScoutItems, onLog: addDebugLog, isModify: isModifySession, userLockedSlots: activeMeal?.userLockedSlots, userMessage: message });
        }
        logScoutItemSummaries(visionScoutItems, addDebugLog);
        emitStageUsage('scout');
      }
      }
    }
    const bracketItems = parseBracketedFoodItems(message || '');
    if (bracketItems.length > 0) {
      addDebugLog(`[Bracket Pre-Extracted] Found ${bracketItems.length} pre-extracted bracket item(s) in message: ${bracketItems.map(b => `"${b.originalName}" (${b.estimatedWeightGrams}g)`).join(', ')}`);
      applyBracketPreExtract({ bracketItems, visionScoutItems, queriesToSearch, onLog: addDebugLog });
      visionScoutRanAndReturnedItems = visionScoutItems.length > 0;
    }

    const priorDispatches: any[] = Array.isArray(req.body?.dispatches)
      ? req.body.dispatches
      : (Array.isArray(activeMeal?.dispatches) ? activeMeal.dispatches : []);

    accumulatedDispatches = [...priorDispatches];

    if (scoutInstructionForDebug || rawScoutData) {
      const scoutTurnNumber = accumulatedDispatches.filter((d: any) => d.agent === 'scout').length + 1;
      const currentScoutDispatch = {
        id: `t${scoutTurnNumber}/scout`,
        parent: scoutTurnNumber > 1 ? `t${scoutTurnNumber - 1}/scout` : null,
        turn: scoutTurnNumber,
        agent: 'scout',
        user: (message && message.trim()) ? message.trim() : (imagePayloads && imagePayloads.length > 0 ? 'Analyze this meal photo.' : 'Text meal entry'),
        received: {
          photoCount: imagePayloads?.length || (req.body.photoUrl ? 1 : 0),
          ...(imagePayloads?.[0]?.photoUrl ? { photoUrl: imagePayloads[0].photoUrl } : (req.body.photoUrl ? { photoUrl: req.body.photoUrl } : {})),
          ...(message ? { userMessage: message } : {}),
          mode: isModifySession ? 'edit' : (req.body.userSelectedMode || req.body.mode || 'new_log'),
          ...(diningEnvironment ? { diningEnvironment } : {}),
        },
        systemInstruction: scoutInstructionForDebug?.systemInstruction,
        userPrompt: scoutInstructionForDebug?.userPrompt,
        instruction: scoutInstructionForDebug?.systemInstruction
          ? `=== SYSTEM INSTRUCTION ===\n${scoutInstructionForDebug.systemInstruction}\n\n=== USER PROMPT ===\n${scoutInstructionForDebug.userPrompt || ''}`
          : scoutInstructionForDebug?.userPrompt,
        rawEmission: rawScoutData || undefined,
        output: rawScoutData || visionScoutItems || undefined,
        model: engine || 'gemini-3.5-flash-lite',
        latency_ms: undefined,
        tokens: undefined,
        error: null,
      };
      accumulatedDispatches.push(currentScoutDispatch);
    }
    // Strip parenthetical local-language notes for cleaner USDA/OFF matching
    // e.g. "raw beef slices (daging empal and blade)" → "raw beef slices"
    const hasImage = imagePayloads && imagePayloads.length > 0;
    // Only treat this as a "big menu browse" for search-skipping purposes when the scout
    // actually recommends evaluation/browsing mode. A menu-board photo taken to log one
    // specific consumed dish (scoutRecommendedMode === "new_log") should still get real
    // nutrition search for that item, even though the source photo is a menu_or_poster.
    const isMenuScale = checkMenuScaleBypass({ visionScoutContentType, scoutRecommendedMode });
    if (Array.isArray(req.body.explicitFoodTags) && req.body.explicitFoodTags.length > 0) {
      injectExplicitFoodTags({ visionScoutItems, explicitFoodTags: req.body.explicitFoodTags, onLog: addDebugLog });
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
        inferPackagedBindChains({ packagedBindItems, onLog: addDebugLog });
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
      databaseMatches = await runDatabaseSearchStage(
        {
          uniqueQueries,
          visionScoutItems,
          visionScoutContentType,
          detectedChainKey,
          explicitFoodTags: req.body.explicitFoodTags,
          engine,
          databaseMatchesArray,
          dbMatchMap,
          quarantinedIdsSet,
        },
        {
          sendStreamEvent,
          flushRes: () => { if (typeof (res as any).flush === 'function') (res as any).flush(); },
          sendLog,
          addDebugLog,
          searchUSDA,
          searchOpenFoodFacts,
          searchBrandMenuItems,
          isKnownDatabaseBrand,
          isKnownDatabaseBrandSync,
          getBrandMenuItemById,
          isUsableWebNutritionHit,
          brandHitFitsQuery,
          extractUSDANutrientsPer100g,
          extractOFFNutrientsPer100g,
          resolveInternalFood,
          resolveDishCache,
          rankAndClassifyCandidates,
          writeAliasIfHitUnique,
          sanitizeDishTitle,
          normalizeFoodKey,
          fetchUSDAFoodById,
          fetchOFFProductByBarcode,
          getFallbackCategoryProfile,
          recordFoodObservation,
          upsertFoodItemCandidate,
          upsertFoodAlias,
          callUnifiedLLM,
          executeFoodResolverCurator,
          importSupabaseAdmin: async () => await import('./supabaseAdmin.js'),
          selfCleanBrandDatabase,
        }
      );
    }




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


    // Enrich scout items & sub-components with resolved brand / database matches before portion clarification
    enrichScoutComponentsWithMatches(visionScoutItems, databaseMatchesArray);
    // Task 2: portionClarify check — now placed AFTER DB search and Resolver so ALL candidates are available.
    // B1 — Pause before nutrient calculation when multi-serve pack portion is ambiguous.
    // Resume path: skipScout + activeScoutItems + portionChoices + resolvedDbCandidates (no second scout/DB).
    // Non-blocking serving size check:
    // When packGrams and weightGrams differ (or portion is ambiguous), compute clarification payload
    // to attach to the final meal. The pipeline does NOT block — full nutrient calculation, pre-calc,
    // clinical advice, and final verdict complete immediately. The user can confirm or adjust serving
    // sizes on the completed card.
    const portionClarify = buildPortionClarifyPayload(visionScoutItems);
    if (portionClarify) {
      addDebugLog(
        `[PortionClarify] Non-blocking clarification check attached for: ${portionClarify.items.map((i) => i.name).join('; ')}`
      );
    }
    // Brand Environment Locking logic
    let dominantBrand = detectDominantBrand({ message, visionScoutItems, onLog: addDebugLog });
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
      const hintFetchTasks = collectFdcHintTasks(visionScoutItems);
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
          const relevant = isFdcHintRelevant(task.query, food.description);
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
          if (vItem._alreadyFinalized && vItem.nutrients && !isModifySession) {
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
            diningEnvironment: diningEnvironment || vItem.diningEnvironment,
          });
        })
      );
      preCalculatedItems = mapLedgersToPrecalcItems({ ledgers, visionScoutItems, onLog: addDebugLog });
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
    // Dietitian prompt contexts removed with the dietitian call (all builders
    // in server_food_prompt_context.ts fed only the unsent prompt).
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
    // Dietitian LLM removed: no prompt is built and no call is dispatched.
    // Precalc math that the ledger depends on stays: the density rescale below.
    // (The projector assembly that used to extend the dietitian prompt is gone;
    // its stage-lifecycle bookkeeping guarded a call that no longer exists.)
    // Pre-dietitian density check: ensure beverage and composite items are rescaled (ledger math, kept).
    aggregatedNutrients = applyPreDietitianDensityCheck({ preCalculatedItems, aggregatedNutrients, beveragePattern: BEVERAGE_RAW_PATTERN, onLog: addDebugLog });
    sendStreamEvent({ type: 'status', stage: 'dietitian', status: 'started', message: 'Analyzing nutrition payload...' });
    let textOutput: string = "";
    let rawParsed: any;
    const { canSkipDietitianForPureScale } = computeDietitianSkipGates({
      isPureWeightModification, activeMeal, userSelectedMode, weightRefineIntent, message,
    });
    if (canSkipDietitianForPureScale && weightRefineIntent.isRefine && weightRefineIntent.weightGrams) {
      const targetWeight = weightRefineIntent.weightGrams;
      addDebugLog(`[Refine] skip-dietitian: Scaled label-locked meal directly to ${targetWeight}g without LLM call.`);
      sendStreamEvent({ type: 'status', stage: 'dietitian', status: 'completed', message: interpolate(t(userProfile?.language, 'statusScaledPortion'), { grams: targetWeight }) });
      const pureScale = buildPureScaleResponse({ targetWeightGrams: targetWeight, language: userProfile?.language });
      textOutput = pureScale.textOutput;
      rawParsed = pureScale.rawParsed;
    } else {
      addDebugLog(`[MealAgent] Initiating Dietitian LLM evaluation...`);
      
      const systemCurrentDate = new Date().toISOString().split('T')[0];
      const timeCtx = buildTimeContext({ timezone: userProfile?.timezone });
      const userCtx = buildUserContext(userProfile);
      const historyContext = buildHistoryContext(history);
      const imageCtx = buildImageContext(imagePayloads, imageDates);
      const visionScoutCtx = buildVisionScoutContext({
        visionScoutItems,
        visionScoutContentType,
        scoutConfidenceRating,
        scoutConfidenceComment,
        scoutCookingMethod,
        diningEnvironment,
        userSelectedMode,
        isExplicitModify,
        hasActiveMeal: !!effectiveActiveMeal,
        hasComparison: false,
        hasImages: hasUploadedNewImages,
      });
      const biomarkersCtx = buildBiomarkersContext(biomarkersNeedingImprovement);

      const systemInstruction = selectSystemInstruction({
        userSelectedMode,
        isExplicitModify,
        effectiveActiveMeal,
        activeComparisonState: null,
        biomarkersNeedingImprovement,
        remainingAllowance,
        foodLogs,
        userProfile,
        visionScoutItems,
      });

      let { promptText, fullPromptSent } = stitchFoodPrompt({
        systemInstruction,
        userSelectedMode,
        biomarkersCtx,
        visionScoutCtx,
        databaseMatchesCtx: buildDatabaseMatchesContext('', ''),
        historyContext,
        pastMealsCtx: '',
        userCtx,
        timeCtx,
        imageCtx,
        message,
      });

      const precalcRes = assemblePrecalcPromptBlock({
        preCalculatedItems,
        activeMeal: effectiveActiveMeal,
        aggregatedNutrients,
        userProfile,
        promptText,
        fullPromptSent,
        onLog: addDebugLog
      });
      promptText = precalcRes.promptText;
      fullPromptSent = precalcRes.fullPromptSent;
      
      addDebugLog(`[MealAgent] Dispatched System Instruction:
${systemInstruction}`);
      addDebugLog(`[MealAgent] Dispatched Prompt:
${promptText}`);

      const responseText = await callUnifiedLLM({
        modelId: engine || 'gemini-3.5-flash-lite',
        systemInstruction,
        promptText,
        imagePayloads: imagePayloads || [],
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
        temperature: 0.2,
        logStagePrefix: 'dietitian',
        onStream: (chunk: string, isThought?: boolean) => {
          if (isStream && hasSentHeaders) {
             try {
               res.write(`data: ${JSON.stringify({ type: 'stream', chunk, stage: 'dietitian' })}

`);
               if (typeof (res as any).flush === 'function') (res as any).flush();
             } catch(e) {}
          }
        }
      });
      
      textOutput = responseText;
      addDebugLog(`[MealAgent] Raw Dietitian LLM Response (${textOutput.length} chars):
${textOutput}`);
      
      try {
        const cleaned = textOutput.replace(/^```(?:json)?|```$/gm, '').trim();
        rawParsed = JSON.parse(cleaned);
      } catch (err: any) {
        addDebugLog(`[MealAgent] Failed to parse Dietitian JSON: ${err.message}`);
        throw new Error("Failed to parse Dietitian LLM output as JSON");
      }
    }
    if (rawParsed._internalReasoning) {
      addDebugLog(`[MealAgent Internal Reasoning]\n${rawParsed._internalReasoning}`);
    }
    const dietitianScratchpad = rawParsed?._internalReasoning || "";
    sendStreamEvent({ type: 'status', stage: 'dietitian', status: 'completed', message: 'Meal analysis finalized.' });
    normalizeParsedPostDietitian({ rawParsed, isExplicitModify, userSelectedMode, visionScoutItems });
    const originalModeIsModify = !!(
      isExplicitModify ||
      userExplicitlySelectedEditMode ||
      (activeMeal && (!imagePayloads || imagePayloads.length === 0))
    );
    let mode = resolveFoodAnalyzeMode({
      rawMode: rawParsed.mode,
      originalModeIsModify,
      userSelectedMode,
      visionScoutItemCount: visionScoutItems?.length,
      hasActiveMealDocument,
      editCommandCount: (Array.isArray(rawParsed.editCommands) ? rawParsed.editCommands.length : 0) +
        (Array.isArray(rawParsed.modificationCommand) ? rawParsed.modificationCommand.length : 0),
      onLog: addDebugLog,
    });
    apiCalls = buildFoodApiCalls({
      hasImage,
      queriesToSearch,
      engine,
    });
    // CASE F: food origin lookup mode
    // CASE B: discussion mode
    if (mode === "discussion") {
      addDebugLog(`[Mode Routing] DISCUSSION mode triggered (0 database operations).`);
      return res.json(buildDiscussionResponse({
        rawParsed,
        agentInstructions: { scout: scoutInstructionForDebug },
        dispatches: accumulatedDispatches,
        apiCalls,
      }));
    }
    // CASE D: evaluation mode
    if (mode === "evaluation") {
      addDebugLog(`[Mode Routing] EVALUATION mode triggered.`);
      const comparisonData = rawParsed.comparison || { groups: [] };
      const preCalcByScoutIndex = await runEvaluationFinalize({ visionScoutItems, diningEnvironment, onLog: addDebugLog });
      const { comparisonData: resolvedComparisonData, comparisonSet } = assembleEvaluationComparison({
        comparisonData, visionScoutItems, preCalcByScoutIndex, isMenuScale,
        language: userProfile?.language, jobId: req.body.jobId, onLog: addDebugLog,
      });
      const responsePayload = buildEvaluationResponse({
        rawParsed, scoutInternalReasoning, rawScoutData, comparisonData: resolvedComparisonData, comparisonSet,
        scoutItems: mergeScoutItems(visionScoutItems, rawParsed.scoutItems),
        scoutContentType: visionScoutContentType, diningEnvironment,
        agentInstructions: { scout: scoutInstructionForDebug },
        dispatches: accumulatedDispatches,
        apiCalls,
      });
      return res.json(responsePayload);
    }
    // CASE A: NEW FOOD LOGGING
    if (mode === "new_log") {
      const rawFoodData = rawParsed.foodData || {};
      if (!rawFoodData.itemsBreakdown || rawFoodData.itemsBreakdown.length === 0) {
        // Build itemsBreakdown from Vision Scout output + best DB match per item
        const fallback = buildFallbackItemsBreakdown({ visionScoutItems, databaseMatchesArray, quarantinedIdsSet, onLog: addDebugLog });
        if (fallback) rawFoodData.itemsBreakdown = fallback;
      }
      const header = assembleParsedMealHeader({ rawFoodData, rawParsed, imageDates, message, originalModeIsModify, activeMeal, scoutCookingMethod, scoutConfidenceRating, scoutConfidenceComment, diningEnvironment, language: userProfile?.language });
      const parsedData: any = header.parsedData;
      diningEnvironment = header.diningEnvironment;
      mapFinalizeToMeal({ preCalculatedItems, rawFoodData, diningEnvironment, parsedData, rawParsed, onLog: addDebugLog, sendLog });
      // Ensure composition is always derived from the final itemsBreakdown names & visual ingredient breakdown
      if (parsedData.itemsBreakdown && Array.isArray(parsedData.itemsBreakdown)) {
        parsedData.composition = deriveMealComposition(parsedData.itemsBreakdown);
      }
      resolveMealImageUrls({ body: req.body, images, image, parsedData });
      if (originalModeIsModify) {
        parsedData.id = req.body.activeMeal?.id;
        if (!parsedData.imageUrl) parsedData.imageUrl = req.body.activeMeal?.imageUrl || req.body.activeMeal?.imageUrls?.[0];
        if (!parsedData.imageUrls || (parsedData.imageUrls.length > 0 && parsedData.imageUrls[0] === "[base64_image_data_truncated]")) parsedData.imageUrls = req.body.activeMeal?.imageUrls;
        let updatedScoutItems = mergeModifyPathScoutItems({ visionScoutItems, activeMealScoutItems: req.body.activeMeal?.scoutItems, dietitianScoutItems: rawParsed.scoutItems, itemsBreakdown: parsedData.itemsBreakdown });
        addDebugLog('[MealBuild] modify-path');
        const { mealBuild, pendingFoodLog } = attachHappyPathMealBuild({
          parsedData,
          jobId: req.body.jobId,
          activeMeal: req.body.activeMeal,
          scoutItems: updatedScoutItems,
          diningEnvironment,
        });
        if (portionClarify) {
          if (pendingFoodLog) (pendingFoodLog as any).portionClarify = portionClarify;
          parsedData.portionClarify = portionClarify;
        }
        const finalMeal = pendingFoodLog || parsedData;
        const gate = evaluateMealGate(buildNewLogGateInput({ finalMeal, jobId: req.body.jobId, photoUrl: req.body.photoUrl, imagePayloads, narrative: rawParsed.message }));
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
          agentInstructions: { scout: scoutInstructionForDebug },
          scoutItems: updatedScoutItems,
          rawScout: rawScoutData,
          dispatches: accumulatedDispatches,
          apiCalls,
          portionClarify: portionClarify || null,
        });
      }
      const isResumedFromImageTurn = checkResumedFromImageTurn({ body: req.body, visionScoutItems, history });
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
      let finalScoutItems = mergeFinalScoutItems({ visionScoutItems, dietitianScoutItems: rawParsed.scoutItems, preCalculatedItems, itemsBreakdown: parsedData.itemsBreakdown });
      addDebugLog('[MealBuild] happy-path');
      const { mealBuild, pendingFoodLog } = attachHappyPathMealBuild({
        parsedData,
        jobId: req.body.jobId,
        activeMeal: req.body.activeMeal,
        scoutItems: finalScoutItems,
        diningEnvironment,
      });
      if (portionClarify) {
        if (pendingFoodLog) (pendingFoodLog as any).portionClarify = portionClarify;
        parsedData.portionClarify = portionClarify;
      }
      const finalMeal = pendingFoodLog || parsedData;
      const gate = evaluateMealGate(buildNewLogGateInput({ finalMeal, jobId: req.body.jobId, photoUrl: req.body.photoUrl, imagePayloads, narrative: rawParsed.message }));
      const responsePayload = buildNewLogResponse({
        rawParsed, parsedData, pendingFoodLog, mealBuild, gate, scoutInternalReasoning,
        rawScoutData, scoutContentType: visionScoutContentType, diningEnvironment,
        agentInstructions: { scout: scoutInstructionForDebug },
        scoutItems: finalScoutItems,
        dispatches: accumulatedDispatches,
        apiCalls,
        portionClarify,
      });
      return res.json(responsePayload);
    }
    // CASE C: modification commands mode (Math-only fallbacks)
    if (mode === "modify") {
      addDebugLog(`[Mode Routing] MODIFY mode triggered (Math Fallback).`);
      let activeMeal = req.body.activeMeal;
      if (!activeMeal) {
        addDebugLog(`[Modify Math Error] No active meal exists in Firestore to modify. jobId=${req.body.jobId || 'n/a'} imageCount=${(imagePayloads && imagePayloads.length) || 0} message="${(message || '').substring(0, 80)}"`);
        return res.json(buildModifyNoMealResponse({ rawParsed, apiCalls }));
      }
      {
        let editCommands = backfillEditCommandEstimates(rawParsed);
        const scoutTurnNumberForEdit = accumulatedDispatches.filter((d: any) => d.agent === 'scout').length || 1;
        const result = await applyMealEdits({
          items: Array.isArray(activeMeal.itemsBreakdown) ? activeMeal.itemsBreakdown : [],
          commands: Array.isArray(editCommands) ? editCommands : [],
          userMessage: message || '',
          scoutItems: visionScoutItems || preCalculatedItems || [],
          priorLocks: activeMeal?.userLockedSlots || [],
          turn: scoutTurnNumberForEdit,
        });
        for (const note of result.notes) addDebugLog(`[Single-Path Edit] ${note}`);
        if (Array.isArray((result as any).appliedCommands) && (result as any).appliedCommands.length > 0) {
          editCommands = (result as any).appliedCommands;
        }
        if (result.changed) {
          appendEditHistoryEntry({ activeMeal, message, result, onLog: addDebugLog });
        }
        activeMeal.itemsBreakdown = result.items;
        activeMeal.nutrients = result.nutrients;
        activeMeal.weightGrams = result.weightGrams;
        activeMeal.serving_grams = result.weightGrams;
        activeMeal.receiptTable = result.receiptTable;
        activeMeal.composition = result.items.map((it: any) => it.name).join(', ');
        const incomingTitle = resolveModifyIncomingTitle(activeMeal.name, rawParsed.foodData?.name);
        const resolvedTitle = resolveEditedMealTitle({ incomingTitle, items: result.items, editCommands });
        if (resolvedTitle) activeMeal.name = resolvedTitle;

        // Clinical verdict preservation & consistency:
        // If prior meal had a warning/alert level, and the edited meal still exceeds
        // metabolic warning thresholds (saturated fat >= 8g, sodium >= 1000mg, calories >= 900kcal),
        // preserve the warning level and sanitize the label for the updated nutrients.
        const priorVerdict = activeMeal.verdict || req.body.activeMeal?.verdict;
        const isHighSatFat = (result.nutrients?.saturatedFat || 0) >= 8;
        const isHighSodium = (result.nutrients?.sodium || 0) >= 1000;
        const isHighCalories = (result.nutrients?.calories || 0) >= 900;
        const shouldWarn = isHighSatFat || isHighSodium || isHighCalories;
        const priorLevel = priorVerdict?.level || 'neutral';
        const effectiveLevel = ((priorLevel === 'warning' || priorLevel === 'alert') && shouldWarn)
          ? priorLevel
          : (rawParsed.verdict?.level || priorLevel);
        const effectiveRawLabel = rawParsed.verdict?.label || priorVerdict?.label || (effectiveLevel === 'warning' ? 'Elevated saturated fat impact' : 'Mindful balance');
        const sanitizedVerdictLabel = sanitizeVerdictLabel(effectiveRawLabel, effectiveLevel, result.nutrients, userProfile?.language);
        activeMeal.verdict = {
          label: sanitizedVerdictLabel,
          level: effectiveLevel,
        };
        // Sync scoutItems (used by the "Meal composition" chips/gallery in the UI)
        // with any name changes applied to itemsBreakdown by this edit. Without this,
        // renames from set_modifier/replace_identity (e.g. "Es Teh Manis" -> "Unsweetened
        // Iced Tea") update the nutrition ledger but the chip label stays on the old name
        // forever, because the chips read scoutItems.originalName/keyword, not itemsBreakdown.
        // Base order matters: the persisted turn-1 items carry grounded boxes.
        // visionScoutItems on a zero-image edit are an ungrounded re-observation
        // (dummy boxes), so the request's turn-1 activeScoutItems outrank them.
        const baseScoutItemsForEdit = (activeMeal.scoutItems && activeMeal.scoutItems.length > 0)
          ? activeMeal.scoutItems
          : ((req.body.activeScoutItems && req.body.activeScoutItems.length > 0)
            ? req.body.activeScoutItems
            : (visionScoutItems || []));
        const syncedScoutItemsForEdit = syncEditScoutItems({ baseScoutItems: baseScoutItemsForEdit, resultItems: result.items });
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
        if (Array.isArray((result as any).userLockedSlots)) {
          activeMeal.userLockedSlots = (result as any).userLockedSlots;
          addDebugLog(`[PatchLedger] userLockedSlots=${JSON.stringify(activeMeal.userLockedSlots)}`);
        }
        const { mealBuild, pendingFoodLog } = attachHappyPathMealBuild({
          parsedData: activeMeal,
          jobId: req.body.jobId,
          activeMeal: req.body.activeMeal,
          scoutItems: syncedScoutItemsForEdit,
          diningEnvironment: activeMeal?.diningEnvironment,
        });
        mealBuild.staleDietitianNarrative = false;
        if (pendingFoodLog && Array.isArray(activeMeal.userLockedSlots)) {
          pendingFoodLog.userLockedSlots = activeMeal.userLockedSlots;
          (mealBuild as any).userLockedSlots = activeMeal.userLockedSlots;
        }
        if (req.body.jobId && Array.isArray(activeMeal.userLockedSlots)) {
          const memJob = getInMemoryServerJob(String(req.body.jobId));
          if (memJob) {
            memJob.userLockedSlots = activeMeal.userLockedSlots;
            if (memJob.clean_result && typeof memJob.clean_result === 'object') {
              memJob.clean_result.userLockedSlots = activeMeal.userLockedSlots;
              if (memJob.clean_result.pendingFoodLog) {
                memJob.clean_result.pendingFoodLog.userLockedSlots = activeMeal.userLockedSlots;
              }
            }
            addDebugLog(`[PatchLedger] persisted ${activeMeal.userLockedSlots.length} lock(s) on job ${req.body.jobId}`);
          }
        }
        if (pendingFoodLog) {
          pendingFoodLog.itemsBreakdown = result.items;
          pendingFoodLog.items = result.items;
          pendingFoodLog.nutrients = result.nutrients;
          pendingFoodLog.weightGrams = result.weightGrams;
        }
        const finalMeal = pendingFoodLog || activeMeal;
        const gate = evaluateMealGate(buildGateInput({
          finalMeal, jobId: req.body.jobId, photoUrl: req.body.photoUrl, imagePayloads,
          finalMessage, previousMeal: req.body.activeMeal, editCommands,
        }));
        // Pipeline parity: emit dietitian/expert dispatch I/O on every edit turn
        // (projector narrative — same contract as create's dietitian_answer).
        const expertTurn = accumulatedDispatches.filter((d: any) => d.agent === 'scout').length || 1;
        const effectiveEditCommands = (Array.isArray((result as any).appliedCommands) && (result as any).appliedCommands.length > 0)
          ? (result as any).appliedCommands
          : (Array.isArray(editCommands) ? editCommands : []);
        const expertDispatch = buildEditExpertDispatch({
          turn: expertTurn,
          userMessage: message || '',
          finalMessage,
          editCommands: effectiveEditCommands,
          items: result.items,
          nutrients: result.nutrients,
          skipped: false,
          model: 'projector',
        });
        accumulatedDispatches.push(expertDispatch);
        sendLog('dietitian_answer', 'dietitian', finalMessage, {
          mode: 'modify',
          turn: expertTurn,
          editApplied: result.changed,
        });
        addDebugLog(`[PatchLedger] expert dispatch t${expertTurn}/dietitian recorded (edit parity).`);
        return res.json(buildModifyResponse({
          rawParsed, finalMessage, pendingFoodLog, activeMeal, mealBuild, gate,
          editApplied: result.changed,
          agentInstructions: { scout: scoutInstructionForDebug },
          scoutItems: syncedScoutItemsForEdit,
          rawScoutData,
          dispatches: accumulatedDispatches,
          apiCalls,
        }));
      }
    }
  } catch (error: any) {
    console.error("[Food Analyze Error]:", error);
    // Dietitian Degrade logic (Phase 1)
    if (preCalculatedItems && preCalculatedItems.length > 0 && preCalculatedItems.some((p: any) => (p.nutrients && p.nutrients.calories != null) || (p.primaryBase100g && p.primaryBase100g.calories !== undefined))) {
      addDebugLog(`[Dietitian Degrade] Dietitian failed permanently, but pre-calculated math exists. Salvaging meal build.`);
      const salvagedAggregatedNutrients = sumSalvagedAggregates(preCalculatedItems);
      const salvagedMeal = buildSavableMealFromParsed(preCalculatedItems, req.body.activeMeal, salvagedAggregatedNutrients, null);
      const degradedMeal = markDietitianDegraded(salvagedMeal, error.message);
      const payloadData = toPendingFoodLog(degradedMeal);
      const successPayload = buildDegradeResponse({
        payloadData, degradedMeal, visionScoutItems,
        scoutContentType: visionScoutContentType,
        agentInstructions: { scout: scoutInstructionForDebug },
        dispatches: accumulatedDispatches,
        apiCalls,
      });
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
