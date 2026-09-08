import { AnalyzeRunContext } from './server_food_analyze_run_types.js';
import { computeDietitianSkipGates, isAcceptDefaultsWithinTolerance, composeAcceptDefaultsParsed, decideScoutVerdict, decideScoutAdvice, buildPureScaleResponse, sumPrecalcTotals, buildCreateSkipResponse, resolveCreateMealTitle, PROJECTOR_NARRATOR_INSTRUCTION } from '../server_food_dietitian_dispatch.js';
import { buildTimeContext, buildUserContext, buildHistoryContext, buildImageContext, buildVisionScoutContext, buildBiomarkersContext, selectSystemInstruction, stitchFoodPrompt, buildDatabaseMatchesContext, assemblePrecalcPromptBlock } from "../server_food_prompt_context.js";
import { getCurrentDateInTimezone } from '../../utils/dateUtils.js';
import { interpolate } from '../../utils/i18n.js';
import { t } from '../../utils/translations.js';
import { diffScoutToEditCommands } from '../server_meal_edit.js';
import { normalizeParsedPostDietitian } from '../server_food_mode_routing.js';

export async function executeDietitianPhase(ctx: AnalyzeRunContext): Promise<{ textOutput: string, rawParsed: any, narratorInput: any }> {
  let textOutput: string = "";
  let rawParsed: any;
  let narratorInput: any = null;

  const { canSkipDietitianForPureScale } = computeDietitianSkipGates({
    isPureWeightModification: ctx.isPureWeightModification,
    activeMeal: ctx.activeMeal,
    userSelectedMode: ctx.userSelectedMode,
    weightRefineIntent: ctx.weightRefineIntent,
    message: ctx.message,
  });

  if (canSkipDietitianForPureScale && ctx.weightRefineIntent.isRefine && ctx.weightRefineIntent.weightGrams) {
    const targetWeight = ctx.weightRefineIntent.weightGrams;
    ctx.addDebugLog(`[Refine] skip-dietitian: Scaled label-locked meal directly to ${targetWeight}g without LLM call.`);
    ctx.sendStreamEvent({ type: 'status', stage: 'dietitian', status: 'completed', message: interpolate(t(ctx.userProfile?.language, 'statusScaledPortion'), { grams: targetWeight }) });
    const pureScale = buildPureScaleResponse({ targetWeightGrams: targetWeight, language: ctx.userProfile?.language });
    textOutput = pureScale.textOutput;
    rawParsed = pureScale.rawParsed;
    narratorInput = {
      systemInstruction: PROJECTOR_NARRATOR_INSTRUCTION,
      userPrompt: `[projector] scale-only refine to ${targetWeight}g — no LLM call, ledger rescaled from locked label truth.`,
      model: 'projector', latencyMs: 0, tokens: 0, projected: true,
    };
  } else if (isAcceptDefaultsWithinTolerance({ portionChoices: ctx.req.body.portionChoices, scoutItems: ctx.visionScoutItems, isResume: Boolean(ctx.req.body.skipScout || ctx.req.body.portionChoices) })) {
    ctx.addDebugLog('[Accept] portion choices within 30% of estimates: skipping agent, composing from ledger.');
    ctx.sendStreamEvent({ type: 'status', stage: 'dietitian', status: 'completed', message: 'Meal analysis finalized.' });
    const acceptMealName = ctx.activeMeal?.name || ctx.visionScoutItems.map((v: any) => v?.keyword || v?.originalName || v?.name).filter(Boolean).slice(0, 3).join(', ') || undefined;
    const acceptParsed = composeAcceptDefaultsParsed({
      items: ctx.visionScoutItems, mealName: acceptMealName, language: ctx.userProfile?.language,
      targets: ctx.req.body.dailyNutrientTargets, foodLogs: ctx.req.body.foodLogs,
      todayStr: getCurrentDateInTimezone(ctx.userProfile?.timezone),
    });
    textOutput = JSON.stringify(acceptParsed);
    rawParsed = acceptParsed;
    narratorInput = {
      systemInstruction: PROJECTOR_NARRATOR_INSTRUCTION,
      userPrompt: `[projector] portion choices within tolerance — no LLM call, TS-composed message from ledger, targets, and rest-of-day math.`,
      model: 'projector', latencyMs: 0, tokens: 0, projected: true,
    };
  } else if (ctx.visionScoutRanAndReturnedItems || (ctx.visionScoutItems && ctx.visionScoutItems.length > 0) || ctx.rawScoutData) {
    if (ctx.isModifySession) {
      ctx.addDebugLog('[MealAgent] Single-agent edit path: diffing Scout output into active meal.');
      ctx.sendStreamEvent({ type: 'status', stage: 'dietitian', status: 'completed', message: 'Meal update finalized.' });
      const scoutDishes = (ctx.rawScoutData?.dishes && Array.isArray(ctx.rawScoutData.dishes))
        ? ctx.rawScoutData.dishes
        : (ctx.visionScoutItems || []);
      const priorItems = Array.isArray(ctx.activeMeal?.itemsBreakdown) ? ctx.activeMeal.itemsBreakdown : (ctx.activeMeal?.items || []);
      const editCommands = diffScoutToEditCommands({
        priorItems,
        scoutItems: scoutDishes,
        userMessage: ctx.message,
        portionChoices: (ctx.req.body as any)?.portionChoices,
      });
      const totals = sumPrecalcTotals(priorItems);
      const scoutVerdict = decideScoutVerdict({
        scoutVerdict: ctx.rawScoutData?.verdict || null,
        totals,
        mealName: ctx.activeMeal?.name,
        language: ctx.userProfile?.language,
      });
      const rawAdvice = decideScoutAdvice({
        rawAdvice: ctx.rawScoutData?.clinicalAdvice || ctx.rawScoutData?.message || '',
        totals,
        mealName: ctx.activeMeal?.name,
        language: ctx.userProfile?.language,
      });
      const systemCurrentDate = new Date().toISOString().split('T')[0];
      const mealDate = (ctx.isModifySession && ctx.activeMeal?.date)
        ? ctx.activeMeal.date
        : (ctx.imageDates?.[0] ? ctx.imageDates[0].split('T')[0] : systemCurrentDate);
      rawParsed = {
        _internalReasoning: ctx.scoutInternalReasoning || '[MealAgent] Single-agent edit path',
        mode: 'modify',
        message: rawAdvice || 'I have updated your meal.',
        verdict: scoutVerdict,
        modificationCommand: editCommands,
        foodData: {
          name: ctx.activeMeal?.name,
          date: mealDate,
        }
      };
      textOutput = JSON.stringify(rawParsed);
      narratorInput = {
        systemInstruction: PROJECTOR_NARRATOR_INSTRUCTION,
        userPrompt: `[projector] single-agent edit — diffed scout dishes into active meal without secondary LLM call.`,
        model: 'projector', latencyMs: 0, tokens: 0, projected: true,
      };
    } else {
      ctx.addDebugLog('[MealAgent] Single-agent create path: using Scout verdict & clinical advice with finalized ledger.');
      ctx.sendStreamEvent({ type: 'status', stage: 'dietitian', status: 'completed', message: 'Meal analysis finalized.' });
      const totals = sumPrecalcTotals(ctx.preCalculatedItems);
      const scoutVerdict = decideScoutVerdict({
        scoutVerdict: ctx.rawScoutData?.verdict || null,
        totals,
        mealName: resolveCreateMealTitle(ctx.rawScoutData, ctx.visionScoutItems, ctx.userProfile?.language),
        language: ctx.userProfile?.language,
      });
      const rawAdvice = decideScoutAdvice({
        rawAdvice: ctx.rawScoutData?.clinicalAdvice || ctx.rawScoutData?.message || '',
        totals,
        mealName: resolveCreateMealTitle(ctx.rawScoutData, ctx.visionScoutItems, ctx.userProfile?.language),
        language: ctx.userProfile?.language,
      });
      const createSkip = buildCreateSkipResponse({
        rawScoutData: ctx.rawScoutData,
        visionScoutItems: ctx.visionScoutItems,
        preCalculatedItems: ctx.preCalculatedItems,
        totals,
        scoutVerdict,
        rawAdvice,
        scoutConfidenceRating: ctx.scoutConfidenceRating,
        scoutConfidenceComment: ctx.scoutConfidenceComment,
        scoutCookingMethod: ctx.scoutCookingMethod,
        scoutInternalReasoning: ctx.scoutInternalReasoning,
        diningEnvironment: ctx.diningEnvironment,
        language: ctx.userProfile?.language,
      });
      textOutput = createSkip.textOutput;
      rawParsed = createSkip.rawParsed;
      narratorInput = {
        systemInstruction: PROJECTOR_NARRATOR_INSTRUCTION,
        userPrompt: `[projector] single-agent create — ledger finalized from scout truth and math engine.`,
        model: 'projector', latencyMs: 0, tokens: 0, projected: true,
      };
    }
  } else {
    ctx.addDebugLog(`[MealAgent] Initiating Dietitian LLM evaluation...`);
    const systemCurrentDate = new Date().toISOString().split('T')[0];
    const timeCtx = buildTimeContext({ timezone: ctx.userProfile?.timezone });
    const userCtx = buildUserContext(ctx.userProfile);
    const historyContext = buildHistoryContext(ctx.history);
    const imageCtx = buildImageContext(ctx.imagePayloads, ctx.imageDates);
    const visionScoutCtx = buildVisionScoutContext({
      visionScoutItems: ctx.visionScoutItems,
      visionScoutContentType: ctx.visionScoutContentType,
      scoutConfidenceRating: ctx.scoutConfidenceRating,
      scoutConfidenceComment: ctx.scoutConfidenceComment,
      scoutCookingMethod: ctx.scoutCookingMethod,
      diningEnvironment: ctx.diningEnvironment,
      userSelectedMode: ctx.userSelectedMode,
      isExplicitModify: ctx.isExplicitModify,
      hasActiveMeal: !!ctx.effectiveActiveMeal,
      hasComparison: false,
      hasImages: ctx.hasUploadedNewImages,
    });
    const biomarkersCtx = buildBiomarkersContext(ctx.biomarkersNeedingImprovement);
    const systemInstruction = selectSystemInstruction({
      userSelectedMode: ctx.userSelectedMode,
      isExplicitModify: ctx.isExplicitModify,
      effectiveActiveMeal: ctx.effectiveActiveMeal,
      activeComparisonState: null,
      biomarkersNeedingImprovement: ctx.biomarkersNeedingImprovement,
      remainingAllowance: ctx.remainingAllowance,
      foodLogs: ctx.foodLogs,
      userProfile: ctx.userProfile,
      visionScoutItems: ctx.visionScoutItems,
    });
    let { promptText, fullPromptSent } = stitchFoodPrompt({
      systemInstruction,
      userSelectedMode: ctx.userSelectedMode,
      biomarkersCtx,
      visionScoutCtx,
      databaseMatchesCtx: buildDatabaseMatchesContext('', ''),
      historyContext,
      pastMealsCtx: '',
      userCtx,
      timeCtx,
      imageCtx,
      message: ctx.message,
    });
    const precalcRes = assemblePrecalcPromptBlock({
      preCalculatedItems: ctx.preCalculatedItems,
      activeMeal: ctx.effectiveActiveMeal,
      aggregatedNutrients: ctx.aggregatedNutrients,
      userProfile: ctx.userProfile,
      promptText,
      fullPromptSent,
      onLog: ctx.addDebugLog
    });
    promptText = precalcRes.promptText;
    fullPromptSent = precalcRes.fullPromptSent;
    
    ctx.addDebugLog(`[MealAgent] Dispatched System Instruction:\n${systemInstruction}`);
    ctx.addDebugLog(`[MealAgent] Dispatched Prompt:\n${promptText}`);
    const responseText = await ctx.callUnifiedLLM({
      modelId: ctx.engine || 'gemini-3.5-flash-lite',
      systemInstruction,
      promptText,
      imagePayloads: ctx.imagePayloads || [],
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
      temperature: 0.2,
      logStagePrefix: 'dietitian',
      onStream: (chunk: string, isThought?: boolean) => {
        if (ctx.isStream && ctx.hasSentHeaders) {
          try {
            ctx.res.write(`data: ${JSON.stringify({ type: 'stream', chunk, stage: 'dietitian' })}\n\n`);
            if (typeof (ctx.res as any).flush === 'function') (ctx.res as any).flush();
          } catch(e) {}
        }
      }
    });
    
    textOutput = responseText;
    ctx.addDebugLog(`[MealAgent] Raw Dietitian LLM Response (${textOutput.length} chars):\n${textOutput}`);
    try {
      const cleaned = textOutput.replace(/^```(?:json)?|```$/gm, '').trim();
      rawParsed = JSON.parse(cleaned);
    } catch (err: any) {
      ctx.addDebugLog(`[MealAgent] Failed to parse Dietitian JSON: ${err.message}`);
      throw new Error("Failed to parse Dietitian LLM output as JSON");
    }
    const narratorUsage = ctx.takeUnifiedUsage('dietitian');
    const narratorMs = ctx.takeUnifiedTiming('dietitian');
    narratorInput = {
      systemInstruction,
      userPrompt: fullPromptSent,
      model: ctx.engine || 'gemini-3.5-flash-lite',
      latencyMs: narratorMs,
      tokens: narratorUsage ? narratorUsage.total : null,
    };
  }

  if (rawParsed._internalReasoning) {
    ctx.addDebugLog(`[MealAgent Internal Reasoning]\n${rawParsed._internalReasoning}`);
  }
  ctx.sendStreamEvent({ type: 'status', stage: 'dietitian', status: 'completed', message: 'Meal analysis finalized.' });
  
  normalizeParsedPostDietitian({ rawParsed, isExplicitModify: ctx.isExplicitModify, userSelectedMode: ctx.userSelectedMode, visionScoutItems: ctx.visionScoutItems });
  
  return { textOutput, rawParsed, narratorInput };
}
