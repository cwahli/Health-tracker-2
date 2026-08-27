import 'dotenv/config';
import dns from 'node:dns';
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

import { executeFoodResolverCurator } from './server_food_resolver_curator.js';
import {
  checkCategoryAndStateCompatibility,
  applyServerAverageNutrients,
  checkThermodynamicDensitySanity,
  checkArchetypeMacroBounds,
  applySatFatAndAddedSugarFloor,
  backfillSparseMicronutrients,
} from './server_pure_helpers.js';
import { filterMatchesForQuery, pickQueryScopedMatch } from './server_query_scoped_match.js';
import {
  namesReferToSameFood,
  matchBreakdownItemToScout,
  breakdownAlreadyHasScoutName,
  applySoftReceiptAlignment,
} from './server_scout_reconcile.js';
import { rankAndClassifyCandidates, writeAliasIfHitUnique } from './server_fdc_resolve.js';
import { buildFoodSearchQuerySet } from './server_query_set';
import {
  withGeminiRetry,
  isGeminiQuotaError,
  isGeminiUnavailableError,
  assertModelNotInQuotaCooldown,
  noteGeminiQuota,
} from './server_gemini_retry.js';
import { verifyFirebaseIdToken } from './server_auth.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { pushTranslationsToSheets, pullTranslationsFromSheets } from './server_translations';
import { buildFoodAnalyzeInstruction, buildModeAReviewInstruction, buildModeAEditInstruction, buildModeDCompareInstruction, buildModeDEditInstruction, } from './agents/index.js';
import { ensureFoodCatalogSchema, resetFoodCatalogSchemaEnsure } from "./server_food_catalog_schema.js";
import { reconcileIngredientsToComponents } from './server_vision_scout.js';
import { resolveInternalFood, resolveDishCache, upsertFoodItemCandidate, upsertFoodAlias, upsertDishCacheCandidate, recordFoodObservation, recordSyncEvent, normalizeFoodKey, normalizeDishKey, getCatalogSyncStatus, mergeFoodCatalogItems, quarantineAtwaterFailures, checkAtwaterValidity, getFallbackCategoryProfile } from './server_food_catalog.js';
import { sanitizeDishTitle, cleanupDuplicateBrandMenuItems, isGroceryBrandSync, selfCleanBrandDatabase, isUnofficialOrCompositeDish } from './serverBrandMenu.js';
import {
  computeItemBudget,
  reconcileNutrients,
  portionAndReconcile,
  assertComponentSumMatchesItem,
  parseLabelCalories,
  applyPostReconcileTruthLocks,
} from './server_budget_reconcile.js';
import { rebalanceNutrientProfile, computeCaloriesFromMacros, applyNutrientModifiers } from './server_derivation.js';
import {
  buildPortionClarifyPayload,
  applyPortionChoices,
} from './server_portion_clarify.js';
import { attachHappyPathMealBuild, markDietitianDegraded, buildSavableMealFromParsed } from './server_meal_orchestrator.js';
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
import { z } from "zod";
import { getMappedBiomarkerKey } from './src/utils/biomarkers';
import {
  lexTable,
  buildIngestBatch,
  shouldAbortTablePath,
  leftoverTextFromTrace,
  stagedRowsToExtractedData,
  flaggedRowsToModificationCommands,
  mergeStagedExtract,
} from './src/utils/biomarkerLifecycle';
import { extractMostRecentImageDate } from './src/utils/dateUtils.js';
import { extractUnitFromString, normalizeUnitEquivalence } from './src/utils/biomarkerAuditEngine';
import * as cheerio from "cheerio";
import fs from "fs";

const SINGLE_STAPLE_RE = /\b(croissant|croissants|baguette|bread|toast|muffin|scone|cookie|cupcake|biscuit|pancake|waffle|pastry|doughnut|donut|bun|roll|brioche)\b/i;
import path from "path";
import { getApps, initializeApp } from 'firebase-admin/app';
import { submitServerJob, recoverInterruptedServerJobs } from './serverJobs';
import { biomarkerRouter } from './server_routes_biomarkers.js';
import { foodRouter } from './server_routes_food.js';
import { jobsRouter } from './server_routes_jobs.js';
import { syncRouter } from './server_routes_sync.js';
import { adminRouter } from './server_routes_admin.js';
import { healthConnectRouter } from './server_routes_health_connect.js';

export const BEVERAGE_RAW_PATTERN = /\b(beverage|drink|water|juice|beer|wine|soda|cola|tea|coffee|cappuccino|espresso|latte|mocha|macchiato|boba|smoothie|shake|milk|oat\s*milk|oatmilk|almond\s*milk|almondmilk|soy\s*milk|soymilk|coconut\s*milk|dairy|yogurt|fruit|melon|watermelon|apple|orange|banana|berry|berries|grape|citrus|salad|raw|fresh|broth|soup)\b/i;

export function sanitizeReviewedBiomarkerUnitConsistency(item: any): any {
  if (!item || typeof item !== 'object') return item;
  const declaredUnit = item.unit || '';
  const normalizedDeclared = normalizeUnitEquivalence(declaredUnit);

  let hasMismatch = false;

  // Check brackets range
  if (Array.isArray(item.rangeBrackets)) {
    for (const b of item.rangeBrackets) {
      if (b && typeof b.range === 'string') {
        const bracketUnit = extractUnitFromString(b.range);
        if (bracketUnit) {
          const normalizedBracket = normalizeUnitEquivalence(bracketUnit);
          if (normalizedDeclared && normalizedBracket && normalizedDeclared !== normalizedBracket) {
            hasMismatch = true;
            console.warn(`[data_review] Unit mismatch detected in bracket range "${b.range}" (found unit "${bracketUnit}", normalized "${normalizedBracket}") vs declared unit "${declaredUnit}" (normalized "${normalizedDeclared}") for biomarker key "${item.key}"`);
            break;
          }
        }
      }
    }
  }

  // Check profileAdjustedNormalRange
  if (!hasMismatch && typeof item.profileAdjustedNormalRange === 'string') {
    const rangeUnit = extractUnitFromString(item.profileAdjustedNormalRange);
    if (rangeUnit) {
      const normalizedRange = normalizeUnitEquivalence(rangeUnit);
      if (normalizedDeclared && normalizedRange && normalizedDeclared !== normalizedRange) {
        hasMismatch = true;
        console.warn(`[data_review] Unit mismatch detected in profileAdjustedNormalRange "${item.profileAdjustedNormalRange}" vs declared unit "${declaredUnit}" for biomarker key "${item.key}"`);
      }
    }
  }

  // Check optimalValue
  if (!hasMismatch && typeof item.optimalValue === 'string') {
    const optimalUnit = extractUnitFromString(item.optimalValue);
    if (optimalUnit) {
      const normalizedOptimal = normalizeUnitEquivalence(optimalUnit);
      if (normalizedDeclared && normalizedOptimal && normalizedDeclared !== normalizedOptimal) {
        hasMismatch = true;
        console.warn(`[data_review] Unit mismatch detected in optimalValue "${item.optimalValue}" vs declared unit "${declaredUnit}" for biomarker key "${item.key}"`);
      }
    }
  }

  if (hasMismatch) {
    console.warn(`[data_review] Discarding unit-mismatched AI output ranges for biomarker key "${item.key}" due to scale/unit inconsistency.`);
    return {
      ...item,
      rangeBrackets: [],
      profileAdjustedNormalRange: "",
      optimalValue: "",
      _unitConsistencyDropped: true
    };
  }

  return item;
}

export function extractOFFNutrientsPer100g(product: any): Record<string, number> {
  const profile: Record<string, number> = {};
  if (!product) return profile;
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
}

export async function fetchUSDAFoodById(fdcId: string, retryCount = 1): Promise<any | null> {
  try {
    const usdaApiKey = process.env.USDA_API_KEY || "DEMO_KEY";
    const url = `https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${usdaApiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, { signal: controller.signal as any });
    clearTimeout(timeout);
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
      if (retryCount > 0) {
        await new Promise(r => setTimeout(r, 1000));
        return await fetchUSDAFoodById(fdcId, retryCount - 1);
      }
      return null;
    }
    return await response.json();
  } catch (err) {
    if (retryCount > 0) {
      await new Promise(r => setTimeout(r, 1000));
      return await fetchUSDAFoodById(fdcId, retryCount - 1);
    }
    console.error(`[fetchUSDAFoodById] Error fetching FDC ID ${fdcId}:`, err);
    return null;
  }
}

export async function fetchOFFProductByBarcode(barcode: string): Promise<any | null> {
  try {
    const url = `https://world.openfoodfacts.net/api/v2/product/${barcode}.json`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, {
      signal: controller.signal as any,
      headers: {
        "User-Agent": "HealthTracker/1.0 (Cwah.Liu@gmail.com)"
      }
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) return null;
    const data = await response.json();
    return data.product || null;
  } catch (err) {
    console.error(`[fetchOFFProductByBarcode] Error fetching OFF barcode ${barcode}:`, err);
    return null;
  }
}

export function safeExtractJsonObject<T = any>(rawText: string): T | null {
  if (!rawText) return null;
  try { return JSON.parse(rawText); } catch {}

  const matchFence = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (matchFence?.[1]) {
    try { return JSON.parse(matchFence[1]); } catch {}
  }

  const start = rawText.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < rawText.length; i++) {
    if (rawText[i] === '{') depth++;
    else if (rawText[i] === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(rawText.slice(start, i + 1)); } catch {}
      }
    }
  }
  return null;
}



let firebaseConfig: any = null;
try {
  const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(firebaseConfigPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));
  }
} catch (e) {
  console.error("Failed to load firebase-applet-config.json:", e);
}

if (getApps().length === 0) {
  initializeApp({
    projectId: firebaseConfig?.projectId
  });
}
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
const adminAuth = getAdminAuth();
import express from "express";

const BiomarkerMatrix: Record<string, any> = {
  "hematocrit": {
    "targetUnit": "%",
    "conversionLogic": (value: number, sanitizedUnit: string) => {
      if (sanitizedUnit === "l/l" || value < 1.0) return value * 100; 
      return value;
    }
  },
  "total_cholesterol": {
    "targetUnit": "mmol/L",
    "conversionLogic": (value: number, sanitizedUnit: string) => {
      if (sanitizedUnit === "mg/dl") return value * 0.02586; 
      return value;
    }
  },
  "egfr": {
    "targetUnit": "mL/min/1.73m2",
    "conversionLogic": (value: number, sanitizedUnit: string) => value
  },
  "qrisk2_10yr_risk": {
    "targetUnit": "%",
    "conversionLogic": (value: number, sanitizedUnit: string) => value
  },
  "red_blood_cell_distribution_width": {
    "targetUnit": "%",
    "conversionLogic": (value: number, sanitizedUnit: string) => value
  }
};

function sanitizeUnitText(rawUnit: any): string {
  if (!rawUnit) return '';
  return String(rawUnit)
    .toLowerCase()
    .replace(/[\s]+/g, ' ')
    .replace(/Â²/g, '2')
    .replace(/Â³/g, '3')
    .replace(/percent/g, '%')
    .replace(/\^/g, '*')
    .replace(/^[a-z]*(?=10)/g, '')
    .replace(/[xÃ—]/g, '')
    .trim();
}

import { GoogleGenAI, Type } from "@google/genai";
import { getTraceNutrientsForFoodType, getCookingMethodModifier, calculateUniversalAddedNutrients, lookupCanonicalBaseFood, getCachedUSDAFood, setCachedUSDAFood } from "./server_food_db";
import { decidePrepAddition } from "./server_prep_policy";
import dotenv from "dotenv";
import { AsyncLocalStorage } from "async_hooks";
import { biomarkerDefinitions, getBiomarkerStatus, getBiomarkerStatusLabel, getBiomarkerMetadata, getCustomBiomarkerDef } from "./src/utils/biomarkers";
import { filterHistoryForUse, enrichReviewModificationCommands, sanitizeReviewReply } from "./src/utils/biomarkerLifecycle";
import { generateDynamicInsight } from "./src/utils/biomarkerInsights";
import { formatOptimalTargetValue } from "./src/utils/agentCalibration";
import { NUTRIENT_KEYS } from "./src/utils/nutrients";
import { extractBalancedJson, sanitizeMealWeight, findItemIndexInList, getUSDANutrientValue, extractUSDANutrientsPer100g, checkIfItemIsAlreadyPrepared, applyNutrientRealityChecks, applyCommercialSodiumFloor, checkAtwaterConsistency, synchronizeNarrativeText, evaluateNutrientWarnings, build31NutrientsMarkdownServer, enforceTitlePluralParity } from "./server_pure_helpers";
import { aggregateItemsNutrients, cleanNutrientNumber } from "./server_nutrient_aggregation";
import { registerIssueBacklogRoutes } from './serverIssueBacklog.js';
import { registerBugSnapshotRoutes } from './serverBugSnapshot.js';
import { registerGoldenRoutes } from './serverGoldenRoutes.js';
import { registerBrandMenuRoutes, isKnownDatabaseBrand, isKnownDatabaseBrandSync, fetchAllDatabaseBrands, searchBrandMenuItems, brandHitFitsQuery, normalizeChainKey, consolidateBrandMenuItemsAndChains, cleanUnbrandedFoodCatalog } from './serverBrandMenu.js';
import { supabaseAdmin } from './supabaseAdmin.js';
import { isGenericZeroNutrientDiluent, getZeroNutrientVector, calculateGenericTokenCoverage, evaluateGenericModifierInversionPenalty, classifyUniversalPhysicalFormV3 } from "./server_matching_engine";
import { 
  ScoutItemSchema, 
  VisionScoutSchema, 
  scoutSystemInstruction, 
  mergeScoutItems, 
  parseAndHealVisionScout 
} from "./server_vision_scout";
import { buildVisualScoutPrompt } from "./agents/scoutInstructions";
import { biomarkerReviewSystemInstruction } from "./agents/biomarkerInstructions";
import { isDishEstimateEnabled } from "./server_food_flags";
import { finalizeDishLedger } from "./server_dish_finalize";
import { matchBrandMenu } from "./server_brand_match";
import { classifyDishAtomic } from "./server_dish_classify";


import { getFirestore, Firestore } from "firebase-admin/firestore";

// Helper functions for nutritional data lookup
export const logSessionStorage = new AsyncLocalStorage<string>();
export const streamDebugLogStorage = new AsyncLocalStorage<(msg: string) => void>();

// Global Debug Logs array for LLM process tracking and diagnostics
export interface DebugLog {
  timestamp: string;
  message: string;
}
export let globalDebugLogs: DebugLog[] = [];
export let sessionDebugLogs: { [sessionId: string]: DebugLog[] } = {};
export const liveStreamClients = new Set<any>();

export function addDebugLog(msg: string, explicitSessionId?: string) {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  
  // Truncate huge base64 data URLs globally to prevent massive bloating of diagnostic logs
  let sanitizedMsg = msg || "";
  if (typeof sanitizedMsg === 'string' && sanitizedMsg.includes("data:image/")) {
    sanitizedMsg = sanitizedMsg.replace(/(data:image\/[^;]+;base64,)[A-Za-z0-9+/=]{100,}/g, "$1... [truncated base64 image data]");
  }
  
  // Keep the container stdout clean by truncating huge multiline logs in console.log
  const MAX_LOG_DISPLAY_LEN = 35000;
  let truncatedForDisplay = sanitizedMsg;
  if (sanitizedMsg.length > MAX_LOG_DISPLAY_LEN) {
    const cutPos = sanitizedMsg.lastIndexOf(' ', MAX_LOG_DISPLAY_LEN) || MAX_LOG_DISPLAY_LEN;
    truncatedForDisplay = `${sanitizedMsg.substring(0, cutPos)}...\n[--- Diagnostic Console Display capped at ${MAX_LOG_DISPLAY_LEN} chars for log readability. Note: The full prompt payload (${sanitizedMsg.length} chars) was dispatched IN FULL to Gemini LLM without prompt truncation ---]`;
  }
  console.log(`[LLM DEBUG ${timestamp}]: ${truncatedForDisplay}`);

  // Forward this log line to any live SSE stream registered for the current request
  // (see streamDebugLogStorage.run(...) in the route handlers). This is what makes
  // backend progress show up live in the chat UI's "Agent's Thought" panel instead
  // of only appearing in the diagnostic log viewer.
  const liveStreamCallback = streamDebugLogStorage.getStore();
  if (liveStreamCallback) {
    try {
      // Forward the full message over the live SSE stream (this panel is
      // explicitly labeled "Unfiltered Live Stream" â€” truncating it here
      // contradicted that). truncatedForDisplay is already capped at 4000
      // chars above purely for console.log hygiene, which is generous enough
      // for full system instructions and DB match lists.
      liveStreamCallback(sanitizedMsg);
    } catch (e) {
      console.error("Callback threw an error:", e);
    }
  }
  
  const sessionId = explicitSessionId || logSessionStorage.getStore() || "global";
  if (!sessionDebugLogs[sessionId]) {
    sessionDebugLogs[sessionId] = [];
  }
  sessionDebugLogs[sessionId].push({ timestamp, message: sanitizedMsg });
  if (sessionDebugLogs[sessionId].length > 1500) {
    sessionDebugLogs[sessionId].shift();
  }

  globalDebugLogs.push({ timestamp, message: sanitizedMsg });
  if (globalDebugLogs.length > 2000) {
    globalDebugLogs.shift();
  }

  // GLOBAL BROADCAST TO ALL CONNECTED LIVE STREAM CLIENTS (NO FILTER)
  // sendLog() (in food-analyze/medical-analyze) always calls addDebugLog with the message
  // already prefixed "[<logType>] ...". Recover that prefix here so this broadcast carries
  // the same {logType, timestamp, message} shape Stream 2's own SSE events use â€” that's what
  // lets the client's LiveBackendStreamViewer build matching tabs/elapsed-time for Stream 1
  // too, instead of a flat unparseable string.
  const curatedTagMatch = /^\[([a-zA-Z0-9_]+)\]\s?([\s\S]*)$/.exec(sanitizedMsg);
  const broadcastLogType = curatedTagMatch ? curatedTagMatch[1] : 'backend';
  const broadcastMessage = curatedTagMatch ? curatedTagMatch[2] : sanitizedMsg;

  for (const client of liveStreamClients) {
    try {
      client.write(`data: ${JSON.stringify({ logType: broadcastLogType, message: broadcastMessage, timestamp: Date.now() })}\n\n`);
      if (typeof client.flush === 'function') client.flush();
    } catch (e) {
      liveStreamClients.delete(client);
    }
  }
}

export async function lookupChainMenuSources(chainKey: string, countryCode = 'GB') {
  try {
    const { supabaseAdmin } = await import('./supabaseAdmin.js');
    const { data, error } = await supabaseAdmin
      .from('chain_menu_sources')
      .select('*')
      .eq('chain_key', chainKey)
      .eq('country_code', countryCode)
      .eq('enabled', true)
      .order('priority', { ascending: true });
    if (error) {
      addDebugLog(`[ChainSource] lookup error for ${chainKey}: ${error.message}`);
      return [];
    }
    return data || [];
  } catch (e: any) {
    addDebugLog(`[ChainSource] lookup exception: ${e?.message || e}`);
    return [];
  }
}

export async function seedChainMenuSources() {
  try {
    const { supabaseAdmin } = await import('./supabaseAdmin.js');
    const sourceRow = {
      country_code: 'GB',
      chain_key: 'yolk',
      display_name: 'YOLK',
      url: 'https://yolk.vmos.io/store/a75aab37-d3ba-4833-9785-c5eb27592d49/menu/category/75c0b3b4-cbd6-4555-9f4f-a67107e715e5/bundles?menuUUID=52e377db-9146-4227-b248-43318643f731',
      source_kind: 'vmos',
      status: 'pending',
      priority: 10,
      enabled: true,
      meta: {
        storeId: 'a75aab37-d3ba-4833-9785-c5eb27592d49',
        menuId: '52e377db-9146-4227-b248-43318643f731',
        categoryId: '75c0b3b4-cbd6-4555-9f4f-a67107e715e5',
        platform: 'vmos',
        note: 'Seeded from known UK YOLK kiosk URL; adapter pending'
      },
      updated_at: new Date().toISOString()
    };
    await supabaseAdmin
      .from('chain_menu_sources')
      .upsert(sourceRow, { onConflict: 'country_code,chain_key,url' });
  } catch {
    /* ignore */
  }
}
seedChainMenuSources();
async function searchUSDA(query: string, maxResults: number = 5, dataTypes: string = 'Foundation,SR Legacy,Survey (FNDDS),Branded'): Promise<any[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const dataTypeQuery = dataTypes.split(',').map(d => 'dataType=' + encodeURIComponent(d)).join('&');
    const usdaApiKey = process.env.USDA_API_KEY || "DEMO_KEY";
    const fetchSize = 50;
    let url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${usdaApiKey}&query=${encodeURIComponent(query)}&pageSize=${fetchSize}&${dataTypeQuery}`;
    
    const response = await fetch(url, { signal: controller.signal as any });
    clearTimeout(timeout);
    
    if (!response.ok) return [];
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) return [];
    const data = await response.json();
    let foods = data.foods || [];

    // Fallback: If query returned 0 foods and contains multiple tokens (e.g., "cheddar cheese"),
    // USDA records use inverted phrasing (e.g., "Cheese, cheddar"). Try loosened token searches.
    const tokens = query.trim().split(/\s+/).filter(Boolean);
    if (foods.length === 0 && tokens.length > 1) {
      const invertedComma = [...tokens].reverse().join(', ');
      const invertedSpace = [...tokens].reverse().join(' ');
      const altQueries = [invertedComma, invertedSpace];

      for (const altQuery of altQueries) {
        try {
          const altUrl = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${usdaApiKey}&query=${encodeURIComponent(altQuery)}&pageSize=${fetchSize}&${dataTypeQuery}`;
          const altResponse = await fetch(altUrl);
          if (altResponse.ok) {
            const altContentType = altResponse.headers.get("content-type");
            if (!altContentType || !altContentType.includes("application/json")) continue;
            const altData = await altResponse.json();
            if (altData.foods && altData.foods.length > 0) {
              foods = altData.foods;
              break;
            }
          }
        } catch (err) {
          // Ignore fallback fetch errors and proceed
        }
      }
    }
    
    // Sort to bubble exact or shortest matches to the top
    const qLower = query.toLowerCase().trim();
    const queryHasOil = qLower.includes("oil");
    const queryHasPowder = qLower.includes("powder");

    // Reject 0-kcal items that are supposed to have substance
    foods = foods.filter((f: any) => {
      const kcalNutrient = f.foodNutrients?.find((n: any) => n.nutrientName === "Energy" && String(n.unitName || "").toLowerCase() === "kcal");
      const kcal = kcalNutrient ? parseFloat(kcalNutrient.value) : 0;
      const proteinNutrient = f.foodNutrients?.find((n: any) => n.nutrientName === "Protein" && String(n.unitName || "").toLowerCase() === "g");
      const protein = proteinNutrient ? parseFloat(proteinNutrient.value) : 0;
      
      const name = (f.description || "").toLowerCase();
      const isExpectedZero = /\b(water|diet|zero|no sugar|sparkling|seltzer|ice|tea|coffee|vinegar|salt|spices?)\b/.test(name);
      
      if (kcal === 0 && protein < 0.5 && !isExpectedZero) {
        return false;
      }
      return true;
    });

    foods.sort((a: any, b: any) => {
      const aName = (a.description || "").toLowerCase();
      const bName = (b.description || "").toLowerCase();

      // Demote oil items if query doesn't ask for oil
      if (!queryHasOil) {
        const aIsOil = aName.includes("oil");
        const bIsOil = bName.includes("oil");
        if (aIsOil && !bIsOil) return 1;
        if (bIsOil && !aIsOil) return -1;
      }

      // Demote powder items if query doesn't ask for powder
      if (!queryHasPowder) {
        const aIsPowder = aName.includes("powder");
        const bIsPowder = bName.includes("powder");
        if (aIsPowder && !bIsPowder) return 1;
        if (bIsPowder && !aIsPowder) return -1;
      }

      if (aName === qLower && bName !== qLower) return -1;
      if (bName === qLower && aName !== qLower) return 1;
      if (aName === `${qLower}, raw` && bName !== `${qLower}, raw`) return -1;
      if (bName === `${qLower}, raw` && aName !== `${qLower}, raw`) return 1;
      if (aName === `${qLower}s, raw` && bName !== `${qLower}s, raw`) return -1;
      if (bName === `${qLower}s, raw` && aName !== `${qLower}s, raw`) return 1;
      if (aName.startsWith(qLower) && !bName.startsWith(qLower)) return -1;
      if (bName.startsWith(qLower) && !aName.startsWith(qLower)) return 1;
      return aName.length - bName.length;
    });
    
    return foods.slice(0, maxResults);
  } catch (error) {
    console.error("[USDA API] Error:", error);
    return [];
  }
}

async function searchUSDAFood(query: string): Promise<any | null> {
  const results = await searchUSDA(query, 5, 'Foundation,SR Legacy,Survey (FNDDS)');
  if (results && results.length > 0) {
    const { resolveClass, bestMatch } = rankAndClassifyCandidates(query, results, 65);
    if (bestMatch) {
      // Auto-alias if it's a solid HIT_UNIQUE
      if (resolveClass === 'HIT_UNIQUE') {
         writeAliasIfHitUnique(resolveClass, query, bestMatch).catch(e => console.error(e));
      }
      return {
        ...bestMatch,
        id: String(bestMatch.fdcId || bestMatch.id),
        name: bestMatch.description || bestMatch.name || query
      };
    }
    
    // Fallback if none passed threshold
    const item = results[0];
    return {
      ...item,
      id: String(item.fdcId || item.id),
      name: item.description || item.name || query
    };
  }
  return null;
}

async function searchUSDAWithTwoRounds(query: string, foodType: string, addDebugLog: (msg: string) => void): Promise<any | null> {
  // 1. Check Local Cache First (Instant 0ms retrieval)
  const cached = getCachedUSDAFood(query);
  if (cached) {
    addDebugLog(`[USDA Cache Hit] Found "${query}" in local cache (USDA ID: ${cached.id || cached.fdcId}). Skipping network search.`);
    return cached;
  }

  const cleanQuery1 = query.toLowerCase()
    .replace(/\b(soda|can|bottle|pack|tub|slice|cubes|pieces|portion|raw|cooked|boiled|baked|grilled|steamed)\b/g, '')
    .trim();

  // Round 1: Primary Sanitized Search
  addDebugLog(`[USDA Search Round 1] Querying USDA for "${cleanQuery1}"...`);
  let match = await searchUSDAFood(cleanQuery1);

  // Evaluate Round 1 Macro Proximity
  if (match) {
    const nut = extractUSDANutrientsPer100g(match);
    const isMeatOrFish = foodType === 'fish_lean' || foodType === 'fish_fatty' || foodType === 'poultry' || foodType === 'red_meat';
    if (isMeatOrFish && nut.protein < 10) {
      addDebugLog(`[USDA Round 1 Macro Warning] Round 1 match "${match.name}" has abnormal protein (${nut.protein}g/100g). Escalating to Round 2 within category "${foodType}"...`);
      match = null;
    }
  }

  // Round 2: Category-Isolated Fallback Search if Round 1 failed or had abnormal macros
  if (!match) {
    const fallbackQuery2 = foodType === 'fish_lean' || foodType === 'fish_fatty' ? 'raw fish fillet'
      : (foodType === 'poultry' ? 'raw chicken breast'
      : (foodType === 'red_meat' ? 'raw beef steak'
      : (foodType === 'fruit' ? `${cleanQuery1} raw` : cleanQuery1)));

    addDebugLog(`[USDA Search Round 2] Escalating to category-isolated fallback query: "${fallbackQuery2}"...`);
    match = await searchUSDAFood(fallbackQuery2);
  }

  // Category Boundary Guard: Reject any match that crosses category boundaries
  if (match) {
    const matchNameLower = match.name.toLowerCase();
    const isFishCategory = foodType === 'fish_lean' || foodType === 'fish_fatty';
    const isPoultryCategory = foodType === 'poultry';
    const isRedMeatCategory = foodType === 'red_meat';

    if (isFishCategory && (matchNameLower.includes('chicken') || matchNameLower.includes('beef') || matchNameLower.includes('pork'))) {
      addDebugLog(`[USDA Category Guard] Rejected match "${match.name}" because fish category cannot map to poultry/meat. Escalating...`);
      match = null;
    } else if (isPoultryCategory && (matchNameLower.includes('fish') || matchNameLower.includes('beef') || matchNameLower.includes('pork'))) {
      addDebugLog(`[USDA Category Guard] Rejected match "${match.name}" because poultry category cannot map to fish/beef. Escalating...`);
      match = null;
    } else if (isRedMeatCategory && (matchNameLower.includes('fish') || matchNameLower.includes('chicken') || matchNameLower.includes('turkey'))) {
      addDebugLog(`[USDA Category Guard] Rejected match "${match.name}" because red meat category cannot map to fish/poultry. Escalating...`);
      match = null;
    }
  }

  // If valid match found across either round, save to local cache
  if (match) {
    addDebugLog(`[USDA Search Success] Matched "${query}" -> "${match.name}" (USDA ID: ${match.id || match.fdcId}). Loaded full 31 nutrients.`);
    setCachedUSDAFood(query, match);
    return match;
  }

  // Warning & Enforced Override log if both rounds fail
  addDebugLog(`[USDA Match Warning] âš ï¸ Could not find verified USDA match for "${query}" within category "${foodType}" after 2 search rounds. Applied enforced macro reality check override. You can refine this food name via text chat.`);
  return null;
}

async function searchOpenFoodFacts(query: string, maxResults: number = 5): Promise<any[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const url = `https://world.openfoodfacts.net/cgi/search.pl?search_terms=${encodeURIComponent(query)}&page_size=${maxResults}&json=true`;
    
    const response = await fetch(url, {
      signal: controller.signal as any,
      headers: {
        "User-Agent": "HealthTracker/1.0 (Cwah.Liu@gmail.com)"
      }
    });
    clearTimeout(timeout);
    
    if (!response.ok) return [];
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) return [];
    const data = await response.json();
    let products = data.products || [];
    
    products = products.filter((p: any) => {
      const kcal = p.nutriments?.['energy-kcal_100g'] || 0;
      const protein = p.nutriments?.['proteins_100g'] || 0;
      
      const name = (p.product_name || p.generic_name || "").toLowerCase();
      const isExpectedZero = /\b(water|diet|zero|no sugar|sparkling|seltzer|ice|tea|coffee|vinegar|salt|spices?)\b/.test(name);
      
      if (kcal === 0 && protein < 0.5 && !isExpectedZero) {
        return false;
      }
      return true;
    });
    
    return products;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      console.warn(`[OpenFoodFacts API] Request timed out (8000ms) and was aborted gracefully for query: "${query}"`);
    } else {
      console.error("[OpenFoodFacts API] Error:", error);
    }
    return [];
  }
}



function isUsableWebNutritionHit(webItem: any): boolean {
  if (!webItem) return false;
  const cals = Number(webItem.calories);
  if (isNaN(cals) || cals <= 0) return false;
  
  // Accept even if macros are missing, as long as calories are present
  return true;
}

dotenv.config();
// console.log("Maps Key status at server boot:", process.env.GOOGLE_MAPS_API_KEY ? "DEFINED" : "UNDEFINED");

// Initialize Firebase Firestore for server-side calculations using Google Cloud Firestore Node.js SDK (bypasses security rules)
let db: any = null;
try {
  const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(firebaseConfigPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));
    db = getFirestore(firebaseConfig.firestoreDatabaseId ? getApps()[0] : undefined, firebaseConfig.firestoreDatabaseId);
    console.log("[Firebase] Backend Firestore (Admin Node.js SDK) successfully initialized.");
  } else {
    console.warn("[Firebase] No firebase-applet-config.json found at server boot.");
  }
} catch (err: any) {
  console.error("[Firebase] Error initializing Firestore on server:", err.message || err);
}





// Resolves LLM-provided scoutItemIndices (or itemNames for text-only comparisons) back into
// full item objects using the authoritative Vision Scout data. This guarantees exact names,
// bounding boxes, and image indices â€” the LLM never has to regurgitate this data, which was
// the root cause of silent item drops and incorrect targetDbId hallucination in MODE D groups.
function resolveComparisonGroups(rawGroups: any[], scoutItems: any[]): any[] {
  const usedIndices = new Set<number>();

  const resolvedGroups = (Array.isArray(rawGroups) ? rawGroups : []).map((g: any) => {
    const items: any[] = [];
    let indices: number[] = Array.isArray(g.scoutItemIndices) ? g.scoutItemIndices : [];

    const resolvedIndices = new Set<number>();
    indices.forEach((rawIdx: any) => {
      // 1. Try to parse as integer (0-based)
      let i = typeof rawIdx === "number" ? rawIdx : parseInt(String(rawIdx).trim(), 10);
      let s = (!isNaN(i) && i >= 0 && i < scoutItems.length) ? scoutItems[i] : null;

      // 2. Fallback: Check if LLM used 1-based indexing (e.g. index 1 for array element 0)
      if (!s && !isNaN(i) && i > 0 && i <= scoutItems.length) {
        const fallbackItem = scoutItems[i - 1];
        if (fallbackItem) {
          s = fallbackItem;
          i = i - 1;
        }
      }

      // 3. Fallback: If rawIdx is a string (like "yakiimo cheese"), perform fuzzy string matching
      if (!s && typeof rawIdx === "string") {
        const cleanRaw = rawIdx.trim().toLowerCase();
        if (cleanRaw.length > 1) {
          const foundIdx = scoutItems.findIndex((item: any) => {
            const kw = (item.keyword || "").toLowerCase();
            const orig = (item.originalName || "").toLowerCase();
            return cleanRaw === orig || cleanRaw === kw || cleanRaw.includes(kw) || kw.includes(cleanRaw) || cleanRaw.includes(orig) || orig.includes(cleanRaw);
          });
          if (foundIdx !== -1) {
            s = scoutItems[foundIdx];
            i = foundIdx;
          }
        }
      }

      // 4. If we successfully resolved to a scout item, add it to this group
      if (s && i >= 0 && i < scoutItems.length) {
        usedIndices.add(i);
        resolvedIndices.add(i);
        items.push({
          name: s.name || s.originalName || s.keyword,
          keyword: s.keyword || null,
          originalName: s.originalName || null,
          boundingBox2D: s.boundingBox2D || null,
          sourceImageIndex: typeof s.sourceImageIndex === "number" ? s.sourceImageIndex : 0,
          scoutIndex: i
        });
      }
    });

    // Text-only comparisons (no image / no scout items): fall back to plain names.
    if (scoutItems.length === 0 && Array.isArray(g.itemNames)) {
      g.itemNames.forEach((n: string) => {
        if (n) items.push({ name: n, boundingBox2D: null, sourceImageIndex: null });
      });
    }

    const resolvedThreats: Record<string, string> = {};
    const threatEntries: [string, any][] = Array.isArray(g.itemClinicalThreats)
      ? g.itemClinicalThreats
          .filter((t: any) => t && (typeof t.scoutIndex !== "undefined" || typeof t.scoutIdentifier !== "undefined" || typeof t.scoutIndices !== "undefined"))
          .flatMap((t: any) => {
            if (Array.isArray(t.scoutIndices)) {
               return t.scoutIndices.map((idx: number) => [String(idx), t.threat]);
            }
            
            const rawId = typeof t.scoutIdentifier !== "undefined" ? t.scoutIdentifier : t.scoutIndex;
            let resolvedIdx = -1;
            if (typeof rawId === "number") {
              resolvedIdx = rawId;
            } else if (typeof rawId === "string") {
              const cleanRaw = rawId.trim().toLowerCase();
              const foundIdx = scoutItems.findIndex((item: any) => {
                const kw = (item.keyword || "").toLowerCase();
                const orig = (item.originalName || "").toLowerCase();
                return cleanRaw === orig || cleanRaw === kw || cleanRaw.includes(kw) || kw.includes(cleanRaw) || cleanRaw.includes(orig) || orig.includes(cleanRaw);
              });
              if (foundIdx !== -1) resolvedIdx = foundIdx;
            }
            return [[String(resolvedIdx !== -1 ? resolvedIdx : rawId), t.threat]];
          })
      : (g.itemClinicalThreats && typeof g.itemClinicalThreats === "object")
          ? Object.entries(g.itemClinicalThreats) // legacy fallback for any old-format responses still in flight
          : [];
    if (threatEntries.length > 0) {
      threatEntries.forEach(([key, threat]) => {
        let targetIdx: number | null = null;
        const parsedKey = parseInt(key, 10);
        if (!isNaN(parsedKey)) {
          let i = parsedKey;
          let s = (i >= 0 && i < scoutItems.length) ? scoutItems[i] : null;
          if (!s && i > 0 && i <= scoutItems.length) {
            s = scoutItems[i - 1];
            i = i - 1;
          }
          if (s) {
            targetIdx = i;
          }
        }
        if (targetIdx === null) {
          const cleanKey = key.trim().toLowerCase();
          if (cleanKey.length > 1) {
            const foundIdx = scoutItems.findIndex((item: any) => {
              const kw = (item.keyword || "").toLowerCase();
              const orig = (item.originalName || "").toLowerCase();
              return cleanKey.includes(kw) || kw.includes(cleanKey) || cleanKey.includes(orig) || orig.includes(cleanKey);
            });
            if (foundIdx !== -1) {
              targetIdx = foundIdx;
            }
          }
        }
        if (targetIdx !== null) {
          resolvedThreats[String(targetIdx)] = String(threat);
        } else {
          resolvedThreats[key] = String(threat);
        }
      });
    }

    return {
      groupName: g.groupName,
      verdict: g.verdict,
      message: g.message,
      averageNutrients: g.averageNutrients || null,
      scoutItemIndices: Array.from(resolvedIndices),
      itemClinicalThreats: resolvedThreats,
      items
    };
  });

  // Coverage repair: any scout item the model never assigned to a group still gets shown,
  // instead of silently vanishing from the comparison.
  if (scoutItems.length > 0) {
    const missing = scoutItems.filter((_: any, i: number) => !usedIndices.has(i));
    if (missing.length > 0) {
      const unassignedIdxs = scoutItems.map((_, i) => i).filter(i => !usedIndices.has(i));
      console.log(`[Comparison Resolve] unassigned indices: ${unassignedIdxs.join(', ')}`);
      resolvedGroups.push({
        groupName: "Unassigned items",
        verdict: { label: "Uncategorized", level: "neutral" },
        message: "These items were detected but not placed into a comparison group by the AI.",
        averageNutrients: null,
        scoutItemIndices: unassignedIdxs,
        itemClinicalThreats: {},
        items: missing.map((s: any) => ({
          name: s.name || s.originalName || s.keyword,
          keyword: s.keyword || null,
          originalName: s.originalName || null,
          boundingBox2D: s.boundingBox2D || null,
          sourceImageIndex: typeof s.sourceImageIndex === "number" ? s.sourceImageIndex : 0,
          scoutIndex: scoutItems.indexOf(s)
        }))
      });
    }
  }

  // Small-count safeguard: For < 3 total items, ensure each item gets its own group (1 item per group)
  if (scoutItems.length > 0 && scoutItems.length < 3) {
    const hasLumpedGroup = resolvedGroups.some(g => g.scoutItemIndices && g.scoutItemIndices.length > 1);
    if (hasLumpedGroup) {
      console.log(`[Comparison Grouping Safeguard] Unbundling multi-item group for ${scoutItems.length} items into 1 item per group.`);
      const unbundledGroups: any[] = [];
      scoutItems.forEach((sItem: any, idx: number) => {
        const existingGroup = resolvedGroups.find(g => g.scoutItemIndices && g.scoutItemIndices.includes(idx)) || resolvedGroups[idx] || resolvedGroups[0];
        const itemName = sItem.name || sItem.originalName || sItem.keyword || `Option ${idx + 1}`;
        unbundledGroups.push({
          groupName: existingGroup?.groupName && resolvedGroups.length > 1 ? existingGroup.groupName : itemName,
          verdict: existingGroup?.verdict || { label: "Evaluated Option", level: "neutral" },
          message: existingGroup?.message || `Nutritional evaluation for ${itemName}.`,
          averageNutrients: sItem.preCalcNutrients || null,
          scoutItemIndices: [idx],
          itemClinicalThreats: existingGroup?.itemClinicalThreats ? { [String(idx)]: existingGroup.itemClinicalThreats[String(idx)] || "" } : {},
          items: [{
            name: itemName,
            keyword: sItem.keyword || null,
            originalName: sItem.originalName || null,
            boundingBox2D: sItem.boundingBox2D || null,
            sourceImageIndex: typeof sItem.sourceImageIndex === "number" ? sItem.sourceImageIndex : 0,
            scoutIndex: idx
          }]
        });
      });
      return unbundledGroups;
    }
  }

  return resolvedGroups;
}

export { applyServerAverageNutrients } from './server_pure_helpers.js';

// Note: buildFoodAnalyzeInstruction is imported from ./agents/index.js at top of file
export function buildFoodAnalyzeInstructionLocal(context: {
  biomarkersNeedingImprovement?: any[];
  remainingAllowance?: any | null;
  activeMeal?: any;
  compareItemCount?: number;
}): string {
  const { biomarkersNeedingImprovement, remainingAllowance, activeMeal, compareItemCount = 0 } = context;

  const formattedBiomarkers = Array.isArray(biomarkersNeedingImprovement) && biomarkersNeedingImprovement.length > 0
    ? biomarkersNeedingImprovement.map((b: any) => {
        if (typeof b === "string") {
          return `â€¢ ${b}`;
        }
        if (b && typeof b === "object" && b.name) {
          const statusStr = b.status ? ` is ${String(b.status).toUpperCase()}` : "";
          const valStr = b.value !== undefined ? ` (${b.value} ${b.unit || ""}, normal range: ${b.normalRange || ""})` : "";
          return `â€¢ ${b.name}${statusStr}${valStr}`;
        }
        return `â€¢ ${String(b)}`;
      }).join("\n")
    : "â€¢ None";

  const biomarkersList = formattedBiomarkers;

  const formatLimitVal = (val: any) => {
    if (val === undefined || val === null) return "0";
    const num = Number(val);
    if (isNaN(num)) return String(val);
    return String(Math.round(num * 100) / 100);
  };
  
  let averagesStr = "";
  if (remainingAllowance && remainingAllowance.averages) {
    const { averages, rollingDays } = remainingAllowance;
    const overages: string[] = [];
    const limits = [
      { key: 'calories', label: 'Calories', target: remainingAllowance.caloriesTarget },
      { key: 'saturatedFat', label: 'Saturated Fat', target: remainingAllowance.saturatedFatTarget },
      { key: 'sodium', label: 'Sodium', target: remainingAllowance.sodiumTarget },
      { key: 'addedSugar', label: 'Added Sugar', target: remainingAllowance.addedSugarTarget },
      { key: 'carbohydrates', label: 'Carbohydrates', target: remainingAllowance.carbohydratesTarget }
    ];
    
    limits.forEach(limit => {
      if (averages[limit.key] !== undefined && limit.target !== undefined && averages[limit.key] > limit.target) {
        overages.push(`- ${limit.label}: ${formatLimitVal(averages[limit.key])} (Target: ${formatLimitVal(limit.target)})`);
      }
    });
    
    if (overages.length > 0) {
      averagesStr = `\n\nWARNING: The patient has exceeded their daily target limits on average over the past ${rollingDays || 7} days for the following nutrients:\n${overages.join('\n')}\nThey must be extra careful about these nutrients today!`;
    }
  }

  let targetLimits = "Nutrient target (target limit)\n";
  if (remainingAllowance) {
    const rem = remainingAllowance;
    const averages = rem.averages || {};

    const topNutrients = [
      { key: 'saturatedFat', targetKey: 'saturatedFatTarget', label: 'Sat fat', unit: 'g', defaultTarget: 12 },
      { key: 'calories', targetKey: 'caloriesTarget', label: 'Calorie', unit: 'kcal', defaultTarget: 1321 },
      { key: 'sodium', targetKey: 'sodiumTarget', label: 'Sodium', unit: 'mg', defaultTarget: 960 },
      { key: 'protein', targetKey: 'proteinTarget', label: 'Protein', unit: 'g', defaultTarget: 72 },
      { key: 'carbohydrates', targetKey: 'carbohydratesTarget', label: 'Carbohydrates', unit: 'g', defaultTarget: 128 },
      { key: 'totalFibre', altKey: 'solubleFibre', targetKey: 'solubleFibreTarget', label: 'Total Fibre', unit: 'g', defaultTarget: 38 },
      { key: 'potassium', targetKey: 'potassiumTarget', label: 'Potassium', unit: 'mg', defaultTarget: 4200 },
      { key: 'solubleFibre', targetKey: 'solubleFibreTarget', label: 'Soluble Fibre', unit: 'g', defaultTarget: 12 },
      { key: 'addedSugar', targetKey: 'addedSugarTarget', label: 'Added Sugar', unit: 'g', defaultTarget: 24 },
      { key: 'transFat', targetKey: 'transFatTarget', label: 'Trans Fat', unit: 'g', defaultTarget: 0 },
    ];

    // 7 days avg line
    const avgParts: string[] = [];
    topNutrients.forEach((n) => {
      const avgVal = Math.round(averages[n.key] || (n.altKey ? averages[n.altKey] : 0) || 0);
      const targetVal = Math.round(rem[n.targetKey] || n.defaultTarget);
      if (avgVal > targetVal && targetVal > 0) {
        const pctOver = Math.round(((avgVal - targetVal) / targetVal) * 100);
        avgParts.push(`${n.label} (${avgVal}${n.unit} - ${pctOver}% over)`);
      } else if (avgVal > 0) {
        avgParts.push(`${n.label} (${avgVal}${n.unit} avg)`);
      } else {
        avgParts.push(`${n.label} (0${n.unit} avg)`);
      }
    });

    const avgLine = `7 days avg: ${avgParts.join(', ')}`;

    // Todays target line
    const todayParts: string[] = [];
    topNutrients.forEach((n) => {
      const logged = Math.round(Number(rem[n.key] !== undefined ? rem[n.key] : (n.altKey ? rem[n.altKey] : 0)) || 0);
      const targetVal = Math.round(Number(rem[n.targetKey]) || n.defaultTarget);

      if (targetVal > 0 && logged > targetVal) {
        todayParts.push(`${n.label} (${logged}${n.unit} over ${targetVal}${n.unit} daily)`);
      } else if (targetVal > 0) {
        todayParts.push(`${n.label} (${logged}/${targetVal}${n.unit})`);
      } else {
        todayParts.push(`${n.label} (${logged}${n.unit})`);
      }
    });

    const todayLine = `Todays target: ${todayParts.join(', ')}`;
    targetLimits += `${avgLine}\n${todayLine}`;
  } else {
    targetLimits += `7 days avg: Sat fat (33g - 172% over), Calorie (2610 kcal - 98% over), Sodium (3096mg - 222% over), Protein (125g avg - 74% over), Carbohydrates (226g avg - 76% over), Total Fibre (35g avg), Potassium (1777mg avg), Soluble Fibre (2.6g avg), Added Sugar (12g avg), Trans Fat (0g avg)\nTodays target: Sat fat (25g over 12g daily), Calorie (1272kcal over 1321kcal daily), Sodium (576mg over 960mg daily), Protein (113/72g), Carbohydrates (176/128g), Total fibre (36/38g), Potassium (1677/4200mg), Soluble Fibre (0/12g), Added Sugar (0/24g), Trans Fat (0/0g)`;
  }

  // Clean activeMeal by replacing huge base64 strings
  let sanitizedActiveMeal = null;
  if (activeMeal) {
    sanitizedActiveMeal = { ...activeMeal };
    if (sanitizedActiveMeal.imageUrl && sanitizedActiveMeal.imageUrl.startsWith("data:image/")) {
      sanitizedActiveMeal.imageUrl = "[base64_image_data_truncated]";
    }
    if (sanitizedActiveMeal.imageUrls && Array.isArray(sanitizedActiveMeal.imageUrls)) {
      sanitizedActiveMeal.imageUrls = sanitizedActiveMeal.imageUrls.map((url: string) => 
        url && url.startsWith("data:image/") ? "[base64_image_data_truncated]" : url
      );
    }
    if (sanitizedActiveMeal.chatTranscript) {
      delete sanitizedActiveMeal.chatTranscript;
    }
    if (sanitizedActiveMeal.receiptTable) {
      delete sanitizedActiveMeal.receiptTable;
    }
    if (sanitizedActiveMeal.nutrients) {
      delete sanitizedActiveMeal.nutrients;
    }
    if (sanitizedActiveMeal.verdict) {
      delete sanitizedActiveMeal.verdict;
    }
    if (sanitizedActiveMeal.itemsBreakdown && Array.isArray(sanitizedActiveMeal.itemsBreakdown)) {
      sanitizedActiveMeal.itemsBreakdown = sanitizedActiveMeal.itemsBreakdown.map((item: any) => ({
        scoutIndex: item.scoutIndex,
        dbId: item.dbId,
        canonicalDbName: item.canonicalDbName || item.name,
        foodType: item.foodType,
        weightGrams: item.weightGrams,
        dbSource: item.dbSource,
        cookingMethod: item.cookingMethod,
        components: item.components ? item.components.map((c: any) => ({ searchQuery: c.searchQuery, volumePercentage: c.volumePercentage })) : undefined
      }));
    }
  }

  const mealStr = sanitizedActiveMeal ? JSON.stringify(sanitizedActiveMeal, null, 2) : "None";

  return `CURRENT_ACTIVE_MEAL_STATE: ${mealStr}

You are an expert clinical dietitian and nutritional LLM analyzer operating within an automated personalized health ecosystem. Your response must be an exact single structured JSON object matching the requested structure. Never add markdown formatting wrappers like \`\`\`json unless instructed.

=== ADVICE & COACHING DIRECTIVES (MANDATORY) ===
PERSONALIZED & CONSTRUCTIVE: Do not lecture the user or make meals sound purely 'bad'. Acknowledge the food naturally without judgment. Focus on constructive adjustments (e.g. portion tweaks, adding fiber or protein, pairing with lighter sides) and practical guidance rather than reciting raw macro numbers. The macro chips in the UI already present the exact values, so avoid repeating long lists of numeric totals in text.

=== PATIENT CONTEXT PAYLOAD ===
CRITICAL PATIENT BIOMARKER WARNINGS & NUTRITIONAL DIRECTIVES:
${biomarkersList}
- If LDL-C/cholesterol is HIGH, any food high in saturated fat is EXTREMELY harmful. Rate as "bad" and warn in "risks".
- If Blood Pressure/Sodium is HIGH, any food high in sodium is EXTREMELY harmful. Rate as "bad".

${targetLimits}

=== UNIVERSAL HEALTH DIRECTIVE (STRICT) ===
TRANS FAT AVOIDANCE: Trans fat (partially hydrogenated oils) is universally harmful and must be avoided regardless of the patient's specific biomarkers. Always aggressively flag any food likely to contain trans fats in the "risks" field.

=== DATA EXTRACTION DEPTH RULES ===
1. CORE NUTRIENTS: Use databaseMatches to extract raw authentic data. The deterministic backend math will automatically inject labelNutrientsPerServing and handle sodium limits based on your identification.
=== NUTRITIONAL BASELINE & CLINICAL SANITY CHECK DIRECTIVE ===
The backend provides pre-calculated precise nutrient weights inside "=== BACKEND PRE-CALCULATED ITEM NUTRIENTS ===".
1. DEFAULT BASELINE: Treat these pre-calculated numbers as your default baseline for your evaluation. Write your prose message, benefits, risks, and recommendations based directly on these numbers.
2. PORTION WEIGHT CALIBRATION: Preserve baseline item weights by default. If an item's portion weight is inaccurate against regional dim sum/side norms or piece counts (e.g. 3 small street siomay dumplings estimated at 150g instead of ~90-105g), adjust 'weightGrams' to the calibrated portion size.
3. CLINICAL NUTRIENT AUDIT & CORRECTION: Audit the baseline numbers for each item against culinary preparation realism. If you identify an inaccurate estimate (e.g. deep-fried oil absorption, sodium, or starchy filler), output the corrected portion values in 'correctedNutrients' and state the clinical reason in 'clinicalCorrectionNote'. Leave null only if baseline accurately reflects culinary reality.
2. TRACE NUTRIENTS: Do NOT estimate these individually. Instead, output the single most appropriate foodType string for each item (e.g., 'red_meat', 'leafy_veg', 'root_veg', etc.).

Critical: Original Name Override & Anti-Merging Rule
Local Language Priority: Treat the originalName provided by the visual scout as the absolute ground truth for categorizing an item, overriding the English keyword if they contradict.

Preserve Visual Scout Cooking Method & Ingredients:
1. Cooking Method Alignment: You MUST maintain the exact item-level cookingMethod identified by the Visual Scout (e.g., deep_fried, pan_fried, stir_fried, roasted, boiled, steamed, grilled, baked, raw) for each item in itemsBreakdown. Do NOT override deep_fried or pan_fried to baked or raw unless the user explicitly requested a change in their message text.
2. Visual Ingredients Alignment: You MUST carry over all visualIngredients detected by the Visual Scout into the item's visualIngredients array in itemsBreakdown. If visualIngredients is empty, leave it empty ([]). Do NOT copy printed text from 'ingredientsList' into 'visualIngredients' or 'composition'. For packaged or printed label products, 'visualIngredients' MUST be an empty array ([]) and 'composition' MUST contain ONLY the item name (e.g., 'HANA Mat Kimchi (Diced Radish Kimchi)').

Protein Verification: If an originalName contains clear local language identifiers for proteins (e.g., "Ikan" = fish, "Ayam" = chicken, "Daging" = beef) but the upstream agent mistakenly passed an English keyword matching a vegetable, you MUST classify and log the item based on the local protein name.

Strict Anti-Merging: NEVER sum the weights of two items simply because their English keywords match. You must evaluate if their originalNames represent the exact same food. If they are different (e.g., "IK BARONANG" and "BABY PAKCHOY"), keep them as separate, distinct entries in the itemsBreakdown array.

Trace Nutrients Taxonomy
Fungi Expansion: Do NOT estimate trace nutrients individually. Instead, output the single most appropriate foodType string for each item.

Allowed Types: Use exactly one of the following category tags: 'red_meat', 'poultry', 'fish_lean', 'fish_fatty', 'leafy_veg', 'root_veg', 'fungi', 'legume', 'grain', 'fruit', 'dairy', 'mixed_meal' (for complex dishes), or 'ultra_processed' (for junk food and sweets).

=== CONTEXTUAL DIETARY ACRONYMS ===
If the visual scout identifies standard dietary codes or tags in the originalName (e.g., airline meal codes like "LFML" for Low Fat Meal, "VGML" for Vegan Meal, "GFML" for Gluten Free Meal, or general menu acronyms), you MUST explicitly acknowledge the code's dietary significance in your clinical reasoning and adjust your nutrient estimation accordingly (e.g., lower saturated fat for LFML, zero animal products for VGML).

=== SAUCES VS SPICES DIRECTIVE (CRITICAL) ===
You must differentiate between dry spices (like 'black pepper') and liquid sauces (like 'black pepper sauce'). A sauce has calories, fats, and sodium. A dry spice does not. If a food item has a sauce, you MUST include the full sauce name (e.g. 'black pepper sauce', 'soy sauce') as an item component. Never simplify 'black pepper sauce' to just 'spices, pepper, black'.

=== MODE ROUTING DIRECTIVE (STRICTLY ENFORCED) ===
Operate in one of five distinct modes based on current user intent:

MODE A: NEW FOOD LOGGING 
- You will be explicitly instructed to use this mode via the CRITICAL ROUTING OVERRIDE. Ignore CURRENT_ACTIVE_MEAL_STATE.
- Extract ingredients, estimate weights, and provide the foodData block.
- CRITICAL INCLUSION & INDEX PRESERVATION RULE: If the Scout identifies MULTIPLE items (e.g., 5 items with scoutIndex 0 to 4), you MUST include EVERY single Scout item as its own separate object in 'itemsBreakdown'. DO NOT merge, collapse, or drop items (e.g., if there are 2 tangerines, keep them as TWO separate objects). For EVERY item in 'itemsBreakdown', you MUST explicitly copy and output the exact 'scoutIndex' number from the Scout payload. Set "mode": "new_log".
- CRITICAL SCHEMA REQUIREMENT: You MUST output the foodData block and you MUST explicitly set "comparison": null. Do NOT generate comparison group structures or assign scout indices to a comparison engine for a single logged meal.
- CRITICAL: If the user uploads a picture of a meal (e.g. a plate with steak, potatoes, veggies), you MUST treat it as a single meal entry and use MODE A (NEW FOOD LOGGING). Combine the components into the itemsBreakdown array. DO NOT use MODE D (EVALUATION/COMPARISON) to compare the items on the plate unless the user explicitly asks to compare them or choose the best option.
- CRITICAL: If the user enters a single food item name or phrase like "I ate this steak" without explicitly asking to compare, you MUST use MODE A.
- FINAL NUTRIENT AUDIT & CLINICAL CORRECTIONS: Review backend numbers in === BACKEND PRE-CALCULATED ITEM NUTRIENTS === against culinary preparation realism. If you identify an inaccurate estimate (e.g. deep-fried oil absorption, sodium, or starchy filler), output 'correctedNutrients' and state clinical reason in 'clinicalCorrectionNote'. Leave null only if baseline accurately reflects culinary reality.
- CONFIDENCE ACKNOWLEDGEMENT (CRITICAL): Check the "Visual Scout Confidence Rating" and any anomaly flags listed for the items in the === VISUAL FOOD SCOUT IDENTIFIED ITEMS === section. If any item is marked as Medium or Low confidence (or has anomaly flags), you MUST start your response by explicitly acknowledging this uncertainty. You MUST explicitly invite the user to correct the identification manually via text, or upload a clearer picture so you can update the lower rating.

MODE B: DISCUSSION 
- Triggered by general health questions, or if the user's message/query is NOT relevant to food, nutrition, or health. Set "mode": "discussion". Set structural data to null.
- CRITICAL: If you detect that the user's input/query is not relevant to food, nutrition, or biological tracking, you MUST use MODE B (DISCUSSION). In your conversational response ("message"), politely inform the user of your focus and actively incite, guide, or invite them to provide relevant descriptions, ingredients, weights, or pictures of meals or food items so that you can evaluate them, analyze their nutritional profile, and guide them in their wellness journey.
- CRITICAL REJECTION RULE: If the user input is a greeting (e.g., "Hi", "Hello", "Start", "Let's start", "greetings"), general conversational inquiry, or focuses purely on clinical/lab biomarkers (e.g., ALT, AST, LDL, cholesterol, liver panel) without any food, meal, ingredient, or recipe context, you MUST immediately classify the request as MODE B (DISCUSSION). Do NOT assume a database match of a greeting/command word (e.g., the word "Start" matching "Start granola") is the user's food item unless they explicitly wrote "I ate..." or "My meal is...". State politely that you are the Food & Nutrition Agent and can only analyze meals, ingredients, recipes, or nutritional values, and advise them to use the Health & Medical Agent for clinical or lab test reviews.

MODE C: MODIFICATION COMMAND (ACTIVE MEAL UPDATE / REASSESSMENT)
Triggered ONLY when the user asks to modify, add, correct, or change an item, weight, or cooking method that currently exists inside the CURRENT_ACTIVE_MEAL_STATE.
- EXPLICIT EXCLUSION RULE: If the user states they "only had" specific items, you MUST output 'remove_item' actions in \`modificationCommand\` for ALL other items currently in the active meal that they did not mention. Do not leave unmentioned items in the meal.
- FULL REASSESSMENT LAW (CRITICAL): You MUST recalculate all nutrients of the food impacted, and provide a comprehensive, updated clinical assessment and actionable nutrition advice in 'message' (incorporating the new totals of calories, sodium, and saturated fat, comparing them against today's nutritional target and multi-day trend, and providing specific advice or next steps). Do not just say you made the change.
- SYNCHRONIZATION LAW (CRITICAL): The food items in 'foodData.itemsBreakdown' MUST match exactly what is in 'composition' and the updated meal. If any food item is changed from raw to boiled, or removed, or added, update 'itemsBreakdown' and 'composition' to match perfectly.
- Set "mode": "modify". You MUST fully populate the 'foodData' block with the completely updated meal details (date, name, quantity, composition, itemsBreakdown) incorporating the user's modifications.
- Populate the "modificationCommand" array with the precise actions performed to keep track of changes:
  * action: 'update_weight' | 'remove_item' | 'add_item' | 'rename_item' | 'update_cooking_method'
  * itemName: exact literal name from the active meal itemsBreakdown list
  * targetDbId: exact dbId from itemsBreakdown
  * newWeightGrams: new weight in grams
  * newCookingMethod: new cooking method if changed
  * newName: new item name if renamed
- Do NOT use Mode C if the user is discussing a food from a theoretical comparison that is not in the active meal state.

MODE D: EVALUATION / COMPARISON
- You will be explicitly instructed to use this mode via the CRITICAL ROUTING OVERRIDE.

- NUTRITIONAL DOMINANCE LAW (CRITICAL): You MUST group items strictly by their clinical nutritional value, primary base ingredient, or risk profile. You are strictly FORBIDDEN from creating groups named after physical layout locations like shelves, rows, or tables (e.g., Do NOT use 'Top Shelf Selections').

- CROSS-SHELF INDEX MAPPING (THE BREAKOUT RULE): Because the Vision Scout groups foods by physical rows to preserve bounding boxes, a single physical row may contain multiple types of foods. 
  * You are allowed to include the SAME Scout Index in MULTIPLE nutritional groups if that physical shelf contains products belonging to both categories.
  * Your UI will seamlessly render the correct row crop for both comparisons without breaking.

- COVERAGE REQUIREMENT: Every single Index provided in the === VISUAL FOOD SCOUT IDENTIFIED ITEMS === list MUST appear in at least one nutritional group.

- THE EVALUATION HIERARCHY (CRITICAL): Before grouping, you MUST evaluate the TOTAL package payload of every item against this strict 4-step hierarchy:
  1. UNIVERSAL THREATS: Does it contain universally harmful ingredients (e.g., trans fats)?
  2. THE DAILY BUDGET (ACUTE THREATS): Does the TOTAL package payload consume more than 50% of ANY "REMAINING NUTRITIONAL TARGET LIMIT" (e.g., Sodium, Calories, Saturated Fat, Added Sugar)? If yes, it is an acute dietary threat.
  3. BIOMARKER STRATEGY & INGREDIENT QUALITY (CHRONIC THREATS): Does the biochemical nature of the food OR its specific ingredients trigger any of the "PATIENT BIOMARKER WARNINGS"? If an 'ingredientsList' is provided, you MUST analyze it. Highly processed or inflammatory ingredients (e.g., refined flours like 'Tepung Terigu', shortening/'lemak reroti', 'margarin') must actively penalize the item's ranking, especially for patients with liver (ALT), cholesterol, or diabetes risks. If 'ingredientsList' is null, base your assessment strictly on the macro payload.
  4. TARGET ACQUISITION (POSITIVE IMPACT): Does the item significantly contribute to the "Nutrient target to reach today" (e.g., high Protein, Potassium, Soluble Fibre, or Unsaturated Fat) without grossly violating steps 1-3?

- GROUPING STRATEGY (RANKED TIERS + THREAT CLUSTERING - MANDATORY & STRICTLY ENFORCED):
  * CRITICAL SMALL-COUNT RULE (<3 ITEMS): If there are LESS THAN 3 total scanned items (e.g. 1 or 2 items), DO NOT group multiple items together or create artificial third tiers. Output EXACTLY 1 group per scanned item (a group size of 1 item per group), mapping each item's index individually in 'scoutItemIndices' (e.g. Tier 1 with scoutItemIndices: [0], Tier 2 with scoutItemIndices: [1]).
  * MULTI-ITEM SHELF RULE (>=3 ITEMS): If 3 or more items are scanned, structure the 'comparison.groups' array in a strict tiered order:
    - TIER 1 (The Winner / Least Harmful Group): Exactly 1 item representing the best choice.
    - TIER 2 (The Runner-Up Group): Exactly 1 item representing the second best choice.
    - TIER 3 (The Rest - Threat Clusters): Group remaining items by clinical threats and ingredient matrices. Do NOT lump all items into a single bucket.
  * CRITICAL MATH REQUIREMENT: You MUST use the provided 'TRUE TOTAL NUTRITIONAL PAYLOAD' values for 'averageNutrients'. Do not re-calculate or apply serving size math yourself.

- SCHEMA DETAILS:
  * Output the specific groups in comparison.groups. 
  * CRITICAL SYNTAX: Each element inside the comparison.groups array MUST be a complete JSON object enclosed in curly braces '{' and '}'. Never output bare keys or skip curly braces. The first property of each group object inside the curly braces MUST be "groupName".
  * For each group object, provide groupName, verdict, message, averageNutrients, and scoutItemIndices. OMIT the comparisonTable entirely.
  * The 'verdict' and 'message' fields MUST EXACTLY MATCH the formatting rules of Mode A. 'verdict' specifies a 3-6 word label and a level ('good', 'warning', 'alert', 'neutral'). 'message' must be a highly instructional 4-beat advice (Value -> Impact -> Symptom -> Next Action) applying numeric values for targets and limits.
  * For Mode D, omit the root-level 'verdict' and 'message' fields, as they are now handled per-group.
  * Inside each group, add an "itemClinicalThreats" array. Each entry MUST be an object {"scoutIndices": [<numbers>], "threat": "<short label>"} covering every scout item in that group. You MUST group indices that share the EXACT same threat label together into the array to save space. For Tier 1 and 2, this might be "None" or a minor warning. For Tier 3, it must explicitly name the threat (e.g., "Excessive Sodium").
  * CRITICAL NAMING RULE: NEVER use the word "Index" or "Option X" in your 'groupName', 'message', or 'recommendation' text fields. You must seamlessly weave the actual food names (e.g., "Happy Tos", "Mr. Bread") into your prose. The "Index" number is ONLY for the 'scoutItemIndices' and 'scoutIndex' JSON structure fields.

- RESOLVING VISUAL WARNINGS:
  If the user provides a text correction for a previously unclear visual item (e.g. they say "the unclear fish is ikan bandoneng"), you MUST update that specific item in the \`scoutItems\` array schema field. You must update its keyword, completely clear its anomaly flags, and upgrade its confidence to High. You must return the ENTIRE array including the unaffected items.

=== SYSTEM CONSTRAINTS ===

First, think step-by-step in the '_internalReasoning' field of the JSON.

Second, output exactly one JSON object.

The JSON must contain ONLY the fields requested below.

=== OUTPUT INSTRUCTIONS ===

First, write out your step-by-step reasoning inside the '_internalReasoning' JSON field. Explain your clinical thoughts and support your reasoning.

Then, output your final mapped results in a raw, valid JSON block.

Ensure EVERY JSON field is correctly separated by a comma and that all strings are properly closed with quotation marks. Do not add markdown formatting blocks (such as \`\`\`json) around your JSON response.

JSON SCHEMA STRICT REQUIREMENT:
{
  "_internalReasoning": "string",
  "mode": "new_log | discussion | modify | evaluation | origin",
  "verdict": {
    "label": "Bad for cholesterol | High Saturated Fat | High Sodium | Healthy Choice | Moderate Saturated Fat",
    "level": "good | warning | alert | neutral"
  },
  "message": "A highly personalized conversational response detailing the clinical rationale. Focus on actionable guidance and avoid repeating raw macro numbers.",
  "modificationCommand": [
    {
      "action": "update_weight | remove_item | add_item | rename_item",
      "itemName": "EXACT literal name from the itemsBreakdown list.",
      "newWeightGrams": 120,
      "targetDbId": "EXACT dbId from itemsBreakdown. CRITICAL for backend matching.",
      "newName": "New name if action is rename_item"
    }
  ],
  "foodData": {
    "date": "YYYY-MM-DD",
    "name": "Literal food name",
    "verdict": {
      "label": "Bad for cholesterol | High Saturated Fat | High Sodium | Healthy Choice | Moderate Saturated Fat",
      "level": "good | warning | alert | neutral"
    },
    "itemsBreakdown": [
      {
        "canonicalDbName": "Standardized target food name",
        "weightGrams": 120,
        "dbSource": "usda | off | estimated | label",
        "dbId": "fdcId or barcode",
        "labelNutrientsPerServing": {
          "servingSizeGrams": 100,
          "calories": 0,
          "protein": 0,
          "totalFat": 0,
          "saturatedFat": 0,
          "transFat": 0,
          "carbohydrates": 0,
          "addedSugar": 0,
          "sodium": 0,
          "potassium": 0,
          "totalFibre": 0,
          "solubleFibre": 0
        },
        "foodType": "string"
      }
    ],
    "weightGrams": 150,
    "quantity": "Visual descriptive serving size",
    "risks": "Explicit clinical risk warnings",
    "recommendation": "Short, contextual tag indicating core health property."
  },
  "comparison": {
    "comparisonTitle": "A short 2-4 word title for this comparison (e.g., 'Nutrients of Concern')", 
    "auditChecklist": "CRITICAL: List all scoutItemIndices from the prompt (e.g., 0, 1, 2, 3...) here before grouping to ensure 100% extraction coverage.",
    "groups": [
      {
        "groupName": "Descriptive reason (e.g., 'Lowest in all harmful nutrients')",
        "scoutItemIndices": [0],
        "itemNames": null,
        "suitability": "Safest option",
        "recommendation": "Considering what the user asked, target limits, targets to reach, and clinical biomarkers, give advice on this food.",
        "averageNutrients": {
          "calories": 0,
          "protein": 0,
          "totalFat": 0,
          "saturatedFat": 0,
          "sodium": 0,
          "carbohydrates": 0,
          "addedSugar": 0,
          "potassium": 0,
          "totalFibre": 0
        }
      }
    ]
  },

}`;
}



const app = express();

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));
app.use(biomarkerRouter);
app.use(foodRouter);
app.use(jobsRouter);
app.use(syncRouter);
app.use(adminRouter);
app.use(healthConnectRouter);

app.get(['/debug/:key(*)', '/api/r2/debug/:key(*)'], async (req, res) => {
  try {
    const rawKey = req.params.key || req.path.replace(/^\/(api\/r2\/)?debug\//, '');
    const cleanKey = rawKey.startsWith('debug/') ? rawKey : `debug/${rawKey}`;
    const jobIdMatch = cleanKey.match(/([a-zA-Z0-9_\-]+)\.json$/);
    const jobId = jobIdMatch ? jobIdMatch[1] : cleanKey;

    return res.redirect(`/api/jobs/debug?jobId=${encodeURIComponent(jobId)}&format=markdown`);
  } catch (err: any) {
    console.error('[API] /debug proxy error:', err);
    res.status(500).json({ error: 'Failed to retrieve debug file' });
  }
});


const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || 'd17eecca64f82625d29dc38b14f46c14';
const CLOUDFLARE_R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
const CLOUDFLARE_R2_PUBLIC_URL = (process.env.CLOUDFLARE_R2_PUBLIC_URL || 'https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev').replace(/\/$/, '');
const CLOUDFLARE_R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '';
const CLOUDFLARE_R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';

const s3Endpoint = `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
let s3Client = null;
function getS3Client() {
  if (!s3Client && CLOUDFLARE_R2_ACCESS_KEY_ID && CLOUDFLARE_R2_SECRET_ACCESS_KEY) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: s3Endpoint,
      credentials: {
        accessKeyId: CLOUDFLARE_R2_ACCESS_KEY_ID,
        secretAccessKey: CLOUDFLARE_R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return s3Client;
}

async function uploadBase64ToR2(id: string, base64Data: string, index: number = 0): Promise<string> {
  const client = getS3Client();
  const safeId = String(id || 'unknown').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
  const suffix = index > 0 ? `_${index}` : '';
  const objectKey = `photos/${safeId}${suffix}.jpg`;
  const publicUrl = `${CLOUDFLARE_R2_PUBLIC_URL}/${objectKey}`;
  const proxyUrl = `/photos/${safeId}${suffix}.jpg`;

  if (!client) {
    console.warn('[R2 uploadBase64ToR2] S3 Client not configured, returning proxyUrl');
    return proxyUrl;
  }

  try {
    let body;
    let contentType = 'image/jpeg';

    if (base64Data.startsWith('data:')) {
      const match = base64Data.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (match) {
        contentType = match[1];
        body = Buffer.from(match[2], 'base64');
      } else {
        body = Buffer.from(base64Data);
      }
    } else {
      body = Buffer.from(base64Data, 'base64');
    }

    const command = new PutObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
    });
    await client.send(command);
    return publicUrl;
  } catch (err) {
    console.error('[R2 uploadBase64ToR2] Failed uploading to R2:', err);
    return proxyUrl;
  }
}

app.post('/api/r2/upload-photo', async (req, res) => {
  try {
    const { jobId, payload } = req.body;
    const safeId = String(jobId || 'unknown').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
    const objectKey = `photos/${safeId}.jpg`;
    // B11d: same-origin proxy works with private buckets; publicUrl is secondary
    const proxyUrl = `/photos/${safeId}.jpg`;
    const publicUrl = `${CLOUDFLARE_R2_PUBLIC_URL}/${objectKey}`;
    const client = getS3Client();
    if (!client) {
      return res.json({ url: proxyUrl, proxyUrl, publicUrl });
    }

    let body;
    let contentType = 'image/jpeg';

    if (payload.startsWith('data:')) {
      const match = payload.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (match) {
        contentType = match[1];
        body = Buffer.from(match[2], 'base64');
      } else {
        body = Buffer.from(payload);
      }
    } else {
      body = Buffer.from(payload);
    }

    const command = new PutObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
    });
    await client.send(command);

    res.json({ url: proxyUrl, proxyUrl, publicUrl, key: objectKey });
  } catch (err) {
    console.error('Failed to upload photo to R2:', err);
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

app.post('/api/r2/migrate-firestore-images', async (req, res) => {
  try {
    // Load existing food logs from Supabase for matching
    console.log('[Firestore API Migrate] Fetching food logs from Supabase to match existing images...');
    const { supabaseAdmin } = await import('./supabaseAdmin.js');
    const { data: foodLogs, error: supabaseErr } = await supabaseAdmin
      .from('food_logs')
      .select('id, image_urls, firebase_uid');

    if (supabaseErr) {
      console.error('[Firestore API Migrate] Error: Failed to fetch food logs from Supabase:', supabaseErr.message);
      return res.status(500).json({ error: 'Failed to fetch food logs from Supabase', details: supabaseErr.message });
    }

    if (!foodLogs || foodLogs.length === 0) {
      return res.json({ success: true, message: 'No food logs found in Supabase.', stats: { inspected: 0, skipped: 0, matched: 0, migrated: 0, updated: 0 } });
    }

    // Initialize client Firebase SDK dynamically to run under client permissions
    const { initializeApp: initializeClientApp } = await import('firebase/app');
    const { initializeFirestore: initializeClientFirestore, doc: clientDoc, getDoc: clientGetDoc, updateDoc: clientUpdateDoc } = await import('firebase/firestore');

    const clientApp = initializeClientApp(firebaseConfig);
    const clientDb = firebaseConfig?.firestoreDatabaseId
      ? initializeClientFirestore(clientApp, {}, firebaseConfig.firestoreDatabaseId)
      : initializeClientFirestore(clientApp, {});

    let migratedCount = 0;
    let matchedCount = 0;
    let docsUpdatedCount = 0;
    let skippedCount = 0;

    for (const log of foodLogs) {
      const docId = log.id;
      const userId = log.firebase_uid;

      if (!userId) {
        skippedCount++;
        continue;
      }

      const docRef = clientDoc(clientDb, 'users', userId, 'foodImages', docId);
      let docSnapShot;
      try {
        docSnapShot = await clientGetDoc(docRef);
      } catch (docErr: any) {
        console.warn(`[Firestore API Migrate] Failed to fetch doc users/${userId}/foodImages/${docId}:`, docErr.message || docErr);
        continue;
      }

      if (!docSnapShot.exists()) {
        skippedCount++;
        continue;
      }

      const data = docSnapShot.data() || {};
      let hasChanges = false;
      let updatedImageUrl = data.imageUrl || null;
      let updatedImageUrls = Array.isArray(data.imageUrls) ? [...data.imageUrls] : [];

      // Check if we have a match in Supabase
      const cleanSupabaseUrls = log.image_urls && Array.isArray(log.image_urls)
        ? log.image_urls.filter((url: string) => typeof url === 'string' && !url.startsWith('data:'))
        : [];

      if (cleanSupabaseUrls.length > 0) {
        const isImageUrlAligned = updatedImageUrl === cleanSupabaseUrls[0];
        const isImageUrlsAligned = JSON.stringify(updatedImageUrls) === JSON.stringify(cleanSupabaseUrls);

        if (!isImageUrlAligned || !isImageUrlsAligned) {
          console.log(`[Firestore API Migrate] Match found in Supabase for doc ${docId}! Aligning Firestore with Supabase R2 URLs directly...`);
          updatedImageUrl = cleanSupabaseUrls[0];
          updatedImageUrls = cleanSupabaseUrls;
          hasChanges = true;
          matchedCount++;
        }
      } else {
        // No Supabase match found - migrate base64 strings if present
        if (typeof data.imageUrl === 'string' && data.imageUrl.startsWith('data:image/')) {
          hasChanges = true;
          try {
            console.log(`[Firestore API Migrate] Uploading imageUrl for doc ${docId} (User ${userId})...`);
            const r2Url = await uploadBase64ToR2(docId, data.imageUrl, 0);
            updatedImageUrl = r2Url;
            migratedCount++;
          } catch (uploadErr) {
            console.error(`[Firestore API Migrate] Upload failure for ${docId}`);
          }
        }

        if (Array.isArray(data.imageUrls)) {
          for (let i = 0; i < data.imageUrls.length; i++) {
            const url = data.imageUrls[i];
            if (typeof url === 'string' && url.startsWith('data:image/')) {
              hasChanges = true;
              try {
                console.log(`[Firestore API Migrate] Uploading imageUrls[${i}] for doc ${docId} (User ${userId})...`);
                const r2Url = await uploadBase64ToR2(docId, url, i);
                updatedImageUrls[i] = r2Url;
                migratedCount++;
              } catch (uploadErr) {
                console.error(`[Firestore API Migrate] Upload failure for ${docId}[${i}]`);
              }
            }
          }
        }
      }

      if (hasChanges) {
        console.log(`[Firestore API Migrate] Updating doc ID: ${docId} (User: ${userId}) in Firestore with clean R2 links...`);
        try {
          await clientUpdateDoc(docRef, {
            imageUrl: updatedImageUrl,
            imageUrls: updatedImageUrls
          });
          docsUpdatedCount++;
        } catch (updateErr: any) {
          console.error(`[Firestore API Migrate] Failed to update doc ${docId}:`, updateErr.message || updateErr);
        }
      } else {
        skippedCount++;
      }
    }

    res.json({
      success: true,
      stats: {
        inspected: foodLogs.length,
        skipped: skippedCount,
        matched: matchedCount,
        migrated: migratedCount,
        updated: docsUpdatedCount
      }
    });
  } catch (err: any) {
    console.error('Failed to run Firestore migration via API:', err);
    res.status(500).json({ error: 'Firestore migration failed', details: err?.message || String(err) });
  }
});

app.post('/api/r2/upload-logs', async (req, res) => {
  try {
    const { jobId, logsText } = req.body || {};
    if (!jobId || logsText === undefined) {
      return res.status(400).json({ error: 'jobId and logsText are required' });
    }
    const { uploadLogsToR2 } = await import('./src/utils/r2Storage.js');
    const url = await uploadLogsToR2(String(jobId), String(logsText));
    return res.json({ success: true, url });
  } catch (err: any) {
    console.error('[API] /api/r2/upload-logs failed:', err);
    return res.status(500).json({ error: err.message || 'Failed to upload logs' });
  }
});

app.post('/api/r2/migrate-backend-logs', async (req, res) => {
  try {
    console.log('[MigrateLogs] Starting migration of backend logs from Supabase & Firestore to R2...');
    const { uploadLogsToR2 } = await import('./src/utils/r2Storage.js');
    const { supabaseAdmin } = await import('./supabaseAdmin.js');

    let supabaseInspected = 0;
    let supabaseMigrated = 0;
    let totalBytesSaved = 0;

    // 1. Migrate Supabase agent_jobs table
    const { data: jobs, error: sbErr } = await supabaseAdmin
      .from('agent_jobs')
      .select('id, clean_result, status_message');

    if (sbErr) {
      console.error('[MigrateLogs] Supabase query failed:', sbErr.message);
    } else if (jobs && jobs.length > 0) {
      supabaseInspected = jobs.length;
      for (const job of jobs) {
        let cleanRes = job.clean_result;
        if (!cleanRes || typeof cleanRes !== 'object') continue;

        const rawLogs = cleanRes.backendLogs || cleanRes.agentResult?.backendLogs || '';
        // Skip if already offloaded or empty
        if (!rawLogs || typeof rawLogs !== 'string' || rawLogs.startsWith('[Logs stored in R2') || rawLogs.startsWith('http')) {
          continue;
        }

        const logLength = rawLogs.length;
        if (logLength < 10) continue;

        // Upload raw logs to Cloudflare R2
        const logsUrl = await uploadLogsToR2(job.id, rawLogs);
        if (!logsUrl) {
          console.warn(`[MigrateLogs] Failed to upload logs to R2 for job ${job.id}`);
          continue;
        }

        // Clean payload
        const updatedCleanRes = { ...cleanRes };
        updatedCleanRes.backendLogsUrl = logsUrl;
        updatedCleanRes.backendLogs = `[Logs stored in R2: ${logsUrl}]`;
        if (updatedCleanRes.agentResult) {
          updatedCleanRes.agentResult = {
            ...updatedCleanRes.agentResult,
            backendLogsUrl: logsUrl,
            backendLogs: `[Logs stored in R2: ${logsUrl}]`,
          };
        }

        const { error: updateErr } = await supabaseAdmin
          .from('agent_jobs')
          .update({ clean_result: updatedCleanRes })
          .eq('id', job.id);

        if (!updateErr) {
          supabaseMigrated++;
          totalBytesSaved += logLength;
        } else {
          console.error(`[MigrateLogs] Failed updating job ${job.id} in Supabase:`, updateErr.message);
        }
      }
    }

    // 2. Migrate Firestore agent logs if Firebase is configured
    let firestoreInspected = 0;
    let firestoreMigrated = 0;
    try {
      const { initializeApp: initializeClientApp } = await import('firebase/app');
      const { initializeFirestore: initializeClientFirestore, collectionGroup, getDocs, updateDoc } = await import('firebase/firestore');

      if (firebaseConfig && firebaseConfig.apiKey) {
        const clientApp = initializeClientApp(firebaseConfig);
        const clientDb = firebaseConfig.firestoreDatabaseId
          ? initializeClientFirestore(clientApp, {}, firebaseConfig.firestoreDatabaseId)
          : initializeClientFirestore(clientApp, {});

        // Inspect foodImages or agentAnalyses collections
        const snapshot = await getDocs(collectionGroup(clientDb, 'agentAnalyses'));
        firestoreInspected = snapshot.size;

        for (const docSnap of snapshot.docs) {
          const data = docSnap.data();
          const rawLogs = data.backendLogs || data.globalLiveLogs || data.agentResult?.backendLogs || '';
          if (!rawLogs || typeof rawLogs !== 'string' || rawLogs.startsWith('[Logs stored in R2') || rawLogs.startsWith('http')) {
            continue;
          }

          const logsUrl = await uploadLogsToR2(docSnap.id, rawLogs);
          if (logsUrl) {
            await updateDoc(docSnap.ref, {
              backendLogsUrl: logsUrl,
              backendLogs: `[Logs stored in R2: ${logsUrl}]`,
              globalLiveLogs: `[Logs stored in R2: ${logsUrl}]`
            });
            firestoreMigrated++;
            totalBytesSaved += rawLogs.length;
          }
        }
      }
    } catch (fsErr: any) {
      console.warn('[MigrateLogs] Firestore log migration skipped/failed:', fsErr.message || fsErr);
    }

    return res.json({
      success: true,
      message: 'Backend logs migration completed',
      stats: {
        supabaseInspected,
        supabaseMigrated,
        firestoreInspected,
        firestoreMigrated,
        totalBytesSavedKB: Math.round(totalBytesSaved / 1024)
      }
    });
  } catch (err: any) {
    console.error('[MigrateLogs] Migration endpoint failed:', err);
    return res.status(500).json({ error: 'Migration failed', details: err?.message || String(err) });
  }
});

/** Stream meal photo from R2 (works when bucket is private). B11d. */
async function streamR2Photo(res: any, rawKey: string) {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const client = getS3Client();
  if (!client) {
    res.status(404).send('R2 client not configured');
    return;
  }
  let filename = String(rawKey || '')
    .replace(/^\/+/, '')
    .replace(/\.\./g, '')
    .slice(0, 200);
  if (!filename) {
    res.status(400).send('key required');
    return;
  }
  if (!filename.includes('.')) filename = `${filename}.jpg`;
  const key = filename.startsWith('photos/') ? filename : `photos/${filename}`;

  const tryKeys = [key];
  // legacy without extension
  if (key.endsWith('.jpg')) tryKeys.push(key.replace(/\.jpg$/i, ''));

  let lastErr: any = null;
  for (const k of tryKeys) {
    try {
      const command = new GetObjectCommand({
        Bucket: CLOUDFLARE_R2_BUCKET_NAME,
        Key: k,
      });
      const s3Res = await client.send(command);
      if (s3Res.ContentType) res.setHeader('Content-Type', s3Res.ContentType);
      else res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('X-Photo-Key', k);
      const stream = s3Res.Body as any;
      if (stream && typeof stream.pipe === 'function') {
        stream.pipe(res);
        return;
      }
      if (stream && typeof stream.transformToByteArray === 'function') {
        const bytes = await stream.transformToByteArray();
        res.send(Buffer.from(bytes));
        return;
      }
    } catch (err: any) {
      lastErr = err;
    }
  }
  res.status(404).send(lastErr?.message || 'Photo not found');
}

app.get(['/photos/:key', '/api/r2/photos/:key'], async (req, res) => {
  try {
    await streamR2Photo(res, req.params.key);
  } catch (err: any) {
    res.status(404).send('Photo not found');
  }
});

/**
 * B11d â€” resolve a readable URL for a meal photo.
 * Always returns same-origin proxy when possible; optional short-lived signed URL.
 * Query: ?key=jobId.jpg  or  ?url=https://â€¦.r2.dev/photos/â€¦
 */
app.get('/api/r2/photo-url', async (req, res) => {
  try {
    let key = String(req.query.key || '').replace(/^\/+/, '');
    const rawUrl = String(req.query.url || '');
    if (!key && rawUrl) {
      const m = rawUrl.match(/\/photos\/([^?#]+)/i);
      if (m) key = m[1];
    }
    if (!key) return res.status(400).json({ error: 'key or url required' });
    if (!key.includes('.')) key = `${key}.jpg`;
    key = key.replace(/\.\./g, '').slice(0, 200);

    const proxyUrl = `/photos/${key}`;
    const objectKey = key.startsWith('photos/') ? key : `photos/${key}`;
    const wantSigned = String(req.query.signed || '') === '1' || String(req.query.signed || '') === 'true';

    let signedUrl: string | null = null;
    if (wantSigned) {
      const client = getS3Client();
      if (client) {
        try {
          const { GetObjectCommand } = await import('@aws-sdk/client-s3');
          const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
          const cmd = new GetObjectCommand({
            Bucket: CLOUDFLARE_R2_BUCKET_NAME,
            Key: objectKey,
          });
          signedUrl = await getSignedUrl(client as any, cmd, { expiresIn: 3600 });
        } catch (e: any) {
          console.warn('[B11d] signed URL failed, using proxy:', e?.message || e);
        }
      }
    }

    res.json({
      key: objectKey,
      proxyUrl,
      url: signedUrl || proxyUrl,
      signed: !!signedUrl,
      expiresIn: signedUrl ? 3600 : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'photo-url failed' });
  }
});

app.get('/api/r2/log-proxy', async (req, res) => {
  try {
    const rawUrl = String(req.query.url || '');
    const jobId = String(req.query.jobId || '');
    const { fetchLogsFromR2 } = await import('./src/utils/r2Storage');

    let targetJobId = jobId;
    if (!targetJobId && rawUrl) {
      const match = rawUrl.match(/\/logs\/([^/?#]+)\.log/i) || rawUrl.match(/job_\d+_[a-z0-9]+/i);
      if (match) {
        targetJobId = match[1] || match[0];
      }
    }

    if (targetJobId) {
      try {
        const logs = await fetchLogsFromR2(targetJobId);
        if (logs) {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          return res.send(logs);
        }
      } catch (r2Err) {
        console.warn('[API] R2 fetch error in proxy, trying memory fallback:', r2Err);
      }
      const { getInMemoryServerJob } = await import('./serverJobs');
      const memJob = getInMemoryServerJob(targetJobId);
      if (memJob) {
        const memLogs = (Array.isArray(memJob.accumulatedLogs) && memJob.accumulatedLogs.length > 0)
          ? memJob.accumulatedLogs.join('\n')
          : (Array.isArray(memJob.turn1Logs) && memJob.turn1Logs.length > 0 ? memJob.turn1Logs.join('\n') : (memJob.clean_result?.backendLogs || ''));
        if (memLogs) {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          return res.send(memLogs);
        }
      }
    }

    if (rawUrl && /^https?:\/\//i.test(rawUrl)) {
      const r2Res = await fetch(rawUrl);
      if (r2Res.ok) {
        const text = await r2Res.text();
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.send(text);
      }
    }

    return res.status(404).send('Log file not found');
  } catch (err: any) {
    console.error('[API] /api/r2/log-proxy error:', err);
    return res.status(500).send(err?.message || 'Failed to fetch R2 log');
  }
});

app.post('/api/r2/upload-debug', async (req, res) => {
  try {
    const { jobId, payload, userId } = req.body;
    // B14: strip base64; user-scoped cold key (legacy flat key still writable via old clients)
    const { stripHeavyImages, coldDebugR2Key, COLD_DEBUG_LOG } = await import('./src/utils/debugPayload');
    const key = coldDebugR2Key(String(jobId || 'unknown'), userId || payload?.userId || 'anonymous');
    const publicUrl = `${CLOUDFLARE_R2_PUBLIC_URL}/${key}`;
    const client = getS3Client();
    if (!client) {
      return res.json({ url: publicUrl });
    }

    const stripped = stripHeavyImages(payload || {});
    const body = Buffer.from(JSON.stringify(stripped, null, 2));

    const command = new PutObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: 'application/json',
    });
    await client.send(command);
    console.log(`${COLD_DEBUG_LOG} api ok key=${key} bytes=${body.length}`);

    res.json({ url: publicUrl });
  } catch (err) {
    console.error('Failed to upload debug to R2:', err);
    res.status(500).json({ error: 'Failed to upload debug' });
  }
});

app.post('/api/r2/upload-job-result', async (req, res) => {
  try {
    const { jobId, payload } = req.body;
    if (!jobId || !payload) {
      return res.status(400).json({ error: 'Missing jobId or payload' });
    }
    const publicUrl = `${CLOUDFLARE_R2_PUBLIC_URL}/jobs/${jobId}_result.json`;
    const client = getS3Client();
    if (!client) {
      return res.json({ url: publicUrl });
    }

    const body = Buffer.from(JSON.stringify(payload, null, 2));

    const command = new PutObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: `jobs/${jobId}_result.json`,
      Body: body,
      ContentType: 'application/json',
    });
    await client.send(command);
    console.log(`[JobResult R2 API] Uploaded ok key=jobs/${jobId}_result.json bytes=${body.length}`);

    res.json({ url: publicUrl });
  } catch (err: any) {
    console.error('Failed to upload job result to R2:', err);
    res.status(500).json({ error: err.message || 'Failed to upload job result' });
  }
});

app.post('/api/r2/delete-debug', async (req, res) => {
  try {
    const { key, jobId, userId } = req.body || {};
    const { deleteR2ObjectByKey, deleteDebugPayloadFromR2 } = await import('./src/utils/r2Storage.js');
    if (key) {
      const ok = await deleteR2ObjectByKey(String(key));
      return res.json({ success: ok });
    }
    if (jobId) {
      const ok = await deleteDebugPayloadFromR2(String(jobId), userId ? String(userId) : undefined);
      return res.json({ success: ok });
    }
    return res.status(400).json({ error: 'Either key or jobId is required' });
  } catch (err: any) {
    console.error('[API] /api/r2/delete-debug error:', err);
    res.status(500).json({ error: err?.message || 'Failed to delete R2 debug object' });
  }
});


process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});
const imageSearchCache = new Map<string, any>();
const PORT = 3000;
const SERVER_START_TIME = Date.now();
console.log("[boot] server.ts evaluated, startingâ€¦");

async function startServer() {
  console.log("[boot] startServer()");
  ensureFoodCatalogSchema().then((r) => {
    if (!r.ok) console.error('[CatalogSchema] ensure on boot failed:', r.method, r.error);
  }).catch(() => {});

  // In-Memory & Local File Sync storage to act as the durable synced database
  const SYNC_DIR = path.join(process.cwd(), "data", "sync");
  if (!fs.existsSync(SYNC_DIR)) {
    fs.mkdirSync(SYNC_DIR, { recursive: true });
  }

  // Increase limit to allow base64 uploaded image payloads (Note: registered early above)
  // app.use(express.json({ limit: "15mb" }));
  // app.use(express.urlencoded({ extended: true, limit: "15mb" }));

  // Register session tracking middleware for isolated logging
  app.use((req, res, next) => {
    const sessionId = (req.headers["x-session-id"] as string) || (req.query.sessionId as string) || "global";
    logSessionStorage.run(sessionId, () => {
      next();
    });
  });

  app.post("/api/client-error", (req, res) => {
    const { message, stack } = req.body || {};
    addDebugLog(`[Client Error] ${message || 'Unknown Error'}\n${stack || ''}`);
    res.json({ status: "ok" });
  });

// Robust API key resolver supporting standard GEMINI_API_KEY, Google Cloud GOOGLE_API_KEY, or API_KEY
const getGeminiApiKey = (): string => {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.API_KEY ||
    process.env.GEMINI_API_KEYS?.split(',')[0]?.trim() ||
    ''
  );
};

// Initialize Gemini SDK with telemetry header
const getGeminiClient = () => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    console.warn("WARNING: GEMINI_API_KEY / GOOGLE_API_KEY is not defined in the environment.");
  }
  return new GoogleGenAI({
    apiKey: apiKey || "MOCK_KEY",
    httpOptions: {
      timeout: 150000,
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
};

// Helper to retrieve the Google Maps Place ID from business name & location
async function fetchGoogleMapsPlaceId(
  businessName: string,
  latitude: string | number,
  longitude: string | number,
  explicitSessionId?: string
): Promise<string> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    addDebugLog(`[get_google_maps_place_id] API Key is missing in process.env`, explicitSessionId);
    return "ERROR_API_FAILED";
  }
  
  // Use a strict AbortController timeout to prevent hangs
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);
  
  try {
    const latStr = String(latitude).trim();
    const lngStr = String(longitude).trim();
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(businessName)}&inputtype=textquery&locationbias=point:${latStr},${lngStr}&fields=place_id&key=${apiKey}`;
    
    addDebugLog(`[get_google_maps_place_id] Fetching place ID for "${businessName}" near (${latStr}, ${lngStr})`, explicitSessionId);
    
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      addDebugLog(`[get_google_maps_place_id] Google Places API HTTP error: ${res.status}`, explicitSessionId);
      return "ERROR_API_FAILED";
    }
    const data = await res.json();
    if (data.status === "ZERO_RESULTS") {
      addDebugLog(`[get_google_maps_place_id] No results found (ZERO_RESULTS) for "${businessName}"`, explicitSessionId);
      return "NOT_FOUND";
    }
    if (data.candidates && data.candidates.length > 0) {
      const pId = data.candidates[0].place_id || "NOT_FOUND";
      addDebugLog(`[get_google_maps_place_id] Resolved successfully! Place ID: ${pId}`, explicitSessionId);
      return pId;
    }
    addDebugLog(`[get_google_maps_place_id] Status was ${data.status || 'unknown'}, candidates empty.`, explicitSessionId);
    return "NOT_FOUND";
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isAbort = err.name === 'AbortError';
    const errorMsg = isAbort ? 'Request timed out after 2500ms' : (err.message || err);
    addDebugLog(`[get_google_maps_place_id] Error: ${errorMsg}`, explicitSessionId);
    return "ERROR_API_FAILED";
  }
}



const ItemBreakdownSchema = z.object({
  scoutIndex: z.number().nullable().optional(),
  canonicalDbName: z.string().nullable().optional(),
  weightGrams: z.number().finite().nonnegative().nullable().optional(),
  dbSource: z.string().nullable().optional(),
  dbId: z.string().nullable().optional(),
  foodType: z.string().nullable().optional(),
  cookingMethod: z.string().nullable().optional(),
}).passthrough();

const VerdictSchema = z.object({
  label: z.string().optional(),
  level: z.string().optional()
}).passthrough();

const FoodDataSchema = z.object({
  date: z.string().optional(),
  name: z.string().optional(),
  itemsBreakdown: z.array(ItemBreakdownSchema).optional()
}).passthrough();

const RouteAgentSchema = z.object({
  _internalReasoning: z.string().nullable().optional(),
  verdict: VerdictSchema.nullable().optional(),
  message: z.string().nullable().optional(),
  foodData: FoodDataSchema.nullable().optional(),
  modificationCommand: z.array(z.any()).nullable().optional(),
  comparison: z.any().nullable().optional(),
}).passthrough();

// Validates parsed LLM JSON against a schema. On failure, logs the full raw
// output (so we can see exactly what the LLM sent) and returns the provided
// safe fallback instead of letting a malformed shape reach downstream math.
function validateOrFallback<T>(schema: z.ZodType<T>, parsed: any, rawText: string, label: string, fallback: T): T {
  const result = schema.safeParse(parsed);
  if (!result.success) {
    addDebugLog(`[Zod Validation Failed] ${label}: ${result.error.message}. Raw output: ${rawText}`);
    return fallback;
  }
  return result.data;
}

async function asyncParseLLMJSON(cleanJson: string): Promise<any> {
  await new Promise(resolve => setImmediate(resolve));
  let cleaned = cleanJson.replace(/\`\`\`(?:json)?/gi, "").replace(/\`\`\`/g, "").trim();
  
  // Array fallback
  if (cleaned.startsWith("[")) {
      let depth = 0;
      for (let i = 0; i < cleaned.length; i++) {
        if (cleaned[i] === "[") depth++;
        else if (cleaned[i] === "]") depth--;
        if (depth === 0) {
          return JSON.parse(cleaned.substring(0, i + 1));
        }
      }
  }
  
  return JSON.parse(extractBalancedJson(cleaned));
}

// Unified Multi-Provider LLM Router with automatic fallbacks & simulation modes
async function callUnifiedLLM(args: any): Promise<any> {
  const modelName = typeof args?.modelId === 'object'
    ? args.modelId?.name || args.modelId?.model || 'gemini-3.5-flash-lite'
    : (args?.modelId || 'gemini-3.5-flash-lite');

  const executeWithTimeout = async (runArgs: any) => {
    let timer: NodeJS.Timeout | undefined;
    const timeoutMs = 150000;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Model execution timed out (>150s) using "${modelName}". The request took too long to complete. Please retry or select another model from the top-left model selector.`));
      }, timeoutMs);
    });

    try {
      const res = await Promise.race([
        callUnifiedLLMInternal(runArgs),
        timeoutPromise
      ]);
      if (timer) clearTimeout(timer);
      return res;
    } catch (err: any) {
      if (timer) clearTimeout(timer);
      throw err;
    }
  };

  try {
    return await executeWithTimeout(args);
  } catch (err: any) {
    const errStr = String(err.message || err || "").toLowerCase();
    const isAbortedOrStalled = err?.name === 'AbortError' || errStr.includes('abort') || errStr.includes('stalled');
    if (isAbortedOrStalled) {
      throw err;
    }

    const isTimeoutOrDeadline = errStr.includes('deadline') || 
                                errStr.includes('timeout') || 
                                errStr.includes('timed out') || 
                                errStr.includes('504') ||
                                errStr.includes('expired');

    const isResourceExhausted = errStr.includes('resource_exhausted') || errStr.includes('quota') || errStr.includes('429');
    
    if (isResourceExhausted) {
      const modelName = typeof args?.modelId === 'object' ? (args.modelId as any)?.name || (args.modelId as any)?.model : args?.modelId;
      noteGeminiQuota(String(modelName || 'gemini-3.5-flash-lite'), err);
      throw new Error(`The Gemini API quota has been temporarily exhausted on ${modelName || 'this model'}. Wait the retry-after, or switch to Gemini 3.1 Flash Lite (separate free-tier bucket). Detailed API Error: ${err.message}`);
    }

    if (isTimeoutOrDeadline && !args.skipThinking) {
      console.warn(`[UnifiedLLM] Request failed (${err.message}). Retrying once with 'skipThinking: true'...`);
      
      try {
        const retryArgs = { 
          ...args, 
          skipThinking: true,
          // keep the original model for 503s instead of forcing a downgrade that might also 503
          modelId: args.modelId 
        };
        return await executeWithTimeout(retryArgs);
      } catch (retryErr: any) {
        console.error(`[UnifiedLLM] Fallback retry also failed:`, retryErr);
        throw retryErr;
      }
    }
    throw err;
  }
}

async function callUnifiedLLMInternal({
  modelId,
  systemInstruction,
  promptText,
  imagePayload,
  imagePayloads,
  responseMimeType,
  responseSchema,
  googleSearch,
  enablePlaceIdTool,
  maxOutputTokens,
  onStream,
  skipThinking,
  skipThoughtInjection,
  logStagePrefix,
  temperature
}: {
  modelId: string;
  systemInstruction: string;
  promptText: string;
  imagePayload?: { mimeType: string; data: string } | null;
  imagePayloads?: { mimeType: string; data: string }[] | null;
  responseMimeType?: "application/json" | "text/plain";
  responseSchema?: any;
  googleSearch?: boolean;
  enablePlaceIdTool?: boolean;
  maxOutputTokens?: number;
  onStream?: (chunk: string, isThought?: boolean) => void;
  skipThinking?: boolean;
  // When the caller's own response schema already nests a reasoning field
  // (e.g. health_coach's `report._internalReasoning`), set this to true so
  // the generic top-level thought-injection below is skipped. Without this,
  // the top-level check for `parsed._internalReasoning` never finds the
  // nested field and injects a second, top-level, unformatted reasoning
  // blob alongside the model's own schema-compliant one.
  skipThoughtInjection?: boolean;
  // Optional label (e.g. "scout", "dietitian") appended to this call's debug
  // log tags so the diagnostic viewer can attribute the full system
  // instruction/prompt/response to the right agent tab. Omit for every other
  // call site â€” behavior is unchanged when not provided.
  logStagePrefix?: string;
  temperature?: number;
}) {
  const explicitSessionId = logSessionStorage.getStore();
  const _localAddDebugLog = (msg: string) => addDebugLog(msg, explicitSessionId);
  try {
    const isJson = responseMimeType === "application/json";
    const rawModelStr = typeof modelId === 'object' ? (modelId as any)?.name || (modelId as any)?.model || 'gemini-3.5-flash-lite' : (modelId || 'gemini-3.5-flash-lite');
    const normalizedModelId = rawModelStr.toLowerCase();
    if (normalizedModelId.includes('gemini')) {
      assertModelNotInQuotaCooldown(rawModelStr);
    }

  // 1. Anthropic Claude Models
  if (normalizedModelId.includes("claude-")) {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      console.log(`[UnifiedLLM] Calling official Anthropic API: ${normalizedModelId}`);
      try {
        const messages: any[] = [];
        const contentParts: any[] = [];
        if (imagePayloads && imagePayloads.length > 0) {
          for (const img of imagePayloads) {
            contentParts.push({
              type: "image",
              source: {
                type: "base64",
                media_type: img.mimeType,
                data: img.data
              }
            });
          }
        } else if (imagePayload) {
          contentParts.push({
            type: "image",
            source: {
              type: "base64",
              media_type: imagePayload.mimeType,
              data: imagePayload.data
            }
          });
        }
        contentParts.push({
          type: "text",
          text: promptText
        });
        messages.push({
          role: "user",
          content: contentParts
        });

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: normalizedModelId,
            max_tokens: 4096,
            system: systemInstruction + (isJson ? " Respond strictly in valid JSON format." : ""),
            messages
          })
        });

        if (res.ok) {
          const body = (await res.json()) as any;
          return body.content?.[0]?.text || "{}";
        } else {
          const errMsg = await res.text();
          console.warn(`Anthropic API call returned non-200 status (${res.status}): ${errMsg}. Falling back to Gemini...`);
        }
      } catch (err) {
        console.warn(`Error connecting to Anthropic:`, err, `. Falling back to Gemini...`);
      }
    }
  }

  // 2. OpenAI GPT Models
  if (normalizedModelId.includes("gpt-")) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      console.log(`[UnifiedLLM] Calling official OpenAI API: ${normalizedModelId}`);
      try {
        const messages = [
          { role: "system", content: systemInstruction },
          { role: "user", content: [] as any }
        ];

        const userContent: any[] = [{ type: "text", text: promptText }];
        if (imagePayloads && imagePayloads.length > 0) {
          for (const img of imagePayloads) {
            userContent.push({
              type: "image_url",
              image_url: {
                url: `data:${img.mimeType};base64,${img.data}`
              }
            });
          }
        } else if (imagePayload) {
          userContent.push({
            type: "image_url",
            image_url: {
              url: `data:${imagePayload.mimeType};base64,${imagePayload.data}`
            }
          });
        }
        messages[1].content = userContent;

        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openaiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: normalizedModelId,
            messages,
            response_format: isJson ? { type: "json_object" } : undefined
          })
        });

        if (res.ok) {
          const body = (await res.json()) as any;
          return body.choices?.[0]?.message?.content || "{}";
        } else {
          const errMsg = await res.text();
          throw new Error(`OpenAI API call returned non-200 status (${res.status}): ${errMsg}. Please try another model.`);
        }
      } catch (err: any) {
        throw new Error(`Error connecting to OpenAI: ${err.message || err}. Please try another model.`);
      }
    }
  }

  // 3. DeepSeek Models
  if (normalizedModelId.includes("deepseek-")) {
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    if (deepseekKey) {
      console.log(`[UnifiedLLM] Calling official DeepSeek API: ${normalizedModelId}`);
      try {
        const messages = [
          { role: "system", content: systemInstruction },
          { role: "user", content: promptText }
        ];

        const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${deepseekKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: normalizedModelId === "deepseek-chat" ? "deepseek-chat" : "deepseek-reasoner",
            messages,
            response_format: isJson ? { type: "json_object" } : undefined
          })
        });

        if (res.ok) {
          const body = (await res.json()) as any;
          return body.choices?.[0]?.message?.content || "{}";
        } else {
          const errMsg = await res.text();
          throw new Error(`DeepSeek API call returned non-200 status (${res.status}): ${errMsg}. Please try another model.`);
        }
      } catch (err: any) {
        throw new Error(`Error connecting to DeepSeek: ${err.message || err}. Please try another model.`);
      }
    }
  }

  // 4. Gemini SDK
  const ai = getGeminiClient();

  if (!normalizedModelId.includes("gemini")) {
    throw new Error(`API key is not configured for ${normalizedModelId}. Please configure it in Settings or try another model.`);
  }
  
  let targetGeminiModel = normalizedModelId;
  if (targetGeminiModel === "gemini" || targetGeminiModel === "gemini-flash" || targetGeminiModel === "default") {
    targetGeminiModel = "gemini-3.5-flash-lite";
  } else if (targetGeminiModel === "gemini-2.0-flash" || targetGeminiModel === "gemini-1.5-flash") {
    targetGeminiModel = "gemini-2.5-flash";
  } else if (targetGeminiModel === "gemini-1.5-pro" || targetGeminiModel === "gemini-2.0-pro") {
    targetGeminiModel = "gemini-2.5-pro";
  }

  const initialParts: any[] = [];
  if (imagePayloads && imagePayloads.length > 0) {
    for (const img of imagePayloads) {
      if (img.data && img.data.length > 0) {
        initialParts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.data
          }
        });
      }
    }
  } else if (imagePayload && imagePayload.data && imagePayload.data.length > 0) {
    initialParts.push({
      inlineData: {
        mimeType: imagePayload.mimeType,
        data: imagePayload.data
      }
    });
  }

  let resolvedInstruction = systemInstruction;

  if (promptText && promptText.length > 0) {
    initialParts.push({ text: promptText });
  }

  // Ensure we have at least one valid part
  if (initialParts.length === 0) {
    initialParts.push({ text: "Please process the request." });
  }

  const contents: any[] = [
    {
      role: "user",
      parts: initialParts
    }
  ];

  const configObj: any = {
    responseMimeType: isJson ? "application/json" : "text/plain",
    systemInstruction: resolvedInstruction,
    tools: []
  };

  if (typeof temperature === 'number') {
    configObj.temperature = temperature;
  }

  // Enable native reasoning for models that support it (Gemini Pro, Flash, Flash-Lite models e.g. 3.5-flash-lite, 3.1-flash, 2.5-pro)
  if (isJson && !skipThinking && (
    normalizedModelId.includes("pro") || 
    normalizedModelId.includes("flash") ||
    normalizedModelId.includes("3.5") ||
    normalizedModelId.includes("2.5") ||
    normalizedModelId.includes("3.1")
  )) {
    configObj.thinkingConfig = {
      thinkingBudget: 1024,
      includeThoughts: true
    };
  }
  
  if (responseSchema) {
    configObj.responseSchema = responseSchema;
  }
  
  if (maxOutputTokens) {
    configObj.maxOutputTokens = maxOutputTokens;
  }
  
  if (enablePlaceIdTool) {
    configObj.tools.push({
      functionDeclarations: [
        {
          name: "get_google_maps_place_id",
          description: "Retrieves the exact Google Maps Place ID when given a business name and coordinates.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              business_name: { type: Type.STRING },
              latitude: { type: Type.STRING },
              longitude: { type: Type.STRING }
            },
            required: ["business_name", "latitude", "longitude"]
          }
        }
      ]
    });
  }

  if (enablePlaceIdTool) {
    configObj.toolConfig = { includeServerSideToolInvocations: true };
  }

  if (configObj.tools.length > 0) {
    if (configObj.responseSchema) {
      _localAddDebugLog(`[UnifiedLLM] Tools enabled (${configObj.tools.length}). Stripping responseSchema to prevent Gemini 400 INVALID_ARGUMENT error.`);
      delete configObj.responseSchema;
    }
  } else {
    delete configObj.tools;
  }

  let finalResponseText = "{}";
  const stageTag = logStagePrefix ? `:${logStagePrefix}` : '';
  _localAddDebugLog(`[UnifiedLLM${stageTag}] Dispatching prompt to model: "${targetGeminiModel}". Contents turns: ${contents.length}.`);
  _localAddDebugLog(`[UnifiedLLM${stageTag}] Attaching ${imagePayloads?.length || (imagePayload ? 1 : 0)} image part(s) to model "${targetGeminiModel}".`);
  _localAddDebugLog(`[UnifiedLLM-Prompt${stageTag}] System Instruction:\n${resolvedInstruction}`);
  _localAddDebugLog(`[UnifiedLLM-Prompt${stageTag}] User Prompt:\n${promptText}`);

  const isGemini404Error = (err: any) => err?.status === 404 || err?.code === 404 || String(err?.message || "").includes("404") || String(err?.message || "").includes("NOT_FOUND");

  try {
    let response: any;
    let thoughtsText = "";
    if (onStream && (!configObj.tools || configObj.tools.length === 0)) {
      try {
        const stream = await withGeminiRetry(() => ai.models.generateContentStream({
          model: targetGeminiModel,
          contents,
          config: configObj
        }), { label: "Unified LLM Stream" });
        let fullText = "";
        for await (const chunk of stream) {
          if (chunk.candidates?.[0]?.content?.parts) {
            for (const part of chunk.candidates[0].content.parts) {
              if (part.thought && part.text) {
                thoughtsText += part.text;
                onStream(part.text, true); // true = isThought
              } else if (part.text) {
                fullText += part.text;
                onStream(part.text, false);
              }
            }
          } else if (chunk.text) {
            fullText += chunk.text;
            onStream(chunk.text, false);
          }
        }
        response = { text: fullText, functionCalls: [] };
      } catch (streamErr: any) {
        if (isGeminiQuotaError(streamErr)) {
          noteGeminiQuota(targetGeminiModel, streamErr);
          throw streamErr;
        }
        if (isGeminiUnavailableError(streamErr)) {
          addDebugLog(`[UnifiedLLM] Stream 503 on ${targetGeminiModel} â€” not falling back to a second generateContent (that doubles quota).`);
          throw streamErr;
        }
        if (isGemini404Error(streamErr) && targetGeminiModel !== "gemini-2.5-flash") {
          addDebugLog(`[UnifiedLLM] Model "${targetGeminiModel}" returned 404 NOT_FOUND. Automatically falling back to "gemini-2.5-flash"...`);
          targetGeminiModel = "gemini-2.5-flash";
        }
        const errMsg = String(streamErr?.message || streamErr || "").toLowerCase();
        const isAbortOrTimeout = streamErr?.name === 'AbortError' || 
                                 errMsg.includes('abort') || 
                                 errMsg.includes('stalled') || 
                                 errMsg.includes('timeout') || 
                                 errMsg.includes('timed out');
        if (isAbortOrTimeout) {
          addDebugLog(`[UnifiedLLM] Stream aborted/timed out (${streamErr?.message}) â€” throwing directly without non-streaming fallback.`);
          throw streamErr;
        }
        addDebugLog(`[UnifiedLLM] Stream failed (${streamErr?.message}). Falling back to non-streaming generateContent on "${targetGeminiModel}"...`);
        const fullRes = await withGeminiRetry(() => ai.models.generateContent({
          model: targetGeminiModel,
          contents,
          config: configObj
        }), { label: "Unified LLM Stream Fallback" });
        let fullText = fullRes.text || "";
        if (onStream) onStream(fullText, false);
        response = { text: fullText, candidates: fullRes.candidates, functionCalls: fullRes.functionCalls };
      }
    } else {
      try {
        response = await withGeminiRetry(() => ai.models.generateContent({
          model: targetGeminiModel,
          contents,
          config: configObj
        }), { label: "Unified LLM" });
      } catch (genErr: any) {
        if (isGemini404Error(genErr) && targetGeminiModel !== "gemini-2.5-flash") {
          addDebugLog(`[UnifiedLLM] Model "${targetGeminiModel}" returned 404 NOT_FOUND. Automatically falling back to "gemini-2.5-flash"...`);
          targetGeminiModel = "gemini-2.5-flash";
          response = await withGeminiRetry(() => ai.models.generateContent({
            model: targetGeminiModel,
            contents,
            config: configObj
          }), { label: "Unified LLM Fallback 2.5-flash" });
        } else {
          throw genErr;
        }
      }
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.thought && part.text) {
            thoughtsText += part.text;
          }
        }
      }
    }


    let finalJson = response.text || "";
    // Inject native thoughts as "_internalReasoning" back into final JSON so existing code downstream works seamlessly.
    // Skipped when the caller's schema already nests its own reasoning field (see skipThoughtInjection above).
    if (isJson && finalJson && thoughtsText && !skipThoughtInjection) {
      try {
        const parsed = JSON.parse(finalJson);
        
        if (!parsed._internalReasoning) {
          parsed._internalReasoning = thoughtsText;
          finalJson = JSON.stringify(parsed);
        }
      } catch (e) {}
    }
    // response.text is a getter-only property on the SDK's GenerateContentResponse class â€”
    // assigning to it throws and was silently forcing every call through the slow REST
    // fallback below. Rebuild `response` as a plain object so downstream code in this
    // function can keep reading response.text / response.functionCalls / response.candidates
    // exactly as before, without touching the SDK instance.
    response = { text: finalJson, candidates: response.candidates, functionCalls: response.functionCalls };
    
    let callCount = 0;
    const maxCalls = 5;
    while (response.functionCalls && response.functionCalls.length > 0 && callCount < maxCalls) {
      callCount++;
      const calls = response.functionCalls;
      _localAddDebugLog(`[UnifiedLLM] Received ${calls.length} tool call requests from Gemini (Turn ${callCount}/${maxCalls}).`);
      const modelParts: any[] = [];
      const userParts: any[] = [];

      for (const call of calls) {
        let functionResponseData = {};
        if (call.name === "get_google_maps_place_id") {
          try {
            const { business_name, latitude, longitude } = call.args as any;
            _localAddDebugLog(`[UnifiedLLM] Call args: business_name="${business_name}", lat="${latitude}", lng="${longitude}"`);
            const pId = await fetchGoogleMapsPlaceId(business_name, latitude, longitude, explicitSessionId);
            if (pId === "ERROR_API_FAILED" || pId === "NOT_FOUND") {
              functionResponseData = { 
                place_id: "NOT_FOUND", 
                instruction: "STOP TOOL USE. The Google Maps API call failed or the key is missing. Immediately use standard coordinate URLs for all remaining items without calling this tool again." 
              };
            } else {
              functionResponseData = { place_id: pId };
            }
          } catch (e: any) {
            _localAddDebugLog(`[UnifiedLLM] Exception executing tool call: ${e.message || e}`);
            functionResponseData = { 
              place_id: "NOT_FOUND", 
              instruction: "STOP TOOL USE. An exception occurred during tool execution. Immediately use standard coordinate URLs for all remaining items without calling this tool again." 
            };
          }
        } else {
          _localAddDebugLog(`[UnifiedLLM] Warning: Unknown tool requested: "${call.name}"`);
        }
        
        modelParts.push({ functionCall: call });
        userParts.push({
          functionResponse: {
            name: call.name,
            response: functionResponseData
          }
        });
      }

      // Add the model's response (preserving thought_signature and candidates structure) to contents
      const modelContent = response.candidates?.[0]?.content;
      if (modelContent) {
        contents.push(modelContent);
      } else {
        contents.push({
          role: "model",
          parts: modelParts
        });
      }

      // Add our function responses to contents
      contents.push({
        role: "user",
        parts: userParts
      });

      addDebugLog(`[UnifiedLLM] Feeding responses back to Gemini and requesting next content turn...`);
      response = await withGeminiRetry(() => ai.models.generateContent({
        model: targetGeminiModel,
        contents,
        config: configObj
      }), { label: "Unified LLM" });
    }

    if ((response.functionCalls && response.functionCalls.length > 0) || !response.text) {
      addDebugLog(`[UnifiedLLM] Reached maximum tool calls or text is empty. Forcing model to produce final text...`);
      contents.push({
        role: "user",
        parts: [{ text: "Please provide your final JSON response now based on the information retrieved so far. Do not call any more tools." }]
      });
      const forceTextConfig = { ...configObj };
      delete forceTextConfig.tools;
      delete forceTextConfig.toolConfig;
      response = await withGeminiRetry(() => ai.models.generateContent({
        model: targetGeminiModel,
        contents,
        config: forceTextConfig
      }), { label: "Unified LLM" });
    }
    
    addDebugLog(`[UnifiedLLM] Successfully completed content generation. Response length: ${response.text?.length || 0} chars.`);
    const __respText = response.text || "{}";
    const __respLogged = __respText;
    addDebugLog(`[UnifiedLLM-Response${stageTag}] Complete response returned from agent:\n${__respLogged}`);
    return response.text || "{}";
  } catch (err: any) {
    addDebugLog(`[UnifiedLLM] First generation attempt failed: ${err.message || err}. Stack: ${err.stack}`);
    
    if (googleSearch) {
      addDebugLog(`[UnifiedLLM] Grounding tool failed or search quota limit reached (${err.message || err}). Retrying without Google Search Grounding...`);
      const fallbackConfig = { ...configObj };
      delete fallbackConfig.tools;
      if (enablePlaceIdTool) {
        // keep the custom tool
        fallbackConfig.tools = [{
          functionDeclarations: [
            {
              name: "get_google_maps_place_id",
              description: "Retrieves the exact Google Maps Place ID when given a business name and coordinates.",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  business_name: { type: Type.STRING },
                  latitude: { type: Type.STRING },
                  longitude: { type: Type.STRING }
                },
                required: ["business_name", "latitude", "longitude"]
              }
            }
          ]
        }];
      }
      try {
        // Reset contents to initial state for fallback to avoid duplicated turns
        const fallbackContents = [contents[0]];
        addDebugLog(`[UnifiedLLM-Fallback] Dispatching prompt to model without search grounding...`);
        let response = await withGeminiRetry(() => ai.models.generateContent({
          model: targetGeminiModel,
          contents: fallbackContents,
          config: fallbackConfig
        }), { label: "Unified LLM" });
        
        // Handle function calls loop for fallback
        let callCountFallback = 0;
        const maxCallsFallback = 5;
        while (response.functionCalls && response.functionCalls.length > 0 && callCountFallback < maxCallsFallback) {
          callCountFallback++;
          const calls = response.functionCalls;
          addDebugLog(`[UnifiedLLM-Fallback] Received ${calls.length} tool call requests (Turn ${callCountFallback}/${maxCallsFallback}).`);
          const modelParts: any[] = [];
          const userParts: any[] = [];

          for (const call of calls) {
            let functionResponseData = {};
            if (call.name === "get_google_maps_place_id") {
              try {
                const { business_name, latitude, longitude } = call.args as any;
                addDebugLog(`[UnifiedLLM-Fallback] Call args: business_name="${business_name}", lat="${latitude}", lng="${longitude}"`);
                const pId = await fetchGoogleMapsPlaceId(business_name, latitude, longitude, explicitSessionId);
                if (pId === "ERROR_API_FAILED" || pId === "NOT_FOUND") {
                  functionResponseData = { 
                    place_id: "NOT_FOUND", 
                    instruction: "STOP TOOL USE. The Google Maps API call failed or the key is missing. Immediately use standard coordinate URLs for all remaining items without calling this tool again." 
                  };
                } else {
                  functionResponseData = { place_id: pId };
                }
              } catch (e: any) {
                addDebugLog(`[UnifiedLLM-Fallback] Exception executing tool call: ${e.message || e}`);
                functionResponseData = { 
                  place_id: "NOT_FOUND", 
                  instruction: "STOP TOOL USE. An exception occurred during tool execution. Immediately use standard coordinate URLs for all remaining items without calling this tool again." 
                };
              }
            }
            
            modelParts.push({ functionCall: call });
            userParts.push({
              functionResponse: {
                name: call.name,
                response: functionResponseData
              }
            });
          }

          const modelContent = response.candidates?.[0]?.content;
          if (modelContent) {
            fallbackContents.push(modelContent);
          } else {
            fallbackContents.push({ role: "model", parts: modelParts });
          }
          fallbackContents.push({ role: "user", parts: userParts });

          addDebugLog(`[UnifiedLLM-Fallback] Feeding responses back to Gemini...`);
          response = await withGeminiRetry(() => ai.models.generateContent({
            model: targetGeminiModel,
            contents: fallbackContents,
            config: fallbackConfig
          }), { label: "Unified LLM" });
        }

        if ((response.functionCalls && response.functionCalls.length > 0) || !response.text) {
          addDebugLog(`[UnifiedLLM-Fallback] Reached maximum tool calls or text is empty on fallback. Forcing final text...`);
          fallbackContents.push({
            role: "user",
            parts: [{ text: "Please provide your final JSON response now based on the information retrieved so far. Do not call any more tools." }]
          });
          const forceTextConfig = { ...fallbackConfig };
          delete forceTextConfig.tools;
          delete forceTextConfig.toolConfig;
          response = await withGeminiRetry(() => ai.models.generateContent({
            model: targetGeminiModel,
            contents: fallbackContents,
            config: forceTextConfig
          }), { label: "Unified LLM" });
        }
        
        addDebugLog(`[UnifiedLLM-Fallback] Successfully completed content generation on fallback. Response length: ${response.text?.length || 0} chars.`);
        addDebugLog(`[UnifiedLLM-Fallback-Response] Complete response returned from agent on fallback:\n${response.text || "{}"}`);
        return response.text || "{}";
      } catch (retryErr: any) {
        addDebugLog(`[UnifiedLLM-Fallback] Error on fallback retry: ${retryErr.message || retryErr}`);
        throw retryErr;
      }
    }

    const isAbort = err.name === 'AbortError' || (err.message && err.message.toLowerCase().includes('abort'));
    const isQuota = err.message && (err.message.includes('429') || err.message.includes('quota') || err.message.toLowerCase().includes('resource_exhausted'));
    
    if (isAbort || isQuota) {
      addDebugLog(`[UnifiedLLM] Fatal error (${isAbort ? 'Timeout' : 'Quota'}) detected. Throwing immediately without retry.`);
      throw err;
    } else {
      throw err;
    }
  }
  } catch (err: any) {
    throw err;
  }
}

// Endpoint to fetch real server start/uptime status for accurate publication timing
app.get("/api/debug/live-stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();

  liveStreamClients.add(res);
  res.write(`data: ${JSON.stringify({ message: "=== GLOBAL LIVE STREAM CONNECTED ===" })}\n\n`);
  if (typeof (res as any).flush === 'function') (res as any).flush();

  const pingInterval = setInterval(() => {
    try {
      res.write(": ping\n\n");
      if (typeof (res as any).flush === 'function') (res as any).flush();
    } catch (e) {
      clearInterval(pingInterval);
      liveStreamClients.delete(res);
    }
  }, 15000);

  const cleanupStream = () => {
    clearInterval(pingInterval);
    liveStreamClients.delete(res);
  };
  req.on("close", cleanupStream);
  res.on("finish", cleanupStream);
  res.on("error", cleanupStream);
});

app.get("/api/status", (req, res) => {
  res.json({ startTime: SERVER_START_TIME });
});

// Sync & Admin endpoints are handled by syncRouter and adminRouter in server_routes_sync.ts and server_routes_admin.ts


// GET Endpoint for System Instruction Preview
app.get("/api/gemini/instruction-preview", async (req, res) => {
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
app.post("/api/gemini/front-desk", async (req, res) => {
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
  msg = msg.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?'"â€œâ€\[\]]/g, ' ');

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

app.post("/api/gemini/food-analyze", async (req, res) => {
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
            let cleanResult = JSON.parse(JSON.stringify(body));
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
      res.write(`data: ${JSON.stringify({ final: true, result: body })}\n\n`);
      res.end();
      return res;
    };
  }

  const sendStreamEvent = (data: any) => {
    if (isStream && hasSentHeaders) {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (typeof (res as any).flush === 'function') (res as any).flush();
      } catch (e) {}
    }
  };

  await streamDebugLogStorage.run((_msg: string) => {
    // sendLog() below already broadcasts its own tagged event directly â€” every message
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

    // B5 â€” Detect weight/portion refine on prior scout (skip Vision Scout + DB when safe).
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
        }));
        visionScoutRanAndReturnedItems = true;
        addDebugLog(`[Edit Continuity] Inherited ${visionScoutItems.length} items from activeMeal into visionScoutItems for edit.`);
      }
    }
    let scoutScratchpad: string | undefined;
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
              addDebugLog(`[Vision Scout] Aborting further scout retries â€” 429 quota on this model. Switch model or wait.`);
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
              `Vision Scout Failed: Gemini quota (429) on this model â€” wait the retry-after window or switch model. Not a bad photo. (Details: ${raw})`
            );
          }
          if (isUnavailable) {
            throw new Error(`Vision Scout Failed: Gemini unavailable (503). Retry shortly. (Details: ${raw})`);
          }
          throw new Error(`Vision Scout Failed: Couldn't reliably read this image, please try again or re-upload. (Details: ${raw})`);
        }

        // Vision Scout _internalReasoning is removed per user request

          visionScoutItems = (scoutResult.items || []).map((item: any) => ({
            ...item,
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

    // Strip parenthetical local-language notes for cleaner USDA/OFF matching
    // e.g. "raw beef slices (daging empal and blade)" â†’ "raw beef slices"
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

    // Clean and consolidate queries first
    const uniqueQueries = buildFoodSearchQuerySet(visionScoutItems || []);

    const chainPatterns: [string, RegExp][] = [
      ['sainsbury', /\bsainsbury\b/i],
      ['yolk', /\byolk\b/i],
      ['mcdonalds', /mcdonald|maccas|éº¦å½“åŠ³/i],
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

    // Task 1 cont.: DB search runs HERE â€” before portionClarify check â€” so candidates are
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
            addDebugLog(`[BrandGuard] Using generic USDA types for "${cleaned}" (not a brand â€” skip branded/OFF catalog)`);
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
        // Parent label is dish truth â€” skip component gap LLM too (macros locked later from label)
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
          addDebugLog(`[Food Resolver Skip] Complete printed label covers "${resItem.query}" â€” skipping LLM resolver for this gap.`);
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
          addDebugLog(`[Food Resolver Skip] Composite multi-component parent dish "${resItem.query}" is resolved via its sub-components â€” skipping monolithic LLM resolver gap.`);
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
                // nutrient data â€” doing so previously caused fresh produce and generic
                // USDA-matched ingredients to be mislabeled "(Package Label Truth)" /
                // "Nutrition Facts (OCR Label)" downstream (see FIX_FALSE_PACKAGE_LABEL_TRUTH_BADGE.md).
                c.rawNutritionLabel = match.rawNutritionLabel;
              }
            }
          });
        }
      });
    }

    // Task 2: portionClarify check â€” now placed AFTER DB search and Resolver so ALL candidates are available.
    // B1 â€” Pause before nutrient calculation when multi-serve pack portion is ambiguous.
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
    // resolve or fail the relevance check are silently dropped â€” the component falls
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
            addDebugLog(`[ScoutFdcHint] id=${task.fdcId} for query "${task.query}" did not resolve â€” falling through to normal search.`);
            return;
          }
          // Same relevance check as the final safety-net gate below (Task 1 stopword list).
          const hintStopwords = new Set(['cheese', 'canned', 'sauce', 'sauces', 'salad', 'dressing', 'cream', 'sliced', 'chopped', 'mixed', 'fresh', 'cooked', 'raw', 'shredded', 'grated', 'diced', 'whole', 'baked', 'fried', 'roasted', 'steamed', 'boiled', 'grilled', 'style', 'flavored', 'flavoured', 'plain', 'organic', 'natural', 'sweet', 'spicy', 'crushed', 'minced', 'topping', 'toppings', 'spread', 'filling', 'blend', 'garnish', 'crumbs', 'chunks', 'pieces', 'with', 'and', 'leaf', 'leaves', 'seed', 'seeds', 'green']);
          const qTokens = String(task.query).toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter((t: string) => t.length > 3 && !hintStopwords.has(t));
          const fNameLow = String(food.description || '').toLowerCase();
          const relevant = qTokens.length === 0 || qTokens.some((t: string) => fNameLow.includes(t));
          if (!relevant) {
            addDebugLog(`[ScoutFdcHint] Relevance check rejected hint id=${task.fdcId} ("${food.description}") for query "${task.query}" â€” falling through to normal search.`);
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
          if (pItem.nutrients) {
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
          // milk / coffee / beverage components â‰  oat porridge / grain dish / bread / bar
          if (/\b(milk|coffee|espresso|water|juice|tea)\b/i.test(qLow) &&
              !/\b(oat|oats|porridge|cereal|bread|bar)\b/i.test(qLow) &&
              /\b(oat|oats|porridge|cereal|bread|bar|cracker)\b/i.test(dbTitle)) return;
          // olives â‰  olive loaf / luncheon meat
          if (/\bolive/.test(qLow) && !/\bloaf|lunch|mortadella|sausage|bologna\b/.test(qLow) &&
              /\b(loaf|lunch|mortadella|sausage|bologna|pork)\b/i.test(dbTitle)) return;
          // salad leaves / mixed greens â‰  taro / cassava leaves
          if (/\b(salad|lettuce|mixed\s+salad|greens|leaves)\b/i.test(qLow) &&
              /\b(taro|cassava|amaranth leaves|bitterleaf)\b/i.test(dbTitle) &&
              !/\btaro\b/i.test(qLow)) return;
          // berries â‰  basil / herbs
          if (/\b(berr|blueberry|raspberry|strawberry|fruit)\b/i.test(qLow) &&
              /\b(basil|oregano|thyme|parsley|cilantro|herb)\b/i.test(dbTitle)) return;
          // fresh fruit / fruit cup / fruit salad â‰  yogurt / drink / milk / actimel / probiotic / smoothie
          if (/\b(fruit|mixed fruit|fruit cup|fruit salad)\b/i.test(qLow) &&
              !/\b(yogurt|yoghurt|drink|milk|smoothie|probiotic|drinkable)\b/i.test(qLow) &&
              /\b(yogurt|yoghurt|drink|milk|smoothie|actimel|danone|probiotic|drinkable)\b/i.test(dbTitle)) return;
          // salad dish â‰  salad dressing / vinaigrette / sauce
          if (/\bsalad\b/i.test(qLow) && !/\bdressing|sauce|dip|vinaigrette\b/i.test(qLow) &&
              /\bdressing|sauce|dip|vinaigrette\b/i.test(dbTitle)) return;

          // RULE 3: Token Overlap & Noise Penalty
          let score = 0;
          
          // chickpeas in a salad/meal â†’ prefer not dry raw beans
          if (/\bchickpea|garbanzo\b/i.test(qLow) && !/\bdry\b/i.test(qLow) &&
              /\bdry\b/i.test(dbTitle) && !/\bcooked|canned|boiled\b/i.test(dbTitle)) {
            score -= 80; // heavy penalty; allow if nothing else later
          }
          // fruit compote â‰  pure syrup
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
          // Missing â†’ null (unlockable for USDA/component fill). Present zero â†’ real 0 (locked).
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
          // (US FDA format). UK/EU "of which sugars" is Total Sugar, not Added Sugar â€” do NOT
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

      // Helper to normalize strings for robust matching across special characters (Â®, â„¢, â€™, etc.)
      const normalizeFoodStr = (s: string) => 
        s ? s.toLowerCase().replace(/[Â®â„¢]/g, '').replace(/[â€™']/g, "'").trim() : '';
      
      const origNorm = normalizeFoodStr(item.originalName || '');
      const keyNorm = normalizeFoodStr(item.keyword || '');
      
      const isFuzzyMatch = (m: any) => {
        if (!m || Number(m.calories) <= 0) return false;

        // Reject incomplete garbage matches (like web search parsing errors) that lack basic macros.
        // A valid match should have at least 2 macros explicitly parsed (even if the value is 0).
        // EXEMPT brand_official (your own curated restaurant menu DB) from this check â€” those are
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
        // chain's menu and must not count as distinguishing evidence of identity â€” otherwise
        // two unrelated dishes from the same brand that both happen to be a "bowl" satisfy the
        // shared>=2 threshold below purely on brand name + generic form word (B-DISHID-01).
        const chainTokens = new Set(tokenize(String(detectedChainKey || '').replace(/_/g, ' ')));
        const isNoiseToken = (t: string) => DISH_FORM_WORDS.has(t) || chainTokens.has(t);

        const checkTokenMatch = (targetTokens: string[]) => {
          if (targetTokens.length === 0 || mTokens.length === 0) return false;

          // Guard: if the query names a specific dish "form" (side, sandwich, cup, bowl, bites,
          // etc.) and the candidate names a DIFFERENT form, reject outright. Sharing brand + main
          // ingredient words (e.g. "chicken") is not enough â€” "Chicken Side" and "Chicken
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
          // Require at least 2 shared DISTINGUISHING tokens for brand_official candidates â€”
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
            // Label had 0 cals / missing nutrients â€” adopt database match instead of locking to 0
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
        // the truth source is a printed label â€” that path previously overwrote correct
        // label-scaled locks (e.g. Co-op beef 37kcal/7.3p/63mg Na â†’ USDA 35/5.5/10.7).
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

            if (!hasExplicitFraction && rawServingScale >= 0.5 && rawServingScale <= 2.5) {
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
          // CRITICAL: locks were filled before reject â€” clear them so budget/reconcile do not hard-lock fake web calories
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
            // Prefer locked / printed sugar â€” never hardcode 0 when label had sugars
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

          // Soft micros from USDA/web (label path) â€” estimates only, not truth locks
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
          // Estimated component/USDA fill must NEVER appear here â€” only in calculation tables.
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
          // visually-guessed ingredient list when both are present â€” the Scout's guess is
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
            addDebugLog(`[MatchPriority] mega-component query split: "${rawQuery}" â†’ match "${matchQuery}"`);
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
          // Task 4: Cross-category guard â€” a bread/grain component query must not resolve to a
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
          // if they were a genuine, confident single match â€” silently poisoning the item with
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
              addDebugLog(`[MatchPriority] Relevance gate rejected "${bestMatch.name}" (id=${bestMatch.id}) for query "${query}" â€” ${!catCompat.compatible ? catCompat.reason : 'no meaningful token overlap'}.`);
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
          // missing â€” it never overwrites a component that already has any real macro data.
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
              ? `ðŸ“– [${cleanName}](https://fdc.nal.usda.gov/fdc-app.html#/food-details/${dictFdcId}/nutrients)`
              : `ðŸ“– ${cleanName}`;
          } else if (fdcIdCand && !isNaN(Number(fdcIdCand))) {
            const cleanName = bestMatch.name ? bestMatch.name.replace(/\s*\((internal_catalog|internal catalog|usual_catalog)\)/gi, '') : query;
            compLabel = `ðŸ“– [${cleanName}](https://fdc.nal.usda.gov/fdc-app.html#/food-details/${fdcIdCand}/nutrients)`;
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
            const wBucket = Math.round((Number(c.weightGrams) || 0) / 2) * 2; // Â±1g collapse
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
            addDebugLog(`[Receipt] dedupe componentsDetailList ${beforeLen}â†’${afterLen} for "${item.originalName || item.keyword}"`);
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

        // Typed fractions: emulsion ~12%, other sauces ~12% of item (was 25%/20% â€” systematically high)
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
      // Only claim full "label" trust (which skips validation) when NOTHING was backfilled â€”
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

      // Genuine hard calories: printed OCR/label or brand_official only â€” NEVER web_search / category / estimated
      const printedCaloriesPresent =
        labelCalVal != null &&
        labelCalVal > 0 &&
        rawLabelObj &&
        (rawLabelObj.calories != null && String(rawLabelObj.calories).trim() !== '' && String(rawLabelObj.calories).toLowerCase() !== 'null');

      // Hard kcal only if we have printed label calories OR locked brand/label truth â€” not web
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
      // Soft/scout budget must not silently scale rows (wrap Ã—0.730 / salad 2.000).
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
        addDebugLog(`[Reconcile] refused silent scale for "${itemNameForBudget}" â€” keep foundation=${recRes.foundationKcal}`);
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
      // aggregateItemsNutrients pass will save. This runs regardless of soft/hard budget â€”
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
          // Only scale rows UP/DOWN to item when budget hard-locked from printed/brand â€” never for web fakes
          const genuineHardCal =
            budgetRes.hardLock === true &&
            (budgetRes.source === 'label' || budgetRes.source === 'brand') &&
            inv.itemCalories > 0 &&
            inv.rowSum > 0;
          if (genuineHardCal) {
            const fix = inv.itemCalories / inv.rowSum;
            // refuse absurd repair factors (identity failure)
            if (fix < 0.5 || fix > 2.0) {
              addDebugLog(`[ReceiptInvariant] SKIP rowsâ†’item factor=${fix.toFixed(3)} out of band; prefer foundation/scout`);
              if (inv.rowSum > 0) {
                aggregatedNutrients.calories = Math.round(inv.rowSum * 10) / 10;
                addDebugLog(`[ReceiptInvariant] REPAIRED itemCalâ†’rowSum ${inv.itemCalories}â†’${inv.rowSum}`);
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
              addDebugLog(`[ReceiptInvariant] REPAIRED rowsâ†’item lock factor=${fix.toFixed(3)}`);
            }
          } else if (recRes.action === 'scale' || recRes.action === 'keep' || budgetRes.source === 'scout' || budgetRes.source === 'category') {
            if (!budgetRes.hardLock && inv.rowSum > 0 && inv.itemCalories > 0 && Math.abs(inv.rowSum - inv.itemCalories) > 1.1) {
              const aligned = applySoftReceiptAlignment(inv.itemCalories, inv.rowSum);
              aggregatedNutrients.calories = aligned.itemCalories;
              addDebugLog(`[ReceiptInvariant] itemCal:=rowSum ${inv.itemCalories}â†’${aligned.itemCalories} (no row scale)`);
            }
          } else if (inv.rowSum > 0) {
            // legacy: only when no scout/category budget
            aggregatedNutrients.calories = Math.round(inv.rowSum * 10) / 10;
            addDebugLog(`[ReceiptInvariant] REPAIRED itemCalâ†’rowSum ${inv.itemCalories}â†’${inv.rowSum}`);
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
        imageCtx = `\n[Context: ${imagePayloads.length} images are attached above. One or more may be a close-up photo of a printed Nutrition Facts label rather than the food itself. First determine which image(s), if any, show a nutrition facts/label panel. For any such label image: read its exact printed per-serving values and stated serving size, then mathematically scale those exact numbers to the actual weight/quantity consumed as shown in the other image(s) or described by the user â€” do not substitute your own estimate when a label is legible. For any remaining image(s) showing the actual food, rely on visual cues for portion sizing, ingredients, and freshness as usual.]\n`;
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
        // by this exact scoutIndex â€” showing array position here silently mismatches items
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
              action: { type: Type.STRING, enum: ['update_weight', 'remove_item', 'add_item', 'rename_alias', 'update_cooking_method'] },
              itemName: { type: Type.STRING },
              newWeightGrams: { type: Type.INTEGER },
              targetDbId: { type: Type.STRING, nullable: true },
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
          if (typeof b === "string") return `â€¢ ${b}`;
          if (b && typeof b === "object" && b.name) {
            const statusStr = b.status ? ` is ${String(b.status).toUpperCase()}` : "";
            const valStr = b.value !== undefined ? ` (${b.value} ${b.unit || ""}, normal range: ${b.normalRange || ""})` : "";
            return `â€¢ ${b.name}${statusStr}${valStr}`;
          }
          return `â€¢ ${String(b)}`;
        }).join("\n") + "\n";
    }
    const finalSystemInstruction = customSystemInstruction || systemInstruction;
    const modeDPromptSuffix = (userSelectedMode === 'compare') 
      ? `\n\nIf MODE D (evaluation/comparison) applies: reference every item ONLY by its Index number from the Scout list above inside "scoutItemIndices". Every Index must be assigned to at least one group â€” including duplicate-named items, which are still separate indices. You are allowed to map the same Scout Index to multiple groups if a physical shelf contains items belonging to both categories. Do not restate names, bounding boxes, or database IDs.`
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

      // Sanitize pathological weightGrams values like "350.000000...000" â†’ "350"
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
      // comes from â€” so this does not remove the _internalReasoning. It removes the
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
        comparison: comparisonData,
        comparisonSet,
        scoutItems: mergeScoutItems(visionScoutItems, rawParsed.scoutItems),
        scoutContentType: visionScoutContentType,
        agentPrompt: fullPromptSent,
        message: rawParsed.message,
        text: rawParsed.message,
        apiCalls
      };

      if (isStream && hasSentHeaders) {
        res.write(`data: ${JSON.stringify({ final: true, result: responsePayload })}\n\n`);
        return res.end();
      }

      return res.json(responsePayload);
    }

    if (originalModeIsModify && rawParsed.foodData && rawParsed.foodData.itemsBreakdown && rawParsed.foodData.itemsBreakdown.length > 0) {
      addDebugLog(`[Mode Rewrite] AI fully regenerated foodData in MODIFY mode. Routing through NEW_LOG pipeline to compute full nutrients.`);
      mode = "new_log";
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
        // NOTE: Only weight-INDEPENDENT reference data belongs in this list â€” things that
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
            // real printed label â€” do not let it set dbSource:'label'. Only item.source
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
      // instruction, with no code-level enforcement â€” see agents/dietitianInstructions.ts).
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
        parsedData.verdict = {
          label: String(rawVerdict.label || 'Balanced Choice'),
          level: String(rawVerdict.level || 'neutral')
        };
      } else if (rawFoodData.recommendation && typeof rawFoodData.recommendation === 'string' && rawFoodData.recommendation.trim().length > 0) {
        parsedData.verdict = {
          label: String(rawFoodData.recommendation),
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
              return false;
            });
            if (!preMatch && item.scoutIndex === undefined) {
              preMatch = preCalculatedItems[idx] || null;
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
              
              if (!hasKeywordMatch && !hasTokenOverlap && itemLower && (pOrigLower || pKwLower)) {
                 addDebugLog(`[First-Principles Injection] Anomaly: index=${hasExplicitScoutIndexMatch ? 'agree' : 'no'} but names "${itemLower}" vs "${pOrigLower || pKwLower}" do not match. Aborting cross-wired injection.`);
                 preMatch = null;
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
            return false; // Fuzzy token matching was causing ID collisions (e.g. Meatball wrap matching Falafel wrap because they both share "wrap").
          });
          if (!preMatch && item.scoutIndex === undefined) {
             // Name only â€” never array position (4106 phantom).
             preMatch = preCalculatedItems.find((p: any) => namesReferToSameFood(
               item.canonicalDbName || item.name,
               p.originalName || p.keyword
             )) || null;
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
            
            if (!hasKeywordMatch && !hasTokenOverlap && itemLower && (pOrigLower || pKwLower)) {
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
            (Array.isArray(item.componentsDetailList) && item.componentsDetailList.length >= 2)
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
              // Not a genuine photographed/OCR'd label â€” computed from an internal DB match.
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
              // Backed out from our own computed totals, not a genuine printed label â€” flag as synthetic.
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
          const finalFiber = parsedData.nutrients.fiber || 0;

          if (parsedData.message) {
            parsedData.message = synchronizeNarrativeText(parsedData.message, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs, finalFiber);
          }
          if (rawParsed && rawParsed.message) {
            rawParsed.message = synchronizeNarrativeText(rawParsed.message, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs, finalFiber);
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
        let receiptTable = "### ðŸ§¾ Nutrition calculation\n\n";
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
            ? ` âš ï¸ [SANITY CHECK OVERRIDE: ${it.overrideReason || 'Adjusted Value'}]`
            : (it.isUnverified ? " âš ï¸ (Est)" : "");

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
          const pfIcon = ` [â„¹ï¸](#info "${pfTooltip}")`;

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
          // items â€” do not add primaryBaseWeightG on top of it (double-count weight).
          const primaryAlreadyInList = Boolean(it.hasComponents) ||
            (it.componentsDetailList && it.componentsDetailList.length >= 2);

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
          // canonical match (e.g. "blueberry" â†’ raw blueberries FDC) hijack a LABEL row,
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
            dbRefTag = `ðŸ“– [${cleanItemName}](https://fdc.nal.usda.gov/fdc-app.html#/food-details/${canonicalBase.fdcId}/nutrients)`;
          } else if (canonicalBase) {
            dbRefTag = `ðŸ“– ${cleanItemName}`;
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
          // OR â‰¥2 detail rows). Never print primary on top of that list.
          const listIsMulti =
            Boolean(it.hasComponents) ||
            (Array.isArray(it.componentsDetailList) && it.componentsDetailList.length >= 2);
          if (!listIsMulti) {
            receiptTable += `| ${dbRefTag} - ${baseW}g | ${fVal(portionBaseCal)} | ${fVal(portionBaseP, 'g')} | ${fVal(portionBaseSatFat, 'g')} | ${fVal(portionBaseNa, 'mg')} |\n`;
          }

          // Row 3: Sauce / Dressing / Sub-components (if any)
          if (it.componentsDetailList && Array.isArray(it.componentsDetailList) && it.componentsDetailList.length > 0) {
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
            receiptTable += `| ${physicsEngineLabel} [â„¹ï¸](#info "${infoTooltip}") | ${fVal(cookingCal, '', true)} | ${fVal(0, 'g', true)} | ${fVal(cookingSatFat, 'g', true)} | ${fVal(cookingNa, 'mg', true)} |\n`;
          }

          // 1. Calculate base ingredient nutrients for summation
          const base100Fat = safeNum(raw100.totalFat);
          const base100Carbs = safeNum(raw100.carbohydrates);
          const portionBaseFat = Math.round(base100Fat * baseFactor * 10) / 10;
          const portionBaseCarbs = Math.round(base100Carbs * baseFactor * 10) / 10;

          // Deterministic Component Row Summation
          // If componentsDetailList already contains the primary component
          // (multi-component items), do NOT also seed from portionBase* â€”
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
            it.componentsDetailList.fxœì½ÛrW–(ø®¯ØF¸€/²ªªéf) ’Øæ­	Ê.·ÌC%€$E •™EËœ8Oý:'Îû|ÅüÀ|JÁ|Â¬Ë¾çN”\v9­è.™;÷uíu¿dy?M[­bWDé][ìýY||"œ£,-JQìG3±'Ž£rÚÍ³e:†oº£h–åI\ˆŸ[mñ•(àI|•IÖþ&ÜÍY¥“Ež•q’ú€Ûðhþ·¦·—•ÞÊ¬Œf/£ò“ºD%~ê÷YDå2ÊxŒ/¿ØÛð<¾NÒx,žïõ®Øê>}ì¸'QuÌlœ,çØØý(Ê‡ÙônŒó“37¯ãb9ÇCÿý¾?,¼=£wg7¸øîeàÜd|ÍÚÀ†àû“(ðŽÊ³‚¿Ü÷ÎöÜÛKÚÜg³eû•Ý$éDÌãršE4'°i±kµ5K—­½0K”ï½e8Ë”Mª‹Õ•-p¹î„÷gq”
:Mœòu–‹r‹ëY•…Û“w±èIðääýæø¬öƒÐÍ0k? ¥~Zy°êÞb1»£…Ñ<yÍ’òNŒ¦ñèF,¸v€.ðõ"7 ”GËÂr*QQˆ"Ãwn³x<‰óÍ"zŠ(D¿sÅðl1½+’l–Mè§1‹2Á§ïãYÑuûà¼ q½Ó(Á—³XD…3)šÍ.üo^&Ñlcn®“ÙL$e<‡Y–ø÷$.yYñØ¯tâdQ¾ŽŠò[@1I<ãŽöò<ºë&ý·ÕJJÀ£É<Êï^DE¼½µ5Áé JÞ½Ša°9!(úº-~÷;±â‹ÊÝYœNÊ©ø³pÎ×™eÿú:•Éûø`8È–9ìÉÞª<Y4ŒgWr{€8qJcõ5 *øYÐví¨çû¸…'ËhQZÂžŸÇ£,ÿKÒIG¤Ëù0Îÿ3ú(ÉÚ•w¼#$ý¡g¡È®¼'aã÷]sàáè]¾ÇáàÚ]þ÷Õé'Å~6_dÀÂ9¯Dì9x¬åž/lÅ?Hq}t~Î}@{b§[çtE Ë~™åóÓá_ŸwíbÈYcÿôøìôÍÉÁÕq¿wÔð;ØüqØf·³ŸÙMüsÍ¢ñÏC6kÿ8ÜLº°Ø²5 ­ÆyÂîN’4šàáS¼‰ïná<ä¯T¾h4ÚmçæGxíÕ)Ú'[´œù¬;HÇû*ž'“iùÊ}±
”Ü–M»‚ÄÃåä(›{®\·•ÏoÙkÛ­Y¬zt”B›Ðñº”wW4ÑÀ´XÀ|%ü=ƒð>~·6¬í®ÅÊŒ¦Q’êMÐ¿p¥ér6ó›w)`_ÀØ
Ñg•§þgIqÓ¾Dx»Þï~iµòøom÷Ë{ë—ƒŸ\BqoDLÍò%ìÐ,h$;VDmƒ‰ «aƒxŸDb±Ìc1g‹8¯à¦eÔß®‘ºÖ ‹ûó1„r þ\€Ò|ßƒ‰yß
øK"Ê?ã1Ï¨‰ê›b‡pX0=„¢eß`fÀj%âßt” ËŽD›pf¿¢pBEË½ˆM*ÿm0¶{ÖÖŠ½•Í" «>þTŒS¥6wë¢ÏäZ´›ßÅ­Ob@Qi£iHk{˜ÇBc­wohÍ‡éû(O¢´¼²1æ~,%¶t¤æ)_~ÃºHÊY|ß ¹rü×eg¡R\çÙ˜ÚÛØp8=ñåÇÐ¼Sµ%ZÌ¼çq÷k/~@çnoø'®^Šeîí60Ï“q¼îFÈN»üÙ›ðÅc@ ‰UT·X
P>r3ë·hY ˜cöõŽ·Ûóe1¦L&i–ÇcC‚¨ÕëÁYyž=ø½ÄKáÏY|ZÝÂdá´ö ˜XÈ/Ü©ÖµðçJ¨{h3-ÜêKx§pcns„€¤Dtt®DÌ ·`²Œr€’8ãì†„ÃŸÓà ŽÅéèÎ†÷Òh öÔ)ã6PÚ%~æ½ÕÚ¢=uF^G·³gƒßŽ¯ôžÜßoüYÚZ˜=³‹É·(`'ˆA Yþ9¦µg ^Žôw|žÀ›Œ¦¢…øæÍÉÑéþ·ý¡·^déì®]9ºqr}Í· Â
t§QÑjª½l"ƒ·ÜIíÑ°h)vóP^¤µÙúÃœÕ"Ïcõgr„³šþõM¨Ä>µÕ#Éž6¬“­“.MÝxtú«G‚ï7$tTé6ÂÈ,I‘6ØùvÊÇ¬’u¸@¶5Gï~_$Àà‚
Õ‡Mœÿó¿ÿO ,µÜ%~†÷×ßE³–:Ô{÷°XÍIÓªXªÀ+d­šs~þcúÎÁÎ"ž1­YÁãŸÅvw™L†œ?‹­îö3õ[žû¶’>ZMvðÄ!`’IŽü
‘¯KGd',W¡Øxß FpH˜A,c#&Õ°}¨ªC%`/c³ßûò£w9îÅþÇÿ çŸ+¨ÊÙ­x¶Ë³,‡8¬Õ$tÞ_¹­¬x4)ÝÞO¾Â3ýê+ÿT«ÕÉVß8§[}mNßÑ[“ž Kýi +Óë3õò¬òJªM™^ÅjS#Ö«V‘±œšÔ [xØkÂ{©ÚÈõ±õ€‰S’Žòx˜Vü	ÞÀ’NlR?5¸{ð^Œ—(gZPk«JcXõÖ[Ey· i´Éô¯	’KMðÁX]vxVN³%Ìk×…[îˆ0ãƒÃïúç¯O^‰“7ç‡ý“‹xyøÑê-'bgkçí]q1U‡jY¶ ¦m‰ä+A
s›ò>)eª=Èm/IÇñV…ËVúëŽ¸&@·¦@ÊáÖ°¦5#V 0)OÇqçs¸i¤{½Nò¢Ü ­®=À»E”ÀÎFedŽwð=€vbb4ƒíß@xÛßÇ"…ëVD×1Œ|'å1}`w.—¾AKoÐ&8Ác{G+þê FÞ‚$ÏÂ:;D´Q•¤?^q¥oTÇpmØ]xZÇ8E¼9”g€½§QTAª¸KGÓ<K“Ÿˆ6ºc¦Wô­äxƒ<7lÓóçú¶~êä¬¶ÅX©Î‚ßK†5Øƒf¾TÎE¶:1Œo°‡GS}ùxÁêŽÙßpWÌÆ©NlÜáì¬d€köÖföÌ»ì^±ÿ¿ÿ×ÿùâÕyïä@ &V\œ^Àÿ"~·’ßÕaûxšÏ/ˆÂ­]­¿
Ç[+w²ç¬ËÅ=ßÆñÂ]vC?°KL^¯ Õ9òf W¤ÈP>Èä…¸^Îf€\Æ„]èŽ¼9´€ûÍV)4À§Q!šK6éfBfª‚åpYZwP,Ìå–zP3žÀYÄ«7=8ž‹>ðÛÿÞ??Ý88ìŸ÷Ïz'û?ˆÁ'û¯ÏOOÿ½wqxz"zûç§ƒè‰“Þù9<ü®Ø¶t0ØµûÜþ„hÆ+}Æ»âØwë†ÇÖ½/ã%­åäY¼ÄIÌcÄÀ@e ½ õ°1³D¯	aœ9Hh	ƒk5DÒž€¥}ë9Y®^ÀÞÞ hFV$Àrù ž?³qLö„&Ì#‰o›ÈT…Äã¤¤×_øïÛ.S‡3Ë£Û3šDwÁ
Sì7 8´öïDmßì^µ·ŽF—ò¯³ŽÆ]á\}/¨UÆXûffUü›Úµ^g}í/6Üª;ŒÓø:Aå¼oOXÑx½}ª|öî˜»gµ«Ë“âf½¥QËG®‹¾ùõ5…{[Nç‹hTÑ ×fðÈ%ÚŸþÇ÷ò8
)žÃçè|òØu>þ»­·¢€ÖW>ti-„PYV­=Ðüï|º6å_J¿Åšóÿ5.¡5ÜêËWÓpÍ¥üŠ—ÍeÄV^²Ú¦ëÐ¯}©Ô_RgdÖãêy”éL|åÈ5^Š££c`A(@½4ß‚üSãË6ÃCjŸ®èëg˜â‡±ø)Î³.ë¨k|æ £@<KÐý§këx‚|Ôžc’Å	´Xž¸‰A¾ÖÒøÕ·ýîÑ…ú{Ÿ]B§–;Î}hÞÂ÷Ä[»ç”lëÞ6ØöÇ[V{äÑ¼Øevò{óÄnhL´[¾ñuË]ç åè³+ÚÛ¨ÑÇ‡À£}ß¬ìR­R+Ï€iî§ÚÈ•)	Á8y|vÝÌçÉ{¥¶3¾·¸\`qÅû¤XâÛt’_Š4TmžoZ•v½%j›:Ì­ÕÊ^Å^ývçÑ]½Â¾º³¸Ä5Êúh4ªZl\ïQvã{ã¯3ŠÒŒôÂCO*t@N§¯ö£"n”ãIq„ž\¤”$íÃE¬>¹y5.ÿ…™»ÂI^ß'åí(Ž¯ —ÞD¨†¹âïê|.H›nfT!Äe—ûPŸ6ÞÎ·—ß8(ÈÛVøä()Èà`-ö9|&ÝÖª}Â²Þ^:“$ë¬ý=ÊO_¸#B.5¨r®Á=Ûªº~U¡ÏõÕñ7ÀZŠãÂC 52…úG@L#>+viÂ’G°â‘Q·ˆ£|4ý·eœßñé_Ôî^'3ç[/²Xkå$o‡jöãw¿ó÷ãÏ¸îÚ -¼¤AE‚}-G(äsµ`öðçdý„ pÇÉœ¶o­ÏQ?)vDo<ò¶œ;*§›	þ…°Ò žY5æÑ]–¦QRÐ/5þM#Ñyôþÿ¸‰ËÑt¹ Ï–áˆîï1% 5e©;l\~SsbjäÎâî<ä¶ÿÞ»ððÉƒ×ÿ1ù_¨uÃÍÇ-ø…Cq§Ý$Í–ã=‚>´}ŠÞöÜÉÝ³I¬›BjÛp¹RÖJåÁ˜¥Õ€à˜"×lüAçQ‚Ôÿ»¤øÅvê=BpÕ8ÕìwOîáuÜ‹ÿ-lÇë(Ïˆ‚ÍíGÃ!jMØ³a³XùÊ1ÕLÑs“ oG`"6x>0P·òËU?¶Ûðeý|ù5°ãI\<¶ïa_×öŒ/EQ}¨[ù®Ì—q¢íßU¹×ÁHJ"ýN´¾üè|ö×,I[ˆÚ÷íwÞøãO9÷wlî­¥ë÷ðž¦poqß¶¯0\¸>eçD-Ýaÿ›\ßÕð3É˜4Áë³ñ]7"ç×cŠžÃ3$»+Y_Í£Iü&ŸµEàam‡ê=¬oeƒây÷íÖåÃ£~l…^X‡ê+FU¡ñ-‰ÿðõ½¹‘)ºJGÈæ^"G~`–™Rÿì	Ž5^=¤Ð‚=ÈðˆõŒé§óÌ†QˆžWZ/wÌ3,ÌHUÆÇ™«´¨;ÓÇùÄZ@Ë]OÇR™qÚîIší|;¾R¿]{‡™^Œ–yd‰ç	ìÄˆ<{¤Gmý˜Ìh5ÊE¥c ¢š`%¦Aâ…œ!HPJj¯âƒSìhP ¥Ð¹TžééøÓL14:ÆP3{}õ¾ëO›gÙòpüaWxˆ;ÕPÊ&õ‡;;¶OÅÃØöUO£ò¦òÑ‚¿Î0Äô¯?E_Ïãë8¿È0ée–[ÃÞ²d/‡÷Ý^ø©bÛ=*‡`4ÔÒ
ý^à(CKŸñ-µÞkôRC•ýž…èv»4ß­ß££W›éÐˆÚZ=ñ½­á¹Z³•¡¼^ïëi»^,uæÜÛ±Ã¶$Ss>º-²Ôñ¦Ÿ­ÞvŽˆuÃÑ¿(‰Á(GgÂE{`mÕkŒfÈÝ€Ù¶àÝ¡˜FÚÆ:w ñ“…Yù<¾FK±÷ÆE­ûÎî[öõ÷êI±­ô²ßÁiyFÚ½]²6óßxj73Dh·Š¢œþÉ~4›™Ã¿sV_ ®<DÏþØæÇ¥StÏ¬ËP‚ìmŸ:ÅÌ3Ø&†ÏÍ¿-£´D'8F”¨ôZ¦hZ ‡uÏ‹fI^üEù*µÃFˆaXÒßó§ÓÍãÅ,Å­ÍÇ¿ÿ±øª5ùy‚pÿsöÓÏ³añóÍäç"Îß£DóóbÿŸÄ@$~.f@+ø‹öóÍIÒÍ&ˆ]y2oùøÐÇ®µÕ@yi	¼—GYv³\\ŠÈÖpŠh – %´©xkò$~€C7lWÏÆ¨v×zß-Ò#†TÆmÀ?ï:±köãñá|‚t,ºÈF$<M3,ZîHñQ]Ø[ŒµíI4ö ÖOOµÞ {jqÙ.6óÜ5óÐ§¤(©ùØÓo¬{Žƒå ¤À{y'¢²Œ°o½«cy®uÊý]á<Ts©¦¸#ö±Næ“~žK²ûñÑð'úè¶}‰.šÔÑs›ñ#g÷>‚@¦™Í)«XfŸg€iþuYæêô½'äë~®îWàéþ9ºÏçç>››«áåê8¹µø¸‡¸¸_ž‡»£:î-@ùmüÑ|‹rô‹e2_ƒ³XÜm,¢rj¬¼ë‰Õ¡fÞµ˜y€º „µ'±âküþ>×}Z<aˆóùkFV7-ÙÓoóÚú»!ý„ih3FÞ7Æ¤ìê§ï“<Kçke©Œ•N·XÀñYt‡ÓhDÕ½H:	Ç}5Ë&»ûOæk×àj#øòî§˜½†‘_Ø%§IŸÚ|õjö¬§Š»oÛÜèz¬î/;¦ä]ØqÐ”=?læˆ£÷èº¹K
RDÖáœ×g¾ÿÆf”“BºÜòž»Gèjc)”„(¸¬õŽWûåÇœžtY£‚Pë#/W,gäFïÜ}ûþÇôÇÔ&Ï–°[ØªÞj_óú”ÈæèüÙôÅþ® (Ù€Ñ&¥ã‚À\´0’eƒºPe=ÃD"kìpOæÊ©RIyf+¼xlx;N>Ç§‡/à`_&“8£¡ÄK9JÛâm-nÄ\ý°ÂÒf2¾0Ûµ¬K¦°)Å.drîÈi¾@ËÐËv´Ìr2ñŠ»5T‘†W\ðÆ!òÚ³qÚ,e¯tÝhða<Š¤7Ž©;7©ü‚ÓL4nÅ°õEL|·¡@†/ëË¹¿þ|øªø™Öa&4Ä:>®Lïs6ôGèì2 ê±Pê‡g
7G‹ÆE	³»âðÚ
 Ñn@Ú7ÐeÂ:2o©Eõ|Ð.Q¨N4‰¤EŒµsÕ÷°ÊKü<õƒ­PGkº§Xì;¬J­f+Æò¸Øjúö²â"áj1Ìa4'µÃ˜=m¬6-³¾÷Û`’2]6Öx¸¨yBÉ|J[-}âAù…ÏóSåÃ@
ÛÎ+ÕßF¦ø‚>#£=oÏÙDÞ–¤~þUöY®€¾
­€_ø+à§[Æzp¸Fj+yWðOc5•íÚr@÷¥l0ûÛ¿éš[›VU`®»XÓ–ßùÐ,ÝÅð„²+¤fU_ËA(,¸ç’êçe’uy@1‚NI*ëŒ¯Ç]åÈØöãõ5a‘CÅ¡€ˆƒ1pm< Ówd%ŒývÆ#Slz<>!Ç¾ÆÅ')xå­ÿ-ïýouk¬]DŸ:[R…‡'¤iUÞµIa!ßš~œ&¿ÌEd ¾âŽW^Ekjÿ­Gº”ÖwöÍ¬~ãˆûµûõÐ¥61ë_<p,¿Ì¶2x¹=pŸ5”£ŒGñåÞ~±ªG{¸k¡=¨w©•.ÅÀtB]}·÷5âéñëø«wl¦YÚÀH5Zã yçãs›ŽËèÐ4'*ÚAîÜà…ù…Ä&ŠèDž/R‚
ˆ„Ë´Ëeç(™Î—2Ó`^Î¢™ ñë>N:úûËBPH·µž($é”•‚ì?«ià7Á/Œ¿=tátÙEWÈðšÑh¤”äaû…Ãñ{Ñ’÷9ñp¥î hÁ_ÛžÖ­(f¢|,51Ö`W°îä~_5°ëð¯ŸJ¯þ}ï¨ïÈÏMî¶Ó}V‰èn=3mwÿd'fC—¾Ïëa4MF7qêv²ÝýC¨—m+Œ¡ûGgp˜Eù™,²¼²_zxj÷à,æ:)¦þ$œƒÓCÍæYêÏ¢Ð}<³;yfw’'ÒáNãi »ƒ­mw?³Ñ(›%n/[Ý§¡ÕØÝ<µ{‰'“uvã©_ÛDï³Q4Î*çèdÇYL8Æþ–†ú°ÁôkÐ—eçn'ìnû<ëZGûÌ/`YâÂ;—¯«G÷Ãtñ‡îŽþJ¶º;‰s°eÌSæw±ý§‡ Ã¯,™¹=ü©[é`›®ŽéÀ½he`›Ãî{ô)@^Ñiëœ„m¥MQ´“RŽÂ¼‡æg‚ß¶Â±®à¤œœíÎSôŠ¯—É:ÂÚÒP:oîIñý4›Q_Çd/ßcŸx5GOš“²©rµ'Ï–ºê\í¥L³§>´—à„*­ìKIrÆkÜí:ñYäÔvŠ1Oõ(LîÁVÀGTÒ,Ã¿–3K¦ä²Ù>(PcZó;7L¬µ*¢‹ÍÛ2h¡zÎV°âh>Æ`EÃ³úËœ´ìòÿ$€ÉFú'ÍÌol P6·<WJ ÷yÛx"½ýo?~ØÙÚøñÃû—›Ç³ˆÝf8Takaþs}ýDÛÌiW^BÊ’uÕW€gìÇWÊ¡Ð=Þ¿ìU¥ 	÷ÅDƒ¼Íÿ®ß!ýüÒ
‚¸Å›Ú ¦/ðUSyýkŒ¿«}‰à\ëø‰G|‘½¡ÝXÅ?—ª p%Üzz=°‚÷}›¦¹b'Àžêh™/³üé?·Øhó¸ÂPoÿaÁ
þãwmÃð•Ø	*üí³?H«ÂC<Pó±´Þ¸ïŽO`œ.fã_Q‚©ŽÎÎørøMo>+Byj×jÔ¯‰ãü^	ï¡8Ot±¹É0Jú‰x¶™Q&í¦
B
Ã!LáÐ‚»êò+ñP¾/‹SuƒzüJœWƒØØ{GgQ•cò"«~Îñ¼L>ÄãÖ¶ï+.;3WÝ¾ü:?kte¥guûªTùY£3/•«Û¡ó2ÐéN]§*ï«×[½gÙù)býs•ñYÕíÊpµ*6‡j!µgºÀfãÆ—=Æë¾ÁJµ/?ºì~Â­õ„-Ì+‘¡;Æ¹ž÷Sts]0CÈðWfÌÉø»+&Z#Ï ƒÌÿ(ŸÝ±¼ùÛ0ÇZäòš]êyT¨96®£¯xµ’¥?>´@\…=¶kªH°¦B˜,®•`ÜÒÚ#šœp€ËÂ^8Ix@+Î÷c7Ð'þëvi#«ªmüçWÒîˆ
éùM†{°
gJý}µÈˆú—šÜÒ©ÎüÄÎ¢áàÞðÂTA°±k]cS#ÁÁŸuÍ]Q¶‚!ë>óê)TQWíxRN¶g¸é}èqð¡ÚòQì±wÖiÉã¡Þ~—såºk.I¨1ù'_`>L-‡ªßõ+õéé(·>Ì£[Êqƒ¢e D†¡!®è‚2Ç†¿ìêdZÄùæß˜†h2±!C5=ÚV­Œ.“ê&\eä­IA~îâ}4[ÆE®nJAUß&ù¦‚
}úøb	¨©¼$_¹=Ì\Hãî58ë²"ƒ7#ÊÍ(.T¼BpòÓFåI¹—þ {6¹ô­Qø/ÀâéjZ[œ]íÌj>5|\åË@¡ëC‹k«|ªp`}êñh•Ïëj8+v©À²Âáy(¶®:ƒJaù™¤Ò¦iˆ
Ÿ`I2IÃÌÓ>òGöcñß½÷¤F”jF"61×H«RnM•l†¢*To–&Pö‡) `ì×´ÊþÐfùéÁµÍ©W{qI˜ÝS˜×¯öàQ3wùA~<0IØœñ=áÀÿªrÐ²°Ržd9¹L{¢¡ŽUØ·%ÑQ)}ÿu]QÙX÷ÞMŠ—˜ó>n™¡9þÇÌcÌžÛ`=AvZGí2Eþó‰#[Í6Àûo‡ÕÌ›zfäœ4f+÷4ÊÇD@¾¡ox¡z®ÕOÏ»^ÍŒÐi[; àíêçÐ¨9»<qîe.Æ¢«Iµ>Ú¬¨Á yTïÎOoØ>ÐýgPB¡ËÿÁ-µ( |W<†þ¹SÑ…gìÙ°úu“ªŒ¤þùÞZµ|að¬HQïðozüÎÏ`´Jû\Ú¬¥}˜ÃóºDíôNOP*ÁV)ê2þ0V2w³;úñúC…6þXvÚw{0õ|ýÑê4:þˆ~‚x{Tû?r@éS«ö©Œ©3É;£ÑÓõWX«ªÂ‰—tÞÕy¹Þàèµ¥èÁ2Õˆ¨¡6{]ùUøÿF=Fåa™§Š”ñÇ}ÛÒE}®ª–™ª÷ÁÒùG÷1rC¤›vY$g"'o[s¿üh~Á`ÂÎÚ+Ži5ÙRŠO»+Úæ(Ëiº
 ø•kV­ùæ­R›/dÂ!+àVëÜÜ­­WþLR€Cw*Ú³Plíú®LÊ@9¬)V Ú~Çp½††ô× KžX·>dþ!Ä•^E³$*þ—ÁÇA`òxÐ3.¯œpq\¿v¿Â¨4/5¹ö8	’B½<akò¸IcAö_Räw$†¡Çe¶Ø "çäŽQQ=×_	ËK•êw­oet.š\sÍï†rL½€7Í@^5ü…E0|ºÕ‰PPM£”ÊúÙ¾°WÃµÄÖ²:ôÕ<†Æÿà>€kkÅ1m:r¹mò!j%—éM
]4CŸÃ­ÐŸË[²¿¢ÿ®¼Še8eçEÍìäk 6Çé\½jéE`pŽkt¢—âf‡µ]ç–`©ì“Éra—/›b{k«º'ËÀáG¬]oæÆ[U˜^Î²¨¤¸µ n$›œÅ9VÚÁ—g±‚¡v»wë<Õ0°8öOÊb^W¦ÚÕ´ÝöÏöô$¾}hOáøköÔ‚ŸOßSÕ}pO+#|Öžª¡jö´2Ø'îiÊ'3æÑ8{MK©/o[óÓ&Ó­Žê67ª@óûÊší~°rå†K~ïñÃ¾
.¦Ý3¸Ô§¸•Ÿ™¬^mq6	×Jêq‚Y×fw•s	µœSMKs&N¦ž"fõçµ¿ú³Ï‡_®]©V|ÚJ-ÌcVª?Ûpýïm4µÂÖ^ŸÛŸ¶Æõ®ÒÃŸ~ÞòWLY÷ bFË²ÖËÔ+¨µ-ó(-xáCQïCþ^²sÜ«Ïµ¾‹BQˆ‡7,ÔIð+wñõgd]¡*1«U¯Ø|E=¬Erys•$ÎvYP5C¤Cbì2K_b©yéÅ8žqŠ™V…V‘†!îIOÞšô
\~µ;]¡Ú…U{wîAàRÀá.*÷ÚýØ—{~+õBð¬>U(“RS½¾ë“D#¥_¢¾1y•åÊn=µ÷YþÄ“t)‰ÊKÅµow·ü—×ú%“øoëí3xY™óý£ål½ù×»’[¾ÿØ‘ŒZq‰úØSòdíB'Ú-'n°"ñãñè)nè4ä7®#Ç«uU¸®´\å!PT[­ùTþg¥Îµ²½ò„+tŽ…ñ6Üµêy!Ü´^Ç˜Y1Ù[±_©Ýu¸÷û éÜéãÚïc§Ò‡køv¾.œA¸:”×¤R)Ê[Á«øbî©3}„®× Ô@Ñ¯±‡©86)€CFìè˜)Úë`e/ÃV%¯P½ß¾ŸÏg•ê›ÒÈÍxŒæÛÞÃ*5 JVªoD´ RáãOÚ˜u)‚ÊªàQƒ_ñªÕÿÆý{cÜ°7HÕ†›ýŽÕMÖÂ±¿
ú´ý¨Û¾KU½‚XX¯ZåcrðLweVfã¾sƒ£TG¿X\”;Þ\‡1ž£í›´g°0{R9™Š‡K ¨ÊjNîÆW­›$í5Í¤ñÕde¿2h’7Ê6>9)R*†%õ	¦ Wdö³@
&~¯'jåÿñ‡ÿ³Ø'ï{ÎC…ûÑ+Š3Éy(õMÛºðÇfÂ¿i4n¶WoBMÏë-q½ý­V§”Ñ›áÊRæLm@p*¹©r‚ÍÚÕ d™ÿÏÒ®ÈS?M;:º.)˜­Ïw/üÜ”ÌÁGá¨A©‡qs›Q{;ä„Tr}ÓÓÇä4“Qð¼¹¨íhÙ;Ö–iGL Õt•m’Ì¹ê¬pÙ§½½y÷°¶Í­ƒúI€åãYË(ñHÖxsÖ`Xè{àj¼>c´€OZxDå…ö9cÙiND»OÙ-µ}Põo×8~H	o©ó	éÎ×Qþšžìý©Ã½yŽ|zWƒ¶(¹óvØ
p1¶Ò_Ri6ñoWŠOàŠM¢§ð—ùÖqÒÃ6l˜[N¢Üô— £Œ¿Šl¶ÎbýÓšLÛérMÒX>m fZþ‰™×ñ¿?Áu¥ÞbÀõê¬>å>§YÿŸ/§Ó÷IÍ“ô€«—Òß/¶wð×u†Šoëù¾õwßúûÛP‡=»Ã?Ð’§	þ ód˜]Ï¢÷¼¹ià/ÙÇe(W…,¬mŸ•M*êÌ\Y{…Y¢þ#ãYßæ+Ÿ«QrWøÍÚbè÷ü÷¯Î‰öKÕ¨”°‡{Þ]§b€^+žÅ:´®f+æšžÎ&­Qb R;ku:<JÙŸ;U¢ªYÀ FËhFe[¨€ãx9nk'«³ÓÓ=˜ïï8v]Ù€ÐqþÂeþw©`ÕŠ1›£SrÁ5›Å]zÓj¼%Á¡Ç•!dòÇ]ÀŒôZöHÿ³¹i%C?ˆAÀS"ød$ZgSÌ
¿mJ	 PìkØÑ\xõ©_µÚ€yÈ…á;¿q·èÎÏXuµ» v5Êï^ÀÌÈ7»÷Ö9X²€«¨ìÀ¥µ)×Q2ƒáq>RÊ›ß¡’°ªë&ÍÑÖÅeºbÍÞS1z™ŸO¥V‚2¯bÛxÜ›Lr ú¥‰&*VÅáiVêäÍÅùaÿäâêÛþƒä7uE×oo ž±þx½ÂO•6Ž„8jenhäzŸËó•”.×ö:j=Ðš½j+¼°Iõ¥ä‡W™ ë”ÐuIAÕ|dÝ‚™£E|ô0#õÀt‚ôsÕ†t8dÃe	Æýj
p§nô=7cÜ²ç)Š"3^wF`Tõ ¨kvæP‡–=ZÍÕàŠn!â«Ê4êäe×YE«äÓA‰EöÜV]÷e€¸6ôÊú†BŽ°ìÎŸŒ&z‡b4KHXç}2ŠERX58–)œq2Ãc¶éé?<åóÎæ1„Ï·TY9+—Ekgk«ÍÄÐÆÓÈÄÀB(Û¦±àEÒËw/——Æc¿ÌÔ¨ÌÀ­>·ûò£Ö¤8ÙÏÒ”ë…
 SxÞË²yßÖÅS°Æ&aþ)¦õú:ÆC&FqÆ~#ÆŸþ®[ž-8³´:R:õ“¬ì)à]"OWíc«w»û ÷ÈÕMùŸSûlD	³¼`­õõÂ°,òF¯ƒ£=!æÂçÁÛ*hs:·ø®'Œ·ñÿAê.²¢l56áúmNb@“M ¼á²pZQq—Ž¨:ÝMöHk‚ØzÊkÛü°Èwq#7‰ð¬zGêÎÚ8ÿ¼,¾xk5QEç bm]ou­_o=•ký¨nEób
i0è;1.„JÑÌŽ›>›ØŽÂþQªP`Ál•u€û‰GKª¨Û”d7Nå•‡Ï¡¨ˆ,ž*=BM7Â9iÔÑhê‚Yá	½Ùd–	ë‹eóVSâBb³]ƒ@¶¿ÇG<¢…ýï°bè~g3ü0Í€Ãƒg@,³r;Ãhèº¯5‚ÀOoâx±Í€×4ÿËF0ÛlãÅÑœ'XÛÚ^ÔÆé‚0þ¤HÓØß]Ï–ÅTîº•µ„]7§ß€ …ÎIAMwˆ‰sÊ`f§ÚµF$jqJX/,ãlâãIýT´¿„¿QhPOá'€ŒO•¹üdÒ†ÝU	Z…Žf&I’ä^ 5Ãia'*ÓÇ;]5ºEœ^>®eMæÄ4EÓa˜á›x½LŒÛ&6WÂ(ÌQÑcu>œ¿‹o›´e–ëæË´…éG)€±NW–ßFùXP–Zÿ3ÌÐð¤ÍÑÑ1PÖbCo.ˆ'ÚT30^þ@…N™©>/^‘o®ˆîF†¤“™ì?ÿûÿ–y£Íd"]Œ>ŸI1Ç-°±=šÈªïÒ ÞYd•”e©	S‚[
ÿËY—šrAðL3”°â)àFÍAH:Àô¡ivÛj+,ª©‰Þ*’ùù€á§	ð‡D)(~¬eS‘†ME—¸"µû¨9ØWmd¢]Ç¨ÍÙC¹%ÊE\ÊK=„yô¼z!×Û${gLï5;D™ph<-X! "ù¨d	Ù‹V)Sig÷Wáþ< TdêPG€Ü;ý{	D¸ñk`%õ³C­Ÿ¨€½x‘d(DÁèWÄâñ:å“¡jôÚhXý«Z¤%
*Z4¹fqJÿ-¡—ùà® ¯U­­s_å	ò—¶ä4Ä;5H~’ì¦0µ¿ÑÕ(Òá‹ƒ$š å)“‘èá‚	y-ZÜ×í]Õ¼ŸK‰ø1_2Y—#ATy<‹ßGÐË˜z1ë&öcÁ{ÝVâ³¤ ÷0Œ]Ö9DX…»Up9`O¨X;"éÕµ d&}2ÒHcY;•AXÙm ÂôŒP•”°ö­Žc„ï1Zaµó4—~X˜Ï¬eAËó.o¾
ÊöwÏ+»lÛz99QÜ¸íA/¶À‡Ì#K¦á»ƒÔ=}ñ¯ýý5Ø¯Eœ—ä{d]’Q©Ôõ¶îÄê©w~ÞûÁöñ!_?¹bíÐ«&àÁt(a£ÕïàâüðäU5!Î8.Fy²à,U§´{†2é Œ¥‡ébø3eBm\ÿ/‡ƒèWô.z/°²*j•:‚«eFˆGa°£.‡M# Eä"  Å§gúÒ×tÅ‹‚ÚP!öŽx	|5€HÚûìÜ@Sp1Zî ·Œ)»ýPr,Òè&¾¢?qÄ[—Ü7ðwCìýj!{GŽïZößlwÞþT¢Ã<V"¨î¬·“@vçèhöüÛ8>Þ88hT{XÕÑÅ,zÝž¼9~Ñ?÷»Åâ=•ßÂ1Ñ×ÈˆÈÄd~éŠ£­TFßÍÔ«+«Œ<\™Õ<8»ð¢ÍìdÁw`}Û[ÿ,6Å³§¸û'ýW½‹Ãïú°ûÕ)›å¬1çeš”œ&~B<2·4
p¹Õl¸„“Y\˜Mutä€…á!Ö˜Ä÷S*5Ín:±XÔ½rÇt1€¦—X*) €À«Í¢»+öºŽãî“?îyÿßÞž÷Äí®¬®„º€M}=7åÝÄ„„!IkîzWànf××À-a-\¥šör.ïsóuŒ…H ßþ”Dxäð;Ëói–Œ‹&\ežE$`]IºÑO'³XçkàmÑöØEÚ&œ´3áh†_îd‘:$pá‰â^ºúdwg‘›Mòx¼+Þ6t÷húK;‚
þ×:gzmGã2¬¡6#-S>äà¼ŠßŽhäÑí* ªÞ–šóEÔZ¢²£¸ƒ[’Í7ÊŽÙ›(|ôJMÆï Q Àd3¼÷ÇKUÆ’®Ÿ½§HJÆr ˜¥	
t‚Ï
º+År¬(4¸¢’Zµ>
Á?„ÖÁæ¿Þý\øÐ§#2¿‡uï•;r±Ïæá‹Ã> ëÐ]4%Œ/Öj3²ðSé £ D!;éÂÎ4*Ž³<>fŽÒôÅééQ¿wb·ŸEPû)¬Íûæðä¢ÿªzøõT	¤dlÔ	b…"Ì,db”-;¿Å"ä
öñ¦žF”ÒoÔM‘ªË"c‰m ¡éÒTålIYæG€¢åpAÉÝƒ‰ž³Iñ}ž¥“ƒ,ËÃÛPY‚ÃéÉÑH(ÕîÂ¨‹%1~œÙ~v§e‰	‰·Xt7ùû¯ÙU¥ÒAÏD:c²èÀG¤<Å
ô¬Þ4L#Ê8šH^“6¡wòƒjÌbn£©Â]¦6”“tøÜå?!õ¹ßB"‡*x‚ÿuAŠ¨HhLyîmeNý<~ŸÄ·Ÿ+°h-À·hß½3ÅrŽþ T‹H]«£we’‚9YïPŽÌiªå	g[
AÂ0	%p$8ž#¾‡Á€¡¡’`šL¦3ò‘‡†s½ãâ¯ÌG¿!­£+þ~j	•ª„ËR'À`TÑ¯Òá~WKEí«M±xâšjÿqd€q0Å`´lp8fÙ’Šhû<O
Y¤w	îÖæŒüÅEÈÊ@D›8psŸ‚Ç¥‹Í£Ù~‡‡4½Bí½¶™<Þ%‡Nñ¦T|â±QJüãƒç¾ùhV$ÿüº.9‘s}o·ÆHABW¡d‘~²@¬¥9¦?L&Žß.ÄBÚÝÙ”%¼‚I0P	zZ<¹åìtpÈ¢ªQ÷2µò„qÂ{p)Èà§Z†8ÔµEÖ¾Wë
ôœH„z ¸ù–4”˜: àzëI*L5º^LïŠ$#Ÿ6Xp¶,g.­??ý –À‰äb–Ì´‰Ùêî|`Í?l+„€G$ÆÙh‰´ƒ‰àÑ&ü¿¼ùdK•‡@äÏèŸÄöv÷Oÿ$ýdÉ2DÏì2–Ì¾Û[ÿíŸ7@¬8ERs› JÈâBçÉ}:ÉÖTïìk8†/p³ÜýÆ£mŒ‡…òË²XÄÈ!¨ã.O¨' ÀŽ÷ÝZ…ìÂ7¸Œ!j½ô¦ÀŽ£yÚmO;Ç#`0f(¹áây;óˆT»% O<Pwóº(‰Ip”Ífxµ»y5’G‹i2ê-Çâ«t“!´öjÃ*÷{DÐyŠîŠh­Z[ªEöl˜e7b2Ë†ÀSÊ~˜µ	¬ÿQ¢»~9…Ó?ÍÏã	1H¤ý—œÈZÈPf‚dv?—½ îÀnJb¤Z²°ÆD|Ž¹œ:ñPêäfw¤bûH7znžÀ£fÍüLzéøFçƒir]®7ç×  „áÔ&ô1`p±˜Á"¸bL. fp²÷@ãžá×>0U¾@Êš³»lIœ$ûŒ«[6Ä w‹÷Ä;‡¥É	£ù\þLÖæjàÙƒÕà@Q%•§ÐðN8ìEpfÒxÃßÄã¤3³sØµwqÃMÑrDþT£Xòò¸_·pe§.QV¶¡ 5)nŒ÷OÝgbCììtÿYÜL6ç;ÄUØÙ
:An¶³žÝïí’bqpÖß?|y¸/Ðô¨/NÏ.{Gâ¢wþª!¾ë½é›ƒ&qSî¢±(a•Dª;ÛÝ-9UzüâøÖñtKÌçÙlþŸ¿ö¶G¸Àígðæõ„Ÿ^œá³î·>â§½Eö¢Ý'§ˆ’i%ÖÄ›"Ç€¹)£vjN‹ÉÌUt×á˜4ð_¨\£d8’A÷7àÂKëäˆˆäË9ÛX\·p¯ÞŠbJ©‚ävt\: t¦K¹æ†1Ðj‰Nºœ£4ÍfAE4-öÈ»7±¯Êä«]þdw+×Q‡‡éÃ#T¹fK%„Ÿ2èvD­©pÙ:â8™¡né F=° !ˆ·¶g­¡1|µ¤ÄNHÔ%gðç=ñÏ[ñ‡­?ý³R“µN…0òL31‰EEÅÍÿ‚´Ñ›RÉ1Ùó1P ©|Egj¯gïl ™0ËKæX/7ÀO°kÔ9	e ¬k²m™Û;ã­buê˜"º¬†ÕeWÖ+'$çÒk&§˜4âmCîõ`9Ü?E‹EKñï@¶Ûø²WŠs¸Ë*ç ›ò[”Jj»bIYvÖ4^Õþv†.·"´§iñŽ\¾PãV.áÔT"Jä´Ø@§äPÀ<4O†œ¨"0ß¾:;[;_‹WK@ŒHsÉE¯wÐJ¢$V`x€¦uA”÷NÐ( %n
ù ®©X~ºñµ0`b}ÆµÇŽ¦»3;Ë#J/á#0Q–ç$°³
öƒÎ'Ÿ†PÝ“×—cH×¾ìÆ¬½Ñéx ‡½×ŽJÀ#¢ v‹²yÂBD£‘Tˆ^Ô>ã1š3°¶ÅÞ@1)›¤nÂÚ1t~‘°i¬úõàaE^ÐÒ&¿é^î"³µÃèÃ}Ü8i|‹FoÅ¼	ô¦—ÕC§•–7%|·—¬Ê¨snÈO¤gÊb[Ñî¹[EqÍ°‚u(Þ#õŠŠ¢j²bë]AšDKû€¿+ò3E‡×R%Z«Åf³S"pMØ«FFks:4žOPïÉÿª"Lg3]ÄU§ ]e7‘–	ž·¯=E˜>›E)N÷s#k“€žÊ¼îø&ÅIÇDàT2f‡D#%VŒWÊ÷qLz®mï6 †îŒ1	Ý$:{©‹‰»r‡—5U…ð>6*{’ÇâÅkFmþ!“‰ ŒcÏî–Ç%ÔÿzòµÅ„öLX[{âæsJµ‡.'ñ¹àˆñ¸£Õ\fÿQc˜å¬„1òJóu¼@&W¼”çâ,JãYP,§‚IYŠc}L¦x-ã±LWq”ÝVùÒ3Ù› DåÁ}À£¾Hæñuþ˜= [ò[¹Ä§b(hZ…–ø2Ö¬Kôû†àB?,ìF”Ôh)?¾ƒ¤÷H÷C#§€B—³GnÑ`š‡â‹±OšÆº“/ãÁ*1ÄGfe4A¢Âpo§1i¨¶M³'ýª”Åí í ©ø‹<€ÍÛ8¾)BZÆÉB‘ûµ©üš“BÎz	yÞEÉls—¨]”• "QÜÄ–ç^a<½ô¦0Nã,fµòž¬Ò ìŠýl>DIBkG$ÛÞÑÚK‰­ÈEž¤C²3ßuÌœhy¤cp®1IeF"¡¿ÑŸ)£œŒ·äñ7¦à$†6ž)ØbôœYÖ5ãiLt¥bfÉ¹& tp´ìúJ9ÖDáJ‰‹ùC–ü~]†Jë&ªˆ”™"F<ÜÄÁ1øÈEÄ™ù•Ø!uqðGø’²w=O%²n½Š¿!A+ClN,b6O˜kF=U¶)…{{Ãq6'ÙäÍ¬Ìm!0ˆ‡1Òq’Õ²Š¸Ó,/¯Ð‘Î*K'ü£B^LCÑú±#îÐFV.ý‘hýyO¿ùíéÝçÐ"Ã;­ŠG¹ˆõ·¤úc·¨µ)«’÷•_æÚ”w¬zÐ“+–rêÆä2†‹Bµ@¹þEœÆ×kÛµµ³!‚ ¢H`^²÷’T IN\·	ú†ÏößnMÐ°|MÓÄ@¨’­ÉÐeþ£R¦º”Kù"¶¢1
	BÖO¤H&ÿ]ŸéÐºHº´0²ºû>v"^8•È,h6~s2©5 }´ä =GBZŸ“â!Õ2®›«‚{‘@eÈ˜%ÿ’¡¦)ø×fÉèZ@¦ÿR¢5'qS¸˜•†ÛÈ(<Šå?ƒt¸È×ªÊ°9­O@óÅ´;â ë¶Šë•!ç¦•®;WÔçêÆ ¸”ïÒD£IÝAÑ1îàNœ^h3n¤´BçMÜrš›É±ÙP£6(ÈseÓ·f:øÕ_0Q¶•Çõo–Kß­üŒÒ'©¬l9´œF·[ 
Š@”m«Ÿu¨l#Ûp ½nPM_êæ –.¾*5EO^Vã)U(%“‘„Ã.áfVƒYká‡;ª·Ýwjp°NmAÿ0}±#vºÛ»‚“ÌˆéÝpsLÑè®‘G· Ký•Uä]ñ="ffƒQýYê{‡ò <l2¨Ä‹B§ãUm_áÓírkW²iG9;_À,m6lQÒsYªd?°xÌ±e©×’¢¯ÇÛ.2iÚ#6)#ûÞšCèµ3«Pî¿i…nr@¿žR]Ò±H0Kák?üJ×¦õåG=4æÙ·7Ý²T'ÙMœª3\uþ6®|{ùÕzôO›‚v»6¸`l5û½]ÀDc+L¸k?Æ$Úºä¨·%ˆÄUÊ¨šü2ýbv‹Á¹³øÃ"¨¬Áê[ÛÊ<æËY™ìg˜¼
?Õ˜ŸÓRävÊj7%‚ú°&©µU‹Vl/Öbýìâ¸ÏU7Ï–»œÔë½ 
¸Ø:P@(‚uÓ‰‘îá/Ú LÄÙ¢I¬Js¬£è.Î7¶q3c
Ð(ö¾üH}q°CtÏ<‡Ç÷äÓ®_â`y®™‘ÛG×»{q=‹0õ•n$Ë·6FÖú½~"[7ÉB¿ÄýŠÖïè¿÷+ÁWÞÔ¶RàÂRÊMÑ&	z|]"OpÆbÂÌ·Fßö[ŽªšÊeÈ¤Šäí!ûƒÛ{‘õí¸‹`÷:Uù|LÙoxwùk®•É|%ðàsÀþEM'‚%ª!¢Ñ3—€|/ç—xXÈ‡¯F.êŸŸß2`)&‹Æ»C9+ae| ßmdÉéçè
º8¼	Pµ,Î.³»ÔBëwLIù¡ƒöµ
#`ËÏ;ì¿yßóÂâÞTê
æîLv/ë`tˆÊ+/N_ÿ¬¶ô¿ˆY©6Å{!f,ò¡ú¡&úö2`87—q—ïbµÍ¼
Ù»t:¥±krzúÜ{ÐçÊ„*–ÎÜt·õ#ñ¨Äu8Žˆe¨ ^†R7æ_K8¬tú<?NÆ2S:a™ÛÀà<Ò	ä€l‰ZÊ»Þ~h–ZpT€`¨~îæ£ýÄéÊd«Ù"N1¥wüÜNÄÇVÓ';àZ³8— evf¤ô-Å©¶³’Ë2\ûcòËsÒ-–Cö­ÄB–Û[[íûn·ÛX1q™h§ÕdA¹Ùïxšˆne¦fêÛž¢-—5T8©«3Î>B~^k·Yšû†e5†r,‚y¹cÝ$ÅJƒcÓ“þB/«móÝRE ¹ú†¥I@aÌ,†êoù‰pðóÆ7V‹y6º9P‰¹œÔºTÝËÉ½)?¶ôé.Dpï~žà‘P{lDÀBô
LÄDÊAê°ûä<þŒòÊ Ô®L¦ Òººfa¹Aë´Eœ3ˆUf(Mv”ÆŽµÒ¸¢ƒM¥K!	v˜s‰,L¨¥cASF\Ý)Ã¹r’ß@Wéì ,è8qŽbÊ–%ÆÿP¸m„ž:€™0e™\•IÒb"
ò”Ø}²!CSw…viÀ%0à Çkƒe/”Æ%l•×ƒ2¨déFÑßy<SÒ©Zî8Š\õBúx ¿1NJ/wº<ˆÊuÅkbŠó $0Ò#¡c›ä¥ýMj‰œý×qpŒ¹h8yÊ»vwPéìvÅgxHtl÷ˆNpåzÂR;ÑÚÞØ¡œ79Eä'„ÉC>hË±½•rÛÒØjšvE¿¸+´£ CŽòÃ¢x
+w”½s8÷„Zqd‹ò2hJí°ÌwÛ\È¢'Þ’+¼ö3É&ŠrsÎx™Hs½YF7ñå
±xÕªì1Ñ_	2½†\¢Në©îÓ¦ÖÜkî¥gD$¥ãB^åf]µ? JõÃ{†æŸs¥ù§H.xp8_€@†1%çd¬ïò6ZáÀ!*ÄBYÓ¥…ÀÒÎ0¬[§,°«óÅÛ¦1Ã5ÅÏ˜dNÚÞš—_]ÿ¯s’tŽÕã—^Ÿí|@‰¿+â’™-"¯Þ’ÖNùmQ¤Âw­„S‚ŒQááYEŠ*%<S‚‚½æS3–Ãc®{¬*¡JkX£u´…ÃØ/¼„ÒuÔX±	Uå]ÃRþ…^;Ê¿Fµ’™ÁÏ (ˆÞÓ™5u&=VrfTªàfÞ×õ\p±ó$åªç×³,Ë[ºQ»#071ðsÏ¬ª£«œ#¯ûJÂBCÙÛ¯ÀVÌ8/…
¥c²€Ž²¢˜a‚lz‡×`‰PÏýh>;#É†”†æ ñö›”wWåW”*l4ÔÙdpp·Ì©¢«¤)¼¢%Ä¹ÉxpœüË8zYùkÃ2—ˆh®$Š“ÄDu¶{žR·c«¬àðß"¶Í”¼& Y•NP¸]Újä@‡ n-g@­»F{D÷Ã®æÉ^ërAYÝÈ(×a¢7h®º†3¾BsvaÎô§8Ï®0bäJí’Õ—®8M='Ø­a2lË¡Ù 
¸Ì.ÝÙž˜X$@zY«ßJû!.|ØUc1n~²7!je1C“x‚¤YÆŠq:y‚z)v~!Š‡ý›Ï){u RóË`Òeø›””¿+™L)ãèÓ’þ¤*r˜œ™½„ Çš#6p¥üB­\,–÷¢É
Ö±²D”%
žœÃÁÐ’àlÌïÜñ[Å{(Å Ð/;¨_oTP?¼Vƒž Þ&77àÕ–2cäÞøÑ{¡Þ¢ÿr‹.T9=ÜÇhÌœ‘›ñŽ
ÛÚZIÌ©Ÿ“£º*© ¬¼yÚK4©ÃŽèˆÞÑàTwÜDl–Dxå÷ÞòUA¯éÀÅ½ñ6á6¯ÙÃ³§~PÑ8!ÛšÚ
‰OG‘½ãøÕèŒyE.WE„)AùŽàÞŸP‚¸Q”£a†2ÖqX&¢Öñ_#°#µHï ¦Q‚É–Ò¨ŒiäqôÞ^lì»Ã»HmØÑqs{§©’ÒÉå VÖ5ÅëI8œ¦I}“ÿ$Cd˜»‚í¡ˆrPjRSÓ_ºñ(M½óy…Ÿ+®özUÄÈÙ«å_çÔ1AYœ É¸N²hVˆYr rH¤/0üŠ«ž5™%Æ*¿ ì]eX†ª“þwýs•Kbk*fE4Å	!jÊïôJ`/ˆMÊï®p0yu±³´l®½É×Çâ"Îp‚A}…¦?À´Åásƒ·“8{OÛá<¤/³¼J…62ì
5<Tˆh‘e‹¦3BTÑ(AIòz¶ü€?±B&&´À|¢Üs&Cì$)­6¦¶„á·ã“—¬Æ¿ÂñŒÐª¼SûÁxÅx
°ÓíÉ½jÂ?NEæù››éÁa‡±\Í€VÓz}0´1³ª}áÍ>h ˜­Íÿçÿž`€5a¡%ý‰Û7»î
eý€yÊW-˜ïç“úÛ2Œ„N']qî`Ð†•U_ˆ$ÔƒÂjÏ+T¨gndqE<»¾Ràrå0<>±Xæ@ˆ—ÀWU c5‘4œ»rß¢StlÁ=„oIE3ãÐÙ$]U„«”KŸ¼
ºìÈª¤DM9B–Õ‘\w.¬€‰+0×³Ì—a‡šëÚu52m|@¤42kÌ¹áõSv|©[˜”¬áC«L4Ä£õw0S™÷4Â üŠ«É—ÖÐ›¹Ë”l¶…1¡Ûw¹zqµx~Öò­1"0Ö+ ó9ÈÃÙb
8ŒwNýøÃ½êŸlðˆ=¾Š˜X†°	l¬D(øÔ5â\¾Z¤g®“õžzëeÛÍkª,ŽîX<1¼¯å–d5$VÛ[ §Ç¤ã €Ù¯ešíÏßŠä h°l#¶áåGÛdo,¢UPÎ9 ¬£Q¤´ sh­w°5Ð”nÚú"ƒÍ£ã¦¼¦p“È¤/9q*¬¢Ü¼ŽoÅ¶‹§ v¥õ¬	C<Å2Ô¸~R8LrÖÄŠÖ4ŽÞßiàê°˜û¶‰
Ô½ªÑ áI#±¡)FÙbÚ_A³Ya-›êšU×I4Ã…jsÚŠ+y ÒÏ•¾¼+o»¹âœ8ye6ápIl¬;GíÝÁçœÉâô¤0IšÛšÛÈUå÷¢ÐŠÕtÖÍ¸ü(¢§„Q97ÉÖÌ¾DSþ¥½ÚO2(‚dvBç""Ž“èümø?¸0Âs°O äõ{»ÝQšs©^àWDÞÚâ?ÿãØçØÊå>-(Åæ‹•@Q˜
åûoÎÏû'È®õ¹¨‰Žëo–ŽjC€(všý”ãÈ›ö67ÿù0òÈySÄ&‘°ÌÇlú­Öé˜ßõ¬¼¸W ^3VØ¿õ,+¯:”F»ŽÉ´ñ:–WÉàJÐŽFJö#`â#
 Íµ¹EÌþÜè¡h˜Tû]IíÅŸ(U-ºµ3&—ùÒª¢1»JZ™f	£y¦!²KRVn[c…_²ºj1ÍÊL²8¬.°Õ1Óez£dIZg–”/ŽÑ	¶j ÍØÑÞ+¡=á¦-T…‰†Ò qŒ³0ä õ~–ÎL§CHùiP“± …L6•“®œ.'¹»®vvDFbÙt]Lš&Ûž´h‘ýNÖ¬ÑÏ¥kl%¿¾Êl2é‘"&Kež`œ³L¬O’¾CGMß¥ÉÉÜ9}0‡Z Y”¡œmŽÛñýqãIÕ
ˆ,àüsX:ó==C_ÊÂÞW^Õkê¥wÄMBYœ“uiFoëñ‰æ¸èBDhNËTŽœØ=BrÌ³r[Ö­Ù«Xí¡qša’)Û¨²ÕËr—ÞU@À‹W¬gµôÉrùWl¨m˜À./·0¤°DžÙ‡x„ÒJ9È‰0éh^õ+ÏØÓ¦ÚC ”qÑ?f§^‚ ây¤õ,î†í³ößA«ÖmŽOŽÉŽ‘_æëd#¦Y4Üd¬*ë–š‹Az%ÉÂ>'–YêdEK?ÚLBÜŠ#’¥.‚²›­ HPãÇÒ#‘XÑ!ïŽ/’˜BŒe0;¿©Í“¨ªR‡PôB©!¯eÜ*-}ÇíÙêüù*û˜Ì ¦ê&ˆÛ,K¥1Kt»™6S,Ùåêx”äoj+Šõ¡yvPLÄt¿Krë‰¤Ê3ýª ¦ ƒV÷Ñ\ºm'ÿ‹—Þ:ìžÚÈÚ’.…É¬s‡àÁóyV‹¼x#S‚3 åoÍÜ6Ž†³Ñ)Ü¸ÂO?Ô;Ù~hcš¨6­8iAåÚa.Ïš)ñÍ.ù	Ë1¶@Å4©â=k—Z*½¦Ê?ÊÔH%=]DKJž¦;§C·ú;0CC×e­tc
7z9JR.õ1]Bð›˜ÔBŠÁû£síÈ+F&“vã‰ÚVFÚu’ÁÄ fF_A›4ÖÖ<YW*éô|½FNY‰íˆSÔh±
…út@gÖF;åJ*PÕkT‡9éÿˆê0gl–r¸yÏ8»ÛPYŽštñ>®´J‹ &DqLˆÈ×‰É8gñ˜‹;,’ÑDôÀ@DrH,@ËÉ–] ª¸„ˆ
/”ÁÒ%43¬Í‹"¾¯ãiÇ³8(M.#ÿ![„€±¿Ù,ÑnáW½!¢›fRÝÂ*eb~ê6*KÒ‚DŒQ±ˆm¡DòÃ˜3ÆâœõÏ{'(©Ùø92B\E¿UXAkó	÷Ó†bÈé4HQIn_v2ÛAï¸ïê—¸ð$z¾É`f|8tâ ,s‹÷¶Ð“[þOÁ®f'“TÔÂŸRËvÄ9b`»+q‚m‹EQ”ÁªÚ¥ß­KE|JÐòŠQò±Ñd$´n§w›«êHY(í’ùPTX#÷yE\½¥»Fæ‹ÐœkóVòU¤™¡´GãN­êPæG6…çñ†*ÝˆÁt…eàYò`¶¡Uû7ªžzGG99„=B,›…ýqˆZÆ¦Ã`¯ôJ˜[›9Í0´#ßªM­þkÕaæ©‹êYMÏL€ºçæg}ÐA·M	µÄ³ð‰bâQ°b/ o’ÈÇØh•peHiÖ[_j8éÿåBJ@¥—¼ÑõÒxa„‰þ_zû ÄkYCû9HùBh€Aðã\»£aë°2ŸU£XFí	±Ýä1,‘ƒ$‘ž÷¿;<}3€Áaòç0 ‹(sµÖ’êRhGŠÁrA|DŒ'†êÚhÌj[ÊÇ>cZk‘r$áX+òäþÉtqªÁfðêÉ—C¥5×­©ù)Õ4/Ûí.ÚSZ½íû—´µ½ÇáË5žUûA×C9{ŸÂ¨¾czéÞ½È.[ã¹y/´‡•tƒ”JéŽ­s)r’R÷¾7U€¿”.UZV¥*Ò¤tuí	')-»‘ÿ­êˆÓáè,Là']¹L¬t=[ÔÍè2íŸž÷ÅEoð-ÃÍ¶ö+Â]þ¸6Ø]ÞU©êeä¿¤P$&§@’\JbŽÏÍÒ‰ÊÓ²Ñcž¡zsS Ép/¥U\Ì¬MÕ>âƒsZÃ‰¨¼*stO…~½ŠÄpñ.È¦Ûê]´Ñ!{§k\ìÐõVø†\BZ*¡x{W<ÂuËuÛò}´$V¡Ê¡–{-Ù—Iÿ­'O»ÂvÏâªÀÖŠÈ·‚a;Pl³¡\¸ÐÅ–\¸ðJtc¹!%eÀGªûäkô|Q\ £,ÖôN 1žÿ 3 u¦+4Kš¸ÂŸƒ”ÅDcFh0cÇ?7Ý¼_!–•:«_® ,;?™})øÈ:D@;²‰I]d!ž<ëÄ%÷n—­É¨DÖ+¶ìÓTèyƒböÙóšÒ;¹Y²1b`¤_ë…ìãmÎÞGnŽÈúÛdœÂ‚'¦wcö'j’´RFCôë‚“ÙÝ(ž'#|~„Ø˜Ò–	®]‘%;#Æ°ä›S§ÊKôŽÊ¬ +ÃsWW]bæWy¶ä…c-)c’LPšB§™OÓä0d¿”3\¯?ø"CgàìåèÚÝ6ñEŽÉìØˆlðï>ùÞ['×˜r1Hèô’k©f·Ý38ƒí‹¯çô_rjPyu¬X©&Kúv¨'Y¤ˆç3°cy\M–„ÍçÑ8VZpJ ­8«=°h²ê>È^¼ýÍù‹KžãËSZ/Pý0¸è‹ó>fßÙ¿8<=á™rûì(7+
j©ãXccÈ£°¬)Z}n±eK*o‚o=­;¹ƒ|&û³ò‹·Üêw>‹=’lPR”JxpÂ	™Û¸OÈ‹@´0Ÿ¬ØÙÙhß–T7Å.ò‡*L ª[ÆV–v~¦‡—8ê'év>¼3w0_Ù†‹ì0’%5Ç¢ƒØ<¤‡é:2ô)G0ÝýÕpŸTÛ¤1OŒ¯+ºM¡„SÉÀæpžœ…WÏW.¶;ÂªåzFs< €)öÉ-—0‘_rû,$ŠpÆ£jšõxÔ;å¶¡Tp–¨ÖåÈ’ðÛæA1\ŠëÀ$ ®— ¹p Ù»üt?Kše/…ó‰ÌŠð\ú\^Fey'èäðçþ4Ç"vB¼ôh^,+.ö{ýWÀ·ˆÞ`pøêä•bçoŽúŒØÑóõeG±’T4†KLž-oGÃBÓx™&)Ú¼€é(J:74E_zà-Z¬VQqqd»ÈW¸ã¼>ouÂÔSìÔvIæP{bê´Œ.û]qØ5][;*Æ¸“»FG††wSÖíysrøooúâÅáéqïüÛþ9—PhCó¾„?Xâú$ÌeBÑ°hmÇx
ƒt¼j¢xVƒ:¬)[Œ,ÎQÚIõÆÃ÷H²H”x
©ØÇŸÊµ’ü)œ”ž’˜2ÉHUÛáØó\iD6‹åpnWð£¼àOLH/ÛÇ¬š‰œh^ÏªËª Åo»½×ÒÞcÔì“<W–£xíRÈæíO6áöfŒšvâ:°YÐãJƒ Fo$¢—¨³ UPõºL@K4Žfha´¼Ø0‹ˆ4‚²]Ç:_VR,{7q`O6XÐ²MP* 8ñ¬Òf,å²÷ªì!ñtÅc‹žI¬r2þeïÔ_Z¾«î FŸ½Ný%õÂî
O£ŠU–×§¨o!º×¸TN|µDÉ|§T^+)ÃÛ†ƒãqýUß0þ,ðƒ¿rîu´yùKJ¸æì-ŠBB²Gtxæ¨£;'5+ùKÕµUêš®ãá	 HÀs%÷ífÈ Xx¤¸mÅè¯ŽÅ-³÷±´²hŽÕ‚èa"ýT\Jt€W[Ý(÷orÇ¾ÆEàÂvô%á;Éµ#aÅoÎÈEŠ]Ç¥ÄA…Œ"C#çJ© ÕÇ¸æÉl9Ê3Š&4Ü7–evü+bm“·üÝØ1oye:Õ,1È
[ëç¸ÖbÓì"ž m4nÀà¢w~ØgÿôHß ‡¢Š»%}0B0À«-mÑûðý”\)HP~Þ Ê^ÜJEH)fwfN•…§œÈY{ ˆp-¯NÅ‹Þþ·bW¢"ÐîM1xóâøð"°$CûðO*¶qqä×Ge¨÷Ûš+Ú¯8Q~!ívÈYÃfA·Ìà1Gã+KbUeÑš[½ÊÄ˜EƒêQÑ!àUžG7Á¹4sz%:&…%5:ÞSÖ.ú;ô™BàÓ„À§ÉwbT*8‹Q–$B¿Œ;^O|ºËªE¹ËwUùOï?qÀF2wb°Ù”jàíÒwÛ7éöªä®L“rÝÒš?Äe*Ìæpš†Å„Æç–áˆñ³•”A&ÞQ.rÈ¢f a¸Wý“ý¾xyÔ{E×Ñ$Ç Ø…’M]{v/0›Åü…rmÇŠ÷˜÷µmsvo4F•’ëÁz$H	Ï)@¬
èº;{}½ˆ÷@¹Û–´‚¹×ÞIÛ•&a®!ó²õ¨‰*pRÆ+•¯fhJ	ÙÏYú­Ê«¢9ÊÂp”t‰1²ãúŽn×u‚.b¨FÃÌ$¨‡åDçsò1ŸÍÞÇ.ÒµVØ&…øÿÆÌ9a^öácCM‚Ì^gº¶,ñ©4¥Ú€`ÌPO¤ÏYaå‚¢ÛwØËÜ .(–#tîÂ|M:îÝZÅ–m¡;™'³H¦˜‘·†Ò¶Á¢É§«¢3Ò†XÝµÅÌûjùÔÍi$õzT´”¾­@ð®hÊ4,m“ ¯»º¢JJPµÐùaáèO.Rƒ!Ëç	:ƒIVz3šÊÿÂï”Û•Ö
N´"Ó@8Ë0« :˜X“ÆéC§f #p&}^aÇäP 
ý¡	äšÜ91ì‰+Š»8¤¥ñ‡	öQ›=í2ð=1Ý´OÍ}¾ðöTÈÁ‡á¨µyÃ\¿Ê|Öl³Mü²þ$4´ØÀôòDm5“"™ÐfsS'@-^vý™ª3©7{âº ÚÞÍ†Ž¯>ý:éÇÕlrqŠ ,‡k£SÆú]›áÖü°céj´nÇ¿„”h„ð¬{©iZ<%3IÃGs8Ž°“—,qc.]åÂY™$Uñ{ãÞ@º¾P¨ð5[OkÔŽdc¤,½ë?ôŽ,Ã†mÉ•êÔEã<[ ’ëŠÓ|¥Zý®åL}m¤ë‰má+¦¸³<ù(ê Îf•›t®ª ªf !`DÞX%J*iy‡Mà`6É­&¶y+e¢ÍLæ	%RS
wc²ç(žIV·D¶³µó‡-ø¿mWäž×•9%¯j¶ÓÚ7ÙÒ¥…:YÔú0,Šþ:‚&r¢ÏØZsS¨„XâñVÍzÛÖ–E«+7Â¨Ž(j9;ö‹È¢;h´,¦ÐÑûeQ%b[ü•ä,`ia“åœ²ÄMBÿÔè}2Ãü\y³„½GŸ+z~H»…®üÛÏŽA4$ÇbÌÝâÀe|FfÚ·—vu‡.……µ6¶Ÿ9OÑÜš›¢ ó.)Uáóy·$—eúK+œèvl2f‚m:]Ê„ó/8ú ­3…êÄî%’»†$þö’ð{m9÷R][¯1Ûªq+Ö0aû#¸”Ïø[ô…Ù!ƒº½H×d.Gnwê›}º!MmwÌ<`Ûó~4š¶nüz-rÎñ5ÌUŽþöæÒ_šjˆå÷,y›~ð¥sH‹çÞÛ]ê¼««áVû$8Ùãf
fnªÍˆC•Íèo˜@wpÒ\°]6^QÒºàaÝg¡n9cžêSþÂ¶2á@à“$-ˆÁVßTkéê	T.‚uœW9ðtYwhj?G^y¨ÒžÑ‹ærš˜J/ðØÎhì'å÷o^w±,¦•\ô_S)†Šfï™L%ÿ	Õ¬ô`Nk×w¥Ö;íÿT2‡|4€ä!9ÍÜÄçÜá¢‚Oþqw`ÕÊžØÏõÌÔ¬¼7_È4€YÍT^çÆIÆã&ÑÆB6ÁÈ˜•nU•9¢DØ £É¤ ÿÚmÝ¦íP!œ7H<œí~ÜÅt­VdˆTÔõ
Ð°ŠôJ­‰kÔøØ—§Y©œaÏ£rcjö±©õY—Ý9kÉÙÏú÷Ö;Üöê¡¨îœÄØ]ÇŠUTvÝëÈÎxïQLå>Êš…Â.‚ÉGpú™j®Ÿz¦»óÜ¡ñúUaØðß;“ø§$ï
öŽ;<9{C™7zâìüô»Ãƒþ¸8?œ¾QÎÞo#–AÊýÝ'_~$8´Ð3á*Ê¶ïÃ ¢‘	æfÎ½wü_Çåãé°¤¦ÓB?ÇFóª¦Ó¸ò?âø
“ÚyÍ­7Oî;\uCì´švº¢§œÍ¹à×KÎ5)4|’Í”Z(À¿y„'€çA¶©ä<íŠ£ˆ•z‡¸€™q~8øV´HuœkÛ¢ÒdHúS´Cc{dÖóëú1ÑÈ!Çôê“.§×gØ+ô¹ýL0ÿ”Q—K¡Yú„ÓyÖJïpí©È7Vœ{ÉÍ ] =8ÝS¬ƒ2ž.ÎßX^¢ö€žÜ˜‡{tcÜ°ÉŽB‰¯AøûñŸýÇwƒ>â¬.1G6Èœóª2Ür4úñ¾ß¯ùzÿøNj¯”ã	%Ï‘©Í2Àˆ=ÎÔŒê: “:EÁ|çÖ4†A¤c/Ü€—K
J¡•î›ø…]ý#–}TtC7Æ$¤rëëdï¥ÊÛ®ŒÕYtÅ©Ìž7#Cd\˜ Ø!S£VåÆûòêÌÀƒ“ò[´ú˜ä›x+“w{F®É+PNÀ*Ã+å'0‰Ã;ºxê—àâ›”OÜ­âêFÄÊâC¸û 1~%W¼hnñMUiüUD¡˜]#Jª5\­‚ã	Óäã~*ÕÉƒ5Ç?¹Ð«Ä=˜SH—|E|ò)å% ;
Ó“ªùŠ"RúÕ±¯’ÊN +OÔÕšXUV‚Má<ì•lÝÎ6–¤ž2à±{®¾#‚¬­²[SÙ¡ñ¥Ì!ÉÒ™¦RÁË$ Ìv´¶ôƒ3YtPp¨‚,â¼€w	fÓ©Æ_aXA†ŸÒ“Ì€JRÞ¬3¬º`%Ðp²Ga‘øYpµlø‹e[órk>È9Ñ‘¡Aù+ìdaânwkcÀ!Ú¤üg%+aƒå°Mìv¥"îÒÊ£ë`ZÊsC·eu×ve†KRºy¦@MYz¹ê€"TÈbH!:ÊÄXTýÝ“tì˜|Í@uåRÐà€®|çÇôÇôPDsBƒœrIÙ»)TŒ–„‹|‹L¨K1^n«Ñq_â(±ix¥b¦Ë®xë™u½jd]«xÊÝ‰ãÔƒèçSDéy+\sÐ"±q—\†µ'[+ªh«ZFWá•ÞØ•¶C»ŒOÿ}¢ä-Ž™w«mxW¶´.Þ‰u]U``šd¬W·NÁ}o8Æ(KØì73Àÿêí; Ko J—Þ€[¦o|Â¥\q>§î¼É=ãUùxL5ù•WêïS#þ½\©öÇ°¯!Yà€†¤â­È”òïw*Sa±‰|¾xÉôüÒ¾F†S©yqä·z“ñJê‹ûW‡"¢ºÊ6ðê¬rÝ$Û‡vº®ür%L)ýz%O0<<h °T²xÉëx6Ë¾G12YÒ@H“ð+ ¹UŸf,ñÈ énÃVyU„Ï8žÁRÆtö/ýE/2<s„)yÒf ]}¤¡Èx¤EwPÉì¢QÖa±Ø…)cµRÕ¡)4%q³ÊÅ2W¯îÊQ8SÔw±'èUz±ßùìˆk-"¨ÎlÈýkøêFÎ‘ÚxñD_Õ4°,ÖWœß¬î[—ÃGÏºª4áüÀù<›mwø’]ÊA¸³ñ5åD-*Í]VZomoÀÿílí|]]¾]¡ùö³ÚæºdbtÒÉ¼ƒÃIA)”8'ñ.¥‹ô›(ì/‘u?>…&¯@ìÑˆ&;ºA»ý„BaR´Z|ÏØD^,'QÎñøìP†¶ïœé&É{).zü:×gb§[™R¾}/Ãnv˜£89‚…°ã;%³+?f¿#Wƒ¤ûÑµ p7Žä‹Œ¿pÓcr\Á«8…}šf x‹žL:"E+–ÈÕIgºâtë4z0¨,äœ	¤Ð-AòZ˜uøš²ý–Hkgq=CoFñ¤Öbkûø®M"f½ˆ†È—²ø;‰2pŽ]ÜÛuù-×~`ýr
ÓZÒCX¤¬ÞzéT½ï’r¸ µnÞÎVíÍ{Ü¡ŒZÓx¶(dV”i§œ7B`@PíF{Ý¡Æìÿ#FytÐ*/Dº,sf¼)Âû÷¹ ÞÖÊØŽrÓu½3wàZ¶V±-s8'ªRØ7©¡®yiñ$ª³)u*ì·ScßJÀ)C+Ó17ÍµçìÔ5æ4¦ &ò\‘’Hèø#LØ±ÌQ»€cÂ^Va(æhüö8UÛåÝÒ\ ï¬Ï½EöbW¹÷U0¬‰ÍVÁ°Íâ‡Axñ<N17Àê² äñ‚ü_Ù=Lñ_y©¸0Jú,#ùÝcÕ¿¼¦8¹Y²È ´JÄÑÂé¶mÎ‹3ñ#/’1§	rÊ´N„†b	p‹V0RÆe“c„˜]j4C%».‰9QÎúèàhc_Dp^qG~€˜2ã1ã	d#ÇA“/GQbÈ¹ê¶F%ÂåFk@¨ë*+°³±·­éôì1'FY0^ÊýëŠ–1EH!sÒü„åG™Êþš¥‘L§l‘
ÁP.ôXuÊ®žèý‰	µØCZ¿MJ|'E’Ö²ÓYXY0
#JX†9»Œ	#:Äè%í&Q øäÉ›Aÿín/úè×Ù›PIkßŠ&+[›Ü>Í{tg“v5¯=[ÖÂŸô­ÍûJ[ÛB>Ñ±0ƒ€M¥âDö^œ.÷ÅàÍ1|û~hL±#Æ*Íº44úÙÏéà0^&æÑ_¹ÎÒ”YÐ1–½æ»Mßfó­]ü Ïûû‡ßõEs¯alþÅáqÿôÍÅ m2~¨ÀˆBëû¥/ÿìN¾@ìû,«TæhÀÈ¤î·ˆð(=ŠLZGéº±¦.±T`ž#æÑ‡d¾œwÕGMËC§‰ÔÓ‹ã¤,HK¾íu&ZÛÏ(	²îµmº85êHB¥?ÚU½‰ÚüõïýóS¶âðws Pâ¼ì:›]aMl§Êpy]ŸñCç
3°f…{ue÷¹ôúµ"‰ÂAøl%CÚª±9 ²1²ñËØR©wÌô…q_ÍÊÒ;iñ9Q_žqÐšF©_ÐÆvÐ?>}uÞ;{ {ôƒèü+¬£ N0_Í‘8ï¼êlû¢Nn YèX)~$3µQÁoˆÕdb"©T–œ¹ƒ÷H®¿•ì$GÛ~GÚñ9äJcÎÉ‡ŽDp2Ù$ªÇÐ¿'ñ†Ê¿zyÞ‘_ohìJ$XR©‚C³úoöÉvâ ?€+~F¦Ø]ñ=eÙdÔÚö†fÛíM%ûÒÒ!¢,¼`A¬¿JV«ÁYÿð%`-²³£›pÿ/|xŒª£kÁý*7ˆ>`›!ï·Œ€’fCMŠ¬Ùz)˜¾‚ùJêJÕ¶˜(éuÇEœá˜r¤)x:_¹_1Q‚ÀW”6ŒSñuü‡¾ƒý×ýãžø—¨oû®ùLY§²ké|l‘QvÁv!‡¡†²¨JUí­ª5TM‡ÑöÈUß*Uû×[–ŽºÎ³AÂšØ_ï°Àÿoåä5 BêmdöW8EX<’ZÖVx¢‚æ]©æÍ"Uem²t¿F‰)ý8âgàãK¢›UÑ4~ƒ8ÑÏ‹bìu  `)ð9K@R
š‡GXÏ—¥u%Þsz[	ûäþ‰ŒÑ {,æ_$j¾†²U‚Š)™sÖCPy—…2ì©…p•d Š.b!%³öú‘X´ñ†±2X£Â×}ð•¸u øRA*]hTÿ4PÚ0©þÕƒæ*ÈTÿ, ­Â'A_œ£
Ïc-½ZT–J|¸Á˜ë%)ÈèT(‹ÒJuÜçºfë•ÎQ{¥AÒ91s.¡<Ñä?þ€Á Ä›+(ÿ	ë4Y0ÀÙŒVi“-¯üá1òÊ/>&Ç>vÿ:J®Aø¼#“ŒÔõ¡cÚ’½Z=“‡—ŒÒB;ÔH9BÓw;C¹ò0òƒ¬I‡µ©T:n%LUf£lö¹r—­´çš­OÄÍ¾zþjZûÕhþ)2Íg‰&ôêüôÍÉÁºÒ	æž„­J?ýû:^ùäÍJ%@u/zç¯úÑ:PIYÎ-¨jžQYU´wM¦p>QyŒ’/bÍj4#zBŽ¨Úè Ö`Hùý©6 vDÈ/ñ±Þ/ESÉ4âv[Èäl”©¬·ÿšU‰P¥,|çùî8i*¡ê»|o6Lè#Zje¦Zæbºº‰´Œ_Le•cæ7°2ŒXÂÌ3ù¤Ñ6_èÈäžÉkc\ BÁÊXL"f\x0HYfÀúÆŽäžØÄÉ9^ê¢É¯
£Š†»•vlÌtCÒ†Ë~ñöéx¸íe	"æ
“ ß&s÷^PX}Ý{qx|­ªo±³ñT©1tÇÓh˜XÕÿØy¶µ%Ð7‰â‡Ÿn¡Íd‰sÿŽˆsGê“8)!&$ âƒØB¢kÔ!oo‰³ã&sÜÇ½äY’Tñ¯ý}Éq«™¿Œ}l”Ùm¨*›â)E0/5yu(Näb±?™%õÛb$ÈñJ#` £ÉDêÁ
¸¹øµU¡@Ý%|b@wûOÏ¶¬˜]—&<þ"S…#²–™Äp¥QÂÎ0/Ž™€©ä^ˆ¸)ƒ0ŸG4Bqûf–EcÔ4ÀˆM¸e2ãÎ®ÅÎS’\€¨ ‘7”¹!q€·€m{þ“Êä™[mFÚr¥°BD å¹[©†‡I’ +ñÏH­Ø_€åz’„ŸÜ)îì¬˜¢ÑÿK‚—X_76RâŒ%EÂ¼ 4½ B:Fë€bh€kšÄ•-Íðš+§™ù=[1=ì ¤EDB’ ê-œi"'C<¹ÆšL¿§ÀâÕTkÍÎÆéÞI?«Ÿæ€)ŒLPž•L–œJ×¼ïŽŽÌ\X2–Î.¬½GÿTobCš¥?á?mh$§'lÈŽ;Ý§+v•\ ø Å°çãÕ`
AêD£a‘å}©ä-‹Åd‰Ù&Fy†¨<–Ç²ÖÖQôïÿ–=Ï¹7Ñs¹¡jM_³áaÂNÑœåWþõl™ŒÅûl¶”	ÕÕ‹r@¾«*WøZ“EÊíÝ£ p„õ=JúG_<Q™·OYA£$DFR”eGBvp_yâOTþ=ò¡¬C˜ ±*ãõÂ¾f7âO-E¼˜ºùž_4–nc½¾“)àcl;5#I:Å 0~ ñ)±<A¬¡õ¬ÅtÔ÷d’7*Ro<•fïLòêö"–÷ÜÊ8E“¤l!ÞAÞØ~öO„à ¨ÖySÈŽxyC˜á 9ŠS–ø;1“„¨£B„“s™j)†‘5T^k}‰‚FøûÅµ\R¦‚xfCÓq»¦— ÉfŽàüd>L½ =ïdñ»†Ž€²NÈ•]=–`×S (Æ ïš¥ÜþgÄ
ÒHò|×¬j-Àý$#íëUÌU‚',5‘;LC ’<"g}´Ô]³Ø†o4–tßžßÖ3=½‰=·cE“jÈ}Fvt*s i~IîLøÈlwk&;Û[á™(.’ÜUbŸ”ÃL&|u4øÆ°˜]°ugsþ¤z.Ïj6¥OÞI"Ç[#g\èc£ ¤³œ†Å¥}ÈûÚ´©¹}~_‡gzã5)bfãSEÓ%ÐÞØ@[¥ÙöáM/@´Õ?C»­É=Ý	On€Ä™²WN"¢Š‚
ª$œ³ý%°!ùP…42=mŒ¦Œ×”5%‚c,À8!2>Äù@×ßO"ÂöNþÑº©sg¾çŠL³æK_í“†Îfòrh­j	$dýÉ ¡µïBÍÆ'%eø ¨ ©À”÷ŠÍ„«3góÈ8V™Wœ¦5gnú\Q²t©È³%[*ò,Züñ™!Ë‰¤&ÇïÝ+ÓWO4µ;µ	°êT¶ªw³0¼¿ *)¾¦rÂÒÛNa—úþÛ;ÿ„‡a¶Ô×y6zp&FüzkZ‹yèâˆC};pLõãtDÁm_«A?K•ùÇÇ¨2UdòU7¦¨?`qã(MI}x¯T—iïdÕ¥t¦^Äq¾‘+ïå×Fî+ä¢‚^¡EÇŽ¤rzE§U‰¬1Z&£¥¥>?©õÜ Z6Z‘óÿ_ÇŠÃƒþÉÅáËÃþ0ŠÌÁºêK©¨×î¡õ
Ì×‡¯^Áÿ“ræô¨wüÞÅéŽ%X“)b¬Hƒð¬Ï–ëÓÑ¡JÅyO½/ä+eÔl'èëÍ0YH9œwôßÐû”rb	2N¾¤8Aº|Í‚£Àd-2â·]‰n'§ Ž%ùLÖé3qvèÇ63®ec˜/{™©Bp*àÚò“ë}Ýë¥#zð×·‡¯NY¿vÐ¿è0ˆoŽŽú¶ÆïéÆ×¦.e1ô$S^q0wW`¶ FúW0W‰!"3Ê‰Ô!`àã):â).°™Nd%s·FTã+K7a7¢EÛ‰³å}ˆ%xs~ÄùyÉV±#³|lÔî~žvÏ78«í©X›†Ú@nFC:Pªbäå¼w†¾×Ò
ãô,O>ÏFk"7ÏÙé»¿!	ùä,?.ižìFÇ¥çàÐÛÖM° ƒ´¹tvõn‰¤LDŒ<¨|¼yžìDô;DO%Œd.]L4¦b4éÒy.‡Äk`Í¬ñ±,]™!…ád7Hçã;ðr6MI²àR€¸8-»7™ïËrQìnn.~ºéh˜tÓÙ¼›&Óî${¿ùtûë?>Û~úÇÍ_Þ ‘JC´$E&BÕ Šêƒë
@~Œå´ö³Ñˆu$n˜S’æõ%qÏÀ¥Ìé*ès¨”„ZµQœÁÐAs’v¹\E¢Ó=àêŽpýy`­™+Ðè¿€{%p«ãqÍ»=àõ-ö•}ÌM–¬ñ83Ö¡¼Ò‡°â|QcÔã’‘©ÐÙR{o¡jSªJ½·ö©rÌ‡±­$¶8j³½R—¤Yl šh³OÙ…ùÿcïê–Û8²ó½ŸbÌÒj€Z`@PÒ®YV (aE JÖR\$†$–À@É´Â­\å6U©\å*Ï«\çQüy…œïœþi€”¼öz7Q¹\ÄLwOÿž¿>ç|ltzôÅ¯Ä©!ƒ°‡«ëe¸‚kåox“ðí;¯iåHL(,-ÓW¦W°ãr‰Ù’ÒpD÷dÉw,HgúÉkùðË¿É®å§Jç6¸Xä[åtSAÂ{Ù"·’A±ïøµ[Ñr¥Ñ}úC{úH–»†r2ŽœËHT,„LaãJž‹¬ƒô@Ð||Ø¼‘çT­ÂôóYû¦ZßÉ¨QßnovÙW08Ñ–öñUž¡œˆPë)9/%ãX¡¼…´k’rÏwzb®c—;-ùhT®B=7~ÊW­n—ùZ´7aœY@häe\ÃùMÏ§¸ÉgïMV3)j6¶Û;ÜnïÍËÝ~ç%­P³Ýk±‡”À¸enï4[ßD­Wõí=ªŒ_+Ì½3Î*À™Wo×³Ï¢í0 —ò8š_›]Š'f¾Aÿ5Xx­É¾„ "·ÇàýüÖ>®ØIû=²O[ ÅbžG’qýä%B9­M„æz2k›ñ|Î.–UØ5×Ê£ºCðˆIO2ôIJ¤&ÆwEs;Â1ÐëZTÜ\9¼ñýÝx¸šÍÛßl×{Î²k­Z«a²çg*}+ÇžŸ¥ƒw02ÌÏ‘íxú^ÆÁÌú5‚Hg“Ê³‹é‘ø¾)¶¬FÅJG)zý¼r‘¢“E"w©á£ëKxëJ‰
®­Ê't,àzzÊ)S¸ŠRLð4õå|2}‘OSËÂÈZ¢×üÑ”ÛSÝkœaÄ©+jì¤—DÏ»Ž™/›œ¾Írk·]yÙì6i¨Ú`‚Ä6\’ïÈß‘¨FBØ¼˜hãSíh*DºF¨Cg„š«8jµ…0˜ÉNž
8ŠÄªDZ/f	`#T´ÕîÂ‰çD-xØ€ÃÍÅ±[p¹úÕd‚£ç‰™¦Ð÷.¦Ós0_C$ÝÕuIÓÐÓª/*$ò„¦©»g‚7LµI„¶(>tNqýj8ZÀÐPŸÅZÂ9=æ1äÓS¸ögõ‹èë´4õ!À¥ù”™|Eß,nÔ'4õÈ¶Ìæ¯bÔ¶ nìêMG`"1áHúôÿþÿó_ÿíLò¦3$ÀÌCSºnRˆ«ŒÚâ))±uÙž„4Ë,JÖ,¸¯;ž®æÈR7™=o÷ú.ŸòíÎ3€¥wÅsÆãF]›¶<¶[­%ù™c•ßë$‡	ìÀ¥’†s‘VØgJ2;éóä8…¾CÒñHþiÙA`Õå«öÕä!ÊT®³-åaR•ŸHwÇÁ1¨øæšX’BüÚg´%ü$`
‚AðáÇuöˆXŸ™gNR»¶¿J}l˜Ñ‹+¤9úŒ6NÅóø¹©¾==5s7â½œá¤yTy"ªAÍÉá/F·ÒRèx³«ïçÞÐ$Û&¢%£töúÛmâÿ÷£ÝzBQ½Ûoo!»U³ÕW[äÙ^½ÛìÖÛÛbwÛU)âi¶Ê©$Œbi“ÂÈ7:¼þ“€CÑ.<‘‘@ÿ¼wv:Œë²Bì?‚8:ÉYTøúÁwtV.!Ió½õôD/-ØWëÉÆwÊ€Î¯KÀ¶¯Ç—gÓãkdŽã  'Qµš|ARþ¾D,¼ä°Sí¸­S—þü ÙP‹5E~ÒEæ?ë¤è!KY,¹¡ÚˆÔkþ8›üž¸ã¥ f“¾87;Û¸êÉ¬8aJ•×cšp¦Ó9nTøUQ¬žrì¦'' 9Ög’¶õVüw„kÅ…BKÄÇñ]˜ •˜ä‰HáÃžp.à…+KUÕ’¤3I?'—^p=SÑºÁ/i8=¾KRƒ²žjÁÝmjCÿÃIÚý:ÇÕÕ{½ú‰ë¿Ùm±eµÕ}%¢%v²·€(ƒÚŽà¦4:•:DHzb<wZÏ¸}ø,îvzmý·„DÉ_úø´šqþeÂ)GéE±Ùç±¶“¨¬rrB/×P%~‹15Ì>ÐXã¨ºHÏ*­ÜB×vÇ¢RÇˆ#64ãSûuB …ž_!ÈŸ˜VuhÝØ1»:É*	’ûGt1“Kž$£=ŒˆIçÐ™qf'´¡b®3€óå”F¢ÐœaõBÊ9 ÔWÂÞßüNÆ2ê‘³ÙÙt4\djŽy«Q–u£¨Ç#)<oözE¦™æ› Úûâð’Nú¡©zI{ÃHß­o­]Á¶ØLÏH®žÎ˜÷ÀVn§ÎbÅH7‡l—²Ÿ’‡ÇáÇGÔLz8¤‚ëó–…AR ÷Åñ”DÎJ}¯Ùî«Ø½y1jv8õ£$!QY¨p|©ÈˆGÙ.ÏIðj®3S™< ®{4:"4Pepdrã«EsAÿêIô[SèxU±¦XhüÙÒÕÏdQ(øŸDß§³iÙH‚â5<N\ (Ý¼ Ã€n–ù¢3 ¼±Ä¤pØk¬
Ætì¶8gRãÈª„ÈÁº0C3P!ÜôO'Ì:¬T¨˜£æéåsqj(}ŠQøFÌËí Oˆº)+­4ÚJ¤oã*¤ÊH«¸ï']óx6‹.Íy†¾Íj‡rÚqE4ÇpÄlÎºnúÇwRÌ]—Ç,É,®Ç¼c–£«¼á+ô…×b×{)ÓäæEÙ#¢ÆÔ÷‡Ï‰KD[½.gˆœu›íß·š–
Ñ34p³[o¼Ø	9#h¬C­t£úËV…„¨íCÓ1„	fÏH¸/·ÂËi[$ã–¯.½¢Õ\ÑéP4‚Å7²Å{Ø")DQ¢ÙuÃ–ÿšNU‰¨©r‹¡ß÷#•ÌIFG4–šLdÐt8)·¢ö'ÑWß|Í)RL~2ÎÂ4—Mà³ q.(›ƒRs H	µ""z÷8Š{WGe}à
*×2œ8Š™âÄÖ©Õ{²ñØÂ\ñõD÷$¨ÌiÁN‡â{º.;é@Ò‹+çŒQk2O>>- Òww÷v$äøãsœ°W'ûl.¦çéDDZ›%  ;kM)Þ:7&¬/üˆüdE3°¿LÄù 3ë*³Ç+6‡§óm- Ðd_¥¾ní†«›ñÒ!¬ÊW U•®ÀéDöx ‰Gå¥_[–%!”¹¡ÈŽPŽöØ$Góµ†™›Œ4:R”Ä¥ŽC)j)‡½òj…ÕgxJI³÷è¡2F˜Æ4BŽb‰¦¢–D%¡© D¶ é»©<²¼’Ô§Ê}+¹½úEòˆNòÆFòet~ZoÄ<O>Ë¨E=A¦ËÆK±À©ÏªpÚ')k£š¬«–u”=­VEãñóSyÖÛÜ-–˜MTmFnãŒjFuå)±·CbX£³Ók÷ú­Æ3#qb:ÐR¹:”µP”<«…‚3—!)4PÞ×G²L«&¸”™*iËß`ûÉL˜²;Ún¯·ˆ¨8¤‡^pÞ¡˜/sÙžµy'Óèx4#ÕORe™­¦ÒñûeÃ™.‡<‘¢?°¾À¦¤«ñßÿkË¥ùçÁñ;ãü4N¢†n±b›ë_þKnð÷gé$×$¼L³Í²u‰#£§³ÜGEBÔJ÷ë½ÄQZÝJªÕŒž·êÛýç’æ¡ÕÃ91ºëVÎWÒÒ¹¶´±ääj2IMJ²Ù˜…-{±¤"¤?[ËQJ ÅríT3u=m²" Z«¼@?h·k¯]a‹ó¦8–L•ðƒí1ÞåßÊ,øRŒu7æZþÓçá³·â$³åe
¼æmhjÌúÒ:d’¶&ò’è7ï6	:I¢ƒ¤ø)rü#”ôc-Ë?0HYd/¬@2zæâ$n%-j­ì—¡›´M(§‰)Üöøf·äb± SI}§ª&©„‘¤J«¤2VÛ­H'V{É7qzÎˆlßY’’"Ä“Ñ€_Ž»	¬÷ü»X´Î1²Ú-È¥Î.Ô9`œÁ±FÇq2þ°Yn%œ€Av6‰K0W¢†ÉOOüiÇV/•Äs÷¯}–€z…ITæë'Ñš°Â-ýçtXž‘ž2Õ/G/Òë‚EåUÌ¸„ê^3wÿ¶6>­’÷që~[¾®Qƒîß7Ùƒx6Ï9ÅoH—fxÆ3‹|õí½g	NÓ¼_Ï•eíæÛbMaííd­ý:ZCú:§3Ö“Âëý‰Lv•‘î	#´<Î˜«°âGã´Ï>ãÚŽ;Tk’§5úGVÐôgFÆÄÈ_KçÅëµ§ŠóÄŒÆ§úËÅ,B¢F©Òæª§ÉœäåEaíñZqý@ÿªÑ¯*ƒ'®qó•?^¦§ÎìÙÖpÈóPmf§½·à×PÈ©vÎô\9xX>Ê[fm¼y ¾;kk}R¸PkÍ›*ó©óœ§½ü<d†q×Ù°V2¢™Æâ;ýÁ&{>ëíÃ¿œ-=¾…?–ÉÕ¢¶Û{Fõ@o#Ø<äœ&§%9K¥h­x“|Õ¼sénL'êRS£ìyØkË°ºô¿[0»ô¿;awé|!ÇÔ+lž»…ß«ô!”#n±³P1y˜wÍr¦©Ra&éPÈk 5ê2Íõ Uy-Z Ôô:{Ð±ïÝÂûTæ€}²ì×,‚^d1ÿ>u®Â æèÅhìò-µ)n|
¸£Öï“;/.`_®–™§Âù
Âè÷h¯8—Ï=ÉÌ´êkT‘_KÙªˆu[UV|w¿eÄ0À½œÃ—Ê?§5oI½ã¢;ÖÄ~Ñ¨wþ4Ë+Ø°Zî‰ †ÎÅÝ@žý]hF˜„z„hóþ#IÐtôr‰ÊÈØeœ»xPÌ+D‡‘..¨š²Ëâì!²ßW¾©Õ6‘ËÂíYx¹e œÞÔ€õh<üô„Ö§zˆÀ»êC‹úï/G‡ª3¡×ú*m8B˜Cˆ;#ñwsvÕÃ&ÖÓvg¯G*{ë›~·ŽËXžÚÛÉ½ªðM–EEî¹Âpg)Âi{$×§î’hŒ.¿ï+hc%¢gqR³›(t˜Ž‚­ÍVÞâ­ƒ9¯*6}K‘¯¼Ž+þžÝi¹±95ó|Å'–ìoíõÙÞÝÒ*Ïß¼T^µµ³~öImÓhXÄÕÖÖÊ`JêÊ¦è£y¨ºpïCþÝÍÛ	Úä÷^ìŠgÎšG0-€#µBÚ¦ãˆN&çLÒB?£­Õž,.ÈX((¨D…"Ðs§ïÒa‡Í	sz‚:Ð²g62d¾…h„ö¾[ ÐŽ!€+ÉÇŠ‰¸~ú>Ø“8”õ7Kº5\%Î¥^ãMW*ËYèÉFyH‡	7ƒÃÁµó;#ÖGù1Pü.&¸ÈÈó(S(f­Ò fÏB¨iÛH²˜¶{¯.ýR"{ŸU€eç@f2²ß¼m{Ý.îtÄ„Ëž”ìïYŠ -ˆ©f³‘:×Ú:{sç™_Ø6!û€¦´ûó_L+7›²œtx˜‚n©ìf‹)Í>$÷k¶ê©«Äié	ƒe¶°ÏìÙèÖ_³ï:©–´ÜÜû ©¶ú“O-ý­æŠþÒGôÆùÔ-ÅÂe6‚\âÇžxŸŠdFìôÍøÌÆNæ8ÞôÝiLþÆôv²¹‡kp¢Ï»»ð#4œÖ³£+ØN_Š½ô®Ó°2åKÐgƒ÷› 3/Hípé9fYœlíkè›ÃG6½€êýƒ³m|y÷ËEº×ØIÑ]Ðñ.œC»Q‚É¹'B¶¨üaPþ¾^þýzùËÃòÁ‡jéáúÍ½J‚ ÅÂ¹OT¥SœÄŸÑêÓþ;t³TÄ#¼O£ý`¡¯TÍÚQEE>ž^¦*¬ØJS¹ßôîg
sø¬ Ï.â
ŒOYJ¿AÀáøåa,ÍÊ·–ƒüóó’\AvZÆýðOÿæ·‰®ˆƒÕŸ»NjžÎ5žIž
 eúqtEa~=9fÃ¿§rQkâ><DM8Ó”’·o‚„ÛàÔ‹¢Š_€`Tûäµ·/¸µk0N”vCæ¹árReª„)9Øûü€‘“¬Ä…6$F!¯Õgä®nôDªÄ;*¬/f%n³—ZG£eýËðÏ¶f¬)yÛ€|Ø£#ÏVð¹kY).û¾X¼š~o<»‰ˆž'N'¼9*fº«)k%?KüØ‘Ï§ãT†í–É+÷•¬!>;kš€Ñ ];\mþùÈÑ«²ºËùOËdjå{‘•OñOdm¹E ã“£-Ù|qG=Ì×Êå·Ã7eóÿ‡†$gë³›Ýi„#ÏYtö+)¹6.ÇqE¡Q‘ ÀíoÜ”õßUçïõƒ›oó–{b,þCF‚Ê~ªäœ‡Z~¹¢Ü¹É¨§wu´€îä<	KŽ®'¼límoÛ†8òFqÞ,oSØå†g„rfÎëŒó×J2ßê4özN—úªvë5TŽ`«ÙÏßdºâ‹GVö õÓ¿Vá;ô²g»6ëýÆsÖlë|ç€çÜd9V¬?–£Ì_QÂåÝå4¾?LØ
©¸ù¥§]ÉM:pž©ö3„(¿
~?Írä¯XÆ>ç-˜[Ì™Ø%½H½~>ªgúKû˜5Å)‹]ŽÖf$Ê+`^ˆkq€ºú”5W[QÖZž²*s<2qö)±žRF¸ªº¡FmÕPeÿí¤tP)
s{7óô‘mÛˆ|jy+Ü¿9B“Éõƒ/ƒÜ^¬\³^•^¶
¾¡ÖÄyÈ«!ògÎ>n>íÞíØº™Ýø¢’šmÖ›é	kP®fÇ‰@HPÉß+å…ÔÈ#è/GPÉ|×hªè„@ãÖ7”¡ø²…¡¯†	ßôÑž£ÕÌ¡&¤Ñ ·Ÿ@óK¤»ÂÀÛHI›™]U\²Ÿq»å’¯»ÐÍSóû<\_yq¨ØÓš# {uòBˆ7Aª-•‚íMßJ¡4+6²'Ê*1rY¾®]ò.ìnüó‡Ÿ\^ÍÏ
z
D’äLiWv­&Ö§æ#û€š¾òeŒãÛìï®Ó„_ë	?×½§~¹ÜûšñR³C2æÓD|YŸ>E“áá¼“û”|œé¼}àÃyÎýªŸÔ¢XûÁG•hoÎå…?Ë¦÷ ðç èß…óAl¯G‹³‚ŽXcQÁ{ÇÀc	jƒÁGÉÑ4«Àø•üUã¸
–¯ã¥ç×zúÇØyîžfÿqœ›-ß‡ØH-:Ï&¿‘KôüS×ˆÖ3ÿþÝŠw˜èÀwlÏó/sAðµÌÉ\U¥§óe3xDª<ÒR>Ëì‘–Ê6þhqôÃ?ÿk”; &‘ÑsB×Á0‘&’øóHÀôe9×h‘Ž9‚XàÐiB&åt|¹¸¶“mÜ„%^K3ÿ™¸ª•“YÒ9/'ÙÒ‰sT3„˜=6Œ&¿'ÿòd=' ÈêÏÏ¹gOÍo"wàÜ·ñjÍúñæùDö­aÙq,]³OkøÉÇå—HëÑUEÔÿ¶É>¶ƒOØBF$ÉÑ8OOAüá£(ñ/ù’jµÌ±»°±%Úêtµ•(ðIC¡—}ï¶;Îÿ7º8ÿþžŒ.¹	;¿íY9âcôóO”þ‚êêVXÿÊ*ëO«´†îBå\þÿóê­·k®Ÿ¢»®`˜Ëy£vAÎËpÁÂ·1ÍÕlS;-çE8vÍ…›]*O„ë~‚>öÓkd9I ¿3=È‹¿3É ±Ýªï´wžýÙ ïÒÏ"ú‹ñìû/ÿüNR¼/[MŽ.ä¬S…ÑD¦Ä)±h|¦TÏ3sa-Õl‹ç>åÒéúÄ7”"wIÅà‡T„\mlM§Cd«£6NôŸDþ|C¿)Šw€üpã‡è±óþ  ÿÿì½ûZ×–/ú?OQÖÎŠ¤•’¸Ç!q¼1ÈÀn.Ig;4R!ª‘T´J2&^œ¯ßáì'9ß·_ ¥ŸäŒßóZIØÎZY½—»W€ªYó>Ç×ßxTtŸù~mÎûõ²÷®¯òóÊ7ËÞÜÎìì™_À'ê	 ƒ5¼)ó‡ÏMm™÷š ¦æ&^™~Zë%»zGƒ=ÆÑ|æ|-Q„AÒ{¯ÑÿJøô}4Ct¿IòSùÇ\ût¶‰Æ1‡Íä£àIïœÚËŒS£¶ÎyÖTæ1æ0èÚ7÷òž—·Pj|Áœ¢üš^Ýõež«o[’…IµåÜ÷«šDçü…d4ôë>’äK¨»P²ºR…VïWõFçWCeªDu—D~¼Ï9µ>¥73†ãdË$š¦·ØŒÊ8V®•‹káßï‡Èg®ø`vðyÐP'®/@ó¼ú6|Õy+Ø8ÀèÄ_«tõ×¾ø Š°û‚ñW{½§só¾Ë½Mì¾(PŠó7[Ç»ƒãú	×Ûp9Ù{ýêUg‡®­½#í(4öà|çsÎe
î™dr©ŠÀ7Qù¥¢h}Ö‘x›#"§Ôß3`ç[VÞðÈU”¶×gšžãZõçê^Å—Â3œ¥l<Î¿ß×Ø{\ßÎ÷çN•Ä m|C{b¾œñûYíåjµ‚ƒ¤?Š?ô\.ÜÀ¹q¹¥Â}/,‡{7‹GŽg¿DC0—´¾ñ·PàË²ï|n=s3¬ Gâ‹Kê/[û{å·Õ0z3Ë;sáé’}¬Ó¼­úˆ Ù»+þ‹lÚE`éq±õ¨×Û‰/¦}šåÆù[,¾t…ßT²®S +Þ0ZJ/(N&Þö‘ŸS}$šç!ƒª"ª÷HÀÌv{Î1|h7d…7óë5»‘,a754xÑ"ivÁ1àëívÝuæ¼½bÜw=Ñß¹+F·ð#5Ñþu«Jõ•Kn<x†è6‚ÿr4œŒ°|oo¿áßØH>ØímšPh½Ý[žv…<µ6 ý7N;Fþfe[­ÏØ­õöFëreW-¤¸É¥¹(¬d!‡¨štÿ¹_ý†.q/ô?ÌÑAMÛ7°êÜ=j˜½eÆæ­A`üo!YûžÄurs|%¨’ûë¿§E”¥8ìõj–Z	QÕljÅsh«Þ×` xºúÍÅ¨<Ê'ãˆ¡HŠ=œw-è†r×ösE¸@äW¥î\‰bSÅˆ‚¼ý¼L"éQOûõ‹êl—èn@h<]™kßî ¾sjÎÖÁ«0p`{
yÁBIFs ½£›êÍƒ<;pMÑ(»\/"S€¦2¤»ùNŽcƒ²v!ƒ¥3º4‹c[lŠðò4á²Í¼ø\âßu|wÀª¨’­wà#¾¨Ú‡~¥4[ûHTšlÓWµfø7]Øûà6ôÐ™â{oWRz-47´Õ±Ï9_gÌÐÉþ¾)yTÜ˜fKNø]#¶Pƒr)´§\ÿ^¼~…ÓŒ:¬ÇqÔ¯œ¿Áç-Æ›±Ï½³µux¸õKe•/ž¸fÌluñ3-ÿ:´òººµäŸzÌ}½{pÜyÕ9Ìï­]$.âÉm‚Öoš¯6‚Æ
¼<5åW«ðRùê1=3`µïbQÉé#Z\¢•/±c2rQ%ËTý³`«ˆû7¹u!”óu!Ð©9k{Ê¿a’?r'û/0°…÷•ª(z¿`E³ê™ÝŠÂÐ'Îîm—A½zjeF
]mÕ«ŠUÝp;À˜Ã!òk‚Vã7¡¡Jqa€‡ñÀAÉãO\¢…'%´Ýã_>¾òžJ2áò?G{p‘‹tÖa_è Ï;ä‹ð·ä¡­ ŒñÚ˜·5‰0<3Ü
fV=S”‹þ;·ÔéÌÝø‘Ü@¤ƒÞO•užž¼VÈœßb·Qå¤¼>ÄXªC–«š}êGñíâíoë,Îêì>‚£ø~Š1!åÝìftr÷:bHEfEG*‹4åä$	ŽÜ<›Áã§nâ6¶¾VÚôÜËøÓ¬Í .Õw±CHdcª=å’½ZUÔ­´í’‡e]q;ÁÂB±‘|M³å½f
âõ­¡©X¦BD{\"-¡BQ;¼¡µ„XQ*‰I­F>ôtš®fÁÕ<,¢N9Ô‚J²Øƒ®Öª'žk.	•+÷A÷
:óvð¶wÏhãöî°Ëûˆ6¾H‘1è.xkÕ-ÝÌi{Žz¦TASèd0Hx¥M^K3é(×P¯"Š36d*ø";%ml¬¨7–ÏÏÏÏ7¡rh>_î'´·kMÝSnF¹LÆÙü*{mëÚÛì'øú²QûP«øÅïðtW{_ü–#­m“0öå—NueÏ¾wúYæLâN‹R6¿ˆÀpíáiÃ¼/t(öŒ*‹™ÿšQGiÈ5
š®ÓE5ôÅó6C¹6–­Þ¢¶¹Üoj×ÙÜù&X›ÊXº¾•²©•~+àŒ[¬ÿ¾4ä×/b=‰.æ{]ä<‰ržuÎÛŠ`ã pÙ¶gøp»íÛ¬ß¸yUÙ2þ¹3üÌ‹>l™“þ•_Mï””/Sº¿’6Š×ãIûWŒ ,‹I[µÂ§æ¼¡ÐººôV–ÅC¤àÂYX¤ü)‡;«VN\’l‡!ùþy3>AÙØ…™,ÄPz^î6³&x5œ¹¯DXÙO¬$~Ï¿}b-œI²p‘Ï£S|'¹4åÙ³Õ‚ÚV›pè¥c[€znÖ]¶Ò“f?pŠÄ³BŠ[8 eQ+ø‡Ýøóøf'‚uØmi}ñAå~3è¨QÂeËð=³Äð
ú)l¨ÎôÜmÌ®¹Á„¢w_nrþ6dìLy:ŒuÅí`×Ìq±u'…¤æÏ1ÙF]nš­w=öº YBf†[ƒžTëvÛI’«aÊ–<È{$iœ®¾ìpŽM•pa@ÈâqÜ€·ðù ]˜6—»y`…X hÔôñ­£¤âÈñiÙýV¾›ùm(ðêÅ8JLN”pþÞéXaùÒ[¿Ï.óZ¶¹ª÷­{©.9=þ+Á[zÌ¡ÆA±§É7¿j(Î]IïeÀ=}{CfRËŽmšWÙfíœ¥þ*ÊöI<Ö Œ³.Ê!µ»Qðñœ-E/j\äÃé‰è;àY0 ×(ÏdWó~dµ}lqË—Í@€õyØ²òUÁ"NýèfA’µvJ,P‘7yù½—¶jïqU¹æ|&ÍrØ³æÆ
‚KO¡š=äÁaR†jþó‘çŒ¦\{ð¦Œìà9;)—Ê:†íD‚¹Lá*_óLÅVöÔúoü‰«¤¡ê*¹oLÝÎg\M±hñ[=sÀg!þÐ™'ï‰S¼LúÔ˜‰›ØççoýŠJBGîÔRÅx»ø\­‚û<{WXQFÅá•¼Ý”‡¥Ñ¶«jsp?\d]p:ùwêÇ£$;ˆäÜ¼DzÔ•BDe¥˜¡Ü§C‰yt¾Th¡\A•¬¡¾ŽUÄ¤;ÁmIé
ýÅrÁ4¤Ðß)sj##MÜ;ÐÐz#	=l¨Fÿ¬®¬4ƒeüÈÁŠù3ú‰‹Ù,{ùÌï`ÕXl’³òm—¶ù ¶ªfÀ9ªÞ*‰Ž·üÐâ_™4Y"5Î‘+)Úœ+çÈ]è9ô3k.ÿGJkYàÞ)Á¥žÙt,vPY×(™žÙ‡òOžL@fV\…Ÿ^9üY”ùdlËìrÊglUüyu|Où[z~_“œg•áO½ô.Û²i»íe¸ð¶†û¦¸n^ÝeóèðØ÷EWa¯aj7­lí>±_-Oùôå<8½b7É6Rùnoµ¡¤.ÎlõP›ÅÏµ¶[‡ê‰èÓ !Pçà+\êW¿ož÷N‚ƒ0@^âlrÌêÐ:+¾I³I‹W9¿N_|ÈéÌœ‘g]ŸÕoµ~ÈÝé¤¡²ú=Ó[ ª"çŒîÝçooìíí¿~9IéêRG·ØËRËŽ¶¹¬!ov$}úˆ½Î=r^äŠQç$/}ö¼‡ÆÚðüy°rßœg+()ÎÎPÕËtL+_‚Ï2ÍÎ[õ8;CÂìXZrV"+a°F÷·0ÏcÃ9{$íü‹cËÝq áýÇÿ¦5üüÊÅµÝ}È÷å3¼òok*3n;¿:Iæm	S.K®„oMóÆõÌÖqu¿ŽüÀÇ…v~Çˆ¹˜”€§	çÏ›$í*ÏùÁCä‰»…½rzƒ=‹‰cß^;Éó|{--WSýá¡Ý~%ƒ˜!ŠY'T2=|nt£ð²Û-ó›bÆÈÄS‰»ál:¶*™€ÛsDì,ºŒÕ²à@>›#m7‹AÔ8c?ºÙätæãÞw:Ašüü°À‡°Ñí´
ÍØ®w?
ÖË‡û¦‰©ðá”ÞmvÖ U5R¼½ƒw§t(u_h¹OK„RLá»çJœTãôØw±ÑgÖŒ¤¹=ìe:¢¯Ð‘ê·t¤+mÄ#:ÎWbZÞ/~œùZxÕ7ß^¤î—Qóàõb—Œs;º#K÷ø©ß5j¶»£YGâ
vz?º²ž2šg?ú½îþcÍÈ¢:g37yÏlöHžUÄúýª	Ñ8º±±^ñRG'ŒÝÜ²[6ƒ†Ú ö…Þ­›"_ù—rs]ò]æÈ²M>žñÊ%ÊªâÒ}wž<ŠßÑwCÝýà`·déâW½þûžð.£*h^IÌTLsZ¦æÀ'òêÅº²Bš®«xïÃN ñƒ”ËŸÉã¡^
VÂÍK¯v ú†°\D>Ì·8ôªK¨XÒ¹ƒJªÉ_AÎ]w¨V­ª©âª:M_–4URè™Û2³ÊþUãG±M%z—à‡Šô>±p¶ï<:QÍÁ¹õ«Õ=ò’n^v÷ÇKÆ‡Aì"PÜÇ¢G9ýÚó’›…»¥”}N¡Ûd¥ÞVÂá—øñ’w‘!–‹AUqL+oÌCðîEª“d?ÓQ'MÇEÚßÚZåõ|žÊ©ÆÔ31 6sCõªâúYÎ‰ÜªµÚCu[vRª•[›²’³u\Å³Qaù\qË8³øÇW[-$MòŸ•ƒ_{JŽ ¿ØCw+‚”7ž\ûv“¤ëq%­ùƒ„ØJbFõüz‘ÏæIâ•ªrü»/»â?–¬à$ÙR_|°Kvÿ×bÄ‹ú•V :‚aÜ»$ätóüaL¹Øå<GÓ+—&©ª5‚Š,±1žÆ³›+êGÉ¨ýßa!–üŸÎ)dÏee¸ò|½ÑßèÐ¹„[yÏ8¶Û¢SX—²~úÉ#WÍ@¯uQÕSþÂ{ÒÎ&@*×Å\¶CÚ£§K{Žx=Úy½$êR¦|]7Y†D_0§¡”“M{‰œy—NÇ^T¦Õk¿Ø!@SeYÏxÎ*ÖãàfÎ7r=øíõ£›Lœ±6=IÃc®>ŠâY!ù§<]¦!ÝÔâ©¿íÐM:=Ù‘yK²ÅQmÇ™ÔnwJ,Á]é”ÆPs×©×$Òej\¡´BÎñ‹yRŽÿŠeœü„ð”¿¢¯¨ß)áTí<…z§¢gf•¿Ó3ÿ•$ô»v–Œ&ñ˜##Öˆ!ÔçÅWew $6§Ð¯^’u§¬øÎJ‡]þ“?AŒÐ»¸þ©„x3ðˆ]]È[¾ÚEè³bLtÎï­¹ZDñô(Ì,ª¡ÉAÅ™­V{åÏÐÌY¶«š’Ý6{ýß³›ò\ýï!g•¯Æ_MÎú
Tz	0ý®Ëu:ö9™¹Àw„ßŸëT{]cíd#76`,–uÔQ›5k’T$á!BµtgR¡à+)oÄé1÷—~ãœ”ô/º¹ißñhÔ–iú–eäËBZn4q„ä¦œÉ¬Ef,kÂÍ}0ª.Íœ„šw	½œ¡váˆÏPã… ª±:ï˜tš9:Õ@ÓÝàj’—LÒ~Â‘5º_55~Óc—d¬Pª'y%õØB(™CI=hÎØ:ì¨g™jöÙ¶ˆfŽš›¡«¢¨t#={¡Q>:w®êâqŒô¸ ô]G—²”Žîxó×69OºIÚTp»ðF(˜)h9aÁ	ÿB§m+ƒ"6MêÈ{ŸÈIÌÑÌµRC¬FM!sT mJD&SB†»'ž{ÑAFë:¶}s‰‰#ÌÝh“±’±-`JõÁý‚ò¬Xö6tÁÙuß/.‹Å¯¤xwè¿ª(npüâæqñX.iÄ:C¼ÿ^¾1ïøã£]ú.øä„ÙäAc8LË{tòð“þ×DtIýä¯úË½½æÒ’øHZ˜ L/cWSƒîa~®Ó¶Ô¥ƒT(d3ºp)E Î”Op¾–$”¼êBµ¶Ú+­ÐyŠ½ÈVóW~}þç­þFƒÿ)›x	žïyÒ£~`a© NUŒ'(·vRÝ>U ©ÀºÉÑA¯n¦c ðÐ‡J[FK$èSz
aÕS$´Î˜ã‚kžÏŒ£ú@¢²Mî÷*zÓ›váD„>¨jù[[÷8î#›k‹+‚5Û±`p/¹{TfÀÁ[¼0Ã$ãHÛX0²Ê †Ÿ"£J—äØo.ÁL ¢ãé@ú­óuŸQ—Ïœi“1µ‚ÚImÍu‹Ãü‡b<£ãÐ©:æqË|w%ñGª ò¦¶w½©˜t»I«´å¼ë2	äÒKß·hLŒß$ïO©KV ’•›ùó‘Z‰N%™Ýˆ¨>GhL7ŽûÑ(ùMÁ=ŒmÝ÷‚†N…oý°µ¼µ½]çCïE¶m_¡Sqp”v“˜È]‰Û˜™”–øA§CŸ\Q/§|µ¾‹út^9ß9DŽÌN–é}/¹dŠ4I°ß4bP]Î"GÐeÓ‹TƒêâÈ¦´=I|5M²+:'Û)É5”yušú­_7}F7Ú‰&˜ëŸÊâª—`V.ÀáN2/m:§m÷¯xí@Ž‰ÕâDì±­¡òkMû}}^ôä 7U9_YéÎo0§$÷Nho‚P]9Ërg,¿ØßmÚ¾tf.¸¹"«Â{ Kú#n™fˆx®tÂ“= ù‹i3ß-:“»àT.izÙ¦Èý7[ò†Vö6ºË4bHÉîß•7ºÿðËËXôTËkÇ ÄäÜ½·h*·²$5Á&éX’œ93Ô2ÄÌôN¡–!(Ô€½íX€¤Ý“/wŽöfý™ÆMb¥íË…JålÔ—ßA˜Á|éu¿„ úí¬Ðç¤éuMJO6¢þö&½™Ô¶‘Þ©s¿‹G|ÐgŒ*¨;l+r¢G:@ÿ:`&KK 1ª2zc9´eíç+êmÆZêGÝCQ«ó
ôpð´ŸR¨bX/¤H Ü²åz‘Ò-T'f¸ÎkUFïëâQ;ÀÔG$Ùë¡YÐNft!ÁtIÐtò‡É¤éÌ>-’Ä]ªãé5pçLW¨®ZUVº$7–ÓÌ ‘ÝÒŒÜ˜ŒxÅ×³zÖ¶|R„vEq¡®”#³é‹<ÖÅmóË^þh{Ü$ïÞ•úÿañ—6ñØ)Mòñ8éîº´9z¸XL»Ž)O4/#Qä¾L»D¼àÎ8€4h6±G•n# ÀSÛ$¶kd¢&'G|_gšû³d'^ˆÐ^Å ˜@d–»³Ìw<’®ö½ @Æ8U­û ‚¢uv+ú/ÄáÎ¯‰cxRCZòGú£#IS¤ñ ²`£ýu(ãcWÌE,Ó¼'4ù;¢OÓA¯¦ÌÚ¯·WT¡v@¤LwžG,õ™"Ž:
ÖÖVœúèùêÚF‹=·-=–ü‹²ùxVh_%ñ€§ÀÆ­(LW1Dv ÓLANœ:)Ü•:·£kÈx#:˜¢›aÆ™€¦—îßb»PyV†®"Å"»Lo˜G‡vM†ªq7¼õUëüš.í–ºµõL</dÏjät£«¶–GàeGÚ«®XÇÎ¦m–^ŠÝÃXêò7U0¸Ë]×è‘Æ¶Lì]¬îaê˜½œÔ¶R´¹õ§Î‘×Ô"½^FD&£i«— ÕÕ¹Æ±ÚÐu¸®®/}ÛskrýÕU{ÂuñHU–ÚÅ#‚ë	é¹iåúÜn1œ}ÿR¦K—÷ ¬&jbw‹Í¶·½ûƒôL˜ºçŒ›•{qåô¦¼Ÿ©Ér•¡Jé¥îÙüE÷@ÿ©ß‘­	[‚dæ=m6Tûl$gNRóp Xtó”ÃA/ÊÕE´Ú=Y8£ÿ™Ñ3laš—dtF/ëMo^…h8}3S¶£Ÿ˜-JS|KßÒÑÝ¸v$.#'ÞTr$ldÜCF¶ºÜV·c\ñ[\‰A$"Q >ñíÕ_WÇò¨u¯ë€“˜ßqQàVöEÞžJËÛô6·Í¼Å(uûB³¯E04Ms«ÔúJÆ´…ã€½¸«–Ppë71,¬ÉÁmzIPÎ$‹¶Ÿ(ƒk¡Cf‚š­t­ì²û7Ä‡^6S Sã ®”qJ¯rì‘K_hÅ
ÜC½YSkœeþœo(;ã—[ŠtrA
â›ÑÖ¡U5ÇW±CÌó·<Î†B†ÀÁ&v]ƒ &r|zhˆ†bçX.b	þAÙ3zÚ ,“ÜÂz\èUÎ¢JÞÔN²ØÄÏƒÊÚº[ZY„~	S²,
”;E2o\ es¡9NM]žËIT,C›Ì2ÜFWÑD“r+÷¤U³ÞjÉ2]Í1ì—Éä0É®ó€ÏêÕ2²ÐZùÜ²™!Ø5ÄÔþ$eÏ yËL>T)Ô¹¦æ©ää“NçÖVohRIµå”‰&¡"ÇÜùä–3e‹&é1åcâÿ6OýOÑ·§²Œ¼±ÖK[ÂÁöØz•Æ¤@ ôY®T¡ÒÏú}MíÅGKí9â„›¶É¥Äª ¹)æß™ìkMöÒ[ˆœÏ˜Ýº#Xw¬4+¿žãÿ fÇ­âóaÁ¡²ºDâÍ'¨%ePC5S~-œE©G=qÁjçô§Ÿœ–ÅMÃÉföË’ÍøŽ9ºN™GfæÚ0Y6´qh~žŒÊ¬Š]¿ì¸þº˜ý¢*ËÅ½†¾4˜Dðþà±ÚÏqÚrß.÷‹Ž\:©z4žÀ³ü™ÛN	x%¬Z¦° LZkºÙ‹oÝ×¢*ât5Ø'qfêÓoé¯ï¼¦0`|õ•ëKÁéøl±·É©xºQ‡¤)7÷Š«(ûâ^Ñj}ëU¯z\ÌGìÏ¸ÛYšäN4sAW2XyÞnã8º®rê»7+KiÑÙ\=û®Ä½N:£­×ÚrÍ:ãq.J6g¾æƒþ†]*Ùp2‘7Ã–­k3ËÕsHDÄÐ‹Û(Ã7voš¯H(Ko!ÉHkÈfßÜ‰­][‘HOãÄbÜ¼6}ì8™>³%í<µ5½ý©«dfIvö‘[*Oþ›%«S,Å³o«ï‡ÓÍê®ÜÆèu<(ÚàQÝo…•B$‰3û”àëðÀö{ÛñVp<+fùU¼â´e¦SÄ±›íQÛ½ÂÞî3å#e!Œ“Ùrï	¥‹hE"ïÎpž°§V»Q§	'ú94ÉèÂB„k¨ØÎA?™ÑËûOW}ö‰Ò¹¹Ÿ†Æì4ç}+_‰!üžùß?oóãç>,¦\3‡¬¡>5í^%·ÑU{LÿgOÛÝtÈ±n™¹%þ-½ýOó²©Žž|‘x1å[•ˆà”µªý™ØXì€ý†º‰u˜•<–x„Ë”ó?rûeµ—•|ç#úOèÖ¦í7¼Ùdr¶C|eƒnÔt÷èµBò¼2{ÔÖÝÊ­yÌj’BŠ A“Õðë••ÿúÿw5|JÒjæøntêÉÚ7\ŽJõ‰æãiwBlrÒ!Ý|î+Æ`à”‘µúìÉFÐÏ{:y$©˜ˆA«¨½ãNWé÷vöòµOG¹×ÑÆãbé0îGëT`­ë…^¦OLÇäSîÆ€nW»ùÆ£^/î©Üžª×k+…Šeˆ´Å¦{ÅB0`\b]l•Û^h2•JSO[(²bÐõ ÎàÅ›@-	ç•z—eRÃz¸Á;àq¸Âuä]t£>‰]Rô±\+)F}íJ¡Õòz’1AO‹o~#)ß­_e1qiRíÆF0ì*¥iñÔm¬”¼¾¹J3úßNµ¯Ëzõ.¡“•Œv°E¸ß»'A£Ý K˜°Q˜ÖžJ,3ÉÏ¥ªâÅêï³Ç%ý¸L¢Âx¼RÖMUÃ6Ÿ±Ê>vx˜•¯ÄëµÕoqõ3
¼x‚*Ú_›˜\%(ÀÝ^+¾')ÝÎï˜L¬¶×‹%FIÔ•·OðÒyç%^Ò}¸;ŒF“âçLŠŽ8^½	¦ˆk…1DÜWp)ù_ÿñ¿ƒqšMßEêÁå³–sâ`æ™uii2kš]ì€èwp›kÎâ+”xØØ.¶V»Ê³ f“-Õ Ýfa_üà€H‰ÓÁ[o|:L¸a¬;9[ÍMMzÄÊ(ÃòGÃ—QÓ…ÙÚIál!£UÆÑÿˆzú07ù-¸	ÔÆ«æduÌ–hªhä­m³3C0ô]‚VÏVýPí¨ÇÎžö|E íùP¥bÖïÇz‰Ÿ0O•µ½´KlMÍ{™ËëQ9ÿkUóü½)k¶d#(uÈ/´ÑÓÑä*“]s)†I8˜ôbt©”ãT?g	~ÁäGïâ1øH×RËîœöË Úƒr/å‡ñ¥³ùŠÞ%Ð€Žx÷ëäw›mLÂÇÍõzÕ\w2€"Ák‡½™FpÇùQÎÙ¾ödüêå¡s¿q˜ÂœÞ1G—?†… âhLä$ã6ðZGZOè« l‹ªØp4¿ïªdcrc¶Gé¨5Šûé$AôàpÎWÍ9‚{‚Ÿäv:þñ sÈ {«;ozÝK3âtKù‹3DÊ[È’áMÖqÓj§¨îYmª}‚mµò4b?2¢fÝé Ça:¡šaí˜1Å0KO‡ýIÞ¨$"Pß$öVÒ;ÛåHÆ rž&hÿŠ.9žw  [yLÂY@D;JÍ™ÿC8(7,É¡²—i%4‹ûG/ºÃ¾Et…ø|±À
±0VŽ0ÖybödÊ~6f¹ùvþòâ}X¸y!ŠâÝ*qp›ŠÀ)]Üêv§C8RÅÁú
RúMA›ÓËà‚­·Ñ ç>`ßPRÙsT‡˜™5I²9l:Ám_×ÂÂÛÄög-×Ÿ^/X ¸ì&³M_|GˆzŸÅ¢@àóÇ‰ßÝ®ì`Öüºß¼&oÁ‘Ù*$FÁ.ºŽK¶Ë'¶þØo}Þ Äâa5˜ÇRR±R$)æug’7ÙÝ` 
{5Í®›Þz¬´°Õ§¥ý©ÚCØÈt$+ó4:µì„½í“!XÎ>r|ýÐ9u¸¤ív¹¬p(L,­ §ÑTO{ÈC”þÑDùàä˜ÒøýUr‘LT”@Å"Û,‘9|AŸƒËCt§P”w|W#&É0ÁxpÖÇf8Q¬®€‰&~Xùºžˆ’¹êªa¢ßDBHx8USÄ~ñå%ÔEBW1ãÕdr“m./ßL/ˆh·GÝ‹¤=Û£äªÝOß-¯¯­<^]{º±ü ‚¬íHí,°¹w/Ðó­nÒŽb6´+Õã~Ü½B‚ÐY‹f iè€À]´PèñPV
£é“±ºÒgS¢·«™pwI¤¼µ/ˆñˆïØÄãírÔSffõ‚½fïˆñ‹ÒÌnâÆ›…v@Ä_ÝdÜåe‚ŸKD—§5êCíMµà;~lü	»fuåO¼AhŸ2U›¿P···ÅUºv—uíËoö·?]_[ÝXÍ/ZÕ‰”ëGê%]?]Ú¨y…Õñi˜5è‰k’IøÊžåiFMñLÒá0Žøˆ(“+fÍòÌ>—NS!êIN’¬;ê+ôÅb±€³¦úèª fFBÆ^&¡`ûÇü<b «+Ø’ÆåÀùê¨Ð=N›‘XÞô¦­yÞËéHÎão¥]ËhÜëwÁ“•Po>‚ ¤>ÿÔVér‰Zª9É1Sð".Nôum…µÂT_D´ñêg<ñ•âÛt˜º$3Ê-¢dâ[ª@%OäMÉ¤ù=qÜ7Wcã{.n×`>ò¢s°{ ¼6Ôm•ŽE"¥q¯j§ †rÏØkÁ‘˜’‘ç#ª± ¯‹êvŒ$…Ñ$ÐžÂÿVvˆ×ð,—Ù…‡£¯‰~q*C»pˆ&ðg\,¼n‡„ÃrÇ¢<Ð °J\b~KG™Ât‰—J%NÎ7GÜ
K¥$Š·ƒÔ£>‹ˆ¹žuÁð}³HoÉæÉ6u)Í_1|üFG,CCd	žž±DÃ19k{º¥üo6ôÕ5-ÀPK÷ºXb¶]Ú·G7	€_R[ü¤á‰©B )QÅ¡ñß½ýãÙ_jö…ÊQûåõÉáY­éÚØþHÚù¥2O;ÿå¾©RD‹&Ež”¨¡K5ñk…rEµûJ¹^ÛQ»£ÄZ»¨™/(Þ¹s«_++Ñ·¯ëóõí¨k½ÄäàëÛŸ¢Åâ0ºõ2ÍqA…>WuþßYiþø_]'ÎÒGœ÷ðF|‚>Ç}Z!ð³>E	Jì!¬Z¹=‰#*(6©¥VôxIÖWHä1!ñ¨—ýÎÚohÄè> ±ÕKI<k_A,¢›KE²f]ÜŸp%­<yá'‹S}bBÇ}¾N•JvtvŒU&~Qx)§_7çïKÑ½Í±:<¢çÆp¬‰£x †&ÿ‰ÚóÔQétžY¶–LWfT¬ÄO´Hƒ#EqÃ6àâ‚b1³*ƒß%óV¢¤òù?ýT‰*ð3«¦~Ž×¢†ßH;ÙQP‰ÐHGð"M9Ý‹¯/ýDµLN'å¨(=’¢tÁÝtÐk±dƒbu’‹táójbv$8B=¤dìÒ}33{†cÝõÚ53äù->²­KÔã…ÓcK@ÉèZ4qñèŠ3R#8l<iÑæ$"I“CíDP&ôaÔº£ç§ï h„YgÀQRÓ‘ÚïÁ…&·%ë_¨¸áÞtQoE¬Úê‹jRVž¬®}½¶öù…ò#QšZg’\^ŽLÈú ’iLn¬‹æòH!;rî%1. ?ÀÚ^‘04ae++…éÝÑ÷ˆãÉuöh©]:1Â–“ÅˆÑôk„çœœ±XÌTP1V°§Å'DÅöïDÒš)â¾³6'Î	ðJ…²H¢r¬t-"Ùæé‚9H-«›™-Ñ¦ÓÌYBm1¥&"¶š¨?G˜¢é¤GUà¹¢íTh’áþ8[fõåQ¦2¬S„HyEŒ/Ö0ÉnÌ]ö‡ÏàÈ%‰j’.|šd/rÞqðuLHª×Ó18ÉâFÑ‰ÎólSÙyi¿˜ÙÒAÂÔYN©bò˜Hnk)Àð}YéÓrMJ_Ã]ðŒ7J_#¬ü;!Œ¥ï’^Îw«Ùl¶ež*FÙœ^äÌ«|-ˆ²È½mj\"ˆï«(ë¿o#ïŒÄnª‡÷½ß{‹YmÞ•w?Q‘Wãtz@»Š5oO9GZµÊíc³Ë,8+îfÍŽ®¾½¹5¨ôZ)>ê<M&AjD•¦ŽÆáú's™µé×è¡ö^[×G?KX%µÎW•óðÌgÝyÞ~Kux þìŒNSoaSÓó6mÓþí§:ay¯üñÛúÉ¨«žÐÔ½ÊY'äƒ`q[Í¦ió-ÿRøŠŸº»pÅùdV“Î¯R‡ÙcŽ´’T‘Xè‘·ù¸k§Í äa}~Ö÷6Ñ<–¯´¶öÍ4ãÍä§?pQ›þ1Ê%%© …óë¼	nÉin7ÜÉïÃ c¬òLøû™¯–b¹rî¯éTþPQDŒe÷Ý!5Ü’†Ø/W'EWAEt)\ÙgÆwTHÿîÀ¦ÏƒseÊ{‰‹¯9âˆ£	dµ“Ë»†ùTò¸µVWšÍûsà—¤\¯@!‘˜	8„1.N·OæŒÚŽU“¿wÖÑ¾ªo•559JêDBýö$þÑ‰6àmÍûXìÉ,kÅÛxvì?À²æ–ÚµüSñOØboD«]%ôË†O!4T˜C8=¡âä¬e$1Ÿb` ¨ž@™¶¹&£­Ô#g—èGùEÒÏ×zZšÐ£ÎapØy¹{ÐÙïÓ¯ÿ|Ò9:ÞŽ5ò06H$×Aø\…T’d“2X‘Ë ±
Š[gÏs†cA/ã¸ô¢M„ˆÙ>™0—Z;Ød©ùP¾êÂ´©¢Íp~ò«jëAI³qxykN4	hF±N…'Ø7k xÅ‘Õ¥F0èºA©ªœNÖe—Ò.ï-Ã¸KkSˆÔÈ¦$„Ñ\º.›­=:áð‘Þ²?˜@¤À•_."%|±Ðp·¬m¢®“œ>RzüÌC$2Z5¥­†
®Å3–}K 4XŽÀºTb—ÈÁF¬®Èëµ–R”dþN~Â5ÔÍö•µíô²ÀÙ³ÚAþ0’àKÀ=öS#²PG$DâPõÕU“å¨¹raÍØCº{ôš-"˜Bi Vf©ùfMBP•|½§œD8v¡e#|7×š²¾öKiûÈœb®å£ª?Ö8‘ë‰o8™Ó’OæòÌ'sÊZÊBSãÈ¼Épì(s‹²+ÞìBÆ–2§œ1¨Ì¶«Ì)ãÊœ"°²Ì ²¶ÌkŒ.óæÁ˜^æÔ˜ÅŠ½X]›SPŒ1‹Õ¶½X±ÎbÅ~\¬ØÖ‚#}2o‹+«ÍœbÖx3§ ØpŠ…,óìÐ¼RK¾=2Óa4j]¦Ý© ]¹NÅ:—„ªû¥æ+N}Á¢–ôjlÉLþ}kjEÏ|½L& ”3w08´í„ù/m?>šßø=DÞIñPùZ´š¾¦õôÁ_Œ÷.~¥Û9ÿ‰Q/×JU÷5hîkÖF‚ZX‹ÏÕ•¹›Z=‘£ÿ¬yêüÏ1ÅZÕŽ²|[°æ_´ýÅåÀ^2%•f}Î<Ì’¯nŸ=&V¶£?i• rzyã8½l‹*0ß3¥HÂ×«­5ÎÎ@‹fsÁÍ4º
C‚&»¶€*»Ý®Pô¹£-ê¯óìë¯ÑÞN<QA»04ß	AóàÇHÆVjéž€cˆ‰Ê§¢šþ*]ûÜ•ZôìŠ5ËÊÈ[Š†QÎ|_Qí¼YøØzçMÄüz‹zaQkÌGgflÚˆ]Is!N ¢þý5>‚ü‘&¾¢«$ÓÖ7òÌýôSðÿ™€E£ŒÝÔµÏœª‹M±Æ´•!œBKÓ #q%J8i;‚¶.Ç‚g¦$µÄH.@Næ³SØ+¸@Žcmþ`Ðbô$ ÷M¦‰Ø2Ä©”ö¨›ÜÛÃ2=æ’rDeT_]®ˆ$[Ö–`íç6äfë]šôðŸ‘B‚!!µ …ki˜¸×&Óè•ÐéXü{ãÞ·®&qÔC(<]¬0ó³ÎERÚ#Ù ]Wìö|KkÃU¨0z™ÓBHº±X¶3µ|ììî:t…pÃèZaº¦ÀÄÚÁlëðt²H;^ÇW}2æÕ¤äö»MÓ±0°Î~ Ó!øÉä©Ep×ëÔòwóóÀâè'‹CÝÐ4±Ç.ï“÷›úÊ8ãƒ[óUçSR˜Ù$¢ÈŒb¦™…f»ÅËeÆ_Ú¯rhåËoÈTp›Ž½V—æ4â	€é<G£¹›÷SwmÙnSä»Uš4`^š&«V<ÍÇåc¹/ …ÌÉÃbZû<yXx²è÷@‚™Þú€3“²ð&•C,;ø…BåT<âå‚ÍjI;¶àh´_¿ø§Îö1¦ÜB+k)ïêZú™:‚¹O¹8?ôà8UŽÉ9§Y[ÛÑñáîÁ+Ï‘Æƒ¸ƒVTûO\yÔG0×Ñ	Ià#ÎŠ-hQ[ìÎ,AÑÄt¯°U2€–âøFÀ™Â€!èÔ!_z7ÓK¨5³ÌFÄ4Û¥o‘ªãÖááÖ/îin¿•S<k¢åŸ2HÝ0Öã‡âüæÝ€q-(-T8¾­íAú
jûD°±Añ»vŠÀï?@`;-V-\×ñ8ÂMÀŠã|çì€²}  ìM&š.¢°• íºC]<QpýÀO7àŽ|÷0¨DSÐð3ñLS®;¡34ûŒj„_Tªär^-A»–HazF³½¿s³SØ;ò¯t>.ÛGòoÖnò»ù#r·,´¥Tó<¬Ÿô³t{ù»¯oºœÆ¢ˆÒµ
/ša:u F¿YéöãwÁýÚø;â°{’P†°¾ÚVþ®×…#åŸRo×ªú<VÈ­ÜãÒe;¶ªdn|Y–éø8•úÃu—ÔN¥@‘ù[VƒGFÚîUJ24±êÓ‰ÎÌ@—î»„$ ³Q¹¾ôÇÑ£[ß%Yö"`F³—FÊ`ÔØ=˜„…ºÄžP/ÌŒ8ÈšWnuùw_ò´tÞ%B~‚okÎniq6þ4½1›ÕÍšâ‘m‰ö¥b¿ÿÎ›uÅ|ða«øäcÖÁh©Ì"”Mù<býFöxÈd³Åi\!8[¢ËYz@“¼l&åkš0 <±ï$& Ê¹‘ÆØq²—*ßd%qÁÕ]átÛY…ºÍz«®®pà‚øÈ„n9dÙ›0Ø«-Ë¡ßõ¦É6 aQõi4âhŽk#~Í|Jå˜¥c²£Â­›rÀ.™»M–§#+iŠ ™­«jê¦éµñ˜3Pš254þfñòþÎ-¡»\fÛ€9»ì½Žg¹ËrçÍÛ?ŽOžíÀ$½™õ×ä¤~ëÍ»ïŠ_x·Í¼s;c¡>†fÞÏà´Ó›`½õ$àˆ@cÚ¶iŒoÀÞY‘bà~ ;aF‰ŠŠg?òÌ
Â9C-+Ì“p…ë‚Æ¨ìÊc¯{l|T,d<æ4œa mû9g\1œ#Ô7£®  ™:PvˆQYË'ŠŒ×0”¤ OP;ÒiÿJŽk9×Oûõç8¾žÇ÷]ûWÝµQ¯§Ü÷—=áï¾K·ˆÒ³.ºAŠëír° Ð…r¸ÌDå`/”Õ zG—„æbìr…Ø …bÍwŠ·ÓDÃƒç
ªw™J]`»Ø Ó
ûQ™‹|àE¡.ð‰’]¤¬ë\d ÐØ/Ú7’uâ¹Ù…§}ñyT®Í‡þ.ð‰^ ¨(»Ð¼¨¨ÙÊJ í%žv‘I3Ñµ‹4¯BmÙwNØíÅmîâ…9wâ:4wñš·R¸óÂ?>¤ðÖƒfãÉbgÊÄù.PØú] ¸Ž žw¡zŸ9—©W™u—¯¶0ç­æ\ÙBë'ºŽX¨CÑ6üîø…yï3Óœi -_Ë;Á…ÆÓ-t»Bë½*­Pùa…Ž³Uh<ªBÏm*t|£BÏ*4^N¡ãÊ:þJ¡ã”:žG¡ë^:>D¡ç(o gÜ–‹1Æfkª²LQA_.u»Úe™æ¼¤¤ž–ò£xWÎˆ(æŠó¹£;nW”SçéÒ}%F¹pâ-üë#°Ê“ìhBrîPa“è;*‡<j"tœ´æº¼‡„ßÎâÉqD‚B£¶-¹Â[8A<'ñûÉ2›SZRmÍAßö¿ŒºWqË¸²Ð"¦­.žU‘ŽF;‰â×q|ÓŠ[+/«Be_‹=ÄUÇèøqo×fØ›N^_r*jÇÿó ¶;þ#,î“Ãâª#Ë€<s]kœˆ2ËÅÈ33žûøƒäÊÒ¾ƒåæûÞ¯Žÿ³¼!T ÙE¡9†È!9%]ð2c }‘Ðì:æt…M¶pí¦sI7zô³4¾‰#“ðV¢Ù<-¦¦	«P¦Ý’I£Þª›³‡ï¹ˆµžOØÂ%Þ®œº…›0÷£%ÑÛ†â”/xÎ‰@¨ÊµÓû–þ}Õù}åôþ¼¤¦\œáì†sŽÖ"îÙCö–ŽAå!<m£x£!ñ¦[5ì.Oã¢õm-ÿq$ín5;ÃëÊß*ŽñQq·sü`³äð‹BXj©(«÷ÉwÁF3'çV}ÁarT.:ŒE2‚ñ	ó‡&½¹÷ãé,0;šNËœÔ_†8ãS¾@ƒ¡RsÊ.å×¡8ÀÊµ ±ŠÜ Irù½=Öº[ñÃTr5(Óà¿\óÎy’¤“žˆ\äBEGòÆ¹Ï¾ü2h˜)ó£ö
…e¾é
+Ývs>nÒI¢#9J¯1pú‘KI¢B_ý§MÕR“½—*F³;Ú—à}¦ç)ÿ‰ÙâË×ð‰Ãs©°Y@Rì-ð•!]GÈ§ûr¥ü!7ŒúœÎÓ·eÕÊ=£þ`fâ
#:ÿu¤¦¦|ñáŠåý&ÿJ5Fÿ[šŒu{¡x•[^JB˜¥Ì"O›Ý¸°4ð¢48Zo÷—r<©V¯•çÊ+HÜåÔ®—öÎ®¦»cÛ¨¦çþKºñ	AÞ^=Ã˜‡žt…94ª8ÄOÛÇ{¿e£g|-i£øO%Ý[¥oÃÔœo˜3¸_B–¾Vs7£[»ÇØÎƒ†FEï„mÚ¯î›ç†Û<n¦7m!Ä¼j‹7Pú¹ÛÒ’w Ôqë/u¹xˆ!¡µ¹?Ø`Ìâa˜uÂ Þ¤ž4KííO·3&Uí×=xÝÉF4;²opu„þNW=´û8´§>/|›kÔJ>À(ˆA0µÝïF$šwµ‡Þ3ÞÿÏ‹ÝŽ÷ºÁ{8w„üðº–«lZü‰|?TX§Ó¿cDQì˜ˆ"(#.¢X’}_(â&yÅ+‹–Põ±-Qý­“ÖÀ,8Ïì°Ì/8•þèòÇ3PÉ›ºûrO€ßpcÀÎ…ÂjjÛ5ŸC+k\ßêîÓþ ›|"Ýâ÷ç¶—æ,ÚEc§\wƒX
éÕew›‰sv+±HûÑ‡»g¬JcŽ<OpmYÏµ«`íxžq/òP<{…Ç~¨IºOi“ÖÅE8é.¿eP½dYCw”NÇÝØGäèÚ,}êõs¿m{H')fÛ|Rü·›Þ6ñöË£Jù­3?y@ŒÊr9a`±r¤V¨†åPÀû&ÒNÓýôpo(²üQØ¨÷âk÷uží÷º‚.Âé¶x^%Kà”ö #Ëü3Šùv9ÉÊÙi:[ÌžÂ’Šf)]Çæ¯#³Ô¶¥…6Ê{a¾Å¯øÈ¿ýâŠÞŸþ::_d©îD·ÂÞœ9¹³¬á,QúÞkÇ‘ã|½æ^ÝâÅi/^ïe3ì}~Wú·/÷¶^½êìËÁÉÁaçèõÞOôÇqg¯³ß9>ü%è¾><
ÙÞ;Ù¡W/_ïÛ{»»Û[{ÁÖÁÖÞ/G»GMÌUðÕnÌÄ%32ðKËAü:ª7o™è’Htr©ƒVEé»X›©ƒgeÔ_Fîøe’QÄß1»J.'Ê;xü+mú	øCëe;€$íÐq\©òðèZÒ¨òÃ¶	°öyØù“÷Ê*EÝÇdd®
-œQ5 çÇ·œ¡ÒrDFˆñ»% ,ó¤l^«y¤#žÛutÀíúsÔÎ$—÷€‡(Ž÷)»fÇ¡š{ èÊC}8â‚ö„AR©/õSúálðŸ’OæÃ•|€ WÀk?êóóÒÎ½`¨>‰1ÊÆ0~œJ øeûüã‘m´ÅåSm‚¥¥¬M~Í$Â­Ÿ¶v÷¶^ìu‚ƒ“ãÃ] ÖüØùåÒâÒ6|ª´i‰.Jm€ÿGè9w„žçF¨Ý2Bës‡ŠÐñ–}WˆÐñs•ÃÒ–ñÿq{äÛCå“Z‡ƒP{„ì*²@hŒü¡²à‡Žy>4¶÷Ð1¬‡Êjnžm›ß:æ·Ío[öÛ'¡±1‡Ž9TÖaY†ÿÕ9|Ý:ììœìllÿìmýÌK°Úþüç#f/[Š3Ûµë¾ùç?v	5±×Š»6ˆ5®óªö½
µ›jÚMÆùF@756ÌëƒQ	«Ó9D°9nì&º¤Q¯½´ÆÝëŽ‰C~5H/¨ý=ª'C¿v$4ÙD?Œ“A›”Á%¸˜8`)3, ±loá#›qOûRsd3Áqx³"¬²DR*êË^Ú2^QÐ^Ðy‡YÆ…Ÿ+gß3M¸.úlÙÜépƒ)Î¥BÒ3ïù`ÆOÇ63ãšë¸g÷º½´Ž9!2Üé^ÑÐúÎ\ Ìð»1PŒ€ÐÐ:¾õøSv\‹é+Z©[K¬FVÃâJ4ŠÉõè*ôònpœ}ã2¢í¨ÕÞ]p=Jo³vð’ã ­4füÐ‘‹k+)Šúwsá„a	øÒcŒÍ	)†wž=Ž4RD&ò†ºIº×ƒ@E!`âÉ÷×Sv=T0®p/êt dô jµ…†o¾êo;Û»G»tLA@¶‚‘Ö™J›Êë¯Ï1gXŸwtó×óœ×÷ÛÓ¶ãÆùë9÷é×órßzêöOŽÀáÇwZSÈØn@R w}ß‡ÁwÏèÇ3>æœÌ%h	PWtOÅq‚cÞ’wî˜3”¿Ú¹tµbAàÒœ‰£=…8Ú@±°YPû.X­¡Pí»gÁJ­=àÆ,îÁ*¾¤OíîE·KÂâî6i£¶¦“+Jîà¤º`ÛRÔÃ«ã›~¢ä»Q6…òpkI…°`‡Ó2HvoKàˆ~õ§DÔÚK[´¤­Wˆq¤ƒw8§ÈÎ-õ	§ZþÝ‰Ù7Ê™^"ÀûƒA:˜0ÊÚ.,Ä€n˜^ÑÖDŒ£LªÝÉ|J×Â.ùí·ˆË_Q¹;N'€bÄô+”ºví&‘$ ²ÈwJ‡‰æ¡×“•»’ü4-ÒP‚“Æ­lQ9àÊeJ¥¯½Ïß¶„|.VTG~©}´O»õ;»`é˜&8ó-€QFÈ@µüLl›¨¯˜9S¾=ê¨*Â¬£(„]2¸L—G&%"wéžCh‹ˆLù Ã• Å1Þ6¢F#ç{3ú-6
Í±Ìë§?j/éñí%£kÚ+›K-þ5ø)Éº±ÕKnhh“»åû»Nž8‰Ø­×»$ãyàhZ>~6¢Vãb›ÑEÉø6ºs2}öâA{—k’nÛj#ÆûoënqúVy9˜Ò¾z!àØà#*ôŒ#Féúœq xº4HùÅ™ìÒ±äãú0³#I¦¬I=]”‰Ä-E£kúÀD1JFº«f.qï¢„éõCw£x.•`e¿§£‹é¸ÇÙþlŒ*óŒ°(Kâ1…Ñh:£mò©Œ—~2WEwOñÓTd*¶.âJ4¡„RÅ%Gà›“¦NÃÿïOkË cTÚd*¬”Ý‚Ý!|•!ZFh†œ†¡+•€Ây/ 3LbÅÎ´-Ïà˜›­n€‘:&’91Vàgr1P
'#dÍä¶AÝºX”	Ø^ñCƒ·KöZ…úÿ¬mÖà2‚¬Ôifg|Î×"ôt0-JJàN%V1e1WU³Ò^Û@„ªÎ&Ú ”(X]kqz 7Åo€LÉ{¡’Ù5<"æË»Ø¼6™eºM»Šo3­]ÿ“ÞR#†ÁÕ˜eB["‡•TýŒ¥‘1¡Ù«LŒôI“‚Ì:u¡—pœjºq!|3SÆî'v–8€˜Ó*òÆùª	è6( òY}¬™nÒSl!dâÌéørÀþ˜Q(¦ÖW[fgëiÒ–~M3>¦m‘-í 0ž<}=!“kšµ*¢‚7R9wÃ1o±µ·7#:ƒN[ç§Îa@d‰XÚ_1‘à;abb\Üê‚¢”Q­“Ó¼Ó›ºó/[ÛÇ:~Ú›®}³ÒW\Â¦k…°iU®':·Œ¨r­:†õ/|{+&{*ðÀòÂ8*bæ<R°E©aci!™öçÏ÷KÅ™¯nHöÒn‹ài„æí!¼LÌfÁ|AAÛJðU: £5h†zXš¬†Z«Æ›`è\lõãeÑ,‡;[tJ+ØÉºÑMü Èg›)Â)µÀÇRówcµÒ:Ák×ˆŒs9a ÓI+½l	³l<™ƒÝ‹‰<á Mè„lî³~xgëx+Ø=8î¼¢'¬]pzÅºXMM…95¬–U¢Ÿaë&zT8T£;§Gäi²<u1=÷)ÉnÄlç¦4¥Ì:óvñÐ•Ð‰ÞP¯À;»³!	‰hÊqp´šì¼‹’ûñˆ8Xs1ŽòÿíøKº¬àÓlÎ¯1=¹NnŽ¯ %OvGÿ&NØ›œÎa1P']*‰?ù¦õD4ºWÓÑµužM2ÕÔóMd`‚(Ý/^ª”o¦†Ï8VsìÍðll$êuP'®h3àŽp~Ó>
¸C¨÷Ì~î¡æÄkÿÁÍk¦ã
Q4D~2n–[ùÝ~þšý¹ñöþ×ÓÓæ2-[í‹ÕšÛ¼E—’Úl,Bà£qñüð€KF¨Ð¡øug<¶‹íVg|Ÿ Ã¿GbF7=æ5¯/µµ‚¿º’/ðtWuï~ÅÆDÛ¼)Z’,%šõì{§oþ†}00ÙŒÍ7!ë6ÐsU¶aÔt&#b¢¼é,ÂmIš Ã–	9æ^9È[º"Zþ_GÇã)›ÊzJ‡†ÎÆËéŒS³:•m®ELÒJÓEWŸ3·/Y[þ\ê•Ë¶\r¬ÛtoFNNì³ŒÆ6lWày[¢p
9Oh-ýŒ&0œÇ÷¿pòÚÎ+j½»ˆðÌ;zKýÖ©`;7š¦¿«JJØvF¥Íè¦FW«˜wÓ6×æ;Ú®*Ónî†øuã+ø­ÔŠõ_,øß«ýZ¾¢\È»ó×}‘ô½h«tFœä«B€6Ì“:T·ß†á0;—['{Çg¯:Ã­½3m¯;½ïQE É÷
NVËd¦c°9'bM~­9×¾J:ü}ðõŠEÄöR÷éK÷e.u0Íè†ó¥	£¦ÎG…ŒÃßëÎg&Ïð÷Ájû‰}^H.¼ÎÝ!ÙÝ–ñÒ
“l´‘‡JL-º£ð3S»ÞK•8¢ÖÊŠ“ðÕML>ö^ºi‚¿üw6C0šò^©ÜÀßO‡*-0^už:¿66Ül·&0}²±â¾ñò c¡ÝÆÀÒ1'°—ü÷û`­ýØ­Öäý•¡vunó»oJZë¨nßü(oÖÊêÛRõ•½ãô¾Ø<_;u:™}ñjÍyå%õÅËuç¥ÉçK/žè„¾:È§œÀ[êÃ>pE]AˆgW¼ÿÂŸ<r¤—è-\³DM¹Æl¹ED<Å“ÆÛº{pá|¬8£-™³‡¿äØÔOÑtýhæQ5ë6Æ9¬ü«d ÷.âeÎ«˜W5Ø	Ç_$¿Èg¯è™ºlD«W±V4N7æ\'K05pq S·#ý]v%bˆº¨\‰jDöI¿øˆ¶wþæ4íéíÐ¾Š$ïÉVrƒr8ü«ÔqD´üö»ïŸýÚ:]æ8OÕ¯f¾%-4R¼ÈM‡Î¿#éçr™ôoñ’¹ó?ý¾úÓ¥òßºÚRû\†áÀ‹"@£jC ÊÃ¬ç‰‘¬ÖSR8>˜¼T±¥ ¿BüæyÿøÅ*¤W,õL,¦¿
(ÅŒa˜ñ ¼âBë3q‹9"ÿŠ£Ý3ÀŒ?l;Ì@8Î¹±•ƒ?x¡†²¼Pœyvá•‘Ô<æÅ©Ñ +ÿÖ–›•÷Ë™6sÆu>>T@‰œM‡l _Ó1F5šØPàÒºtarî'Ñð ºD~Ù¹€šp^ya9ÔÀîã–QÖÖ–Çxø¨ù´Ð]žR…V 4›ÄûU›ó};´‹ÔµvÝageö`ð!VÛÉèŸ­†ßŒÛ¢_þ·ôB¥x`bmóJ…
CC²ÙÉ4©\p¨Çói6¾O® üly|M´—–¶Œ	ŠŸd°ï×ù×Õú¦uOÙ¶š@±e†Mc°§"ÈW ¾4vä7Ï×…³¦©Í­+Ëh?°ÅØ©¸m®yº¯]÷©‘œ‘ÁÖ»îÖûC4ÒÉømfÏ…&&‚ËIU“4/wâPq1í^CwaxL(²ùfØ êÔè´gGÈ	5w/˜œ¨,³ä"sü2<VÄ­¬Ý8n ÁTá~º¾çÒàÅnXj]¿„'í£›«¤›µ8k…I h«üÚŽáP’B:Š)®›Â±ï
çeZÔTUÔ{I"çä¬g×ÎüŒÅ]17ù:Óˆªw¹Ê†˜ö9á·›Úà’ˆ‡ŒBéŸ5¥¶Mn³k7“ÏÂâZð9ÉÇ—’‡J&”&›|Ä²¥Ü5+Ò!*œ½Í%PµZ‘ª#Ÿn È¶.îZøÉpµœÒ„åÂšGÔk
Ð~wGÛwÛY¦Á¬•zóçC’ÖÆn¶Ø9h¾´4\iÝ5ÕS{ePE¸( £z­n	­ÅcZaÛÅÄC“¾t?Ë½]«öåVàD¤úÆT¿¯ý:RŒ%ŒE×†6~ &ágåÔ"u¦âgfË×¥àï•^„ÙÁ*kÇ‚–¢aWù¶±l|f»†òâ‚H(&€¸Bû/ƒds¤x‡r6±!n[)‚†û‘ý¾M»]v-Ó= +r'¾˜ö÷Ò~ãüíÿ"¢ö“mM8ÜS§MkÌv:uÉÅ6E˜Õ-y\ï};8ŒnQÂn>'ÀhÁ+L®è¤/=ŠtÂšéÅ—É}Šºðn¯¥ÊdbÕ®QBi‚Þ4f·BÓ±›Æ,Ç1×,½t
9œsM û_ÒwÚƒ¦ª¦‹êòÕ ‘9ÉLðx’»™gêAGçåñ×ÝY`ÜT"ª¾³¶þ‚êÅûÈ¥+,ÜC–-~¯ÜgKä+W+=gõ>yíàý![õnÙz¹tf‰Bp¼~ Ð‚²ÐŒ×é…ÀðÝºá\#½Ú[‰ã¦
!|Æƒùñr¹ê yË·°™CÊ¦&÷”wó,3Ñ}	Tl$¯e9ü/<k½éƒËØíí¿F­ßVZßœÂjÏ-z»úyH ‘ãn”Žî†â‚¿I•ôš(9ûHAaÁ4Šm \´®ø¢
†Ž$>xãcF²adúø¢í¾àZø¬×ýûÓòš
C®g¨á|í]uté¨Ž`/íˆOŸ©¨'Ã×lF¬<’äŠsöˆ »(ÐÝ‰kQO›&Ý¶ÖÊ0r¤“=$´b™Û[ÕX#„ËÒšfçhIëWÑj—xú·Ä×’43H/h~è	m…þàŽÍ÷öè¥“à“ªô\ýtMQvÞö:9¹$7©²Wò*š«åJÕrU¨aaåÕ\«¹Œà—Ú?ë¦]âé¹ÊËN.¡^±K¦­ªœzç<ÉÕËÆÈ3·g¨Ùù›°…¿àÿÁ¿äª¢E§©Ùë•«™ôÅ4“ô³\Y5¸DÖ¿“	$t°‡]Ð©£ö1ž¤üî’¤¾ÂhŒª²T*Ë€¢GK\¨N¿˜Saw|#k–á·b¹€ÜE¢åËxù8µJúµ(#àYëZÛ€Å8}§÷PÇÚFzåþ­_WôòSœ]ÉÄ^ÝÓ¤Gk'[¬0‰ÿtºx”ür2N‰ÜÆÅy6EÚ¥ùŠÇÓ¡óLtRw`e¿µ0&ð­lÈy|ÛF)ãPŸãSˆÊ´¦áúØæ¬'ì~aÈØ3—™zY»¦ª±HSóY„2úI[eM¡V›kÆQ•ëëT-ßÅœïÛòMíF–¢
ç]@.h5®ý‡åf!›jÖ’Üõvp¤]‘´¾ê±9w.Á÷üoÌ•ô£w]{S£á*QÌ¢¬3b<4kgï«Ò¥åÒî¼»p‡ÎÀJÆ•gDÞ:w&8õIâ‰R £Ì6û¿ûpùÊ5ƒÏ	qà±RV8U}¬¨FŸç»=¸2C­ t!SèÞ°Q:¥.u‹Q]«TK=«™§~H..÷Ú¥ :KNÔ>WMSqÑ²¯4ªV™t5îJéñ&:NÚt‚£êßæDã½ÈÊgä†9ÏM˜Ë%‘e†Ù©þÖòË§9†N«‘Eä!ª¦á¿l÷TÇj:äŽ6:„bVV•°¬îáà­Ò:nqÐèy{t$¹ÏÅHN]ÙÉÞÖÞ·2y×JzµS„iv˜Í¤îåòýP*[	C)ôSî
½R<æ$Ð[
Zõ¥Õ#;ÕÁ	¦ZtÃ§Ä²*kqòNlsÎº l©0)ÏÕa½w÷» _p/çK†{o3€òD!öIÍJåæÜûÑ.09Ââû”E¤FE™ÛŸå‚#NŽjðv89R£VÑ5Ãþro/\U‰Œq0½¢TØZ8v³ÉžG»ª’å`W$o¥‹U=ÐuÓÁ2UÞÇ€€@Syâ}YhÇÑ?Î´‚!.oJû‘ýéÝìR;F •_Ñ…Êðå.²F áCÈl‹]X¬~rÔ9D¨úËÎaç`»Ã±êÇ6àH–uÌ´0Ñ}FëÊ/Õ}ÛjüÝ^°M__ê +”Bf¢-:sÛš4¤â´ÞGÈYjh\Þtv¿aÜz„óœ‘¼:èaC‘¸:É-Ì'x“å>`ß·ˆ'v}jåÑïW"4@¿me‚f¨ã"e´T@B´x)x^Ù¿eG¶ƒÝÊqè­X:¤tžª:Ú]Þ-«­}]ñµ¸æJªÃÙ{!2:Hgn‚q<øaÚÝ)-	]©¼†¬ÌBBV»À½Ü.Q;ëè—£ãÎ~°ýúàèøpk÷àXÀl–^BŠýÆ7é(ð…zQVˆ ©PÖÖ«/-‘<ê™±ŠX"*x¬S8ìHcf½>ØûEÅËÅ@î°aF‚Þ³´ôÚ¯X,ÊluÃØxifJûångo®e»»Ç»4øàåëCi‡/…£2i0x†&ugÍÍ¥%WÒP÷M#%û	 ¬ðÒ’»L.ìWÇ:^)—Ac.ˆ~—Ñá‹]ÎõqÝçìÀqàt!|@ðÛêÊ¿~C¿!Ü³°`¨Z¢?Hðí:ÛŒf}0IˆêÓœtt±gš€86:áÓ‘Ö÷¨)öåß·_—·äTO“[‡uH ¢Þv¥ý2 î¨'9/í	 Æ™ÖØz	ýërDs‡æÖýä’ïQë?¿Ø8ö)Ô!“¶¬´W•ÍqcãOÁ(žB&½BÉÖ÷ÁF{#Ö×þî†7Wi÷q½ô|½½_ÿ‰nÞ‘}¸Òþ:ÿ)ˆSº•m+íÇMÀF·A7²åÿü?{~VVtVWVœBüõê
þ³Š¤¾à¹îã»Çëß¬”£T…¨mkíµ•ÇOÖø+M…†‚˜ò®áF766PÄ¡˜¥ÅÖ6ž>á&V—×Ÿ¶Ÿ|Íõž`m·ºIÏ~òŸÿG}³ñMûñSúIôÁN0ê/¹ÐH•Yk?þæ	ÊSÓ)·N„a¤ëÙæ×rûIÆ¼N/î2Ø0«O‰)X]y//Üœ¨”úJÓ†¯¼ô;Æ'’›7´w–íVÓ0@zoQmz£oõ¢ÉTèžs„àÔ75c‹
 rùY“å®¡ë$-¹{µlŸ?ÓšúŒ_ŠÁßéDŠ&±äâpg¢”5úy=2§°á]ŒiAÑÇÎ¿lí¿Ùë¨Ë #w{°J_È	”  $äÌñ+ð†æäÒ4gK» ›K×HÆXSqÓa0âÜìµ¦þY?TW#½£-é†[&6>…k+kOZ+O[+Ô‘Õ'§ªV’ìø”u!T:µ«çÁ¶zî7 ¨e8èÔô˜¶ZÐÂ¾©j}õ	6×ŠnÝRŠ|ûæÍÃz°Æ=xÒ^ŸÕƒ¾ºú6—M@n’â/Ž¿›=h«Eã§iE;pg'ÚWÛvca7µ—ü™ÎBmËv@]d¢_Šœä?04¬´A¢w%­åç­²½|sÎ‘ñŽ‘ôÒ”5¿ôa©–¿ÿkÈ/FÏ¿æìç¥ZþfÇ[ÜÓKµüM\³›Þæ.Ï’—y‚ƒšÕ)D”¬<³„æJ`"!µ°½¶f)EÍPˆ¥S¿:¿žvmé>,vþÀ•_ïîÒ)X­;íˆYWdr\~…eDß,4fsFˆ›g
F›Lï­ìUÝð]î6Î¤Ô,.eýUÅ\ÉÃgœ­EæªêJiÐ™h.–Ï>u`¦ì„åÌ×Òé’Ö|}rüæä8Ø…r²-¹+‡*œw3swA4ŒèËD¢Áƒ?O?¥/ï|ŽB°¥BÀb€Â'\R²ðI~‘7"ä$™f!ˆ‘Õ …=€¹0\é0²H|ð1+7cõ¤•nÏ Ít$ã¿O50HNÖÖxd|‚§@*Ó¯çø?vˆ¢F8Éüæ` Xï_®N³
è¢úã+…½ŒÕÚ>9:~½_X-ÄSTÔlÃEÔŒ0“'I>Ü`Á÷­l¥\se5äÖ5ÌsÅs=x%‹zuÓ \cÊJÌè_~Y¢³,…°.)6ËønÓÎáòW°â¾oÃEÛrMôÄ}àôÁ±k<ÎsüÄ¼¯$)íÎù6ƒÆ@ò?ärhœž;-l:æ“êLŒàÂÍ"ÝñôÇMR;ÏUé¬öc+ßÞ²^\ýz_à¹ðÆyÂZÏ“s²õ{z«û{ÿÅ;ý.Øy.ÉdÑû˜·±‰…0¦…ªüÖå9¦Ë¼‹Jò¢†ùüßuÍ¦ñ¥wD¬xexCµ!˜Wg¹Ÿi5#”Ã$3S†vÄfaåí@Pct})¯@®@À `ëlï9|Îiµx2Ç0nÛ57ÑkžûÛe—w®÷sÅçoû?Ë³¹ÏNö_t‹Ÿåæ¿ô«ü¶Ù÷t3ZÉ2ˆûQ÷nY/^N~vÕ2fKˆ ."­h3°ü%œZ(j¤QêJÅ"‡7ý•wF•gr:"”w}A—»•›©²f-#´à¢14?…ñ\ÃxYZÜŸ{Nœ“TT6Ûœ%ø:ÎY&§«¹Xü¼ë÷#¢9håáxöâ:jËß½+ó+UeTè3‚2“,þn¨ï3¡<Í]v¦-ú.“¬ôgC:%_4P_GBøŒÒB”}9ƒ*”Ôè¦ßÕÕb¦öÙ~'¨ZàgòƒïùƒiÌ*›Ûµf3Äw%òT¿âf0ªÁJ~¦2_{üËùÛã_¥Ï=þýîeS,î{ï–×ÐRå—•×)F–’Ð‰e-qaprÖ,/#òå\/WT;i±Â¤“[ŽdŽh‘'@Àò
©™k³ë:tÍÙ•ñ³œ©m³¡]m‹¥ýP,óõÆÍÝ­¿ñÖ¥­Ú{é–6Nv•§ˆjÏØ¸­ï<‹o¿ zUïp³ñåS×8–Hë€¾éÕïîÃ’ˆŠ#ßÈG6p¤@§"¼¸ÍÏg.&–q¶šó+>“öoj2‘£Ä•æŸå¼_§L=Beõf.Z"Éþb‘Û¾Sy¡E§¾ÇkßÔÙL?£‹\¥ªúIkÍ‰Îâ÷WÑv¨z>1¤LUªzßT1ºJB,ˆGC„»uoÏw!Ä‘Ý±–-•£€HØ0k·«,úª¼_‚ˆçtðŽ9ôX=Q«óGl½Ïå³àJ¤€Rh÷‰üM'u7f	ÎuŠíóñqƒx˜Wn,ÿúáí¯Ù¯G§þõ~Ù	j1ß8gÌ½yývå´ °~Ò(¹b«©ãx„‡êúØt:œ÷}*»ÿÌ~BÎBGúRˆÿ¨o" ¢ê
ˆ€…ƒî]ošª£íg:n)‘–ŽÎâ¿CÏ­?¨§–N„¥à2Ç‹§Ü]Ë®Â'{kÍt¼úH§¤²Ý‘¢n—á‰8uõMYN,1¶'cÏIÅO&`‚ÕÃ" .c4§¥…ÖõÃ1DåßUj`Æw'ÿl6é9
‰M¤ý1*i½€:é½â5)Ç	0b¡îÑÍŽóHC‚"’}§0šÃ*²‰Uhõ}N¡®ü èÞúÏÃ˜X>ûŽ–ƒýWõ“mW? |·LgÔKI‚yw‡Ã©ÿä žŽÅ7öË`;íÃGã]lÚ‰‘F%EÐù—4)#`¤KÀ¸.qœ¾Oºú{$Œâ¥ßuÇq<RÐ¬ÀôúUD›0eË›×©ý)€üSË®¿™à"á–ü9€êßK.éXÝLï_ÓjùÊÿœ£“ÃŸ:¿…ÁÖÉÎîqp´ýú°CýóIçJèƒ­]ú)*¶;º6Ñ÷¤?š9!aåd°ñ¼z.4n¹ºr/Ñè_,oIöÎbê€J[bB0ÎDÊß}õ3³ÛØãÉøx=µ~÷Î‰‚ÑÎKœ U€Ùšøc6?ý1éâ;üfw#þ2*a4Ã ¦·;ycÖKU3Ù“{)ÖÉæt-¦£ì,›œÉBl{-ú~ZæK"/ba±ŽZ
>ZÉXDÝ^MÝÛSÉÒðÆÐC¹-M™5ÛÀt@~ˆ‘¸2dYÚM˜rÚLU¦¢Ð>äÜ
pW•$!‚íÍytT¢V}A»$[4tÓ«t ’î@‹³¥žÀ•Êî%L¹z“t^»`‡î(&°‰xIÁY,vâ ©ºwY§Úió!3?ƒÜb°]HgØ<¤v^ã ò±=989:¡§ôë‹Ý×€.ßÝö©ÈÉag¿£]Mbñ9„Ì„üO’¯$ï¦¢Aœ|Éìt|.©†„Q ¬oœ$I¯±x±ÑÍä$.»‘Zì×jàÑ“^©5(×a•ÞÒ¹#€™\"…,¸béZ¹Ž{¹~$é…mtYö—ÉªU;Š`àxäßå“ùF7°›•.0—Kew¤û ¼€TÊc)'rœÕe¯jT’Q„,@zÇÚîr_çï_ww.¸u¥wê"Õ¸&û4¬	çº1ý¼X¦„yºK¡Ÿõ(¹˜bg·IorUov~n‹.mævš€‚Äw¼}Ô~ê©mZÎÀ½¿‹ˆ}¸H`2.à°F‚ˆ¯ç#&õ`sþ,¡;vDÝ)§Cº…£j*ož¢!(;íšt>%¢@Bpâ'b€#<bôaåŒ,É\h)è>á)VgÉÂè%årkî5•–C’(Z÷p>µœ#â¯9\P¾oìTÎŸ©ìß\µ“tÁ!WJÙÂWõ ¡e'Eå5w'œæ¶Ãhº¦JÚë étÂö=‰™\\‘Eý0Ó3úP‘@3Ú¹kFy·—Ôe9Íd:÷µ_l÷¡dC`c>‘Z¨k¹Oâ÷D/Ä‡Aç½3^Ðð|áÖ”‹C¹åz© S&¢!Þ?Ö,|ÌB®˜TVF|RA	Žð"ÄOLüÚÔ¨4îAª{³ælV™¤TQ¯§”zÈàè~¾QÑ‡EÐÉ ±ÇÝå„éUCiÎÃGöD»;®\9?žG]¦öøh¿öÂ ‘ÈÃ;N6ªòÖçR™w@MÛ¯Y6E®AVoØŸRÅcæÛ­˜ÿwn…ÎQÐ¿öÉl±?³GïÏÁ\ÛhPl¿š¬ÿþ}ñí¶~]®}ÖuüC|Fù„ã•?›xR=¾ÚéRY_>ÂR\º…KÍÅ¿'€ò7bpurau}²F—²xÚ1ÿôAz«óIv!îÓvÐq>>ÙNýóíÌ¡Ÿ°ì!¿LÓKÿ¿zöø?]Ç?«þOUô;*áç®ø(eWáÆ-‚(éÌþ®ý ÚÚ|rTÉ\¶KM)ñi, ÆVÙÔ¢~® ïß9¶›'FÑB‰ç6úvØÍù\Ù“Zw¿ä~$O^¼<ž^$#§ÔKÁû1Ñiö+³Ï¶_lã¯kv%CÚÊ¿®ãw%géNg^”ÞåîŸJpo³¦‡ Ñäù8ò}Ñò¤"Êýå¤‚ÞÊ‡¤^yc2t°þãtÀÑƒNi5Zí/wÝ÷F˜Ú§‰ænc•ŠœU¥rc›íê|¼#Zs0âÌ_+¸çaÂûL™šìÞ·Ù"}ÜZËŒ«d?øØ	ÀæŠœµú	ù	„a»b•žl;Ž¡Š1¥ÙX5€–ôRq²›ô‡8§ˆ~åÂ!vV3¨}!E±§LSùØµšÚÐãàä`÷˜u»GÇƒí_‚ÝCÇf”#C8ÇF¼/VþdSH3ÀùEúH(×¢.€Ç˜gJsé)¼4+°Zt*×9&¯?ê$4Ž¨?ìÐfÜÃ~âÿÐÁÏŽ]<­æf°µ÷óÖ/G:|¿!
d>É¬¨þ³=PRµþ;¶Ó!~yE÷Î”fÔÖÖGU¬‘“oLò¥'™{ºŽßê
6ƒõzº±‚§ªQ{hU«æA¨áåÌÛ¬:¬^Óº5Ó~Ì¹ÒÚºä·ª2iBè¿ê•êHŽNlª‰j[*±i›Åft?öhÆ—Á~ÂªÍÌTÂ…@@¼Øç/%œ.ÛÔ!8²ÚDÎó«ên9DË!x›²Žþ2n2¯Xž„§íõ@­ÿC­½w&)l©Ù—	€øV#æ\›³íq”Õü™Ðw¯dáŸÜe9¬¬ÃS!÷¬¬¾Iá¤^ÓŸQCôò Ó×ª¸ó¸Ö†9ð€c
ä¶ñÆÒ9—¢©ìÍ4TÁþhÁGö¤—*r‚ƒí9¾þ’d€É2BF½bÔêäR)*[ÏééW¥¢»Xªïxsú£Sµ½W­ŸØï>¡õƒji£ªZ÷‚CUáj:ŒF-Ð[É"-ÝÐW‚6ði¸„UìºÇ+~¿Ã!Å/q_V„~Çë¯8	ÅêãÄU¯·è//§£®b¤#Ò5uËìcs¨9Áéûgr…¤÷é Ç§³¡‡¥¿ÞÛoeYþVÍÉþlèÏ+§ƒ\WÓ±Ö~¢§`½æ­˜hÖ8Aªg˜EêÄã¶ãZâ]™jb*ÕLæ3ÏÅ"h8¡u¦µ#Eè9Q„žEè9O„yÇ‰Ðsš«&Âö¨vK$Â¢sDè;F„N¡vˆÐ» ¯ÛÒ–‡ÒŒÔwbðVàú’²ÐÇpjù¹È0f)õÌ\Ó¼µŒ-Û¡*ë»Øl7Ú.W«Å_¯´Z×ßMMd8bc~Ù¡ÉPbqîJJëb9Râ¨¯R˜Õbqõó¯ÃàÇÝWôckg‹þóÃ–ƒCe9Üˆ>|;Si¢…Y³M—³XÂ²˜äó	pFÚù@HãØÉ6 Ûž‚ D|c¿9¢V-d&pŽ4ˆ¬ÞKnˆËLìfVßt¶w·ö‚W'»;½ÝƒŽàæhGåŸƒÃppüÃáë7ÊØ/–3×ÖìûEÎr&è®üL%9ë–=¤î÷ã³ÞX4rþ»þ4LÎÆ4Îqû¯Ø[%;Ã×÷ü·C|rwFÇ3ó_˜v.™‡&îZ¿™ÜÝ`Qc6²ƒïíV`é^­š¸'QN^j¢+Ù,e:¸‰‡2o…	Ü´×[ÉLnjÊ/¨›ÊÖtwh¯VkAÃ2+¡Ãð}½Ú”nìŽôê(½Ñ¢ SÎm.KL~ü§Ä‡õRH1ùd×¾>ÁdÏã@Fû-ýùLv98R2ÔÖ|wjMíàËVAƒØZ_y¨—a«“³jû,ƒ4’Lîô+œ‹ñø*Mz˜!÷3µ þl»µ–_*ðyàËÆ*™g è[ò%	ˆðC¸1Î&rÇIãìk²™–ýze…×	ÉUkaŽ3¨=UoWä­î *ZîEwj‰ú`<<£	ËJ¸^²ÕÇ+’:èkM`¹O¼ö™q 7ÑP__EbýœjUqµ‰nsýp
F=ÄÖpóßúhà5ÌpíÅþn°ú´gíqû›àº¿<üÏÿÏxŽ9ôF÷jïzItÖÑÿH®P:Ê,b"ñîlílì¿¹JÞ­ÒcZ«*Kþ¥ŒÑYŸnqì 8ŠÏFÓîàk’à¯žÃ†æVÎy£VÍ—#>s§HR¸s5£“qCYöG÷?X@ûwî„°ÀÿšžëÎÇ¹#ðiw*þ{òFðtÊ–©Ó¬ŸJ¯„+èµìf¿Ð
L~-À‘9„â¡ý{rH¤†ß3‚¨Ïb	^`±ëJ•QþÔŠËóÅÎ¿æ ÍŒ´$\ÜòK…ê[Žj¡âÞ²Ð¸ZŠ…špUùà!²Ìb÷XNñ‡Àô–%ÁÔžä² ³Sª¥:k6ê‚Û9Üi‘Œ"OWêÖI»d!dº3‚øõåBÝ6¾úH•Â·¦~v|éLÓjŽZFôÀ>©_=Ý,KÀÁÎîKFþ=¦\ŠUn¼AÔ…W0qœ¬¨/’CðÈêƒÞUDÈ}0¡±°c€â&œÙP÷*±`‡âˆ¡ûïtwB—÷e<‚éæËAÔŸÉPü’—2î1"ÛßÀèÎPŸ«/¿#BÆƒ=­œ-±üƒ:c•°Ü_,Ë}í:Þ_Ý1«œü«ùeq-ËË¼K˜ÌûI¯7ˆ9Ëì›4›´ÞˆÈƒI8Š Rþ ®[´ZÌ#W`
ÁzwÄ±#d^åÃé€8¨¡¤¥II•üòË4˜<o—í0/Ók›&OkF‚1~O'S	˜›¨;N³Ìx!é$¶ã¦N¬ö,˜ÑAs€Ï…Œb…LiM'µÏŒªiô®tMä~G(4·SnÚl663ê`ßºws™¥àÝˆ7gJ–#¦“Ôˆ‚Ûeài0Ž»×!qrÙ×¦î”÷ôÛ’šäÛ£T6ÒÃ>å‡óq-OX•TÇî{„bMÛŽQ2•¶RÖßáðªïtt8ü¡¿ð·Lœåïüì:GPƒV"Ý³Ð¹xD“ÝlCºÑGð|ÊçDÂ5	¢QÕY¶“¤ªŸýåÞ€'÷†–‚ï‚ÕBþ§ÀŒ¦¿¼çÍ·ïUð,x²Ò^)/£ä*ót½¢Œ‹ÈGí)7Šò6­8V7*j´2•úzN)Û04w_oäVÙg1ãzÊßz~8Ì©ó®Þœ¹ÃÜ:è)ú>˜µâV1w%VÚ«ób¥ýõÓE‚‘e[\|Å¨jØ[‹•öÆBKašÞX™¿rŒ/Œ»öáÇ-ÉwÁúŒ%Q¾1s×d½ýxÞš¬UÍLnM¬›ÏK²ÐñX]ôxl°ŠW/‰šö;¹Kòq“¿ú&ÊT5…ó Ü¨:L}Õ¾(ž6”µÏxØ]Yë¿èŒ7ü¹ 
k°QLøðUX}¼6¯>Yl%¨6hPVŸ,°«O[‹9ÅlãOy5fQ&µ—ã8>›<ž½£¬ÅÌ¥¸Yp%Xˆµª2ùu4(¾ÈJ<^ˆ}³è:<‚ôÍIVb}öJÜô—‡‹®ÄÚgX‰õ
’ï,Ä“Eo…ÎÖ°È¥°Ð"l,xO?V$±À4y:
ŸþçœÔ—/
’ììÏÀ×ÿ%ðzpí æyÆUÛ«,;~@Ù¼vNqß$Ë…½²ÂÒêç<«D)›m½éËuèÌa~ßÎ“ÍÔÒkKÆE=oY	»Å+Jx{vNÞ²er'E[¶ËºßÜ³ÊzÊc*üÖ–†G]šÇ¾Î¿O“wpw¯Ÿ~;ãTlù¾ý)Iíã(äåmEÐÄ©¡^KÆñ{Mp‘ÊÞVtŠ¥ØBÏè¨ŸVnï‹aR/!¹¥Wîˆñ õ‰ÁÍ”qâcpWÖÕ;y‹ÂùÄÏôgå‹ã#kÈ›¿q¿ƒ—M°LWÏÓüuW:óÊÿ!Îhñjpá_¾Ž`óT[öD#•ë¢Êà*eØ–ø’f~Á O²Ÿ“ÉÑqvNê}ÝŽG=õ\¼¯ôs»=ç¬â®,¬³”û¶p(˜ò>zfJ€ÞÛgâ{æ¨•t5Uš ¢¿YaªÎåìŸ,cˆ¡r!9çj¾Ü5—ÉœÇ´U;Ä=p\kÜéßh\•>€ÖêâÃZýôa­ÎVÁýó¡»oñá|ýéÃùz1É’Þ\é¢Ä¹õ¡KY±ïJÆ^¡}ÈØ×{~ß¸c/%¡\òâX.µðeÆóìƒæ_&£¸WT^ã5G§Ì›†Y÷=<ïGÁe„±Ý(Þ‘Y—-c{Ò¸zÄ‡ &ýƒñE¿Ó>æXº³¾Š¹¥ç¹Gù;ˆû[æå‘ŸC‘ƒ¨'0=ƒjñ¹²îT›‰Læ¡Ôyý o]Ë+*îÝš•fU‚ë‘<{fz@ßçž¨jÇõzþ¾ø0U¿²ù*å]ô-^ô.)->ks™¦‚ŽxÎìŠ£ž2>›ƒÊû0º±?Ð ‰2qÞ¯àýÙ­¦Œç¨]…N™ŒW:Üú–ë´LLz˜^óë-ÒJ¶€ÑñlµsU0®”óWUc-|¾ø0îhëÜ1²™µÕWAÂ3–ÅDÏLÑ‡+÷ñGjF%wšÄ//0"]òc¤¿ý„ñ”UáAê÷­Ýn£ß¿§èã	ÖÛ­×6âæþpý;r>çâ`ýÌõG*Ç†F·É´ÛFg<ö` 0æ6µEÜž­ûÇM”e>„_
'quZ^|¬«w)òÏ/dÿfáÓñæC^|2Æ¹È9T}4 A>¾-ÿ­€XêçÜDåX@ïfÁ@·þ~Òh½71zq4T"
<¾aáGlöOõe+:^)oÉï“xòÏo£¾Ž@Š[ÐJ@1	O´eN˜Ô’jë†:å¿ŒºWqßã*Ábµºx†ä‰­	m©®BÕß§£Ql"–¯ãø¦E;ªêŠþ¥µÕíÆƒÖ‹) #h¥ÑåÝÁµ^³+t&e£äòÒÿòr0Í®äÛÌf„)RæA·ÍžŸ…¨T•N!àD‘ýb6¬FXÂnX¡rŽû;:mÎÄe’¯fE±ð–ÐUE.Uð$SY±n&LÚMU³ó›ò‡! Uõ¡˜!Â¸À7t‚,&€™6ÁÌ\•Ö”¤
~VèÚ’BÖÙ!˜kP¹•{îoÆAÞúôÁ{¨=X%ÂQ^4ôÎ¿ìÃ×xg—óÖnþÂ.öÈ	ñN¹?Ò÷‹Ä
–`VFúÇå¸¹´´ÍY+™0¯þLsHcË©W4‹ ç`5aLÀÐªfWb…8>¸)»ˆà¯Ðà%4¨G´êµ$ëX’[cŒ¢RmõV“ãý\µ)ACÒo‚žÅoâØ?ùŽY:´»·ØW[½žŽ%èñu%c¢ïj<'Œ6],UÏLÏÊc9j2êQš¶^Û~õD°vaöL€I¤o`^3'Ä*»¿†SS:„O(ÈËÝÎÞN°Óy¹{°ëdÂ.ú‘›ïèMÁÆyÑ	ŽèÐ÷‡ô×B$°ÃÀíq“í*Œ“å>§’\N€¤xØ:Ø1+V_0®P'§Éá\z"[|<*°–‚A’1Š ®P9#sãqßê“µƒw?W±Öò%m¦kvvŽÙ­Ý¬¤¥X/uÐ_eçÃ-!tÛ`B};æ­—¢ëø¬ñ¾RËíKåû¶Ã:‡·O2•F;Wì=»Ì¿»2›,Ä¡N¶v•íœÏ-ž>Z)º…þh¤¨ì¥FÄÏb›-C<ý1½E²O•zG/h\¤)‹¦8çƒPjâuUãPöÜ-p8ôÁ-œYÝi\£V™ƒøT™9ñ*¶(7†ž˜ž´½TôtG½ÙÛ:¶ðk¼ÅzŠÎ„QÈ¯7¤&ì*Bæ>SnÈñçOï®+¤#Šä½`0Ùß†§!æ[oåÇvû°TŸBJ-\ªÏ-½y‹o˜ªR9©žjHœÒŸLßÔïfãé²>½Þ”E§çEB½ÉË·t¿tºô)AãÕ¬×ß]¬øÿOÞÕvµqáïüŠí&¤Vð‰“ViÌ‘1©ilì
èË1#¤¶–VªV2¡Dÿ½óÌÌ}Û]d'ÇÉ‰ó!b÷î};wîÌ33ªŸ¾%Ž’ö_?œÔž®Q~à3aÈ‚k™“¸ôýÙ‘ÜëxôŸf§Y•ÐSWgÃÍ@â’°,%ùDÀtNš÷ãœ—ß(OoCz¯ç4Î0+ð×m÷Œ6çy
+5$j“Î+‡ä_Y!å¹†C:9ÚïFÏ:Çhì?ö»G¸Å¿ŽÛ§1þóv¾nª‹•=™)9Ó†eTöæ¡â0õ6 §iÅi‚ä”Ào«w
£?Š—VËìžU7ÆGøô{têMå¿ Çþõä!Nçò<T’…|ß›Ž$ðÎ^z•q4Ã@FÙ
©ù”¯B”õ§p¸º[xr¬ì9ÌP(-Ãº×“µ\XÏúõ”‰)±¢ÙªbVÒÈcþâ©pVájmÍU½ìý3µðÍÓW¯^ìw‹1"š“…‡`dQãv#¬ ÿŠA”ô•vëÌÊu–¥=Ô6¹M*vM{:jz¾ï[’»·ö@ZÅÅ’G,LÈ&•[WvLf¹¨Yº66Ý…°©w=²rP³xgmVÝR:ßã²\WåyŒ4ÎÁY€$ÎÄ«Ué8Or¢r“Í¼Ò±ð·£–fŽ62NñHmvuØu]þé¿džÔëo›šD¾à¨i[Š¾õTK—ä‹:êÛe?ŸjA³\Ã §§æ ßÙyL7J9Ù x˜F…G„8ã…x2‘šufü­¸Ñhâ»íímgYri±§AÖw¹Ë7á®Ú‰ÿ
ŽÜøWÛËý»ñÏ÷ñ.	‡~Áuœ³ýòÆA»úDº^rÒößŽ3Ñœ·Î}±¹æÙ;“îžØq~|m³Ývd®”E×]£ˆ×’e”Ï7Sâìõsà!½Ä?âEò1 åd©ï¼€£Pƒí‡4p½Q¸í7•†Oûck‹6ÛèÉ"F$ïöÙWŽ>QÒ£3‚§3á+A¶¦½>’²eiNüÞVí(¶Åö@Ýbw•ý0nà9¶™X~ýõ7Þ ]Õ>9T1ûúÌkUïßÚš5WÙˆ±°HåmB„ø4¼Â²ßÍÂ^ì / ÔïoîŠø•ŒÓÚ:Œe•ï2Ä¡ãª3@u.ÆSTiŠ‰e‹OüŠy›8ÌØ"ÆšøÅQñÙRl7bÛÏØo!lÿïóñ¬ç·ïU^jÑ«ïËGÐî=eþ‹º—”ZÖOZéñ|ÚOÞ&?\÷æ¸Êx–­/S”šô¾Á©ol¦ôªwžïð]1N’`ÚÅ®.öyÑŠº	Ñ«£$EADÇÂ(oµî¿ô¹x'_£ÂÕæ‰°éÓ&juƒ^›òŠ±<ÑòIú8@‚Óà˜ÒnÉãóóó¸QÜ¢´ûÖ¡ÅOÂ@õ7§ùéÑÙvôt+ .Ý(°3üòÍÎY0ßÿÆudõ\O–ÙxâSÕSæÃ~¥)?¼º¬×îŒU…‰^Ui<=0_,Ì·W=î›;ØÈ®’ªgO¼>yËà3UögO{C$wài)XI ¨Z%º‰í²òHœRz}…žb9\L›åšW0­.7ô?têóY¤²Ym3%Y ÒÍÁíY|îÐ?%dgùü<RgYÝK :X%L’êˆJ®·XPOçÌP¬ªÆò¬½¢«!ŠÖí†G÷‹0›’2£ûQ‡¹„_Ó`DƒÊíÓðêÃùøë…[æÍzÔÑYÿù -<mÖ"Ó¸”Åò¼‡,•Cñ@,‘„>Ì"~­‚QÈÈÞTÍõP¶²ÚoÎ¢=§ÏÁ’Ì
\|ù—™Ž'Ñ¶dÐ2Õ£E%„Ôèªm‰9¸‰*mi'ù³«VNÃ¤]÷MÜx³}fþjÓ_;gL6\õÖ&ÉUüM¡& C¾ú’§8¨«É_—.Dn~Ì¼xXí¢<Ï÷‚† f«XeâNOÖD8àE7å[1ëˆþšmÊÁ¢|’ôÓ4§Š6šŽáJÈFœ«6£UõpEùuIÙ/ÄŠ2Õß§’,*¾ù‹E%.‰knÉŠ5š*4rÖu_kïk¹S :®êZÐsº?#ýW3°ô‘ò#—$åšLÌØ…'´‡qÝh&ä‰@ìà<5@¨ï÷ÿwŽ¾|ÇN‹¤–¦üñZ%§v•wO‹MÝ¢Tî÷2‡{ˆgœ99ÚrþDi¾eìAp»>îLtéçTi&n?©_gcÉG.&)šs5¥`˜¬ÉØ=´CÆ`žç6ýDÔÙé7£=‡òoHaƒ&…ß4‰ÿ4÷•”`·o-ò¸õ'}ú§¢<|´ýè«Íí¯7·w¸÷—tB~u\ÒDÒ ±",až1=B6Y<eØÉÆVüum¡Íî±šw–oIÈÿ:Pk^îÌˆLëŒmª#\ÄþŸ¦É¥„‹&R™iÚ9/Û	›ÓYc™£^®šñü^¢Æ¾ˆê{:r>Q½4[Ép|#é@¾£Û†³L±ª2EwBÕ»I(t}ÑÛéÇHTÂx
OI/ÍçÜaæ\mç>Òtl"›#Ãƒ'vecâ:€·ir8Î ó’¼/HÚ´çíM™ò±nOæì&I2ŽL·˜uÕÍ^K—lÉ8¾"‰¨§Ó¤ìˆ­„Ë‹(dïÕD§Kk¥Þs(½€ÎÃ¶¹Áz6$afeéVhÀò•Â¾<6H¡6–%ýÊ
d]ú Ñ[(›¥/ADBúæ:Á4Œqa¾„¾ñ°0»Œ×3t($ei™Þ‡Ä6°´©çX´Ù&ò1–"¨ ûPÓÒY=³YâÌÓ˜^pÅÀ9I¢ÃÅg±®óIžhK)®ÂŒDå®3>Ä8é¥À“ÄÜD½â¤ ƒ§ÒÕcÛT©×œrm å’ÀpAéX*“ÚéÊëúCÚICÚ¥Ø;›ÀeâUÙŒ ƒ‰KŒä ¬…m”(±ÏÁèYèÅ»„öz8d½©XSh$XLéL£º£n ÚÛ)ÏØ¤;i!ÓÜ½|ýª{Ü9<nGÏ5ÒCô’nÊédÈÞ{ˆÎ«´šDGØ\v¯éš\–ŽJs6"‹V2NŠÕu^î{§¿ò7I2#6”1ã15x…Æ{Í¾”mx)9ÿRJGû¯;] Ë¬¡|2v$Õe5Akæôt¿³÷œÇVàOÀ*û¼Ñ‹ £:.@ÏØ¦ïÒ‰ GDäèî½~ux´¬M/;ÇajQÛ9E¢»4ÍuÃ…6Àon¦½	Ómæ€l‚^cµ(ª²‡8¤
uŠ›R[Ò„èØÓÉ Ö!(¥Ë3ÑsN²NÆñ&òùhŽ©\ÅQ’Aò±Éªb2_ƒÀkÄuØbÑŠ]ú·x`±ì¨Aš­âLÐowÔ‚ ¨B¾ÍÔ,¬oä—{Á»ƒ_Ð“½bM¸1Ž¥-Ì5Äu©ûb…˜L—6!o«ÚpoVhd¹´~YÕ„}±BF¤ZÚŠ-PÕRðrykVr¶±}Xí(Ú;érTþ£c-é“B%†“m|z±òºý«.>8&bèæî}ÄC¬ÂmlV*¢"¯Nßõ°lÄøTïB'zi\¦¡’¡èì¥¼F¿Ñ½Š”GK–þáô7•hNzø¢ó”X9ŽËèàPÀÊ€Æq¼ñÐÀ­ØÀI¨÷
_Ló/ŒF´òõÈIoQÛ(	ÿƒàD~¡¸D:é9ì“ˆ
hŽÚæ\¡{Ý¹éh9/ƒ!UúýŒA,øJl¡&6"ÀìÊ¤8zãÐ4LGœÌ\0±F’µ76{MgD}¦®9~ŽÑ¯ˆ´?4ÐÒÓêh¿Ëaïji
ŸŠ„$þj¬–ZHƒ ­Yìôïi&ø,Pa¹º5íž#^ÎÐø@žñ{|3tigïïÊø0K*ø£ªox^jþgÎ^QxŠþÅ°´ˆyÜ=Ù;>éî?SŽöivÛ†ÇŒª}1 ÖN2 Ê…JÅõZyþjz}dË©Ë±‹Ï=óhûúçŸ"™F™AÊŠ­.c92 úä6‘è‡X2Î¢.ÉþJ
¬iá¢«!¸Ù­­¨;¾˜3@×Y^ßs^U^N=ÂL Óß2¬à·ƒ+ø@j|-Öwœ›€*ùdMä
 w¨º=Î¬³&ìa=ÄCå% v°#ÿ ÔƒòÞàS"*Çýñ ƒ*ºùØ  Fé,_žÝþC£€¨þÛM+†ð*nÒ=mváÞŸÁ•jèœá^3UkAª~(î5î3ã@Ö’Í_ÜE:ˆ&ßèpƒÎç­ír<PGH¸½ðÇÄ¸DC`ö7%åq“4’{:¨—t‡¹>ž"HhÁªïõ„÷•¶Ï´éÝzÈRèõo·…ëË+ˆuÓÂ{yhŠ$³ëät[(eŸ›‚VÎç  }n
šÌÇA)yhŠ\W¹ŠÀŠõ¿qVlÍ<6‚þ÷Jd˜]êþT5Z—ã)\ªëuØ|£¶=Hµè*pVŽX]Dâº3Ž¤¼Ù¤Š…'˜Ïe5øÝ½Q-7"‡7;Ou4Åz´7¦!µ¢¶0_IX3­]¬‹™X|ª­²M¢ÉŸÂ’ÇÛC‰3™õ[UæKÞjøÉˆ=çÄoT—r?ó,å{#²ü&™ª	Ê¤´„që³Ï>5³)Vrü0Û°4^Ö<øëºØèòæÚ:œCéMŒíX\ +>”m¸ÛâšòZK|· êüt³¥<)¿gÆ-7¦ª¯tÛÛOpNSG¿ÃüƒYDõYÊ õ/DåÞ¨¨£n8‹xn6Z9qþ¤¾¹ó¸!˜KI5v'‰g/[âX‡úðþ¿h4¨ñã1rWåÄ9ëúçw¼Ül>ÉÞe$xÖ/”1UtÄð¬àÔ-:³°HyXyqdæ ƒ±A´-ÜzÕ8‹ŒÐÌSÉ_çD†4ßI@ÁSä¶êå÷®“¡˜„e„	ÊGøG-1¦H‚PV	á€0
w>ÄØÎŒ¼w›Gñ?é)MÛ®m4ƒ»Èï)?ˆ¦5¶[-fÒ{¶ÀŒ'Ä&d˜½7äTŒlFb-PCî.½/{75¤óQ“ÄéãÐ¯xÓ.xŽÕFk®Û´ N‡ªÂº–ý]÷ÞÓÞí_§	0W9â…ˆ‹çb‘îl>bo øóý‚:ØùM¸—Í¨hŠp˜pÕn£´`¼ölWtŽ¿ƒ™Òp€¦a)Â—"Êðr¡¢›Þt„•L{7‚@×¶¦	xMšÌ`*Ñéfk¶pFðµ, 0eV… ¨_Œ‡¦›¡XVUzk€i®ÖGØLÌì"éÍgéå\|Z{°ÃŒ|j3R¸8S¶¹NæS¯œ^þÜ»˜ª ¡êÐ8vB³¾)'BÔÞ]/¬Dÿî0bîpþùÝ¨Å@$Iéƒ“!Ú¥mÌ?ÚQ•Ðµë [ªS]œ“8N³zí4«Ò³´¹{ ½çÒ>Ëæ^ÏÄÓ\Î$1áÙŠdFjV¥Ûø¼tD®­miÿ4ÐÇ5RŽÞ£Çà˜ht5I³¸,¸È…Fäa]JIEaê'‘¾Ä¿ß­XMDèZÈ'à)Ï…ý†²°
ÿuºLÈ”€‹WÂ:k‹Æy´8óúê_Œþ  ÿÿì}ÙV#I’è;_á©“'%eJ! —®‚¦¥¤:Ù®•ÝMÒ %ÑH
•B‚¤(Ý3q¿àÎŸÌ§Ì—\[| —¾3sÎÐ§³¾š›››™ÛOl™È•52zýNaƒµtÓÐÛˆß(dàI
‚YØ~¢Pqy†'u*X’„nD$³~ŸI™".¿Jˆ0RÀ„ƒƒ˜1%[tf=`P”ip÷íý¾ìD|=^Âãê†pXÜ“EC		ÐÑE~´ÃWš|†HúCrv’­ã‚[-õáLì
tŽ--S6Ç‹à¥L~1©ÂmQQ–3£ína!ðÚíÙ`šŸçœ-2Xôõüf¨àB­ðÏ¹¶lëÞÏs¦| òã;†Ý3¨³G(QGÃûBq‘:ÂÌç“{*öêÃÆEõ¸q–Ž±wt´·_×/à F¥« ¢‘h…Ý	0šm9¯¼üÜÍ¯¶¿Š­fIOî‘RV÷g“PÇ’PG „I`y¼"'Êl€ÿ<¯S ¢ùaÜ½)¯åÝÛæ3s{“h€»´vuÑ’¤Õ´{9ïÖÑ’#'äZwa8íOÂpäˆcv(²¶
é…ÈjbîÇ£âáéG¯†Ú7ûzÓæ®§S`h+•»»» Ç} I@,*pü%•¶G÷º²T`kí¼Ü2#yµ¶úJöøª5}Å¾Jõ×*tMmo‘û€ŽÔ’“ãÌ¶QMúÈÜ#£DqŒÆ¼×¯Åi»ÐçFŽ¹¼}ØïD6tîÜ-ß“›àãpC¬ëîG¤A÷ð½Úÿþoo‚·«¹T×t3|:XP“æßh(ŠG ŽŒdAÂxónõÝÏ?¯®•;íŸßþüsûá»×ÝmŒ³¸ÅÕ ËVw_Üm½[]}ñëÖO«¹Ìk!ååï™hKcp8[nÉ'Ò˜­­âŸãK¡6º*­ž©|c§é¶è‡*ï“£†?–!Ñéx’„å~wc2=À gq<ß*Yò±éÐõöWY±ƒ
	${ÍN(Óms‰³f¼“gš”Î½*×÷B,1²H}¿¨å3TJËß0Zî3ê"Ý+˜¦Ã: fœ#Ë©ykñºÊÉ²XN“¹â#^Û1ÜH~¨dZ=Z€zfE`^•’ãçö\ç%çÅ¨?hFqé¢!z®ÚA¶Õlš”p‹YË«/H.Õþéºñ8Äãˆ– žô+S¶y3l!-¿]ãØò†õb¶¼‘]–’+¥¼ít¶-ñèeâÞò@’Yÿ£O÷êx¨QYVE¡v×¾ö£Ù¿ô‡À@áF.z¤;!pÇÓò>p3ØöØ`8BËö¼½i0QŸœüÜ%å·æÎ×\®ÝÑmD±Ê º2ÔƒøÆi —Dº†ðšÈÂtX:ÑdKTð\þ€Ö5»'ã4?dBöFËª¹éÔ{E¹U‡P$³.²…,0NcbI2ºgöÄZ ØtH†åÃøprrÌŒ±4WÅ"¡Ç/æv_ú]qøP4í»ÿ´Eõ=ü¹©lÿþÍ'n|)	 ÚAG6)èŸdØÄýÍ‹)£ÑÉ†é•`+!t¥î-
 cúc¢ú$”,u™Œ™Ñ€Þ³c+Ù¤(K;”#Ò1Ø¡Pšê9ºeŸAGM¿ÍôÒÒêaÔöõjTI6²•ÕkWKâ]qpäŒ@˜ÁË# Þ	.Í\Ã£BÊxÎÀçéÁéÚddCëîŠßíœu¨Õš“F­º/vÍzí¤ñK}C|P&ÖÚ}ªY‡rP°FÓ6œ±¨hS&\ÑDÐöŽœ`*DR‡Ñeýô‘ôƒöXücF™Cïñ×£S6&K¯ãFí#ÚŸTO›Uì¼Û<:'-±ßh<;G¤þùPÝß?­5Ñjò¨)öNë­–8Þ¯Öê­@Gè«\ùëòÛ´Š„ªôÕÐq¥·ÒäG!Z|YÞtK /<P@Ù‹)“‚ù«-qY–!ÎP6Ð®çDa¿M»ÞðéºÏg.>ÃVü<ºô©1|’,P1»#!ªŠã§†déyv[xèbÂ£kà¦·ø¿Êöœn«óeˆ-å>v%ÈóZvÁï0ù<+•ómCn@Äå“™†Rý/ê©ÖN¤y¸·7ríÇq;@p…Iý²VégzÉÓÖD'¹z:+ç×\ÊÑ¥›7lÝ›­ó»ÅDˆ¤t¤Bî&Tˆ·´ü½@wÄØÏÅÏÜéÈ=í^4CªyÐž^c2¯BJ*x)PÐ 8$0<Xe‘jKÆŽ
Ï3<†-9ß,ŒàÈ:ËÁZ¢é}îçÌÀï¶¯Âß1w×ª~Ç.ðcš;/pØÛàh ó’ÏÒz|cq³¸‰çàëÕMgÃ,lš¹Í+æV)ƒ|ôBR–iß= 9%w°\Ç¨8>jxÌ¥ÅÀºy! ¸mËõ¥‚zYæòl2À‹8]ò¾M"j˜ "^^nåQÙGåN›t‡‹GÐxÁYŒ¢[]±­xëñ®.UðXÔÞ(.€8R+Þ)¶Ö_‡»µ+¦Y\·qÅéÚÏA8ÙnvÑ‡,†=2Š-[Wm-hç* ^¸GÐ\Ôg`çò'Þ$\†ÆêÈé8›á¿Ç¹·)ÅŠHîŒÃr/äbRÕžÊÁðßÿð1ßÇÇÈmë.Å£œÌØ§ù•05ñ(ÅÔ˜=(Û9Ë#Ë²Áª€üyzC-“Ïúd´6O}>&	G³a`wÎY}^‰ÿæËíðE_9l›¿Êlíi#š?¾mþ›paêoMÒê [ðÈTÉ]o§ÉAŠä,ˆÖ¸h@‡1·¬6¨MÓ$$ÝÛÊ#=/ê7S!axZ	WbîSj‰¯:­}ýDø¸rbñ´¾G1eSLødêfÒúr¤£µ)f?·îÅ¶¸TNcl@Uí‡0«š½«s?÷³¶÷ƒBŸ¤yž[‚Møæ7ýœdYØ€oÞ—ˆ/H^‚à±7c»¡ÀÑÒcýiÓçÎÉØú!ákŒ¦ƒ þ±0o¥B1P
5™¡sÅÂç¿A¿ö‚E#lJ¦–ÅÂ2	n>•O[Èú
ÕÐ†;Ä+>àÐyA´^­†±¨‚c'šÎzaZg½úéOÀël1A@Á[ÏeŽp¾|¼”)róˆ³ô¡jðèn£©î6dQ‡¸Ì€ß×1ŠÕšˆ²ïGä­¥ªçbo_êˆ€Á!ó ìž÷…ã“aŸî%^««¹ê{vNBª-;–zô	i—d›8ŠsFr¢­Tžº"c…IÏŸ_kñ8.Ú__×‰}d)±ëÌ¾Ñæh±¹Pê¥Ò£˜¶ÌÞ]ES%Ë ¸p¶<sÖ\]!ZÐ÷`z™bµ¨ÊØb0¶9 uÂå"¹²¬ó¼)Ž?»tLœÂ>Æ[¶ÕjÚr!mµ¬t‹/+`‹H’òn/¯@öU'^ÖåüëÿÅ•Ô¦SÀËäTs ÅeØgÐ–ñ>s@™Õ@‡¬FÁ/î´ç’¸uäy‹TïÁ8 íƒ:Á­Â½N€N÷sÌÅˆÉâ9Ãç·iÒÇÏ‹ÙÓÌaÿ‡@)s–¡›c(fß[¦ÍLÌïZ—)Ïn»,íyåÆL4«1¢ÀÆ&eãâ6¾ØäzÄ•hµGÁ
SUØBó¢Ôò—¡§ø¤èþÖ›¬-ˆšÈÁÙ®EÅãêI}ïß7ŽªÍõ¦øTm6÷ZèŠíî¬÷ÈÌ­–e‚Âfý‚8zP'Ä»_êÍj­qòWñBìíQÑj­bí¯hmûKýð´.Zõý:¥»a¡ñ¸yôKc§¾C‚ã†ÐÁ6HÎä:Ž0» É	‘l×ÐÙUmeQ€$ŠB·è$^ª`^†a¦[ À»pdÿá`],h¯ÉaÜSYm¬ÂdCŒ.¨µ±W?ÚkV?4j¢YÝiœ¶Dý Z#Øn éë½vÔdê‰>ãH=©!;¥ 9¿	¨@Y@XU¢­'XÍ<¨Y\·ƒYW]‚YÓx^ØÚÑ!9Üà–­•½LÆC¬N)fßí[øEÆ±&}WÆšA= =²b® •òÐu´â=¨£vâð# \½Öhá@_ˆz³	˜û¡z¸³ÎÀÍÓýú†øt’$(íž­6Kd/Jsú|	ûñ‚Í„.ÐDè‚$¢‹¨÷ù&4ÊÖêHl&ãVræ!ý’„O®TQéxu¨]6úJtÜ Õo‰O?4»ã`9¶ySNœ6÷5PÄ"<à7`_köô -]ÔkG°m/«õ9Ð Øz ÏEcgþùrÉr°	/vNwÐd‰–‚lÑv«ý:¾‹1­(»¥Âls­“£cqrt´ñErv ’’´õòPG@æ« ÈsÑ¤;2æ'ûc¥”"‚Î¬kXÿYa3¶ÆWÎ+ õú	”¢øa
-Êl6Oá>‘C""áÈÝ8TôÝS+ˆÉc5eÄÄæ:Bƒ!Ý1”Z¦KZut\ÇCD|8:mztê$›?S1“”(rßm§2¬…TRJ½tÀˆú‘Ü è‰#”e’¥´3YJjwtÙ&)¡”#:L˜$IÂ6\´QH'@“H”/—ó ×J ~ˆr8aN{„„‰¹"ŽÕ)¨?èq~5=­+V‰'['ý}‚¨X#€š$Àg+ï8ÜvëÍ:Ò¤dB«· ýâªœ•]K»^ãC™–È˜¬,Ã–X™sv€&Œn,ˆJ¢‹	«™ã««’bá$Â-häÛîOÚÃÊ.L¬ƒcc2N>™Dãjï6J01½ùk8ËŸvt¼=Ú'â öˆ5	úå$TL«Îfd­5¢`l²t‹	?#ÿ˜"Ôˆ å­mÇ;nû×­ òEìTµB«pzdÒÜN´ì²jbgŒ?âoõæQy·q¸#v«ûûï«µpbÈ}Àõ†¶G'æSÒÁJìs×šõdZ´RX¾à0–WžÐcN…’QÈ#Z§{{uø]=ü«V¯7¤‡Aî,t ”T\„	{¼Ü)	’s.»ÿ]Ç¤Q½D‹5nIAt Ì3ŒE:KB!&­»±>EejÜ`0än@QÚW²¯QÚWÞ,6„¥Ôxú@Í%«yÕ„a€ï†’3&1´a·×…u8¥ä”Œ‡K½ñ8 •†„K÷ýdÊ‘7'‰L_eæRÀ©yDVô^wó5ÔìJð‹­uL¹{\’Íµ(ÐŠ2a’ìŠ·#f\éäè9Ÿ¢NˆÒ€œ°bV(o0;&pAdƒ6VÊÒ`[Æ‘.TUX
)9.T¡Ræ$¿g2º:+	r‰[`ñMq$[³ä:ÊéÝo¯…Œž
Ë/*IfE¢e(®ÆÉê¼ö€£«ÒLøÊwñdÐóy°@Qd¸ÒžxÑ^(ãÆšêP?Ö_Ó—‰ ¦x›Ä÷3~3¥ñSqBµ…&lk-¼$Mr$žS_xSµ /­Cüa9föi@Ù§€$îÀaME=²jU‰-Z…To’â-®Nx$àÌlêe%¡²[=òÙdfD©øºTžtÎa„.¢cM:ðÐLžáPmËúlÀÒ¾ì_OËèj0AUDˆJ2vƒ•2œÌóÇ­î™^?	ì)s~CJ­>²Š×30ëÅÆÃÀÎé=‚b0ØLÛË'÷ÃN<àÍ||s,Þ¼-¡µ=íèÿ·×èBàÍËB˜T4œ•µ>ä¦·å„`h‰D%ã`©¢ŽKô8•Þ	’b„F@éîøT@èà½¡Ä PAÿiþÄÁÕErHXˆ®aÑ”CzÚL71ŒjR´êY>&
<Ÿ®ï5·£ÝK,CÞ¯`3ìXâçY—NÍËüM°²Íg»h§¸zâ¯1;4uòÚêÆêª¨€äÈ?r0½Ž×"ƒ·í“‘.m¸vô<\NŽu'e_FbfIqØcC¥ÒY›*#æÈŸ“[ªOú$ÂïMsÀ Äé¢Á+.,¼¶þ(ú{Åª“N1Ma8 `ù]°¾úÓOæ-e&_[}üôæí;óÚe¿ÁËéC|ó>ù"~íºñç[;½.¯µ[ošïÖ:¯›É—Ÿ†­S+>¬$ß~·×ñ )tD½Š)nHhÎñNÊy”Œ ª©Œ]]“„Ü?Õ1Iw™ÞlØ±¿Í@1Upc!"á5Ü:ðßuã¦•³÷aCÆNXQ×¹œæ=u­›Ü'O
8J®NF_MÌP¹; £ÉY×°ºZæŸPÛBÝØ´¥R‘÷Þò|ÚR”Î!—û¾˜x?ÈK{I‚šåQ÷¾Õ¡{a`:Þ–Ì
mpÒ]a‡B§iôNâ¿gÏ”×p8º¤O'ª;•c'#È¢Ø==’]ÄPÄ+¼;áw¶½®ù¶<¨—¶Ê Ï‹²=>¢-÷óüÊÒ–››:?4L›7wÆ_r§Hh€¾Ž 2¬a89£ŒÿÇ8!›îS×™~	ËK9Uy+õJ&ôŸæbÐr4â†ßlà‘ÇWhn‹¦Á(¾+á§YYOæò.ñõ»bÌ:°‰
ë%ñ³ºÿ›«TŽr²ÖÀÚèÅ&co‰K&lÂÞ—Üò?™®±u¡ŠX§üµˆfv_¢8ô,ÿqqœ-¸È,œDÜ%Ö¼—Š-Gd_h{,?Êƒ5p';Äƒ“o•{Ýr#6l[±+ß¬ÿœ+êÎ³JPnÕGÊ4ë­£Óf­~QÿË‡*H,õ\ÚR‡j$}L;eNß°çN9?H¨Jë…ÁÙ<€<h\‚.³ÐÁ)PEñõ!Ýøå©É°e7™˜œÛ(B¶ÅUx' Ù*§”õÆ“†ƒ:m-œâHæG¾F©¶MÓ:vŽÊÐ%*;¡
^aØÊ.OŸqJ0u¨WVÀÁRÉAnWH€ù€¬3ºc{¶‚
kDI&Ý+ÀÉÈh­dãwfw¿r˜•.Mæ‚c!£hèª*ÿ:‘Õ?>PÌ-+·'Ž–H9m½˜ÿéO›+óÉ£QßÍ°L/önOæì
EJø`ñ)º‰ÆxSîàcIa”¥[ŠS†:ŸjG/à5‘˜«¾¼cóø ©+Ã^Æ_Ð­KöCmCæ°7¹É‘È˜'7	/Ç¢:+¹ûl2@R­˜r`ÿïTÇä}‡>#Áøz¼ÍÁÎ¶¨õ–Gô´ßB˜2GÿbB ,Rýo.ƒ¼Ä“-è‹~2á_[HS~ÔCqŽÅJPŠæ'ÕúüE<‰`-¶^ZæÈ:ƒ·çs[äƒíØ¶æÌò kÏ.Ø'À?Ü„“Ê;t½VàéãÔ:$ªtïÚ×ƒ¨Â…ËS.]~·)2Ü´³C&ÌS®ZS¶Uá9à–Ä¶·E7¡SÌõß,ùÃ¢ˆ¸i_k¤íwíÉH;b”RäÉp'h7<*;†Õ:‰#R|êJ»l¬Ûiœ™jšúÌÊç7÷¦ÔKñš¤mw§„…Ö¡¼ Pyò) k¤,r¾_ÚJ•Íp“î½[Î0éX
¦±FÕv”Iî;ÛÍ‡t™[<Š3®î4®X@LŽ{a˜€Ssßœ|‘ÇÑ1ÙK@n–qßV¨Ò{nØ%ƒyÈ½“ÚÀY0*“rMÁƒïæ†q‚'¥6kO1Va1s,Ý0À1ÇµPJî^Ã®I^‡ã½›„QŸ´O1<™bnÖ7Ž¿ ñ?ÃxD¹ ¨\ÄúT®ÜG•"þÇÌTaîÜŸ+‚W	à8ÀNöˆ.¤4×€¯‹©e”3C³íÐoÛ÷jÆ³äºnF7f•üàûÂ:‚2 ]AŸP‹	ó6°xQoÃ##úÍ/Ó­èpLæ,ñ§ºÌ ½Ñ$4Eà3fI¼` |Ÿw›Û´Ió™ÌfzÁS”†’—ø$^¿¶Gž–^ˆ›Df¬ ØEçfê„åZ\tÑ!k	ùKNYâF=jäýÆ^8qg®	}4Äè¥…Ü¿°~¡ åR‡C;’fíV+…G(/)ÜHRéFyÕ7*lM4D‘ÞÀíˆ•0I ´I‡Oýez_¥›YWÒŒ—HÆLP&Šè‚ítšUV™«["P¨/DÁ… <„Ò-Óe¨T0ßâQÁ©(­ÜÁ¥×óUÄùO€µdqÍÕà<ÌAÞrdt
"\N*¶ÄþþAÎ¥Ó.Î%{KÃ7Ð/“íàlõÜ_‡¾ÂÔƒpÚ–G¤®²¤>/¬_»žnðpKU±Z‘…(¾ìÂidŸ“Ö)ÙÅVp©¼v]ÒJ¿ø>@ãŒ‡¡ Wø¢à¼Áã’	þ1îçI\Xb<z¬&#Î§éýR.)¸i“O^è†7¹öhjîŒÂ/6~R)M£jäåE®Sé¥rØ¸w˜[®7ÊKë'602·Sh¢ù‘ŽÑß­ð˜Ä¢°ÒlpÂI‚äWJhQ \"§%»Ïz<‘Ý8lQíÔÒsþ t9%:Ù®ð% ð£Ñ4°›¬’uˆõÛ£»5{#³ÅÜ,¡òÚŠqÌ³mØÑ³éæi§ÚSÏ2y}çiö6ûñ$îÂ`n&bW-Ðtÿü²ÊýseD`‡™¹âý SyçEÓ‚“B	wÞ'Ržh9Àá^ÑpI€z³ºJÿÇº¥LAPö[œ[²ž½‡åþMmV³QQ´>¤Ù+opÎA¢·¨p³Ï¿QìõýV4y­Í3jœÏp<)6‡ÊÕZõ$QlË³gÈ>pSÜräòŸùï¹jã·vë~go|t{:íÏþpUïŒûÃd­Q›ÝîÞþùKôÓÎÁÞm5÷ƒø§.:6¥‡SûÝ½YW×êt®~»?½ùùõz*%½‡æ¢X¨„ezjXÞ¶Þ®m’Š"óÝ/¨˜ø2ñër57‡wK[„/@ðQ*ùÓ´)>®gßbL2ÂJà1<¡8Z¢&ë,÷\”f>û4P^2À§ÌKkóa™,ñÇìA*†9^Qç;ßd</¼¤ÆÅ]dÄ­­I—-€'™Wïût-~‡4£[üÞCàM ÞOÐÉîÍ—ìm*µt_ãÏà}³úKý¢U¯6k´t@7®ð›°·¶zOudáâÚÂ,¬ÈmüÝ£zdƒ£â’Gt°9BØ°³¥ñÁÓèMÐÑB~ŸòQäþRnÍ:Zn)ŸÄ7!š(Hð,S~ËÎ—Îâ½¿€ú–Ý¿€köÈ€I·¸àªA%zïÓ>uÀ§Y^Û‘èµÍ-Øè¼I~Ô&çù­|®f#¾Â¡Ëfn‰b~ÕÎ¦Ú<BZß_‹ªAv®ÔöÈ–á‹u/ÑÄôr!+“#Êw.·'!HÌ¨¥&üL{áMŽj†þk¬>ŸýýóùùËÏç•>™˜^Ö3{Á¼Q£éu˜hÓì¡¸¤‡ÂÙß‹ÐA1ÕÁkì€­X¥sc7‡I„¹j:IxÉ¤Ã„#ù$ÑXÓ«{I¨–t\ùœ¼,ô'¿÷õïÜL~ï´oÚ“¢2«0Cy£çš{%«­PÂïv©ßh¬É¿ICAKº…Ý þïXÒétAlösò
‹?¡t{Ô{zá3Î^c‘ãðhòÐ:4Ó|Áj—d¯4XÞªä“QD‚ªŸ¥§«H2Â18iŸ¨,Ì+»T¬Dƒ›«(¹Î‰òŸŒõ¹~[\±R8Y·À“Qg©›&zZ,œ`)yQ-'M¥¤*f®gñ£wxøU©ú‚ÅoY²˜ wŸ;è›Ù]¸ØŸ;·l]Uþ
'=µÑí@û‹±@³d`—úh€dÉëWdä:£ý)½[Ò]òJ-¬e(´¢‰S—ï\ç++˜§2dÙ^²MŽAÕˆ0/
¥|<‰ã+ €0íÑ=Ž£1%ï)®0c 	œŠbEö	tâ kï^Þ0–ÐÑˆJÅm Ú4ÉÎ‰ß)W:Æ@s›|,mkCîùÊ÷_þªtÛÖm0a—••-ì©x€iŠM,‚>ô6uEœFYã™‘:•N-ž—)7¥,U5â,Lqæ4 üº))éñãfª•}°ø»|aÄ†l=Y61‰€øn›æ¥‡Äïê²è–wy®‚É)ë?ÅRÞQ
‘r¡IÒÄr&f<¸õ¹Gºxe©CodcO`YÜ±mýëË"jÜ>—G9§þ˜ s½½æNŒoœ1Ú`Ni¥aP4•Ó}®Íž?X+Šp –U6¼¢Å©ø[6’áÛ7›ÅVUÂeì´ñª,Ü&£².2Ã‡Œ¼GíÎË
0\ÒÂ)£&DáÄç´gÛÔªef[e%iæaƒ»$'PþJ*à¸-j¬iz0sã :Ú_¦SÇOB»8 •Ë
¦!&M^\¨·.e—Ä$*³&+ÝÒ|e±&Ò^xE¥à¡?ÌØŸnIXÙë£)\—¦ÊÁ
åD^€-L™£n¯¤¸‡ø.Ñ=•/&Ã,ûà1JÅ³)ZE}8MBösøU's‘[ëRQ¸Ü‘©^C£«àºH¢ë2]2ÉB£/¿ PÖ`˜ë£½š•%Û#²	§Dx¢7ŒŽ×‰My²LyËÌIT±¬Y¢Àõ‹°],|{@´Õò“±$k‰„©#W®›)Ó-ï@*i'*&í¶y‘‰ó‘›Ûòå†X·Ffò
ï„åÞŒí§CEì82yÑH Xã—Í)'fY$.¼êlÁÚÉ+–E‡}#ŠÂC`U0ñêgÓj]/ñ–Ý5ÆÏ‡tÚXr-/•ùèÚ\°»¾‰§$kÖÓc•³Õ35ä ‚(RrH”D"Š…+ZœuøaJ½nåej#¾¤ªÂ¨líÝôñW[¸³jª<Ìs¥Ê8YÙþ°ZqLÛÝIœ(9å7%×DÚCÎ]T’Fu¼­€d*R¼‘htÔŒ2¯Ä7³1þgÌ˜6±ë#©5W4lÂ(ÂPR +úÖæý£é£}#Z‹ðib¼$]šCLŠhg™¹f®çæRv5–¼¸zŸJ.íÐ²Ü\pD —Ð×„·~’c©Àß`«>síàù1ÑüSan}Ž§¯aˆÏÎm)–p­ZÑoÈ„¿Ýt_‡æ–›83T¥ qÅê&üçî ðÕ«-ÓœŽlˆY
Yƒmë ŠUÃ;‚=ÕT×ÆÒ66ÅÄƒüC›kÎ¦§çf"d¢óœq~ -ÜYü&ƒüÙyÀžèì„Èzƒ{iR»íœ¥7`Ê0%Û’‘Á@¸,Î­8@ìs×Ìä–ÏžíD&Í<Öa/Ø'ÓÇ73æ€AØ_p¹ˆ·ýÆ+O0]1†+HŠQ|ŠÈ×‡86 –5ˆÉv@*ª²M–¡t~çÜêßjYâÕnÍÆÈ=fY¢‹9¶%ßo£"²ð˜ ­ñØfîqS‘3HØ;ì˜ÍôçfØfÏ*<§t¿ü-uW8À“{ŸúÜâ¾Ù^ZÝ·Â>.ô‡`M#a€9f4
ˆžÍŠ²GWmÊª|cÛ„U%A&’?I¼gwF¯ffœ6–LÍOŽeÓ-fI¦ò/ËX…·ÅÌ™+µž˜Òí	Û8î›áû• ~Ê4`¶E#!.éõSWaœmªúÔÈ^üVÅY¯7»ûÆÛ¶ø)³=¥Üâd–¡9R:¿ÇtìÜflªÃ$æÌ4žÚC\Ç¶ZK™°-ÚL{œ¢n‡ˆÄ}å%" Öšœ¦FàçcÑ €C¼=ÓÙALK%?p¯)]¿ˆƒø·h0hWÞ¢GÄ§hÔ‹ïqx"ÖVàœàÅ»7›âË»7EAYë>…Ñ´òöõ‚×ïDáã‡“ƒý‡¸Û»7qQÔ®ád+këÐ þO´ÚWíI$«äü”!Â¤ý ÐÛ-z hÐœ’»¸Rñè0×Óá@ÃDC)ålaÕxNK†“(P (`~QgŸòC8åÎäMçýV.îo{—;Ïƒöt:)äåÉž÷["iš+f`º5É´Œ’¦¦‰M[…’Ë=UQU,Ò\’n÷iªìÓ(J—»d–Õm®A4ÙÀÜ’)°ÒtSå³Éa>›\ÉAn;‡M.Ëí;ÿdÚâe™C®îJ‰ÅLÊüiX¨fïx$[ ÉLÃNÑVÍ@JÜ@¦2^/ÍãalFu ¬I¼qÌŸˆvžh¬íéåàâÓQÏˆNÒŽ—nß}X3š/Tì.ÒèæÞS–œ±=‰ýDÿ/‹èOÀœGÐ?=¹	:žÔõ©W¬Æ	Y36Ô7µîçšàÿ“™uw6œ(|0éI‡€7¢7›è0=„æ+F.‚bU£TµUTRÝdRLn
®N§"Þš+1Oñb€çW¯ÔÔ>Õ¤8Þç(Ý„$J]*-³AÊ»¬pUê"‚Aí:Dw²›Ç «d½ è”Îä•:ÑZ•ÄhâÞpN4ê˜%\6“åw_OŠ¯&ÅKû6‰~§•eJÑÈŠ'3|Þùæ²Â¢l´„•—"`dòP×†âe…ô‡xËâ¨§a2-½«í³¦=ß‡á•h¢/ü¨ª&´¹{d´ƒ&Tá´M>ƒ{í^,ð|hÅ†î¾=Ä‡ƒ(´*€¬Öî´oÐ´!JðÍq8‡7â¸=‡Ù[=5è;à6$ŽÃÑ}HŽŠ{§ÍêA]T[ÕqP=l´¨BKœÔ÷ëMQÝ?>ýX=¡QÔßïW?ŠZýc½I]7êPècþ/ÞW?¶ŽðåÇOõ“FõTì5ë‡{¢U¯îQüå?Ÿ¶ìÖ ‡÷ÕÃ½#QÝƒn'õ|{rt¸÷ñh_´NMq\?©Ó€ÿ
CÛ«6¡8“ÖNª““úñéá^ŽÕ-þµð­Ó¸¤&W?*Ë;'õ\² á>s,‡œ{°¹iaØ\“"qPãs8Ÿ?`áùREô¥uO°@5˜aƒé‘òí7”ŽG¦u6ËC2#§ŒoÊÉÊAû0Loc¬Sr›wï&œ{	«>§…@!©¨Ú’7¡âÜ
Ð5©¼¶€mD åàœî™‚`´À<*äu=~’Mzx/\Æï€‡‹vm ´)G)–	äòœå¾”å·rÔË£BY¥å ,£¢Ò7E·àÉõq§=Ð¦“8‚•¥YgýŽªO.²–9ŠúlçB…ÔUwr¦kM¨ÃÈŠÜœ®§!k© !ºî"P6,:ŸðÀØÕ¼)è§os¨jù¿Ð"<ìePÞÊ²]ShÅ·LàÈDç‚^1Ì	@aOtî)ì¢
¥\–Dö0Å¶õaƒÂÙ_E£°'`½¢*-ZNö+Iä“×Vj¡Ëå²h$ÉŒŠˆW"¹¦1Eôš’p®¢/Bºr@•	[…ªùž+’™ER D`êgÍ}X‰¤oLÂô¶<76´ ¼UŽ<<@k{žñ·^zû%Ô§¿ÖºIÿCF›©"èÙ[ràúV9µÇÉuŒŠåî ²¹.*P#©`,˜:RÀ^Dñ¨_IßbòoŒ0*ÝZta­¶d£>ÈÝÈx õöDÒ‚¯8?2`Ãië5_æ)>ëUÊtfhÃÍÁ”kûG§;»ûÕfý¢¹~ñþ´öQ¦&À‚ãYŽ/`@ß·“TÙãÓ÷ûÚÅis¿ôã1„@¯ ´‡1ÝG>€þsfêì=†<CyÁŒ-‹æÆÃ1&·#"AAË‘îÂ‡vëj‹e“YŸ×úÿCp­[zÝùú÷ôÆö¢'ý4ä9òÔÙ‹8æÄxÕ~(Ú–<Xl'š­õT^+3¾î]S‰çA>”¾ I^‡tˆWIÀÍ¶@F(È­ø>¼‘ØŸQ‰C›MØ¢äòêHDÏ…¼äá¸5U	Ôu–ÀFëHF¾+ZÆñ›Æ—µA¹Œ}8Ûh¤`ÍVèÒÌïâùƒ^9<Ø#˜Ó/ÓË4g¨£;KŽÙäêÎAã38µDý/ÇGÍ“Ï£²UìkC`@¢``Ç‚ª³²á\”±8ÿ<jñ EcËš!c°¼­§þqd=_ˆ‡1ãNó”›Ûü;¬èÝÎ³]€'­ªl)X„Ùôê''æ™	%1æ(VÛR`Ø°˜œ"Ä›¥ ª‹'iž‚€ØOƒ$¸ÒîÒÕÍ¥›Tƒ‚éðPô|¼KœÜM[xë;¢zâ¯Ž…ŠsQKã®Y”ÙÐÆ½Y r9B–ú¼;<õ!§9åäFDçÐò{
[M\ÃV¤\qv u£aIxƒ{Îµ­Voî`µ¯‡†)’ùss%õE
#ðÉfÎÔà$ž.Ò	f5àüPˆÌàÐ0e
NN9àð€–nãÁlšPÀj
–Ø¶Ð&ØÓsÄ ‹¨G|žã¶\ËÉ´³0VnDôÔ‘ä<ó-så+T¢2Œúh÷’_¬lIA]åq ŽŸü—2µWæ¯œZÛ¿µ¨·ï–ÈÕÅAc¯YÅäc­z­Y?ÁdWÈÇ=^Áþ´,ûfuÍ`þtÔž˜?ÁÜ~yï×Âñ#ïmYQ¯`DxzX3êu– có»†M9	<[D!ûHÉƒì±‘÷iÔs5‹zÖ@L€ dÍ;â‰ùØÏ/‡XzÀUE/sÐcG’ODbÇÈ	*‰ã’ùBÅ bJL;*é¶1ùÙ`@âeíÆ\º”Öê?þõÿðÓâuCJ»Ý9 qÔ9cÎá¬¦‚·÷Ñ@4´êlŒVM‹^ïÄ]û-ëôÑ»wBÑ0­O:íb3$[e’Í0
ª´A,+žÄíqãÒ³Ë’n¤7¹oÎ€H?ctâY¹´iÁ`XZëÓÃX‚ƒ‡ô,ä	rùbÐ‹»½ºEÒ¥SÈ íHfiù’¿ñ—üŽdqMr\íº}zJe!W$°×&±&§g]aÃ8CÀÏ3=Îs÷ÆmJÝm©²ÂtK÷Hù¤M	dÍ‘L7Šej×˜¨´Ç×—‰åæ4G·Ë¹ä·ÄY¾¢;YtáLlôÌõ+_ê¬«©/BÿÞ'ym@b€Ó—¡éÖ¾ÄÁôâ@óTÎ¨æyFGtë¹¼££wÅÜ¾8²úŽ¨c¯=ï‰›:‹H‰bÂ@Û-Úw»ncÌ2CýÍt³†ˆ*¬$äÉÜ@¯^™’æ–JmYò†Â-i²á6F¤Q­$›ÆŠ¶Oåù`×¼"3Œ_:ð\:Ô¹‹<Ø¹s/iûS,À×tduá–ô1…iIQ’µ&áY¯ë< Û4éûÒ{›Rë`Ü¨)ÙÊŠdÖ1$)q6’õ^S0{H‹±fÊ¤²£ˆÅtyn5å;ÛUÂ­;€’6ôšƒ¢¨‚¡l0P)gf¼P©k—Å=z‚HSàkŠžXE–b#+æ³Q#Gþ¥F€46eêçÀßEs,K‘ÓÏwöcJûí¤1TMOa(c1z¦QOm›(dÙ„8Áöµp!'ë3ìK}5òÄ*£àËEói×Œ%W'Nluÿúähò]	y8Î€|„ñÒ|É’ |ÞßÔšÛ¶Ê²G:`Ì	5Vd°µ.ÐRÎ]œ ÿÒ0l£CÝÇrZÕ^tub4†Á}9‡äYQm¥'~oªÊ°ò÷/Sp^™×¯aÅjj˜+¦=ºèÆ“ñ,éÎíÉÅuGÝ‹þÅ€s½‚°€Û/7ì^wAÖÁL~(ü`³mŒ81ê•)p|Ü!ðŠ*‡®üjíV	PtÂ¸˜#ÎcV”LçCúc³|"cÐ—”Ñü%1˜Ä[‚J@–ÀDq±7AŸ ì:˜so†·ÉSk h‰†¥©Ã?¤–H8ë@Ä~°Ô›JìŒŠ08Z8N‚´ÖƒŽÆaY/1©ÿG"û‰ì¿¡´´@¾á{ÜÂÑ’j›nXë“‰6‘„€”6rœì™wIG^Ybœ›½ÇlkW0.¬~1Ã'¤%Cr cIq/ÚSS?üµ·ëåKr–¢û•â±ªæÑL<ûö˜AºìâÕ]ÉcR·Åà^„5¦=O°¾ÀØ"5jPÏcÜG(Ã}’{qÎKùHGX	ÛS…åäHzÅglÃ-fM#™%ã¨Å³¤Ñ;FEæ-o+GEâï@aqåŠŸ{k«¥ùÅY»üÛjùçó‡·¥ŸçÏ+6Ê§ÄaOÔÔ(ºµXDÛÐS€§(’‡‘’Ç¶ðŠ;@ÂÙó^î°ôc½Å¸ºÐÊ4iÝDã1~Ê–û²ë“#[kwÆˆI5ÎÉ°’‡×$
‹4k‰+Eå”5ÙÅz‘<µì8Þ’Ÿð&‹<…ávAÁü0„9w×17…£"›ŠÞ¤l©ÞµA4Â„e4,S² IYy–õL‹æ8ióiƒC8Ùä4ÞwQÂFet¹«”‘èÚÂbÂ£b #è-ò&ì‘²k§ ß
À[uœ kZæmÍÈP!‚0‰PQl‹5+»éUî<R¹“]™xR¬ŠÛÐ‘;èm™ÞÙ’	}“»’.9Dð<ù‰º3Æ¼ž‡ƒ‡KPJùÓøý]:i®56Èx-„ü†±ÇÝ†Nýn?0t	ÌÃ¼(æn?´.MB=-§KšËM`B4Ù’cîpˆ¹Ú%Lå`¡Ê>ì¡†Áÿ¤÷³ƒ8Q<ìž«Í¥[£
LL¶¨t Éº¿-'í;BIPh“AmK®K–ðuC!ÿ€dàÝHÏÖ¡¸º¬äŸ6çO”ÃÀâáê¯PJªñœAEÔXÀ\ÃŠ5Ãª¸ª¶/!œÌæ×¡,x‰œÉ5Jt½žwS\Ú}•šhªÍ
÷gx×3êNÃ’¸ùDX“*„»ÇÆœªu#2%âŒ¡®,t‹)£å+DÄW…"Æ ÖB£Ó•î¢G£Í±ƒNÖk_åùƒŸ»uëLP2¨O5ßœÎãœþ-ç®¨sM kƒûiÛÌÕÆÂkf×‚žx/â¸4™ðâ:ò4\\³‘™ûTÙ¸¸´bµ6Ýmée¾ðÓ¶¬¤0•`Ç15±;.Ò ›ý0H³œWpÞE#	#5BDÜÿbq›
D\:¢‚¢a‡äÁ¬eÐì-šÔ}uÊö"Jä=µ´Úm'ïgÑ`ºÃi]\ÛÓŒjZ ÌŽú¾åø@FK‘A<ë	`GEE\ŽÆCA)‰.U’zºo¥ña`sL¬M…&P¾Þ^ŠÂ4ùR¤Üæòþ#zPü»ëpDù„+ F*(r%Ñ”+TxwCÒ¿á²žž6¸µ$[¸ÇPôáMBfì(ê#——ˆ\gBÑWæFBØ¢ü,b‹VÉ–w0Ý/“:‡ÇYËÁ	–*3½DWa÷¾;/8d	‡©§*€”uËÞÃ…6ñt•Âß?ûü¹r^è×ïÏ‹ÉÀ­•$ ËetVõÅñ,5U‘6]FqyÖ‰ãé9ÆõBcL,cZÝ–ÈƒA^n1ñê»ÁOPÌîpNqÁ¸ø”êšÂÐÀÙüSv ³ŽÇ @!üB*MÚQWc bµ}ñËLó*½£¤ÆqÙ\ö[&¥Šº‘V+l‘ñÀ†|B4å7É\LŽÅ¾1Zm¯›"‘]ú5Œz½AxñEn21ýñïÉ›Ð,êbJþxæpù—/+¤Ž»@ƒú²!½ †›èM¾”*ˆ–T^¾Ìø”Lg½(ÎþFáônÃì/å²úŽ±‚õþ<MMl¢±ÌÕ›ŒU~¼¹…ˆCîÀÀ.QQXVV¬ð””ùqçDÊ•]>¨”Ýp|[zeâBZ
Ê›¾’Dd‡6q;Jm>ÙéíøðÊæ«Jö‡¬úÖ…áûôu!¯³àÊÔfýo€ëÏäùÓ×ü…ÌþwXËâÈCß¸GvçÑÛDÿÎ^{ÃÉEÚ°—«Dt	ä¯ˆÞj˜.S‹ ;ã/$5XÜ@ÚÓ
ßøåVÜÿR’²Œ«©5‹£Zr;Éÿj§µ®{)M·tµ/o5NY°°²åÈ;RÀ@2Uª=ùRŸAA¾3ÏÆÃôUÛ×á¡?–&6.¹-ûl¯DæèO ÿD,e¨~ªÊOÁ×¬«¾ì¥7ê>qy=¥ß+íÍ¦É#fÊ·þÐòÖÞºIçáÃ-UBYÿ®}áqpk]ì¢½¥^Èyðüá&u›„EN¸*3W¢ Ÿ^å7¼™‡”YžKú1Ó·­›»
òÎ…V!°3—ÒmÙgU˜ÝîuŠëaØ÷²W{]v»èw¡òwÓìçJá¬Zþ[»ü[ù°Ñ¯Š›(’¾{S*¯ŠÏ+Î3ÁV¬ˆ6NLº×ÙIA;3¼s…¼§,àÊêgëç%À_êÔ÷¡]ñŠÌÈÍ×íÉ¸Àmú99.Œ7T%Aÿ<ˆ«hŠ	Þ)?P´êŠgÓúh€·7Cr³·ï~c˜2\û)%ß†x»šQhó¬|?}ÃnÐÜÐRÝZMlZÄž¢É0¯b'ÔPk Û4Ê~…i@=&oºÖ¦WbÑ®ä?IÆ}A×ÁµŒ²”`Â_x ŽÏ«v3îlœw£`˜„ZõøÄl©qÈíËï¦\,ujO†b6¦KN²c ±CòÄ_2°²5“ppU&s	Í†IÅGm´®HIõgºu‘rV>¨8
&eòÅ`zŽ
€ÒQ¢L)jºnÉÕH‰yÑõÛÏªc9 àfu0Ø‘#&¢¤ »”wûhË_œæmœ5>¢h¤çb?ncèîçº2ÝÝÍz‰ÀlºÃˆmí)ú¶‚šu{^8ng1Éì™²Aç®qÁ`½î8)´ÔN¥n\<ÞÂž‰Ûœ¶_)·Ç9Ø:	áÅxHÒÆcÄÎp”\QÌRË(ò¨¢¦uÑ"£)æ'³ñã¡˜üç¸£a/cÛKÉ¯œ .øM+âSŒgþ¹°ú «:Ž&þwÔ(î%ÚNe k•ÊË$z-xôr5 E32o2ÆÐÂ£ÖCw˜±02(íÈ‘¡€Î$%‘“±´P3RLwÊóæ¤å¢woÆ@%ªãñ¹Ø"R†ž)æ)5¤öÕltÿüü»žä¹º²"-µÆëðh§~Q?ü…93T rQPkÖ’v$ÄHµøÿ   ÿÿ µ›]}