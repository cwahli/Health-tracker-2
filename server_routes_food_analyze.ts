import { Router } from 'express';
import { Type } from '@google/genai';
import { z } from 'zod';
import { executeFoodResolverCurator } from './server_food_resolver_curator.js';
import {
  checkCategoryAndStateCompatibility,
  applyServerAverageNutrients,
  checkThermodynamicDensitySanity,
  checkArchetypeMacroBounds,
  applySatFatAndAddedSugarFloor,
  backfillSparseMicronutrients,
  extractBalancedJson,
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
  synthesizeEditCommandsFromBreakdown,
  evaluateNutrientWarnings,
  build31NutrientsMarkdownServer,
  enforceTitlePluralParity,
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
  portionAndReconcile,
  assertComponentSumMatchesItem,
  parseLabelCalories,
  applyPostReconcileTruthLocks,
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
import { projectDietitianInput } from './src/mealBuild/projectors.js';
import { beginStage, endStage, formatDietitianProjectionBlock } from './src/mealBuild/stageLifecycle.js';
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
import { aggregateItemsNutrients, cleanNutrientNumber } from './server_nutrient_aggregation.js';
import {
  isKnownDatabaseBrand,
  isKnownDatabaseBrandSync,
  fetchAllDatabaseBrands,
  searchBrandMenuItems,
  brandHitFitsQuery,
  normalizeChainKey,
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
} from './server_vision_scout.js';
import { buildVisualScoutPrompt, parseBracketedFoodItems } from './agents/scoutInstructions.js';
import { isDishEstimateEnabled } from './server_food_flags.js';
import { finalizeDishLedger } from './server_dish_finalize.js';
import { matchBrandMenu } from './server_brand_match.js';
import { classifyDishAtomic } from './server_dish_classify.js';
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
  extractOFFNutrientsPer100g,
  lookupChainMenuSources,
  isUsableWebNutritionHit,
  resolveComparisonGroups,
  retrieveFoodImages,
} from './server.js';

export const foodAnalyzeRouter = Router();

// GET Endpoint for System Instruction Preview
foodAnalyzeRouter.get("/api/gemini/instruction-preview", async (req, res) => {
  try {
    const { agentType, biomarkersNeedingImprovement, remainingAllowance, activeMeal } = req.query;
    
    if (agentType === 'food_scout') {
      const instruction = `You are a fast visual food identification agent. Look at the image and return a short list of plain-text search keywords for the food items you see (e.g. ['fried chicken', 'white rice', 'sambal']), plus a rough estimated weight in grams for each if visually judgeable. Do not do any nutrition or clinical analysis. Also try to identify any clues on how it's cooked (e.g., oil cooked, fried, steamed) or freshness (e.g., fresh fish). Include these details in your keywords if helpful. Output only: { "items": [{ "keyword": string, "estimatedWeightGrams": number }] }`;
      return res.json({ instruction });
    }

    if (agentType === 'food') {
      let parsedBiomarkers: any[] | undefined = undefined;
      let parsedAllowance: any = undefined;
      let parsedMeal: any = undefined;

      try {
        if (biomarkersNeedingImprovement && typeof biomarkersNeedingImprovement === 'string') {
          parsedBiomarkers = JSON.parse(biomarkersNeedingImprovement);
        }
      } catch (e) {}

      try {
        if (remainingAllowance && typeof remainingAllowance === 'string') {
          parsedAllowance = JSON.parse(remainingAllowance);
        }
      } catch (e) {}

      try {
        if (activeMeal && typeof activeMeal === 'string') {
          parsedMeal = JSON.parse(activeMeal);
        }
      } catch (e) {}

      // If they are not passed or empty, try to look up the user's synced context
      if (!parsedBiomarkers || !parsedAllowance) {
        const idToken = req.headers.authorization?.split('Bearer ')[1];
        if (idToken) {
          try {
            const decoded = await adminAuth.verifyIdToken(idToken);
            const uid = decoded.uid;
            
            if (db) {
              // Try to fetch reports/latest
              const reportRef = db.collection('users').doc(uid).collection('reports').doc('latest');
              const reportSnap = await reportRef.get();
              if (reportSnap.exists) {
                const reportData = reportSnap.data();
                if (reportData && Array.isArray(reportData.biomarkers)) {
                  parsedBiomarkers = reportData.biomarkers.filter((b: any) => b.status === 'At Risk' || b.status === 'HIGH' || b.status === 'LOW');
                }
              }

              // Try to fetch dashboard
              const dashRef = db.collection('users').doc(uid).collection('metadata').doc('dashboard');
              const dashSnap = await dashRef.get();
              if (dashSnap.exists) {
                const dashData = dashSnap.data();
                if (dashData) {
                  if (!parsedAllowance && dashData.remainingAllowance) {
                    parsedAllowance = dashData.remainingAllowance;
                  }
                  if (!parsedMeal && dashData.activeMeal) {
                    parsedMeal = dashData.activeMeal;
                  }
                }
              }
            }
          } catch (err) {
            console.warn("[instruction-preview] Error loading authenticated user context:", err);
          }
        }
      }

      // Safe placeholder values as fallback
      if (!parsedBiomarkers) {
        parsedBiomarkers = [];
      }
      if (!parsedAllowance) {
        parsedAllowance = {
          calories: 2000,
          saturatedFat: 20,
          sodium: 2300
        };
      }

      const instruction = buildFoodAnalyzeInstruction({
        biomarkersNeedingImprovement: parsedBiomarkers,
        remainingAllowance: parsedAllowance,
        activeMeal: parsedMeal
      });

      return res.json({ instruction });
    }

    return res.status(400).json({ error: "Unsupported agentType" });
  } catch (error: any) {
    console.error("[instruction-preview] Error:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

// Gemini Food Analyze Endpoint

// Health Preparation Agent
foodAnalyzeRouter.post("/api/gemini/front-desk", async (req, res) => {
  try {
    const { message, profile, biomarkers, foodLogs, biomarkerHistory, engine } = req.body;
    
    let targetModel = typeof engine === 'object' ? engine?.name || engine?.model || "gemini-3.5-flash-lite" : (engine || "gemini-3.5-flash-lite");
  

    const cleanedHistory = (biomarkerHistory || []).slice().reverse().map((item: any) => {
      if (!item) return item;
      const clean = { ...item };
      if (typeof clean.note === 'string') {
        clean.note = Array.from(new Set(clean.note.split(/[;|\n]/).map((s: string) => s.trim()).filter(Boolean))).join('; ');
      }
      if (typeof clean.summary === 'string') {
        clean.summary = Array.from(new Set(clean.summary.split(/[;|\n]/).map((s: string) => s.trim()).filter(Boolean))).join('; ');
      }
      return clean;
    });

    const prompt = `
You are the Health Preparation Agent. Your job is to answer the user's questions regarding their health data, and guide them on what they should do next.
You have access to their profile, biomarkers, and food logs.

<USER_DATA>
Profile: ${JSON.stringify(profile, null, 2)}
Biomarkers: ${JSON.stringify(biomarkers, null, 2)}
Food Logs (Last 5): ${JSON.stringify(foodLogs ? foodLogs.slice(0, 5) : [], null, 2)}
Recent Biomarker History (most recent first, up to 40 entries): ${JSON.stringify(cleanedHistory, null, 2)}
</USER_DATA>

If the user asks "What should I do?", analyze their data and see what is missing (e.g. missing age, weight, or missing biomarkers, or no food logs logged).
Advise them on which of the 5 specialized agents to use:
- Add Health Data
- Review Biomarkers
- Clinical Review
- Health Planning
- Medical Insights

If the user gives you information to update their profile (like their weight, height, age, blood type), you MUST include a JSON block in your response to update the profile.
Format for updating profile and adding biomarker logs:
\`\`\`json
{
  "updatedProfile": {
    "weight": 70,
    "height": 175,
    "age": 30
  },
  "newBiomarkerLogs": [
    { "biomarker": "HbA1c", "value": 5.5, "unit": "%", "date": "2023-10-10" }
  ]
}
\`\`\`
Any fields you specify in the JSON will be merged into their profile. 

Answer the user's message directly and concisely.

User Message: ${message}
`;

    addDebugLog(`[FrontDesk] Dispatching prompt to model: "${targetModel}".`);
    addDebugLog(`[FrontDesk-Prompt] User Prompt:\n${prompt}`);

    const ai = getGeminiClient();
    const response = await withGeminiRetry(() => ai.models.generateContent({
      model: targetModel,
      contents: prompt,
      config: {
        temperature: 0.2,
        maxOutputTokens: 1024,
        httpOptions: { timeout: 60000 }
      }
    }));

    const reply = response.text || "";
    addDebugLog(`[FrontDesk-Response] ${reply}`);
    
    // Parse updatedProfile if any
    let updatedProfile = null;
    let newBiomarkerLogs = null;
    const jsonMatch = reply.match(/\`\`\`json\s*({[\s\S]*?})\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.newBiomarkerLogs) {
          newBiomarkerLogs = parsed.newBiomarkerLogs;
        }
        if (parsed.updatedProfile) {
          updatedProfile = { ...profile, ...parsed.updatedProfile };
        }
      } catch(e) {}
    }

    res.json({ agentPrompt: prompt, text: reply.replace(/\`\`\`json[\s\S]*?\`\`\`/g, '').trim(), updatedProfile, newBiomarkerLogs, type: 'front_desk' });
  } catch (err: any) {
    console.error("Front Desk Error:", err);
    res.status(500).json({ error: err.message });
  }
});

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

foodAnalyzeRouter.post("/api/gemini/food-analyze", async (req, res) => {
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
    res.flushHeaders();
    hasSentHeaders = true;

    const originalJson = res.json.bind(res);
    const originalStatus = res.status.bind(res);

    res.status = (code: number) => {
      // If headers already sent, ignore status code changes
      if (!res.headersSent) {
        originalStatus(code);
      }
      return res;
    };

    res.json = (body: any) => {
      const sessionId = logSessionStorage.getStore() || "global";
      const logsToUse = sessionDebugLogs[sessionId] || globalDebugLogs;
      body.agentResult = body.agentResult || {};
      body.agentResult.backendLogs = logsToUse.slice(initialLogCount).map((l: any) => `[${l.timestamp}] ${l.message}`).join('\n');
      
      const jobId = req.body.jobId;
      const photoUrl = req.body.photoUrl;
      if (jobId) {
         import('./supabaseAdmin.js').then(({ supabaseAdmin }) => {
            let cleanResult: any = null;
            try {
               cleanResult = JSON.parse(JSON.stringify(body));
            } catch(e) {
               console.error('[res.json hook] Circular structure when parsing body for supabase:', e);
               return;
            }
            if (cleanResult.agentResult) delete cleanResult.agentResult.backendLogs;
            if (cleanResult.raw) delete cleanResult.raw;
            
            const dbCleanResult = { pendingFoodLog: cleanResult, photoUrl };
            import('./src/utils/r2Storage.js').then(async ({ uploadJobResultToR2 }) => {
               let lightweightResult = dbCleanResult;
               try {
                  const publicUrl = await uploadJobResultToR2(jobId, dbCleanResult);
                  if (publicUrl) {
                     lightweightResult = {
                        is_r2: true,
                        r2_url: publicUrl,
                        mode: 'review',
                        text: cleanResult.text || '',
                        message: cleanResult.message || 'Completed successfully',
                     } as any;
                  }
               } catch (r2Err) {
                  console.error('[Background Worker] Failed to save cleanResult to R2:', r2Err);
               }

               return supabaseAdmin.from('agent_jobs').update({
                  status: 'succeeded',
                  progress_percent: 100,
                  status_message: 'Completed successfully',
                  clean_result: lightweightResult,
                  updated_at: new Date().toISOString()
               }).eq('id', jobId);
            }).then(() => {
               console.log('[Background Worker] Successfully saved job to Supabase:', jobId);
            }).catch(e => console.error('Failed to update supabase', e));
         });
      }
      try {
         res.write(`data: ${JSON.stringify({ final: true, result: body })}\n\n`);
      } catch (stringifyErr) {
         console.error('[res.json hook] Stringify failed:', stringifyErr);
         res.write(`data: ${JSON.stringify({ final: true, error: "Internal Error: JSON serialization failed." })}\n\n`);
      }
      res.end();
      return res;
    };
  }

  const sendStreamEvent = (data: any) => {
    if (isStream && hasSentHeaders) {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (typeof (res as any).flush === 'function') (res as any).flush();
      } catch (e) {
        console.error('[sendStreamEvent] Error serializing/sending event:', e);
      }
    }
  };

  await streamDebugLogStorage.run((_msg: string) => {
    // sendLog() below already broadcasts its own tagged event directly — every message
    // it passes to addDebugLog() is prefixed "[<logType>] ...", so skip re-forwarding
    // those here to avoid sending the same line twice under two different tags.
    if (/^\[(status|scout_instruction|scout_answer|db_search|db_search_complete|dietitian_instruction|dietitian_answer)\]/.test(_msg)) {
      return;
    }
    sendStreamEvent({ type: 'log', logType: 'backend', stage: 'backend', message: _msg });
  }, async () => {
  let visionScoutItems: any[] = [];
  let visionScoutContentType: string | null = null;
  let preCalculatedItems: any[] | undefined;
  let aggregatedNutrients: any;
  let fullPromptSent: string = "";
  let apiCalls: any[] = [];
  try {
    const { message, image, images, imageDates, history, userProfile, engine, biomarkersNeedingImprovement, remainingAllowance, userId, activeMeal, customSystemInstruction, customVariableData, foodLogs, userSelectedMode } = req.body;
    const activeComparison = req.body.activeComparison;

    const sendLog = (logType: string, stage: 'scout' | 'db_search' | 'dietitian' | 'food_resolver', messageText: string, extra?: any) => {
      addDebugLog(`[${logType}] ${messageText}`);
      sendStreamEvent({ type: 'log', logType, stage, message: messageText, timestamp: Date.now(), ...extra });
    };
    sendLog('status', 'scout', 'Starting food analysis...');

    const STANDARD_FOOD_FACTORS: {[key: string]: {calories: number, saturatedFat: number, sodium: number, protein: number, carbohydrates: number, totalFat: number}} = {
      steak: { calories: 2.5, saturatedFat: 0.05, sodium: 1.8, protein: 0.26, carbohydrates: 0.0, totalFat: 0.18 },
      beef: { calories: 2.5, saturatedFat: 0.05, sodium: 1.8, protein: 0.26, carbohydrates: 0.0, totalFat: 0.18 },
      chicken: { calories: 1.65, saturatedFat: 0.01, sodium: 0.7, protein: 0.31, carbohydrates: 0.0, totalFat: 0.036 },
      breast: { calories: 1.65, saturatedFat: 0.01, sodium: 0.7, protein: 0.31, carbohydrates: 0.0, totalFat: 0.036 },
      pork: { calories: 2.4, saturatedFat: 0.03, sodium: 0.8, protein: 0.27, carbohydrates: 0.0, totalFat: 0.14 },
      fish: { calories: 1.5, saturatedFat: 0.01, sodium: 0.8, protein: 0.20, carbohydrates: 0.0, totalFat: 0.06 },
      salmon: { calories: 2.0, saturatedFat: 0.015, sodium: 0.5, protein: 0.20, carbohydrates: 0.0, totalFat: 0.13 },
      rice: { calories: 1.3, saturatedFat: 0.0, sodium: 0.01, protein: 0.027, carbohydrates: 0.28, totalFat: 0.003 },
      broccoli: { calories: 0.35, saturatedFat: 0.0, sodium: 0.3, protein: 0.028, carbohydrates: 0.07, totalFat: 0.004 },
      egg: { calories: 1.5, saturatedFat: 0.03, sodium: 1.4, protein: 0.13, carbohydrates: 0.011, totalFat: 0.11 },
      avocado: { calories: 1.6, saturatedFat: 0.02, sodium: 0.07, protein: 0.02, carbohydrates: 0.085, totalFat: 0.147 },
      bread: { calories: 2.6, saturatedFat: 0.005, sodium: 4.8, protein: 0.09, carbohydrates: 0.49, totalFat: 0.032 },
      butter: { calories: 7.1, saturatedFat: 5.1, sodium: 5.7, protein: 0.009, carbohydrates: 0.001, totalFat: 0.81 },
      cheese: { calories: 4.0, saturatedFat: 1.8, sodium: 6.2, protein: 0.25, carbohydrates: 0.013, totalFat: 0.33 },
      salad: { calories: 0.2, saturatedFat: 0.0, sodium: 0.1, protein: 0.01, carbohydrates: 0.03, totalFat: 0.002 },
      tomato: { calories: 0.18, saturatedFat: 0.0, sodium: 0.05, protein: 0.009, carbohydrates: 0.039, totalFat: 0.002 },
      oil: { calories: 8.8, saturatedFat: 1.4, sodium: 0.0, protein: 0.0, carbohydrates: 0.0, totalFat: 1.0 },
      potato: { calories: 0.8, saturatedFat: 0.0, sodium: 0.05, protein: 0.02, carbohydrates: 0.17, totalFat: 0.001 },
      pasta: { calories: 1.3, saturatedFat: 0.0, sodium: 0.01, protein: 0.05, carbohydrates: 0.25, totalFat: 0.011 }
    };

    // 1. Intercept prompt & read current active state from Request Body (passed from client)
    if (activeMeal) {
      addDebugLog(`[Client State] Received active meal: ${activeMeal.name}`);
    } else {
      addDebugLog(`[Client State] No active meal received.`);
    }

    // Check if key is mock
    if (!getGeminiApiKey()) {
      // If the user's message is a modify request, let's execute modify command offline!
      const isModifyRequest = message.toLowerCase().includes("change") || message.toLowerCase().includes("modify") || message.toLowerCase().includes("update") || message.toLowerCase().includes("remove") || message.toLowerCase().includes("add") || message.toLowerCase().includes("gram");
      
      if (isModifyRequest && activeMeal) {
        // Let's create an offline mock command
        let mockCommand: any = null;
        if (message.toLowerCase().includes("steak")) {
          const match = message.match(/(\d+)\s*g/);
          const grams = match ? Number(match[1]) : 100;
          mockCommand = { action: "update_weight", itemName: "Beef Steak", newWeightGrams: grams };
        } else if (message.toLowerCase().includes("remove")) {
          mockCommand = { action: "remove_item", itemName: "Beef Steak" };
        } else {
          const match = message.match(/(\d+)\s*g/);
          const grams = match ? Number(match[1]) : 120;
          mockCommand = { action: "add_item", itemName: "Extra Topping", newWeightGrams: grams };
        }

        const originalTotalWeight = (activeMeal.itemsBreakdown || []).reduce((acc: number, it: any) => acc + (Number(it.weightGrams) || 0), 0) || 1;
        
        if (mockCommand) {
          if (mockCommand.action === "update_weight") {
            const item = activeMeal.itemsBreakdown?.find((it: any) => it.name.toLowerCase().includes(mockCommand.itemName.toLowerCase()));
            if (item) {
              const oldWeight = Math.max(1, Number(item.weightGrams) || 1);
              const newWeight = Number(mockCommand.newWeightGrams);
              const R = newWeight / oldWeight;
              if (isDishEstimateEnabled()) {
                const ledger = await finalizeDishLedger({
                  item: {
                    ...item,
                    originalName: item.name || item.originalName,
                    keyword: item.keyword || item.name,
                    nutrients: item.nutrients || {
                      calories: item.calories,
                      protein: item.protein,
                      totalFat: item.totalFat,
                      saturatedFat: item.saturatedFat,
                      carbohydrates: item.carbohydrates,
                      sodium: item.sodium,
                    },
                  },
                  nutrientBasisWeight: item.nutrientBasisWeight || oldWeight,
                  consumedWeight: newWeight,
                  storedBrandLock: item.brandLock || null,
                  storedOcrLock: item.rawNutritionLabel ? {
                    basisType: item.rawNutritionLabel.basisType || 'per_dish',
                    servingGrams: item.rawNutritionLabel.servingGrams || null,
                    keys: item.lockedNutrientKeys || ['calories'],
                    valuesAtBasis: item.rawNutritionLabel,
                  } : null,
                });
                addDebugLog(`[Budget] mode=edit item="${item.name}" kcal=${ledger.nutrients.calories} source=${ledger.dbSource} weight=${newWeight}`);
                item.weightGrams = newWeight;
                item.calories = ledger.nutrients.calories;
                item.protein = ledger.nutrients.protein;
                item.totalFat = ledger.nutrients.totalFat;
                item.saturatedFat = ledger.nutrients.saturatedFat;
                item.carbohydrates = ledger.nutrients.carbohydrates;
                item.sodium = ledger.nutrients.sodium;
                if (item.nutrients) {
                  item.nutrients = { ...item.nutrients, ...ledger.nutrients };
                }
              } else {
              // Scale foundation macros by weight ratio first
              const foundation: Record<string, number> = {
                calories: Number(item.calories || 0) * R,
                protein: Number(item.protein || 0) * R,
                totalFat: Number(item.totalFat || item.fat || 0) * R,
                saturatedFat: Number(item.saturatedFat || 0) * R,
                carbohydrates: Number(item.carbohydrates || 0) * R,
                sodium: Number(item.sodium || 0) * R,
              };
              // Soft budget: prior calories scaled, or scout estimate scaled if present
              const priorScout = Number(item.estimatedCalories || item.scoutEstimatedCalories);
              const scoutEst = Number.isFinite(priorScout) && priorScout > 0 ? priorScout * R : null;
              const budget = computeItemBudget({
                itemName: item.name || item.originalName || mockCommand.itemName,
                weightGrams: newWeight,
                hardLabelKcal: item.lockedNutrientKeys?.includes?.('calories') ? Number(item.calories) * R : null,
                scoutEstimatedCalories: scoutEst,
              });
              const rec = reconcileNutrients({ nutrients: foundation, budget, formOk: true });
              addDebugLog(`[Budget] mode=edit item="${item.name}" kcal=${budget.budgetKcal} source=${budget.source} weight=${newWeight}`);
              addDebugLog(`[Reconcile] mode=edit action=${rec.action} foundation=${rec.foundationKcal} final=${rec.finalKcal}`);
              if (item) {
                item.weightGrams = newWeight;
                item.calories = Number(((rec?.nutrients?.calories ?? rec?.finalKcal) || 0).toFixed(1));
                item.protein = Number(((rec?.nutrients?.protein ?? foundation?.protein) || 0).toFixed(2));
                item.totalFat = Number(((rec?.nutrients?.totalFat ?? foundation?.totalFat) || 0).toFixed(2));
                item.saturatedFat = Number(((rec?.nutrients?.saturatedFat ?? foundation?.saturatedFat) || 0).toFixed(2));
                item.carbohydrates = Number(((rec?.nutrients?.carbohydrates ?? foundation?.carbohydrates) || 0).toFixed(2));
                item.sodium = Number(((rec?.nutrients?.sodium ?? foundation?.sodium) || 0).toFixed(1));
                if (scoutEst != null) item.estimatedCalories = scoutEst;
              }
              }
            }
          } else if (mockCommand.action === "remove_item") {
            const idx = activeMeal.itemsBreakdown?.findIndex((it: any) => it.name.toLowerCase().includes(mockCommand.itemName.toLowerCase()));
            if (idx !== -1) {
              activeMeal.itemsBreakdown.splice(idx, 1);
            }
          } else if (mockCommand.action === "add_item") {
            if (!activeMeal.itemsBreakdown) activeMeal.itemsBreakdown = [];
            activeMeal.itemsBreakdown.push({
              name: mockCommand.itemName,
              weightGrams: mockCommand.newWeightGrams,
              calories: mockCommand.newWeightGrams * 1.5,
              saturatedFat: mockCommand.newWeightGrams * 0.02,
              sodium: mockCommand.newWeightGrams * 0.5
            });
          }
        }

        const newTotalWeight = (activeMeal.itemsBreakdown || []).reduce((acc: number, it: any) => acc + (Number(it.weightGrams) || 0), 0);
        const mealWeightRatio = newTotalWeight / originalTotalWeight;

        const newItems = activeMeal.itemsBreakdown || [];
        activeMeal.weightGrams = newTotalWeight;
        if (newItems.length === 1) {
          activeMeal.name = newItems[0].name;
        }
        if (activeMeal.scoutItems && Array.isArray(activeMeal.scoutItems)) {
          const currentNames = new Set(newItems.map((it: any) => (it.name || '').toLowerCase().trim()));
          activeMeal.scoutItems = activeMeal.scoutItems.filter((scout: any) => {
            const sName = String(scout.keyword || scout.originalName || scout.name || '').toLowerCase().trim();
            return Array.from(currentNames).some((cName: any) => String(cName).includes(sName) || sName.includes(String(cName)));
          });
        }
        activeMeal.composition = newItems.map((it: any) => it.name).join(", ");
        
        const newCalories = (activeMeal.itemsBreakdown || []).reduce((acc: number, it: any) => acc + (Number(it.calories) || 0), 0);
        const newSaturatedFat = (activeMeal.itemsBreakdown || []).reduce((acc: number, it: any) => acc + (Number(it.saturatedFat) || 0), 0);
        const newSodium = (activeMeal.itemsBreakdown || []).reduce((acc: number, it: any) => acc + (Number(it.sodium) || 0), 0);

        if (!activeMeal.nutrients) activeMeal.nutrients = {};
        activeMeal.nutrients.calories = Number(newCalories.toFixed(1));
        activeMeal.nutrients.saturatedFat = Number(newSaturatedFat.toFixed(2));
        activeMeal.nutrients.sodium = Number(newSodium.toFixed(1));

        for (const key of Object.keys(activeMeal.nutrients)) {
          if (key !== "calories" && key !== "saturatedFat" && key !== "sodium") {
            activeMeal.nutrients[key] = Number(((activeMeal.nutrients[key] || 0) * mealWeightRatio).toFixed(2));
          }
        }

        // We removed offline mock write to user_meals to avoid permission issues

        return res.json({
          text: `[Simulated Offline Mod] Modifying active meal: **${activeMeal.name}** to new weights/items. Recalculated all 30 sub-nutrients mathematically offline to save tokens and ensure precision.`,
          data: activeMeal
        });
      }

      const isDiscussionRequest = message.toLowerCase().includes("why") || message.toLowerCase().includes("explain") || message.toLowerCase().includes("question");
      if (isDiscussionRequest) {
        return res.json({
          text: "This is a simulated conversational answer about your active meal ingredients, explaining that avocado and salmon are rich sources of dietary fibre and heart-healthy monounsaturated fatty acids.",
          data: null
        });
      }

      return res.json({
        error: "The food log agent is not available. Please enter the food details manually.",
        agentNotAvailable: true
      });
    }

    let imagePayloads = null;
    if (images && Array.isArray(images) && images.length > 0) {
      imagePayloads = images.map((imgStr: string) => {
        const mimeType = imgStr.split(";")[0].split(":")[1] || "image/jpeg";
        const base64Data = imgStr.split(",")[1];
        return { mimeType, data: base64Data };
      });
    } else if (image) {
      const mimeType = image.split(";")[0].split(":")[1] || "image/jpeg";
      const base64Data = image.split(",")[1];
      imagePayloads = [{ mimeType, data: base64Data }];
    }

    addDebugLog(`[Image Payload] Received ${imagePayloads ? imagePayloads.length : 0} image(s). Approx sizes (KB): ${imagePayloads ? imagePayloads.map(p => Math.round((p.data.length * 0.75) / 1024) + 'KB').join(', ') : 'none'}.`);

    const analysisNutrientKeys = [
        "calories", "protein", "totalFat", "saturatedFat", "transFat", "unsaturatedFat", "omega3", 
      "carbohydrates", "addedSugar", "totalFibre", "solubleFibre", "sodium", "potassium", 
      "magnesium", "calcium", "iron", "zinc", "selenium", "iodine", "phosphorus", 
      "vitaminD", "vitaminB12", "folate", "vitaminC", "vitaminE", "vitaminK", 
      "vitaminA", "vitaminB6", "thiamine", "riboflavin", "niacin"
    ];

    // Helper functions for nutritional data lookup
    const formatUSDANutrients = (nutrients: any[]): string => {
      if (!nutrients || !Array.isArray(nutrients)) return "No nutrients available";
      const findNutrient = (namePatterns: string[]) => {
        // Stricter exact word match first
        const exactMatch = nutrients.find(n => {
          const name = (n.nutrientName || (n.nutrient && n.nutrient.name) || "").toLowerCase().trim();
          return namePatterns.some(p => name === p.toLowerCase().trim());
        });
        if (exactMatch) {
          const val = getUSDANutrientValue(exactMatch);
          const unit = exactMatch.unitName || (exactMatch.nutrient && exactMatch.nutrient.unitName) || "";
          return `${val}${unit}`;
        }

        // Fallback with precise keyword validation to avoid false fatty acid matches on "fat"
        const nut = nutrients.find(n => {
          const name = (n.nutrientName || (n.nutrient && n.nutrient.name) || "").toLowerCase();
          return namePatterns.some(p => {
            const cleanP = p.toLowerCase().trim();
            if (cleanP === "fat" && name.includes("fatty")) {
              return false; // prevent totalFat matching on saturated fat
            }
            return name.includes(cleanP);
          });
        });
        if (!nut) return null;
        const val = getUSDANutrientValue(nut);
        const unit = nut.unitName || (nut.nutrient && nut.nutrient.unitName) || "";
        return `${val}${unit}`;
      };
      const mapped: string[] = [];
      const kcal = findNutrient(["energy", "calories"]);
      const protein = findNutrient(["protein"]);
      const fat = findNutrient(["total lipid", "fat"]);
      const satFat = findNutrient(["saturated fat", "fatty acids, total saturated"]);
      const sodium = findNutrient(["sodium"]);
      if (kcal) mapped.push(`Calories: ${kcal}`);
      if (protein) mapped.push(`Protein: ${protein}`);
      if (fat) mapped.push(`Fat: ${fat}`);
      if (satFat) mapped.push(`SatFat: ${satFat}`);
      if (sodium) mapped.push(`Sodium: ${sodium}`);
      return mapped.join(", ");
    };

    const formatOFFNutrients = (nutriments: any): string => {
      if (!nutriments) return "No nutrients available";
      const mapped: string[] = [];
      const formatVal = (val: any) => {
        if (val === undefined || val === null) return null;
        const num = Number(val);
        return isNaN(num) ? val : Math.round(num * 100) / 100;
      };
      
      const kcal = nutriments["energy-kcal_100g"] !== undefined 
        ? formatVal(nutriments["energy-kcal_100g"]) 
        : (nutriments["energy_100g"] !== undefined ? formatVal(Math.round(nutriments["energy_100g"] / 4.184)) : null);
      const protein = formatVal(nutriments["proteins_100g"]);
      const fat = formatVal(nutriments["fat_100g"]);
      const satFat = formatVal(nutriments["saturated-fat_100g"]);
      const sodium = formatVal(nutriments["sodium_100g"]);
      
      if (kcal !== null) mapped.push(`Calories: ${kcal}kcal`);
      if (protein !== null) mapped.push(`Protein: ${protein}g`);
      if (fat !== null) mapped.push(`Fat: ${fat}g`);
      if (satFat !== null) mapped.push(`SatFat: ${satFat}g`);
      if (sodium !== null) mapped.push(`Sodium: ${Math.round(Number(sodium) * 1000)}mg`);
      return mapped.join(", ");
    };

    const extractOFFNutrientsPer100g = (product: any): Record<string, number> => {
      const profile: Record<string, number> = {};
      const n = product.nutriments;
      if (!n) return profile;
      
      if (n["energy-kcal_100g"] !== undefined) {
        profile["calories"] = Number(n["energy-kcal_100g"]) || 0;
      } else if (n["energy_100g"] !== undefined) {
        profile["calories"] = Math.round(Number(n["energy_100g"]) / 4.184) || 0;
      }
      
      const setNum = (key: string, field: string, scale: number = 1) => {
        if (n[field] !== undefined) {
          profile[key] = (Number(n[field]) || 0) * scale;
        }
      };

      setNum("protein", "proteins_100g");
      setNum("totalFat", "fat_100g");
      setNum("saturatedFat", "saturated-fat_100g");
      setNum("transFat", "trans-fat_100g");
      
      if (profile["totalFat"] !== undefined) {
        profile["unsaturatedFat"] = Math.max(0, profile["totalFat"] - (profile["saturatedFat"] || 0) - (profile["transFat"] || 0));
      }
      
      setNum("omega3", "omega-3_100g");
      setNum("carbohydrates", "carbohydrates_100g");
      setNum("sugar", "sugars_100g");
      setNum("addedSugar", "added_sugars_100g");
      setNum("totalFibre", "fiber_100g");
      setNum("solubleFibre", "soluble-fiber_100g");
      
      setNum("sodium", "sodium_100g", 1000);
      setNum("potassium", "potassium_100g", 1000);
      setNum("magnesium", "magnesium_100g", 1000);
      setNum("calcium", "calcium_100g", 1000);
      setNum("iron", "iron_100g", 1000);
      setNum("zinc", "zinc_100g", 1000);
      setNum("selenium", "selenium_100g");
      setNum("iodine", "iodine_100g");
      setNum("phosphorus", "phosphorus_100g", 1000);
      setNum("vitaminD", "vitamin-d_100g");
      setNum("vitaminB12", "vitamin-b12_100g");
      setNum("folate", "folate_100g");
      setNum("vitaminC", "vitamin-c_100g", 1000);
      setNum("vitaminE", "vitamin-e_100g", 1000);
      setNum("vitaminK", "vitamin-k_100g");
      setNum("vitaminA", "vitamin-a_100g");
      setNum("vitaminB6", "vitamin-b6_100g", 1000);
      setNum("thiamine", "thiamine_100g", 1000);
      setNum("riboflavin", "riboflavin_100g", 1000);
      setNum("niacin", "niacin_100g", 1000);

      return profile;
    };

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

    const isExplicitModify = !!(
      activeMeal &&
      (
        isPureWeightModification ||
        userExplicitlySelectedEditMode ||
        (
          message &&
          /\b(change|modify|update|remove|delete|correct|instead|replace|adjust|had|ate|only|portion|fraction|half|quarter|third|\d+\/\d+)\b/i.test(message)
        ) ||
        weightRefineIntent.isRefine
      )
    );

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
        visionScoutItems = activeList.map((it: any, idx: number) => ({
          scoutIndex: it.scoutIndex !== undefined && it.scoutIndex !== null ? it.scoutIndex : idx,
          originalName: it.originalName || it.canonicalDbName || it.name || "Food Item",
          keyword: it.keyword || it.canonicalDbName || it.originalName || it.name,
          estimatedWeightGrams: Number(it.weightGrams) || 100,
          nutrientBasisWeight: Number(it.weightGrams) || 100,
          nutrients: it.nutrients || it.truthNutrients || null,
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
        }));
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
              systemInstruction: scoutSystemInstruction,
              promptText: scoutPromptText,
              imagePayloads,
              responseMimeType: "application/json",
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
                            potassium: { type: Type.NUMBER },
                            omega3: { type: Type.NUMBER },
                            calcium: { type: Type.NUMBER },
                            iron: { type: Type.NUMBER },
                            magnesium: { type: Type.NUMBER },
                            vitaminD: { type: Type.NUMBER },
                          },
                          required: ["saturatedFat", "totalFat", "totalSugar", "potassium", "omega3", "calcium", "iron", "magnesium", "vitaminD"],
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
          const raw = String(lastScoutErr?.message || '');
          const isQuota = /429|RESOURCE_EXHAUSTED|quota exceeded/i.test(raw);
          const isUnavailable = /503|UNAVAILABLE|overloaded/i.test(raw);
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
          
          if (req.body.userSelectedMode === 'review') {
            scoutRecommendedMode = "new_log";
            addDebugLog(`[Mode Override] User explicitly selected 'review' mode via UI pill. Forcing mode to 'new_log'.`);
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
    const loosenQuery = (query: string): string => {
      if (!query) return "";
      let q = query.toLowerCase().trim();
      // Strip common brand adjectives and prefixes
      q = q.replace(/\b(sainsburys?|tesco|morrisons?|asda|aldi|lidl|waitrose|marks\s*&\s*spencer|m&s|official|fresh|raw|cooked|baked|fried|roasted|steamed|boiled|grilled|organic|natural|wild|sweet|spicy|pure|premium|classic|canned|frozen|delicious|tasty|freshly)\b/g, '');
      // Normalize plurals (simple s/es stripping for common words, especially fruits/vegetables)
      q = q.replace(/\b(clementines|mandarins|tangerines|oranges|berries|raspberries|strawberries|blueberries|grapes|apples|pears|peaches|plums|bananas|lemons|limes|tomatoes|cucumbers|radishes|onions|carrots|potatoes|mushrooms|peas|beans)\b/g, (match) => {
        if (match === 'berries') return 'berry';
        if (match === 'raspberries') return 'raspberry';
        if (match === 'strawberries') return 'strawberry';
        if (match === 'blueberries') return 'blueberry';
        if (match === 'tomatoes') return 'tomato';
        if (match === 'potatoes') return 'potato';
        if (match === 'radishes') return 'radish';
        if (match.endsWith('es')) return match.slice(0, -2);
        if (match.endsWith('s')) return match.slice(0, -1);
        return match;
      });
      q = q.replace(/\s+/g, ' ').trim();
      return q;
    };

    const cleanQuery = (raw: string) => {
      let clean = raw.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase();
      clean = clean.replace(/\b(soda|can|bottle|pack|tub|slice|cubes|pieces|portion|raw|cooked|boiled|baked|grilled|steamed)\b/g, '').replace(/\s+/g, ' ').trim();
      if (!clean) clean = raw.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase();
      const indonesianToEnglish: Record<string, string> = {
        "potongan ikan": "raw fish fillet",
        "ikan potongan": "raw fish fillet",
        "ikan": "raw fish",
        "daging sapi": "raw beef",
        "daging": "raw beef",
        "ayam": "raw chicken",
        "sayur": "vegetables",
        "nasi": "cooked rice",
        "telur": "egg",
        "tempe": "tempeh",
        "tahu": "tofu",
        "kentang": "potato",
        "wortel": "carrot"
      };

      for (const [indo, eng] of Object.entries(indonesianToEnglish)) {
        const regex = new RegExp(`\\b${indo}\\b`, 'g');
        if (regex.test(clean)) {
          clean = clean.replace(regex, eng);
        }
      }
      
      // Automatically prepend "raw" to meats to prevent fetching salted/cooked versions, unless it's a known chain or already specified
      const meats = ["beef", "chicken", "pork", "fish", "steak", "lamb", "mutton", "veal", "salmon", "tuna", "cod", "shrimp", "prawn", "duck"];
      const preparedModifiers = ["raw", "cooked", "fried", "roasted", "grilled", "baked", "boiled", "smoked", "cured", "canned"];
      const chainModifiers = ["mcdonald", "kfc", "burger king", "subway", "brand"];
      
      const isMeat = meats.some(m => clean.includes(m));
      const hasPreparation = preparedModifiers.some(p => clean.includes(p));
      const isChain = chainModifiers.some(c => clean.includes(c));

      if (isMeat && !hasPreparation && !isChain) {
        clean = "raw " + clean;
      }

      return clean;
    };

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

    const chainPatterns: [string, RegExp][] = [
      ['sainsbury', /\bsainsbury\b/i],
      ['yolk', /\byolk\b/i],
      ['mcdonalds', /mcdonald|maccas|麦当劳/i],
      ['kfc', /\bkfc\b|kentucky/i],
      ['coco_di_mama', /coco\s*di\s*mama|cocodimama/i],
      ['costa', /\bcosta\b/i],
      ['wasabi', /\bwasabi\b/i],
      ['itsu', /\bitsu\b/i],
      ['honi_poke', /honi\s*poke|honipoke/i],
      ['pret', /\bpret\b/i],
      ['starbucks', /starbucks/i],
      ['quaker', /\bquaker\b/i],
      ['jack_daniels', /jack\s*daniel/i],
    ];

    const detectChainKeyFromText = (str: string): string | undefined => {
      const s = String(str || '').toLowerCase();
      const matched = chainPatterns.find(([, rx]) => rx.test(s));
      if (matched) return matched[0];
      
      // Dynamic database brand match
      if (isKnownDatabaseBrandSync(s)) {
        const words = s.split(/[^a-z0-9]+/);
        for (const w of words) {
          if (w.length >= 3 && isKnownDatabaseBrandSync(w)) {
            return normalizeChainKey(w);
          }
        }
      }
      return undefined;
    };

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
    if (isDishEstimateEnabled(req)) {
      addDebugLog('[CuratorSkipped] Dish estimate pipeline active, skipping hot-path database search and resolver curator.');
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
      const scoutHasCompletePrintedLabel = (item: any): boolean => {
        const raw = item?.rawNutritionLabel;
        if (!raw || typeof raw !== 'object') return false;
        const cal = parseLabelCalories(raw);
        if (cal == null || !(cal > 0)) return false;
        let filled = 0;
        for (const [k, v] of Object.entries(raw)) {
          const ck = k.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (ck === 'servingsize' || ck === 'weight' || ck === 'servingspercontainer') continue;
          if (v === undefined || v === null || v === '' || v === '-' || v === '--') continue;
          filled++;
        }
        // calories + several panel fields (protein/fat/carbs/salt etc.)
        return filled >= 4;
      };
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
    if (Array.isArray(visionScoutItems) && Array.isArray(databaseMatchesArray) && databaseMatchesArray.length > 0) {
      visionScoutItems.forEach((item: any) => {
        if (Array.isArray(item.components)) {
          item.components.forEach((c: any) => {
            const cQuery = String(c.searchQuery || c.name || c.keyword || '').toLowerCase().trim();
            if (!cQuery) return;
            const match = databaseMatchesArray.find((m: any) => {
              const mQuery = String(m.searchQuery || m.query || m.name || '').toLowerCase().trim();
              if (!mQuery) return false;
              const isParentDishMatch = item.originalName && mQuery === String(item.originalName).toLowerCase().trim();
              if (isParentDishMatch && cQuery !== mQuery) return false;
              return mQuery === cQuery || (m.name && m.name.toLowerCase().trim() === cQuery);
            });
            if (match) {
              const isBrandMatch = Boolean(match.chainName) || match.source === 'brand_official' || match.dbSource === 'brand_official';
              const matchChain = String(match.chainName || match.brand || '').toLowerCase().trim();
              const queryHasBrand = isBrandMatch && Boolean(matchChain) && (
                cQuery.includes(matchChain) ||
                (c.brand && String(c.brand).toLowerCase().includes(matchChain))
              );
              if (isBrandMatch && !queryHasBrand) {
                c.dbSource = (match.source && match.source !== 'brand_official') ? match.source : 'category_fallback';
                c.chainName = null;
                c.brand = null;
              } else {
                c.dbSource = queryHasBrand ? (match.source || 'brand_official') : (match.source || 'usda');
                c.primaryBaseMatchName = match.name || c.primaryBaseMatchName;
                if (queryHasBrand) {
                  c.chainName = match.chainName || c.chainName;
                  c.brand = match.chainName || match.brand || c.brand;
                }
              }
              if (match.rawNutritionLabel) {
                // Only ever propagate a GENUINE label/OCR object here (Vision-Scout-sourced,
                // or a verified brand_official printed serving). Do NOT synthesize a
                // rawNutritionLabel-shaped object from ordinary USDA/canonical/estimated
                // nutrient data — doing so previously caused fresh produce and generic
                // USDA-matched ingredients to be mislabeled "(Package Label Truth)" /
                // "Nutrition Facts (OCR Label)" downstream (see FIX_FALSE_PACKAGE_LABEL_TRUTH_BADGE.md).
                c.rawNutritionLabel = match.rawNutritionLabel;
              }
            }
          });
        }
      });
    }

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

    if (isDishEstimateEnabled(req)) {
      const ledgers = await Promise.all(
        visionScoutItems.map(async (vItem: any, vIdx: number) => {
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
          rawNutritionLabel: l.dbSource === 'label' ? l.nutrients : null,
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
    } else {
      // Backend-Side Mathematical Macro Aggregation for Component-Level Decomposition
      preCalculatedItems = visionScoutItems.map((item: any, itemIdx: number) => {
      const itemWeight = item.estimatedWeightGrams || 100;
      const aggregatedNutrients: Record<string, number> = {};
      NUTRIENT_KEYS.forEach(k => aggregatedNutrients[k] = 0);
      
      const getEstimatedFoodType = (name: string): string => {
        const n = name.toLowerCase();
        if (n.includes("steak") || n.includes("beef") || n.includes("lamb") || n.includes("pork") || n.includes("mutton") || n.includes("veal") || n.includes("bacon") || n.includes("ham") || n.includes("sausage") || n.includes("daging")) return "red_meat";
        if (n.includes("chicken") || n.includes("turkey") || n.includes("duck") || n.includes("poultry") || n.includes("ayam")) return "poultry";
        if (n.includes("shrimp") || n.includes("prawn") || n.includes("crab") || n.includes("lobster") || n.includes("clam") || n.includes("mussel") || n.includes("oyster") || n.includes("squid") || n.includes("octopus") || n.includes("scallop")) return "shellfish";
        if (n.includes("salmon") || n.includes("tuna") || n.includes("mackerel") || n.includes("sardine") || n.includes("herring") || n.includes("trout") || n.includes("fatty fish")) return "fish_fatty";
        if (n.includes("cod") || n.includes("halibut") || n.includes("snapper") || n.includes("bass") || n.includes("tilapia") || n.includes("fish") || n.includes("ikan")) return "fish_lean";
        if (n.includes("egg") || n.includes("telur") || n.includes("omelet") || n.includes("omelette")) return "egg";
        if (n.includes("milk") || n.includes("cheese") || n.includes("butter") || n.includes("yogurt") || n.includes("cream") || n.includes("dairy")) return "dairy";
        if (n.includes("apple") || n.includes("banana") || n.includes("grape") || n.includes("orange") || n.includes("citrus") || n.includes("nectarine") || n.includes("mandarin") || n.includes("tangerine") || n.includes("peach") || n.includes("plum") || n.includes("pear") || n.includes("cherry") || n.includes("cherries") || n.includes("mango") || n.includes("kiwi") || n.includes("pineapple") || n.includes("berry") || n.includes("strawberr") || n.includes("blueberr") || n.includes("raspberr") || n.includes("blackberr") || n.includes("melon") || n.includes("watermelon") || n.includes("cantaloupe") || n.includes("honeydew") || n.includes("papaya") || n.includes("fig") || n.includes("apricot") || n.includes("lemon") || n.includes("lime") || n.includes("pomegranate") || n.includes("avocado") || n.includes("fruit") || n.includes("buah")) return "fruit";
        if (n.includes("rice") || n.includes("bread") || n.includes("oat") || n.includes("wheat") || n.includes("grain") || n.includes("corn") || n.includes("maize") || n.includes("pasta") || n.includes("noodle") || n.includes("cereal") || n.includes("quinoa")) return "grain";
        if (n.includes("bean") || n.includes("lentil") || n.includes("pea") || n.includes("chickpea") || n.includes("legume") || n.includes("tempeh") || n.includes("tofu") || n.includes("edamame") || n.includes("soy")) return "legume";
        if (n.includes("potato") || n.includes("carrot") || n.includes("onion") || n.includes("garlic") || n.includes("beet") || n.includes("radish") || n.includes("yam") || n.includes("tuber") || n.includes("root") || n.includes("kentang") || n.includes("wortel") || n.includes("cassava") || n.includes("turnip") || n.includes("ginger")) return "root_veg";
        if (n.includes("spinach") || n.includes("kale") || n.includes("lettuce") || n.includes("cabbage") || n.includes("leaf") || n.includes("leaves") || n.includes("sayur") || n.includes("kangkung") || n.includes("pakchoy") || n.includes("mustard green") || n.includes("broccoli") || n.includes("cauliflower") || n.includes("celery") || n.includes("asparagus") || n.includes("cucumber") || n.includes("tomato") || n.includes("eggplant") || n.includes("zucchini") || n.includes("squash") || n.includes("pepper") || n.includes("capsicum") || n.includes("mushroom")) return "leafy_veg";
        if (n.includes("donut") || n.includes("candy") || n.includes("chocolate") || n.includes("chip") || n.includes("french fry") || n.includes("french fries") || n.includes("processed") || n.includes("nugget") || n.includes("cookie") || n.includes("biscuit") || n.includes("cake")) return "ultra_processed";
        return "other";
      };

      // Extracts the head/primary noun of a food name for category classification purposes.
      // USDA/OFF names are conventionally structured as "HeadNoun, modifier, modifier..." (e.g.
      // "Salad dressing, mayonnaise, soybean and safflower oil, with salt") or "HeadNoun made with X"
      // (e.g. "Mayonnaise, made with tofu"). Classifying on the full name causes composite/condiment
      // products to be misclassified into the category of whichever ingredient they merely mention.
      // Classifying on the head noun alone avoids this false match.
      const getHeadNoun = (name: string): string => {
        let n = (name || "").trim();
        n = n.split(",")[0];
        const connectors = [" made with ", " made from ", " prepared with ", " with ", " and "];
        for (const connector of connectors) {
          const idx = n.toLowerCase().indexOf(connector);
          if (idx !== -1) {
            n = n.substring(0, idx);
          }
        }
        return n.trim();
      };

      const getClinicalDefaultNutrients100g = (name: string): Record<string, number> => {
        if (isGenericZeroNutrientDiluent(name)) {
          const zeroProf: Record<string, number> = {};
          NUTRIENT_KEYS.forEach(k => { zeroProf[k] = 0; });
          return zeroProf;
        }
        const base = getFallbackCategoryProfile(name);
        const n = name.toLowerCase();
        let overrides: Partial<Record<string, number>> = {};
        if (n.includes("mayo") || n.includes("mayonnaise")) {
          overrides = { calories: 680, protein: 1, totalFat: 75, saturatedFat: 12, sodium: 600, carbohydrates: 1, transFat: 0, addedSugar: 0, potassium: 20, totalFibre: 0, solubleFibre: 0 };
        } else if (n.includes("sauce") || n.includes("dressing")) {
          overrides = { calories: 150, protein: 1, totalFat: 10, saturatedFat: 1.5, sodium: 800, carbohydrates: 15, transFat: 0, addedSugar: 5, potassium: 50, totalFibre: 0, solubleFibre: 0 };
        } else if (n.includes("sausage") || n.includes("salami") || n.includes("chorizo") || n.includes("pepperoni") || n.includes("frankfurter") || n.includes("bacon") || n.includes("pastrami") || n.includes("ham") || n.includes("cured")) {
          overrides = { calories: 320, protein: 18, totalFat: 26, saturatedFat: 9, sodium: 850, carbohydrates: 3, transFat: 0.3, addedSugar: 0, potassium: 250, totalFibre: 0, solubleFibre: 0 };
        } else if (n.includes("pizza") || n.includes("crust")) {
          overrides = { calories: 280, protein: 9, totalFat: 8, saturatedFat: 2.5, sodium: 550, carbohydrates: 42, transFat: 0, addedSugar: 2, potassium: 120, totalFibre: 2.5, solubleFibre: 0.5 };
        } else if (n.includes("beef") || n.includes("steak") || n.includes("meat")) {
          overrides = { calories: 250, protein: 26, totalFat: 15, saturatedFat: 6, sodium: 70, carbohydrates: 0, transFat: 0.1, addedSugar: 0, potassium: 350, totalFibre: 0, solubleFibre: 0 };
        } else if (n.includes("chicken") || n.includes("poultry") || n.includes("ayam")) {
          overrides = { calories: 165, protein: 31, totalFat: 3.6, saturatedFat: 1, sodium: 70, carbohydrates: 0, transFat: 0, addedSugar: 0, potassium: 220, totalFibre: 0, solubleFibre: 0 };
        } else if (n.includes("fish") || n.includes("ikan") || n.includes("salmon") || n.includes("tuna") || n.includes("shrimp") || n.includes("prawn")) {
          overrides = { calories: 120, protein: 20, totalFat: 4, saturatedFat: 1, sodium: 80, carbohydrates: 0, transFat: 0, addedSugar: 0, potassium: 300, totalFibre: 0, solubleFibre: 0 };
        } else if (n.includes("juice") || n.includes("beverage") || n.includes("drink")) {
          overrides = { calories: 45, protein: 0.5, totalFat: 0.1, saturatedFat: 0, sodium: 5, carbohydrates: 11, transFat: 0, addedSugar: 0, potassium: 150, totalFibre: 0.2, solubleFibre: 0 };
        } else if (n.includes("fruit") || n.includes("apple") || n.includes("melon") || n.includes("berry") || n.includes("orange") || n.includes("banana")) {
          overrides = { calories: 50, protein: 0.5, totalFat: 0.2, saturatedFat: 0, sodium: 1, carbohydrates: 13, transFat: 0, addedSugar: 0, potassium: 150, totalFibre: 2, solubleFibre: 0.5 };
        } else if (n.includes("cucumber") || n.includes("lettuce") || n.includes("tomato") || n.includes("leaf") || n.includes("salad") || n.includes("greens")) {
          overrides = { calories: 15, protein: 1, totalFat: 0.2, saturatedFat: 0, sodium: 5, carbohydrates: 3, transFat: 0, addedSugar: 0, potassium: 150, totalFibre: 1, solubleFibre: 0.2 };
        } else if (/\boil\b/.test(n) || n.includes("ghee") || n.includes("lard") || n.includes("shortening")) {
          // MOVED (bugfix): must run BEFORE the vegetable/legume branch below. Scout names frying
          // oil components like "oil vegetable canola", and the old position (last in this chain)
          // let the vegetable branch match "vegetable" first, silently pricing frying oil as a
          // near-zero-fat vegetable instead of pure fat. See job_1787511243909_31epl9k4f.
          overrides = { calories: 884, protein: 0, totalFat: 100, saturatedFat: 14, sodium: 2, carbohydrates: 0, transFat: 0, addedSugar: 0, potassium: 1, totalFibre: 0, solubleFibre: 0 };
        } else if (n.includes("pea") || n.includes("bean") || n.includes("lentil") || n.includes("corn") || n.includes("carrot") || n.includes("vegetable") || n.includes("veg")) {
          overrides = { calories: 65, protein: 3, totalFat: 0.5, saturatedFat: 0.1, sodium: 30, carbohydrates: 12, transFat: 0, addedSugar: 0, potassium: 200, totalFibre: 2, solubleFibre: 0.5 };
        } else if (n.includes("potato") || n.includes("wedge") || n.includes("yam")) {
          overrides = { calories: 90, protein: 2, totalFat: 0.1, saturatedFat: 0.02, sodium: 10, carbohydrates: 21, transFat: 0, addedSugar: 0, potassium: 400, totalFibre: 1.5, solubleFibre: 0.5 };
        } else if (n.includes("brownie") || n.includes("cake") || n.includes("cookie") || n.includes("chocolate") || n.includes("candy") || n.includes("dessert") || n.includes("tart") || n.includes("pie") || n.includes("fudge") || n.includes("biscuit") || n.includes("sweet")) {
          overrides = { calories: 450, protein: 5, totalFat: 24, saturatedFat: 12, sodium: 200, carbohydrates: 55, transFat: 0, addedSugar: 30, potassium: 150, totalFibre: 2, solubleFibre: 0.4 };
        } else if (n.includes("croissant") || n.includes("pastry") || n.includes("danish") || n.includes("brioche") || n.includes("muffin") || n.includes("scone") || n.includes("donut")) {
          overrides = { calories: 410, protein: 8, totalFat: 21, saturatedFat: 12, sodium: 450, carbohydrates: 46, transFat: 0, addedSugar: 8, potassium: 120, totalFibre: 2, solubleFibre: 0.4 };
        } else if (n.includes("bread") || n.includes("baguette") || n.includes("roll") || n.includes("bun") || n.includes("toast") || n.includes("dough")) {
          overrides = { calories: 250, protein: 8, totalFat: 3, saturatedFat: 0.5, sodium: 400, carbohydrates: 50, transFat: 0, addedSugar: 2, potassium: 100, totalFibre: 3, solubleFibre: 0.5 };
        } else if (n.includes("egg") || n.includes("omelet")) {
          overrides = { calories: 150, protein: 12, totalFat: 10, saturatedFat: 3, sodium: 130, carbohydrates: 1, transFat: 0, addedSugar: 0, potassium: 130, totalFibre: 0, solubleFibre: 0 };
        } else if (n.includes("braised") || n.includes("glazed") || n.includes("teriyaki") || n.includes("kung pao") || n.includes("sweet and sour") || n.includes("soy sauce")) {
          if (n.includes("tofu") || n.includes("tahu")) {
            overrides = { calories: 95, protein: 8.5, totalFat: 4.5, saturatedFat: 0.8, sodium: 480, carbohydrates: 5, transFat: 0, addedSugar: 2, potassium: 160, totalFibre: 1, solubleFibre: 0.2 };
          } else if (n.includes("chicken") || n.includes("beef") || n.includes("pork") || n.includes("meat")) {
            overrides = { calories: 200, protein: 24, totalFat: 8, saturatedFat: 2.5, sodium: 600, carbohydrates: 6, transFat: 0, addedSugar: 3, potassium: 280, totalFibre: 0.5, solubleFibre: 0 };
          } else if (n.includes("mushroom") || n.includes("vegetable") || n.includes("veg")) {
            overrides = { calories: 55, protein: 2.5, totalFat: 2, saturatedFat: 0.3, sodium: 420, carbohydrates: 7, transFat: 0, addedSugar: 2, potassium: 250, totalFibre: 1.5, solubleFibre: 0.3 };
          } else {
            overrides = { calories: 120, protein: 6, totalFat: 4, saturatedFat: 0.8, sodium: 500, carbohydrates: 12, transFat: 0, addedSugar: 3, potassium: 200, totalFibre: 1, solubleFibre: 0.2 };
          }
        } else if (n.includes("tofu") || n.includes("tahu")) {
          overrides = { calories: 75, protein: 8, totalFat: 4.5, saturatedFat: 0.5, sodium: 10, carbohydrates: 2, transFat: 0, addedSugar: 0, potassium: 120, totalFibre: 1, solubleFibre: 0 };
        } else if (n.includes("wine") || n.includes("champagne") || n.includes("prosecco") || n.includes("cava") || n.includes("sparkling")) {
          overrides = { calories: 64, protein: 0.07, totalFat: 0, saturatedFat: 0, sodium: 7, carbohydrates: 1, transFat: 0, addedSugar: 0, potassium: 80, totalFibre: 0, solubleFibre: 0 };
        } else if (n.includes("beer") || n.includes("ale") || n.includes("lager") || n.includes("stout")) {
          overrides = { calories: 43, protein: 0.5, totalFat: 0, saturatedFat: 0, sodium: 4, carbohydrates: 3.6, transFat: 0, addedSugar: 0, potassium: 27, totalFibre: 0, solubleFibre: 0 };
        } else if (n.includes("spirit") || n.includes("vodka") || n.includes("whisky") || n.includes("whiskey") || n.includes("rum") || n.includes("gin") || n.includes("tequila") || n.includes("brandy") || n.includes("cognac") || n.includes("liqueur")) {
          overrides = { calories: 231, protein: 0, totalFat: 0, saturatedFat: 0, sodium: 1, carbohydrates: 0, transFat: 0, addedSugar: 0, potassium: 2, totalFibre: 0, solubleFibre: 0 };
        } else if (n.includes("cheese") || n.includes("mozzarella") || n.includes("cheddar") || n.includes("parmesan") || n.includes("feta") || n.includes("ricotta") || n.includes("gouda") || n.includes("provolone") || n.includes("paneer") || n.includes("halloumi")) {
          overrides = { calories: 280, protein: 22, totalFat: 21, saturatedFat: 13, sodium: 550, carbohydrates: 2, transFat: 0, addedSugar: 0, potassium: 100, totalFibre: 0, solubleFibre: 0 };
        } else if (n.includes("yogurt") || n.includes("yoghurt") || n.includes("kefir") || n.includes("quark")) {
          overrides = { calories: 80, protein: 6, totalFat: 3, saturatedFat: 2, sodium: 45, carbohydrates: 7, transFat: 0, addedSugar: 4, potassium: 200, totalFibre: 0, solubleFibre: 0 };
        } else if (n.includes("tortilla") || n.includes("wrap") || n.includes("flatbread") || n.includes("pitta") || n.includes("pita") || n.includes("naan") || n.includes("chapati")) {
          overrides = { calories: 290, protein: 8, totalFat: 7, saturatedFat: 1.5, sodium: 600, carbohydrates: 48, transFat: 0, addedSugar: 1, potassium: 130, totalFibre: 3, solubleFibre: 0.5 };
        } else if (n.includes("oat") || n.includes("cereal") || n.includes("granola") || n.includes("muesli") || n.includes("quinoa") || n.includes("barley")) {
          overrides = { calories: 380, protein: 12, totalFat: 6, saturatedFat: 1, sodium: 10, carbohydrates: 65, transFat: 0, addedSugar: 5, potassium: 350, totalFibre: 10, solubleFibre: 4 };
        } else if (n.includes("rice") || n.includes("pasta") || n.includes("noodle") || n.includes("spaghetti") || n.includes("macaroni")) {
          if (n.includes("cooked") || n.includes("boiled")) {
            overrides = { calories: 130, protein: 3, totalFat: 0.5, saturatedFat: 0.1, sodium: 5, carbohydrates: 28, transFat: 0, addedSugar: 0, potassium: 40, totalFibre: 1, solubleFibre: 0 };
          } else {
            overrides = { calories: 360, protein: 10, totalFat: 1.5, saturatedFat: 0.3, sodium: 5, carbohydrates: 75, transFat: 0, addedSugar: 0, potassium: 120, totalFibre: 2.5, solubleFibre: 0.5 };
          }
        } else if (n.includes("soup") || n.includes("broth") || n.includes("sop") || n.includes("soto")) {
          overrides = { calories: 60, protein: 3, totalFat: 2.5, saturatedFat: 1, sodium: 600, carbohydrates: 6, transFat: 0, addedSugar: 0, potassium: 120, totalFibre: 0.5, solubleFibre: 0 };
        } else if (n.includes("cracker") || n.includes("chip") || n.includes("crisp") || n.includes("emping") || n.includes("kerupuk") || n.includes("krupuk")) {
          overrides = { calories: 500, protein: 7, totalFat: 25, saturatedFat: 4, sodium: 600, carbohydrates: 60, transFat: 0, addedSugar: 0, potassium: 200, totalFibre: 3, solubleFibre: 0.5 };
        }
        return { ...base, ...overrides };
      };

      const sanitizeComponentQuery = (query: string) => {
        const q = query.toLowerCase();
        if (q.includes('bun') || q.includes('bread')) return `${query} bakery bread`;
        if (q.includes('patty') || q.includes('chicken')) return `${query} cooked breaded`;
        if (q.includes('sauce') || q.includes('mayo')) return `${query} condiment`;
        return query;
      };

      const prepareSearchQueryWithState = (scoutQuery: string, cookingMethod: string) => {
        let finalSearch = scoutQuery;
        const requiresState = /\b(crust|dough|batter|sausage|meatball|steak|fillet)\b/i.test(scoutQuery);
        if (requiresState && !/\b(cooked|baked|fried|roasted|boiled)\b/i.test(scoutQuery)) {
          if (cookingMethod === 'baked') finalSearch = `${scoutQuery} cooked baked`;
          else if (cookingMethod === 'pan_fried' || cookingMethod === 'deep_fried') finalSearch = `${scoutQuery} cooked fried`;
        }
        // UK/EU Fortification Mapping: Enriched wheat flour/tortilla for bread/wrap components
        if (/\b(tortilla|wrap|flatbread|pitta|pita|naan|bread|flour)\b/i.test(finalSearch) && !/\b(enriched|whole wheat|wholemeal|corn)\b/i.test(finalSearch)) {
          finalSearch = `${finalSearch} enriched wheat`;
        }
        // Identity expansions (I5)
        const fsLow = finalSearch.toLowerCase();
        if (fsLow.includes('mixed salad leaves') || fsLow.includes('salad leaves')) {
          finalSearch = `${finalSearch} lettuce mixed greens`;
        }
        if (fsLow.includes('kalamata olives') || fsLow.includes('olives')) {
          finalSearch = `${finalSearch} olives canned`;
        }
        if (fsLow.includes('chickpeas') || fsLow.includes('garbanzo')) {
          finalSearch = `${finalSearch} cooked boiled canned`;
        }
        if (/\bberries\b/i.test(finalSearch)) {
          finalSearch = `${finalSearch} blueberries raspberries strawberries`;
        }
        if (/\byoghurt\b/i.test(finalSearch)) {
          finalSearch = finalSearch.replace(/\byoghurt\b/gi, 'yogurt') + ' greek yogurt plain';
        }
        return finalSearch;
      };

      const extractCoreIdentityTokens = (scoutQuery: string) => {
        const cleanQuery = scoutQuery.toLowerCase().replace(/[^\w\s]/g, '');
        const words = cleanQuery.split(/\s+/).filter(Boolean);
        const classFillerNouns = new Set([
          'cooked', 'raw', 'fresh', 'prepared', 'style', 'flavored', 
          'with', 'product', 'food', 'item', 'canned', 'frozen', 
          'dried', 'sliced', 'chopped', 'ground', 'boneless', 'skinless',
          'cubes', 'cubed', 'diced', 'shredded', 'crumbled', 'pieces', 'chunks',
          'roasted', 'boiled', 'baked', 'grilled', 'steamed', 'fried', 'poached',
          'toasted', 'minced', 'crushed', 'grated', 'blend', 'mix', 'mixed'
        ]);
        let tokens = words.filter(word => !classFillerNouns.has(word));
        let categoryBias: string | undefined;
        if (tokens.includes('greens') || tokens.includes('vegetables')) {
          categoryBias = 'vegetable';
          tokens = tokens.filter(t => t !== 'greens' && t !== 'vegetables');
        }
        return { tokens: tokens.length ? tokens : words, categoryBias };
      };

      const findBestMatch = (keyword: string, extraQueries: string[] = []) => {
        if (!keyword || !databaseMatchesArray || databaseMatchesArray.length === 0) return undefined;
        // Query-scoped pool: a component may only bind rows tagged with its searchQuery.
        // Shared-array scan is how chicken stole onion-powder 171327.
        const anyTagged = databaseMatchesArray.some((m: any) => m && m.searchQuery);
        const matchPool = anyTagged
          ? filterMatchesForQuery(keyword, databaseMatchesArray, extraQueries)
          : databaseMatchesArray;
        if (!matchPool.length) return undefined;
        
        const { tokens: coreTokens, categoryBias } = extractCoreIdentityTokens(keyword);
        const queryTokens = new Set<string>(keyword.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/));
        
        const compositeMarkers = ['pizza', 'pasta', 'pie', 'dinner', 'meal', 'assortment'];
        const isComponentQuery = !compositeMarkers.some(marker => keyword.toLowerCase().includes(marker));

        let bestMatch: any = undefined;
        let highestScore = -999999;

        matchPool.forEach((m: any) => {
          if (m.id && quarantinedIdsSet.has(String(m.id))) {
            addDebugLog(`[Quarantine Block] Blocked quarantined candidate "${m.name}" (id=${m.id}) from best-match evaluation.`);
            return;
          }
          if (m.source === 'canonical_dict' || m.source === 'estimated') return;
          // Never select category/last-resort stubs as "best" DB match when real USDA/OFF/catalog exist
          if (m.source === 'category_fallback' || m.source === 'fallback_estimated' || String(m.id || '').startsWith('fallback_')) return;
          // Component matching: never use whole-dish web_search rows as ingredient identity
          if (m.source === 'web_search' || m.source === 'tavily' || m.source === 'serper' || m.source === 'google_cse') return;
          
          const chainNamePrefix = m.chainName || m.chain_name || m.chain_key || '';
          const dbTitle = `${chainNamePrefix} ${m.name || m.dish_name || ''}`.toLowerCase().replace(/[^\w\s]/g, '');
          const dbTokens = new Set<string>(dbTitle.split(/\s+/));

          // RULE 1: Core Token Lock
          const passTokenLock = coreTokens.every(token => 
            dbTokens.has(token) || 
            Array.from(dbTokens).some(dt => dt.startsWith(token) || token.startsWith(dt))
          );
          const passCategoryBias = categoryBias === 'vegetable' && (dbTokens.has('spinach') || dbTokens.has('broccoli') || dbTokens.has('kale') || dbTokens.has('greens'));
          
          if (!passTokenLock && !passCategoryBias) return;

          // RULE 2: Composite Meal Rejection
          if (isComponentQuery) {
            const isCompositeMatch = (dbTokens.has('pizza') && !dbTitle.includes('crust') && !dbTitle.includes('dough')) ||
                                     (dbTokens.has('pasta') && !dbTitle.includes('noodle') && !dbTitle.includes('spaghetti'));
            if (isCompositeMatch) return;
          }

          // RULE 2.5: Minimal Form Gates (Task 3 / B4)
          const isQueryCup = /\b(cup|bowl|loose|yogurt|fruit|plate|pot|glass|mix)\b/i.test(keyword);
          const isQueryBarType = /\b(bar|bars|snack-bar|flapjack|protein-bar|energy-bar)\b/i.test(keyword);
          const isCandBarType = /\b(bar|bars|snack-bar|flapjack|protein-bar|energy-bar)\b/i.test(dbTitle);
          if (isQueryCup && !isQueryBarType && isCandBarType) return;
          if (isQueryBarType && !isQueryCup && /\b(cup|bowl|loose|yogurt|fruit|plate|pot|glass)\b/i.test(dbTitle)) return;

          const isQueryCooked = /\b(cooked|boiled|baked|fried|roasted|plated|steamed|grilled|poached|toast|toasted|canned|sauteed)\b/i.test(keyword);
          const isQueryDry = /\b(dry|raw|flour|powder|mix|unprepared|raw_ingredient)\b/i.test(keyword);
          const isCandDry = /\b(dry|raw|flour|powder|mix|unprepared|raw_ingredient)\b/i.test(dbTitle);
          if (isQueryCooked && !isQueryDry && isCandDry && !dbTitle.includes('cooked') && m.source !== 'brand_official') return;
          if (isQueryDry && !isQueryCooked && /\b(cooked|boiled|baked|fried|roasted|plated|steamed|grilled|poached|toast|toasted|canned|sauteed)\b/i.test(dbTitle)) return;

          // RULE 2.6: Identity poison rejects (query vs candidate title)
          const qLow = keyword.toLowerCase();
          // milk / coffee / beverage components ≠ oat porridge / grain dish / bread / bar
          if (/\b(milk|coffee|espresso|water|juice|tea)\b/i.test(qLow) &&
              !/\b(oat|oats|porridge|cereal|bread|bar)\b/i.test(qLow) &&
              /\b(oat|oats|porridge|cereal|bread|bar|cracker)\b/i.test(dbTitle)) return;
          // olives ≠ olive loaf / luncheon meat
          if (/\bolive/.test(qLow) && !/\bloaf|lunch|mortadella|sausage|bologna\b/.test(qLow) &&
              /\b(loaf|lunch|mortadella|sausage|bologna|pork)\b/i.test(dbTitle)) return;
          // salad leaves / mixed greens ≠ taro / cassava leaves
          if (/\b(salad|lettuce|mixed\s+salad|greens|leaves)\b/i.test(qLow) &&
              /\b(taro|cassava|amaranth leaves|bitterleaf)\b/i.test(dbTitle) &&
              !/\btaro\b/i.test(qLow)) return;
          // berries ≠ basil / herbs
          if (/\b(berr|blueberry|raspberry|strawberry|fruit)\b/i.test(qLow) &&
              /\b(basil|oregano|thyme|parsley|cilantro|herb)\b/i.test(dbTitle)) return;
          // fresh fruit / fruit cup / fruit salad ≠ yogurt / drink / milk / actimel / probiotic / smoothie
          if (/\b(fruit|mixed fruit|fruit cup|fruit salad)\b/i.test(qLow) &&
              !/\b(yogurt|yoghurt|drink|milk|smoothie|probiotic|drinkable)\b/i.test(qLow) &&
              /\b(yogurt|yoghurt|drink|milk|smoothie|actimel|danone|probiotic|drinkable)\b/i.test(dbTitle)) return;
          // salad dish ≠ salad dressing / vinaigrette / sauce
          if (/\bsalad\b/i.test(qLow) && !/\bdressing|sauce|dip|vinaigrette\b/i.test(qLow) &&
              /\bdressing|sauce|dip|vinaigrette\b/i.test(dbTitle)) return;

          // RULE 3: Token Overlap & Noise Penalty
          let score = 0;
          
          // chickpeas in a salad/meal → prefer not dry raw beans
          if (/\bchickpea|garbanzo\b/i.test(qLow) && !/\bdry\b/i.test(qLow) &&
              /\bdry\b/i.test(dbTitle) && !/\bcooked|canned|boiled\b/i.test(dbTitle)) {
            score -= 80; // heavy penalty; allow if nothing else later
          }
          // fruit compote ≠ pure syrup
          if (/\b(compote|compot|mixed fruits?)\b/i.test(qLow) && /\bsyrup\b/i.test(dbTitle) && !/\bcompote\b/i.test(dbTitle)) {
            return;
          }
          if (/fruit syrup|^syrup\b/i.test(dbTitle.trim()) && /\b(compote|fruit|berr)/i.test(qLow) && !/\bcompote\b/i.test(dbTitle)) {
            return;
          }

          dbTokens.forEach(token => {
            if (queryTokens.has(token)) score += 20;
            else score -= 2;
          });
          
          if (m.source === 'brand_official' || m.brandPriority) {
            score += 25;
          }

          // RULE 4: Fatal Penalty for High-Risk Structural Mismatches
          const criticalMismatches = ['blue', 'gorgonzola', 'blood', 'liver', 'imitation'];
          if (criticalMismatches.some(badWord => dbTokens.has(badWord) && !queryTokens.has(badWord))) {
            score -= 200;
          }

          // L6: Reject fruit toppings for cheese queries
          if (/\b(mozzarella|cheddar|cheese)\b/i.test(qLow) && /\b(pineapple|cherry|strawberry|apple|fruit)\b/i.test(dbTitle) && !/\b(mozzarella|cheddar|cheese)\b/i.test(dbTitle)) {
            return;
          }

          if (score > highestScore && score > 0) {
            highestScore = score;
            bestMatch = m;
          }
        });

        return bestMatch;
      };

      

      let primaryDbId: string | null = null;
      let primaryDbSource: string = "estimated";
      let primaryBaseMatchName: string | null = null;
      let primaryBase100g: Record<string, number> | null = null;
      let primaryBaseWeightG: number = itemWeight;
      const truthNutrients: Record<string, number> = {};
      const lockedNutrientKeys = new Set<string>();
      const componentsDetailList: Array<{ name: string; searchQuery?: string; weightGrams: number; dbId?: string; dbSource?: string; [key: string]: any }> = [];

function parseServingSizeGrams(ssVal: string, totalItemWeight: number): number {
  if (!ssVal) return 100;
  const lower = ssVal.toLowerCase().trim();

  // 1. Explicit gram match e.g. "160g", "160 g", "(160g edible portion)", "per 160g"
  const gMatch = lower.match(/(\d+(?:\.\d+)?)\s*g\b/);
  if (gMatch) {
    const val = parseFloat(gMatch[1]);
    if (val > 0) return val;
  }

  // 2. Explicit ml match e.g. "250ml", "250 ml"
  const mlMatch = lower.match(/(\d+(?:\.\d+)?)\s*ml\b/);
  if (mlMatch) {
    const val = parseFloat(mlMatch[1]);
    if (val > 0) return val;
  }

  // 3. Explicit oz match e.g. "1oz", "1 oz"
  const ozMatch = lower.match(/(\d+(?:\.\d+)?)\s*oz\b/);
  if (ozMatch) {
    const val = parseFloat(ozMatch[1]);
    if (val > 0) return val * 28.35;
  }

  // 4. Fraction of pack/container check if no explicit g/ml match
  const isFractionHalf = lower.includes('1/2') || lower.includes('half');
  const isFractionThird = lower.includes('1/3') || lower.includes('third');
  const isFractionQuarter = lower.includes('1/4') || lower.includes('quarter');

  if (totalItemWeight > 0) {
    if (isFractionHalf) return totalItemWeight / 2;
    if (isFractionThird) return totalItemWeight / 3;
    if (isFractionQuarter) return totalItemWeight / 4;
  }

  // 5. Whole pack/wrap/container or explicit count/piece
  if (lower.includes('pack') || lower.includes('wrap') || lower.includes('container') || lower.includes('tub') || lower.includes('bag') || lower.includes('pouch') || lower.includes('piece') || lower.includes('slice') || lower.includes('portion') || lower.includes('serving') || lower.includes('biscuit') || lower.includes('cookie') || lower.includes('bun') || lower.includes('can') || lower.includes('bottle') || lower.includes('item')) {
    return totalItemWeight > 0 ? totalItemWeight : 100;
  }

  // 6. Generic number match e.g. "160" or "serving (30)"
  const numMatch = lower.match(/[\d.]+/);
  if (numMatch) {
    const val = parseFloat(numMatch[0]);
    // If it's a very small number like 1 or 2, it's almost certainly a piece count, not grams
    if (val <= 10 && totalItemWeight > 0) {
      return totalItemWeight; 
    }
    if (val > 0) return val;
  }

  return 100;
}

      const sauceKeywords = ['sauce', 'mayonnaise', 'mayo', 'dressing', 'gravy', 'dip', 'ketchup', 'mustard', 'butter', 'cheese', 'topping', 'syrup', 'spread', 'sambal', 'chili paste', 'cream', 'aioli', 'tartar', 'bbq', 'teriyaki', 'ranch'];

      const rawLabelHasData = item.rawNutritionLabel && typeof item.rawNutritionLabel === 'object'
        ? Object.keys(item.rawNutritionLabel).some((k: string) => {
            if (k === 'servingSize' || k === 'weight' || k === 'servingsPerContainer') return false;
            const v = item.rawNutritionLabel[k];
            return v !== undefined && v !== null && v !== '' && v !== '-' && v !== '--';
          })
        : false;

      let hasComponents = false;
      let truthMatch: any = null;

      if (rawLabelHasData) {
        const getVal = (keys: string | string[]): number => {
          if (!item.rawNutritionLabel || typeof item.rawNutritionLabel !== 'object') return 0;
          const keyArray = Array.isArray(keys) ? keys : [keys];
          const lowerKeyArray = keyArray.map(k => k.toLowerCase().replace(/[^a-z0-9]/g, ''));
          for (const k of Object.keys(item.rawNutritionLabel)) {
             const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
             if (lowerKeyArray.includes(cleanK)) {
                const val = item.rawNutritionLabel[k];
                if (val !== undefined && val !== null && val !== '' && val !== '-') {
                  if (cleanK.includes('calories') || cleanK.includes('energy') || cleanK.includes('kcal')) {
                    const parsedCal = parseLabelCalories(val);
                    if (parsedCal != null) return parsedCal;
                  }
                  const match = String(val).match(/[\d.]+/);
                  if (match) return parseFloat(match[0]);
                }
             }
          }
          return 0;
        };

        let ssGrams = 100;
        if (item.rawNutritionLabel) {
          const ssKey = Object.keys(item.rawNutritionLabel).find(k => {
            const clean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            return clean === 'servingsize' || clean === 'takaransaji';
          });
          if (ssKey) {
            const ssVal = String(item.rawNutritionLabel[ssKey]);
            ssGrams = parseServingSizeGrams(ssVal, itemWeight);
          }
        }

        const getRawStr = (keys: string | string[]): string | null => {
          if (!item.rawNutritionLabel || typeof item.rawNutritionLabel !== 'object') return null;
          const keyArray = Array.isArray(keys) ? keys : [keys];
          const lowerKeyArray = keyArray.map(k => k.toLowerCase().replace(/[^a-z0-9]/g, ''));
          for (const k of Object.keys(item.rawNutritionLabel)) {
             const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
             if (lowerKeyArray.includes(cleanK)) {
                const val = item.rawNutritionLabel[k];
                if (val !== undefined && val !== null && val !== '' && val !== '-' && val !== '--') {
                  return String(val);
                }
             }
          }
          return null;
        };

        const rawSodiumStr = getRawStr(['sodium', 'natrium']);
        const rawSaltStr = getRawStr(['salt', 'garam', 'sel']);
        let sodiumPerServingMg = 0;

        if (rawSodiumStr) {
          const match = rawSodiumStr.match(/[\d.]+/);
          if (match) {
            const val = parseFloat(match[0]);
            const lowerS = rawSodiumStr.toLowerCase();
            if (lowerS.includes('g') && !lowerS.includes('mg')) {
              sodiumPerServingMg = Math.round(val * 1000);
            } else {
              sodiumPerServingMg = Math.round(val);
            }
          }
        } else if (rawSaltStr) {
          const match = rawSaltStr.match(/[\d.]+/);
          if (match) {
            const saltVal = parseFloat(match[0]);
            const lowerSalt = rawSaltStr.toLowerCase();
            let saltInGramsPerServing = saltVal;
            if (lowerSalt.includes('mg') || (saltVal >= 20 && !lowerSalt.includes('g'))) {
              saltInGramsPerServing = saltVal / 1000;
            }
            sodiumPerServingMg = Math.round(saltInGramsPerServing * 400);

            const totalSaltGrams = parseFloat((saltInGramsPerServing * (itemWeight / ssGrams)).toFixed(2));
            const totalSodiumMg = Math.round(sodiumPerServingMg * (100 / ssGrams) * (itemWeight / 100));

            const saltLogMsg = `[Salt->Sodium Conversion] "${item.originalName || item.keyword}": Transcribed salt ${rawSaltStr} (per ${ssGrams}g serving) -> Converted to ${sodiumPerServingMg}mg sodium per serving. Total for ${itemWeight}g package: ${totalSaltGrams}g salt = ${totalSodiumMg}mg sodium.`;
            addDebugLog(saltLogMsg);

            const saltUserNote = `Converted printed salt (${rawSaltStr} per ${ssGrams}g) to sodium (${sodiumPerServingMg}mg/serving, ${totalSodiumMg}mg total). Formula: 1g salt = 400mg sodium.`;
            item.saltConversionNote = saltUserNote;
            item.rawNutritionLabel.sodium = `${sodiumPerServingMg}mg`;
          }
        } else {
          sodiumPerServingMg = getVal(['sodium', 'natrium']);
        }

        const calsVal = getVal(['calories', 'energy', 'kcal']);
        if (calsVal > 0) {
          // Only attach fields that are literally present on the printed/OCR label.
          // Missing → null (unlockable for USDA/component fill). Present zero → real 0 (locked).
          const scale = itemWeight / ssGrams;
          const presentOrNull = (keys: string | string[]): number | null => {
            if (!getRawStr(keys)) return null;
            return Math.round(getVal(keys) * scale * 10) / 10;
          };
          const sodiumPresent = !!(rawSodiumStr || rawSaltStr);
          // Sugar: UK/EU "of which sugars" often only total sugars (not US Added Sugars).
          // When printed sugar is present and addedSugar is not, use sugar as the locked
          // addedSugar proxy so sweetened pots do not show 0g (see Co-op granola yogurt).
          const sugarScaled = presentOrNull(['sugar', 'sugars', 'ofWhichSugars', 'of_which_sugars', 'totalsugars']);
          // Only trust addedSugar here if the label literally printed a distinct "Added Sugars" line
          // (US FDA format). UK/EU "of which sugars" is Total Sugar, not Added Sugar — do NOT
          // fall back to sugarScaled here. Leave addedSugar null when unprinted; the sugar engine
          // (server_sugar_engine.ts) derives it downstream from food type / ingredients / lactose rules.
          const addedSugarScaled = presentOrNull(['addedSugar', 'added_sugar', 'addedSugars', 'addedsugars']);
          truthMatch = {
            source: 'label',
            id: `printed_packaging_label_${item.scoutIndex}`,
            name: item.originalName || item.keyword,
            basisType: 'total',
            servingGrams: itemWeight,
            calories: Math.round(calsVal * scale),
            protein: presentOrNull(['protein', 'proteins']),
            fat: presentOrNull(['totalFat', 'fat', 'total_fat', 'lipids']),
            saturatedFat: presentOrNull(['saturatedFat', 'saturated_fat', 'satFat', 'saturated']),
            sodium: sodiumPresent ? Math.round(sodiumPerServingMg * scale) : null,
            carbohydrates: presentOrNull(['totalCarbohydrate', 'carbohydrate', 'carbohydrates', 'carbs']),
            totalFibre: presentOrNull(['totalFibre', 'fibre', 'totalFiber', 'fiber']),
            transFat: presentOrNull(['transFat', 'trans_fat', 'trans']),
            potassium: presentOrNull(['potassium', 'k']),
            sugar: sugarScaled,
            addedSugar: addedSugarScaled,
            ingredients: item.ingredientsList
          };
        }
      }

      // Helper to normalize strings for robust matching across special characters (®, ™, ’, etc.)
      const normalizeFoodStr = (s: string) => 
        s ? s.toLowerCase().replace(/[®™]/g, '').replace(/[’']/g, "'").trim() : '';
      
      const origNorm = normalizeFoodStr(item.originalName || '');
      const keyNorm = normalizeFoodStr(item.keyword || '');
      
      const isFuzzyMatch = (m: any) => {
        if (!m || Number(m.calories) <= 0) return false;

        // Reject incomplete garbage matches (like web search parsing errors) that lack basic macros.
        // A valid match should have at least 2 macros explicitly parsed (even if the value is 0).
        // EXEMPT brand_official (your own curated restaurant menu DB) from this check — those are
        // trusted structured records, not noisy scraped web text. A calories-only brand menu entry
        // is legitimate partial truth: it gets locked as truth and the rest is backfilled by the
        // existing Truth Data Backfill step further down, the same way it already works when a
        // brand record happens to have 0-placeholder macros instead of missing ones.
        const isTrustedCuratedSource = m.source === 'brand_official' || m.brandPriority;
        if (!isTrustedCuratedSource) {
          const hasP = m.protein !== undefined && m.protein !== null;
          const hasC = (m.carbohydrates !== undefined && m.carbohydrates !== null) || (m.carbs !== undefined && m.carbs !== null);
          const hasF = (m.fat !== undefined && m.fat !== null) || (m.totalFat !== undefined && m.totalFat !== null);
          if ((hasP ? 1 : 0) + (hasC ? 1 : 0) + (hasF ? 1 : 0) < 2) return false;
        }

        const mNameNorm = normalizeFoodStr(m.name || '');
        
        // Strict Brand-Specific Filter: Prevent generic database matches if brand is present
        const brandKeywords = ["mcdonald", "burger king", "wendy", "kfc", "taco bell", "subway", "domino", "pizza hut", "chipotle", "panera", "dunkin", "sonic", "popeyes", "arby", "dairy queen", "panda express"];
        const origBrand = brandKeywords.find(b => origNorm.includes(b));
        if (origBrand && !mNameNorm.includes(origBrand)) {
           return false;
        }

        const matchesOrig = origNorm && (
          mNameNorm === origNorm || 
          mNameNorm.includes(origNorm) || 
          origNorm.includes(mNameNorm)
        );
        
        const matchesKey = keyNorm && (
          mNameNorm === keyNorm || 
          mNameNorm.includes(keyNorm) || 
          keyNorm.includes(mNameNorm)
        );
      
        if (matchesOrig || matchesKey) return true;

        const tokenize = (str: string) => 
          str.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !['with', 'and', 'the', 'for', 'from', 'plus'].includes(w));
        
        const mTokens = tokenize(mNameNorm);
        const origTokens = tokenize(origNorm);
        const keyTokens = tokenize(keyNorm);

        // Guard: if candidate is a brand_official item, require brand name or strong category match.
        // Prevent flavor-token collisions (e.g. "Chocolate Cookie with white chocolate chunks" matching "Skinny Crunch Light Raspberry & White Choc")
        if (m.source === 'brand_official' || m.brandPriority) {
          const mChain = String(m.chainName || m.brand || '').toLowerCase().trim();
          const targetBrand = String(item.chainName || detectedChainKey || '').toLowerCase().trim();
          const origHasBrand = mChain && (origNorm.includes(mChain) || keyNorm.includes(mChain));

          // If the candidate belongs to an official brand/chain, but the food item has no brand detected
          // and the dish name does not mention the brand, REJECT brand matching.
          if (mChain && !targetBrand && !origHasBrand) {
            return false;
          }

          // If both have brand specified, ensure they align
          if (targetBrand && mChain && !targetBrand.includes(mChain) && !mChain.includes(targetBrand)) {
            return false;
          }

          // If query has no brand specified, but candidate belongs to a packaged brand (e.g. Skinny Crunch),
          // ensure the candidate name actually has the core dish type (e.g. cookie vs bar)
          const isBarCandidate = /\b(bar|crisp|sachet|cereal|crunch)\b/i.test(mNameNorm);
          const isCookieTarget = /\b(cookie|biscuit)\b/i.test(origNorm) || /\b(cookie|biscuit)\b/i.test(keyNorm);
          if (isCookieTarget && isBarCandidate) {
            return false;
          }

          const isSaladTarget = /\b(salad|bowl)\b/i.test(origNorm);
          const isSweetBarCandidate = /\b(bar|chocolate|crunch)\b/i.test(mNameNorm);
          if (isSaladTarget && isSweetBarCandidate) {
            return false;
          }
        }

        const DISH_FORM_WORDS = new Set([
          'sandwich', 'side', 'cup', 'bites', 'bowl', 'salad', 'wrap', 'burger',
          'sub', 'roll', 'bar', 'shake', 'platter', 'box', 'meal', 'cookie', 'biscuit'
        ]);

        // Chain/brand name tokens (e.g. "yolk") are near-universal across every dish on that
        // chain's menu and must not count as distinguishing evidence of identity — otherwise
        // two unrelated dishes from the same brand that both happen to be a "bowl" satisfy the
        // shared>=2 threshold below purely on brand name + generic form word (B-DISHID-01).
        const chainTokens = new Set(tokenize(String(detectedChainKey || '').replace(/_/g, ' ')));
        const isNoiseToken = (t: string) => DISH_FORM_WORDS.has(t) || chainTokens.has(t);

        const checkTokenMatch = (targetTokens: string[]) => {
          if (targetTokens.length === 0 || mTokens.length === 0) return false;

          // Guard: if the query names a specific dish "form" (side, sandwich, cup, bowl, bites,
          // etc.) and the candidate names a DIFFERENT form, reject outright. Sharing brand + main
          // ingredient words (e.g. "chicken") is not enough — "Chicken Side" and "Chicken
          // Sandwich" are different items/portions. Mirrors the Food Resolver's existing
          // BAR vs CUP/BOWL rule, applied here to the deterministic matcher.
          const targetForms = targetTokens.filter(t => DISH_FORM_WORDS.has(t));
          const mForms = mTokens.filter(t => DISH_FORM_WORDS.has(t));
          if (targetForms.length > 0 && mForms.length > 0) {
            const compatible = targetForms.some(tf => mForms.includes(tf));
            if (!compatible) return false;
          }

          let shared = 0;
          let distinguishingShared = 0;
          targetTokens.forEach(t => {
            if (mTokens.some(mt => mt.startsWith(t) || t.startsWith(mt))) {
              shared++;
              if (!isNoiseToken(t)) distinguishingShared++;
            }
          });
          // Require at least 2 shared DISTINGUISHING tokens for brand_official candidates —
          // brand name + dish-form word alone (e.g. "yolk" + "bowl") is not evidence two dishes
          // are the same item.
          if (m.source === 'brand_official' || m.brandPriority) {
            return distinguishingShared >= 2 ||
              (targetTokens.length > 0 && shared / targetTokens.length >= 0.5 && distinguishingShared >= 1);
          }
          return shared >= 2 && shared / targetTokens.length >= 0.5;
        };

        return checkTokenMatch(origTokens) || checkTokenMatch(keyTokens);
      };
      
      // 1. Try strict brand_official sources first
      let webMatchRaw = databaseMatchesArray.find((m: any) => 
        (m.source === 'brand_official' || m.brandPriority) &&
        isFuzzyMatch(m)
      );
      
      // 2. Try verified database sources next (USDA, OpenFoodFacts, internal curator, catalog)
      if (!webMatchRaw) {
        webMatchRaw = databaseMatchesArray.find((m: any) => 
          (m.source === 'usda' || m.source === 'off' || m.source === 'internal_dish_cache' || m.source === 'canonical_dict' || String(m.id || '').startsWith('resolver_')) &&
          isFuzzyMatch(m)
        );
      }

      // 2b. Try local canonical base food dictionary before untrusted web search
      if (!webMatchRaw) {
        const canonicalBase = lookupCanonicalBaseFood(item.originalName || item.keyword || '');
        if (canonicalBase) {
          webMatchRaw = {
            dish_name: item.originalName || item.keyword,
            source: 'canonical_dict',
            calories: canonicalBase.calories,
            protein: canonicalBase.protein,
            carbohydrates: canonicalBase.carbohydrates,
            totalFat: canonicalBase.totalFat,
            saturatedFat: canonicalBase.saturatedFat,
            sodium: canonicalBase.sodium,
            sugar: canonicalBase.sugar,
            totalFibre: canonicalBase.totalFibre,
            fdcId: canonicalBase.fdcId
          };
        }
      }

      // 3. Fallback to web search sources if no canonical DB match was found
      if (!webMatchRaw) {
        webMatchRaw = databaseMatchesArray.find((m: any) => 
          (m.source === 'web_search' || m.source === 'tavily' || m.source === 'serper' || m.source === 'google_cse') &&
          isFuzzyMatch(m)
        );
      }
      
      // 4. Fallback to any remaining fuzzy match
      if (!webMatchRaw) {
        webMatchRaw = databaseMatchesArray.find(isFuzzyMatch);
      }

      // Prevent single-ingredient brand matches from overriding multi-component home-cooked or composite dishes
      const isMultiComponentHomeCooked = item.components && item.components.length > 1 && diningEnvironment === 'home_cooked';
      const isBrandMatch = webMatchRaw && (webMatchRaw.source === 'brand_official' || webMatchRaw.brandPriority);

      const isMultiComponentItem = Array.isArray(item.components) && item.components.length >= 2;
      const isCompositeOrUnofficial = isUnofficialOrCompositeDish(item.originalName || item.keyword, item.chainName || detectedChainKey, item.provenance, item.notes, item).isUnofficial;
      const isGroceryBrand = isGroceryBrandSync(item.chainName || detectedChainKey || item.originalName || item.keyword || '');

      if (!truthMatch && webMatchRaw) {
        const src = webMatchRaw.source === 'brand_official' || webMatchRaw.brandPriority ? 'brand_official' : 'web_search';
        if (isMultiComponentItem && (src === 'web_search' || isGroceryBrand || (isCompositeOrUnofficial && src !== 'brand_official') || (isMultiComponentHomeCooked && src !== 'brand_official'))) {
          addDebugLog(`[TruthSkip] multi-component / composite dish "${item.originalName || item.keyword}": ignoring single-dish match "${webMatchRaw.dish_name || webMatchRaw.name}" as parent dish truth (use component decomposition + scout budget)`);
          // Do NOT set item.rawNutritionLabel from skipped single-dish parent match (prevents fake label hard locks)
        } else if (isMultiComponentHomeCooked && !isBrandMatch) {
          addDebugLog(`[TruthSkip] home-cooked multi-component "${item.originalName || item.keyword}": ignoring non-brand match (use components + scout budget)`);
        } else {
          truthMatch = {
            ...webMatchRaw,
            source: src
          };
        }
      } else if (truthMatch && (truthMatch.source === 'label' || truthMatch.source === 'label_partial') && webMatchRaw && (!isMultiComponentHomeCooked || isBrandMatch)) {
        const webBasis = webMatchRaw.basisType || 'per_100g';
        const webServing = Number(webMatchRaw.servingGrams) || (webBasis === 'per_100g' ? 100 : itemWeight);
        const webScale = (webServing > 0 && itemWeight > 0) ? itemWeight / webServing : 1;
        
        // Guard against corrupted DB matches poisoning the OCR label
        const webCalsForScale = Number(webMatchRaw.calories || 0) * webScale;
        const ocrCals = Number(truthMatch.calories || 0);
        if (ocrCals > 0 && webCalsForScale > 0) {
            const diff = Math.abs(webCalsForScale - ocrCals) / ocrCals;
            if (diff > 0.45) {
                addDebugLog(`[Truth Merge] Database match calories (${webCalsForScale.toFixed(0)}) deviate too much from OCR label (${ocrCals}). Refusing to merge DB macros.`);
                webMatchRaw = null;
            }
        } else if (ocrCals === 0 && webCalsForScale > 0) {
            // Label had 0 cals / missing nutrients — adopt database match instead of locking to 0
            addDebugLog(`[Truth Merge] OCR label had 0 calories; adopting database match (${webMatchRaw.name}) to avoid 0-macro receipt.`);
            truthMatch = {
              ...webMatchRaw,
              source: webMatchRaw.source || 'usda'
            };
        }
        
        const mapField = (labelKey: string, webKeys: string[]) => {
           if (!webMatchRaw) return;
           // Check if the field was missing from printed OCR or generated via estimated decomposition
           const isUnprintedOrEstimated = 
              truthMatch[labelKey] === undefined || 
              truthMatch[labelKey] === null || 
              (truthMatch._estimatedFields && truthMatch._estimatedFields.includes(labelKey)) ||
              (truthMatch.rawNutritionLabel && (truthMatch.rawNutritionLabel[labelKey] === undefined || truthMatch.rawNutritionLabel[labelKey] === null));
      
           if (isUnprintedOrEstimated) {
              for (const wk of webKeys) {
                 if (webMatchRaw[wk] !== undefined && webMatchRaw[wk] !== null) {
                    truthMatch[labelKey] = Math.round(Number(webMatchRaw[wk]) * webScale * 10) / 10;
                    break;
                 }
              }
           }
        };
      
        // Keep calories locked to the kiosk/OCR printed value. Only fill MISSING macros.
        mapField('protein', ['protein']);
        mapField('fat', ['fat', 'totalFat']);
        mapField('saturatedFat', ['saturatedFat', 'satFat']);
        mapField('carbohydrates', ['carbohydrates', 'carbs', 'totalCarbohydrate']);
        mapField('sodium', ['sodium']);
        mapField('totalFibre', ['totalFibre', 'fiber']);
        mapField('sugar', ['sugar']);
        mapField('addedSugar', ['addedSugar']);
        mapField('potassium', ['potassium']);
        mapField('transFat', ['transFat']);
        
        // Gap-fill micros only. NEVER inject USDA/web macros into truthMatch.nutrients when
        // the truth source is a printed label — that path previously overwrote correct
        // label-scaled locks (e.g. Co-op beef 37kcal/7.3p/63mg Na → USDA 35/5.5/10.7).
        const LABEL_PROTECTED_NUTRIENT_KEYS = new Set([
          'calories', 'protein', 'totalFat', 'fat', 'saturatedFat', 'satFat',
          'sodium', 'carbohydrates', 'carbs', 'totalCarbohydrate', 'totalFibre', 'fiber',
          'addedSugar', 'sugar', 'transFat', 'potassium'
        ]);
        if (webMatchRaw && webMatchRaw.nutrients && typeof webMatchRaw.nutrients === 'object') {
           if (!truthMatch.nutrients) truthMatch.nutrients = {};
           const isLabelTruth = truthMatch.source === 'label' || truthMatch.source === 'label_partial';
           for (const [k, v] of Object.entries(webMatchRaw.nutrients)) {
              if (isLabelTruth && LABEL_PROTECTED_NUTRIENT_KEYS.has(k)) continue;
              if (truthMatch.nutrients[k] === undefined || truthMatch.nutrients[k] === null) {
                  truthMatch.nutrients[k] = Number(v) * webScale;
              }
           }
        }
      }

      let isTruthAnchored = false;
      if (truthMatch) {
        let webCals = Number(truthMatch.calories || 0);
        let webProt = Number(truthMatch.protein || 0);
        let webFat = Number(truthMatch.fat ?? truthMatch.totalFat ?? 0);
        let webSatFat = Number(truthMatch.saturatedFat || 0);
        let webNa = Number(truthMatch.sodium || 0);
        let webCarbs = Number(truthMatch.carbohydrates ?? truthMatch.carbs ?? 0);
        let webFibre = Number(truthMatch.totalFibre ?? truthMatch.fiber ?? 0);
        let webAddedSugar = truthMatch.addedSugar != null ? Number(truthMatch.addedSugar) : 0;
        let webSugar = truthMatch.sugar != null ? Number(truthMatch.sugar) : 0;
        let webPotassium = Number(truthMatch.potassium || 0);

        const rawBaseCals = webCals;
        const rawBaseProt = webProt;
        const rawBaseFat = webFat;
        const rawBaseSatFat = webSatFat;
        const rawBaseNa = webNa;
        const rawBaseCarbs = webCarbs;
        const rawBaseFibre = webFibre;

        // Track which fields the truth source actually recorded, distinct from a real
        // verified zero (e.g. a menu explicitly listing "Protein 0g"). Missing fields
        // (null/undefined in the source) are free to be filled by the component/USDA
        // backfill below; a genuinely recorded zero must never be overwritten later.
        // If a brand or label match has calories > 10 but ALL three major macros (protein, carbohydrates, fat) are 0 (or null/undefined),
        // we treat those zeros as placeholder/unrecorded rather than genuine zero locks. This allows the first-principles component backfill to calculate and complete them.
        const isPlaceholderZeroMacros = Number(truthMatch.calories || 0) > 10 &&
          (truthMatch.protein === 0 || truthMatch.protein == null) &&
          (truthMatch.carbohydrates === 0 || truthMatch.carbohydrates == null || truthMatch.carbs === 0 || truthMatch.carbs == null) &&
          (truthMatch.fat === 0 || truthMatch.fat == null || truthMatch.totalFat === 0 || truthMatch.totalFat == null);

        if (isPlaceholderZeroMacros) {
          const clearZeros = (obj: any) => {
            if (!obj || typeof obj !== 'object') return;
            ['protein', 'totalFat', 'fat', 'carbohydrates', 'carbs', 'totalCarbohydrate'].forEach(k => {
              if (obj[k] !== undefined && String(obj[k]).match(/^[0.\s]*(g|mg)?$/i)) {
                delete obj[k];
              }
            });
          };
          if (truthMatch) clearZeros(truthMatch.rawNutritionLabel);
          clearZeros(item.rawNutritionLabel);
        }

        const proteinKnown = truthMatch.protein != null && (!isPlaceholderZeroMacros || truthMatch.protein !== 0);
        const fatKnown = (truthMatch.fat != null || truthMatch.totalFat != null) && (!isPlaceholderZeroMacros || (truthMatch.fat !== 0 && truthMatch.totalFat !== 0));
        const satFatKnown = truthMatch.saturatedFat != null && (!isPlaceholderZeroMacros || truthMatch.saturatedFat !== 0);
        const sodiumKnown = truthMatch.sodium != null && (!isPlaceholderZeroMacros || truthMatch.sodium !== 0);
        const carbsKnown = (truthMatch.carbohydrates != null || truthMatch.carbs != null) && (!isPlaceholderZeroMacros || (truthMatch.carbohydrates !== 0 && truthMatch.carbs !== 0));
        const fibreKnown = (truthMatch.totalFibre != null || truthMatch.fiber != null) && (!isPlaceholderZeroMacros || (truthMatch.totalFibre !== 0 && truthMatch.fiber !== 0));

        // Durable lock map: survives cooking, reality checks, aggregation, and receipt.
        // Only lock values that the source actually provided (after serving rescale below).
        const lockTruth = (key: string, value: unknown) => {
          if (value === undefined || value === null || value === '') return;
          const n = Number(value);
          if (!Number.isFinite(n)) return;
          // Bug 1 Fix: Do not lock zero for soft micros on unverified web searches
          if (n === 0 && !(truthMatch.source === 'label' || truthMatch.source === 'brand_official') && 
              ['sugar', 'addedSugar', 'totalFibre', 'fiber', 'potassium', 'transFat', 'vitaminD', 'calcium', 'iron'].includes(key)) {
             return;
          }
          truthNutrients[key] = n;
          lockedNutrientKeys.add(key);
        };

        // If the truth source has a known real serving size, webCals/webProt/etc above
        // are FOR THAT SERVING SIZE, not for the Scout's guessed itemWeight. Rescale onto
        // the item's actual consumed weight before anything treats them as "the totals
        // for itemWeight grams".
        const truthBasis = truthMatch.basisType || (truthMatch.source === 'brand_official' || truthMatch.brandPriority ? 'per_dish' : 'per_100g');
        const isDishBasis = truthBasis === 'per_dish' || truthBasis === 'total' || truthBasis === 'per_portion' || truthBasis === 'per_serving' || truthBasis === 'per_pack';
        const truthServingGrams = Number(truthMatch.servingGrams) || (truthBasis === 'per_100g' ? 100 : 0);

        let servingScale = 1.0;
        if (isDishBasis) {
          if (truthServingGrams > 0 && truthServingGrams !== 100 && itemWeight > 0 && Math.abs(itemWeight - truthServingGrams) > 5) {
            const rawServingScale = itemWeight / truthServingGrams;
            const queryText = [item.originalName, item.keyword, (req as any)?.body?.message].filter(Boolean).join(' ').toLowerCase();
            const hasExplicitFraction = /\b(half|quarter|0\.5|0\.25|0\.75|1\.5|2x|double|3x|portion|bowls?|servings?|pieces?)\b/i.test(queryText);
            const hasExplicitWeight = /\b\d+(\.\d+)?\s*(g|grams|ml|oz|lbs|kg)\b/i.test(queryText);

            if (!hasExplicitFraction && !hasExplicitWeight && rawServingScale >= 0.5 && rawServingScale <= 2.5) {
              servingScale = 1.0;
              addDebugLog(`[Smart Unit Locking] Clamped scale factor ${rawServingScale.toFixed(2)} to 1.0x for branded restaurant item "${item.originalName || item.keyword}" (within standard container margin).`);
            } else {
              servingScale = rawServingScale;
              addDebugLog(`[Truth Serving Rescale] "${item.originalName || item.keyword}": DB dish serving is ${truthServingGrams}g, item consumed weight is ${itemWeight}g. Rescaling dish truth values by factor ${servingScale.toFixed(2)}.`);
            }
          } else {
            servingScale = 1.0;
            addDebugLog(`[Truth Serving Rescale] "${item.originalName || item.keyword}": Whole dish/portion basis (${truthBasis}). Keeping truth values unscaled (${webCals} kcal).`);
          }
        } else if (truthServingGrams > 0 && itemWeight > 0 && truthServingGrams !== itemWeight) {
          servingScale = itemWeight / truthServingGrams;
          addDebugLog(`[Truth Serving Rescale] "${item.originalName || item.keyword}": DB rate serving is ${truthServingGrams}g, item consumed weight is ${itemWeight}g. Rescaling truth values by factor ${servingScale.toFixed(2)}.`);
        }

        if (servingScale !== 1.0) {
          webCals = Math.round(webCals * servingScale);
          webProt = Math.round(webProt * servingScale * 10) / 10;
          webFat = Math.round(webFat * servingScale * 10) / 10;
          webSatFat = Math.round(webSatFat * servingScale * 10) / 10;
          webNa = Math.round(webNa * servingScale);
          webCarbs = Math.round(webCarbs * servingScale * 10) / 10;
          webFibre = Math.round(webFibre * servingScale * 10) / 10;
          webAddedSugar = Math.round(webAddedSugar * servingScale * 10) / 10;
          webSugar = Math.round(webSugar * servingScale * 10) / 10;
          webPotassium = Math.round(webPotassium * servingScale);
        }

        // Gate 4 Check: OCR Duplicate Broadcast Scrape Detector
        if (truthMatch && (truthMatch.isOcrCollision || (truthMatch.anomalyFlags && truthMatch.anomalyFlags.includes('OCR_BROADCAST_COLLISION')))) {
          addDebugLog(`[OCR Broadcast Detector] COLLISION DETECTED: "${truthMatch.name || truthMatch.dish_name}" shares unverified OCR calorie count (${truthMatch.calories} kcal) with distinct items in brand menu. Suppressing locked truth status.`);
          if (!item.anomalyFlags) item.anomalyFlags = [];
          if (!item.anomalyFlags.includes('OCR_BROADCAST_COLLISION')) item.anomalyFlags.push('OCR_BROADCAST_COLLISION');
          if (truthMatch.id) quarantinedIdsSet.add(String(truthMatch.id));
          truthMatch = null;
        }

        // Gate 1 Check: Thermodynamic Density Sanity Gate (Pre-Lock Validation)
        if (truthMatch && webCals > 0) {
          const densityCheckGrams = truthServingGrams > 0 ? truthServingGrams : itemWeight;
          const densityResult = checkThermodynamicDensitySanity(
            item.originalName || item.keyword || truthMatch.name || truthMatch.dish_name || '',
            item.foodType,
            item.cookingMethod,
            webCals,
            densityCheckGrams
          );

          if (densityResult.isBreach) {
            addDebugLog(`[Thermodynamic Density Gate] BREACH detected for "${item.originalName || item.keyword}" (${densityResult.density.toFixed(1)} kcal/100g > ceiling ${densityResult.ceiling} kcal/100g for category ${densityResult.category}). Flagging DENSITY_ANOMALY_BREACH, stripping brand calorie lock, and falling back to USDA component decomposition.`);
            if (!item.anomalyFlags) item.anomalyFlags = [];
            if (!item.anomalyFlags.includes('DENSITY_ANOMALY_BREACH')) item.anomalyFlags.push('DENSITY_ANOMALY_BREACH');
            if (truthMatch.id) quarantinedIdsSet.add(String(truthMatch.id));
            if (truthMatch.fdcId) quarantinedIdsSet.add(String(truthMatch.fdcId));
            truthMatch = null;
          }
        }

        // Gate 3 Check: Archetype Macro Invariant Constraints
        if (truthMatch && webCals > 0) {
          const macroCheck = checkArchetypeMacroBounds(
            item.originalName || item.keyword || truthMatch.name || truthMatch.dish_name || '',
            item.foodType,
            item.cookingMethod,
            webCals,
            webProt,
            webCarbs,
            webFat
          );

          if (macroCheck.violated) {
            addDebugLog(`[Macro Archetype Violation] Aborting brand calorie lock for "${item.originalName || item.keyword}" due to archetype bound breach (${macroCheck.reason}). Re-evaluating via first-principles ingredient modeling.`);
            if (!item.anomalyFlags) item.anomalyFlags = [];
            if (!item.anomalyFlags.includes('ARCHETYPE_BOUND_VIOLATION')) item.anomalyFlags.push('ARCHETYPE_BOUND_VIOLATION');
            if (truthMatch.id) quarantinedIdsSet.add(String(truthMatch.id));
            if (truthMatch.fdcId) quarantinedIdsSet.add(String(truthMatch.fdcId));
            truthMatch = null;
          }
        }

        // Lock only fields the source actually recorded (post-rescale) if truthMatch passed all sanity gates.
        if (truthMatch) {
          if (truthMatch.calories != null) lockTruth('calories', webCals);
          if (proteinKnown) lockTruth('protein', webProt);
          if (fatKnown) lockTruth('totalFat', webFat);
          if (satFatKnown) lockTruth('saturatedFat', webSatFat);
          if (sodiumKnown) lockTruth('sodium', webNa);
          if (carbsKnown) lockTruth('carbohydrates', webCarbs);
          if (fibreKnown) lockTruth('totalFibre', webFibre);
          // Printed sugar / added sugar / potassium / trans fat (label panels often have these)
          if (truthMatch.addedSugar != null) lockTruth('addedSugar', webAddedSugar);
          if (truthMatch.sugar != null) lockTruth('sugar', webSugar);
          if (truthMatch.potassium != null) lockTruth('potassium', webPotassium);
          if (truthMatch.transFat != null) lockTruth('transFat', Number(truthMatch.transFat) * servingScale);
        }

        // Extra nutrient keys (brand JSON / soft micro fill). NEVER overwrite a printed lock.
        // For printed labels, also skip re-locking CORE macros from any residual nutrients map
        // so USDA component fill cannot poison label-scaled values (debug job beef topside).
        if (truthMatch && truthMatch.nutrients && typeof truthMatch.nutrients === 'object') {
          const isLabelTruth = truthMatch.source === 'label' || truthMatch.source === 'label_partial';
          const CORE_FROM_NUTRIENTS_BLOCK = new Set([
            'calories', 'protein', 'totalFat', 'fat', 'saturatedFat', 'satFat',
            'sodium', 'carbohydrates', 'carbs', 'totalFibre', 'fiber', 'addedSugar', 'sugar'
          ]);
          for (const k of NUTRIENT_KEYS) {
            if (lockedNutrientKeys.has(k)) continue;
            if (isLabelTruth && CORE_FROM_NUTRIENTS_BLOCK.has(k)) continue;
            if (truthMatch.nutrients[k] !== undefined && truthMatch.nutrients[k] !== null) {
              const raw = Number(truthMatch.nutrients[k]);
              if (!Number.isFinite(raw)) continue;
              
              if (isPlaceholderZeroMacros && raw === 0 && ['protein', 'totalFat', 'fat', 'carbohydrates', 'carbs', 'saturatedFat', 'satFat', 'sodium', 'totalFibre', 'fiber'].includes(k)) {
                continue;
              }
              
              // truthMatch.nutrients from web merge is already portion-scaled; label top-level
              // fields used servingScale above. Brand dish nutrients may still be per-serving.
              const alreadyPortionScaled = isLabelTruth || servingScale === 1;
              const scaled = alreadyPortionScaled
                ? raw
                : ((truthServingGrams > 0 && itemWeight > 0 && truthServingGrams !== itemWeight)
                  ? raw * (itemWeight / truthServingGrams)
                  : raw);
              // Soft micros for labels: store on primary profile later without hard-lock
              // unless brand_official / non-label. For label, only soft-fill unlocked micros.
              if (isLabelTruth) {
                if (!truthMatch._softMicros) truthMatch._softMicros = {};
                truthMatch._softMicros[k] = scaled;
              } else {
                lockTruth(k, scaled);
              }
            }
          }
        }

        const nameLower = String(item.originalName || item.keyword || '').toLowerCase();
        const impliesCarbs = /rice|bowl|bread|sandwich|bun|pasta|noodle|wrap|burrito|pizza|burger|ciabatta|bagel|oat|potato|fries/.test(nameLower);
        const webCalsNum = Number(webCals);
        const webProtNum = Number(webProt);
        const webFatNum = Number(webFat);
        const atwaterFromMacros = webProtNum * 4 + webCarbs * 4 + webFatNum * 9;
        const atwaterDev = webCalsNum > 0 ? Math.abs(atwaterFromMacros - webCalsNum) / webCalsNum : 1;

        const isTrustedSource = truthMatch ? (truthMatch.source === 'brand_official' || truthMatch.source === 'label') : false;
        const isMultiComponent = item.components && item.components.length >= 2;

        const impliesSugarDenseCondiment = /\b(jams?|jellies|preserves?|marmalades?|honey|syrups?|treacle|molasses|nutella)\b/.test(nameLower);
        const webDensityPer100g = itemWeight > 0 ? (webCalsNum / itemWeight) * 100 : webCalsNum;

        const webRejected =
          !truthMatch ||
          !(webCalsNum > 0) ||
          (isMultiComponent && !isTrustedSource) ||
          (!isTrustedSource && (impliesCarbs && webCarbs <= 0 && webFatNum * 9 > webCalsNum * 0.85)) ||
          (!isTrustedSource && atwaterDev > 0.45) ||
          (!isTrustedSource && webFatNum > webCalsNum / 5) ||
          (!isTrustedSource && impliesSugarDenseCondiment && webDensityPer100g < 150) ||
          (!isTrustedSource && Boolean(detectedChainKey) && registeredChainSources.length === 0);

        if (webRejected) {
          addDebugLog(
            `[Truth Direct Injection] REJECTED for "${item.originalName || item.keyword}" (kcal=${webCalsNum}, P=${webProtNum}, C=${webCarbs}, F=${webFatNum}, atwaterDev=${(atwaterDev * 100).toFixed(0)}%). Falling back to components/USDA.`
          );
          // CRITICAL: locks were filled before reject — clear them so budget/reconcile do not hard-lock fake web calories
          Object.keys(truthNutrients).forEach((k) => { delete truthNutrients[k]; });
          lockedNutrientKeys.clear();
          isTruthAnchored = false;
          addDebugLog(`[TruthLock] cleared locks after REJECT for "${item.originalName || item.keyword}"`);
        } else {
          isTruthAnchored = true;
          const dbgStr = `[Truth Data Extraction DEBUG] truthMatch.nutrients = ${JSON.stringify(truthMatch?.nutrients)}, truthMatch.protein = ${truthMatch?.protein}, proteinKnown=${proteinKnown}, isPlaceholderZeroMacros=${isPlaceholderZeroMacros}, lockedNutrientKeys=${Array.from(lockedNutrientKeys).join(',')}`;
          addDebugLog(dbgStr);
          primaryDbSource = truthMatch.source === 'label' ? 'label' : (truthMatch.source === 'brand_official' ? 'brand_official' : 'web_search');
          primaryDbId = truthMatch.id || `${primaryDbSource}_${item.scoutIndex}`;
          primaryBaseMatchName = truthMatch.name || item.originalName || item.keyword;

          // Gap-fill ANY unlocked nutrient from scout components (first principles), not only macros.
          const inferredFromIngredients: Record<string, number> = {};
          NUTRIENT_KEYS.forEach((k) => { inferredFromIngredients[k] = 0; });
          let backfillSource: 'none' | 'ingredient_decomposition' | 'name_canonical' = 'none';

          if (item.components && Array.isArray(item.components) && item.components.length > 0) {
            const rawSums: Record<string, number> = {};
            NUTRIENT_KEYS.forEach((k) => { rawSums[k] = 0; });

            const ocrTargetCalories = Number(truthMatch.calories || 371);

            item.components.forEach((comp: any) => {
              if (!comp || typeof comp !== 'object') return;
              const compWeight = itemWeight * ((comp.volumePercentage || 100) / 100);
              const rawQuery = comp.searchQuery || comp.name || comp.keyword || "";
              if (!rawQuery || compWeight <= 0 || isGenericZeroNutrientDiluent(rawQuery)) return;
              
              const sanitizedQuery = sanitizeComponentQuery(rawQuery);
              const query = prepareSearchQueryWithState(sanitizedQuery, item.cookingMethod || scoutCookingMethod || 'baked');
              const bestMatch = findBestMatch(query);
              const baseNutrients = (bestMatch && dbMatchMap.has(bestMatch.id)) ? dbMatchMap.get(bestMatch.id) : getClinicalDefaultNutrients100g(query);
              if (!baseNutrients) return;

              const f = compWeight / 100;
              comp.calories = Number(baseNutrients.calories || 0) * f;
              comp.protein = Number(baseNutrients.protein || 0) * f;
              comp.carbohydrates = Number(baseNutrients.carbohydrates || baseNutrients.carbs || 0) * f;
              comp.totalFat = Number(baseNutrients.totalFat || baseNutrients.fat || 0) * f;
              comp.saturatedFat = Number(baseNutrients.saturatedFat || baseNutrients.satFat || 0) * f;
              comp.sodium = Number(baseNutrients.sodium || 0) * f;
              comp.sugar = Number(baseNutrients.sugar || 0) * f;
              
              // Attach database names for UI sub-rows
              comp.name = bestMatch ? bestMatch.name : query;
              comp.source = bestMatch ? bestMatch.source : "estimated";

              NUTRIENT_KEYS.forEach((key) => {
                let val = 0;
                if (key === 'carbohydrates') {
                  val = Number(baseNutrients.carbohydrates || baseNutrients.carbs || 0) * f;
                } else if (key === 'totalFat') {
                  val = Number(baseNutrients.totalFat || baseNutrients.fat || 0) * f;
                } else if (key === 'saturatedFat') {
                  val = Number(baseNutrients.saturatedFat || baseNutrients.satFat || 0) * f;
                } else {
                  val = Number(baseNutrients[key] || 0) * f;
                }
                rawSums[key] += val;
              });
            });

            const rawSumCalories = rawSums['calories'] || 0;
            const scaleFactor = (rawSumCalories > 0 && ocrTargetCalories > 0) 
              ? ocrTargetCalories / rawSumCalories 
              : 1;

            if (scaleFactor !== 1 || rawSumCalories > 0) {
              item.components.forEach((comp: any) => {
                if (!comp || typeof comp !== 'object' || comp.calories === undefined) return;
                comp.calories = Math.round(comp.calories * scaleFactor);
                comp.protein = Math.round(comp.protein * scaleFactor * 10) / 10;
                comp.carbohydrates = Math.round(comp.carbohydrates * scaleFactor * 10) / 10;
                comp.totalFat = Math.round(comp.totalFat * scaleFactor * 10) / 10;
                comp.saturatedFat = Math.round(comp.saturatedFat * scaleFactor * 10) / 10;
                comp.sodium = Math.round(comp.sodium * scaleFactor);
                comp.sugar = Math.round(comp.sugar * scaleFactor * 10) / 10;
              });
              
              NUTRIENT_KEYS.forEach((key) => {
                if (key === 'calories' || key === 'sodium') {
                  inferredFromIngredients[key] = Math.round((rawSums[key] || 0) * scaleFactor);
                } else {
                  inferredFromIngredients[key] = Math.round((rawSums[key] || 0) * scaleFactor * 10) / 10;
                }
              });
              backfillSource = 'ingredient_decomposition';
              truthMatch._isComponentDecomposition = true;
            }
          }

          const estimatedFields: string[] = [];
          if (!proteinKnown) {
            const val = inferredFromIngredients.protein > 0 ? inferredFromIngredients.protein : (webCals > 0 ? Math.round(((webCals * 0.20) / 4) * 10) / 10 : 0);
            if (val > 0) {
              webProt = val;
              estimatedFields.push('protein');
            }
          }
          if (!fatKnown) {
            const val = inferredFromIngredients.totalFat > 0 ? inferredFromIngredients.totalFat : (webCals > 0 ? Math.round(((webCals * 0.35) / 9) * 10) / 10 : 0);
            if (val > 0) {
              webFat = val;
              estimatedFields.push('totalFat');
            }
          }
          if (!satFatKnown) {
            const val = inferredFromIngredients.saturatedFat > 0 ? inferredFromIngredients.saturatedFat : (webFat > 0 ? Math.round((webFat * 0.25) * 10) / 10 : 0);
            if (val > 0) {
              webSatFat = val;
              estimatedFields.push('saturatedFat');
            }
          }
          if (!sodiumKnown) {
            const val = inferredFromIngredients.sodium > 0 ? inferredFromIngredients.sodium : (webCals > 0 ? Math.round(webCals * 1.5) : 0);
            if (val > 0) {
              webNa = val;
              estimatedFields.push('sodium');
            }
          }
          if (!carbsKnown) {
            const val = inferredFromIngredients.carbohydrates > 0 ? inferredFromIngredients.carbohydrates : (webCals > 0 ? Math.round(((webCals * 0.45) / 4) * 10) / 10 : 0);
            if (val > 0) {
              webCarbs = val;
              estimatedFields.push('carbohydrates');
            }
          }
          if (!fibreKnown) {
            const val = inferredFromIngredients.totalFibre > 0 ? inferredFromIngredients.totalFibre : (webCarbs > 0 ? Math.round((webCarbs * 0.08) * 10) / 10 : 0);
            if (val > 0) {
              webFibre = val;
              estimatedFields.push('totalFibre');
            }
          }
          if (!lockedNutrientKeys.has('sugar')) {
            const val = inferredFromIngredients.sugar > 0 ? inferredFromIngredients.sugar : 0;
            if (val > 0) {
              webSugar = val;
              estimatedFields.push('sugar');
            }
          }
          // Remaining unlocked keys (vitamins/minerals/etc.) stay estimated-only
          NUTRIENT_KEYS.forEach((key) => {
            if (lockedNutrientKeys.has(key)) return;
            if (['calories', 'protein', 'totalFat', 'saturatedFat', 'sodium', 'carbohydrates', 'totalFibre', 'sugar'].includes(key)) return;
            if (inferredFromIngredients[key] > 0) estimatedFields.push(key);
          });

          addDebugLog(`[Truth Data Backfill] "${item.originalName || item.keyword}": filled missing fields via ${backfillSource !== 'none' ? backfillSource : 'Atwater macro distribution'}; locked truth keys=[${Array.from(lockedNutrientKeys).join(', ')}]; estimated=[${estimatedFields.join(', ')}].`);

          const per100 = (portionVal: number) =>
            itemWeight > 0 ? Math.round((portionVal / itemWeight) * 100 * 10) / 10 : portionVal;
          primaryBase100g = {
            servingSizeGrams: 100,
            basisType: 'per_100g' as any,
            calories: itemWeight > 0 ? Math.round((webCals / itemWeight) * 100) : webCals,
            protein: per100(webProt),
            totalFat: per100(webFat),
            saturatedFat: per100(webSatFat),
            transFat: 0,
            carbohydrates: per100(webCarbs),
            // Prefer locked / printed sugar — never hardcode 0 when label had sugars
            addedSugar: lockedNutrientKeys.has('addedSugar') && truthNutrients.addedSugar != null
              ? per100(Number(truthNutrients.addedSugar))
              : (webAddedSugar > 0 ? per100(webAddedSugar) : 0),
            sodium: itemWeight > 0 ? Math.round((webNa / itemWeight) * 100) : webNa,
            salt: null,
            potassium: lockedNutrientKeys.has('potassium') && truthNutrients.potassium != null
              ? per100(Number(truthNutrients.potassium))
              : (webPotassium > 0 ? per100(webPotassium) : 0),
            totalFibre: per100(webFibre),
            solubleFibre: 0
          };

          // Soft micros from USDA/web (label path) — estimates only, not truth locks
          if (truthMatch._softMicros && typeof truthMatch._softMicros === 'object' && itemWeight > 0) {
            for (const [k, v] of Object.entries(truthMatch._softMicros as Record<string, number>)) {
              if (lockedNutrientKeys.has(k)) continue;
              const n = Number(v);
              if (Number.isFinite(n) && n > 0) {
                primaryBase100g![k] = n / (itemWeight / 100);
              }
            }
          }

          // Fill unlocked nutrients (incl. micronutrients) from ingredient profile as per-100g estimates.
          if (typeof inferredFromIngredients !== 'undefined' && backfillSource !== 'none' && itemWeight > 0) {
            NUTRIENT_KEYS.forEach((key) => {
              if (lockedNutrientKeys.has(key)) {
                if (truthNutrients[key] !== undefined) {
                  primaryBase100g![key] = truthNutrients[key] / (itemWeight / 100);
                }
                return;
              }
              if (inferredFromIngredients[key] > 0) {
                primaryBase100g![key] = inferredFromIngredients[key] / (itemWeight / 100);
              }
            });
          }
          if (typeof estimatedFields !== 'undefined' && estimatedFields.length > 0) {
            (primaryBase100g as any)._estimatedFields = estimatedFields;
          }
          dbMatchMap.set(primaryDbId, primaryBase100g);

          // Start aggregated from completed profile, then force truth locks.
          if (typeof inferredFromIngredients !== 'undefined') {
            NUTRIENT_KEYS.forEach((key) => {
              aggregatedNutrients[key] = inferredFromIngredients[key] || 0;
            });
          }
          aggregatedNutrients.calories = webCals;
          aggregatedNutrients.protein = webProt;
          aggregatedNutrients.totalFat = webFat;
          aggregatedNutrients.saturatedFat = webSatFat;
          aggregatedNutrients.sodium = webNa;
          aggregatedNutrients.carbohydrates = webCarbs;
          aggregatedNutrients.totalFibre = webFibre;
          aggregatedNutrients.sugar = webSugar;
          if (lockedNutrientKeys.has('addedSugar') && truthNutrients.addedSugar != null) {
            aggregatedNutrients.addedSugar = Number(truthNutrients.addedSugar);
          } else if (webAddedSugar > 0) {
            aggregatedNutrients.addedSugar = webAddedSugar;
          }
          if (lockedNutrientKeys.has('potassium') && truthNutrients.potassium != null) {
            aggregatedNutrients.potassium = Number(truthNutrients.potassium);
          }
          Object.entries(truthNutrients).forEach(([key, value]) => {
            aggregatedNutrients[key] = value;
          });

          // Nutrition Labels UI = source truth only (OCR as written OR restaurant-reported).
          // Estimated component/USDA fill must NEVER appear here — only in calculation tables.
          const isGenuineLabelSource = primaryDbSource === 'label' || primaryDbSource === 'brand_official';
          if (isGenuineLabelSource) {
            // The label must display the official matched product name (e.g. "Sainsbury's
            // Taste the Difference Scottish Whole Rolled Jumbo Oats"), never the user's
            // original generic/typed name, when a genuine brand/label match exists.
            if (truthMatch.name) {
              item.labelProductName = truthMatch.name;
            }
            const officialServingSize = truthMatch.rawNutritionLabel?.servingSize || 
              (truthServingGrams > 0
                ? `${truthServingGrams}g`
                : (isDishBasis && itemWeight > 0) ? `${itemWeight}g` : '100g');

            if (!item.rawNutritionLabel || typeof item.rawNutritionLabel !== 'object' || Object.keys(item.rawNutritionLabel).length === 0 || !item.rawNutritionLabel.servingSize) {
              item.rawNutritionLabel = {
                servingSize: officialServingSize,
                calories: truthMatch.calories != null ? `${rawBaseCals} kcal` : undefined,
                protein: proteinKnown ? `${rawBaseProt}g` : undefined,
                carbohydrates: carbsKnown ? `${rawBaseCarbs}g` : undefined,
                sugar: truthMatch.sugar != null ? `${truthMatch.sugar}g` : undefined,
                totalFat: fatKnown ? `${rawBaseFat}g` : undefined,
                saturatedFat: satFatKnown ? `${rawBaseSatFat}g` : undefined,
                totalFibre: fibreKnown ? `${rawBaseFibre}g` : undefined,
                sodium: sodiumKnown ? `${rawBaseNa}mg` : undefined,
                salt: truthMatch.salt != null ? `${truthMatch.salt}g` : undefined
              };
            }
          }
          // Truth (OCR label or curated brand/chain data) always wins over the Scout's
          // visually-guessed ingredient list when both are present — the Scout's guess is
          // a fallback for when no real source exists, not a peer to compare against.
          const truthIngs = truthMatch.ingredients || truthMatch.ingredientsList || truthMatch.description;
          if (truthIngs) {
            item.ingredientsList = truthIngs;
          }

          addDebugLog(`[Truth Direct Injection] "${item.originalName || item.keyword}": Using direct nutrients (${webCals} kcal, ${webProt}g protein, ${webFat}g fat, ${webNa}mg sodium) from ${primaryDbSource}`);
        }
      }

      if (!isTruthAnchored) {
        if (item.components && Array.isArray(item.components) && item.components.length > 0) {
        hasComponents = true;
        reconcileIngredientsToComponents(item, addDebugLog);

        // L2: Incomplete multi-component assembly detection
        const itemNameStr = (item.originalName || item.keyword || item.name || '').toLowerCase();
        if (item.components.length >= 2 && /\b(salad|bowl|cup|parfait|platter|bento|poke)\b/i.test(itemNameStr)) {
          const rawPctSum = item.components.reduce((a: number, c: any) => a + (Number(c.volumePercentage) || 0), 0) || 100;
          const dominantComp = item.components.find((c: any) => {
            const wShare = (Number(c.volumePercentage) || 0) / rawPctSum;
            return wShare >= 0.85;
          });
          if (dominantComp) {
            const domName = (dominantComp.searchQuery || dominantComp.name || dominantComp.keyword || '').toLowerCase();
            if (/\b(lettuce|iceberg|spinach|greens|rice|quinoa|base)\b/i.test(domName)) {
              addDebugLog(`[IncompleteAssembly] Incomplete assembly for "${itemNameStr}": dominant component "${domName}" has >= 85% weight share. Redistributing mass across components.`);
              const nonDomCount = item.components.length - 1;
              item.components.forEach((c: any) => {
                const cName = (c.searchQuery || c.name || c.keyword || '').toLowerCase();
                if (cName === domName) {
                  c.volumePercentage = 60;
                } else {
                  c.volumePercentage = Math.round(40 / (nonDomCount || 1));
                }
              });
              item.assemblyAnomaly = true;
              item.confidence = Math.min(item.confidence || 0.8, 0.5);
            }
          }
        }
        const resolvedComponentsById = new Map<string, { isPrimary: boolean; sauceIndex?: number }>();
        const pctSum = (item.components || []).reduce(
          (a: number, c: any) => a + (Number(c.volumePercentage) || 0),
          0
        ) || 100;
        item.components.forEach((comp: any, cIdx: number) => {
          const itemIndex = (item.scoutIndex !== undefined && item.scoutIndex !== null) ? item.scoutIndex : itemIdx;
          const compWeight = Math.max(
            1,
            Math.round(itemWeight * ((Number(comp.volumePercentage) || 0) / pctSum))
          );
          const rawQuery = comp.searchQuery || comp.name || comp.keyword || "";
          let matchQuery = rawQuery;
          if ((rawQuery.match(/\b(and|,)\b/gi) || []).length >= 2 || rawQuery.split(/\s+/).length >= 8) {
            matchQuery = rawQuery.split(/\band\b|,/i)[0].trim() || rawQuery;
            addDebugLog(`[MatchPriority] mega-component query split: "${rawQuery}" → match "${matchQuery}"`);
          }
          const query = prepareSearchQueryWithState(matchQuery, item.cookingMethod || scoutCookingMethod || 'baked');
          
          // Direct Curator / Query match priority: if databaseMatchesArray already contains an entry specifically resolved for this query, use it first!
          const normCompQuery = normalizeFoodKey(query);
          const calcTokenOverlap = (strA: string, strB: string): number => {
            const setA = new Set(strA.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean));
            const setB = new Set(strB.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean));
            if (setA.size === 0 || setB.size === 0) return 0;
            let matches = 0;
            setA.forEach(token => { if (setB.has(token)) matches++; });
            return matches / Math.min(setA.size, setB.size);
          };
          const directCuratorMatch = databaseMatchesArray.find((m: any) =>
            normalizeFoodKey(m.searchQuery || '') === normCompQuery &&
            m.source !== 'category_fallback' &&
            !String(m.id || '').startsWith('fallback_') &&
            !quarantinedIdsSet.has(String(m.id)) &&
            calcTokenOverlap(normCompQuery, m.name || m.searchQuery || '') >= 0.5
          );

          let bestMatch = directCuratorMatch || pickQueryScopedMatch(query, databaseMatchesArray, [rawQuery, matchQuery], quarantinedIdsSet) || findBestMatch(query, [rawQuery, matchQuery]);
          if (directCuratorMatch) {
            addDebugLog(`[MatchPriority] Bound direct Curator query match id=${directCuratorMatch.id} ("${directCuratorMatch.name}") for component "${query}".`);
          }
          if (bestMatch && (bestMatch.source === 'web_search' || bestMatch.source === 'tavily' || bestMatch.source === 'serper' || bestMatch.source === 'google_cse')) {
            addDebugLog(`[MatchPriority] rejected web_search for component "${query}"`);
            bestMatch = undefined;
          }
          // Task 4: Cross-category guard — a bread/grain component query must not resolve to a
          // meat/deli brand entry that happens to be in databaseMatchesArray from another item.
          if (bestMatch && (bestMatch.source === 'brand_official' || bestMatch.source === 'web_search')) {
            const bmName = String(bestMatch.name || '').toLowerCase();
            const qLow = String(query).toLowerCase();
            const isBreadGrainQuery = /\b(bread|baguette|flour|wheat|grain|loaf|roll|cracker|pastry|dough|yeast|brioche|bun|bagel|toast|pitta|naan)\b/i.test(qLow);
            const isProteinDishMatch = /\b(chicken|pork|beef|ham|turkey|meat|fish|sausage|deli|sliced|mince|bacon|prawn|shrimp|tuna|salmon)\b/i.test(bmName);
            if (isBreadGrainQuery && isProteinDishMatch) {
              addDebugLog(`[MatchPriority] Task4 rejected cross-category brand match "${bestMatch.name}" for grain component "${query}"`);
              bestMatch = undefined;
            }
          }
          if (bestMatch) {
            const qn = String(query).toLowerCase();
            const mn = String(bestMatch.name || '').toLowerCase();
            if (qn.split(/\s+/).length <= 2 && mn.includes('yogurt') && !qn.includes('yogurt') && (mn.includes('cup') || mn.includes('parfait'))) {
              addDebugLog(`[MatchPriority] rejected dish-level match "${bestMatch.name}" for component "${query}"`);
              bestMatch = undefined;
            }
          }
          const canonicalData = lookupCanonicalBaseFood(query);
          // Prefer internal_catalog / usda / off over any residual fallback or missing match
          if (!canonicalData && (!bestMatch || bestMatch.source === 'category_fallback' || String(bestMatch.id || '').startsWith('fallback_') || bestMatch.source === 'estimated')) {
            const qTokens = String(query).toLowerCase().split(/\s+/).filter(Boolean);
            const isQueryCooked = qTokens.some(t => ['cooked', 'plated', 'salad', 'mixed', 'roasted'].includes(t));
            const isQueryLoose = qTokens.some(t => ['cup', 'bowl', 'yogurt', 'fruit', 'loose'].includes(t));

            const GENERIC_MATCH_STOPWORDS = new Set(['cheese', 'canned', 'sauce', 'sauces', 'salad', 'dressing', 'cream', 'sliced', 'chopped', 'mixed', 'fresh', 'cooked', 'raw', 'shredded', 'grated', 'diced', 'whole', 'baked', 'fried', 'roasted', 'steamed', 'boiled', 'grilled', 'style', 'flavored', 'flavoured', 'plain', 'organic', 'natural', 'sweet', 'spicy', 'crushed', 'minced', 'topping', 'toppings', 'spread', 'filling', 'blend', 'garnish', 'crumbs', 'chunks', 'pieces']);
            const significantQTokens = Array.from(new Set(qTokens.filter((t: string) => t.length >= 3 && !GENERIC_MATCH_STOPWORDS.has(t))));

            let better: any = undefined;
            let bestOverlapScore = 0;

            databaseMatchesArray.forEach((m: any) => {
              if (m.id && quarantinedIdsSet.has(String(m.id))) return;
              if (m.source === 'category_fallback' || String(m.id || '').startsWith('fallback_')) return;
              if (m.source !== 'internal_catalog' && m.source !== 'usda' && m.source !== 'off' && m.source !== 'brand_official') return;
              // Task 5: Dish-level totals (basisType='total'/'per_dish') are invalid as sub-ingredient
              // nutrient sources. Using them would apply whole-dish macros to a component weight.
              if (m.basisType === 'total' || m.basisType === 'per_dish') return;

              const mName = String(m.name || '').toLowerCase();
              if (isQueryCooked && (mName.includes('dry') || mName.includes('flour'))) return;
              if (isQueryLoose && (mName.includes(' bar') || mName.endsWith('bar'))) return;

              const qLow = String(query).toLowerCase();
              if (/\b(egg|eggs|poultry|meat|chicken|pork|beef|fish|cheese|yogurt|yoghurt|feta|cottage|curd|granola|oats?|cereal|parfait|salad)\b/i.test(qLow) && /\b(tea|beverage|coffee|water|seltzer|soda|juice|hard\s*seltzer)\b/i.test(mName) && !/\b(tea|coffee|soda|juice|seltzer)\b/i.test(qLow)) return;
              if (/\b(salad\s*cream|salad\s*dressing|dressing|mayonnaise|mayo|vinaigrette|sauce|condiment)\b/i.test(qLow) && /\b(ice\s*cream|cone|frozen\s+yogurt|gelato|sorbet|confectionery|candy|dessert|pastry|cake|cookie|donut)\b/i.test(mName) && !/\b(ice\s*cream|cone|dessert)\b/i.test(qLow)) return;
              if (/\b(raisins?|prunes?|dates?|cranberr(y|ies)|figs?|apricots?)\b/i.test(qLow) && !/\b(oat|oats|cereal|granola|muesli|oatmeal|porridge|bar|bread|cake|cookie)\b/i.test(qLow) && /\b(cereal|cereals|oat|oats|instant|oatmeal|prepared\s+with\s+water|bar|granola)\b/i.test(mName)) return;
              if (/\bolive/.test(qLow) && !/\bloaf|lunch|mortadella|sausage|bologna\b/.test(qLow) && /\b(loaf|lunch|mortadella|sausage|bologna|pork)\b/i.test(mName)) return;
              if (/\b(salad|lettuce|mixed\s+salad|greens|leaves)\b/i.test(qLow) && /\b(taro|cassava|amaranth leaves|bitterleaf)\b/i.test(mName) && !/\btaro\b/i.test(qLow)) return;
              if (/\b(berr|blueberry|raspberry|strawberry|fruit)\b/i.test(qLow) && /\b(basil|oregano|thyme|parsley|cilantro|herb)\b/i.test(mName)) return;
              const isSimplePantry = /\b(salt|table salt|sea salt|water|yeast|baking powder|baking soda|black pepper|white pepper|vinegar)\b/i.test(qLow);
              if (isSimplePantry && /\b(chicken|pork|beef|ham|turkey|meat|fish|salmon|tuna|bacon|sausage|deli|slices|bread|pasta|sandwich|roll)\b/i.test(mName)) return;

              let overlapScore = 0;
              if (significantQTokens.length > 0) {
                overlapScore = significantQTokens.filter((t: string) => mName.includes(t)).length;
                const requiredScore = significantQTokens.length >= 2 ? 2 : 1;
                if (overlapScore < requiredScore) return;
              } else {
                if (!mName.includes(qTokens[0])) return;
                overlapScore = 1;
              }

              if (overlapScore > bestOverlapScore) {
                bestOverlapScore = overlapScore;
                better = m;
              }
            });

            if (better) {
              addDebugLog(`[MatchPriority] preferred ${better.source} over ${bestMatch?.source || 'null'} for "${query}", id=${better.id}, overlapScore=${bestOverlapScore}`);
              bestMatch = better;
            }
          }
          // A verified Scout FDC hint (already fetched by direct ID and relevance-checked
          // in the pre-fetch pass above) always takes priority over whatever the fuzzy
          // search above found, since Scout is only supposed to supply one for unambiguous
          // staple foods. It still passes through the same final relevance gate immediately
          // below as a second, cheap safety check.
          const scoutHintKey = `${itemIndex}:${cIdx}`;
          if (verifiedFdcHintMap.has(scoutHintKey)) {
            const hint = verifiedFdcHintMap.get(scoutHintKey);
            addDebugLog(`[MatchPriority] Using verified Scout FDC hint id=${hint.id} ("${hint.name}") for query "${query}" (was bestMatch.source=${bestMatch?.source || 'null'}).`);
            bestMatch = hint;
          }
          // Final relevance safety net: whatever path assigned bestMatch above, it must share
          // at least one meaningful, non-generic token with the query before we trust it as a
          // confident match. Without this, matches with effectively zero semantic relevance
          // (e.g. "Yogurt, plain, low fat" -> "Water, bottled, plain", or "Mixed salad greens"
          // -> "Beverages, POWERADE, Zero, Mixed Berry") were reaching the nutrient pipeline as
          // if they were a genuine, confident single match — silently poisoning the item with
          // an unrelated food's numbers instead of correctly falling through to the canonical
          // dictionary lookup or the category-fallback/Resolver path below.
          if (bestMatch) {
            const relevanceStopwords = new Set(['canned', 'sliced', 'chopped', 'mixed', 'fresh', 'cooked', 'raw', 'shredded', 'grated', 'diced', 'whole', 'baked', 'fried', 'roasted', 'steamed', 'boiled', 'grilled', 'style', 'flavored', 'flavoured', 'plain', 'organic', 'natural', 'sweet', 'spicy', 'crushed', 'minced', 'topping', 'toppings', 'spread', 'filling', 'blend', 'garnish', 'crumbs', 'chunks', 'pieces', 'with', 'and', 'leaf', 'leaves', 'seed', 'seeds', 'green']);
            const rawQTokens = String(query).toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter((t: string) => t.length > 2);
            const relevanceQTokens = rawQTokens.filter((t: string) => !relevanceStopwords.has(t));
            const effectiveQTokens = relevanceQTokens.length > 0 ? relevanceQTokens : rawQTokens;
            const bmNameLow = String(bestMatch.name || bestMatch.dish_name || '').toLowerCase();
            const hasRelevantOverlap = effectiveQTokens.some((t: string) => bmNameLow.includes(t) || t.includes(bmNameLow.split(/\s+/).find((w: string) => w.length > 3) || '\u0000'));
            const catCompat = checkCategoryAndStateCompatibility(query, bmNameLow);
            if (!hasRelevantOverlap || !catCompat.compatible) {
              addDebugLog(`[MatchPriority] Relevance gate rejected "${bestMatch.name}" (id=${bestMatch.id}) for query "${query}" — ${!catCompat.compatible ? catCompat.reason : 'no meaningful token overlap'}.`);
              bestMatch = undefined;
            }
          }
          addDebugLog(`[Component Resolution Diagnostic] item="${item.originalName || item.keyword}" (scoutIndex=${itemIndex}) component[${cIdx}] query="${query}" -> canonicalMatch=${canonicalData ? JSON.stringify(canonicalData.fdcId || 'no-fdcid') : 'none'} bestMatch.source=${bestMatch?.source || 'null'} bestMatch.id=${bestMatch?.id || 'null'}`);

          let labelCompMatch: any = null;
          const compLabelIsGenuine = comp.rawNutritionLabel && typeof comp.rawNutritionLabel === 'object'
            && comp.rawNutritionLabel.basisType !== 'per_100g'; // genuine OCR labels never carry this synthetic marker
          if (compLabelIsGenuine) {
            const getLabelVal = (k: string) => {
              const v = comp.rawNutritionLabel[k];
              if (v === undefined || v === null || v === '' || v === '-' || v === '--') return 0;
              const m = String(v).match(/[\d.]+/);
              return m ? parseFloat(m[0]) : 0;
            };
            const labelCal = getLabelVal('calories');
            const labelProt = getLabelVal('protein');
            const labelFat = getLabelVal('totalFat') || getLabelVal('fat');
            const labelSatFat = getLabelVal('saturatedFat');
            const labelCarbs = getLabelVal('totalCarbohydrate') || getLabelVal('carbohydrate');
            const labelFibre = getLabelVal('totalFibre') || getLabelVal('fibre');
            const labelSalt = getLabelVal('salt');
            let labelNa = getLabelVal('sodium');
            if (!labelNa && labelSalt > 0) labelNa = Math.round(labelSalt * 400);

            if (labelCal > 0 || labelProt > 0 || labelCarbs > 0) {
              const virtualId = `package_label_comp_${itemIndex}_${cIdx}`;
              const labelVec = {
                calories: labelCal,
                protein: labelProt,
                totalFat: labelFat,
                saturatedFat: labelSatFat,
                carbohydrates: labelCarbs,
                totalFibre: labelFibre,
                sodium: labelNa,
                sugar: getLabelVal('sugar'),
                addedSugar: getLabelVal('addedSugar'),
                transFat: getLabelVal('transFat'),
                potassium: getLabelVal('potassium'),
                calcium: getLabelVal('calcium'),
                iron: getLabelVal('iron')
              };
              dbMatchMap.set(virtualId, labelVec);
              labelCompMatch = {
                id: virtualId,
                source: "label",
                name: `${query} (Package Label Truth)`,
                calories: String(labelCal),
                protein: labelProt,
                fat: labelFat,
                saturatedFat: labelSatFat,
                sodium: labelNa
              };
              databaseMatchesArray.push(labelCompMatch);
              addDebugLog(`[Component Resolution] Used linked package label truth for component "${query}": ${labelCal} kcal, ${labelProt}g protein, ${labelCarbs}g carbs, ${labelFat}g fat per 100g.`);
            }
          }

          if (labelCompMatch) {
            bestMatch = labelCompMatch;
          } else if (isGenericZeroNutrientDiluent(query)) {
            const virtualId = `zero_diluent_comp_${itemIndex}_${cIdx}`;
            const zeroVec = getZeroNutrientVector();
            dbMatchMap.set(virtualId, zeroVec);
            bestMatch = {
              id: virtualId,
              source: "canonical_dict",
              name: `${query} (Diluent)`,
              calories: "0",
              protein: 0,
              fat: 0,
              saturatedFat: 0,
              sodium: 0
            };
            databaseMatchesArray.push(bestMatch);
          } else if ((!bestMatch || bestMatch.source === 'category_fallback' || bestMatch.source === 'estimated') && canonicalData) {
            const virtualId = `canonical_comp_${itemIndex}_${cIdx}`;
            dbMatchMap.set(virtualId, canonicalData);
            const isBrandMenu = canonicalData.fdcId && String(canonicalData.fdcId).startsWith("brand_menu_");
            bestMatch = {
              id: virtualId,
              source: isBrandMenu ? "brand_official" : "canonical_dict",
              name: `${query} (Canonical Base)`,
              calories: String(canonicalData.calories),
              protein: canonicalData.protein,
              fat: canonicalData.totalFat,
              saturatedFat: canonicalData.saturatedFat,
              sodium: canonicalData.sodium
            };
            databaseMatchesArray.push(bestMatch);
          } else if (!bestMatch || !dbMatchMap.has(bestMatch.id)) {
            const virtualId = `estimated_comp_${itemIndex}_${cIdx}`;
            const defaultNutrients = getClinicalDefaultNutrients100g(query);
            dbMatchMap.set(virtualId, defaultNutrients);
            bestMatch = {
              id: virtualId,
              source: "estimated",
              name: `${query} (Estimated Component Baseline)`,
              calories: String(defaultNutrients.calories),
              protein: defaultNutrients.protein,
              fat: defaultNutrients.totalFat,
              saturatedFat: defaultNutrients.saturatedFat,
              sodium: defaultNutrients.sodium
            };
            databaseMatchesArray.push(bestMatch);
          }

          const baseNutrients = dbMatchMap.get(bestMatch.id);

          // Fill missing component macros using the same category macro prior already used
          // at the whole-dish level (see "Atwater Anchor Engine" in server_pure_helpers.ts).
          // Some brand-menu records only ever publish calories (no protein/fat/carbs). Without
          // this, that component silently displays calories-only in the nutrition breakdown UI.
          // This ONLY fires when calories exist but ALL of protein/totalFat/carbohydrates are
          // missing — it never overwrites a component that already has any real macro data.
          if (baseNutrients && baseNutrients.calories != null && Number(baseNutrients.calories) > 0) {
            const hasAnyMacro = ['protein', 'totalFat', 'carbohydrates'].some(
              k => baseNutrients[k] !== undefined && baseNutrients[k] !== null
            );
            if (!hasAnyMacro) {
              const compCal = Number(baseNutrients.calories);
              baseNutrients.protein = Math.round(((compCal * 0.20) / 4) * 10) / 10;
              baseNutrients.totalFat = Math.round(((compCal * 0.35) / 9) * 10) / 10;
              baseNutrients.carbohydrates = Math.round(((compCal * 0.45) / 4) * 10) / 10;
              addDebugLog(`[Component Macro Baseline] "${query}" had ${compCal} kcal but no macros. Applied category macro prior: P=${baseNutrients.protein}g F=${baseNutrients.totalFat}g C=${baseNutrients.carbohydrates}g.`);
            }
          }

          // NUTRITION BASIS FIX (Aug 2026): don't re-scale whole-dish brand totals by weight/100.
          const factor = (baseNutrients?.basisType === 'total' || baseNutrients?.basisType === 'per_dish') ? 1 : (compWeight / 100);

          // Issue #3: Dropped Component & Wrap Macro Collapse.
          // Ensure every decomposed scout component receives an isolated database resolution slot before composite aggregation.
          // (Removed deduplication based on bestMatch.id so distinct components aren't merged incorrectly)
          
          NUTRIENT_KEYS.forEach(key => {
            if (baseNutrients[key] !== undefined && baseNutrients[key] !== null) {
              aggregatedNutrients[key] += parseFloat((baseNutrients[key] * factor).toFixed(2));
            }
          });

          if (cIdx === 0) {
            primaryDbId = String(bestMatch.id);
            primaryDbSource = bestMatch.source || "usda";
            primaryBaseMatchName = bestMatch.name;
            primaryBase100g = baseNutrients;
            primaryBaseWeightG = compWeight;
          }

          // Always push to componentsDetailList so all components are visible for compound meals
          let compLabel = "";
          const sourceUpper = String(bestMatch.source || 'usda').toUpperCase();
          const fdcIdCand = bestMatch.fdcId || bestMatch.dbId || (bestMatch.id && !String(bestMatch.id).startsWith('canonical_') && !String(bestMatch.id).startsWith('printed_') && !String(bestMatch.id).startsWith('fallback_') && !String(bestMatch.id).startsWith('resolver_') ? bestMatch.id : null);

          if (sourceUpper === 'USDA' && bestMatch.id && !String(bestMatch.id).startsWith('canonical_') && !String(bestMatch.id).startsWith('printed_')) {
            compLabel = `[USDA #${bestMatch.id}](https://fdc.nal.usda.gov/food-details/${bestMatch.id}/nutrients)${bestMatch.name ? ' (' + bestMatch.name + ')' : ''}`;
          } else if (sourceUpper === 'OFF' && bestMatch.id) {
            compLabel = `[OFF #${bestMatch.id}](https://world.openfoodfacts.org/product/${bestMatch.id})${bestMatch.name ? ' (' + bestMatch.name + ')' : ''}`;
          } else if (sourceUpper === 'ESTIMATED') {
            const cleanName = bestMatch.name ? bestMatch.name.replace(' (Estimated Component Baseline)', '') : query;
            compLabel = `Estimated ${cleanName}`;
          } else if (sourceUpper === 'CANONICAL_DICT') {
            const cleanName = bestMatch.name ? bestMatch.name.replace(' (Canonical Base)', '') : query;
            const dictFdcId = canonicalData && canonicalData.fdcId && !String(canonicalData.fdcId).startsWith('canonical_') && !isNaN(Number(canonicalData.fdcId)) ? canonicalData.fdcId : null;
            compLabel = dictFdcId
              ? `📖 [${cleanName}](https://fdc.nal.usda.gov/fdc-app.html#/food-details/${dictFdcId}/nutrients)`
              : `📖 ${cleanName}`;
          } else if (fdcIdCand && !isNaN(Number(fdcIdCand))) {
            const cleanName = bestMatch.name ? bestMatch.name.replace(/\s*\((internal_catalog|internal catalog|usual_catalog)\)/gi, '') : query;
            compLabel = `📖 [${cleanName}](https://fdc.nal.usda.gov/fdc-app.html#/food-details/${fdcIdCand}/nutrients)`;
          } else {
            compLabel = `${bestMatch.name || query}`;
          }
          const compQueryNorm = String(query || '').toLowerCase().trim();
          const matchChainNorm = String(bestMatch.chainName || bestMatch.brand || bestMatch.brandName || '').toLowerCase().trim();
          const compHasBrand = Boolean(matchChainNorm) && compQueryNorm.includes(matchChainNorm);
          const isGenuineCompBrand = (bestMatch.source === 'brand_official' || bestMatch.source === 'label') && compHasBrand;

          const newComp: any = {
            name: compLabel,
            searchQuery: query,
            weightGrams: compWeight,
            dbId: String(bestMatch.id),
            dbSource: isGenuineCompBrand ? bestMatch.source : (bestMatch.source === 'brand_official' ? 'category_fallback' : bestMatch.source),
            chainName: isGenuineCompBrand ? (bestMatch.chainName || bestMatch.brand || null) : null,
            brand: isGenuineCompBrand ? (bestMatch.brand || bestMatch.chainName || null) : null,
            brandName: isGenuineCompBrand ? (bestMatch.brandName || bestMatch.chainName || null) : null,
            rawNutritionLabel: isGenuineCompBrand ? bestMatch.rawNutritionLabel : null,
            primaryBaseMatchName: bestMatch.name || query,
            primaryBase100g: baseNutrients,
            baseNutrients100g: baseNutrients,
            labelNutrientsPerServing: isGenuineCompBrand ? baseNutrients : null,
            isRealTruth: isGenuineCompBrand
          };
          NUTRIENT_KEYS.forEach(key => {
            if (baseNutrients[key] !== undefined && baseNutrients[key] !== null) {
              newComp[key] = parseFloat((baseNutrients[key] * factor).toFixed(1));
            } else {
              newComp[key] = 0;
            }
          });
          componentsDetailList.push(newComp);

          if (cIdx === 0) {
            resolvedComponentsById.set(String(bestMatch.id), { isPrimary: true, sauceIndex: componentsDetailList.length - 1 });
          } else {
            resolvedComponentsById.set(String(bestMatch.id), { isPrimary: false, sauceIndex: componentsDetailList.length - 1 });
          }
        });
        
        // Deduplicate componentsDetailList BEFORE computing final foundation budget
        if (componentsDetailList.length > 0) {
          const beforeLen = componentsDetailList.length;
          const stripDisplayNoise = (raw: string): string => {
            let s = String(raw || '');
            s = s.replace(/\[[^\]]*\]\([^)]*\)/g, ' '); // markdown links
            s = s.replace(/#\d+/g, ' ');
            s = s.replace(/\b(estimated|usda|off|canonical base|estimated component baseline)\b/gi, ' ');
            s = s.replace(/[()]/g, ' ');
            return normalizeFoodKey(s);
          };
          const rowKey = (c: any): string => {
            const id = c.dbId != null && String(c.dbId).trim() !== '' ? String(c.dbId) : '';
            const wBucket = Math.round((Number(c.weightGrams) || 0) / 2) * 2; // ±1g collapse
            const q = stripDisplayNoise(c.searchQuery || '');
            const n = stripDisplayNoise(c.name || '');
            if (id && !id.startsWith('fallback_') && !id.startsWith('resolver_')) {
              return `id:${id}_q:${q || n}_w:${wBucket}`;
            }
            return `n:${q || n}_w:${wBucket}`;
          };
          const dedupedMap = new Map<string, any>();
          for (const c of componentsDetailList) {
            const key = rowKey(c);
            if (dedupedMap.has(key)) {
              const ext = dedupedMap.get(key);
              const cEst = /^estimated\b/i.test(String(c.name || '').replace(/^\[/, ''));
              const eEst = /^estimated\b/i.test(String(ext.name || '').replace(/^\[/, ''));
              if (eEst && !cEst) {
                dedupedMap.set(key, c);
              } else if (!eEst && cEst) {
                // keep ext
              } else if ((c.calories || 0) > (ext.calories || 0)) {
                dedupedMap.set(key, c);
              }
            } else {
              dedupedMap.set(key, c);
            }
          }
          const afterLen = dedupedMap.size;
          componentsDetailList.splice(0, componentsDetailList.length, ...Array.from(dedupedMap.values()));
          if (beforeLen !== afterLen) {
            addDebugLog(`[Receipt] dedupe componentsDetailList ${beforeLen}→${afterLen} for "${item.originalName || item.keyword}"`);
            // Recalculate aggregatedNutrients since rows were removed
            NUTRIENT_KEYS.forEach(key => aggregatedNutrients[key] = 0);
            componentsDetailList.forEach((c: any) => {
              NUTRIENT_KEYS.forEach(key => {
                if (c[key] != null) aggregatedNutrients[key] += c[key];
              });
            });
          }
        }

        if (item.components.length >= 2) {
          const weightSum = componentsDetailList.reduce((sum: number, c: any) => sum + (c.weightGrams || 0), 0);
          addDebugLog(`[Assembly] multi-component rows=${componentsDetailList.length} weightSum=${weightSum} itemWeight=${itemWeight} for "${item.originalName || item.keyword}"`);
          if (aggregatedNutrients.calories <= 5 && itemWeight >= 50) {
            const rawParentQuery = item.keyword || item.originalName || item.name || "";
            const parentSearchQuery = prepareSearchQueryWithState(rawParentQuery, item.cookingMethod || scoutCookingMethod || 'baked');
            const parentDishMatch = findBestMatch(parentSearchQuery) || findBestMatch(rawParentQuery);
            const parentNutrients = parentDishMatch && dbMatchMap.get(parentDishMatch.id);
            if (parentNutrients && (parentNutrients.calories > 0)) {
              addDebugLog(`[Assembly Fallback] Component sum for "${item.originalName || item.keyword}" was ~0 kcal. Falling back to parent dish match "${parentDishMatch.name}" (${parentNutrients.calories} kcal/100g).`);
              const factor = ((parentNutrients as any)?.basisType === 'total' || (parentNutrients as any)?.basisType === 'per_dish') ? 1 : (itemWeight / 100);
              NUTRIENT_KEYS.forEach(key => {
                if (parentNutrients[key] !== undefined && parentNutrients[key] !== null) {
                  aggregatedNutrients[key] = parseFloat((parentNutrients[key] * factor).toFixed(2));
                }
              });
            } else if (Number(item.estimatedCalories) > 0) {
              addDebugLog(`[Assembly Fallback] Component sum for "${item.originalName || item.keyword}" was ~0 kcal. Falling back to scout budget (${item.estimatedCalories} kcal).`);
              aggregatedNutrients.calories = Number(item.estimatedCalories);
            }
          }

          // COMPOSITE DENSITY FIX (Aug 2026): primaryBase100g must reflect this item's true
          // weighted-average per-100g density across ALL matched components, not just the
          // first one. Downstream consumers (aggregateItemsNutrients in
          // server_nutrient_aggregation.ts, the meal compiler) multiply primaryBase100g by
          // the item's FULL weight, so leaving it pinned to the first component silently
          // misrepresents composite dishes (e.g. an entire chicken/avocado/egg/lettuce salad
          // gets treated as if it were 100% chicken breast).
          if (itemWeight > 0) {
            const compositeBase100g: Record<string, number> = {};
            NUTRIENT_KEYS.forEach(key => {
              // ZERO-COLLAPSE FIX (Aug 2026): only carry a key into compositeBase100g if at least
              // one matched component's raw per-100g data actually had it defined. Otherwise the
              // key is left out entirely, so the trace-nutrient fallback in
              // server_nutrient_aggregation.ts (baseRef100g[key] !== undefined check) correctly
              // falls through to the food-type heuristic instead of treating a component data gap
              // as an authentic zero.
              const anyComponentHasKey = componentsDetailList.some((c: any) => c.baseNutrients100g && c.baseNutrients100g[key] !== undefined && c.baseNutrients100g[key] !== null);
              if (anyComponentHasKey) {
                compositeBase100g[key] = parseFloat(((aggregatedNutrients[key] || 0) / (itemWeight / 100)).toFixed(3));
              }
            });
            addDebugLog(`[Assembly] Recomputed primaryBase100g as weighted composite density for "${item.originalName || item.keyword}" (was: first-component-only density).`);
            primaryBase100g = compositeBase100g;
            primaryBaseWeightG = itemWeight;
            primaryBaseMatchName = item.originalName || item.keyword;
            primaryDbSource = "composite";
          }
        }
      } else {
        const rawItemQuery = item.keyword || item.originalName || item.name || "";
        const itemSearchQuery = prepareSearchQueryWithState(rawItemQuery, item.cookingMethod || scoutCookingMethod || 'baked');
        const canonicalData = lookupCanonicalBaseFood(itemSearchQuery);
        let bestMatch = findBestMatch(itemSearchQuery);
        if (canonicalData) {
          const virtualId = `canonical_item_${item.scoutIndex}`;
          dbMatchMap.set(virtualId, canonicalData);
          primaryDbId = virtualId;
          const isBrandMenu = canonicalData.fdcId && String(canonicalData.fdcId).startsWith("brand_menu_");
          primaryDbSource = isBrandMenu ? "brand_official" : "canonical_dict";
          primaryBaseMatchName = item.originalName || item.keyword;
          primaryBase100g = canonicalData;
          primaryBaseWeightG = itemWeight;
          const factor = itemWeight / 100;
          NUTRIENT_KEYS.forEach(key => {
            if (primaryBase100g![key] !== undefined && primaryBase100g![key] !== null) {
              aggregatedNutrients[key] = parseFloat((primaryBase100g![key] * factor).toFixed(2));
            }
          });
        } else if (bestMatch && dbMatchMap.has(bestMatch.id)) {
          primaryDbId = String(bestMatch.id);
          primaryDbSource = bestMatch.source || "usda";
          primaryBaseMatchName = bestMatch.name;
          primaryBase100g = dbMatchMap.get(bestMatch.id);
          primaryBaseWeightG = itemWeight;
          // NUTRITION BASIS FIX (Aug 2026): don't re-scale whole-dish brand totals by weight/100.
          const factor = ((primaryBase100g as any)?.basisType === 'total' || (primaryBase100g as any)?.basisType === 'per_dish') ? 1 : (itemWeight / 100);
          NUTRIENT_KEYS.forEach(key => {
            if (primaryBase100g![key] !== undefined && primaryBase100g![key] !== null) {
              aggregatedNutrients[key] = parseFloat((primaryBase100g![key] * factor).toFixed(2));
            }
          });
        } else {
          const defaultNutrients = getClinicalDefaultNutrients100g(item.keyword || item.originalName || "");
          const virtualId = `estimated_item_${item.scoutIndex}`;
          dbMatchMap.set(virtualId, defaultNutrients);
          primaryDbId = virtualId;
          primaryDbSource = "estimated";
          primaryBaseMatchName = item.originalName || item.keyword;
          primaryBase100g = defaultNutrients;
          primaryBaseWeightG = itemWeight;
          const factor = itemWeight / 100;
          NUTRIENT_KEYS.forEach(key => {
            if (primaryBase100g![key] !== undefined && primaryBase100g![key] !== null) {
              aggregatedNutrients[key] = parseFloat((primaryBase100g![key] * factor).toFixed(2));
            }
          });
        }
      }
    }

      // Comprehensive sauce detection across all name & visual fields
      const combinedItemStr = [
        item.originalName, item.keyword, item.originalLocalName, item.canonicalDbName, item.name, item.searchQuery,
        ...(item.visualIngredients || []),
        ...(item.components ? item.components.map((c: any) => typeof c === 'string' ? c : c.name || c.searchQuery || c.keyword) : [])
      ].filter(Boolean).join(' ').toLowerCase();

      const visList = (item.visualIngredients || []).map((v: string) => String(v).toLowerCase());
      const hasMayo = combinedItemStr.includes('mayonnaise') || combinedItemStr.includes('mayo');
      const hasPepperSauce = combinedItemStr.includes('black pepper sauce') || combinedItemStr.includes('pepper sauce');
      const hasSauceInVis = sauceKeywords.some(sk => combinedItemStr.includes(sk));

      // CRITICAL GUARD: When rawLabelHasData is true, the printed nutrition label already
      // accounts for ALL ingredients including sauces/dressings in its per-100g values.
      // Also guard against standalone condiments/butter/spreads/fats injecting a redundant sauce onto themselves.
      const isStandaloneCondimentOrFat = /\b(butter|margarine|spread|oil|dressing|vinaigrette|mayo|mayonnaise|jam|preserves|marmalade|ketchup|mustard|syrup|honey|sauce|dip|ghee|fat)\b/i.test(
        String(item.originalName || item.keyword || item.name || '')
      );
      if (componentsDetailList.length === 0 && !rawLabelHasData && !isStandaloneCondimentOrFat && (hasMayo || hasPepperSauce || hasSauceInVis)) {
        let detectedSauceName = "Sauce / Dressing";
        if (hasMayo) detectedSauceName = "Mayonnaise";
        else if (hasPepperSauce) detectedSauceName = "Black Pepper Sauce";
        else {
          const matchV = visList.find((v: string) => sauceKeywords.some(sk => v.includes(sk)));
          if (matchV) detectedSauceName = matchV;
        }

        // Typed fractions: emulsion ~12%, other sauces ~12% of item (was 25%/20% — systematically high)
        let sauceFrac = hasMayo ? 0.12 : 0.12;
        const sauceText = combinedItemStr;
        if (/\b(teriyaki|glaze|eel sauce|unagi)\b/i.test(sauceText)) {
          // Soy glaze: smaller mass, applied as dressing row (prefer protein-heavy dishes)
          sauceFrac = 0.08;
          if (!hasMayo) detectedSauceName = "Teriyaki Glaze";
        } else if (/\b(vinaigrette|sesame dressing)\b/i.test(sauceText)) {
          sauceFrac = 0.10;
        } else if (/\b(gravy|pepper sauce)\b/i.test(sauceText)) {
          sauceFrac = 0.15;
        }

        // Anti-double-count: base match already is a mayo salad
        const primaryNameLower = String(primaryBaseMatchName || item.originalName || item.keyword || "").toLowerCase();
        const isMayoSaladBase = hasMayo && /\b(mayonnaise|mayo)\b/i.test(primaryNameLower) && /\b(salad|surimi|crab)\b/i.test(primaryNameLower);

        if (!isMayoSaladBase) {
          const estSauceW = Math.max(8, Math.round(itemWeight * sauceFrac));
          const sauceMatch = findBestMatch(detectedSauceName);
          let sCal = Math.round(estSauceW * 4.5);
          let sP = 0.3;
          let sF = Math.round((estSauceW * 0.4) * 10) / 10;
          let sSatFat = Math.round((estSauceW * 0.05) * 10) / 10;
          let sNa = Math.round(estSauceW * 15);
          let sauceLabel = detectedSauceName;

          if (sauceMatch && dbMatchMap.has(sauceMatch.id)) {
            const sBase = dbMatchMap.get(sauceMatch.id);
            const f = estSauceW / 100;
            const baseCal = (sBase.calories && sBase.calories > 0) ? sBase.calories : (hasMayo ? 680 : 450);
            const baseP = (sBase.protein !== undefined && sBase.protein !== null) ? sBase.protein : (hasMayo ? 1.0 : 1.5);
            const baseF = (sBase.totalFat && sBase.totalFat > 0) ? sBase.totalFat : (hasMayo ? 75 : 40);
            const baseSat = (sBase.saturatedFat && sBase.saturatedFat > 0) ? sBase.saturatedFat : (hasMayo ? 11.3 : 5);
            const baseNa = (sBase.sodium !== undefined && sBase.sodium !== null && sBase.sodium > 0) ? sBase.sodium : (hasMayo ? 600 : 800);

            sCal = Math.round(baseCal * f);
            sP = Math.round((baseP * f) * 10) / 10;
            sF = Math.round((baseF * f) * 10) / 10;
            sSatFat = Math.round((baseSat * f) * 10) / 10;
            sNa = Math.round(baseNa * f);
            sauceLabel = `${String(sauceMatch.source || 'usda').toUpperCase()} #${sauceMatch.id} (${sauceMatch.name || detectedSauceName})`;
          } else {
            if (hasMayo) {
              sauceLabel = `USDA #2758986 (Mayonnaise)`;
              sCal = Math.round(estSauceW * 6.8);
              sP = 0.2;
              sF = Math.round((estSauceW * 0.75) * 10) / 10;
              sSatFat = Math.round((estSauceW * 0.12) * 10) / 10;
              sNa = Math.round(estSauceW * 6.0);
            } else if (hasPepperSauce) {
              sauceLabel = `USDA #174527 (Black Pepper Sauce)`;
              sCal = Math.round(estSauceW * 0.3);
              sP = 0.3;
              sF = 0.1;
              sSatFat = 0;
              sNa = Math.round(estSauceW * 6.0);
            } else if (/teriyaki|glaze/i.test(detectedSauceName)) {
              sauceLabel = `Est. Teriyaki Glaze`;
              sCal = Math.round(estSauceW * 1.5);      // ~150 kcal/100g
              sP = Math.round(estSauceW * 0.02 * 10) / 10;
              sF = Math.round(estSauceW * 0.005 * 10) / 10;
              sSatFat = 0;
              sNa = Math.round(estSauceW * 12);        // ~1200 mg/100g
            } else {
              sauceLabel = `USDA Est. (${detectedSauceName})`;
            }
          }

          if (diningEnvironment === 'airline') {
            sNa = Math.round(sNa * 1.5);
          }

          componentsDetailList.push({
            name: sauceLabel,
            weightGrams: estSauceW,
            calories: sCal,
            protein: sP,
            totalFat: sF,
            saturatedFat: sSatFat,
            sodium: sNa
          });

          // Only shrink primary when we had a single solid base, not when multi-component already split weights
          if (!(Array.isArray(item.components) && item.components.length >= 2)) {
            primaryBaseWeightG = Math.max(10, itemWeight - estSauceW);
          } else {
            // Multi-component: sauce is extra row; do not reassign primary to full dish weight
            primaryBaseWeightG = Math.max(10, Math.min(primaryBaseWeightG, itemWeight - estSauceW));
          }
          const baseFactor = primaryBaseWeightG / 100;

          NUTRIENT_KEYS.forEach(key => {
            if (primaryBase100g && primaryBase100g[key] !== undefined && primaryBase100g[key] !== null) {
              aggregatedNutrients[key] = parseFloat((primaryBase100g[key] * baseFactor).toFixed(2));
            }
          });

          aggregatedNutrients.calories += sCal;
          aggregatedNutrients.protein += sP;
          aggregatedNutrients.totalFat += sF;
          aggregatedNutrients.saturatedFat += sSatFat;
          aggregatedNutrients.sodium += sNa;
        }
      }
      
      let pieceCount = 1;
      if (item.components && Array.isArray(item.components) && item.components.length > 0) {
         pieceCount = item.components[0].pieceCount || 1;
      }

      let itemCookingMethod = (item.cookingMethod && item.cookingMethod !== 'unknown') ? item.cookingMethod : null;
      const kwLower = (item.keyword || item.originalName || "").toLowerCase();
      const isBeverage = BEVERAGE_RAW_PATTERN.test(kwLower) || BEVERAGE_RAW_PATTERN.test(item.originalName || "") || BEVERAGE_RAW_PATTERN.test(item.keyword || "");
      const itemPhysicalFormForCooking = classifyUniversalPhysicalFormV3({
        name: item.originalName || item.keyword,
        canonicalDbName: item.originalName || item.keyword,
        keyword: item.keyword,
        visualIngredients: item.visualIngredients,
        components: item.components
      });
      const isCandyOrDessertNoHeat = itemPhysicalFormForCooking.primaryCategory === 'bakery_dessert';
      if (isBeverage) {
        itemCookingMethod = 'raw';
      } else if (!itemCookingMethod && item.source !== 'label') {
        if (isCandyOrDessertNoHeat) {
          itemCookingMethod = 'raw';
        } else if (kwLower.includes('wedge') || kwLower.includes('fries') || kwLower.includes('chip') || kwLower.includes('nugget') || kwLower.includes('tempura')) {
          itemCookingMethod = 'deep_fried';
        } else if (kwLower.includes('vegetable') || kwLower.includes('veg') || kwLower.includes('corn') || kwLower.includes('carrot') || kwLower.includes('pea') || kwLower.includes('broccoli') || kwLower.includes('soup')) {
          itemCookingMethod = 'boiled';
        } else if (kwLower.includes('steak') || kwLower.includes('beef') || kwLower.includes('pork') || kwLower.includes('chicken') || kwLower.includes('salmon') || kwLower.includes('fish')) {
          itemCookingMethod = 'pan_fried';
        } else {
          itemCookingMethod = scoutCookingMethod || 'pan_fried';
        }
      }
      const hasSauceOrDressing = (componentsDetailList && componentsDetailList.length > 0 && componentsDetailList.some((s: any) => (s.sodium || 0) > 0)) ||
        Boolean((item.originalName || item.keyword || "").toLowerCase().match(/\b(sauce|mayo|mayonnaise|dressing|gravy|salsa|glaze)\b/));

      if (kwLower.includes("pan crust") || kwLower.includes("pan pizza") || kwLower.includes("deep dish")) {
        itemCookingMethod = "pan_fried";
      }

      const itemTruthNutrients: Record<string, number> =
        (typeof truthNutrients !== "undefined" && truthNutrients) ? truthNutrients : {};
      const itemLockedKeys: Set<string> =
        (typeof lockedNutrientKeys !== "undefined" && lockedNutrientKeys) ? lockedNutrientKeys : new Set<string>();

      const preForm = classifyUniversalPhysicalFormV3({
        name: item.originalName || item.keyword,
        keyword: item.keyword,
        originalLocalName: item.originalName,
        components: item.components,
        visualIngredients: item.visualIngredients,
        foodType: item.foodType,
      });

      const isAlreadyPrepared = !hasComponents && checkIfItemIsAlreadyPrepared(
        item.originalName || item.keyword,
        item.keyword,
        primaryDbSource || "estimated",
        primaryBase100g?.sodium
      );

      const prepPre = decidePrepAddition({
        weightGrams: itemWeight,
        cookingMethod: rawLabelHasData ? "raw" : itemCookingMethod,
        physicalForm: preForm.physicalForm,
        dishName: item.originalName || item.keyword,
        keyword: item.keyword,
        canonicalDbName: primaryBaseMatchName || item.keyword,
        foodType: item.foodType,
        componentCount: Array.isArray(item.components) ? item.components.length : 0,
        hasLockedTruth:
          Boolean(rawLabelHasData) ||
          primaryDbSource === "label" ||
          primaryDbSource === "brand_official",
        isAlreadyPrepared: isAlreadyPrepared || Boolean(rawLabelHasData),
        diningEnvironment,
        hasSauceOrDressing,
        visualSheen: 0.5,
        visualCoating: 0.5,
        cookingAdded: null,
      });

      const added = {
        addedCalories: prepPre.addedCalories,
        addedFat: prepPre.addedFat,
        addedSaturatedFat: prepPre.addedSaturatedFat,
        addedSodium: prepPre.addedSodium,
      };

      const unlockedCookingAdded = {
        addedCalories: itemLockedKeys.has("calories") ? 0 : added.addedCalories,
        addedFat: itemLockedKeys.has("totalFat") ? 0 : added.addedFat,
        addedSaturatedFat: itemLockedKeys.has("saturatedFat") ? 0 : added.addedSaturatedFat,
        addedSodium: itemLockedKeys.has("sodium") ? 0 : added.addedSodium,
      };
      item.cookingAdded = unlockedCookingAdded;

      if (
        !rawLabelHasData &&
        (unlockedCookingAdded.addedFat > 0 ||
          unlockedCookingAdded.addedSodium > 0 ||
          unlockedCookingAdded.addedCalories > 0)
      ) {
        aggregatedNutrients.totalFat = parseFloat(
          (aggregatedNutrients.totalFat + unlockedCookingAdded.addedFat).toFixed(2)
        );
        aggregatedNutrients.saturatedFat = parseFloat(
          (aggregatedNutrients.saturatedFat + unlockedCookingAdded.addedSaturatedFat).toFixed(2)
        );
        aggregatedNutrients.calories = parseFloat(
          (aggregatedNutrients.calories + unlockedCookingAdded.addedCalories).toFixed(1)
        );
        aggregatedNutrients.sodium = parseFloat(
          (aggregatedNutrients.sodium + unlockedCookingAdded.addedSodium).toFixed(1)
        );
      }

      addDebugLog(
        `[PrepPolicy:precalc] "${item.originalName || item.keyword}" reason=${prepPre.reason || "n/a"} cal=${unlockedCookingAdded.addedCalories}`
      );

      // Apply the exact same dietitian reality checks before message generation.
      // Only claim full "label" trust (which skips validation) when NOTHING was backfilled —
      // see [Label Provenance] tagging above. A partially-backfilled item must still be checked,
      // otherwise a fabricated field silently inherits the trust of the real printed fields.
      const hasBackfilledFields = Array.isArray((primaryBase100g as any)?._estimatedFields) && (primaryBase100g as any)._estimatedFields.length > 0;
      const effectiveDbSourceForChecks = hasBackfilledFields ? "label_partial" : (primaryDbSource || item.dbSource || item.source);
      const rawLabelObjForChecks = item.rawNutritionLabel || visionScoutItems?.[(item.scoutIndex !== undefined && item.scoutIndex !== null) ? item.scoutIndex : itemIdx]?.rawNutritionLabel;
      const labelCalValForChecks = parseLabelCalories(rawLabelObjForChecks);
      const printedCaloriesPresentForChecks =
        labelCalValForChecks != null &&
        labelCalValForChecks > 0 &&
        rawLabelObjForChecks &&
        (rawLabelObjForChecks.calories != null && String(rawLabelObjForChecks.calories).trim() !== '' && String(rawLabelObjForChecks.calories).toLowerCase() !== 'null');

      const isHardLockedForChecks =
        printedCaloriesPresentForChecks ||
        (itemLockedKeys.has('calories') && itemTruthNutrients.calories != null && (primaryDbSource === 'label' || primaryDbSource === 'brand_official'));
        
      const willUseSoftBudget = !isHardLockedForChecks;

      if (!willUseSoftBudget) {
        applyNutrientRealityChecks(
          item.originalName || item.keyword,
          itemWeight,
          aggregatedNutrients,
          unlockedCookingAdded.addedSodium,
          addDebugLog,
          effectiveDbSourceForChecks,
          {
            originalName: item.originalName || item.keyword,
            keyword: item.keyword,
            componentCount: Array.isArray(item.components) ? item.components.length : 0,
            physicalForm: preForm?.physicalForm,
            chainName: item.chainName || null,
          }
        );
      } else {
        addDebugLog(`[RealityCheck] skipped pre-budget density rescale for soft-budget item "${item.originalName || item.keyword}"`);
      }

      // Truth always wins after reality checks (including genuine zeros).
      Object.entries(itemTruthNutrients).forEach(([key, value]) => {
        if (itemLockedKeys.has(key)) {
          aggregatedNutrients[key] = value;
        }
      });

      // Clamp all nutrients to 0 to prevent negative values (anti-nutrients bug)
      for (const key of Object.keys(aggregatedNutrients)) {
        if (aggregatedNutrients[key] < 0 || isNaN(aggregatedNutrients[key])) {
          aggregatedNutrients[key] = 0;
        }
      }
      // Re-apply truth after clamp so a locked 0 is not wiped, and locked positives stay exact.
      Object.entries(itemTruthNutrients).forEach(([key, value]) => {
        if (itemLockedKeys.has(key)) {
          aggregatedNutrients[key] = value;
        }
      });

      // Hybrid Calorie Pipeline: Budget -> Foundation Sum -> Reconcile
      const itemNameForBudget = item.originalName || item.keyword || item.name || '';
      const scoutIndexVal = (item.scoutIndex !== undefined && item.scoutIndex !== null) ? item.scoutIndex : itemIdx;
      const scoutMatch = visionScoutItems?.[scoutIndexVal] || visionScoutItems?.find((v: any) => v.scoutIndex === scoutIndexVal);
      const scoutEstCal = Number(item.estimatedCalories || scoutMatch?.estimatedCalories);
      const rawLabelObj = item.rawNutritionLabel || scoutMatch?.rawNutritionLabel;
      const labelCalVal = parseLabelCalories(rawLabelObj);

      // Genuine hard calories: printed OCR/label or brand_official only — NEVER web_search / category / estimated
      const printedCaloriesPresent =
        labelCalVal != null &&
        labelCalVal > 0 &&
        rawLabelObj &&
        (rawLabelObj.calories != null && String(rawLabelObj.calories).trim() !== '' && String(rawLabelObj.calories).toLowerCase() !== 'null');

      // Hard kcal only if we have printed label calories OR locked brand/label truth — not web
      let hardLabelKcal: number | null = null;
      if (printedCaloriesPresent) {
        let ssGrams = 100;
        if (rawLabelObj) {
          const ssKey = Object.keys(rawLabelObj).find((k: string) => {
            const clean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            return clean === 'servingsize' || clean === 'takaransaji';
          });
          if (ssKey) {
            ssGrams = parseServingSizeGrams(String(rawLabelObj[ssKey]), itemWeight);
          }
        }
        const scaledLabelCal = Math.round(labelCalVal * (itemWeight / ssGrams));
        // If label is per-100g, existing truth rescale may already be in itemTruthNutrients; prefer locked printed total when source is label
        hardLabelKcal =
          itemLockedKeys.has('calories') && itemTruthNutrients.calories != null && (primaryDbSource === 'label' || primaryDbSource === 'brand_official')
            ? Number(itemTruthNutrients.calories)
            : scaledLabelCal;
      } else if (
        itemLockedKeys.has('calories') &&
        itemTruthNutrients.calories != null &&
        (primaryDbSource === 'label' || primaryDbSource === 'brand_official')
      ) {
        hardLabelKcal = Number(itemTruthNutrients.calories);
      } else {
        hardLabelKcal = null; // force soft path: scout / category
      }

      if (itemLockedKeys.has('calories') && hardLabelKcal == null) {
        // Strip bogus calorie lock from web/rejected truth so reconcile stays soft
        itemLockedKeys.delete('calories');
        delete itemTruthNutrients.calories;
        addDebugLog(`[Budget] stripped non-genuine calorie lock for "${itemNameForBudget}" (source=${primaryDbSource})`);
      }

      if (hardLabelKcal != null && hardLabelKcal > 0) {
        if (aggregatedNutrients.calories > 0 && Math.abs(aggregatedNutrients.calories - hardLabelKcal) > 1) {
          const scale = hardLabelKcal / aggregatedNutrients.calories;
          for (const k of ['protein', 'carbohydrates', 'totalFat', 'saturatedFat', 'sodium', 'sugar', 'totalFibre']) {
            if (typeof aggregatedNutrients[k] === 'number') {
              aggregatedNutrients[k] = Math.round(aggregatedNutrients[k] * scale * 10) / 10;
            }
          }
          if (Array.isArray(componentsDetailList) && componentsDetailList.length > 0) {
            componentsDetailList.forEach((s: any) => {
              if (!s || typeof s !== 'object') return;
              if (s.calories != null) s.calories = Math.round(s.calories * scale * 10) / 10;
              if (s.protein != null) s.protein = Math.round(s.protein * scale * 10) / 10;
              if (s.totalFat != null) s.totalFat = Math.round(s.totalFat * scale * 10) / 10;
              if (s.saturatedFat != null) s.saturatedFat = Math.round(s.saturatedFat * scale * 10) / 10;
              if (s.sodium != null) s.sodium = Math.round(s.sodium * scale * 10) / 10;
            });
          }
        }
        aggregatedNutrients.calories = hardLabelKcal;
      }

      const budgetRes = computeItemBudget({
        itemName: itemNameForBudget,
        weightGrams: itemWeight,
        hardLabelKcal,
        brandMenuKcal:
          !hasComponents && primaryDbSource === 'brand_official' && primaryBase100g?.calories != null
            ? (((primaryBase100g as any)?.basisType === 'total' || (primaryBase100g as any)?.basisType === 'per_dish')
                ? ((Number(primaryBase100g.calories) < 60 && itemWeight >= 150) ? Number(primaryBase100g.calories) * (itemWeight / 100) : Number(primaryBase100g.calories))
                : Number(primaryBase100g.calories) * (itemWeight / 100))
            : null,
        dishCacheKcal:
          !hasComponents && (primaryDbSource === 'dish_cache' || primaryDbSource === 'internal_dish_cache')
            ? Number(primaryBase100g?.calories) * (itemWeight / 100)
            : null,
        scoutEstimatedCalories: Number.isFinite(scoutEstCal) && scoutEstCal > 0 ? scoutEstCal : null,
      });

      addDebugLog(`[Budget] item="${itemNameForBudget}" kcal=${budgetRes.budgetKcal} source=${budgetRes.source} hard=${budgetRes.hardLock} weight=${itemWeight} scoutEst=${scoutEstCal || 'n/a'}`);
      addDebugLog(`[Foundation] item="${itemNameForBudget}" kcal=${aggregatedNutrients.calories}`);

      const recRes = reconcileNutrients({
        nutrients: aggregatedNutrients,
        budget: budgetRes,
        formOk: !item.formIdentityFailure,
        incompleteAssembly: !!item.assemblyAnomaly,
      });

      addDebugLog(`[Reconcile] item="${itemNameForBudget}" action=${recRes.action} foundation=${recRes.foundationKcal} budget=${recRes.budgetKcal} final=${recRes.finalKcal} factor=${recRes.scaleFactor.toFixed(3)}`);

      if (!budgetRes.hardLock && recRes.budgetKcal && recRes.foundationKcal > 0) {
        const foundationBudgetRatio = recRes.foundationKcal / recRes.budgetKcal;
        if (foundationBudgetRatio < 0.6 || foundationBudgetRatio > 1.7) {
          if (!item.anomalyFlags) item.anomalyFlags = [];
          if (!item.anomalyFlags.includes('FOUNDATION_BUDGET_DIVERGENCE')) item.anomalyFlags.push('FOUNDATION_BUDGET_DIVERGENCE');
          addDebugLog(`[Reconcile] flagged "${itemNameForBudget}" FOUNDATION_BUDGET_DIVERGENCE (ratio=${foundationBudgetRatio.toFixed(2)})`);

          // Proactive self-healing: If a single-component soft item diverges severely (<0.35x or >2.8x),
          // check if the category fallback profile provides a more plausible, physically sound estimate.
          if ((foundationBudgetRatio < 0.35 || foundationBudgetRatio > 2.8) && componentsDetailList.length <= 1 && itemWeight > 0) {
            const catProfile = getFallbackCategoryProfile(itemNameForBudget);
            if (catProfile && catProfile.calories > 0) {
              const catKcal = Math.round(catProfile.calories * (itemWeight / 100));
              const catRatio = catKcal / recRes.budgetKcal;
              if (catRatio >= 0.5 && catRatio <= 2.0) {
                addDebugLog(`[Reconcile Self-Healing] Auto-corrected severe divergence for "${itemNameForBudget}" using category profile: ${recRes.foundationKcal} kcal -> ${catKcal} kcal.`);
                NUTRIENT_KEYS.forEach(k => {
                  if (catProfile[k] != null) {
                    recRes.nutrients[k] = Math.round((catProfile[k] * (itemWeight / 100)) * 10) / 10;
                  }
                });
                recRes.nutrients.calories = catKcal;
                recRes.foundationKcal = catKcal;
                recRes.finalKcal = catKcal;
              }
            }
          }
        }
      }

      // Apply reconciled nutrients map
      Object.assign(aggregatedNutrients, recRes.nutrients);

      // Re-sync primaryBase100g with post-reconciliation aggregatedNutrients so downstream First-Principles Injection & aggregateItemsNutrients match precalc block exactly
      if (primaryBase100g && itemWeight > 0) {
        const scaledBase100g: Record<string, number> = { ...(primaryBase100g as any) };
        NUTRIENT_KEYS.forEach(key => {
          scaledBase100g[key] = parseFloat(((aggregatedNutrients[key] || 0) / (itemWeight / 100)).toFixed(3));
        });
        primaryBase100g = scaledBase100g;
      }

      // Printed/brand hard lock may scale component rows to the label.
      // Soft/scout budget must not silently scale rows (wrap ×0.730 / salad 2.000).
      if (budgetRes.hardLock && recRes.scaleFactor !== 1 && recRes.scaleFactor > 0) {
        componentsDetailList.forEach((s: any) => {
          if (!s || typeof s !== 'object') return;
          if (s.calories != null) s.calories = Math.round(s.calories * recRes.scaleFactor * 10) / 10;
          if (s.protein != null) s.protein = Math.round(s.protein * recRes.scaleFactor * 10) / 10;
          if (s.totalFat != null) s.totalFat = Math.round(s.totalFat * recRes.scaleFactor * 10) / 10;
          if (s.saturatedFat != null) s.saturatedFat = Math.round(s.saturatedFat * recRes.scaleFactor * 10) / 10;
          if (s.sodium != null) s.sodium = Math.round(s.sodium * recRes.scaleFactor * 10) / 10;
          if (s.carbohydrates != null) s.carbohydrates = Math.round(s.carbohydrates * recRes.scaleFactor * 10) / 10;
          if (s.sugar != null) s.sugar = Math.round(s.sugar * recRes.scaleFactor * 10) / 10;
          if (s.totalFibre != null) s.totalFibre = Math.round(s.totalFibre * recRes.scaleFactor * 10) / 10;
        });
      } else if (!budgetRes.hardLock && recRes.action === 'scale') {
        aggregatedNutrients.calories = recRes.foundationKcal;
        addDebugLog(`[Reconcile] refused silent scale for "${itemNameForBudget}" — keep foundation=${recRes.foundationKcal}`);
      }

      // Re-apply ONLY hard-locked truth fields after reconcile (do not wipe soft budget reconcile)
      Object.entries(itemTruthNutrients).forEach(([key, value]) => {
        if (itemLockedKeys.has(key)) {
          aggregatedNutrients[key] = value;
        }
      });

      // Issue #5: Narrative vs. Final Table Protein Mismatch.
      // Atwater rescaling must occur *before* Dietitian prompt assembly for soft-budget items
      // so the Dietitian writes its narrative based on the final rescaled macros.
      checkAtwaterConsistency(item.originalName || item.keyword, aggregatedNutrients, addDebugLog);

      // Apply the Commercial Sodium Floor unconditionally now that calories are finalized
      // (post-reconcile), so the Dietitian prompt's macroTotals match what the final
      // aggregateItemsNutrients pass will save. This runs regardless of soft/hard budget —
      // unlike the earlier pre-budget applyNutrientRealityChecks call, which is intentionally
      // skipped for soft-budget items because the calorie numbers aren't finalized yet at that point.
      applyCommercialSodiumFloor(
        item.originalName || item.keyword,
        aggregatedNutrients,
        effectiveDbSourceForChecks,
        addDebugLog,
        {
          originalName: item.originalName || item.keyword,
          keyword: item.keyword,
          componentCount: Array.isArray(item.components) ? item.components.length : 0,
          physicalForm: preForm?.physicalForm,
          chainName: item.chainName || null,
        }
      );

      applySatFatAndAddedSugarFloor(
        item.originalName || item.keyword,
        aggregatedNutrients,
        effectiveDbSourceForChecks,
        addDebugLog,
        {
          originalName: item.originalName || item.keyword,
          keyword: item.keyword,
          componentCount: Array.isArray(item.components) ? item.components.length : 0,
          physicalForm: preForm?.physicalForm,
          chainName: item.chainName || null,
        }
      );

      // Sync dietitian-facing totals with the same composite density/sodium reconciliation
      // that the receipt-table pass applies later, so the Dietitian prompt and the final UI
      // table are built from identical numbers instead of diverging. See TASK 6 notes.
      {
        const isCompositeForDietitianSync =
          (Array.isArray(item.components) && item.components.length >= 2) ||
          preForm?.physicalForm === "COMPOUND_MEAL" ||
          /\b(bowl|poke|salad|bento)\b/i.test(String(item.originalName || item.keyword || ""));
        const dietitianSyncResult = applyPostReconcileTruthLocks({
          sumNutrients: {
            calories: aggregatedNutrients.calories || 0,
            protein: aggregatedNutrients.protein || 0,
            totalFat: aggregatedNutrients.totalFat || 0,
            saturatedFat: aggregatedNutrients.saturatedFat || 0,
            sodium: aggregatedNutrients.sodium || 0,
            carbohydrates: aggregatedNutrients.carbohydrates || 0,
          },
          ledgerTruth: itemTruthNutrients,
          lockedNutrientKeys: Array.from(itemLockedKeys),
          receiptRealityCheckNutrients: {
            calories: aggregatedNutrients.calories,
            protein: aggregatedNutrients.protein,
            totalFat: aggregatedNutrients.totalFat,
            saturatedFat: aggregatedNutrients.saturatedFat,
            sodium: aggregatedNutrients.sodium,
            carbohydrates: aggregatedNutrients.carbohydrates,
          },
          isCompositeReceipt: isCompositeForDietitianSync,
        });
        if (dietitianSyncResult.appliedDensityCorrection || dietitianSyncResult.appliedSodiumRealityCheck) {
          addDebugLog(`[Dietitian Sync] Pre-dietitian reconciliation applied for "${item.originalName || item.keyword}" (density=${dietitianSyncResult.appliedDensityCorrection}, sodium=${dietitianSyncResult.appliedSodiumRealityCheck}).`);
          
          const oldCalories = aggregatedNutrients.calories > 0 ? aggregatedNutrients.calories : 1;
          const syncFix = dietitianSyncResult.nutrients.calories / oldCalories;

          aggregatedNutrients.calories = dietitianSyncResult.nutrients.calories;
          aggregatedNutrients.protein = dietitianSyncResult.nutrients.protein;
          aggregatedNutrients.totalFat = dietitianSyncResult.nutrients.totalFat;
          aggregatedNutrients.saturatedFat = dietitianSyncResult.nutrients.saturatedFat;
          aggregatedNutrients.sodium = dietitianSyncResult.nutrients.sodium;
          aggregatedNutrients.carbohydrates = dietitianSyncResult.nutrients.carbohydrates;

          if (hasComponents && componentsDetailList.length > 0) {
            componentsDetailList.forEach((s: any) => {
              if (!s || typeof s !== 'object') return;
              if (s.calories != null) s.calories = Math.round(s.calories * syncFix * 10) / 10;
              if (s.protein != null) s.protein = Math.round(s.protein * syncFix * 10) / 10;
              if (s.totalFat != null) s.totalFat = Math.round(s.totalFat * syncFix * 10) / 10;
              if (s.saturatedFat != null) s.saturatedFat = Math.round(s.saturatedFat * syncFix * 10) / 10;
              if (s.sodium != null) s.sodium = Math.round(s.sodium * syncFix * 10) / 10;
            });
          }

          if (primaryBase100g && itemWeight > 0) {
            const scaledBase100g: Record<string, number> = { ...(primaryBase100g as any) };
            NUTRIENT_KEYS.forEach(key => {
              scaledBase100g[key] = parseFloat(((aggregatedNutrients[key] || 0) / (itemWeight / 100)).toFixed(3));
            });
            primaryBase100g = scaledBase100g;
          }
        }
      }

      // Receipt invariant: component rows must match item total; repair if needed
      const compCals = componentsDetailList.map((s: any) => Number(s.calories) || 0);
      if (!hasComponents && primaryBase100g && primaryBase100g.calories != null) {
        compCals.push((Number(primaryBase100g.calories) || 0) * (primaryBaseWeightG / 100) * (recRes.scaleFactor || 1));
      }
      if (compCals.length > 0) {
        const inv = assertComponentSumMatchesItem(compCals, aggregatedNutrients.calories);
        if (!inv.ok) {
          addDebugLog(`[ReceiptInvariant] FAIL item="${itemNameForBudget}" rowSum=${inv.rowSum} itemCal=${inv.itemCalories}`);
          addDebugLog(`[ReceiptInvariant Debug] item="${itemNameForBudget}" preRepair.aggregatedCalories=${aggregatedNutrients.calories} preRepair.itemLevelCaloriesField=${(item as any).calories ?? 'undefined'}`);
          // Only scale rows UP/DOWN to item when budget hard-locked from printed/brand — never for web fakes
          const genuineHardCal =
            budgetRes.hardLock === true &&
            (budgetRes.source === 'label' || budgetRes.source === 'brand') &&
            inv.itemCalories > 0 &&
            inv.rowSum > 0;
          if (genuineHardCal) {
            const fix = inv.itemCalories / inv.rowSum;
            // refuse absurd repair factors (identity failure)
            if (fix < 0.5 || fix > 2.0) {
              addDebugLog(`[ReceiptInvariant] SKIP rows→item factor=${fix.toFixed(3)} out of band; prefer foundation/scout`);
              if (inv.rowSum > 0) {
                aggregatedNutrients.calories = Math.round(inv.rowSum * 10) / 10;
                addDebugLog(`[ReceiptInvariant] REPAIRED itemCal→rowSum ${inv.itemCalories}→${inv.rowSum}`);
              }
            } else {
              componentsDetailList.forEach((s: any) => {
                if (!s || typeof s !== 'object') return;
                if (s.calories != null) s.calories = Math.round(s.calories * fix * 10) / 10;
                if (s.protein != null) s.protein = Math.round(s.protein * fix * 10) / 10;
                if (s.totalFat != null) s.totalFat = Math.round(s.totalFat * fix * 10) / 10;
                if (s.saturatedFat != null) s.saturatedFat = Math.round(s.saturatedFat * fix * 10) / 10;
                if (s.sodium != null) s.sodium = Math.round(s.sodium * fix * 10) / 10;
              });
              addDebugLog(`[ReceiptInvariant] REPAIRED rows→item lock factor=${fix.toFixed(3)}`);
            }
          } else if (recRes.action === 'scale' || recRes.action === 'keep' || budgetRes.source === 'scout' || budgetRes.source === 'category') {
            if (!budgetRes.hardLock && inv.rowSum > 0 && inv.itemCalories > 0 && Math.abs(inv.rowSum - inv.itemCalories) > 1.1) {
              const aligned = applySoftReceiptAlignment(inv.itemCalories, inv.rowSum);
              aggregatedNutrients.calories = aligned.itemCalories;
              addDebugLog(`[ReceiptInvariant] itemCal:=rowSum ${inv.itemCalories}→${aligned.itemCalories} (no row scale)`);
            }
          } else if (inv.rowSum > 0) {
            // legacy: only when no scout/category budget
            aggregatedNutrients.calories = Math.round(inv.rowSum * 10) / 10;
            addDebugLog(`[ReceiptInvariant] REPAIRED itemCal→rowSum ${inv.itemCalories}→${inv.rowSum}`);
          }
        }
      }

      // Re-sync primaryBase100g again after the ReceiptInvariant repair above, which can further
      // mutate aggregatedNutrients.calories AFTER the earlier post-reconciliation resync ran.
      // Without this, primaryBase100g keeps stale pre-repair values, and the later First-Principles
      // Injection stage recomputes item nutrients from that stale basis instead of the repaired total
      // (e.g. reproducing a pre-ReceiptInvariant calorie figure instead of the corrected one).
      if (primaryBase100g && itemWeight > 0) {
        const receiptRepairedBase100g: Record<string, number> = { ...(primaryBase100g as any) };
        NUTRIENT_KEYS.forEach(key => {
          receiptRepairedBase100g[key] = parseFloat(((aggregatedNutrients[key] || 0) / (itemWeight / 100)).toFixed(3));
        });
        primaryBase100g = receiptRepairedBase100g;
      }

      const isSingleStapleItem = SINGLE_STAPLE_RE.test(item.originalName || item.keyword || '');
      const isMultiComp = !isSingleStapleItem && hasComponents && Array.isArray(componentsDetailList) && componentsDetailList.length > 1;
      const allShareBrand = isMultiComp && componentsDetailList.every((c: any) => c.brand && c.brand.toLowerCase() === componentsDetailList[0].brand?.toLowerCase());
      const effectiveParentBrand = allShareBrand ? (componentsDetailList[0].brand || null) : (isMultiComp ? null : (item.brand || item.chainName || null));
      const effectiveParentChain = allShareBrand ? (componentsDetailList[0].chainName || null) : (isMultiComp ? null : (item.chainName || null));
      const effectiveParentDbSource = isMultiComp ? "composite" : (primaryDbSource || "estimated");
      const effectiveParentDbId = isMultiComp ? `composite_${item.scoutIndex}` : (primaryDbId || null);

      return {
        scoutIndex: item.scoutIndex,
        keyword: item.keyword,
        originalName: item.originalName || item.keyword,
        chainName: effectiveParentChain,
        brand: effectiveParentBrand,
        diningEnvironment: item.diningEnvironment || diningEnvironment || "unknown",
        rawNutritionLabel: item.rawNutritionLabel || null,
        cookingMethod: itemCookingMethod,
        estimatedWeightGrams: itemWeight,
        hasComponents,
        bestMatchDbId: effectiveParentDbId,
        bestMatchDbSource: effectiveParentDbSource,
        dbId: effectiveParentDbId,
        dbSource: effectiveParentDbSource,
        primaryBaseMatchName: item.originalName || primaryBaseMatchName || item.keyword,
        primaryBase100g: primaryBase100g,
        primaryBaseWeightG: primaryBaseWeightG,
        componentsDetailList: componentsDetailList,
        compositeSiblings: componentsDetailList,
        cookingAdded: {
          addedCalories: Math.round(unlockedCookingAdded.addedCalories),
          addedFat: Math.round(unlockedCookingAdded.addedFat * 10) / 10,
          addedSaturatedFat: Math.round(unlockedCookingAdded.addedSaturatedFat * 10) / 10,
          addedSodium: Math.round(unlockedCookingAdded.addedSodium),
        },
        nutrients: aggregatedNutrients,
        truthNutrients: itemTruthNutrients,
        lockedNutrientKeys: Array.from(itemLockedKeys),
        ingredientsList: item.ingredientsList || null,
        labelProductName: item.labelProductName || null,
        pieceCount: pieceCount,
        visualIngredients: item.visualIngredients || null,
        components: item.components || null,
        boundingBox2D: item.boundingBox2D || null,
        sourceImageIndex: typeof item.sourceImageIndex === "number" ? item.sourceImageIndex : (item.sourceImageIndex ? Number(item.sourceImageIndex) : 0),
      };
    });
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
            itemStr += `  Constituent Ingredients Breakdown:\n` +
              item.componentsDetailList.map((c: any) => `    * ${c.name} (${c.weightGrams}g): ${c.calories || 0} kcal, ${c.protein || 0}g protein, ${c.totalFat || c.fat || 0}g fat, ${c.carbohydrates || c.carbs || 0}g carbs`).join('\n') + '\n';
          }
          return itemStr;
        }).join("\n") + "\n\n";
    }

    let userCtx = "";
    if (userProfile) {
      userCtx = `\nUSER DIETARY PROFILE & DEMOGRAPHICS:\n` +
        `- Age: ${userProfile.age || 'Unknown'} years old\n` +
        `- Gender: ${userProfile.gender || 'Unknown'}\n` +
        `- Weight: ${userProfile.weight || 'Unknown'} kg\n` +
        `- Height: ${userProfile.height || 'Unknown'} cm\n` +
        `- Ethnicity: ${userProfile.ethnicity || 'Unknown'}\n`;
    }

    const userTimezone = req.body.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    let localDateStr;
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: userTimezone, year: 'numeric', month: '2-digit', day: '2-digit' });
      localDateStr = formatter.format(new Date());
    } catch(e) {
      localDateStr = new Date().toISOString().split("T")[0];
    }
    const localTime = new Date().toLocaleTimeString();
    const userMentionsDate = /\b(yesterday|tomorrow|last night|january|february|march|april|may|june|july|august|september|october|november|december|\d{4}-\d{2}-\d{2})\b/i.test(message);
    let timeCtx = `\nCURRENT TIME CONTEXT: ${localDateStr} ${localTime}\n`;
    if (activeMeal && activeMeal.date && !userMentionsDate && (!imageDates || imageDates.length === 0)) {
      timeCtx += `CRITICAL INSTRUCTION: This is an edit/update to an active meal originally logged on "${activeMeal.date}". You MUST use "${activeMeal.date}" in the "date" field of "foodData" unless the user explicitly provides a different date in the chat.\n`;
    } else {
      timeCtx += `CRITICAL INSTRUCTION: You MUST use "${localDateStr}" in the "date" field of "foodData" unless the user explicitly provides a different date in the chat.\n`;
    }

    let imageCtx = "";
    if (imagePayloads && imagePayloads.length > 0) {
      if (imagePayloads.length > 1) {
        imageCtx = `\n[Context: ${imagePayloads.length} images are attached above. One or more may be a close-up photo of a printed Nutrition Facts label rather than the food itself. First determine which image(s), if any, show a nutrition facts/label panel. For any such label image: read its exact printed per-serving values and stated serving size, then mathematically scale those exact numbers to the actual weight/quantity consumed as shown in the other image(s) or described by the user — do not substitute your own estimate when a label is legible. For any remaining image(s) showing the actual food, rely on visual cues for portion sizing, ingredients, and freshness as usual.]\n`;
      } else {
        imageCtx = `\n[Context: An image is uploaded and attached above. If it is a close-up of a printed Nutrition Facts label, read its exact printed values and stated serving size, then scale them to the actual weight/quantity consumed; otherwise rely on visual cues for portion sizing, ingredients, and freshness.]\n`;
      }
      if (imageDates && imageDates.length > 0) {
        const primaryImageDate = imageDates[0];
        imageCtx += `\n[CRITICAL DATE OVERRIDE: The uploaded image was taken on ${primaryImageDate}. You MUST use this exact date or its nearest YYYY-MM-DD representation as the "date" field in "foodData", completely overriding the CURRENT TIME CONTEXT, unless the user explicitly asks otherwise.]\n`;
      }
    }

    let historyContext = "";
    if (history && Array.isArray(history) && history.length > 0) {
      const cleanHistory: any[] = [];
      history.forEach((h: any) => {
        if (!h || !h.content) return;
        const last = cleanHistory[cleanHistory.length - 1];
        if (!last || last.role !== h.role || String(last.content).trim() !== String(h.content).trim()) {
          cleanHistory.push(h);
        }
      });
      if (cleanHistory.length > 0) {
        historyContext = "PAST DISCUSSIONS & MEALS CHAT HISTORY:\n" +
          cleanHistory.slice(-10).map((h: any) => `${h.role.toUpperCase()}: ${h.content}`).join("\n") + "\n\n";
      }
    }

    let pastMealsCtx = "";
    if (foodLogs && Array.isArray(foodLogs) && foodLogs.length > 0) {
      try {
        const pastMeals: any[] = [];
        foodLogs.forEach((f: any) => {
          if (f) {
            pastMeals.push({
              name: f.name,
              date: f.date || "",
              calories: f.nutrients?.calories || f.calories || 0,
              protein: f.nutrients?.protein || f.protein || 0,
              saturatedFat: f.nutrients?.saturatedFat || f.saturatedFat || 0,
              sodium: f.nutrients?.sodium || f.sodium || 0,
              carbohydrates: f.nutrients?.carbohydrates || f.carbohydrates || 0
            });
          }
        });
        if (pastMeals.length > 0) {
          pastMeals.sort((a: any, b: any) => b.date.localeCompare(a.date));
          const recent = pastMeals.slice(0, 10);
          pastMealsCtx = "PATIENT'S RECENT LOGGED MEALS HISTORY (from client state):\n" +
            recent.map((m, idx) => `- Meal ${idx + 1}: "${m.name}" on ${m.date}`).join("\n") + "\n\n";
          addDebugLog(`[Client Context] Successfully loaded ${pastMeals.length} past meal(s) from client payload, included recent ${recent.length} meals in prompt context.`);

          // Rolling average of DAILY TOTALS, counting only days with 2+ meals
          // logged (a single snack logged alone would otherwise skew the
          // "daily average" misleadingly low).
          const dayTotals: { [date: string]: { count: number; calories: number; protein: number; saturatedFat: number; sodium: number; carbohydrates: number } } = {};
          pastMeals.forEach((m: any) => {
            if (!m.date) return;
            if (!dayTotals[m.date]) {
              dayTotals[m.date] = { count: 0, calories: 0, protein: 0, saturatedFat: 0, sodium: 0, carbohydrates: 0 };
            }
            dayTotals[m.date].count += 1;
            dayTotals[m.date].calories += Number(m.calories) || 0;
            dayTotals[m.date].protein += Number(m.protein) || 0;
            dayTotals[m.date].saturatedFat += Number(m.saturatedFat) || 0;
            dayTotals[m.date].sodium += Number(m.sodium) || 0;
            dayTotals[m.date].carbohydrates += Number(m.carbohydrates) || 0;
          });
          const qualifyingDays = Object.keys(dayTotals)
            .filter((d) => dayTotals[d].count >= 2)
            .sort((a, b) => b.localeCompare(a))
            .slice(0, 10);
          if (qualifyingDays.length > 0) {
            const sum = qualifyingDays.reduce((acc, d) => {
              acc.calories += dayTotals[d].calories;
              acc.protein += dayTotals[d].protein;
              acc.saturatedFat += dayTotals[d].saturatedFat;
              acc.sodium += dayTotals[d].sodium;
              acc.carbohydrates += dayTotals[d].carbohydrates;
              return acc;
            }, { calories: 0, protein: 0, saturatedFat: 0, sodium: 0, carbohydrates: 0 });
            const n = qualifyingDays.length;
            const avgCal = Math.round(sum.calories / n);
            const avgProtein = Math.round((sum.protein / n) * 10) / 10;
            const avgSatFat = Math.round((sum.saturatedFat / n) * 10) / 10;
            const avgSodium = Math.round(sum.sodium / n);
            const avgCarbs = Math.round((sum.carbohydrates / n) * 10) / 10;
            addDebugLog(`[Client Context] Computed ${n}-day rolling average from qualifying days (>=2 meals/day).`);
          }
        }
      } catch (err: any) {
        addDebugLog(`[Client Context Error] Failed to process client foodLogs: ${err.message}`);
      }
    }
    // 2. Prepend active state to Master System Instructions
    let effectiveActiveMeal = activeMeal;
    const hasUploadedNewImages = imagePayloads && imagePayloads.length > 0;
    // B5: do not wipe active meal when scale-only refine or explicit modify/edit mode
    if (
      !isWeightModification &&
      ((scoutRecommendedMode === "new_log" && !isExplicitModify && !userExplicitlySelectedEditMode) ||
        (hasUploadedNewImages && !isExplicitModify && !userExplicitlySelectedEditMode))
    ) {
      addDebugLog(`[State Isolation] New image scan or new_log mode detected. Isolating activeMeal context so Dietitian operates on clean state.`);
      effectiveActiveMeal = null;
      historyContext = "";
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
    let visionScoutCtx = "";
    const isPureTextEdit = (isExplicitModify || effectiveActiveMeal !== null || activeComparisonState !== null) && (!imagePayloads || imagePayloads.length === 0);
    if (!isPureTextEdit && visionScoutItems && visionScoutItems.length > 0) {
      const itemsList = visionScoutItems.map((item: any, idx: number) => {
        // Use the item's real scoutIndex (assigned earlier, and possibly non-sequential
        // after Multi-Photo Merge removes a duplicate) instead of array position. The
        // Dietitian is instructed to copy this Index verbatim into its own output, and a
        // later step matches the Dietitian's items back to backend-precalculated nutrients
        // by this exact scoutIndex — showing array position here silently mismatches items
        // whenever a merge has created a gap (e.g. a cross-photo duplicate was removed).
        const displayIndex = (item.scoutIndex !== undefined && item.scoutIndex !== null) ? item.scoutIndex : idx;
        const facts = item.nutritionFacts;
        let scaledNutrientsStr = facts ? ` | NutritionFacts: ${JSON.stringify(facts)}` : "";
        return `- Index: ${displayIndex} | Scout Item: "${item.keyword}" | Weight: ${item.estimatedWeightGrams}g | Observed/Local Context: "${item.originalName}"${scaledNutrientsStr}`;
      }).join('\n');

      visionScoutCtx = `\n=== VISUAL FOOD SCOUT IDENTIFIED ITEMS ===\n${itemsList}\n` +
        `Content Type: ${visionScoutContentType} (${visionScoutItems.length} items identified)\n` +
        `Visual Scout Confidence Rating: ${scoutConfidenceRating}\n` +
        (scoutConfidenceComment ? `Visual Scout Confidence Comment: ${scoutConfidenceComment}\n` : "") +
        `Identified Cooking Method & Preparation/Seasonings: ${scoutCookingMethod}\n` +
        (userSelectedMode === 'review' ? `diningEnvironment: ${diningEnvironment}\n` : "");
    }

    let databaseMatchesCtx = "";
    if (preCalculatedCtx) {
      databaseMatchesCtx += `\n=== BACKEND PRE-CALCULATED ITEM NUTRIENTS ===\n${preCalculatedCtx}\n`;
    }
    if (databaseMatches) {
      databaseMatchesCtx += `\n=== VERIFIED DATABASE MATCHES ===\n${databaseMatches}\n`;
    }


    const foodAnalyzeSchema = {
      type: Type.OBJECT,
      properties: {
        _internalReasoning: { type: Type.STRING, description: "Silently gather clinical evidence and synthesize trade-offs before writing the final output." },
        verdict: {
          type: Type.OBJECT,
          properties: {
            label: { type: Type.STRING, description: "Strictly concise (3-6 words) metric-backed clinical status label, e.g., 'Within Daily Calorie Target', 'High Saturated Fat Warning', or 'Solid Low-Sodium Choice'. Do NOT use vague filler or generic phrases." },
            level: { type: Type.STRING, description: "'good' | 'warning' | 'alert' | 'neutral'" }
          },
          required: ["label", "level"]
        },
        message: { type: Type.STRING, description: "Primary clinical assessment, incorporating comforting and supportive tone, next step coaching, and meal balancing suggestions. Do NOT repeat raw calorie, sat fat, or sodium numbers." },
        modificationCommand: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              action: { type: Type.STRING, enum: ['update_weight', 'update_component_weight', 'remove_item', 'add_item', 'rename_alias', 'update_cooking_method'] },
              itemName: { type: Type.STRING },
              newWeightGrams: { type: Type.INTEGER },
              targetDbId: { type: Type.STRING, nullable: true },
              componentName: { type: Type.STRING, nullable: true, description: "Required when action is 'update_component_weight'. The name of the specific ingredient/component inside the composite dish named by itemName (e.g. itemName='Sizzling Steak with Wedges', componentName='Beef Steak')." },
              newItemName: { type: Type.STRING, nullable: true },
              newCookingMethod: { type: Type.STRING, nullable: true }
            },
            required: ["action", "itemName"]
          },
          nullable: true
        },
        foodData: {
          type: Type.OBJECT,
          properties: {
            date: { type: Type.STRING, description: "YYYY-MM-DD" },
            name: { type: Type.STRING },
            itemsBreakdown: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  scoutIndex: { type: Type.INTEGER },
                  canonicalDbName: { type: Type.STRING, description: "Standard database or product name, extremely concise (e.g. 'Whole Rolled Oats'). Do NOT include scaling, rationale, calculations, or explanations." },
                  weightGrams: { type: Type.INTEGER },
                  foodType: { 
                    type: Type.STRING, 
                    enum: ['grain', 'protein', 'vegetable', 'fruit', 'dairy', 'fat/oil', 'beverage', 'snack', 'condiment', 'prepared dish/entree', 'other'],
                    description: "Strictly one of: 'grain', 'protein', 'vegetable', 'fruit', 'dairy', 'fat/oil', 'beverage', 'snack', 'condiment', 'prepared dish/entree', 'other'.", 
                    nullable: true 
                  },
                  cookingMethod: { type: Type.STRING, description: "Concise cooking method (e.g. 'raw', 'baked', 'grilled', 'boiled', 'fried').", nullable: true },
                  correctedNutrients: {
                    type: Type.OBJECT,
                    properties: {
                      calories: { type: Type.NUMBER, nullable: true },
                      protein: { type: Type.NUMBER, nullable: true },
                      carbohydrates: { type: Type.NUMBER, nullable: true },
                      totalFat: { type: Type.NUMBER, nullable: true },
                      saturatedFat: { type: Type.NUMBER, nullable: true },
                      sodium: { type: Type.NUMBER, nullable: true },
                      addedSugar: { type: Type.NUMBER, nullable: true },
                      totalFibre: { type: Type.NUMBER, nullable: true },
                    },
                    nullable: true,
                    description: "Optional. If you identify an inaccurate or underestimated estimate (e.g. deep-fried oil absorption undercounted), output corrected values for this portion."
                  },
                  clinicalCorrectionNote: { type: Type.STRING, nullable: true, description: "If any nutrient was corrected, state the clinical reason (e.g. 'Adjusted fat +6g to account for deep-fried wonton oil absorption')." }
                },
                required: ["scoutIndex", "canonicalDbName", "weightGrams"]
              }
            }
          },
          required: ["date", "name", "itemsBreakdown"],
          nullable: true
        },
        comparison: {
          type: Type.OBJECT,
          properties: {
            comparisonTitle: { type: Type.STRING, nullable: true },
            auditChecklist: { type: Type.STRING, nullable: true },
            groups: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  groupName: { type: Type.STRING, description: "Descriptive name or option title e.g. 'Quaker Oats So Simple' or 'Tier 1 - Safest Choice'" },
                  scoutItemIndices: {
                    type: Type.ARRAY,
                    items: { type: Type.INTEGER },
                    description: "0-based indices of scout items placed in this group"
                  },
                  itemNames: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    nullable: true,
                    description: "Item names for text-only comparisons"
                  },
                  verdict: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING },
                      level: { type: Type.STRING }
                    },
                    required: ["label", "level"]
                  },
                  message: { type: Type.STRING, description: "Clinical advice comparing this option against patient biomarkers" },
                  averageNutrients: {
                    type: Type.OBJECT,
                    properties: {
                      calories: { type: Type.NUMBER, nullable: true },
                      protein: { type: Type.NUMBER, nullable: true },
                      totalFat: { type: Type.NUMBER, nullable: true },
                      saturatedFat: { type: Type.NUMBER, nullable: true },
                      sodium: { type: Type.NUMBER, nullable: true },
                      carbohydrates: { type: Type.NUMBER, nullable: true },
                      addedSugar: { type: Type.NUMBER, nullable: true },
                      potassium: { type: Type.NUMBER, nullable: true },
                      totalFibre: { type: Type.NUMBER, nullable: true }
                    },
                    nullable: true
                  }
                },
                required: ["groupName", "scoutItemIndices", "verdict", "message"]
              }
            }
          },
          nullable: true
        }
      },
      propertyOrdering: ["_internalReasoning", "verdict", "message", "modificationCommand", "foodData", "comparison"],
      required: ["_internalReasoning", "verdict", "message"]
    };

    let biomarkersCtx = "";
    if (biomarkersNeedingImprovement && biomarkersNeedingImprovement.length > 0) {
      biomarkersCtx = `\nCRITICAL PATIENT BIOMARKER WARNINGS:\n` +
        biomarkersNeedingImprovement.map((b: any) => {
          if (typeof b === "string") return `• ${b}`;
          if (b && typeof b === "object" && b.name) {
            const statusStr = b.status ? ` is ${String(b.status).toUpperCase()}` : "";
            const valStr = b.value !== undefined ? ` (${b.value} ${b.unit || ""}, normal range: ${b.normalRange || ""})` : "";
            return `• ${b.name}${statusStr}${valStr}`;
          }
          return `• ${String(b)}`;
        }).join("\n") + "\n";
    }
    const finalSystemInstruction = customSystemInstruction || systemInstruction;
    const modeDPromptSuffix = (userSelectedMode === 'compare') 
      ? `\n\nIf MODE D (evaluation/comparison) applies: reference every item ONLY by its Index number from the Scout list above inside "scoutItemIndices". Every Index must be assigned to at least one group — including duplicate-named items, which are still separate indices. You are allowed to map the same Scout Index to multiple groups if a physical shelf contains items belonging to both categories. Do not restate names, bounding boxes, or database IDs.`
      : ``;

    let promptText = (customVariableData 
      ? `${customVariableData}\n${biomarkersCtx}\n${visionScoutCtx}\n${databaseMatchesCtx}\nCurrent User Input: "${message}"`
      : `${historyContext}${pastMealsCtx}Analyze this current food request.
${userCtx}
${biomarkersCtx}
${timeCtx}
${imageCtx}
${visionScoutCtx}
${databaseMatchesCtx}
Current User Input: "${message}"`) + modeDPromptSuffix;

    fullPromptSent = `System Instruction:\n${finalSystemInstruction}\n\n${promptText}`;
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
      let cleanJson = extractBalancedJson(textOutput);
      const extractedScratchpad = textOutput.replace(cleanJson, "").replace(/```(?:json)?/gi, "").trim();

      // Sanitize pathological weightGrams values like "350.000000...000" → "350"
      // These are generated by the LLM and inflate JSON size causing truncation errors
      cleanJson = cleanJson.replace(/"(\d+)\.0{10,}(\d*)"/g, (_, int, tail) => `"${int}${tail ? '.' + tail.replace(/0+$/, '') : ''}"`);
      cleanJson = cleanJson.replace(/:\s*(\d+)\.0{10,}\d*/g, (_, int) => `: ${int}`);
      // Robust fallback for any unquoted or quoted decimal with long runaway zeros (e.g. 150.00000000000003g)
      cleanJson = cleanJson.replace(/(\d+)\.(\d*?)0{10,}(\d*)/g, (match, intPart, midPart, endPart) => {
        const combinedFrac = (midPart + endPart).replace(/0+$/, '');
        return combinedFrac ? `${intPart}.${combinedFrac}` : intPart;
      });

      // Sanitize runaway/repeating string values in fields like foodType
      cleanJson = cleanJson.replace(/"foodType"\s*:\s*"([^"]{80,})"/g, (_, val) => {
        const firstToken = val.split(/[\s,]+/)[0] || 'protein';
        return `"foodType": "${firstToken}"`;
      });

      let rawParsed;
      try {
        rawParsed = await asyncParseLLMJSON(cleanJson);
        rawParsed = validateOrFallback(RouteAgentSchema, rawParsed, cleanJson, "RouteAgent", { 
          _internalReasoning: "",
          verdict: { label: "Meal Logged", level: "neutral" },
          message: "I have analyzed your food log.",
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

    if (canSkipDietitianForPureScale && weightRefineIntent.isRefine && weightRefineIntent.weightGrams) {
      const targetWeight = weightRefineIntent.weightGrams;
      addDebugLog(`[Refine] skip-dietitian: Scaled label-locked meal directly to ${targetWeight}g without LLM call.`);
      sendStreamEvent({ type: 'status', stage: 'dietitian', status: 'completed', message: `Scaled portion to ${targetWeight}g.` });
      textOutput = JSON.stringify({
        _internalReasoning: `[Refine] scale-only: Scaled meal directly to ${targetWeight}g`,
        verdict: { label: "Meal Logged", level: "neutral" },
        message: `Updated meal portion to ${targetWeight}g.`,
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
              calories: s.estimatedCalories,
              scoutIndex: s.scoutIndex ?? idx,
            }));
        rawParsed.foodData = { ...existingFd, itemsBreakdown: breakdown };
      }
    }

    let mode = rawParsed.mode || "new_log";
    if (userSelectedMode !== 'compare' && visionScoutItems && visionScoutItems.length <= 1 && mode === "evaluation") {
      addDebugLog(`[Mode Override] Overriding mode from 'evaluation' to 'new_log' because only 1 item was identified.`);
      mode = "new_log";
    }
    const originalModeIsModify = (mode === "modify" || isExplicitModify || userExplicitlySelectedEditMode || (req.body.activeMeal !== undefined && (message.toLowerCase().includes("change") || message.toLowerCase().includes("modify") || message.toLowerCase().includes("update") || message.toLowerCase().includes("remove") || message.toLowerCase().includes("add") || message.toLowerCase().includes("correct") || message.toLowerCase().includes("only") || message.toLowerCase().includes("instead") || message.toLowerCase().includes("replace"))));

    apiCalls = [
      ...(hasImage ? [{ type: 'gemini', label: 'Food nutrition agent - Visual Scout (gemini-3.5-flash-lite)' }] : []),
      ...(queriesToSearch && queriesToSearch.length > 0 ? [{ type: 'usda', label: `Food nutrition agent - USDA (${queriesToSearch.length})` }] : []),
      { type: 'gemini', label: `Food nutrition agent - Dietitian (${(typeof engine === 'object' ? engine?.name || engine?.model : engine) || 'gemini-3.5-flash-lite'})` }
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
        if (isDishEstimateEnabled(req)) {
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
        } else {
        visionScoutItems.forEach((sItem: any, idx: number) => {
          const q = sItem.keyword || sItem.originalName || sItem.name || '';
          const normQ = normalizeFoodKey(q);
          const dbMatch = databaseMatchesArray.find((m: any) => normalizeFoodKey(m.searchQuery || m.name) === normQ || m.searchQuery === q) || databaseMatchesArray[idx];
          const itemGrams = Number(sItem.weightGrams || sItem.estimatedGrams || sItem.estimatedWeightGrams || sItem.servingGrams || 100) || 100;
          const factor = itemGrams / 100;

          let raw100g: Record<string, number> = {};
          if (dbMatch && dbMatch.nutrients) {
            raw100g = dbMatch.nutrients;
          } else if (dbMatch) {
            raw100g = {
              calories: Number(dbMatch.calories || 0),
              protein: Number(dbMatch.protein || 0),
              totalFat: Number(dbMatch.fat || 0),
              saturatedFat: Number(dbMatch.saturatedFat || 0),
              carbohydrates: Number(dbMatch.carbohydrates || 0),
              sodium: Number(dbMatch.sodium || 0),
              totalFibre: Number(dbMatch.totalFibre || 0),
            };
          } else {
            raw100g = getFallbackCategoryProfile(q);
          }

          const labelKcal = parseLabelCalories(sItem.rawNutritionLabel);
          // If label is per-100g style, portionAndReconcile still gets hardLabel as portion when already absolute;
          // prefer scout estimate as soft budget when label absent.
          const result = portionAndReconcile({
            nutrientsPer100g: raw100g,
            weightGrams: itemGrams,
            itemName: q,
            scoutEstimatedCalories: Number(sItem.estimatedCalories) > 0 ? Number(sItem.estimatedCalories) : null,
            hardLabelKcal: labelKcal != null && labelKcal > 0 ? labelKcal : null,
          });
          addDebugLog(`[Budget] mode=D idx=${idx} item="${q}" kcal=${result.budget.budgetKcal} source=${result.budget.source} scoutEst=${sItem.estimatedCalories ?? 'n/a'}`);
          addDebugLog(`[Reconcile] mode=D idx=${idx} action=${result.action} foundation=${result.foundationKcal} final=${result.finalKcal}`);
          preCalcByScoutIndex[idx] = result.nutrients;
        });
        }
      }
      const resolvedGroups = resolveComparisonGroups(comparisonData.groups, visionScoutItems);
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
      if (originalModeIsModify && rawParsed.foodData?.itemsBreakdown?.length > 0 && !hasExplicitEditCommands && !hasLegacyEditCommands) {
        // Model returned itemsBreakdown without editCommands.
        // If we have an activeMeal to diff against, synthesize editCommands here and stay
        // in the MODIFY path so the edit processor (line ~7560) applies the changes against
        // the original scout nutrient basis. Falling to new_log re-maps nutrients from the
        // raw scout item at each array position, giving wrong values for replaced items.
        if (activeMeal && Array.isArray(activeMeal.itemsBreakdown) && activeMeal.itemsBreakdown.length > 0) {
          const dietitianItems: any[] = rawParsed.foodData.itemsBreakdown;
          const synthesized = synthesizeEditCommandsFromBreakdown(activeMeal, dietitianItems, message || '');

          if (synthesized.length > 0) {
            addDebugLog(`[Mode Rewrite] Model returned itemsBreakdown without editCommands — synthesized ${synthesized.length} editCommand(s) from diff. Staying in MODIFY path.`);
            rawParsed.editCommands = synthesized;
            // Leave mode as-is (modify/edit) — do NOT set mode = "new_log"
          } else {
            addDebugLog(`[Mode Rewrite] Model returned itemsBreakdown without editCommands and diff produced 0 changes — falling through to NEW_LOG pipeline.`);
            mode = "new_log";
          }
        } else {
          addDebugLog(`[Mode Rewrite] AI fully regenerated foodData in MODIFY mode (no editCommands, no activeMeal to diff). Routing through NEW_LOG pipeline to compute full nutrients.`);
          mode = "new_log";
        }
      } else if (originalModeIsModify && rawParsed.foodData?.itemsBreakdown?.length > 0 && (hasExplicitEditCommands || hasLegacyEditCommands)) {
        addDebugLog(`[Mode Rewrite] Skipped — editCommands present alongside foodData.itemsBreakdown. Staying in MODIFY path to process ${hasExplicitEditCommands ? rawParsed.editCommands.length : rawParsed.modificationCommand.length} command(s).`);
      }
    }

    // CASE A: NEW FOOD LOGGING
    if (mode === "new_log") {
      const rawFoodData = rawParsed.foodData || {};

      // --- Edit-mode data preservation fix ---
      // When editing an existing meal, the dietitian LLM regenerates itemsBreakdown
      // from scratch and loses the previously-resolved database linkage (dbId,
      // primaryBase100g, componentsDetailList, etc). Backfill those fields from the
      // original activeMeal item (matched by scoutIndex, or array position as a
      // fallback) so nutrient aggregation doesn't fall back to all-zero "estimated".
      // Never overwrites fields the AI's edit actually changed (weight, name, method).
      if (
        originalModeIsModify &&
        activeMeal &&
        Array.isArray(activeMeal.itemsBreakdown) &&
        Array.isArray(rawFoodData.itemsBreakdown) &&
        rawFoodData.itemsBreakdown.length > 0
      ) {
        const origItems = activeMeal.itemsBreakdown;
        const SPATIAL_PRESERVE_KEYS = ['boundingBox2D', 'sourceImageIndex'];
        // NOTE: Only weight-INDEPENDENT reference data belongs in this list — things that
        // identify WHICH food/label/database match this is, not the computed nutrient
        // totals for a specific weight. 'calories', 'protein', 'totalFat', 'saturatedFat',
        // 'sodium', 'carbohydrates', 'truthNutrients', and 'lockedNutrientKeys' were
        // removed from here: they are absolute totals computed for the PRE-EDIT weight,
        // and carrying them forward unscaled after a weight edit (e.g. 200g -> 70g) froze
        // the meal's numbers at the old weight instead of letting them recalculate fresh
        // from the preserved rawNutritionLabel / primaryBase100g reference data below.
        const IDENTITY_PRESERVE_KEYS = [
          'primaryBase100g',
          'primaryBaseWeightG',
          'componentsDetailList',
          'saucesDetailList',
          'primaryBaseMatchName',
          'physicalFormClassification',
          'labelNutrientsPerServing',
          'rawNutritionLabel',
          'matchedKeywords',
          'physicalForm',
          'visualIngredients',
          'components',
          'cookingAdded',
          'syntheticBase100g',
          'isDishEstimate',
          'dbSource',
          'dbId',
        ];
        rawFoodData.itemsBreakdown = await Promise.all(rawFoodData.itemsBreakdown.map(async (newItem: any, idx: number) => {
          const origItemByScout = (newItem.scoutIndex !== undefined && newItem.scoutIndex !== null)
            ? origItems.find((o: any) => o.scoutIndex === newItem.scoutIndex)
            : (origItems[idx] || null);

          let origItemSameFood = origItemByScout && namesReferToSameFood(
            newItem.canonicalDbName || newItem.name || newItem.originalName,
            origItemByScout.canonicalDbName || origItemByScout.name || origItemByScout.originalName
          ) ? origItemByScout : null;

          if (!origItemSameFood) {
            origItemSameFood = origItems.find((o: any) => namesReferToSameFood(
              newItem.canonicalDbName || newItem.name || newItem.originalName,
              o.canonicalDbName || o.name || o.originalName
            )) || null;
          }

          const merged = { ...newItem };

          // Always preserve spatial crop coordinates for the corresponding photo region/scoutIndex
          if (origItemByScout) {
            for (const key of SPATIAL_PRESERVE_KEYS) {
              if ((merged[key] === undefined || merged[key] === null) && origItemByScout[key] !== undefined && origItemByScout[key] !== null) {
                merged[key] = origItemByScout[key];
              }
            }
          }

          // Only preserve database resolution and food composition if it refers to the same food
          if (origItemSameFood) {
            // Preserve descriptive dish name if new emitted name is just a generic keyword
            if (origItemSameFood.originalName && (!merged.originalName || merged.originalName.length < origItemSameFood.originalName.length)) {
              merged.originalName = origItemSameFood.originalName;
            }
            for (const key of IDENTITY_PRESERVE_KEYS) {
              if ((merged[key] === undefined || merged[key] === null) && origItemSameFood[key] !== undefined && origItemSameFood[key] !== null) {
                merged[key] = origItemSameFood[key];
              }
            }
            if ((merged.dbSource === 'estimated' || !merged.dbId) && origItemSameFood.dbId) {
              merged.dbId = origItemSameFood.dbId;
              merged.dbSource = origItemSameFood.dbSource;
            }
            if (origItemSameFood.truthNutrients && Object.keys(origItemSameFood.truthNutrients).length > 0) {
              const origW = Number(origItemSameFood.weightGrams) || 100;
              const newW = Number(newItem.weightGrams) || origW;
              const scaleRatio = origW > 0 ? (newW / origW) : 1.0;
              const scaledTruth: Record<string, any> = {};
              for (const [k, v] of Object.entries(origItemSameFood.truthNutrients)) {
                if (typeof v === 'number' && Number.isFinite(v)) {
                  scaledTruth[k] = (k === 'calories' || k === 'sodium' || k === 'potassium' || k === 'calcium' || k === 'magnesium')
                    ? Math.round(v * scaleRatio)
                    : Math.round(v * scaleRatio * 10) / 10;
                } else {
                  scaledTruth[k] = v;
                }
              }
              merged.truthNutrients = scaledTruth;
              merged.lockedNutrientKeys = origItemSameFood.lockedNutrientKeys || [];
            }
          } else {
            // Identity changed or new item introduced in Edit Mode
            // Fetch fresh database resolution for this new item
            const newName = newItem.canonicalDbName || newItem.name || newItem.originalName;
            if (newName && !merged.dbId) {
              addDebugLog(`[Edit Merge] Identity changed for item (was "${origItemByScout ? (origItemByScout.canonicalDbName || origItemByScout.name) : 'none'}"). Fetching fresh DB resolution for "${newName}".`);
              const hit = await resolveInternalFood(newName);
              if (hit) {
                const virtualId = hit.food_id || `internal_${hit.food_key}`;
                dbMatchMap.set(virtualId, hit.nutrients_per_100g);
                merged.dbId = virtualId;
                merged.dbSource = 'internal_catalog';
                merged.primaryBaseMatchName = hit.display_name || newName;
                merged.primaryBase100g = hit.nutrients_per_100g;
                addDebugLog(`[Edit Merge] Resolved fresh database profile for "${newName}" (ID: ${virtualId}).`);
              } else {
                addDebugLog(`[Edit Merge] Could not find fresh database profile for "${newName}". It will be processed as estimated.`);
              }
            }
          }

          return merged;
        }));
        addDebugLog(`[Edit Merge] Preserved spatial bounding boxes by scoutIndex and database resolution for matching food items.`);
      }

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
        const sanitizedLabel = sanitizeVerdictLabel(rawVerdict.label || 'Balanced Choice', rawVerdict.level, parsedData.nutrients);
        parsedData.verdict = {
          label: sanitizedLabel,
          level: String(rawVerdict.level || 'neutral')
        };
      } else if (rawFoodData.recommendation && typeof rawFoodData.recommendation === 'string' && rawFoodData.recommendation.trim().length > 0) {
        const sanitizedLabel = sanitizeVerdictLabel(rawFoodData.recommendation, 'neutral', parsedData.nutrients);
        parsedData.verdict = {
          label: sanitizedLabel,
          level: 'neutral'
        };
      }
      parsedData.cookingMethod = sanitizeString(rawFoodData.cookingMethod, scoutCookingMethod || "Unknown cooking method");
      parsedData.scoutConfidenceRating = sanitizeString(rawFoodData.scoutConfidenceRating, scoutConfidenceRating || "High (>90%)");
      parsedData.scoutConfidenceComment = rawFoodData.scoutConfidenceComment !== undefined ? sanitizeString(rawFoodData.scoutConfidenceComment, "") : (scoutConfidenceComment || "");
      // diningEnvironment is intentionally NOT re-read from the Dietitian's output.
      // The Vision Scout is the sole source of truth for this classification (server.ts:2528).
      if ((!diningEnvironment || diningEnvironment === 'unknown') && activeMeal?.diningEnvironment) {
        diningEnvironment = activeMeal.diningEnvironment;
      }
      parsedData.diningEnvironment = diningEnvironment;

      // Map and construct itemsBreakdown and aggregate all nutrients
      if (rawFoodData.itemsBreakdown && Array.isArray(rawFoodData.itemsBreakdown) && rawFoodData.itemsBreakdown.length > 0) {
        // [Label Merge] Fold standalone label items into their paired food item
        if (rawFoodData.itemsBreakdown.length > 1) {
          const isLabelPanelItem = (item: any) => {
            const orig = (item.canonicalDbName || item.name || item.originalLocalName || "").toLowerCase();
            const foodKeywords = ["milk", "burger", "fries", "fry", "chicken", "fish", "beef", "fillet", "pork", "salad", "wrap", "bread", "juice", "water", "tea", "coffee", "rice", "noodle", "pasta", "pizza", "cookie", "cake", "fruit", "vegetable", "cheese", "yogurt", "egg", "soup", "stew", "pancake", "waffle", "sausage", "bacon", "steak", "tart", "pie", "donut", "doughnut", "oat", "cereal", "muffin", "soda", "coke"];
            if (foodKeywords.some(kw => orig.includes(kw))) return false;
            return orig.includes("nutrition fact") || 
                   orig.includes("informasi nilai gizi") || 
                   orig.includes("komposisi") || 
                   orig.includes("nutrition label") || 
                   orig.includes("back of package") || 
                   orig.includes("printed_packaging_label") ||
                   orig === "label";
          };

          const labelIndices: number[] = [];
          rawFoodData.itemsBreakdown.forEach((item: any, idx: number) => {
            if (isLabelPanelItem(item)) labelIndices.push(idx);
          });

          // Sort in descending order to splice safely
          labelIndices.reverse().forEach(labelIdx => {
            const labelItem = rawFoodData.itemsBreakdown[labelIdx];
            let primaryItem: any = null;
            const labelText = ((labelItem.ingredientsList || "") + " " + (labelItem.canonicalDbName || "") + " " + (labelItem.name || "") + " " + (labelItem.originalLocalName || "")).toLowerCase();

            // Try to match label text to a food item's name
            for (let j = 0; j < rawFoodData.itemsBreakdown.length; j++) {
               if (!labelIndices.includes(j)) {
                  const candidate = rawFoodData.itemsBreakdown[j];
                  const candName = (candidate.canonicalDbName || candidate.name || candidate.originalLocalName || "").toLowerCase();
                  if (candName && candName.split(' ').some(tok => tok.length > 3 && labelText.includes(tok))) {
                     primaryItem = candidate;
                     break;
                  }
               }
            }

            if (!primaryItem) {
               // Fallback: find nearest non-label item ONLY if label text didn't specify a food
               for (let j = labelIdx - 1; j >= 0; j--) { 
                  if (!labelIndices.includes(j)) { primaryItem = rawFoodData.itemsBreakdown[j]; break; }
               }
               if (!primaryItem) { 
                  for (let j = labelIdx + 1; j < rawFoodData.itemsBreakdown.length; j++) { 
                     if (!labelIndices.includes(j)) { primaryItem = rawFoodData.itemsBreakdown[j]; break; } 
                  }
               }
            }

            if (primaryItem) {
                primaryItem.labelNutrientsPerServing = primaryItem.labelNutrientsPerServing || labelItem.labelNutrientsPerServing || labelItem.rawNutritionLabel || {
                    servingSizeGrams: labelItem.weightGrams || 100,
                    calories: labelItem.calories || 0,
                    protein: labelItem.protein || 0,
                    totalFat: labelItem.totalFat || 0,
                    carbohydrates: labelItem.carbohydrates || 0
                };
                if (primaryItem.dbSource !== 'usda') primaryItem.dbSource = 'label';
                addDebugLog(`[Label Merge] Folded standalone LLM label "${labelItem.canonicalDbName || labelItem.name}" into "${primaryItem.canonicalDbName || primaryItem.name}".`);
                rawFoodData.itemsBreakdown.splice(labelIdx, 1);
            }
          });
        }
        // Enrich items with originalLocalName from visionScoutItems and preCalculatedItems if available
        if (visionScoutItems && Array.isArray(visionScoutItems)) {
          const usedIndices = new Set();
          rawFoodData.itemsBreakdown = rawFoodData.itemsBreakdown.map((item: any, idx: number) => {
            const match = matchBreakdownItemToScout(item, visionScoutItems, usedIndices);
            if (match) {
              usedIndices.add(match.scoutIndex);
              const preCalc = preCalculatedItems.find((p: any) => p.scoutIndex === match.scoutIndex);
              if (preCalc) {
                return {
                  ...item,
                  scoutIndex: item.scoutIndex !== undefined ? item.scoutIndex : match.scoutIndex,
                  originalName: match.originalName || item.originalName || item.originalLocalName || null,
                  originalLocalName: match.originalName || item.originalLocalName || null,
                  chainName: match.chainName || item.chainName || null,
                  rawNutritionLabel: match.rawNutritionLabel || item.rawNutritionLabel || null,
                  keyword: match.keyword || item.keyword || null,
                  visualIngredients: item.visualIngredients || match.visualIngredients || null,
                  cookingMethod: (match.cookingMethod && match.cookingMethod !== 'unknown') ? match.cookingMethod : (item.cookingMethod || null),
                  components: item.components || match.components || null,
                  dbId: preCalc.bestMatchDbId || item.dbId || null,
                  dbSource: preCalc.bestMatchDbSource || item.dbSource || 'estimated',
                  hasComponents: Boolean(preCalc.hasComponents),
                  primaryBase100g: preCalc.primaryBase100g || null,
                  primaryBaseMatchName: preCalc.primaryBaseMatchName || null,
                  primaryBaseWeightG: preCalc.primaryBaseWeightG || item.weightGrams,
                  componentsDetailList: preCalc.componentsDetailList || [],
                  cookingAdded: preCalc.cookingAdded || { addedCalories: 0, addedFat: 0, addedSaturatedFat: 0, addedSodium: 0 },
                  truthNutrients: preCalc.truthNutrients || {},
                  lockedNutrientKeys: preCalc.lockedNutrientKeys || [],
                  ingredientsList: preCalc.ingredientsList || item.ingredientsList || match.ingredientsList || null,
                  labelNutrientsPerServing: preCalc.labelNutrientsPerServing || preCalc.primaryBase100g || item.labelNutrientsPerServing || null
                };
              }
              return {
                ...item,
                scoutIndex: item.scoutIndex !== undefined ? item.scoutIndex : match.scoutIndex,
                originalName: match.originalName || item.originalName || item.originalLocalName || null,
                originalLocalName: match.originalName || item.originalLocalName || null,
                chainName: match.chainName || item.chainName || null,
                rawNutritionLabel: match.rawNutritionLabel || item.rawNutritionLabel || null,
                keyword: match.keyword || item.keyword || null,
                visualIngredients: item.visualIngredients || match.visualIngredients || null,
                cookingMethod: (match.cookingMethod && match.cookingMethod !== 'unknown') ? match.cookingMethod : (item.cookingMethod || null),
                components: item.components || match.components || null
              };
            }
            return {
              ...item,
              scoutIndex: item.scoutIndex !== undefined ? item.scoutIndex : idx
            };
          });

          // Reconcile missing visionScoutItems that the Dietitian LLM omitted
          const isLabelName = (s: string) => {
            const orig = String(s || '').toLowerCase();
            const foodKeywords = ["milk", "burger", "fries", "fry", "chicken", "fish", "beef", "fillet", "pork", "salad", "wrap", "bread", "juice", "water", "tea", "coffee", "rice", "noodle", "pasta", "pizza", "cookie", "cake", "fruit", "vegetable", "cheese", "yogurt", "egg", "soup", "stew", "pancake", "waffle", "sausage", "bacon", "steak", "tart", "pie", "donut", "doughnut", "oat", "cereal", "muffin", "soda", "coke", "drink", "beverage", "salami", "kefir"];
            if (foodKeywords.some(kw => orig.includes(kw))) return false;
            return orig.includes("nutrition fact") || 
                   orig.includes("informasi nilai gizi") || 
                   orig.includes("komposisi") || 
                   orig.includes("nutrition label") || 
                   orig.includes("back of package") || 
                   orig.includes("printed_packaging_label") ||
                   orig === "label";
          };

          if (!originalModeIsModify) {
            visionScoutItems.forEach((sItem: any) => {
              const sIndex = sItem.scoutIndex;
              if (sIndex !== undefined && sIndex !== null && !usedIndices.has(sIndex)) {
                if (rawFoodData.itemsBreakdown.some((it: any) => it.scoutIndex !== undefined && Number(it.scoutIndex) === Number(sIndex))) {
                  return;
                }
                if (breakdownAlreadyHasScoutName(rawFoodData.itemsBreakdown, sItem)) {
                  return;
                }
                if (!isLabelName(sItem.originalName || sItem.keyword || '')) {
                  const preCalc = preCalculatedItems ? preCalculatedItems.find((p: any) => p.scoutIndex === sIndex) : null;
                  if (preCalc) {
                    addDebugLog(`[Scout Reconcile] Adding omitted Vision Scout item "${sItem.originalName || sItem.keyword}" (scoutIndex=${sIndex}) back to itemsBreakdown.`);
                    usedIndices.add(sIndex);
                    rawFoodData.itemsBreakdown.push({
                      scoutIndex: sIndex,
                      canonicalDbName: sItem.originalName || sItem.keyword || "Food Item",
                      originalName: sItem.originalName || sItem.keyword || "Food Item",
                      originalLocalName: sItem.originalName || null,
                      keyword: sItem.keyword || null,
                      weightGrams: preCalc.primaryBaseWeightG || sItem.estimatedWeightGrams || 100,
                      dbId: preCalc.bestMatchDbId,
                      dbSource: preCalc.bestMatchDbSource,
                      hasComponents: Boolean(preCalc.hasComponents),
                      primaryBase100g: preCalc.primaryBase100g || null,
                      primaryBaseMatchName: preCalc.primaryBaseMatchName || null,
                      primaryBaseWeightG: preCalc.primaryBaseWeightG || sItem.estimatedWeightGrams || 100,
                      componentsDetailList: preCalc.componentsDetailList || [],
                      cookingAdded: preCalc.cookingAdded || { addedCalories: 0, addedFat: 0, addedSaturatedFat: 0, addedSodium: 0 },
                      truthNutrients: preCalc.truthNutrients || {},
                      lockedNutrientKeys: preCalc.lockedNutrientKeys || [],
                      ingredientsList: preCalc.ingredientsList || sItem.ingredientsList || null,
                      labelNutrientsPerServing: preCalc.primaryBase100g || null,
                      cookingMethod: (sItem.cookingMethod && sItem.cookingMethod !== 'unknown') ? sItem.cookingMethod : 'raw',
                      components: sItem.components || null,
                      rawNutritionLabel: sItem.rawNutritionLabel || null
                    });
                  }
                }
              }
            });
          }
        }

        

        if (rawFoodData.itemsBreakdown && Array.isArray(rawFoodData.itemsBreakdown)) {
          rawFoodData.itemsBreakdown.forEach((item: any) => {
            item.diningEnvironment = diningEnvironment;
          });
        }

        if (preCalculatedItems && Array.isArray(preCalculatedItems) && preCalculatedItems.length > 0) {
          rawFoodData.itemsBreakdown = rawFoodData.itemsBreakdown.map((item: any, idx: number) => {
            let preMatch = preCalculatedItems.find((p: any) => {
              if (item.scoutIndex !== undefined && item.scoutIndex !== null && p.scoutIndex !== undefined && p.scoutIndex !== null) {
                return item.scoutIndex === p.scoutIndex;
              }
              const itemLower = (item.canonicalDbName || item.name || "").trim().toLowerCase();
              const pOrigLower = (p.originalName || "").trim().toLowerCase();
              const pKwLower = (p.keyword || "").trim().toLowerCase();
              if (!itemLower) return false;
              if (itemLower === pOrigLower || itemLower === pKwLower) {
                return true;
              }
              if (scoutItemMatchesBreakdownName(p, itemLower) || namesReferToSameFood(itemLower, pOrigLower) || namesReferToSameFood(itemLower, pKwLower)) {
                return true;
              }
              return false;
            });
            if (!preMatch && item.scoutIndex === undefined) {
              preMatch = preCalculatedItems.find((p: any) =>
                scoutItemMatchesBreakdownName(p, item.canonicalDbName || item.name) ||
                namesReferToSameFood(item.canonicalDbName || item.name, p.originalName || p.keyword)
              ) || null;
            }
            if (preMatch) {
              const itemLower = (item.canonicalDbName || item.name || "").trim().toLowerCase();
              const pOrigLower = (preMatch.originalName || "").trim().toLowerCase();
              const pKwLower = (preMatch.keyword || "").trim().toLowerCase();
              const hasKeywordMatch = itemLower.includes(pOrigLower) || itemLower.includes(pKwLower) || pOrigLower.includes(itemLower) || pKwLower.includes(itemLower);
              const stripPunctForTokens = (s: string) => s.replace(/[^a-z0-9\s]/g, ' ');
              const itemTokens = stripPunctForTokens(itemLower).split(/\s+/).filter((t: string) => t.length > 2);
              const pTokens = stripPunctForTokens(pOrigLower + " " + pKwLower).split(/\s+/).filter((t: string) => t.length > 2);
              const hasExplicitScoutIndexMatch = item.scoutIndex !== undefined && item.scoutIndex !== null && preMatch.scoutIndex !== undefined && item.scoutIndex === preMatch.scoutIndex;
              const stem = (w: string) => w.replace(/(es|s)$/, '');
              const itemStemmed = itemTokens.map(stem);
              const pStemmed = pTokens.map(stem);
              const hasStemOverlap = itemStemmed.some((t: string) => pStemmed.includes(t)) ||
                itemTokens.some((t1: string) => pTokens.some((t2: string) => (t1.length >= 4 && t2.length >= 4 && (t1.startsWith(t2) || t2.startsWith(t1)))));
              const hasTokenOverlap = itemTokens.some((t: string) => pTokens.includes(t)) || hasStemOverlap;
              const matchesSemantics = scoutItemMatchesBreakdownName(preMatch, itemLower) || namesReferToSameFood(itemLower, pOrigLower) || namesReferToSameFood(itemLower, pKwLower);
              
              if (!hasKeywordMatch && !hasTokenOverlap && !matchesSemantics && itemLower && (pOrigLower || pKwLower)) {
                if (!hasExplicitScoutIndexMatch) {
                  addDebugLog(`[First-Principles Injection] Anomaly: index=no but names "${itemLower}" vs "${pOrigLower || pKwLower}" do not match. Aborting cross-wired injection.`);
                  preMatch = null;
                } else {
                  addDebugLog(`[First-Principles Injection] Multilingual/scoutIndex match preserved for "${itemLower}" vs "${pOrigLower || pKwLower}".`);
                }
              }
            }

            if (preMatch && preMatch.nutrients && item.weightGrams > 0 && (isDishEstimateEnabled(req) || preMatch.hasComponents || preMatch.bestMatchDbId)) {
              if (!isDishEstimateEnabled(req) && !preMatch.hasComponents && item.dbId && String(item.dbId) !== String(preMatch.bestMatchDbId)) {
                // Dietitian picked a DIFFERENT database ID for a single-ingredient item. Do NOT inject preMatch nutrients, let the backend calculate from the LLM's chosen ID.
                return item;
              }
              const weight = item.weightGrams;
              const originalBasisWeight = Number(preMatch.estimatedWeightGrams || preMatch.weightGrams || preMatch.nutrientBasisWeight || weight);
              const weightScaleFactor = (originalBasisWeight > 0 && Math.abs(weight - originalBasisWeight) > 0.01)
                ? (weight / originalBasisWeight)
                : 1.0;

              const n = { ...preMatch.nutrients };
              if (weightScaleFactor !== 1.0) {
                NUTRIENT_KEYS.forEach(k => {
                  if (n[k] !== undefined && n[k] !== null && Number.isFinite(Number(n[k]))) {
                    n[k] = Number(((Number(n[k])) * weightScaleFactor).toFixed(2));
                  }
                });
              }

              if (item.correctedNutrients && typeof item.correctedNutrients === 'object') {
                Object.entries(item.correctedNutrients).forEach(([k, v]) => {
                  if (v !== null && v !== undefined && Number.isFinite(Number(v))) {
                    n[k] = Number(v);
                  }
                });
                // Pure TS rebalancing: recalculates Calories (4P+4C+9F), Unsat Fat, Salt, and density bounds
                const rebalanced = rebalanceNutrientProfile(n, weight);
                Object.assign(n, rebalanced);

                if (item.clinicalCorrectionNote) {
                  addDebugLog(`[Dietitian Clinical Correction] "${item.canonicalDbName || item.name}": ${item.clinicalCorrectionNote}`);
                }
              }
              const scale = 100 / weight;

              const injectedLabel: Record<string, number> = { servingSizeGrams: 100 };
              NUTRIENT_KEYS.forEach(k => {
                injectedLabel[k] = parseFloat(((n[k] || 0) * scale).toFixed(2));
              });

              const effectiveTruthNutrients = (item.correctedNutrients && typeof item.correctedNutrients === 'object')
                ? { ...(preMatch.truthNutrients || {}), ...n }
                : (preMatch.truthNutrients || n || {});

              addDebugLog(`[First-Principles Injection] Injecting deterministic backend nutrients for "${item.canonicalDbName || item.name}" (scoutIndex=${preMatch.scoutIndex}, dbSource=${preMatch.bestMatchDbSource}, dbId=${preMatch.bestMatchDbId}).`);

              return {
                ...item,
                visualIngredients: item.visualIngredients || preMatch.visualIngredients || null,
                cookingMethod: (preMatch.cookingMethod && preMatch.cookingMethod !== 'unknown') ? preMatch.cookingMethod : (item.cookingMethod || null),
                components: item.components || preMatch.components || null,
                syntheticBase100g: injectedLabel,
                labelNutrientsPerServing: preMatch.labelNutrientsPerServing || preMatch.primaryBase100g || injectedLabel,
                primaryBase100g: preMatch.primaryBase100g || injectedLabel,
                primaryBaseMatchName: preMatch.primaryBaseMatchName || item.canonicalDbName || item.name,
                primaryBaseWeightG: preMatch.primaryBaseWeightG || item.weightGrams,
                hasComponents: Boolean(preMatch.hasComponents),
                componentsDetailList: preMatch.componentsDetailList || [],
                cookingAdded: preMatch.cookingAdded || { addedCalories: 0, addedFat: 0, addedSaturatedFat: 0, addedSodium: 0 },
                truthNutrients: effectiveTruthNutrients,
                lockedNutrientKeys: preMatch.lockedNutrientKeys || [],
                ingredientsList: preMatch.ingredientsList || item.ingredientsList || null,
                clinicalCorrectionNote: item.clinicalCorrectionNote || null,
                dbSource: preMatch.dbSource || preMatch.bestMatchDbSource || item.dbSource || "estimated",
                dbId: preMatch.dbId || preMatch.bestMatchDbId || item.dbId || null
              };
            }
            return item;
          });
        }

        // Deduplicate LLM generated itemsBreakdown to prevent duplicate macro explosion.
        // NOTE: identical name+weight items are legitimate (e.g. "2 pieces of the same candy"),
        // so we only treat an entry as a true duplicate if it also shares the same scoutIndex
        // as an entry already kept. Items with no scoutIndex fall back to array position so
        // they are never collapsed together.
        if (rawFoodData.itemsBreakdown && Array.isArray(rawFoodData.itemsBreakdown)) {
          const uniqueItems: any[] = [];
          const seen = new Set();
          rawFoodData.itemsBreakdown.forEach((item: any, idx: number) => {
            const canonicalLower = (item.canonicalDbName || item.name || "").trim().toLowerCase();
            const weight = item.weightGrams || 0;
            const scoutKeyPart = (item.scoutIndex !== undefined && item.scoutIndex !== null) ? `scout_${item.scoutIndex}` : "";
            const key = `${canonicalLower}_${weight}_${scoutKeyPart}`;
            if (!seen.has(key)) {
              seen.add(key);
              uniqueItems.push(item);
            } else {
              addDebugLog(`[Deduplication] Removed duplicate item "${canonicalLower}" (${weight}g) generated by Dietitian LLM.`);
            }
          });
          rawFoodData.itemsBreakdown = uniqueItems;
        }

        const { nutrients, itemsBreakdown } = aggregateItemsNutrients(
          rawFoodData.itemsBreakdown,
          totalWeightGrams,
          dbMatchMap,
          databaseMatchesArray,
          addDebugLog
        );
        parsedData.nutrients = nutrients;
        
        // Synchronize narrative text before emitting dietitian_answer so streamed/logged advice matches deterministic nutrient totals
        if (parsedData.nutrients && (userSelectedMode === 'review' || userSelectedMode === 'edit' || !userSelectedMode)) {
          if (rawParsed && rawParsed.message) {
            rawParsed.message = synchronizeNarrativeText(
              rawParsed.message,
              nutrients.calories,
              nutrients.protein,
              nutrients.totalFat,
              nutrients.saturatedFat,
              nutrients.sodium,
              nutrients.carbohydrates,
              nutrients.fiber
            );
          }
          parsedData.message = rawParsed.message;
        }

        sendLog('dietitian_answer', 'dietitian', rawParsed?.message || 'Dietitian generated clinical advice.', {
          mode: rawParsed?.mode
        });
        
        // Overwrite itemsBreakdown with guaranteed backend dbSource and dbId (Bug 3)
        parsedData.itemsBreakdown = itemsBreakdown.map((item: any, idx: number) => {
          let preMatch = preCalculatedItems.find((p: any) => {
            if (item.scoutIndex !== undefined && item.scoutIndex !== null && p.scoutIndex !== undefined && p.scoutIndex !== null) {
              return item.scoutIndex === p.scoutIndex;
            }
            const itemLower = (item.canonicalDbName || item.name || "").trim().toLowerCase();
            const pOrigLower = (p.originalName || "").trim().toLowerCase();
            const pKwLower = (p.keyword || "").trim().toLowerCase();
            if (!itemLower) return false;
            if (itemLower === pOrigLower || itemLower === pKwLower) {
              return true;
            }
            if (scoutItemMatchesBreakdownName(p, itemLower) || namesReferToSameFood(itemLower, pOrigLower) || namesReferToSameFood(itemLower, pKwLower)) {
              return true;
            }
            return false;
          });
          if (!preMatch && item.scoutIndex === undefined) {
             // Name only — never array position (4106 phantom).
             preMatch = preCalculatedItems.find((p: any) =>
               scoutItemMatchesBreakdownName(p, item.canonicalDbName || item.name) ||
               namesReferToSameFood(item.canonicalDbName || item.name, p.originalName || p.keyword)
             ) || null;
          }
          if (preMatch) {
            const itemLower = (item.canonicalDbName || item.name || "").trim().toLowerCase();
            const pOrigLower = (preMatch.originalName || "").trim().toLowerCase();
            const pKwLower = (preMatch.keyword || "").trim().toLowerCase();
            const hasKeywordMatch = itemLower.includes(pOrigLower) || itemLower.includes(pKwLower) || pOrigLower.includes(itemLower) || pKwLower.includes(itemLower);
            const stripPunctForTokens = (s: string) => s.replace(/[^a-z0-9\s]/g, ' ');
            const itemTokens = stripPunctForTokens(itemLower).split(/\s+/).filter((t: string) => t.length > 2);
            const pTokens = stripPunctForTokens(pOrigLower + " " + pKwLower).split(/\s+/).filter((t: string) => t.length > 2);
            const hasTokenOverlap = itemTokens.some((t: string) => pTokens.includes(t));
            const matchesSemantics = scoutItemMatchesBreakdownName(preMatch, itemLower) || namesReferToSameFood(itemLower, pOrigLower) || namesReferToSameFood(itemLower, pKwLower);
            const hasExplicitScoutIndexMatch = item.scoutIndex !== undefined && item.scoutIndex !== null && preMatch.scoutIndex !== undefined && item.scoutIndex === preMatch.scoutIndex;
            
            if (!hasKeywordMatch && !hasTokenOverlap && !matchesSemantics && itemLower && (pOrigLower || pKwLower) && !hasExplicitScoutIndexMatch) {
               preMatch = null;
            }
          }

          const rawItem = rawFoodData.itemsBreakdown?.[idx] || {};

          // Reconcile item nutrients: prefer preMatch nutrients if available, or item/rawItem nutrients
          const baseNutrients = item.nutrients || rawItem.nutrients || {};
          const preNutrients = preMatch?.nutrients || {};
          const finalItemNutrients: Record<string, number> = {};
          
          NUTRIENT_KEYS.forEach((k: string) => {
            const preVal = preNutrients[k] !== undefined && preNutrients[k] !== null ? Number(preNutrients[k]) : 0;
            const baseVal = baseNutrients[k] !== undefined && baseNutrients[k] !== null ? Number(baseNutrients[k]) : 0;
            if (baseVal <= 0 && preVal > 0) {
              finalItemNutrients[k] = preVal;
            } else {
              finalItemNutrients[k] = baseVal > 0 ? baseVal : preVal;
            }
          });

          const isSingleStapleFinal = SINGLE_STAPLE_RE.test(item.originalName || item.keyword || rawItem?.originalName || '');
          const isMultiCompFinal = !isSingleStapleFinal && Boolean(
            (preMatch && preMatch.hasComponents) ||
            item.hasComponents ||
            (Array.isArray(preMatch?.componentsDetailList) && preMatch.componentsDetailList.length >= 2) ||
            (Array.isArray(item.componentsDetailList) && item.componentsDetailList.length >= 2) ||
            // Single genuine resolved component: componentsDetailList already IS the
            // primary (pushed at cIdx===0 in the per-component resolution loop). Only
            // fires when item.components had real entries — never for the sauce-injection
            // fallback path, which starts from an empty item.components/componentsDetailList.
            (Array.isArray(item.components) && item.components.length >= 1 &&
             Array.isArray(item.componentsDetailList) && item.componentsDetailList.length >= 1)
          );
          const subCompsList = preMatch?.componentsDetailList || item.componentsDetailList || [];
          const allSubCompsShareBrand = isMultiCompFinal && subCompsList.length > 0 && subCompsList.every((c: any) => c.brand && c.brand.toLowerCase() === subCompsList[0].brand?.toLowerCase());
          const finalParentBrand = allSubCompsShareBrand ? (subCompsList[0].brand || null) : (isMultiCompFinal ? null : (item.brand || preMatch?.brand || null));
          const finalParentChain = allSubCompsShareBrand ? (subCompsList[0].chainName || null) : (isMultiCompFinal ? null : (item.chainName || preMatch?.chainName || null));
          const finalParentDbSource = isMultiCompFinal ? "composite" : ((preMatch && preMatch.dbSource) || item.dbSource || "estimated");
          const finalParentDbId = isMultiCompFinal ? (preMatch?.dbId || `composite_${idx}`) : ((preMatch && preMatch.dbId) || item.dbId || null);

          let finalOriginalName = preMatch?.originalName || item.originalName || rawItem.originalName || null;
          let finalCanonicalDbName = (isMultiCompFinal && preMatch?.originalName) ? preMatch.originalName : (item.canonicalDbName || preMatch?.primaryBaseMatchName || preMatch?.canonicalDbName || item.name);
          const finalVisualIngredients = (Array.isArray(preMatch?.visualIngredients) && preMatch.visualIngredients.length > 0)
            ? preMatch.visualIngredients
            : (Array.isArray(item.visualIngredients) && item.visualIngredients.length > 0 ? item.visualIngredients : (rawItem.visualIngredients || null));
          const finalIngredientsList = preMatch?.ingredientsList || (Array.isArray(preMatch?.ingredients) && preMatch.ingredients.length > 0 ? preMatch.ingredients.join(', ') : (item.ingredientsList || rawItem.ingredientsList || null));

          return {
            ...rawItem,
            ...item,
            nutrients: finalItemNutrients,
            chainName: finalParentChain,
            brand: finalParentBrand,
            rawNutritionLabel: item.rawNutritionLabel || preMatch?.rawNutritionLabel || rawItem.rawNutritionLabel || (item.primaryBase100g ? {
              servingSize: "100g",
              basisType: "per_100g",
              calories: `${item.primaryBase100g.calories} kcal`,
              protein: `${item.primaryBase100g.protein || 0}g`,
              totalFat: `${item.primaryBase100g.totalFat || 0}g`,
              saturatedFat: `${item.primaryBase100g.saturatedFat || 0}g`,
              totalCarbohydrate: `${item.primaryBase100g.carbohydrates || 0}g`,
              sodium: `${item.primaryBase100g.sodium || 0}mg`,
              // Not a genuine photographed/OCR'd label — computed from an internal DB match.
              // Flag it so the frontend never shows the "Verified from printed label" badge for it.
              _synthetic: true
            } : (finalItemNutrients.calories > 0 ? {
              servingSize: "100g",
              basisType: "per_100g",
              calories: `${Math.round(finalItemNutrients.calories / ((item.weightGrams || 100) / 100))} kcal`,
              protein: `${parseFloat(((finalItemNutrients.protein || 0) / ((item.weightGrams || 100) / 100)).toFixed(1))}g`,
              totalFat: `${parseFloat(((finalItemNutrients.totalFat || 0) / ((item.weightGrams || 100) / 100)).toFixed(1))}g`,
              saturatedFat: `${parseFloat(((finalItemNutrients.saturatedFat || 0) / ((item.weightGrams || 100) / 100)).toFixed(1))}g`,
              totalCarbohydrate: `${parseFloat(((finalItemNutrients.carbohydrates || 0) / ((item.weightGrams || 100) / 100)).toFixed(1))}g`,
              sodium: `${Math.round((finalItemNutrients.sodium || 0) / ((item.weightGrams || 100) / 100))}mg`,
              // Backed out from our own computed totals, not a genuine printed label — flag as synthetic.
              _synthetic: true
            } : null)),
            originalName: finalOriginalName,
            canonicalDbName: finalCanonicalDbName,
            keyword: item.keyword || preMatch?.keyword || rawItem.keyword || null,
            visualIngredients: finalVisualIngredients,
            components: item.components || rawItem.components || preMatch?.components || null,
            dbSource: finalParentDbSource,
            dbId: finalParentDbId,
            hasComponents: isMultiCompFinal,
            primaryBase100g: preMatch?.primaryBase100g || item.primaryBase100g || null,
            primaryBaseMatchName: finalCanonicalDbName || preMatch?.primaryBaseMatchName || item.primaryBaseMatchName || null,
            primaryBaseWeightG: preMatch?.primaryBaseWeightG || item.weightGrams,
            componentsDetailList: preMatch?.componentsDetailList || item.componentsDetailList || [],
            compositeSiblings: preMatch?.compositeSiblings || preMatch?.componentsDetailList || item.compositeSiblings || item.componentsDetailList || [],
            cookingAdded: preMatch?.cookingAdded || { calories: 0, fat: 0, satFat: 0, sodium: 0 },
            truthNutrients: item.truthNutrients || preMatch?.truthNutrients || {},
            lockedNutrientKeys: item.lockedNutrientKeys || preMatch?.lockedNutrientKeys || [],
            ingredientsList: finalIngredientsList,
            boundingBox2D: item.boundingBox2D || preMatch?.boundingBox2D || rawItem.boundingBox2D || null,
            sourceImageIndex: typeof item.sourceImageIndex === "number" ? item.sourceImageIndex : (typeof preMatch?.sourceImageIndex === "number" ? preMatch.sourceImageIndex : (typeof rawItem.sourceImageIndex === "number" ? rawItem.sourceImageIndex : 0)),
          };
        });

        // Re-aggregate grand totals from final itemsBreakdown to ensure meal-level consistency
        const grandTotals: Record<string, number> = {};
        NUTRIENT_KEYS.forEach((k: string) => { grandTotals[k] = 0; });
        parsedData.itemsBreakdown.forEach((it: any) => {
          if (it.nutrients) {
            addDebugLog(`[Nutrient Final Check] "${it.canonicalDbName || it.name}" finalItemNutrients: ${JSON.stringify(it.nutrients)}`);
            NUTRIENT_KEYS.forEach((k: string) => {
              grandTotals[k] = Math.round(((grandTotals[k] || 0) + (Number(it.nutrients[k]) || 0)) * 10) / 10;
            });
          }
        });
        parsedData.nutrients = grandTotals;

        // Always synchronize narrative text with final grand totals across all narrative fields
        if (parsedData.nutrients) {
          const finalCal = parsedData.nutrients.calories || 0;
          const finalP = parsedData.nutrients.protein || 0;
          const finalFat = parsedData.nutrients.totalFat || 0;
          const finalSatFat = parsedData.nutrients.saturatedFat || 0;
          const finalNa = parsedData.nutrients.sodium || 0;
          const finalCarbs = parsedData.nutrients.carbohydrates || 0;
          const finalFiber = parsedData.nutrients.totalFibre ?? parsedData.nutrients.fiber ?? 0;

          if (parsedData.message) {
            parsedData.message = synchronizeNarrativeText(parsedData.message, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs, finalFiber);
          }
          if (rawParsed && rawParsed.message) {
            rawParsed.message = synchronizeNarrativeText(rawParsed.message, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs, finalFiber);
          }
          if (rawParsed && rawParsed._internalReasoning) {
            rawParsed._internalReasoning = synchronizeNarrativeText(rawParsed._internalReasoning, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs, finalFiber);
          }
          if (parsedData.benefits) {
            parsedData.benefits = synchronizeNarrativeText(parsedData.benefits, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs, finalFiber);
          }
          if (parsedData.risks) {
            parsedData.risks = synchronizeNarrativeText(parsedData.risks, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs, finalFiber);
          }
          if (parsedData.healthImpact) {
            parsedData.healthImpact = synchronizeNarrativeText(parsedData.healthImpact, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs, finalFiber);
          }
          if (parsedData.recommendation) {
            parsedData.recommendation = synchronizeNarrativeText(parsedData.recommendation, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs, finalFiber);
          }
        }

        // Fire-and-forget: register any new chain menu dishes in the background. Never blocks or fails the request.
        try {
          const { autoRegisterChainMenuItem } = await import('./serverBrandMenu.js');
          const { supabaseAdmin } = await import('./supabaseAdmin.js');
          const countryCodeForRegister = userProfile?.country || userProfile?.countryCode || 'GB';
          for (const registerItem of parsedData.itemsBreakdown || []) {
            const scoutMatch = Array.isArray(visionScoutItems)
              ? visionScoutItems.find(
                  (s: any) =>
                    (registerItem.scoutIndex !== undefined &&
                      s.scoutIndex !== undefined &&
                      Number(s.scoutIndex) === Number(registerItem.scoutIndex)) ||
                    (registerItem.keyword &&
                      s.keyword &&
                      String(s.keyword).toLowerCase() === String(registerItem.keyword).toLowerCase())
                )
              : null;

            const enriched = {
              ...registerItem,
              source: registerItem.source || scoutMatch?.source || null,
              hasComponents: registerItem.hasComponents !== undefined ? registerItem.hasComponents : scoutMatch?.hasComponents,
              components: registerItem.components || scoutMatch?.components || null,
              chainName: registerItem.chainName || scoutMatch?.chainName || null,
              originalName:
                registerItem.originalName ||
                registerItem.originalLocalName ||
                scoutMatch?.originalName ||
                registerItem.name,
              rawNutritionLabel:
                registerItem.rawNutritionLabel || scoutMatch?.rawNutritionLabel || null,
              ingredientsList:
                registerItem.ingredientsList || scoutMatch?.ingredientsList || null,
              lockedNutrientKeys:
                registerItem.lockedNutrientKeys || scoutMatch?.lockedNutrientKeys || null,
              estimatedWeightGrams:
                registerItem.weightGrams ||
                registerItem.estimatedWeightGrams ||
                scoutMatch?.estimatedWeightGrams ||
                null,
            };

            autoRegisterChainMenuItem(
              supabaseAdmin,
              enriched,
              countryCodeForRegister,
              addDebugLog
            ).catch((e: any) => {
              addDebugLog(`[AutoChainRegister] background failure: ${e?.message || e}`);
            });
          }
        } catch (e: any) {
          addDebugLog(`[AutoChainRegister] setup failed: ${e?.message || e}`);
        }

        const safeNum = (val: any) => {
          const n = Number(val);
          return (isNaN(n) || n < 0) ? 0 : n;
        };

        const fVal = (val: any, unit: string = '', isPlus: boolean = false) => {
          if (val === null || val === undefined) return `0${unit}`;
          const num = typeof val === 'number' ? val : parseFloat(val);
          if (isNaN(num) || Math.abs(num) < 0.05) return `0${unit}`;
          const rounded = Math.round(num * 10) / 10;
          if (rounded === 0) return `0${unit}`;
          const prefix = (isPlus && rounded > 0) ? '+' : '';
          return `${prefix}${rounded}${unit}`;
        };

        // Construct 5-Column Clean First-Principles Ledger Table
        let receiptTable = "### 🧾 Nutrition calculation\n\n";
        receiptTable += "| Item / Ingredient | Kcal | Protein | Sat Fat | Sodium |\n";
        receiptTable += "|---|---|---|---|---|\n";

        const formatDbLinks = (str: string): string => {
          if (!str) return str;
          let result = str.replace(/(?<!\[)\bUSDA\s*#(\d+)\b(?!\))/gi, '[USDA #$1](https://fdc.nal.usda.gov/food-details/$1/nutrients)');
          result = result.replace(/(?<!\[)\bOFF\s*#(\d+)\b(?!\))/gi, '[OFF #$1](https://world.openfoodfacts.org/product/$1)');
          return result;
        };

        let grandCal = 0;
        let grandP = 0;
        let grandSatFat = 0;
        let grandNa = 0;
        let grandFat = 0;
        let grandCarbs = 0;
        let grandWeight = 0;

        parsedData.itemsBreakdown.forEach((it: any, idx: number) => {
          if (!it || typeof it !== 'object') return;
          const originalItemCal = safeNum(it.calories);
          const originalItemP = safeNum(it.protein);
          const originalItemSatFat = safeNum(it.saturatedFat);
          const originalItemNa = safeNum(it.sodium);
          const itemWeightG = safeNum(it.weightGrams) || 100;

          const badge = it.dbSource === 'estimated_override' 
            ? ` ⚠️ [SANITY CHECK OVERRIDE: ${it.overrideReason || 'Adjusted Value'}]`
            : (it.isUnverified ? " ⚠️ (Est)" : "");

          let visualBreakdownStr = "";
          if (it.visualIngredients && Array.isArray(it.visualIngredients) && it.visualIngredients.length > 0) {
            visualBreakdownStr = ` (${it.visualIngredients.join(', ')})`;
          } else if (it.components && Array.isArray(it.components) && it.components.length > 0) {
            visualBreakdownStr = ` (${it.components.map((c: any) => typeof c === 'string' ? c : c.searchQuery || c.name || c.keyword).join(', ')})`;
          }

          const physicalFormObj = it.physicalFormClassification || classifyUniversalPhysicalFormV3({
            name: it.originalName || it.originalLocalName || it.keyword || it.name || it.canonicalDbName,
            canonicalDbName: it.canonicalDbName || it.name,
            originalLocalName: it.originalLocalName || it.originalName,
            keyword: it.keyword || it.name,
            visualIngredients: it.visualIngredients,
            components: it.components
          });

          const pfType = physicalFormObj.physicalForm || 'UNKNOWN';
          const pfTokensArr = Array.from(new Set(
            (Array.isArray(physicalFormObj.matchedTokens) ? physicalFormObj.matchedTokens : [String(physicalFormObj.matchedTokens || '')])
              .map((t: any) => String(t).trim().toLowerCase())
          )).filter(Boolean);
          const pfTokens = pfTokensArr.length > 0 ? pfTokensArr.join(', ') : 'none';
          const baseMatchType = it.matchReasonInfo?.matchType || (it.dbSource === 'usda' ? 'USDA FDC Entry' : it.dbSource === 'off' ? 'Open Food Facts Entry' : it.dbSource === 'backend_calculated' || it.dbSource === 'canonical' ? 'Canonical Reference' : 'Universal Nutrient Estimator');
          const rawDbId = it.dbId ? String(it.dbId).replace(/^canonical_/i, '') : '';
          const matchTypeStr = (it.dbId ? `Canonical_${rawDbId}` : baseMatchType).replace(/[\[\]|\n]/g, "");
          
          const dishTitle = (
            it.originalName ||
            it.originalLocalName ||
            it.keyword ||
            it.name ||
            it.canonicalDbName ||
            ""
          )
            .replace(/[\[\]|\n"']/g, "")
            .trim();
          const itemNameClean = dishTitle;

          const pfTooltip = `classification: ${pfType} ;; '${itemNameClean}' ;; Matched Keywords: ${pfTokens} ;; ${matchTypeStr}`;
          const pfIcon = ` [ℹ️](#info "${pfTooltip}")`;

          // Row 1: Main Item Header Row with total weight
          receiptTable += `| **${idx + 1}. ${dishTitle}**${badge}${pfIcon} - ${itemWeightG}g${visualBreakdownStr} | - | - | - | - |\n`;

          // Base Ingredient calculation
          let raw100 = { ...(it.syntheticBase100g || it.primaryBase100g || it.labelNutrientsPerServing || {}) };
          const dbMatchObj = databaseMatchesArray ? databaseMatchesArray.find((m: any) => String(m.id) === String(it.dbId)) : null;
          const isGenuineTruthSource = it.dbSource === 'label' || it.dbSource === 'brand_official';
          
          if (!isGenuineTruthSource && it.dbId && dbMatchMap && dbMatchMap.has(String(it.dbId))) {
            const mapped = dbMatchMap.get(String(it.dbId));
            if (mapped) {
               Object.keys(mapped).forEach(k => {
                 if (mapped[k] !== undefined && mapped[k] !== null) {
                   raw100[k] = mapped[k];
                 }
               });
            }
          } else if (!isGenuineTruthSource && dbMatchObj) {
            if (it.dbSource === 'usda' || it.dbSource === 'off') {
               const mapObj = {
                calories: Number(dbMatchObj.calories),
                protein: Number(dbMatchObj.protein),
                totalFat: Number(dbMatchObj.fat),
                saturatedFat: Number(dbMatchObj.saturatedFat),
                sodium: Number(dbMatchObj.sodium)
               };
               Object.keys(mapObj).forEach(k => {
                 if (!isNaN(mapObj[k])) {
                   raw100[k] = mapObj[k];
                 }
               });
            }
          }

          let baseW = it.primaryBaseWeightG || itemWeightG;
          let sauceWSum = 0;
          let scaleRatio = 1;

          if (it.componentsDetailList && it.componentsDetailList.length > 0) {
            sauceWSum = it.componentsDetailList.reduce((acc: number, s: any) => acc + (s.weightGrams || 0), 0);
          }

          // componentsDetailList already includes the primary component for multi-component
          // items — do not add primaryBaseWeightG on top of it (double-count weight).
          const primaryAlreadyInList = Boolean(it.componentsDetailList && it.componentsDetailList.length > 0);

          if (primaryAlreadyInList && sauceWSum > 0) {
             if (Math.abs(sauceWSum - itemWeightG) > 2) {
                scaleRatio = itemWeightG / sauceWSum;
             }
          } else if (it.primaryBaseWeightG) {
             const originalWeight = it.primaryBaseWeightG + sauceWSum;
             if (originalWeight > 0 && Math.abs(originalWeight - itemWeightG) > 2) {
                scaleRatio = itemWeightG / originalWeight;
                baseW = Math.round(it.primaryBaseWeightG * scaleRatio);
             }
          } else if (sauceWSum > 0) {
             if (baseW === itemWeightG && sauceWSum < itemWeightG) {
                baseW = Math.max(10, itemWeightG - sauceWSum);
             }
          }

          const base100Cal = safeNum(raw100.calories);
          const base100P = safeNum(raw100.protein);
          const base100SatFat = safeNum(raw100.saturatedFat);
          const base100Na = safeNum(raw100.sodium);

          const baseFactor = baseW / 100;

          const portionBaseCal = Math.round(base100Cal * baseFactor);
          const portionBaseP = Math.round(base100P * baseFactor * 10) / 10;
          const portionBaseSatFat = Math.round(base100SatFat * baseFactor * 10) / 10;
          const portionBaseNa = Math.round(base100Na * baseFactor);

          const dbNameStr = it.primaryBaseMatchName || (dbMatchObj && dbMatchObj.name ? dbMatchObj.name : '');
          let dbRefTag = "";
          const dbSourceUpper = String(it.dbSource || '').toUpperCase();
          const cleanItemName = dbNameStr ? dbNameStr.replace(' (Canonical Base)', '').replace(' (Estimated Component Baseline)', '') : (it.keyword || it.name || 'Ingredient');
          const isDishEstimate = Boolean(it.isDishEstimate || dbSourceUpper === 'ESTIMATED' || it.syntheticBase100g || (isDishEstimateEnabled(req) && it.dbSource === "estimated"));
          // Prefer printed/brand truth for receipt attribution. Never let a name-token
          // canonical match (e.g. "blueberry" → raw blueberries FDC) hijack a LABEL row,
          // and never link an estimated dish to USDA.
          const canonicalBase = (dbSourceUpper === 'LABEL' || dbSourceUpper === 'BRAND_OFFICIAL' || isDishEstimate)
            ? null
            : lookupCanonicalBaseFood(dbNameStr || it.keyword || it.name);
          const realFdcId = (canonicalBase && canonicalBase.fdcId) ? canonicalBase.fdcId : ((dbSourceUpper === 'USDA' || dbSourceUpper === 'INTERNAL_CATALOG' || dbSourceUpper === 'USUAL_CATALOG') && it.dbId && !String(it.dbId).startsWith('canonical_') && !String(it.dbId).startsWith('printed_') && !String(it.dbId).startsWith('fallback_') && !isNaN(Number(it.dbId)) ? it.dbId : null);

          if (dbSourceUpper === 'LABEL' || String(it.dbId || '').startsWith('printed_packaging_label')) {
            dbRefTag = `Printed Packaging Label (${cleanItemName})`;
          } else if (dbSourceUpper === 'BRAND_OFFICIAL') {
            dbRefTag = `Official Brand/Menu Data (${cleanItemName})`;
          } else if (canonicalBase && canonicalBase.fdcId && !String(canonicalBase.fdcId).startsWith('canonical_') && !isNaN(Number(canonicalBase.fdcId))) {
            dbRefTag = `📖 [${cleanItemName}](https://fdc.nal.usda.gov/fdc-app.html#/food-details/${canonicalBase.fdcId}/nutrients)`;
          } else if (canonicalBase) {
            dbRefTag = `📖 ${cleanItemName}`;
          } else if (realFdcId && !String(realFdcId).startsWith('canonical_') && !isNaN(Number(realFdcId))) {
            dbRefTag = `[USDA #${realFdcId}](https://fdc.nal.usda.gov/fdc-app.html#/food-details/${realFdcId}/nutrients) (${cleanItemName})`;
          } else if (dbSourceUpper === 'OFF' && it.dbId) {
            dbRefTag = `[OFF #${it.dbId}](https://world.openfoodfacts.org/product/${it.dbId}) (${cleanItemName})`;
          } else if (dbSourceUpper === 'CATEGORY_FALLBACK' || dbSourceUpper === 'FALLBACK_ESTIMATED' || String(it.dbId || '').startsWith('fallback_')) {
            dbRefTag = `Estimated: ${cleanItemName} (category fallback)`;
          } else {
            dbRefTag = `Estimated ${cleanItemName}`;
          }
          dbRefTag = formatDbLinks(dbRefTag);

          // Row 2: Primary Base Ingredient (if not a multi-component assembly)
          // Mirror D1/D2: list already includes primary when multi-component (hasComponents
          // OR ≥2 detail rows). Never print primary on top of that list.
          const listIsMulti =
            Boolean(it.hasComponents) ||
            (Array.isArray(it.componentsDetailList) && it.componentsDetailList.length >= 2);
          if (!listIsMulti) {
            receiptTable += `| ${dbRefTag} - ${baseW}g | ${fVal(portionBaseCal)} | ${fVal(portionBaseP, 'g')} | ${fVal(portionBaseSatFat, 'g')} | ${fVal(portionBaseNa, 'mg')} |\n`;
          }

          // Row 3: Sauce / Dressing / Sub-components (if any)
          addDebugLog(`[Receipt Diagnostic] item="${cleanItemName}" dbSource="${it.dbSource}" hasComponents=${Boolean(it.hasComponents)} componentsDetailList.length=${Array.isArray(it.componentsDetailList) ? it.componentsDetailList.length : 'undefined'} components.length=${Array.isArray(it.components) ? it.components.length : 'undefined'} listIsMulti=${listIsMulti}`);
          if (listIsMulti && it.componentsDetailList && Array.isArray(it.componentsDetailList) && it.componentsDetailList.length > 0) {
            if (listIsMulti) {
               const rowsSummary = it.componentsDetailList.map((s: any) => `${s.name || 'unnamed'}(id=${s.dbId || 'n/a'},cal=${s.calories || 0})`).join(', ');
               addDebugLog(`[Receipt] using preCalc multi-row n=${it.componentsDetailList.length} for "${cleanItemName}": ${rowsSummary}`);
            }
            it.componentsDetailList.forEach((s: any) => {
              const sW = Math.round((s.weightGrams || 0) * scaleRatio);
              const sCal = Math.round((s.calories || 0) * scaleRatio);
              const sP = Math.round((s.protein || 0) * scaleRatio * 10) / 10;
              const sNa = Math.round((s.sodium || 0) * scaleRatio);
              const sSatFat = Math.round((s.saturatedFat !== undefined ? s.saturatedFat : 0.3) * scaleRatio * 10) / 10;
              receiptTable += `| ${formatDbLinks(s.name)} - ${sW}g | ${fVal(sCal)} | ${fVal(sP, 'g')} | ${fVal(sSatFat, 'g')} | ${fVal(sNa, 'mg')} |\n`;
            });
          }

          // Row 4: Thermodynamic Physics Engine
          let rawMethod = (it.cookingMethod && it.cookingMethod !== 'unknown') ? it.cookingMethod : null;
          const kwLower = (it.keyword || it.name || it.canonicalDbName || "").toLowerCase();
          const isPackagedCondiment = Boolean(kwLower.match(/\b(margarine|butter|spread|jam|jelly|ketchup|mayo|mayonnaise|dressing tub|dip)\b/i));
          const isBeverage = BEVERAGE_RAW_PATTERN.test(kwLower) || BEVERAGE_RAW_PATTERN.test(it.canonicalDbName || "") || BEVERAGE_RAW_PATTERN.test(it.name || "");
          const isCandyOrDessertNoHeat = physicalFormObj.primaryCategory === 'bakery_dessert';
          if (isPackagedCondiment || isBeverage || isCandyOrDessertNoHeat) {
            rawMethod = 'raw';
          } else if (!rawMethod) {
            if (kwLower.includes('wedge') || kwLower.includes('fries') || kwLower.includes('chip') || kwLower.includes('nugget')) {
              rawMethod = 'deep_fried';
            } else if (kwLower.includes('corn') || kwLower.includes('pea') || kwLower.includes('carrot') || kwLower.includes('broccoli') || kwLower.includes('steamed') || kwLower.includes('boiled')) {
              rawMethod = 'boiled';
            } else {
              rawMethod = 'pan_fried';
            }
          }
          const cookingMethodFormatted = rawMethod.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());

          const SAUCE_KEYWORD_PATTERN = /\b(sauce|dressing|marinade|gravy|glaze|mayo|mayonnaise|vinaigrette|dip|condiment)\b/i;
          const hasActualSauceInDetails = Boolean(
            it.componentsDetailList &&
            Array.isArray(it.componentsDetailList) &&
            it.componentsDetailList.length > 0 &&
            it.componentsDetailList.some((s: any) => (s.sodium || 0) > 0 && SAUCE_KEYWORD_PATTERN.test(s.name || ''))
          );
          const hasSauceOrDressingReceipt = hasActualSauceInDetails;

          const dishIdentityReceipt =
            it.originalName || it.originalLocalName || it.keyword || it.name || it.canonicalDbName || "";
          const baseIngredientNameForPrepCheck = dbNameStr || it.keyword || it.name;
          const isAlreadyPreparedReceipt = 
            Boolean(it.hasLockedTruth || it.isDishEstimate || it.syntheticBase100g || (isDishEstimateEnabled(req) && it.dbSource === "estimated")) ||
            checkIfItemIsAlreadyPrepared(
              baseIngredientNameForPrepCheck,
              baseIngredientNameForPrepCheck,
              it.dbSource,
              base100Na
            );

          const lockedTruthReceipt = Boolean(
            it.dbSource === "label" ||
            it.dbSource === "brand_official" ||
            (Array.isArray(it.lockedNutrientKeys) &&
              it.lockedNutrientKeys.length > 0 &&
              (it.dbSource === "label" || it.dbSource === "brand_official"))
          );

          const prepReceipt =
            isPackagedCondiment || isBeverage
              ? { addedCalories: 0, addedFat: 0, addedSaturatedFat: 0, addedSodium: 0, reason: "packaged_beverage_or_raw" }
              : decidePrepAddition({
                  weightGrams: itemWeightG,
                  cookingMethod: rawMethod,
                  physicalForm: physicalFormObj.physicalForm,
                  dishName: dishIdentityReceipt,
                  keyword: it.keyword,
                  canonicalDbName: it.canonicalDbName || dbNameStr,
                  foodType: it.foodType,
                  componentCount: Array.isArray(it.components) ? it.components.length : 0,
                  hasLockedTruth: lockedTruthReceipt,
                  isAlreadyPrepared: isAlreadyPreparedReceipt,
                  cookingAdded: it.cookingAdded || null,
                  userText: typeof message === "string" ? message : null,
                  diningEnvironment,
                  hasSauceOrDressing: hasSauceOrDressingReceipt,
                  visualSheen: 0.5,
                  visualCoating: 0.5,
                  dbSource: it.dbSource,
                });

          let cookingCal = prepReceipt.addedCalories;
          let cookingFat = prepReceipt.addedFat;
          let cookingSatFat = prepReceipt.addedSaturatedFat;
          let cookingNa = prepReceipt.addedSodium;

          addDebugLog(
            `[PrepPolicy:receipt] "${dishIdentityReceipt}" reason=${prepReceipt.reason || "n/a"} cal=${cookingCal}`
          );
          addDebugLog(
            `[Airline Multiplier Diagnostic] item="${it.canonicalDbName || it.name}" diningEnvironment="${diningEnvironment}" hasCookingAdded=${Boolean(it.cookingAdded)} cookingNa=${cookingNa}`
          );

          let physicsEngineLabel = "No Preparation Change";
          if (rawMethod === 'raw') {
            physicsEngineLabel = "Raw / Uncooked";
          } else if (rawMethod === 'pan_fried') {
            physicsEngineLabel = "Pan-Seared Oil & Seasoning";
          } else if (rawMethod === 'deep_fried') {
            physicsEngineLabel = "Deep-Fry 10% Lipid Retention";
          } else if (rawMethod === 'stir_fried') {
            physicsEngineLabel = "Stir-Fry Surface Lipid Retention";
          } else if (rawMethod === 'roasted') {
            physicsEngineLabel = "Oven Roast Heat & Seasoning";
          } else if (rawMethod === 'baked') {
            physicsEngineLabel = "Oven Bake & Seasoning";
          } else if (rawMethod === 'boiled' || rawMethod === 'steamed') {
            physicsEngineLabel = "Boiled/Steamed - Zero Added Oil";
          } else if (rawMethod === 'grilled') {
            physicsEngineLabel = "Char-Grill & Seasoning";
          } else {
            physicsEngineLabel = cookingMethodFormatted;
          }

          if (cookingCal === 0 && cookingFat === 0 && cookingSatFat === 0 && cookingNa === 0) {
            physicsEngineLabel = rawMethod === 'raw' ? "Raw (no added oil/salt)" : "Standard Preparation (already in matched product)";
          }

          let infoTooltip = "";
          if (rawMethod === 'raw') {
            infoTooltip = `Fresh uncooked / raw item with zero thermal preparation fat and zero added seasoning salt.`;
          } else if (isAlreadyPreparedReceipt) {
            infoTooltip = `The matched database item already accounts for preparation fat and seasoning salt, so zero additional values were added to prevent double counting.`;
          } else if (hasActualSauceInDetails) {
            infoTooltip = `Thermal prep for ${rawMethod.replace(/_/g, ' ')} (+${cookingCal} kcal) and a reduced surface seasoning salt amount (+${cookingNa}mg sodium), since the attached sauce/dressing already contributes most of this dish's sodium.`;
          } else if (rawMethod === 'pan_fried') {
            infoTooltip = `Restaurant pan-searing uses cooking fat/butter (+${cookingCal} kcal) and a surface salt pinch (+${cookingNa}mg sodium) to develop a savory crust on the ${itemWeightG}g portion.`;
          } else if (rawMethod === 'deep_fried') {
            infoTooltip = `Deep-frying causes oil absorption (~10% lipid retention, +${cookingCal} kcal) and post-fry salting (+${cookingNa}mg sodium) on the ${itemWeightG}g portion.`;
          } else if (rawMethod === 'stir_fried') {
            infoTooltip = `Stir-frying coats ingredients in cooking oil (+${cookingCal} kcal) and seasoning salt (+${cookingNa}mg sodium).`;
          } else if (rawMethod === 'roasted') {
            infoTooltip = `Oven roasting uses surface oil coating (+${cookingCal} kcal) and roasting salt (+${cookingNa}mg sodium) for browning.`;
          } else if (rawMethod === 'baked') {
            infoTooltip = `Baking includes surface oil/butter brushings (+${cookingCal} kcal) and salt seasoning (+${cookingNa}mg sodium).`;
          } else if (rawMethod === 'boiled' || rawMethod === 'steamed') {
            infoTooltip = `Boiling/steaming uses water heat with zero added fats, plus light blanching salt (+${cookingNa}mg sodium).`;
          } else if (rawMethod === 'grilled') {
            infoTooltip = `Char-grilling uses fat brushing for grate release (+${cookingCal} kcal) and dry-rub seasoning salt (+${cookingNa}mg sodium).`;
          } else {
            infoTooltip = `Preparation model for ${cookingMethodFormatted} adds cooking fats (+${cookingCal} kcal) and surface seasoning salt (+${cookingNa}mg sodium) for a ${itemWeightG}g portion.`;
          }

          if (diningEnvironment === 'airline' && (!isAlreadyPreparedReceipt && cookingNa > 0)) {
            infoTooltip += ` Includes 1.5x sodium multiplier for airline dining environment.`;
          }

          if (it.foodType === 'ultra_processed') {
            physicsEngineLabel = "Ultra-Processed Food";
            infoTooltip = "This item is classified as ultra-processed. Caloric density and macronutrients are derived directly from matched printed labels or known manufacturer data.";
          }

          const isZeroCookingAddition = (cookingCal === 0 && cookingFat === 0 && cookingSatFat === 0 && cookingNa === 0);

          // Only output a preparation physics row if there are actual non-zero thermal cooking/salting additions
          if (!isZeroCookingAddition) {
            receiptTable += `| ${physicsEngineLabel} [ℹ️](#info "${infoTooltip}") | ${fVal(cookingCal, '', true)} | ${fVal(0, 'g', true)} | ${fVal(cookingSatFat, 'g', true)} | ${fVal(cookingNa, 'mg', true)} |\n`;
          }

          // 1. Calculate base ingredient nutrients for summation
          const base100Fat = safeNum(raw100.totalFat);
          const base100Carbs = safeNum(raw100.carbohydrates);
          const portionBaseFat = Math.round(base100Fat * baseFactor * 10) / 10;
          const portionBaseCarbs = Math.round(base100Carbs * baseFactor * 10) / 10;

          // Deterministic Component Row Summation
          // If componentsDetailList already contains the primary component
          // (multi-component items), do NOT also seed from portionBase* —
          // that is the same ingredient and would double-count it.
          const sumFromListOnly = Boolean(it.hasComponents) ||
            (it.componentsDetailList && it.componentsDetailList.length >= 2);

          let sumCal = sumFromListOnly ? 0 : portionBaseCal;
          let sumP = sumFromListOnly ? 0 : portionBaseP;
          let sumFat = sumFromListOnly ? 0 : portionBaseFat;
          let sumSatFat = sumFromListOnly ? 0 : portionBaseSatFat;
          let sumNa = sumFromListOnly ? 0 : portionBaseNa;
          let sumCarbs = sumFromListOnly ? 0 : portionBaseCarbs;

          // Plus components / sauces:
          if (it.componentsDetailList && Array.isArray(it.componentsDetailList) && it.componentsDetailList.length > 0) {
            const targetKcal = Number(it.truthNutrients?.calories ?? it.calories);
            if (targetKcal > 0) {
              const rawCompSum = it.componentsDetailList.reduce((acc: number, c: any) => acc + (Number(c.calories) || 0), 0);
              if (rawCompSum > 0 && Math.abs(rawCompSum * scaleRatio - targetKcal) > 1) {
                const cScale = targetKcal / (rawCompSum * scaleRatio);
                it.componentsDetailList.forEach((s: any) => {
                  if (!s || typeof s !== 'object') return;
                  if (s.calories != null) s.calories = Math.round(s.calories * cScale * 10) / 10;
                  if (s.protein != null) s.protein = Math.round(s.protein * cScale * 10) / 10;
                  if (s.totalFat != null) s.totalFat = Math.round(s.totalFat * cScale * 10) / 10;
                  if (s.saturatedFat != null) s.saturatedFat = Math.round(s.saturatedFat * cScale * 10) / 10;
                  if (s.sodium != null) s.sodium = Math.round(s.sodium * cScale * 10) / 10;
                });
              }
            }
            const targetSodium = Number(it.truthNutrients?.sodium ?? it.sodium ?? 0);
            if (targetSodium > 0) {
              const rawSodiumSum = it.componentsDetailList.reduce((acc: number, c: any) => acc + (Number(c.sodium) || 0), 0);
              if (rawSodiumSum === 0) {
                const compCount = it.componentsDetailList.length;
                it.componentsDetailList.forEach((s: any) => {
                  if (s && typeof s === 'object') {
                    s.sodium = Math.round(targetSodium / compCount);
                  }
                });
              } else if (Math.abs(rawSodiumSum * scaleRatio - targetSodium) > 5) {
                const sScale = targetSodium / (rawSodiumSum * scaleRatio);
                it.componentsDetailList.forEach((s: any) => {
                  if (s && typeof s === 'object' && s.sodium != null) {
                    s.sodium = Math.round(s.sodium * sScale * 10) / 10;
                  }
                });
              }
            }
            it.componentsDetailList.forEach((s: any) => {
              const sCal = Math.round((s.calories || 0) * scaleRatio);
              const sP = Math.round((s.protein || 0) * scaleRatio * 10) / 10;
              const sF = Math.round((s.totalFat || 0) * scaleRatio * 10) / 10;
              const sSatFat = Math.round((s.saturatedFat !== undefined ? s.saturatedFat : 0.3) * scaleRatio * 10) / 10;
              const sNa = Math.round((s.sodium || 0) * scaleRatio);
              const sCarbs = Math.round((s.carbohydrates || 0) * scaleRatio * 10) / 10;

              sumCal += sCal;
              sumP += sP;
              sumFat += sF;
              sumSatFat += sSatFat;
              sumNa += sNa;
              sumCarbs += sCarbs;
            });
          }

          // Plus cooking method additions:
          sumCal += cookingCal;
          sumFat += cookingFat;
          sumSatFat += cookingSatFat;
          sumNa += cookingNa;

          // Clean rounding for the floats
          sumP = Math.round(sumP * 10) / 10;
          sumFat = Math.round(sumFat * 10) / 10;
          sumSatFat = Math.round(sumSatFat * 10) / 10;
          sumCarbs = Math.round(sumCarbs * 10) / 10;

          // Apply the same reality check used in the pre-calculation pass so the
          // ledger/saved totals never exceed physiologically realistic levels.
          // Same provenance rule as the pre-calc pass: partial-backfill items still get checked.
          const receiptHasBackfilledFields = Array.isArray((it.primaryBase100g as any)?._estimatedFields) && (it.primaryBase100g as any)._estimatedFields.length > 0;
          const receiptEffectiveDbSource = receiptHasBackfilledFields ? "label_partial" : (it.dbSource || it.source);
          const receiptRealityCheckNutrients: Record<string, number> = { calories: sumCal, protein: sumP, totalFat: sumFat, saturatedFat: sumSatFat, sodium: sumNa, carbohydrates: sumCarbs };
          const isCompositeReceipt =
            (Array.isArray(it.components) && it.components.length >= 2) ||
            physicalFormObj?.physicalForm === "COMPOUND_MEAL" ||
            /\b(bowl|poke|salad|bento)\b/i.test(String(it.originalName || it.keyword || it.name || ""));

          applyNutrientRealityChecks(
            it.originalName || it.keyword || it.name,
            itemWeightG,
            receiptRealityCheckNutrients,
            cookingNa,
            addDebugLog,
            receiptEffectiveDbSource,
            {
              originalName: it.originalName || it.originalLocalName || it.keyword,
              keyword: it.keyword,
              componentCount: Array.isArray(it.components) ? it.components.length : 0,
              physicalForm: physicalFormObj?.physicalForm,
              chainName: it.chainName || null,
              syntheticBase100g: it.syntheticBase100g,
              isDishEstimate: isDishEstimateEnabled(req),
            }
          );
          
          // Re-apply truth locks and reality-check corrections via pure helper
          const ledgerTruth = it.truthNutrients || {};
          const itemLockedKeysSet = new Set<string>(it.lockedNutrientKeys || Object.keys(ledgerTruth));
          const postReconcileResult = applyPostReconcileTruthLocks({
            sumNutrients: { calories: sumCal, protein: sumP, totalFat: sumFat, saturatedFat: sumSatFat, sodium: sumNa, carbohydrates: sumCarbs },
            ledgerTruth,
            lockedNutrientKeys: it.lockedNutrientKeys,
            receiptRealityCheckNutrients,
            isCompositeReceipt
          });

          if (postReconcileResult.appliedDensityCorrection) {
            addDebugLog(`[LedgerInvariant] applied density correction for composite "${dishTitle}": adjusted calories from row-sum to ${postReconcileResult.nutrients.calories}`);
          }
          if (postReconcileResult.appliedSodiumRealityCheck) {
            addDebugLog(`[LedgerInvariant] applied sodium reality-check override for composite "${dishTitle}": adjusted sodium from row-sum to ${postReconcileResult.nutrients.sodium}`);
          }
          if (!postReconcileResult.appliedDensityCorrection && !postReconcileResult.appliedSodiumRealityCheck && isCompositeReceipt) {
            addDebugLog(`[LedgerInvariant] composite "${dishTitle}": using row-sum totals, reality-check mutations ignored`);
          }

          const itemCal = postReconcileResult.nutrients.calories;
          const itemP = postReconcileResult.nutrients.protein;
          const itemFat = postReconcileResult.nutrients.totalFat;
          const itemSatFat = postReconcileResult.nutrients.saturatedFat;
          const itemNa = postReconcileResult.nutrients.sodium;
          const itemCarbs = postReconcileResult.nutrients.carbohydrates;

          // Overwrite it properties to guarantee downstream consistency
          it.calories = itemCal;
          it.protein = itemP;
          it.totalFat = itemFat;
          it.saturatedFat = itemSatFat;
          it.sodium = itemNa;
          it.carbohydrates = itemCarbs;

          // Assert and log loud console error if mismatch (for UNLOCKED nutrients only)
          const diffCal = itemLockedKeysSet.has('calories') ? 0 : Math.abs(originalItemCal - itemCal);
          const diffP = itemLockedKeysSet.has('protein') ? 0 : Math.abs(originalItemP - itemP);
          const diffSatFat = itemLockedKeysSet.has('saturatedFat') ? 0 : Math.abs(originalItemSatFat - itemSatFat);
          const diffNa = itemLockedKeysSet.has('sodium') ? 0 : Math.abs(originalItemNa - itemNa);

          if (it.clinicalCorrectionNote) {
            receiptTable += `| *Dietitian clinical correction — ${it.clinicalCorrectionNote}* | ${fVal(itemCal)} | ${fVal(itemP, 'g')} | ${fVal(itemSatFat, 'g')} | ${fVal(itemNa, 'mg')} |\n`;
          } else if (diffCal > 1.1 || diffP > 0.15 || diffSatFat > 0.15 || diffNa > 1.1) {
            addDebugLog(`[Math Integrity Check] Item "${it.originalName || it.name}" subtotal updated from initial baseline Cal=${originalItemCal} → ${itemCal}`);
          }

          // Row 5: Item Sub-Total
          receiptTable += `| **Item Sub-Total - ${itemWeightG}g** | **${fVal(itemCal)}** | **${fVal(itemP, 'g')}** | **${fVal(itemSatFat, 'g')}** | **${fVal(itemNa, 'mg')}** |\n`;

          grandCal += itemCal;
          grandP += itemP;
          grandFat += itemFat;
          grandSatFat += itemSatFat;
          grandNa += itemNa;
          grandCarbs += itemCarbs;
          grandWeight += itemWeightG;

          // Stream incremental vertical table live to client during loading
          sendStreamEvent({ type: 'stream', stage: 'dietitian', thought: receiptTable });
        });

        // DIVERGING NUTRIENTS FIX (Aug 2026): The receipt table loop computes its own grand totals 
        // with independent rounding, which historically overwrote the deterministic first-pass 
        // `parsedData.nutrients` that the Dietitian already saw. We now safely discard the 
        // receipt-table's diverging `grand*` variables at the end, and strictly reuse the 
        // pre-existing `parsedData.nutrients` for the final UI table and narrative synchronization.
        const finalCal = parsedData.nutrients?.calories ?? grandCal;
        const finalP = parsedData.nutrients?.protein ?? grandP;
        const finalFat = parsedData.nutrients?.totalFat ?? grandFat;
        const finalSatFat = parsedData.nutrients?.saturatedFat ?? grandSatFat;
        const finalNa = parsedData.nutrients?.sodium ?? grandNa;
        const finalCarbs = parsedData.nutrients?.carbohydrates ?? grandCarbs;
        const finalFiber = parsedData.nutrients?.totalFibre ?? parsedData.nutrients?.fiber ?? 0;

        receiptTable += `| **🏆 GRAND MEAL TOTAL - ${grandWeight}g** | **${fVal(finalCal)}** | **${fVal(finalP, 'g')}** | **${fVal(finalSatFat, 'g')}** | **${fVal(finalNa, 'mg')}** |\n`;

        parsedData.receiptTable = receiptTable;

        // Keep receiptTable separate from _internalReasoning so it renders full width in the UI
        // We still stream it as 'thought' for live updates, but the final state will separate it.

        // GUARANTEED ZERO-DISCREPANCY SYNCHRONIZATION ACROSS ALL NARRATIVE FIELDS:
        // Critical Guard: Only synchronize narrative text for single-item meals to prevent grand total overwriting multi-item stats
        if (parsedData.nutrients && parsedData.itemsBreakdown && (userSelectedMode === 'review' || userSelectedMode === 'edit' || !userSelectedMode)) {
          if (rawParsed.message) {
            rawParsed.message = synchronizeNarrativeText(rawParsed.message, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs, finalFiber);
          }
          if (rawParsed._internalReasoning) {
            rawParsed._internalReasoning = synchronizeNarrativeText(rawParsed._internalReasoning, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs, finalFiber);
          }
          parsedData.message = rawParsed.message;
          if (rawParsed.foodData) {
            if (rawParsed.foodData.benefits) {
              rawParsed.foodData.benefits = synchronizeNarrativeText(rawParsed.foodData.benefits, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs, finalFiber);
            }
            if (rawParsed.foodData.risks) {
              rawParsed.foodData.risks = synchronizeNarrativeText(rawParsed.foodData.risks, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs, finalFiber);
            }
            if (rawParsed.foodData.healthImpact) {
              rawParsed.foodData.healthImpact = synchronizeNarrativeText(rawParsed.foodData.healthImpact, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs, finalFiber);
            }
            if (rawParsed.foodData.recommendation) {
              rawParsed.foodData.recommendation = synchronizeNarrativeText(rawParsed.foodData.recommendation, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs, finalFiber);
            }
          }
          if (parsedData) {
            if (parsedData.benefits) {
              parsedData.benefits = synchronizeNarrativeText(parsedData.benefits, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs, finalFiber);
            }
            if (parsedData.risks) {
              parsedData.risks = synchronizeNarrativeText(parsedData.risks, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs, finalFiber);
            }
            if (parsedData.healthImpact) {
              parsedData.healthImpact = synchronizeNarrativeText(parsedData.healthImpact, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs, finalFiber);
            }
            if (parsedData.recommendation) {
              parsedData.recommendation = synchronizeNarrativeText(parsedData.recommendation, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs, finalFiber);
            }
          }
        }
      } else {
        addDebugLog(`[Nutrient Warning] LLM returned no itemsBreakdown for "${parsedData.name}". All nutrients will be zero. Check LLM prompt compliance.`);
        parsedData.nutrients = {};
        for (const key of NUTRIENT_KEYS) {
          parsedData.nutrients[key] = 0;
        }
        parsedData.itemsBreakdown = [{
          name: parsedData.name,
          weightGrams: totalWeightGrams,
          calories: 0, saturatedFat: 0, sodium: 0,
          dbSource: "estimated", dbId: null
        }];
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

        return res.json({
          mode: "modify",
          dietitianScratchpad: rawParsed._internalReasoning,
          text: rawParsed.message || `I have updated your meal to reflect the correction.`,
          message: rawParsed.message || `I have updated your meal to reflect the correction.`,
          data: parsedData,
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
        savable: true,
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
        addDebugLog(`[Modify Math Error] No active meal exists in Firestore to modify.`);
        return res.json({
          text: rawParsed.message || "I couldn't modify the meal because there's no active meal currently logged. Please log a meal first!",
          message: rawParsed.message || "I couldn't modify the meal because there's no active meal currently logged. Please log a meal first!",
          data: null,
          apiCalls
        });
      }

      let commands = rawParsed.editCommands || rawParsed.modificationCommand || rawParsed.data?.editCommands || rawParsed.data?.modificationCommand || rawParsed.agentResult?.modificationCommand;
      if (!commands || !Array.isArray(commands) || commands.length === 0) {
        // Fallback: If Dietitian returned foodData.itemsBreakdown or itemsBreakdown in rawParsed or data, synthesize commands comparing against activeMeal
        const dietitianItems = rawParsed.foodData?.itemsBreakdown || rawParsed.itemsBreakdown || rawParsed.data?.itemsBreakdown || rawParsed.data?.foodData?.itemsBreakdown || rawParsed.pendingFoodLog?.itemsBreakdown || rawParsed.scoutItems;
        if (Array.isArray(dietitianItems) && dietitianItems.length > 0) {
          const synthesizedCommands = synthesizeEditCommandsFromBreakdown(activeMeal, dietitianItems, message || '');

          if (synthesizedCommands.length > 0) {
            addDebugLog(`[Modify Math] Synthesized ${synthesizedCommands.length} modification commands from breakdown.`);
            commands = synthesizedCommands;
          }
        }
      }

      if (!commands || !Array.isArray(commands) || commands.length === 0) {
        addDebugLog(`[Modify Math Fallback] No explicit modification command array generated; building soft-edit fallback from activeMeal.`);
        const activeItems = activeMeal.itemsBreakdown || activeMeal.items || [];
        (req as any)._editWasNoOpFallback = true;
        if (activeItems.length > 0) {
          commands = activeItems.map((it: any, idx: number) => ({
            scoutIndex: typeof it.scoutIndex === 'number' ? it.scoutIndex : idx,
            foodName: it.name || it.foodName || 'Food item',
            action: 'modify' as const,
            originalGrams: Number(it.weightGrams) || 100,
            newGrams: Number(it.weightGrams) || 100,
            multiplier: 1.0,
            reason: 'Maintained current weight'
          }));
        } else {
          return res.json({
            text: rawParsed.message || "I received a modify request but no active meal items were found to modify.",
            message: rawParsed.message || "I received a modify request but no active meal items were found to modify.",
            data: activeMeal,
            apiCalls
          });
        }
      }

      const originalItems = activeMeal.itemsBreakdown || [];
      const originalTotalWeight = originalItems.reduce((acc: number, it: any) => acc + (Number(it.weightGrams) || 0), 0) || 1;

      const standardItems: {[key: string]: {calories: number, saturatedFat: number, sodium: number, protein?: number, totalFat?: number, carbohydrates?: number, addedSugar?: number}} = {
        'beef steak': { calories: 2.1, saturatedFat: 0.035, sodium: 0.7, protein: 0.26, totalFat: 0.11, carbohydrates: 0, addedSugar: 0 },
        'steak': { calories: 2.1, saturatedFat: 0.035, sodium: 0.7, protein: 0.26, totalFat: 0.11, carbohydrates: 0, addedSugar: 0 },
        'beef': { calories: 2.1, saturatedFat: 0.035, sodium: 0.7, protein: 0.26, totalFat: 0.11, carbohydrates: 0, addedSugar: 0 },
        'chicken steak': { calories: 1.8, saturatedFat: 0.015, sodium: 0.8, protein: 0.28, totalFat: 0.06, carbohydrates: 0, addedSugar: 0 },
        'fried chicken': { calories: 2.45, saturatedFat: 0.03, sodium: 3.0, protein: 0.21, totalFat: 0.14, carbohydrates: 0.08, addedSugar: 0 },
        'chicken': { calories: 1.65, saturatedFat: 0.01, sodium: 0.7, protein: 0.31, totalFat: 0.036, carbohydrates: 0, addedSugar: 0 },
        'breast': { calories: 1.65, saturatedFat: 0.01, sodium: 0.7, protein: 0.31, totalFat: 0.036, carbohydrates: 0, addedSugar: 0 },
        'pork': { calories: 2.4, saturatedFat: 0.03, sodium: 0.8, protein: 0.20, totalFat: 0.16, carbohydrates: 0, addedSugar: 0 },
        'fish': { calories: 1.5, saturatedFat: 0.01, sodium: 0.8, protein: 0.20, totalFat: 0.05, carbohydrates: 0, addedSugar: 0 },
        'salmon': { calories: 2.0, saturatedFat: 0.015, sodium: 0.5, protein: 0.22, totalFat: 0.12, carbohydrates: 0, addedSugar: 0 },
        'rice': { calories: 1.3, saturatedFat: 0.0, sodium: 0.01, protein: 0.027, totalFat: 0.003, carbohydrates: 0.28, addedSugar: 0 },
        'broccoli': { calories: 0.35, saturatedFat: 0.0, sodium: 0.3, protein: 0.028, totalFat: 0.004, carbohydrates: 0.07, addedSugar: 0 },
        'egg': { calories: 1.5, saturatedFat: 0.03, sodium: 1.4, protein: 0.126, totalFat: 0.095, carbohydrates: 0.007, addedSugar: 0 },
        'avocado': { calories: 1.6, saturatedFat: 0.02, sodium: 0.07, protein: 0.02, totalFat: 0.15, carbohydrates: 0.09, addedSugar: 0 },
        'bread': { calories: 2.6, saturatedFat: 0.005, sodium: 4.8, protein: 0.09, totalFat: 0.03, carbohydrates: 0.49, addedSugar: 0.05 },
        'butter': { calories: 7.1, saturatedFat: 5.1, sodium: 5.7, protein: 0.009, totalFat: 0.81, carbohydrates: 0.001, addedSugar: 0 },
        'cheese': { calories: 4.0, saturatedFat: 1.8, sodium: 6.2, protein: 0.25, totalFat: 0.33, carbohydrates: 0.01, addedSugar: 0 },
        'salad': { calories: 0.2, saturatedFat: 0.0, sodium: 0.1, protein: 0.01, totalFat: 0.002, carbohydrates: 0.03, addedSugar: 0 },
        'tomato': { calories: 0.18, saturatedFat: 0.0, sodium: 0.05, protein: 0.009, totalFat: 0.002, carbohydrates: 0.039, addedSugar: 0 },
        'oil': { calories: 8.8, saturatedFat: 1.4, sodium: 0.0, protein: 0, totalFat: 1.0, carbohydrates: 0, addedSugar: 0 },
        'potato wedges': { calories: 1.3, saturatedFat: 0.004, sodium: 1.5, protein: 0.02, totalFat: 0.02, carbohydrates: 0.25, addedSugar: 0 },
        'potato': { calories: 0.8, saturatedFat: 0.0, sodium: 0.05, protein: 0.02, totalFat: 0.001, carbohydrates: 0.17, addedSugar: 0 },
        'pasta': { calories: 1.3, saturatedFat: 0.0, sodium: 0.01, protein: 0.05, totalFat: 0.01, carbohydrates: 0.25, addedSugar: 0 },
        'mixed vegetables': { calories: 0.8, saturatedFat: 0.001, sodium: 0.3, protein: 0.03, totalFat: 0.005, carbohydrates: 0.15, addedSugar: 0 },
        'vegetable': { calories: 0.5, saturatedFat: 0.001, sodium: 0.2, protein: 0.02, totalFat: 0.003, carbohydrates: 0.10, addedSugar: 0 },
        'mayonnaise': { calories: 6.8, saturatedFat: 0.11, sodium: 6.0, protein: 0.01, totalFat: 0.75, carbohydrates: 0.01, addedSugar: 0 },
        'iced tea': { calories: 0.28, saturatedFat: 0, sodium: 0.04, protein: 0, totalFat: 0, carbohydrates: 0.07, addedSugar: 0.06 },
        'sweet tea': { calories: 0.36, saturatedFat: 0, sodium: 0.04, protein: 0, totalFat: 0, carbohydrates: 0.09, addedSugar: 0.08 },
        'tea': { calories: 0.28, saturatedFat: 0, sodium: 0.04, protein: 0, totalFat: 0, carbohydrates: 0.07, addedSugar: 0.06 },
        'otak-otak': { calories: 1.6, saturatedFat: 0.015, sodium: 3.5, protein: 0.11, totalFat: 0.04, carbohydrates: 0.18, addedSugar: 0 },
        'otak otak': { calories: 1.6, saturatedFat: 0.015, sodium: 3.5, protein: 0.11, totalFat: 0.04, carbohydrates: 0.18, addedSugar: 0 }
      };

      const findItemIndex = (itemNameStr: string, targetDbId: string | null): number => {
        return findItemIndexInList(activeMeal.itemsBreakdown, itemNameStr, targetDbId);
      };

      const isWholeMealMatch = (name: string) => {
        const nLower = name.trim().toLowerCase();
        const mealNameLower = (activeMeal.name || "").trim().toLowerCase();
        return nLower === mealNameLower || 
               nLower === "meal" || 
               nLower === "total" || 
               nLower === "all" ||
               (mealNameLower.includes(nLower) && (activeMeal.itemsBreakdown || []).every((it: any) => (it.name || "").toLowerCase() !== nLower));
      };

      for (const cmd of commands) {
        const action = cmd.action;
        const itemName = cmd.itemName || "";
        const targetDbId = cmd.targetDbId ? String(cmd.targetDbId).replace(/[^\x20-\x7E]/g, '').trim() : null;
        let newWeight = sanitizeMealWeight(cmd.newWeightGrams, 0);

        if (action === "update_weight") {
          if (newWeight <= 0) {
            const msgLower = (message || "").toLowerCase();
            if (msgLower.includes("whole") || msgLower.includes("entire") || msgLower.includes("pack") || msgLower.includes("all")) {
              const itemToUpdate = activeMeal.itemsBreakdown?.find((it: any) => it.name.toLowerCase().includes(itemName.toLowerCase())) || activeMeal.itemsBreakdown?.[0];
              const curW = itemToUpdate ? (Number(itemToUpdate.weightGrams) || 160) : 160;
              newWeight = curW * 2;
            } else {
              newWeight = originalTotalWeight;
            }
          }

          if (isWholeMealMatch(itemName)) {
            const originalItems = activeMeal.itemsBreakdown || [];
            const oldTotalWeight = originalItems.reduce((acc: number, it: any) => acc + (Number(it.weightGrams) || 0), 0) || 1;
            const R = newWeight / oldTotalWeight;
            
            activeMeal.itemsBreakdown.forEach((item: any) => {
              if (!item || typeof item !== 'object') return;
              const oldW = Number(item.weightGrams) || 0;
              item.weightGrams = Math.round(oldW * R);
              item.calories = Number(((item.calories || 0) * R).toFixed(1));
              item.protein = Number(((item.protein || 0) * R).toFixed(1));
              item.totalFat = Number(((item.totalFat || 0) * R).toFixed(1));
              item.saturatedFat = Number(((item.saturatedFat || 0) * R).toFixed(2));
              item.sodium = Number(((item.sodium || 0) * R).toFixed(1));
              item.carbohydrates = Number(((item.carbohydrates || 0) * R).toFixed(1));
            });
            
            addDebugLog(`[Modify Math] update_weight of entire meal "${activeMeal.name}" from ${oldTotalWeight}g to ${newWeight}g (ratio: ${R.toFixed(3)})`);
          } else {
            const targetDbId = cmd.targetDbId ? String(cmd.targetDbId).replace(/[^\x20-\x7E]/g, '').trim() : null;
            const idx = findItemIndex(itemName, targetDbId);
            let item = idx !== -1 ? activeMeal.itemsBreakdown[idx] : null;

            if (item) {
              const oldWeight = Math.max(1, Number(item.weightGrams) || 1);
              const R = newWeight / oldWeight;

              if (isDishEstimateEnabled()) {
                const ledger = await finalizeDishLedger({
                  item: {
                    ...item,
                    originalName: item.name || item.originalName,
                    keyword: item.keyword || item.name,
                    nutrients: item.nutrients || {
                      calories: item.calories,
                      protein: item.protein,
                      totalFat: item.totalFat,
                      saturatedFat: item.saturatedFat,
                      carbohydrates: item.carbohydrates,
                      sodium: item.sodium,
                    },
                  },
                  nutrientBasisWeight: item.nutrientBasisWeight || oldWeight,
                  consumedWeight: newWeight,
                  storedBrandLock: item.brandLock || null,
                  storedOcrLock: item.rawNutritionLabel ? {
                    basisType: item.rawNutritionLabel.basisType || 'per_dish',
                    servingGrams: item.rawNutritionLabel.servingGrams || null,
                    keys: item.lockedNutrientKeys || ['calories'],
                    valuesAtBasis: item.rawNutritionLabel,
                  } : null,
                });
                addDebugLog(`[Budget] mode=edit item="${item.name}" kcal=${ledger.nutrients.calories} source=${ledger.dbSource} weight=${newWeight}`);
                item.weightGrams = newWeight;
                item.calories = ledger.nutrients.calories;
                item.protein = ledger.nutrients.protein;
                item.totalFat = ledger.nutrients.totalFat;
                item.saturatedFat = ledger.nutrients.saturatedFat;
                item.carbohydrates = ledger.nutrients.carbohydrates;
                item.sodium = ledger.nutrients.sodium;
                if (item.nutrients) {
                  item.nutrients = { ...item.nutrients, ...ledger.nutrients };
                }
              } else {
              const foundation: Record<string, number> = {
                calories: Number(item.calories || 0) * R,
                protein: Number(item.protein || 0) * R,
                totalFat: Number(item.totalFat || item.fat || 0) * R,
                saturatedFat: Number(item.saturatedFat || 0) * R,
                carbohydrates: Number(item.carbohydrates || 0) * R,
                sodium: Number(item.sodium || 0) * R,
              };
              const priorScout = Number(item.estimatedCalories || item.scoutEstimatedCalories);
              const scoutEst = Number.isFinite(priorScout) && priorScout > 0 ? priorScout * R : null;
              const budget = computeItemBudget({
                itemName: item.name || item.originalName || itemName,
                weightGrams: newWeight,
                hardLabelKcal: item.lockedNutrientKeys?.includes?.('calories') ? Number(item.calories) * R : null,
                scoutEstimatedCalories: scoutEst,
              });
              const rec = reconcileNutrients({ nutrients: foundation, budget, formOk: true });
              addDebugLog(`[Budget] mode=edit item="${item.name}" kcal=${budget.budgetKcal} source=${budget.source} weight=${newWeight}`);
              addDebugLog(`[Reconcile] mode=edit action=${rec.action} foundation=${rec.foundationKcal} final=${rec.finalKcal}`);

              if (item) {
                item.weightGrams = newWeight;
                item.calories = Number(((rec?.nutrients?.calories ?? rec?.finalKcal) || 0).toFixed(1));
                item.protein = Number(((rec?.nutrients?.protein ?? foundation?.protein) || 0).toFixed(1));
                item.totalFat = Number(((rec?.nutrients?.totalFat ?? foundation?.totalFat) || 0).toFixed(1));
                item.saturatedFat = Number(((rec?.nutrients?.saturatedFat ?? foundation?.saturatedFat) || 0).toFixed(2));
                item.sodium = Number(((rec?.nutrients?.sodium ?? foundation?.sodium) || 0).toFixed(1));
                item.carbohydrates = Number(((rec?.nutrients?.carbohydrates ?? foundation?.carbohydrates) || 0).toFixed(1));
                if (scoutEst != null) item.estimatedCalories = scoutEst;
              }
              }

              addDebugLog(`[Modify Math] update_weight of "${item.name}" (dbId: ${item.dbId}) from ${oldWeight}g to ${newWeight}g (ratio: ${R.toFixed(3)})`);
            } else {
              addDebugLog(`[Modify Math Warning] Could not find item "${itemName}" (targetDbId: ${targetDbId}) to update_weight.`);
            }
          }
        } 
        else if (action === "remove_item") {
          const targetDbId = cmd.targetDbId ? String(cmd.targetDbId).replace(/[^\x20-\x7E]/g, '').trim() : null;
          const idx = findItemIndex(itemName, targetDbId);

          if (idx !== -1) {
            const removedItem = activeMeal.itemsBreakdown[idx];
            activeMeal.itemsBreakdown.splice(idx, 1);
            addDebugLog(`[Modify Math] remove_item: Removed "${removedItem.name}" (dbId: ${removedItem.dbId})`);
          } else {
            addDebugLog(`[Modify Math Warning] Could not find item "${itemName}" (targetDbId: ${targetDbId}) to remove.`);
          }
        } 
        else if (action === "rename_alias") {
          const targetDbId = cmd.targetDbId ? String(cmd.targetDbId).replace(/[^\x20-\x7E]/g, '').trim() : null;
          const idx = findItemIndex(itemName, targetDbId);
          if (idx !== -1) {
            const item = activeMeal.itemsBreakdown[idx];
            item.name = cmd.newItemName || item.name;
            // If it's the only item, or represents the whole meal, update the top-level name
            if (activeMeal.itemsBreakdown.length === 1 || isWholeMealMatch(itemName)) {
              activeMeal.name = item.name;
            }
            addDebugLog(`[Modify Text] rename_alias: Renamed to "${item.name}" without changing nutrients.`);
          }
        }
        else if (action === "update_cooking_method") {
          const targetDbId = cmd.targetDbId ? String(cmd.targetDbId).replace(/[^\x20-\x7E]/g, '').trim() : null;
          const idx = findItemIndex(itemName, targetDbId);
          if (idx !== -1) {
            const item = activeMeal.itemsBreakdown[idx];
            const oldMethod = item.cookingMethod || 'unknown';
            const newMethod = cmd.newCookingMethod || 'unknown';

            // Get modifiers
            const oldModifier = getCookingMethodModifier(oldMethod);
            const newModifier = getCookingMethodModifier(newMethod);

            const itemWeight = Number(item.weightGrams) || 0;
            const factor = itemWeight / 100;

            // Old added values
            const oldAddedFat = parseFloat((oldModifier.addedFatPer100g * factor).toFixed(2));
            const oldAddedSatFat = parseFloat((oldModifier.addedSaturatedFatPer100g * factor).toFixed(2));
            const oldAddedCalories = parseFloat((oldModifier.addedCaloriesPer100g * factor).toFixed(1));

            // New added values
            const newAddedFat = parseFloat((newModifier.addedFatPer100g * factor).toFixed(2));
            const newAddedSatFat = parseFloat((newModifier.addedSaturatedFatPer100g * factor).toFixed(2));
            const newAddedCalories = parseFloat((newModifier.addedCaloriesPer100g * factor).toFixed(1));

            // Adjust item nutrients
            if (item) {
              item.calories = parseFloat(Math.max(0, (item.calories || 0) - oldAddedCalories + newAddedCalories).toFixed(1));
              item.saturatedFat = parseFloat(Math.max(0, (item.saturatedFat || 0) - oldAddedSatFat + newAddedSatFat).toFixed(2));
              item.cookingMethod = newMethod;
            }

            // Also adjust top-level activeMeal.nutrients directly
            if (activeMeal.nutrients) {
              if (activeMeal.nutrients.calories !== undefined) {
                activeMeal.nutrients.calories = parseFloat(Math.max(0, activeMeal.nutrients.calories - oldAddedCalories + newAddedCalories).toFixed(1));
              }
              if (activeMeal.nutrients.totalFat !== undefined) {
                activeMeal.nutrients.totalFat = parseFloat(Math.max(0, activeMeal.nutrients.totalFat - oldAddedFat + newAddedFat).toFixed(2));
              }
              if (activeMeal.nutrients.saturatedFat !== undefined) {
                activeMeal.nutrients.saturatedFat = parseFloat(Math.max(0, activeMeal.nutrients.saturatedFat - oldAddedSatFat + newAddedSatFat).toFixed(2));
              }
              // Recalculate unsaturatedFat
              const transFat = activeMeal.nutrients.transFat || 0;
              const totalFat = activeMeal.nutrients.totalFat || 0;
              const satFat = activeMeal.nutrients.saturatedFat || 0;
              activeMeal.nutrients.unsaturatedFat = parseFloat(Math.max(0, totalFat - satFat - transFat).toFixed(2));
            }

            addDebugLog(`[Modify Math] update_cooking_method for "${item.name}": changed from "${oldMethod}" to "${newMethod}". Calorie delta: ${(newAddedCalories - oldAddedCalories).toFixed(1)} kcal, Saturated Fat delta: ${(newAddedSatFat - oldAddedSatFat).toFixed(2)}g, Total Fat delta: ${(newAddedFat - oldAddedFat).toFixed(2)}g.`);
          } else {
            addDebugLog(`[Modify Math Warning] Could not find item "${itemName}" (targetDbId: ${targetDbId}) to update_cooking_method.`);
          }
        }
        else if (action === "update_modifier") {
          const targetDbId = cmd.targetDbId ? String(cmd.targetDbId).replace(/[^\x20-\x7E]/g, '').trim() : null;
          const idx = findItemIndex(itemName, targetDbId);
          if (idx !== -1) {
            const item = activeMeal.itemsBreakdown[idx];
            const modifier = (cmd.modifier || '').toLowerCase();
            
            if (modifier.includes('unsweetened') || modifier.includes('unsweatened') || modifier.includes('no sugar') || modifier.includes('zero sugar')) {
              const sugarGrams = Number(item.sugar ?? item.nutrients?.sugar ?? item.nutrients?.addedSugar ?? item.addedSugar) || 0;
              const calDeduction = sugarGrams > 0 ? sugarGrams * 4 : 25;
              const carbDeduction = sugarGrams > 0 ? sugarGrams : 6.5;

              item.sugar = 0;
              item.addedSugar = 0;
              item.calories = Math.max(0, (Number(item.calories ?? item.nutrients?.calories) || 0) - calDeduction);
              item.carbohydrates = Math.max(0, (Number(item.carbohydrates ?? item.nutrients?.carbohydrates) || 0) - carbDeduction);
              
              if (item.nutrients) {
                item.nutrients.sugar = 0;
                item.nutrients.addedSugar = 0;
                item.nutrients.calories = item.calories;
                item.nutrients.carbohydrates = item.carbohydrates;
              }
              addDebugLog(`[Modify Math] update_modifier applied "unsweetened" to "${item.name}". Deducted ${calDeduction} kcal and ${carbDeduction}g sugar/carbs.`);
            } else if (modifier.includes('no oil') || modifier.includes('no fat')) {
              const fatGrams = Number(item.totalFat ?? item.nutrients?.totalFat ?? item.fat) || 0;
              const calDeduction = fatGrams > 0 ? fatGrams * 9 : 90;

              item.totalFat = 0;
              item.saturatedFat = 0;
              item.calories = Math.max(0, (Number(item.calories ?? item.nutrients?.calories) || 0) - calDeduction);
              if (item.nutrients) {
                item.nutrients.totalFat = 0;
                item.nutrients.saturatedFat = 0;
                item.nutrients.calories = item.calories;
              }
              addDebugLog(`[Modify Math] update_modifier applied "no oil" to "${item.name}". Deducted ${calDeduction} kcal and ${fatGrams}g fat.`);
            } else if (modifier.includes('no salt') || modifier.includes('unsalted')) {
              item.sodium = 0;
              if (item.nutrients) {
                item.nutrients.sodium = 0;
                item.nutrients.salt = 0;
              }
              addDebugLog(`[Modify Math] update_modifier applied "no salt" to "${item.name}". Set sodium to 0.`);
            }

            // Append the modifier to the name if not already there
            const modLabel = modifier.charAt(0).toUpperCase() + modifier.slice(1);
            if (!item.name.toLowerCase().includes(modifier)) {
              item.name = `${modLabel} ${item.name}`;
            }
          }
        }
        else if (action === "update_component_weight") {
          const targetDbId = cmd.targetDbId ? String(cmd.targetDbId).replace(/[^\x20-\x7E]/g, '').trim() : null;
          const idx = findItemIndex(itemName, targetDbId);
          if (idx !== -1) {
            let item = activeMeal.itemsBreakdown[idx];
            if (item.components && Array.isArray(item.components) && item.components.length > 0) {
               const compName = (cmd.componentName || '').toLowerCase();
               const compIdx = item.components.findIndex((c: any) => (c.name || '').toLowerCase().includes(compName));
               if (compIdx !== -1) {
                 const comp = item.components[compIdx];
                 const oldWeight = Number(comp.weightGrams) || 1;
                 const R = newWeight / oldWeight;
                 
                 // Update the component's weight and nutrients
                 comp.weightGrams = newWeight;
                 comp.calories = Number((Number(comp.calories || 0) * R).toFixed(1));
                 comp.protein = Number((Number(comp.protein || 0) * R).toFixed(1));
                 comp.totalFat = Number((Number(comp.totalFat || 0) * R).toFixed(1));
                 comp.saturatedFat = Number((Number(comp.saturatedFat || 0) * R).toFixed(2));
                 comp.carbohydrates = Number((Number(comp.carbohydrates || 0) * R).toFixed(1));
                 comp.sodium = Number((Number(comp.sodium || 0) * R).toFixed(1));

                 // Also update componentsDetailList which drives the true backend ledger/receipt
                 if (item.componentsDetailList && Array.isArray(item.componentsDetailList)) {
                   const detailIdx = item.componentsDetailList.findIndex((c: any) => (c.name || '').toLowerCase().includes(compName));
                   if (detailIdx !== -1) {
                     const dComp = item.componentsDetailList[detailIdx];
                     dComp.weightGrams = newWeight;
                     dComp.calories = Number((Number(dComp.calories || 0) * R).toFixed(1));
                     dComp.protein = Number((Number(dComp.protein || 0) * R).toFixed(1));
                     dComp.totalFat = Number((Number(dComp.totalFat || 0) * R).toFixed(1));
                     dComp.saturatedFat = Number((Number(dComp.saturatedFat || 0) * R).toFixed(2));
                     dComp.carbohydrates = Number((Number(dComp.carbohydrates || 0) * R).toFixed(1));
                     dComp.sodium = Number((Number(dComp.sodium || 0) * R).toFixed(1));
                     if (dComp.nutrients) {
                       dComp.nutrients.calories = dComp.calories;
                       dComp.nutrients.protein = dComp.protein;
                       dComp.nutrients.totalFat = dComp.totalFat;
                       dComp.nutrients.saturatedFat = dComp.saturatedFat;
                       dComp.nutrients.carbohydrates = dComp.carbohydrates;
                       dComp.nutrients.sodium = dComp.sodium;
                     }
                   }
                 }
                 
                 // Re-sum the parent item's totals
                 item.weightGrams = item.components.reduce((sum: number, c: any) => sum + (Number(c.weightGrams) || 0), 0);
                 item.calories = item.components.reduce((sum: number, c: any) => sum + (Number(c.calories) || 0), 0);
                 item.protein = item.components.reduce((sum: number, c: any) => sum + (Number(c.protein) || 0), 0);
                 item.totalFat = item.components.reduce((sum: number, c: any) => sum + (Number(c.totalFat) || 0), 0);
                 item.saturatedFat = item.components.reduce((sum: number, c: any) => sum + (Number(c.saturatedFat) || 0), 0);
                 item.carbohydrates = item.components.reduce((sum: number, c: any) => sum + (Number(c.carbohydrates) || 0), 0);
                 item.sodium = item.components.reduce((sum: number, c: any) => sum + (Number(c.sodium) || 0), 0);
                 
                 if (item.nutrients) {
                   item.nutrients = { ...item.nutrients, calories: item.calories, protein: item.protein, totalFat: item.totalFat, saturatedFat: item.saturatedFat, carbohydrates: item.carbohydrates, sodium: item.sodium };
                 }
                 addDebugLog(`[Modify Math] update_component_weight of "${comp.name}" inside "${item.name}" from ${oldWeight}g to ${newWeight}g. Parent is now ${item.weightGrams}g.`);
               } else {
                 addDebugLog(`[Modify Math Warning] Could not find component "${compName}" inside "${item.name}".`);
               }
            } else {
               // Fallback: If it has no components, just update the top-level item's weight
               addDebugLog(`[Modify Math Warning] Item "${item.name}" has no components. Falling back to update_weight.`);
               commands.push({ action: "update_weight", itemName: itemName, targetDbId: targetDbId, newWeightGrams: cmd.newWeightGrams });
            }
          }
        }
        else if (action === "replace_item") {
          const idx = findItemIndex(itemName, targetDbId);
          const replacementName = cmd.replacementItemName || cmd.newItemName || itemName;
          let cFactor = 1.0;
          let fFactor = 0.01;
          let sFactor = 0.5;
 
          const lowerName = replacementName.toLowerCase();
          for (const [key, factors] of Object.entries(standardItems)) {
            if (lowerName.includes(key)) {
              cFactor = factors.calories;
              fFactor = factors.saturatedFat;
              sFactor = factors.sodium;
              break;
            }
          }
 
          const newItem = {
            name: replacementName,
            canonicalDbName: replacementName,
            weightGrams: newWeight,
            calories: Number((newWeight * cFactor).toFixed(1)),
            saturatedFat: Number((newWeight * fFactor).toFixed(2)),
            sodium: Number((newWeight * sFactor).toFixed(1)),
            dbSource: "estimated",
            dbId: null
          };

          if (idx !== -1) {
            activeMeal.itemsBreakdown[idx] = newItem;
            addDebugLog(`[Modify Math] replace_item: Replaced "${itemName}" with "${replacementName}" (${newWeight}g).`);
          } else {
            if (!activeMeal.itemsBreakdown) activeMeal.itemsBreakdown = [];
            activeMeal.itemsBreakdown.push(newItem);
            addDebugLog(`[Modify Math] replace_item: Item "${itemName}" not found; appended "${replacementName}" (${newWeight}g).`);
          }
        }
        else if (action === "add_item") {
          let cFactor = 1.0;
          let fFactor = 0.01;
          let sFactor = 0.5;
          let pFactor = 0.05;
          let tfFactor = 0.04;
          let cbFactor = 0.15;
          let asFactor = 0.0;
 
          const lowerName = itemName.toLowerCase();
          for (const [key, factors] of Object.entries(standardItems)) {
            if (lowerName.includes(key)) {
              cFactor = factors.calories;
              fFactor = factors.saturatedFat;
              sFactor = factors.sodium;
              pFactor = factors.protein ?? pFactor;
              tfFactor = factors.totalFat ?? tfFactor;
              cbFactor = factors.carbohydrates ?? cbFactor;
              asFactor = factors.addedSugar ?? asFactor;
              break;
            }
          }

          const fallbackImageIdx = typeof cmd.sourceImageIndex === 'number' ? cmd.sourceImageIndex : (activeMeal.itemsBreakdown?.[0]?.sourceImageIndex ?? 0);
          const calcCalories = Number((newWeight * cFactor).toFixed(1));
          const calcProtein = Number((newWeight * pFactor).toFixed(1));
          const calcTotalFat = Number((newWeight * tfFactor).toFixed(1));
          const calcSatFat = Number((newWeight * fFactor).toFixed(2));
          const calcCarbs = Number((newWeight * cbFactor).toFixed(1));
          const calcSodium = Number((newWeight * sFactor).toFixed(1));
          const calcAddedSugar = Number((newWeight * asFactor).toFixed(1));
 
          const newItem = {
            name: itemName,
            canonicalDbName: itemName,
            weightGrams: newWeight,
            calories: calcCalories,
            protein: calcProtein,
            totalFat: calcTotalFat,
            saturatedFat: calcSatFat,
            carbohydrates: calcCarbs,
            sodium: calcSodium,
            addedSugar: calcAddedSugar,
            sourceImageIndex: fallbackImageIdx,
            nutrients: {
              calories: calcCalories,
              protein: calcProtein,
              totalFat: calcTotalFat,
              saturatedFat: calcSatFat,
              carbohydrates: calcCarbs,
              sodium: calcSodium,
              addedSugar: calcAddedSugar
            },
            dbSource: "estimated",
            dbId: null,
            scoutIndex: -1,
            componentsDetailList: [],
            components: [],
            isFlattenedComponent: true
          };

          if (!activeMeal.itemsBreakdown) activeMeal.itemsBreakdown = [];
          activeMeal.itemsBreakdown.push(newItem);
          addDebugLog(`[Modify Math] add_item: Added "${itemName}" with estimated weight ${newWeight}g.`);
        }
      }

      const newItems = activeMeal.itemsBreakdown || [];
      const newTotalWeight = newItems.reduce((acc: number, it: any) => acc + (Number(it.weightGrams) || 0), 0);
      const mealWeightRatio = newTotalWeight / originalTotalWeight;

      activeMeal.weightGrams = newTotalWeight;
      activeMeal.basis_type = 'total';
      activeMeal.serving_grams = newTotalWeight;
      if (newItems.length === 1) {
        activeMeal.name = newItems[0].name || newItems[0].canonicalDbName || 'Meal';
      } else if (newItems.length > 1 && rawParsed.foodData?.name && rawParsed.foodData.name !== 'Food Item' && !rawParsed.foodData.name.toLowerCase().includes('i only had')) {
        activeMeal.name = rawParsed.foodData.name;
      } else if (newItems.length > 1) {
        activeMeal.name = newItems.map((it: any) => it.name).join(", ");
      }
      if (activeMeal.scoutItems && Array.isArray(activeMeal.scoutItems)) {
        const currentNames = new Set(newItems.map((it: any) => (it.name || '').toLowerCase().trim()));
        activeMeal.scoutItems = activeMeal.scoutItems.filter((scout: any) => {
          const sName = String(scout.keyword || scout.originalName || scout.name || '').toLowerCase().trim();
          return Array.from(currentNames).some((cName: any) => String(cName).includes(sName) || sName.includes(String(cName)));
        });
      }
      activeMeal.composition = newItems.map((it: any) => it.name).join(", ");
      
      if (!activeMeal.nutrients) activeMeal.nutrients = {};

      const allNutrientKeys = [
        "calories", "protein", "totalFat", "saturatedFat", "transFat", "unsaturatedFat", 
        "omega3", "carbohydrates", "sugar", "addedSugar", "totalFibre", "solubleFibre", 
        "sodium", "potassium", "magnesium", "calcium", "iron", "zinc", "selenium", 
        "iodine", "phosphorus", "vitaminD", "vitaminB12", "folate", "vitaminC", 
        "vitaminE", "vitaminK", "vitaminA", "vitaminB6", "thiamine", "riboflavin", "niacin"
      ];

      for (const key of allNutrientKeys) {
        const sum = newItems.reduce((acc: number, it: any) => {
          const val = it.nutrients?.[key] ?? it[key];
          return acc + (Number(val) || 0);
        }, 0);
        const decimals = (key === 'saturatedFat' || key === 'transFat' || key === 'unsaturatedFat') ? 2 : 1;
        activeMeal.nutrients[key] = Number(sum.toFixed(decimals));
      }
      activeMeal.nutrients.salt = Number(((activeMeal.nutrients.sodium || 0) * 2.54 / 1000).toFixed(2));

      addDebugLog('[MealBuild] edit-path');
      const { mealBuild, pendingFoodLog } = attachHappyPathMealBuild({
        parsedData: activeMeal,
        jobId: req.body.jobId,
        activeMeal: req.body.activeMeal,
        diningEnvironment: activeMeal?.diningEnvironment,
      });

      mealBuild.staleDietitianNarrative = true;

      const editFailedSilently = !!(req as any)._editWasNoOpFallback;
      const honestFallbackMessage = "I wasn't able to apply that edit — could you rephrase it? For example, name the specific item and its new weight (e.g. \"beef steak 100g\").";
      const responsePayload = {
        mode: "modify",
        text: editFailedSilently ? honestFallbackMessage : (rawParsed.message || "I have recalculated your meal's metrics with precision based on your instructions."),
        message: editFailedSilently ? honestFallbackMessage : (rawParsed.message || "I have recalculated your meal's metrics with precision based on your instructions."),
        editApplied: !editFailedSilently,
        data: pendingFoodLog || activeMeal,
        mealBuild,
        savable: true,
        agentPrompt: fullPromptSent,
        apiCalls
      };
      
      return res.json(responsePayload);
    }
  } catch (error: any) {
    console.error("[Food Analyze Error]:", error);
    
    // Dietitian Degrade logic (Phase 1)
    if (preCalculatedItems && preCalculatedItems.length > 0 && preCalculatedItems.some((p: any) => p.estimatedCalories !== undefined || (p.primaryBase100g && p.primaryBase100g.calories !== undefined))) {
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
      
      const successPayload = {
        data: payloadData,
        mealBuild: degradedMeal,
        degradedStages: degradedMeal.degradedStages,
        message: "Nutrients logged based on core databases, but AI clinical advice is currently unavailable.",
        agentPrompt: fullPromptSent,
        apiCalls
      };

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
  });
});
