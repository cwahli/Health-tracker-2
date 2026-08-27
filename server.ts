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
          ingredientsList: l.ingredients.length > 0 ? l.ingredients.join(', ') : null,
          boundingBox2D: (visionScoutItems[l.scoutIndex] || {}).boundingBox2D || null,
          sourceImageIndex: (visionScoutItems[l.scoutIndex] || {}).sourceImageIndex ?? 0,
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
          return `- "${item.originalName}" (${item.estimatedWeightGrams}g):\n` +
            `  Calories: ${Math.round(n.calories || 0)} kcal\n` +
            `  Protein: ${n.protein || 0}g\n` +
            `  Fat: ${n.totalFat || 0}g (Saturated: ${n.saturatedFat || 0}g)\n` +
            `  Carbs: ${n.carbohydrates || 0}g (Sugar: ${n.sugar || 0}g, Added Sugar: ${n.addedSugar || 0}g)\n` +
            `  Sodium: ${n.sodium || 0}mg\n`;
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
        
        // Critical Guard: Only synchronize narrative text for single-item meals to prevent grand total overwriting multi-item stats
        if (parsedData.nutrients && rawFoodData.itemsBreakdown && rawFoodData.itemsBreakdown.length === 1 && (userSelectedMode === 'review' || userSelectedMode === 'edit' || !userSelectedMode)) {
          if (rawParsed && rawParsed.message) {
            rawParsed.message = synchronizeNarrativeText(
              rawParsed.message,
              nutrients.calories,
              nutrients.protein,
              nutrients.totalFat,
              nutrients.saturatedFat,
              nutrients.sodium,
              nutrients.carbohydrates
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
          let finalCanonicalDbName = item.canonicalDbName || preMatch?.primaryBaseMatchName || preMatch?.canonicalDbName || item.name;

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
            visualIngredients: item.visualIngredients || rawItem.visualIngredients || preMatch?.visualIngredients || null,
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
            ingredientsList: preMatch?.ingredientsList || item.ingredientsList || rawItem.ingredientsList || null,
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

          if (parsedData.message) {
            parsedData.message = synchronizeNarrativeText(parsedData.message, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
          }
          if (rawParsed && rawParsed.message) {
            rawParsed.message = synchronizeNarrativeText(rawParsed.message, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
          }
          if (parsedData.benefits) {
            parsedData.benefits = synchronizeNarrativeText(parsedData.benefits, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
          }
          if (parsedData.risks) {
            parsedData.risks = synchronizeNarrativeText(parsedData.risks, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
          }
          if (parsedData.healthImpact) {
            parsedData.healthImpact = synchronizeNarrativeText(parsedData.healthImpact, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
          }
          if (parsedData.recommendation) {
            parsedData.recommendation = synchronizeNarrativeText(parsedData.recommendation, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
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
          const receiptHasBackfilledFields = Array.isArray((it.primaryBase100g as any)?._estimatedFields) && (it.primaryBaxœì½ÛrW–(ø®¯ØF¸€/²\Ut«	IlóÖe—[æ¡@È"‰ÊLˆ¢eNœ§~ˆç}¾b~`>¥¿`>aÖeßs'J²ÝgN+ºÚDæÎ}]{Ý/E¼½µ5Q!¢ô¶Ý½Œ‹2™Ge<~‘Ä³qÑÅé¤œŠ¿Š­o	ýo”¥E)òx'‹²uÊä]¼?dË|‹§êÕ«¨x®¯’ÙLõ(ž‰Æ,Æ³ËE”—I4kˆ]ÑJÊîX}ýË/~ô£];êYÍ’òvo®—ežÄiYìŠ³x”åã.àA:éˆt9Æù_aFÄ(šeÐËù^4ëˆEž•q’ÒƒÓŽ(³2š½ˆJúÿíˆ"*—9í†|:ˆJ~‘“åœGè:fÓÛ1¶UýçÃBÜU§Ÿ{Ù|‘IŸñJÄS«‘­^žG·Ý¤ ÿâÎŒðƒ××øƒpžèz*vÚ°uNW‹ém‘À²_dùüdø÷g]ûxúô©hìž¼>Þ¿<ê÷~›?[ÃìföË"»Ž)¢Y4þeÃfíŸ†›I[¶´Õ8OØÝI’F³ãh®Nñ:¾½ó¿Rù¢ÑhÃÁZ#E‹ÅìV¢}²EË™Ïºƒt¼¯âùq2™–/Ý«@Ém9Ê²kX%œµó8÷ãárr˜M‚=W®†ÛêƒóK{m»5‹U³Qh:^—òñîŠ&˜ö²e
`¾þž…ÁoWlùÝÚ°¶»+3šFIª7AÿÂ•¦ËÙÌo^Ü¦å4.“Ñó¨ tFŸUžúŸ%Å~RLûáíz¿ûi4¤ÕÊã´Ý/ï¬_~²þÜÜL´A`-Ê|	;4Ë šÉŽ6Ü6Fo°ûyŽ0ÈA¼K"±Xæ±˜Æ³EœWpÌgççÔßS\#u­A÷çCå ü¸\ÇãïâÛbÆi|#à/‰(ÿŠÇ<£&ª7lŠÂaÁôvŠ–5~;€™«•ˆÓQ2äV,g8mÂ©ýŠ:À	-÷ 65¨ü÷ÁØîY[+ö^T6‹€®úøc1N•NX¯ï\ô™\‰V`ó»¸õI(*-p4imóXh¬õöÍ!­ù }åI”–Bv#ÆÜ²â*Ëà<EãËc¸BçI9‹ï»Ðïß—œ…>Hq•gs‘g7°ápzâË¡y§jKºêÃ»·¼Ý­¿ø»½á¹z ïöfïâ<OÆñº!;yè6ðg÷lÂd$V}PÝ6b=*@ùÀÍ¬ß¢exÈÚ¸ØEÇÛíù²ŒS&“4Ëã±¿!AÔˆÐÐzpFž§÷~/ñRøsÀ?÷v 0Y¸Fb÷vb#¿pGÇÑýÐÉ‡?gyÿfZ¸ÕAT@OàÆÜäI‰èè\‰˜nÁdå %q,ÆÙ	‡?§Á¸;éèÖ†÷RQB:åoÝòLäûSï­ÚpùÚÛ1ä¬Í”øüv|¥ŸÊýýÖŸ¥µzª°‹þ¾ôŠv‚„Y6ÿ-Ç´ölÀ1€^àŽÏ“x“ÑT´ß¼>><Ùû®¿/ôÖ‹,Ý¶+G7N®®øTXî4*ZMµ—Mdð¶€›;ŠÊi7-ÅnÈ‹´¡6;@ÿq˜ÓúAäy¬ãTŽpZÓ¿¾	5ƒØ§¶z$ÙÓ†u²5cÒ¥©NõHðý†„Ž*ÝF™%)²Â;ÃNù˜U²çÈ–Š?>o_í'Àà‚
Õ‡Mœÿã¿ÿO ,µÜ}%~÷WßG³–:Ô;÷°XÍIÓªXªÀ+d­šs~þSúÖÁÎ"ž1­YÁã_Åvw™L†œ¿Š­îöõ[žû¶’>ZMvðÄ`’IŽü
‘¯Gd',W¡Øx× FpH˜A,c#&Õ°}¨ªC%`/c³úåïrÜ‰ÿø÷ÿA;Î?WP'”²ñd—g5X7ÎqX«Iè¼¿r[XñhRº½›|…gúÕWþ©V«“­¾qN·úÚœ0¾£3¶&=>Æ£ýc+ÓëSõò´ò
üA„L¯%Hü±S# ‘?†±œ°?:xØkÂ{©ÚÈõ±õ€‰S’Žòx˜Vü	ÞÀ’NlR?5¸{ð^Œ—(gZÆð_«³"†uQoýwÐ°õA”·F›Lÿš ¹”ÑŒÕe‡gå4[Â¼v](¹³ Î`Æûß÷Ï^¿Ç¯ÏÏúÇçñâào¢Õ[NÄÎÖÎ7í]q>U‡jY¶ ¦m‰ä+A
s“ò>IMØƒÜ$pñ’t/`U¸ì<[¦cÒÄÝL [S åpk`›@0Îˆ LËš—q>‡›øH\%yQn,¢Âàí"Ê`g£22Ç[øÀ;11šÁöoA ¼éŠb‘Âu+¢«Æ¾Èò˜>°;—Kß ¥7hœà±½¥õV#oA’ça"Ú(HJè=—E\é{‘Çñ{\v^Òtüî
qŠx} Ï {O£¨‚Tq›Ž¦y–&?+ÜÕƒ0½¢o%Çä™a›ž=Ó·õÛP'§µ](ÆJõpü^2¬Á4ó¥ºp.²Õ‰a|ƒý8<šêËÇVwÌþ†»b6Nubãgg%\³·6³g6Øe÷‚ˆýÿý¿þÏ/ÏzÇû5±âüäþ?âw)ùø]¶§ùü‚(ÜÚÕú÷«p¼µrg!Ou¹¸ç»8^¸Ë.bèv‰Éëe´:‡AÞ, ´áŠÊ9¢‘¼WËÙË˜°Ý‘×ö p¿áfA)4À§Q!šK6éfBfª‚åpYZwP,Ìå†zP3žÀYÄË×=8žó>ðÛÿÖ?;ÙØ?ìõO{Ç{?ŠÁÇ{¯ÎNŽþ­w~pr,z{g'ƒèŠãÞÙ<ü¾Ø¶¸?ØµûÜþ„hÆK}Æ»âØwë†ÇÖ½/ã÷%­åäY¼ÄIÌcÄÀ@e ½ õ°1³D¯	aœ9Hh	ƒk-ô$H{ f”ö­çøeñööE3|Ù,—âð“ñø(ÇdOhÂ<’ø¦‰LU¸A<NJzý…ÿ¾í2u8³<º9¥ItçqQ ¬0Å~€CkÿŽÕöÃîU{ëht)ÿ:íhÜÕÎUÑ÷Â ZeŒµofV•Á¿­]ëU–Ñ×þbÃ­ºÃ8¯TÎûö„×Û§ÊgŸqÇÜ=«]]ž×ë-Z>p]ôÍo¿¨)ÜÛrz0_D£Š-¸6ûƒ.Ñþôw8¾¸GàÇQHñ>Gç“‡¨óñ¯¶ÞŠZ_ùÐ¥µBýe4Zµö@ó_ùtmÊ¾”~‹5çÿ[\Bk¸Õ—¯¦ášKù/›Ëˆ­¼dµM×= ßúR©¿¤ÎÈ¬ÇÕó(Ó™ø!Ê‘k¼‡‡GÀ4‚PÆ 4eÂã[j|ùÁfxHíÓ=`ýóCœà0?ÇyÖeýu’Ïdcˆg dŽâ®­ã	òQO“,N ÅòÄuð•–Æ/¿ëÿ8p.Ôßøì:µÜqîBðþT¼±{NÉ¶îmƒm¼aµGÍ‹]f'0Oì†ÆD»å_·ŒÑÕqPŽ>»¢¡½x| 0Ú÷ÍÊ.Ô*µò˜æ~Z \™’ŒÇg7Ñ-Èìq ,Õv†Á÷¶—,®x—K|›NràK’†ªÍ£àM«òÁ®·DmS‡¹µZÙ«xZ€Ýy´hµØUtÓOÿê Ê,.qƒ2‡>ª×{˜ÝÄøÞøëŒ¢4#½ðþÐS„J'Óé«½¨ˆ[åxR¢')%ÉAûp«On^MÇŸËa&ƒÇßî‚p’—ÅI9E{Š…ãKÀ¥×ªa.ù»:ŸÒ¦›UqÙåã>Ð§·óÍÅ·
ò¶>9L
28X‹}ŸI·µjŸ°¬7Î$É:kòÓ.äÈÐ‡KªœkpÏ¶ª®_Uès}uü°–â¸ðhd¡þÓˆÏŠDš°ä¬x¤ÁcÔ-â(Mÿuç·ü@úµ»WÉäùÖó,›ÅQZ+'y;T³øƒ¿ÅÝp×há*2ì‹h9B!œƒ¨³‡?'³èg|€;Næ´}h}†úI±#zã1·åÜéT9Ý¼Oð/„•õÈª1n³4’‚~©ðo‰þÈ£w·øÇu\Ž¦Ë}¶DGt×xˆ)¨)KÝaãâÛšS; ww'Œ
Ì¼ßy>¹÷Zã?&Ÿâµn¸¹ó¸¿p(î´›¤£Ùr£GÐû¶OÑ]—6‰uSHm.WÊZ©Ü!³´ðSäš€?è<JúŸŸm§îÙ#WSÍnpGpñä^EÀ½øßÂv¼ŠÒñŒ(ØÐ~4¢Ö„=6‹å¯\SÍ=7	`ðv&bƒç=Ó	u+¿\ÕùC»] QÖÏ—_Û1žÄÅCûÆñUmÏøR%ÐÑûº•ïÊ|W!Úþ]•{-\¤„!ÒoEëËÎgÏ’´…ˆ }×~ë?þ”sËæÞZº~ïi
wÖwmkð
Ã…ëSvNÔÒðÿ“«Û~&“&øÝa6¾íFäüzBÑ3xc†dw%ë«y4‰_ç³¶<¬íP½‡õ­lP<ë¾Ùº¸tÂ­ÐëP}Å¨j#04¾A#ñ7__Ò›K™¢K ©t„lîÂ`pä{Öh™)õÈžàXƒàUd+°D^€G¬gL?g6ŒZ@ô¬ÒÐz¹‹`˜aaFª2>Î\¥EÝ™î<Î'ÖZîz:–zÈŒÓvOÒlçCØñ•úíÚ;Ìôb´Ìs K<O`'FäÙ#=jëÇdFkh¨ÑP.*Õ+1ñ@¾¤j¤G(%µWñÁ)v4(ÐRè\*Ïôô
üi¦c¨™½¾z_ˆõÆ§Í3ƒƒly0~¿+<Äj(e“úCÛ§âalûŒª§Qy‹SyhÁßgbú×Ÿ"‹¯gñUœŸgøûE–[ÃÞ²d/‡÷Ý^ø©bÛ=*‡`4ÔÒ
ý^à(CKŸñµ~*Öè¥†*û=Ñíviþ¾[¿F!G¯6Ó¡µ-´zâ[Âsµ4$f+Cx½ÞÕÓv½XêÌ¹/¶c‡mI¦æ |tÿ^d©ãM?Z½ìë†£Q>ƒQŽÎ„‹öÀ Úª1ÖþÍ»³lÁÛ1´u,nAâ'%²òy|…–>bï‹Z÷­Ý·ìë×êI±­ô²ßÁiyJÚ½]²6óßxj73Dh·Š¢œþÉ^4›™Ã¿sV_ ®<@ÏþØæÇ¥StÏ¬ËP‚ìmŸ:ÅÌ3Ø&†ÏÍ,£´D'8F”¨ôZ¦hZ ‡uÏ‹fI^üEù*µÃFˆaXÒêO§›Ç‹Y4Š[›?ÿøSñUkòËáþ—ìç_fÃâ—ëÉ/Eœ¿C‰æ—Åþ—Ä@$~)f@+øÿíg›“¤#šM»òdÞòñ¡\-0j«òÒx/³ìz¹¸=­áÑ -JhSñÖäIü ‡nØ®žQ1ì®õ®!Z¤G©ŒÛ€ÞtbW(ìÇãƒùéXt‘HxšfX´Ü‘:âƒº°3<¶**(kÛ“>hì! <¬ŸŸj½öÔâ²]læ¹k>þö¾OIQRó±§ßX÷Ë@I÷òVDeaßzWÇò\ë”û»Ây¨æRMq'FìcÌ'ý<—d÷ÃƒáOôÑmû]4©£g66ãGÎî|L3›SV±Ì>Ï~ÓüÛ²ÌÕé{OÈ×}®î7àéþrtŸÎÏ}27WÃËÕqrkñq÷qqŸŸ‡»£:î-@ùmüÑ|ƒrôóe2_ ƒ³XÜn,¢rj¬¼ëˆÕ¡fÞµ@ÔH @XO%V|…ßŸÂçºO‹'q>ÏÈê¦%{úm^A7¤Ÿ0mÆÈ»á¦Ñ˜”]ýô]’géÜb­,•±Òéø#>nÑc¨ºI'á¸/gÙ¤awÿÑ|í\m_Þþ³×0ò»ä4éS›¯¾BÍžõT1`wm›]Õý¼cJþ×…MÙóSÀfŽ8z‡®›»¤ µ@dÎy-ððxæ»omF9)¤Ë= /à™±ûWq„Î¡6–BIˆ‚ËZoyµ_~ø—ÁÉq—5ê µ>ðørøÁrFnô.ÀÝµï~JJmòl	[°…­ê­ö¥1¯OùlŽÎŸ½A_ìí
Ñ ’mQ:.ÌE#Y60¨UÖ³a4º.Xc‡{2WN•JÊ3[áÅÃ`Ã3Øqò‘8:Ù?xñ# û2™Ä9€%^ÈQÚokq#æê‡–6“ñ…yÜ®õà`]2…M)vé8“Ã°pGNóZ†^$°£e–“iˆWÜ­9 Š4¼â‚7×žÓf){¥ëFƒãQ$½ùsŒHÝ¹Iåœ`¢	t+N­/bŠà‹¸2|ÑX_ÎýíçÃWÅÏ¬°Ž‹0¡!Öñqµ`z8°¡?BG`—U¯ˆ…R?<S¸9Z4.J˜ÝWV ˆvÒ¾.Ö‘y#H-ªçƒvñˆBu¢I” -2`ì¨«¾‡U^:àŸà©ïmu:ZÓ=ÅbßÛaUj5[1–ÇÅVÓ7	WÛp€a>£9©Æìicµi™ýó½gØ^ “ÌûÀ»´ZÙl|Pãá¢æ	M$ó)mµôMˆå>ÌO•)l;¯T?|™âúŒŒžz{Î&ò°$õó¯²ÏrôUhüÂ_?}Ø
4nÔƒÃ5R[É»‚«©l×–º/eë€ÙßþM×ÜÚ´ªr8 sÝÅ²˜¶ü†Ì‡fé.† ”]" 5«úZúCaÁ=ç T?/#¬Ë}âˆùtJRYg|=î*GÆ¶/¨¯	‹*D$ˆkã˜¾#+aì÷ƒ0™bÓãñÉ9ö5.>IÁ+oýïyï¯[cí"ú4ÐiØ’*<<&íH«ò®M
ùÖôã4ù<‘ø’;^y­i¨ý·=èRZßÙ7³úlŒ#î×î×}—ÚÄ¬qÏ±|žmdp?r»ç>k(GâË½}¶ªG{¸k¡=¨w©•.ÄÀtB]}·w5âéñëø«·l¦YÚÀH5Zã yç³ñ¹÷ŠMGetèší ·HnðÂ|&±‰":‘ç‹” "á2Fí²DÙÄ9
d¦ó¥Ìt˜7Foúw	¿îÃ¤£_gX‚Bº­õD!I§¬ŒdÿYM¿~|nüí¡§Ë.ºBŽ€×ŒF#¥$ïÛ/^ˆ?Š–¼Ï‰‡£`Ô­vAþÚö´nE	0åc©¨ù€±»‚u'ðÛøú«]‡ýTzýóï»;G}G®xnr·î“Jì@wë‰éh»ûg;1ºô}Z£i2ºŽS·“íî7¡^¶­0†îŸœyÀaå'v²ÈòÊv|èá±Ýƒ³˜«¤˜ú“¸wNE4›g©?‹j@ôñÄîä‰ÝIž`H‡;Ç.ì¶¶ÝýÌF£l–¸½lu‡VcwóØî%žLÖÙÇ6p|mw½ËFÑ8«œk “g1àû[êÃÓ¯=@_–eœ»ü©»íwò¤kí¼€e‰ï\¾®-ÜÓÅ7Ý:ü•luwî9ç`Ë˜§ÌïbûÏ÷A‡_Y2s{øs·ÒÁ6]Ó{ÑÊÀ$6‡Ü÷èc€¼¢ÓÖ9%ÛJ›¢h)&¤…y;ÌÏ3¾m…c]ÁI99Û¤è_/“u„5´=¤¡tÞÜ“â‡i6£¾ŽÈ^þ”}âÕ=iNÊ¦ÊÕž<GXêªsµ—2eÌRœúÐ^‚ª´²/%É¯q·_èÄg‘SÛ)>Æ<Õ÷4¢0¹{[QI³ÿZÎ|,™’C
Èf{¯@¿‹ó[7L¬µ*¢‹ÍÛ2h¡zÎV°âh>Æ`EÃ³úËœ´ìòÿ$€ÉFú'ÍÌol P6·<SJ ÷yÛx"½ùo?½ßÙÚøéýŸú›Ç³ˆÝf8Takaþs}ýLÛÌiW^BÊ’uÕW€gìÇWÊ¡Ð=Þ??­JAî‹‰y›ÿ]¾Cúù¥qƒ7µAL_à-ª¦òú×WûÁ¹Öñø<{M»±Š~&UA6àJ¸õô4z`=îû6MsÅ8N€=ÕÑ2ÿAfùÓ3~f±Ñæq…¡ÞþfÁ
þãwmÃð•Ø	*üí³?H«ÂC<Pó±´Þ¸ïŽ`œ.fãßP‚©ŽÆÎørøMo>+Byj×jÔ¯‰ãü^	ï¡8Ot±¹É0Jú‰x¶™Q&í¦
B
Ã!LáÐ‚»êò+ñP¾/ËSÎCIÉ×ZÔãWâ¬ÄÆÞ;:‹ª“i^Ð†Sp×^$ïãqkÛ÷—™Œ«n_êùº²Ò³º}éèÌKåêvè¼tºS×©ÊûêuÇ0;?E¬öÛuº]®¶BÅæP-¤öLØlÜøòƒÇxÝ5X©öå÷‚ÝM8£µ¾‚ð …y%2tÇ8Óó~Œn®fþÆì€2¿gwEÃDkädùÅâ³{"ö€7cæX‹\Þ@³=
5ÇÆuô¯¶B²tãçÑûÈ‚«°Çvk±¦B˜,®•`ÜÒÚ#šœp€ËÂ^8Ix@+Î÷c7Ð'þëvi#«ªmüçWÒîˆ
éùM†{°
gJý}µÈˆú—šÜÒ©ÎüÄÎ¢áàÞðÂTA°±k]cS#ÁÁŸuÍ]Q¶‚!ë>óê)TQWíxRN¶g¸é]èqð¡ÚòçQì±wÖiÉã¡Þ~—såºk.I¨1ù'Ÿc>L-‡ªßõ+õéÉ(·>Ì£Êqƒ¢e D†¡!®èœ2Ç†¿ìêdZÄù%æß˜†h2±!C5=ÚV­Œ.“ê&\eäIA~îâ]4[ÆE®nJAUß&ù¦‚
}úø|	¨©¼ _¹§˜¹Æ}Úà¬ËŠ^(4£¸Pñ
ÁÉOL•'åNú<µÉ¥oÂOPÓÚâìjgVó©áã*_
XZ\[åËP…ëSG«|^WÛÀY±ËH–í&ÏC±uÕT
#ÈÏ$•6MCdPøä K’Ifžvð‘?²3ˆÿî¼'5‚¤T3¢ ±‰¹¾@Z•rkªd3UÁ z³4²?¬Hc¿¦Uö‡6ËO®lN½Ú‹KÂìžÂ¼~µš¹ËòãYHÂæŒï	þW•ƒ–…•ò$ËÉeÚu¬Âžu(‰ŽJéû¯kx?ÕX÷ÞMŠ˜ó>n™¡9þÇÌcÌžÙ`=AvZGí2Eþó‰#[Í6Àûo‡ÕÌ›zfäœ4f+÷4ÊÇD@¾¡ox¡z¦ÕOÏº^ÍŒÐi[; àíêçÐ¨9»<qîe.Æ¢«Iµ>Ø¬¨Á yTïÎO®Ù>Ðý'PB¡ËÿÁ-µ( |W<„þ¹SÑ…gìÙ°úõ)&UIýóµjùÂ<àY‘¢Þáßôø­ŸÁh•$ö©´YKû0‡gu‰Úéž T‚­R,Ô+düa¬dîfwôãõ‡
)lü±ì´ïö`êùú£Õitüýñö¨ö;ä€Ò§VíSSg’wF£§ë¯°V+T…/é¼=ªór½ÁÑkKÑƒ/dªQCmžjtåwTáOüõE”‡eZœ*R>ÄwmKõ©j¨ZfªÞKçÝÃÈ‘flÚeEœý±œ¼mÍýòƒùk€	;k¯8¦ÕdK5*>í®h›£,§éF(€à7T®=Xµæ›3´J-l¾Q¬€[­ss·¶^ù_,0IÝ©hÏV@±µë»2)å°¦XhûÃõÒß,ybÝúùû WzÍ’¨ø_ÉÃAÏp¸¼vrÂ5ÆqýÚý
£
Ð¼Ô,(>Œ‚I!Š^ž°5y\È$‹± û/)ò;ÃÐã2[lÌâwñŒÜ1*ªçú+ay©Rý®õ­ŒÎE“k®YàÝýPŽ©ð¦èÂ«†¿°†O7°:
*£i”RY#Û×öj¸–ØZV‡¾œÇ0Àø¿ Üpm­8¢RG.·M>D­ä2½N¡‹fès¸úsyKöVtàß•—±§Lâ¼¨™|Àæ8«W-½ˆ` ÎqNôR|AÃì°¶ë<À,•=p2Y.ìòebSlomU÷c8üˆµ«ámÁÜ¸c«
Ó‹Y•·£Ôd“Ó8ÇJÛ øò,V0Ôn÷n§ºÇþÑCYÌëÊÁT»ú¶ÛþùÁžÇ7÷í)ÍžZðóñ{ªºîie„OÚS5TÍžVûÈ=íQùdÆ<g¯i)õåmk~ÚdºÕAÝæFhþXYóƒÝVÎ  ¡ÜðoÉ½#¾ßWÁÅ´O.õ)neçgE&«W[Ü‚MÂµ’zœ`ÖµÙmå\B­çTÓÒœ‰“©'¤ˆYýyíÆ¯þìÓaÀ…kWªÕ#·RKó•êÏ6dÿGM­„°µ×çÀöÇ­q½«tÿ§Ÿv§üSÖ=€˜Ñr†¬õ2µÇ
jmË<J^CøPÔû¿—ìÂ÷ês­ï¢PâþuüÊ]|ýY`W¨JÌjÕ+6ßCQ÷k‘\Þ\%‰³Ä‚]–TÍé;‚ÌÀR„Æ—X*F^z1Žgœb¦U!ƒU¤acˆ;Ò“w„&½—_íNW¨vaÕÞ;¸p¸‹Ê½v?öåžßK½<«Ê¤ÔT¯ïú(ÑHé—¨oL^e¹²[OmÁ½F–?ö$]J¢òBqíÛÝ-ÿå•~‰Á$þÛÂzû^Væ<Cÿh9[oþõ®ä–ï?†v$£V\ >ö„<Y»Ð	‚vË‰¬Hüx<z
Æ:ùëÅÈñj]®*-WyÕÖAk>•ÿY©s­l¯<áŠca¼w­z^÷=­×1fVLöV¬ÁWjwnÅý>h:wú¸òûØ©ôá¾¯‹{g®å5©TŠ²ÃVðßjEÆ=¾˜OÕ™>@×kPj è×ØÃT›ÀÎ!#vtÌíu°²—a«’W¨ÞoßÏç³JõMé
äf<DómïÆA•¥@+Õ·"ZP©ðñGmÌºAeUð¨Áo‰xÕêÿãþÚ7ìRAµáfÿ…cu“µpìçAA€V uÛw©ªWëU«|Lžé®ÌÊìÀàƒs<Àwnp”êè³ÅE¹ãÍuãÚ¾y@{›á ³G•“©x¸‚ª¬æän|‰APÐºIÒ^3ÐLú_NVö+ƒ&y£lã““"¥bXRŸ`
råAf?¤Ðiâ÷z¢Vþø¿Šípò¾g<T8±½¢h0“œ‡Rÿ×´­l&lð›Fãf{õ&Ôô¼Þ×ÛßjuJ½®,eÎÔ§b‘›*'Ø¬]B–ù/ñ,íŠ<õÓ´££ë’‚Ùˆð|Ÿ†Ÿ›’9ø(5(õ0nn3jo‡œðƒJ®ozúœf2
ž7µ-{ÇÚ2áˆ	¤š®²M’9×@`¡S.›á´·7ï®Ö¶¹uP?
°|<k%>ÉoÎ}\×'ŒðI¨¼Ð>e,Û#Í‰h÷)»¥¶ªþíÇ÷)áM¢1u>!Ýù:Ê_Ó“½ÿ!Õa¸7Ï‘OïjÐ%wÞ[.FÃvCúK"@*Í&þíjCñ	\±Iôþ2ß:NzØ†sËI”›þ`”ñW‘Í–ÃY¬cZ“¢€i;]Î£IË§ÔLË?1ó:þ÷g¸®Ô[¸^½ƒÕ§Üç4+àù²p:}—”Ñ<I÷¹z)ýý|{]e¨ø¶žïY÷­¿¿uØ³;ü†–<Mðõ˜'Ãìj½ãÍM“hÉ>.B¹*damû¬lRQgžàÊÚ+ÌõïÌú6_ù¬X’»ÂoÖ@¿ç_¿V@8'ÚçªP)	`÷¬»NÅ ½V,=‹uh]ÍVÌ5=MZ£Ä@¥vÖêtx”²?7v «DU³€ÿ 8Œ
–?ÐŒÊ¶PÇ1ðrÜÖNVg§§»7'Þ¯8v]Ù€Ðq~æ²ÿ»T°jÅ˜ÍÑ)9„àšÍâ.½i5ÞàÐãÊ2ùã.`Fz-{¤ÿ·¹i%CßAÀS"ød$Z§SÌ
¿mJ	 PìiØÑ\xõ©_µÚ€yÈ…á;¿q·èÎ/Xuµ» v5ÊoŸÃÌÈ7»÷Ö9X²€«¨ìÀ…µ)WQ2ƒáq>RÊ›ß¡’°ªë&ÍÑÖÅeºbÍÞQ1z™ŸO¥V‚2¯bÛxÜ›Lr ú¥‰&*VÅáiVêøõùÙAÿøüò»þƒä7uE×o®‘ ž±þx½ÂO•6Ž„8jenhäzŸËó•”÷.×ö:jÝÓš½j+¼°Iõ…ä‡W™ ë”ÐuIAÕ|dÝ‚™£E|ô0#õÀt‚ôsÕ†t8dÃe	Æýj
p§®õ=7cÜ²ç)Š"3^wF`Tõ ¨kvêP‡–=ZÍÕàŠn!â«Ê4êäe×YE«äÓA‰EöÜV]÷e€¸6ôÊú†BŽ°ìÎŸŒ&zb4KHXç]2ŠERX58–)œq2Ãc¶éézÊçÍCŸo©²sV.‹ÖÎÖV›‰¡;Œ§7ˆ… Q¶#LcÁ‹¤—o_0./3Œ=Æ~™©Q™[}n÷å¬Iq²—¥)×@§ð¼—eó®­‹§`M*ÂüSLëÕUŒ‡LŒâŒýFŒ?ý\·<[pfiu¤têÇYÙS Á»þHž®:Ú‡Vïv÷Aî‘«›ò?ÿ¶öØˆfyÎ:[ë;ë…aYä^ ïG{B>Ì…!Îƒ·UÐætnñ]oãÿ@ê.²¢l56áúmNb@“M ¼á²pZQq›Ž¨:ÝMöHk‚ØzÊkÓ|¿Èwq#7‰ð¬zGêÎÚ8ÿ¼,~ xk5QEç bm]ou­_o=–ký nEó|
i0è;1.„JÑÌŽ›>›ØŽÂþQªP`Ál•u€û‰GKª¨Û”d7Nå•‡Ï¡¨ˆ,ž*=BM7Â9iÔÑhê‚Yá	½Ùd–	ë‹eóVSâBb³]ƒ@¶¿ÃG<¢…ýï°bè~g3ü0Í€Ãƒg@,³r;Ãhèº¯5‚ÀO¯ãx±Í€×4ÿÛF0ÛlãùÑœ'XÛÚ^ÔÆÉ‚0þ¤HÓØß]Í–ÅTîº•µ„]7§ß€ …ÎIAMwˆ‰sÊ`f§ÚµF$jqJX/,ãlâãIýT´¿„¿UhPOá'€ŒO•¹ühÒ†ÝU	Z…Žf&I’ä^ 5Ãia'*ÓÇ;]5ºEœï_>®eMæÄ4EÓa˜á›xµLŒÛ&6WÂ(ÌQÑcu>œ¿‹o›´e–ëæË´…éG)€±NW–ßDùXP–Zÿo˜¡áI!›ÃÃ# ¬Å‡Þ\O´©f*`¼ü
2S}ž¿:("ß,]ÝI'3Ùü÷ÿ	,ó<F›ÉEº}>“bŽ[`c{4‘)Tß¥A¼³È*)ËR¦·þ?g]jÊÁ3ÍPÂVtˆ§€5!iÓ‡¦ÙM«­°¨¦&z«0Hæç=†Ÿ&À¥ ø±–ME6i\àŠÔî£nDä`_µ‘‰v£6ç)ú‹Èu(T.âœT^ê!üÈ£gÕ¹Þ&Ù;cz¯Ù!Ê„CãiÁ
iÈ%KÈ^´J™J;»¿
÷ç>¥"S€:äÞêßK ‚À_+©ŸÅ*hýD= ìÅó$C!
@¿"×)ŸU£WÞ@Ãê×XÕ"-QPÑ¢É‹Sú÷h	½Ì·y­jmûúû(O¿´%§!Þ©Aò³d7…©Ýø­®FyP_ì'Ñ(O™ŒD$HÈkÑâ¾nïªæý´X‚HÄù’Éº	¢ºØÈãYü.‚^ÆÔ‹Y7±Þë¶êŸ%¹‡aìªÈ°Î!Â*Ü­‚Ëy {BÅÚ!Ho¨®Ñ 3é“‘FËÚ©ÂÊn¦g´ª¤„µŸhu#|Ñ
«g ¹ôÃÂ|f-ZžuyóTP¶¿;^ÙEÛÖËÉ‰âÆmÊx±= >dY2ß„¤îÉóéï«	À~-â¼$ß#C0è’ŒJ¥®·u'VO½³³Þ¶ùªøÉk‡^5¦C	­~çgÇ/«	qÆq1Ê“g©jœƒ8¥Ý3”Ie,=LÃŸ©(jãú;œC¿b¿wÞ{Ž•UQ«Ô\-3B<
{„u9l-" )>=Ó7¾î¤+žÏÔN
!°wÄà«DÒŽØË`àÆ š‚ƒŒÑr½@`LÙío„’c‘F×ñ%ý‰+ Þºä¾¿bï—Ù;r|W²ÿf»Ûðö§’èæ±Aug½²;GG³áßÆÑÑÆþ~£Ú°xÀªŽ.)fÑëöøõÑóþ™ß-ï©üŽ‰¾FFD &óKWÆh 2êün¦^5XYeäáêÌ¬æÁÙ…mf'&¸ë3ØÞú‹ØOãî÷_öÎ¾ïÃîW§l–³Æœ—iR>pšø	ñD0ÈÜÒ(ÀåV³áNf=p9`6ÕÑ‘c †‡Xc?L©0Ô4»AèÄbQsôÊÓÅ š^b©¤  ¯6‹n/Ùë28Ž»Oþ¸gý}}pÖß7S¸B°v¸ê6õõÜ”w/†$­¹ë]»™]]·„µp•jØË¹¼ÏÍW1"|ûsá‘Ãï,Ï§Y2.šp•y‘€u%éF?Ì`¯€·EÛcij˜,pÒÎ„£V|¹•EêÀ…'Š{éê“ÝEn6Éãñ®xÓÐÝ£é{,Mì*ø_ëœéµu‹°†ÚŒ´LùÏó*~?¢‘G7« ¨z[jÎQk‰ÊŽânI6ß*;fo¢ðÑ#(5¿D “ÍðÞ-UKº~öž")Ëb–&(Ð	>w(pè®Ë	°¢Ðà’JjÖú þY›.¼û	¸ð¾OïGd~ëÞ+väcŸÍý‡} Ö¡»hJ_¬!Õfdá§ÒAFAˆBvÒ…iTey|Ä¥7èó““Ã~ïØn?‹
4, ö;SX›÷ÍÁñyÿeõðë©HÉØ¨Ä
E˜YÈÄ([w~ƒEÈìãM<(¥+^«›"U—E2ÆÛ@CÓ¥©ÊØ’²Ì ÿEËá‚’»=g'’â‡<K'ûY–‡·¡²‡“ãÃ‘PªÝ…QKbü8³ýìVËo±ènò÷ß³%ª$
J¥ƒž‰ uÆdÑHyŠèY1¼i˜F”q4‘ ½&mBïøGÕ˜Å ÜFS…»Lm('èð¹Ë34~Bês¾„DUðÿë‚Q‘Ð˜òÜÙÊœúYü.‰o>U`ÑZ€5nÑž{gŠåý¨‘ºV9FïÊ$s²Þ¡™ÓT)ÊÎ¶0‚„aJàHq<G|ƒC?B%Á4™Lgä#ç{ÇÅ_í›~?BZGWüýÔ*1T	—¥N€Á¨¢_¥Ãý¾–Š< ÛW›bñÄ59Ôþ{âÈ ã`Š+À*hÙápÍ²%Ñ&öyž²Hï*Ü­Íø‹‹•ˆ 6qàæK+šG³ý iz…Ú{m3y¼KâÜO©øÄc£”øÏž{Zä7 Y‘üCòëº<ä@FÎôA¼ÝC 	]…:EúÉ±–æ˜þ0™8z=8iwsdS–ð
&Á@u$èiñä–Ó“Á‹ªFÝËÔÊÆ	ïÁ¥ ƒŸjâP×YûF\¬+ÐsR ê`` àzä[ÒPbê€€ë­'©0Õèz1½-’Œ|Ú`ÁÙ²œ!¸´þúø½X'’‹Y2OÐþ%þy«»óž53ü°­2‘g£%Òr$‚G›ð?yóÉ–*È?žÑ?‰ííîŸÿIúÉ’!eˆžÙe,™#|-¶·þÛ_6A¬8ARs“ JÈâBçÉ}:ÎÖTïìi8†/p³ÜýÆ£mŒ‡…òË²XÄÈ!¨ã.O¨' ÀŽ÷ÝZ…ìÂ7¸Œ!j½ô¦ÀŽ£yÚmO;Ç#`0f(¹áây;óˆT»% O<Pwóº(‰Ip”Ífxµ»y9’G‹i2ê-Çâ«t“!´vjÃ*÷DÐyŠîŠh­Z[ªEöl˜e×b2Ë†ÀSÊ~˜µ	¬ÿQ¢»~9…Ó?ÉÏâ	1H¤ý—œÈZÈPf‚dv?—½ îÀnJb¤Z²°ÆD|Ž¹œ:ñPêäf·¤bûH7znÃ£fÍüLzéø%FçƒirU®7çW  „áÔ&ô1`p±˜Á"¸bL. fp²÷@ãžá×>0U¾@Êš³ÛlIœ$ûŒ«[6Ä w‹÷Ä;‡¥É	£ù\þLÖæjàÙƒÕà@Q%•§ÐðN8ìEpfÒxÃßÄãc¤3³3ØµwqÃMÑrDþT£Xòò¸_7pe§.QV¶¡ 5)®÷ÏÝ'bCììtÿ"®'›óâÀ*ìì 7[ƒYÏ€ÆîõwI±88íï¼8ØhzØ'§çG½CqÞ;{Ù?ß÷_÷ÍA“¸)wÑX”°ŽJ"Õíî–œ*=~~t ëx¼%æól¶	ÿãÇ¯†½í.pû	¼y5á§ƒç§ø¬»Ã­ùio‘=owÄñÉ9¢dÚF‰5ñ¦ÈÇ1`nÊ¨šÓ¢„F2sÝuø&ü*×(ŽäcÐý¸ðÒ:9""ùrÎ6Æ-Ü«·¢˜Rª ¹— ]†éR®¹a´šF¢“.§À(M³YPM‹}òîuì«2ùß*F—ÿÙÝÊÇuÔá~úð U.„ÙR	á'ºÑGk*\¶Ž8Jf¨[ÚQC,Hâ­íYkhŸG-)±uÉüõ©øËVG|³µñç¿(5éPëtP#ßÈ4“hQTTÜü/8A½)•“=’ÊWt¦özÖXñÎÚ™	ó¸¼dŽõrü»F‘PÀºÖ Ûf¹½Ã1Þ*V‡¡Ž)¢ËjX]ve­A±òxBr.Í°fbqŠI#Þ4$@á^–ÃùS´X´ÿd»/{¥8ƒû×¸¨rÒq°)¿E©¤¶+–”egMãUíogèr+Òð@{šïÈå5nåþ@M%¢DN‹¤qJÌ3@ódÈ	Ù*óÝþÁË±³µóµx¹Äˆ4—\ôzû=¡$Jbö€hZDyïQâ¦àšŠåÇ_¶ Ög\Kqìhš±;³Ó¸<¢ô>ÓeyN;«`?è|òqÕ1¹`pýp9†t½á{ÀnÈÚN‡rÐ{íø¡<!
b·(‹',D4HÕ€èÕAíÓ8£9ó÷ k[ì“²Iê&¬Cç	›Æª_OîWä-mò+îå.2P;Œ>Ü‡“Æ7h$1ñVÌ› @oxY=túPiySÂqx	ÈªŒ:ç†üHz¦,¶íž»U×+X‡â=P¯¨(ª&+¶nÑ¤ID°´ø»"?Stx-U¢µZl6+0%×„]±jd´6§CãùõžŒ°ð¯*Ât6ÓE\u
ÒUvi™àyûÚÓQ„ùàÓY”ât?Õ0²6	è‰! Ì«ŽoRœäqLN%cÆpHt0RiÕÈx©pÆÔ çÚÆðv `aèÎ“PÐMB¡ƒ°—ºØø¸+wxiÐYSõHQïb3 ²)yüg^¼vaÔæ2	‘(À8öìny\‚@ýŸAO¾¶˜°Ïž	kk¯±@Ü|N©öÐåãø!>1w´šËì?j³œ•0F^i¾ŠÈäŠÒá\œFi<ŠåT@0)ë @q¬¯’É¯åQ<–é*³›*_z*{”¨<¸xÔçÉ<¾Ê²tKÞ!c+—øXÌM‹à¢ÐNÆšýu‰~ß|¢@è‡…Ýˆ’ú-åÇ·¿ôé~häP¢¡ñröàÁ-LóP|1öIÓXwãe<X%†øÈ¬Œ&è`@TîïÍ4&­ Õ¶iö¤_Õ¾²¸í£ “°yÇ×EHË8Y(rÿ/6•_sRÈY/£"!Ï»(™mÎâµ‹£²@$ŠëxÁòÜËS¬³ƒ§—^Æé`œÅ¬¶BÞ“Uƒ]±—Í‡(IhíˆdÛ;Z{)±¹È“tHvæÛŽ¹€-tŽÒ5&é ÌˆB$ô7ú3e”“ñ†<þÆœÄÐÆS"[Œþ#€SC"Ëºf<‰.UÌ,9×„Ž–]_)Çš(\)q1Ÿ`È’ß¯ËPiÝD‘2SÄˆ‡›88¹83ÿ¢;¤.þ¨_Rö®ç©DÖ­—Ñâw$håCˆÍ±EÌæ	s-À¨§Ê6¥poo8Îæ$›¼ž•9°- ñ0F:N²ZöB—bšåå%:ÒYeé„TÈ‹i(Zÿ,vÄ-ÂÈÊ¥?­¿>Õo~z÷)ô€ˆÀðV«âQ.bý-©þØ-jmÊÄªä=å—¹6åëôäŠ¥œ:‡1¹Œá¢P-Pc®§ñÕÚvmílˆ ˆ(˜—ì…$H’×M‚¾ás€ýw„[4,_Ñ41ªdk2tÂ£ÿY)S]Ê¥|[„GÑ˜N…!ë‡‹'R$“ÿ®O‰‚th]$]ZYÝ};¯œJd– ´
ß‹†9™Ô€>Zrž#!­ÏIq†ÆjW‰ÍUÁ½ŒH 2dÌ’ÉPÓü‰k³dt- Ó)ÑšŠ‰“‰¸)\ÌJÃmdEÈòŸÁ:\äkÕNeØœÖ' ùbÚq€u[ÅõÊsÓÎJ×«êsuc Ü{Êwi¢Ñ¤î èwp'Î¯´7RÚ!‡ó&î 9ÍÍäØl¨Qä¹²é3üj/Œ(ÛÊÃú7Ë¥ïV~Fé“Ô
V¶ZN£ûÛ- E J¶ÕÎÏ:T6Ž‘m8^7¨¦/usPK_•š‹¢'/ªñ”*”’ÉHÂa—p3«ÁŽ¬µðÃUÛîÛN58X§¶ ÿ ˜>ß;Ýí]ÁIfÄôv¸9¦€ht×È£¥þÎ*ò®ø³³Á‡¨þ,õ½CyP6TâE¡Sñª¶/ñév¹µKÙ´£œ/Ç	`–6¶(i†¹,U²X<æØ²ÔkIÑ×ã=.2iÚ#6)#ûÞšCèµ3«Pî¿i…nr@¿žR]Ò±H0Kák?üJ×¦õå=4æÙ³7Ý²T'Ùuœª3\uþ6®|sñ-ÕzôO›‚v»6¸`l5û½ÃDc+L¸k?Æ$Úºä¨·%ˆÄUÊ¨šü2ýbvƒÁ¹³øý9"¨¬Áê[ÛÊ<æËY™ìe˜¼
?Õ˜ŸÓRävÊj7%‚ú°&©µU‹Vl/Öbýìâ¸ÏT7Ïœ–»œÔë€=§
¸Ø:P@(‚uÓ‰‘îá/Ú LÄÙ¢I¬Js¬Ãè6Î7¶q3c
Ð(ž~ùúâ"`èžyïÈ§]¿ÄÀò\1#·‡®wwâjaê+ÝHþ–o1lŒ<¬õ{ýD¶(®“…~‰?ú­ÞÑïV‚¯:½/¨m¥À…¤4”›¢MôøªDžàŒÿÄ„˜o¾ì·U5”ËIÉ{ŠüìnïyÖ·ã.‚ÝëTåó1e¿áÝå¯¹V&ó•ÀƒÏû5<.”¨†ˆFÏ\òœ?z\âa!~xx´¹¨~~Ë€¥˜,odTäX¬„=”ñ|W´‘%§Ÿ¡+è.àð&@Õ°8»TÌnCP­ß2%å‡"ÚW*Œ€-?o±ÿæ]WpÌ‹GxS©+t˜»5Ù½¬ƒÑI *¯¼8}ý³ÚÒü"f¥Ú,ï…˜90t8°È†ê‡^˜è›‹€áÜ\Æ]¾‹Õ6ó*dïÒ0è”.Ä®ÉééwrçAŸ+ªX:sÓÝÖÄ£oÔá8"^”¡xJÝ˜ßa,á°ZÐé#ðü8ËLè„MdnƒóH[$²%j)ïzû¾YjÁQe ‚¡ú¹›ö#§+“­f‹8Å”FÜñ3;?ZMœì€kÍâLf ”ÙI˜‘Ò·§bØ>ÌH.ËpítVÈ/?xÌI·XÙ·YnomµïºÝncÅÄe¢V“åfG¼åi"º•™š©o{6ˆ¶\ÖPá¤®Î8û ùy­Ý:`ijì–ÕÊ±æåŽu'+!ŽMOú½¬¶ÍwKäê–&…1³ª¿å'ÂÁÏßZ-æÙèz_%ærRëRu/'÷¦üØÒKÜ§»Á¼ýQz‚GBí±Ñ+0)©Ãî£ñø3Ê+ƒRwBº2™‚Jëêš…å­ÓqÎ V™¡4ÙQ;Ö6HãŠ6•.…$ØaÎ%²0¡–ŽMqu«äÊI~W 	@\¥³ƒ² ãÄ9Š)[–ÿCá¶zê fÂ”erU&I‹‰4(ÈSb÷Ñ†MÝÚ¥—À€ƒ¯u”½Pÿu–°U^Êx ’¥ýuDçñ4NI§j¹à(rÕéãüÆ8)½Üéò *GÔ¯Tˆ)Îƒ’ÀH„Žm’—ö7©%rö_ÇÁ1æ¢áä)ï6Ú]ÜA¥³ÛŸà!Ñ±Ý#:Á•ë	KíDk{c‡rÞäD‘Ÿ&y¯-ÇöVÊmKS`«iÚýâ®ÐŽ‚9Ê‹â)¬ÜQöÎáPÜ6jÅ-ÊË@ )µCÂ2ßUls!‹žxC®ðÚÌ$›(ÊÍ:3àe"Íõf]Ç+4ÄâMT«²ÇD%Èôr‰:­§ºO›Zs¯-¸ž‘”Žyy”S˜mtÕþ`  ì+ÕïšÎ”æŸ"¹àÁÁ|Æ”œ‘±¾ËWØh…‡¨eM—6wJ;Ã@F°n°À"¬ÎošÆ×¿`’9i{k^üººþßæ$é«Ç!/½>Úù€WìÇ%3[&D^½%­òÛ¢H…ïZ§0£Â[Ã%*²ŠUJx¦{Í)¦f,‡Ç\÷XUB•Ö°Fëh‡±_x	¥ë¨±bªÊ»†¥ü½v”j%12ƒŸPüTgÖÔ™ôXEÈ™Q©‚›yC\×3ÁÅÎ“”«ž_Í²,oéFíŽÀÜÄÀÏ=±ªŽ®f,pŽ¼îK	eooP¼[1ã¼:(”ŽÉR<:8ÌŠb†	²é^ƒ%B=÷£ùìŒ$RšƒÄÛ_lRÞ]•_Qª°ÑPX`d“Á9ÀÝ2§Š®’¦ðŠ–Lç&ãÀqð/ãèeå¯Ë\"¢¹”l(NcÕÙ>õ”º“àXe‡ÿ±m¦Üà5Èªt‚ÂíÒV#:qk9
hÝ5Ú#º¿v5OÞóZ—ÊêFF¹Æ½AsÕ5œñ%š³s¦?Çyv‰#—j—¬Æ¸tÅiê9Án“1`[ÍPÀýcvéÖöÄÄ"ÒËZýVÚÉpáÃ®‚‹qó“½©Q+‹šÄ$Í2VŒÓ¹ÈÔK±óQä8,è_­(xNÙ«šÇXæ “.Ãß¤l ü]ÉdJñðGŸ–ô'U‘ÃäÌì%8Ö±+åjåb±¼MV°Ž•%ª ,Qðäî†–Ì gc~ç6ˆß*ÞC)~ÙAýÊx£‚úáµ¢ÄÀðõ6¹¹/§°”#÷Æ˜xŒÞõ^ý—kÄXt¡Êéá>FcæŒÜŒwPØÖÖJbNýœ„ÕUIeåÍÓ®X¢IvDïx_ô'ºã&b³$ÂK¿÷–—¨
zíH.îÏ°	·yÍž<ö;(€ŠÆ	ÙÖÔVpH|:ŠìÇ¯.éD/aÌKry¸,"L	Êw÷þ˜Ä¢3”±ŽÃ2µŽÿ‘€‘¨Ezø0L¶ŒFe$H{$£÷zÿà|cØÞEjÃŽŽ›Û;M•”N.°
°®)^OÂá4Mê›ü'a"ÃÜlEÄƒR“ššþÒÍˆGÙhê= ˜ÏK4ø\rµ×Ë"FÎ^-ÿœ8§Ž	ÊâIÆmt’E³BÌ’k ‘
 }ŽáW\õ¬É,ù0Vùaè*Ã2T÷¿ïŸ©ìX[S1+¢)NQS~§W{AlR~{‰ƒÉ«ƒˆ¥esíM¾>Ïq†ê+4Õø¦­(Ÿ¼ÄùØ{Úç!}‘åU*¤°‘É`W¨¨á¡BD‹,[4‰¢ŠF	J’W³å{ü‰21¡æíàž3bß IiÝ°1µ%§¸½d5þ%Ž`„~Tå­ÚÆ+ÀSÀ€nOÆèUþq*2ÏßÜLn;Œäj´šÖ«ýÁ ™UíoöAùÀlhþ?ÿ÷¬	-éOÜ¾ÙMt[(ëÌS¾jÁ|o9ŸÔ?–	`$t:éŠstƒ6ä¨¬úB$¡V{–ØX¡B=s#‹s(âÙÕ¥—K‡áñ9ˆÅ2*@¼Ü ¾ª«‰ áÜ•ûõh˜¢#~lè!|K*šç€Î&é
¨"\¥\úXhäUÐeGV%%jÊ²¬Ž,àºsahL\¹že¾;Ô\×®k¨	¸iã"¥‘qXcÎ¯‡œ²ãsø¹naR²†­2ÑSŒÖßÁLeÞÓð*®:$_ZCoæ.S²9tØÆ@„nWÜåê-|ÀÕâùYË·Æ`ˆÀX/Ìç g‹)0à0Þõã÷²¶¿Á#öø*bbÂ&°±¡h0àS×ˆsùj‘ž¹NÖ{ê­—m7¯¨²@:ºeñÄð¾”[’ÕXmWlœv“Ž fS¼’i´?+’ƒ Á²ý­Ø†0”m“y¼±\ˆVA9ç€²ŽF‘Ò‚Î¡	´ÞÁÖ @Sºië‹6Ž›òšÂM"¾äÄ©°Šró*¾cØ2,žØ•"LÔ³&ñËPãúIá0ÉY+ZÓ8zw««Ãb2ìÛ&* P÷ªF„'Ä†¦9dˆiEÍf…µlªkV]'Ñª-tÎi+.MäH?—úò®¼íæŠsâ@æe4”Ù„ÃQ$±±îµwgwœs&‹“ã>Â$inkn7"W•ß‹B+VÓY7ãòƒˆžFåÜ$[2ûM5ø—Bôj?É ’Ù-‹ˆ8N¢#ð·áÿà
ÀÌÁ~<V€V×ïìrtKiÎ¥vx_yk‹ÿø÷ÿaoœc+—û´ ›·,VE-`*”kTì½>;ëŸ#»Öç¢&:®¿Yf8ªa ¢ØiöSŒ#oÚÛÜTüçýlÈäu›DÂ2O³é7rdX§c~×k°òâ^xÍ@Zaÿ^Ô³4¬¼N èPí:&ÓbÄëXB^%ƒ+A;i(ÙŒ€‰(H€4;Ôæ1ús£‡¢aZPíw)µ7¢TµèÖÎ˜\>BæK«ŠÆì*ieš%Œæ™†È.IY¹m~ÉêªÅ4+3Éâ°ºÀVÇL—éuŒ’%iuœYR¾8F'Øª6cG?x§„ö„/˜>´P&JƒBÆ1ÎÂÔû=X:3!å¤AMÆb0ÙTNºrº|œäîªÚiØ‰eÓu1išl{Ò¢Eö;eX³F?“®±•üú*?°É¤GŠ˜,•y‚qÎ2A°>Iú5}?–&'sçôÁjdQ†p¶A:nÇ÷ÇW$U+0 :°€óÏaéÌwô}){_yUTS¬©—Þ×	eqNRÔ¥½=®Ç3$šã¢¡9-S9rb÷É1ÏÊylY·þùiÀjÓ“LØF•­^–“¸Ðð®.YÔ¸d=«¥O–Ë¿dCmÃvy¹…) …€%òÌ>Ä#”VÊANô€IGóª7Xy†Àž6Õõ Œ‹þ1;õÏ#­g©p7lŸµÿZµn«p|rL–pŒüb0ÇX'1Í¢á&cUY·Ô\Ò3(I.(ð9±ÌR'(ZúÑŽ`âV‘,u”ÝlA‚ß8–ÆYˆÄŠyp|ž”Àb,ƒÙùMEhžDU•:„bð Jy%ãVi¡è;nÏVçÏWÙÇd1U7AÜdùX*…ˆY¢ÛÍ´©˜bÉ.WÇ£$S[¡P¬Í³ƒb"¦û]’[O$UžyìW0´ºæÒm;ù_¼ðÖa÷ÔFÖ–t)L†`;žÏ³ZäÅ™„˜)ëlæ¶q4œØ˜NáÆ~ú¾ÞÉö{O»ÐDµiÅyLû*×syÖL‰ovÉOXŽ±Å jp(¦IïY»ÔRé5UþQ¦F*éé"ZRò4ÝY8ºÕß€ºF(k¥S¸ÑËQ’p©éÂ‚ØÄ¤ºP\ÞkG^12™´Ô¶2ÒÖ¨“&53úÒÚ¤°¶þÈàÉºRI'gë•0rÊ²XHÜhGœ¢F‹%P(Ô§:³6Ú)WRª®X£:Ìqÿ‡T‡9e³”ÃÍ›xÆÙí†ÊrD¸Ð¤‹÷q¥UZ1!ª8ˆcBD¦¸NLÆ9‹Ç\Üa‘Œ®%¢"’CbúN†´„èU}Ä%DTx¡–.¡™am^ñ}Oó(žÅiDirùÙ"Œýõf‰v¿êÝ43êV‰(3(ó+T·Q1X’$b´ˆŠElh%’Æœ17à´vÔ;FIÍÆçÈ‘±â*ú­Â
Z›O¸Ÿ6CN‡¤!@ŠJrû²°“ÙzG}W¿Ä…'ÑóM3ãÃ¡“ `™[¼·…žÜò?x
v5;™¤¢þ”rX¶#ÎÛ•X‰l[,Š¢VÕ.ýn]Šð jàS‚–WŒ
&ƒ$¡u3½Ý\UGÊBiÌ‡¢Â¹ÏKâê-Ý52_„æ\›·’§¨â Í¥=ðwjU‡2?²)<7TéF¦+,3 Ï’³­Ú¿QõÔ;<¼ÏÉ!ìYbÙ,ì+à`@Ô26x¥—ªÀÜjÜÌi†± ùVmjõ_«3O]<PÏjzfÔ=Ï0?ë½¦Â¸mJ¨%ž€L‚{}“D>ÆF«Ä€K#@J³ÞúRÃqÿoçRj *½\à®—Æ#LôÿÖÛ;!^ËÚÏAÊB‚çÚí[‡•ù¬Åš0jOˆí&a‰,Ð ‰ôô¬ÿýÁÉë“?ƒi YD™Ë¨µ–T—B;R–â#b<1T×FcVÛR>ö»ÐZ‹”#‘ÇZ‘Gw¡‹S6ƒW¾ü*­¹nMÍ©¦yÑnwÑžÒBèmßÕ¸¤­í=ö _n¬9ð¬âØºÊÙûî0@õ-{ÔK÷îEžpÙÏÍ{¡=¬¤¤TJwlmœK‘“”º÷½©ü¥t©Ò²*U‘& ¥[¨kO8IiÙüUGœGga?éÊe*hd¥ëÙ¢nF—ahïä¬/Î{ƒïn¶µ_îòÄÀµÁîò®JUÏ(#ÿ%…"19’äRs|n–NTž–.óÕË˜›M†£xA(­âbfmªöÄ˜ÓNDåU™£{*ôÛèÍP$†Œßpáx@Î0ÝVïð¼Ù;]ãb‡®°Â×äÒR	ÅÛ»â®[®Û–ï£%±
UµÜkÉ¾ü9ý·=î
Û=‹«[+"ß
†î@±Í†ráB[ráÂ?(Ñå†””©î£¯ÑóEqhŒ^°XÓ;Ätrö#Ì€,Ô™®Ð,iâ
R¡ÁŒÿÜtó~…XVê¬4>_AXv~2ûRð‘1tˆ€vd“º&ÈB<zÒ5ˆKîÝ.[“Q‰¬WlÙ§©ÐóÅì±ç5¥w:u³dcÄÀH¿ÖÙÃÛœ½‹
Ü‘õwÉ8…ÿALoÇìOÔ$i¥Œ†è×/&³ÛQ<OFøü
°1¥,*\»"KvFŒaÉ7¦N•—è•YV†ç®®ºÄÌ/ólÉ?ÂZRÆ$™ 4…6N3Ÿ¦ÉaÈþ~)g¸^ðE†Î
ÀÙËÑµ»9lâó“Ø±Øà+Þ}ôÞ['×˜r1Hèô’+©f·Ý38ƒí‹¯çô_rjPyu¬X©&Kúv¨'Y¤ˆç3°cy\M–„ÍçÑ8VZpJ ­8«=°h²êÞË^¼ùÝù‹žã‹ZÏ‘Pý88ï‰³>fßÙ;?89æ™rûì(7+
j©ãXccÈ£°¬)Z}n±eK*o‚o=­;¹ƒ|"û³ò‹·Üêw>‰=’lPR”JxpÂ	™Û¸OÈ‹@´0Ÿ¬ØÙÙhß–T×Å.ò*L ªÿXÆV–v~¦‡—8êgév>¼5w0_Ù†‹ì0’%5Ç¢ƒØ<¤‡é:2ô)G0ÝýÍpŸTÛ¤1OŒ¯+ºM¡„SÉÀæpžœ…WÏW.¶;ÂªåzFs< €)öÉ-—0‘_rû$$ŠpÆ£jšõxÔ;å¶¡Tp–¨ÖåÈ’ð›æ~1\ŠëÀ$ ®— ¹p Ù»üd?Kše/…ó‰ÌŠð\ú\^Dey+èäðçÞ4Ç"vB¼ôh^ ,+.özçý—À·ˆÞ`pðòø•bg¯ûŒØÑóõGeG±’T4†KLž-oGÃBÓx™&)Ú¼€é(J:74E_zà-Z¬VQqqd»ÈW¸ã¼>ouÂÔSìÔvIæP{bê´Œ.û]qØ5][;*Æ¸“»FG††wSÖíy}|ð¯¯ûâùÁÉQïì»þ—PhCó¾„?Xâú$ÌeBÑ°hmÇx
ƒt¼j¢ß<©AHÖ-Fç(í¤zãá{$Y$J¼B…TìãOåZŽIþNJOIL™d¤ªíply®4"›År8·+øQ^ðG&¤—í¿cVÍDN4¯gÕeUâ·ÝˆÞ+iï1jöI+ËÑ¼v)ds†‰ö'‚p{=FM;qXŠ,è…q¥AP£7’ÑKÔYPˆ*¨z]¦
 %G3´0Z^l˜EDAÙ®c/«)–Î½›¸°',hY‡Î&(œxÖNi3–rÙ;Uöxºâ±EÏ$V9ÿ²wê/-ßÎUw £Ï^§þza÷…§QÅ*K‰ëSÔ7Ýk\('¾Z¢d¾S*¯•”áMÃÁñ¸þ*ŽoøA„_9÷:Ú¼Îü%%\söE!!Ù#:<sÔÑ‘š•|¥êÚ*uM×ñà$àÇ¹’ûö3ä
,<RÜ¶bô‰WÇâ–Ù»XZY4ÇjAtˆ0‘~*.%:À«­nû½7¹c_ã"pa;ú’ðäÚ‘°â×§äˆ"Å®ãRâ BF‘¡‘s¥TêŠ#\ód¶eŒ™E“
î›‹Ë2;þ±¶ÉÛ@þnì˜·¼2j–d…­õs\k±ivO€67`pÞ;;ì³wr¤oÐCQÅÝ‰ˆ’>!à‡Õ†¶è}øaJH
.‡H$(?ke/n¤Œ¢?¤” ³[3§ÊÂSNä¬= D¸–—'âyoï;±‰«Qh÷¦¼~~tpX’¡}ø'	Û¸8òë£‚2ÔûmÍíWœ(¿v;ä¬a³ Ûfð˜£ñ•%1‹ª²hÍ­^fâ9Ì¢Auˆ¨èð*Ž¢k„à\šŒ¹½“Â’ï)kýúD!ðñ=Bàã‡ä;1*œÅ(Ë@¡_Æ¯'>ÞeÕ¢ÜåÛªü§÷Ÿ¸`#™;1XŒlJ
5ðvé»í€›t{Õ
rW¦I¹îiÍïã2fs8MÃbBã3ËpÄŠøûÙJJ ï(9ä	Ñ3û0ÜËþñ^_¼8ì½¤ë€h’c ìBÉ¦®=»˜ÍbþB¹¶cÅ{Ì{ÎZÈ¶9;‚7£JÉõ€`=¤„ç Vt]‰½¾^Ä; \mKZÁÜkÈÆo¥mŠÊ “0×yÙzTŒD8)ã•Ê×34¥ƒìç,ýVåUÑea8JºÄÙquK·ë*A1T£afÔÃr¢ó9ù˜¿ËfïbéZ+l“Bücæœ0/ûð±¡&Af¯3][–øÔšRm@0f¨'Òg‚¬°rAÑí;ì
ƒenË:wa¾&wn-ŽbKƒ¶Ð‚Ì“Y$SÌÈ[CiÛ`ÑäÓUÑiC¬îÚbæ}5ƒ|êæ4’z=*ZJßV xW´Nd–¶I‚×]]Q%%¨‹Zèü°pôÇ©ÁåŒóÁ$+½MHåáwÊíJë@'Z‘i œ‚e˜UL¬ÀIãô¡S3PŠ‘F8“>
¯°ˆcr(P…þÐrEîœöÄÅ]ÒÒøÃû(Ížvøž˜nÚ§æ_x{*äàCŠpÔÚ¼f.Ž_e>k¶Ù&~QZì`zy¬¶šI‘Lh³¹©“ /»úDÕ™Ô›=r] mïfCÇWŸ~ôãj6¹8EP–ÃµÑ…)cý®GŽÍpë	~Ø±t5Z·ãÏ!%š!<ëCªFšOÉÌAÒpÇÑŽ#ìä%KÜ˜KW¹pV&IU|àÎ¸÷#®/*|ÍÖÓµ#Ù)Kïú½£CË°!A[r¥:uÑ8Ïˆäºâ$ŸD©V¿k9S_ézbDøŠ)î,$O>ˆ:ˆÓÅcå&«*ˆª@E‘7V‰’JÚ@Þa8˜Mr«‰mÞJ™h3“yB‰Tg”Â]à˜ìÂ9ŠgR€Õm‘ílí|³±ÿ·íŠœÀóº2§äUÍvZû&[º´°S'‹Z†EÑßFÐDNôY[kn
•K<~"âÀª¡YCoÛÚ²huåFµÀE-gÇ>‹,ºCÐ€FËbÊ ½»WUò'¶Å_IÎ–6YÎ)KÜ$ôOÞ%8ÌO•7;A˜Ñ{ô©¢ç×´[èÊ¿ýäDCr,ÆÙ-\Ægd¦}saWwèRXXkcû‰óÁ­¹)
2ï’R>ŸwKrY¦?±´Â±~aÇ&c&Ø¦Ó¥L8ÿœ£Ú:S¨Nì^"	±kHÂào.8¿×–s/Õµõ³­·b¶?ÒˆKùŒ¿C_˜§"dP·éšÌåÈíN}“¡oB7¤©íî‘™l{ÞFÓÖµ_¯EÎy?¾‚¹ÊÑß\_øKS±ãSK^Æ¦_ |éÒâ™÷v—:ïêj¸Õ>	Nžr33×ÕfÄ¡Êfô7L ;8i.Ø.¯(é]ð°î³P·œ1Oõ)a[™p ðI’Ä`«oªµtõ*Á:HN«ÆÇxº¬;4µŸ#
¯<TiÏèE‹Fs9ML¥xlg4ö“òû7¯»XÓJ.zŠ¯¿®”GCE³÷L¦’‚ÿ„jVz0§µkŽ»RëöÀ*È>@òœfnâó@îpQÁ'ÿyw`ÕÊÙÏõÌÔ¬¼7ŸË4€YÍT^çÆqÆã&ÑÆB6ÁÈ˜•nU•9¢DØ £É¤ ÿÚmÝ¦íP!œ7H<œí~ÜÅt­VdˆTÔõ
Ð°ŠôR­‰kÔøØ—§Y©œaÏ£rcjö±©õY—Ý9kÉÙÏúŸ®w<¸íÕCQÝ8‰±»Ž«¨ìº×‘ñÞ£˜Ê}”5…]'’àô3Õ\9>õLw9æ¹Cãïõ«Â°á_;“øÇ$ï
öŽ;8>}M™7zâôìäûƒýþ¾8??ž¼VÎÞ¯‘#–AÊýÝG_~ 8´Ð3á*Ê¶ïÃ ¢‘	æfÎ½wü_Çåãé°¤¦ÓB?ÇFóª¦Ó¸ò?âø“ÚyÍ­7î:\uCì´švº¢§œÍ¹à×Î5)4|’Í”Z(Àçy„'€çA¶©ä<îŠÃˆ•z‡¸€™sqv0øN´HuœkÛ¢ÒdHúS´Cc{dÖóëú1ÑÈ!Çôê“.§×'Ø+ô¹ýD0ÿ˜Q—K¡Yú„ÓyÖJïpí©È7VœyÉÍ¡] =8ÝS¬ƒ2ÎÏ^[^¢ö€žÜ˜‡{tmÜ°ÉŽB‰¯Aøûé­Ÿý§·ƒ>â¬.1G6Èœóª2Ü­r4úé­¾ß¯øzÿôVj¯”ã	%Ï‘©Í2Àˆ=ÎÔŒê: “:EÁzëÖ4†A¤c/Ü€K
J¡•î™ø…]ý#–}TtC7Æ$¤rëëdï¥ÊÛ®ŒÕYtÅ‰Ìž7#Cd\˜ Ø!S£VåÆûòòÔÀƒ“ò[´ú˜ä›x+“w{F®É+PNÀ*Ã+å'0‰Ã;ºxê—àâ›”OÜ­âêFÄÊâC¸û 1~%W¼hnñMUiüeD¡˜]#Jª5\­‚ã	Óä
ã~*ÕÉƒ5Ç?ºÐ«Ä=˜SH—|E|ò1å% ;
Ó“ªùŠ"RúÕ±¯’ÊN +OÔÕšXUV‚Má<ì•lÝÎ6–¤ž2à±{®¾#‚¬­²[SÙ¡ñ	¥Ì!ÉÒ™¦RÁË$ Ìûv´¶ôƒ3YtPp¨‚,â¼€w	fÓ©Æ_aXA†ŸÒ“Ì€JRÞ¬S¬º`%Ðp²Ga‘øEpµlø‹e[órk>È9Ñ‘¡Aù+ìdaânwkcÀ!Ú¤üg%+aƒå°Mìv¥"îÒÊ£ë`ZÊsC·eu×ve†KRºy¦@MYz¹ê€"TÈbH!:ÊÄXTýÝ“tì˜|Í@uåRÐ`Ÿ®|ç§ô§ô@DsBƒœrIÙ»)TŒ–„‹|ƒL¨1^n£Ñq_â(±ix¥b¦‹®xã™u½jd]«xÊÝ‰ãÔƒèçSDé5y+\qÐ"±q—\†µ'[+ªh«ZFWá•ÞØ•¶C»ŒOÿ}¤ä-Ž™w«mxW¶´.Þ±u]U``šd¬W·NÁ}o8Æ(KØì×3Àÿêí; Ko J—Þ€[¦o|Ä¥\q>¥î¼É=ãUùxH5ù•Wê×©ÿY/Wªý1ì«EHx !©x£2¥üûƒÊTXl"Ÿ/^0=¿°¯‘áÅTj^ùÞd¼’úâþÝá£È†¨®²Í#¼<­\7Éö¡®ë \	SJ¿^É#(,‚,^ò*žÍ²/ÄaŒL–4Ò$ü
HnÕ§K<2@ºÛ°U^U† áGç3Žg°”1ýK¿EÑ‹ÏaJƒ´h×D_ih'2iÑßT2»h`”uX,v@aGJãX­Tu`
MIÜ¬r1Æ…ÌÕ«»rÎõ]ì	z•^ìw>;âZË…ª3rÿ¾º‘s¤6^D<Ñ—5Í,‹õç7«ûÖÆåðÑ“îŸ+M8?pc>Ïf›‡Á¾d—rîl|M9Q‹Js—Ö[Ûð;[;_W—ïcWh¾ý¤¶¹.…Xt2ïàð_RP
%ÎI¼Ké"ý&
ûKä_ÝƒO¡ÉK{4â„ÉŽ®Ñn?¡P˜­–ß36‘ËI”s<>;”¡í;'GºIòNŠ‹ÿB Îõ™˜ÇéV¦TƒoÄË°›æ(BŽ`!ìèVÉìÊÄÙïÈUÁàé~t% œÃM‡#ù"ãoÜô˜Wð*NaŸ¦Þ¢'“ŽHÑÊ‚%ruÒ™®8Ý:‡*9gBF')tK¼f¾¢l¿%F „ÄÚÙG\ÍÐ[€Q<©µØÚ>¾-d“ˆY/¢!ò¥,þN¢œc÷v]~ËµX¿œÂ´‡t)«·^º Uï»dƒ.h­›·³U{óvc(£Ö4ž-
Y eÚ)çPT»Ñ^w¨1ûÿˆQ]!´Ê‘.ËœÙ$oŠðþ:ÄÛZy! ÛQ®sº®·æ\ÉÖ*ö¢eîçD@U
û¦"5Ô5/-žDua6E N…ý¶`jì[	8ehe:æ¦¹öü‚ºÂœÆÔDž+rB	Ý „	;–9jWpLØË*Å¿Á§j»¼±[šôuá¹·Èž¯â*÷¾
†5±ùfÛ,~„÷ÏãÑàôs¬.J./Èÿ•ÝÃÿ•—Š£¤Ï2’Ð=&QýUà5ÅÉÍ’E U‚l ž‹N·ms^œ‰Ax‘Œ9}LS¦u"4K€[´‚‘2.›Ä#¼ÀìR£z,Ùu	HÌ‰rÆÐ‡û‡{"‚óŠ;òôÀ”ñ7H 9š|9ŠCÎU·µ0*.7ZB]_PiÌX½mMï '	<1Ê‚ñRî_ï@´Œ)B
9˜“æg,?*ÈTö÷l(d:e‹Œ€P†r¡ÇªSvõDïOL¨ÅÒúmRâ;)’´–ÎÂÊ‚QQÂ2ÌÙeLÑ!Î@/i7YˆÁG^úghw{qpØG¿ÎÞ„JZûV4YÙÚäöiÞ¡;›´«yíÙ²þ¤olmÞWÚÚúð‘Ž…l*'"ø`ÿ ÷òødp~°'¯àÛñCcŠE1ÖPiÖ¥¡ÑÏ~N‡éð21þÎu–¦È‚Ž±ì5ßmú6›ç˜híüG±pÖß;?ø¾/Z˜{cóÏŽú'¯Ïm“ñCFZß/}ùg·ºð`ßeÉX¥2GF&}p¿C„GéQdÒ:J×5u‰½ ó	0Þ'óå¼«>jZ:M¤ž^'eAâXòm¯3ÑÚ~BIu¯mÓmÀ)¨y_g@*ýÑ®êMÔæ¯ëŸ°¥øðd0Ç¸³˜àe×Øì
kb;U†Ë«úŒ:W˜5+Ü«+»Ï¥×¯IÂg+jÐVÍ‘‘_Æ–J½{o¦/ŒûâhV–ÞI‹Ï‰úòŒƒÖœ¨0Jý‚6¶ýþÑÉË³Þé+ÝÃEoÿ_`ý}qŒùjÅYïøe`ÛurÍ’pø@ÇJñ#™©
~C¬&I¥²äÌ¼GÚpý­Ô`'9Úö;ÒŽÏ!W[pN8t$‚ó¨É&Q=†Î¨èø=‰7T¾ˆøå‹³ŽüzCcW"Á’JšÕß½GîÈ°ûý\ñS2ÅîŠ(Ën$£Ö¶740Ûno*(Ù–eábýU²ZNû{/ k‘Ý„û;çCÀcTý]îW¹AôÛy¿e”4jRdÍÖKÁôœÈWRWª¶ÅD¹H¯;.âÇ”#MÁÓùÊý‚Œ‰¾¢´aœêˆ¯à?ôõì½êõdÀ¿D]¨xÛsÍgÊ:•]Içc‹Œ²¶95”EU¨joU­¡j:Œ¶G®úV©Ú¿Þ²tÔu>˜ÖÄ†øz‡øŸ•“× ©·I,Ù_áañHjY[á‰
šw¥š7;ˆT•µÉÒý%¦ôãlˆ_€/etŠnVEÓøâpD</Ša°×€€¥Àç,I)\hna=_–Ö•xÏél%ì£»G2Fƒì±˜‘¨ùÊV	*¦X4@d2ÌYAå\Ê°§ÂU’4(ºˆ…”ÌÚëGb5ÒÆÆÊ`
_÷ÞWâÖà}J©|t¡QýÓ@iÃ¤úWš« Sý³ ´
Ÿ}qŽ
(<gŒe´ôjQYF(ñác^`,¬—¤ £S¡,NH+ÕqŸèš­W:Gî•UHçÄÌ¹„òD“ÿø=ƒo® üg¬Ó@dÁ g3Z¥Mz°¼òÍCä•S^|LŽ}ìþu˜\ðyK&©ëC!Æ´= {µz&1*.¥…v¨‘r„¦ïv†rå`ä+X“kS©tÜ8J8˜ªÌFÙìSå.ÿZiÏ5[Ÿˆë	|õ*üÕ´ö«ÑücdšOM0èåÙÉëãýu¥Ì=	[;•~úwu¼òñës”J€êž÷Î^öÏ¢µ¯’²œYQ=Ô<£²ªhïšLá|¢ò%_ÄšÕhFþô„QµÑA­ÁòûSm$@íˆ_à/b½_ Š¦’+hÄí0¶ÉÙ(SYoï« JY øÖóÝqÒ,TBÕwùÞl˜ÐG´ÔÊLµÌÅtui?ŸÊ*ÇÌ?6®ae±„™góI£m¾Ð‘É=“×Æ¸@…‚•±˜DÌ¸ð*a²Ì2€õÉ=±‰“r¼ÔE“_Fw+íØ˜é†¤—ýâíÓñpÛ;ÊDÌ& ¾Mæî!¼ °úª÷üàøZUßbgã±RcèŽ¦Ñ0±*ªÿ©ódkK oÅ?ÞB›ÉæþçŽÔ'qRBLH Ä%±…
(DW¨CÞÞ§GMæ¸zçÈ²$¨â_ú{’ãV3~ûØ(³ÚPU6ÅSŠ`^jòêPœ6È=Äb4Kê¶ÅHã•FÀ@G“‰Ôƒ5psñk«BºKøÄ€îöŸŸlY1»
.Mxüy¦
Fd-2‰áJ£„až0SÉ½qSa>h„âöõ,‹Æ¨i€›p7ÊdÆ]‰Ç$¹ Q"=n(rCâ oÛöü'•É2·<4 %&ÚŒ´åJa…ˆ@Ês7R“$AVâŸ‘Z±¿ Êõ$	?¹SÜÙY1E£ÿ!–/±¾nl¤ÄK:Š8„yhz„tŒÖÅÐ ×4‰+[šáWN3ó{²bzØH‹ˆ„$@Ô[8ÓDN†xr5™~OÄ«©þÖšÓ½“~R?ÍS™þ <+™,58•®yßîš¹°d,]X{þ?¨þÞÄ†4KÂÞÐHNOØwºWì*¹ðŠaÏÇ!«Á
‚Ô‰FÃ"ËúRÉ[‹É³MŒòQy,e­­%¢èßÿ-{žso¢grC1Ôš¾fÃÃ„¢9Ë¯:ý«Ù2‹wÙl)ª«å€|VU®ðµ&‹”Û»G+ àë{$”ô¾,x¢ 3!oŸ²‚FIˆŒ¤(;ÊŽ„ìà¾òÄ©ü{äBY‡0AcUÆ'ê…=üÍ®ÅŸ;[Šx1uó=¿h,ÝÆz|;'SÀÇ,ØvjF’t0Š4@`|âSby‚XCêYŠé¨ïÉ$nT*
>¤Þx*ÍÞ™äÔíE,!ï¹•qŠ&IØB4¼‚¼±ýäŸÁQ;­ó¦ñò†0ÃAr&.§,ñvb&	QG…1&ç2ÕR#ÿj 4¨¼Öúð÷Ùµ\R¦‚xfCÓq»¦— ÉfŽàüd>L½ =ïdñ»†Ž€²NÈ•]=–`×S (Æ ïš¥Üþbé$y¾kVµà~’‘öõ*æ*Á–šÈ&!
I‘³¾FZê®Yì@Ã7KºoÏoë‰žÞÄžÛ‘¢I5ä>#;:•94¿$w&|d6È»5“í­ðLIî*±OÊá@&¾:|ã÷XÌ‹.Øº³¹BR=—'5›Ò'ï$ã,‰‘3„.ô±Q ÒÆYNÃâÒ…ƒ¾ä}í	ÚÔÜ>¿¯Ã3Ýñš±G³ñ©¢éhïl ­Òlûð¦ ÚêŸ¡ÝÖäï„'7@âLÙ+'QEAUÎÙ~…Øü¨B™ž6FSÆ+JÁ1`œbŽ| ëï'a{'ÿdÝÔ¹3ß3E¦Yó¥ˆ¯öICg3y9´Vµ²þdÐÚw¡fãŽ’’2|€€T€T`Ê{ÅfÂÕ™³yd«ŠÌ+NÓšŽ3·
}®¨@YºTäÙ’-y–€-þôÄeDR“ãŠw‹î•é«'šÚÚXu*[Õ;ŠYÞ_P•_Q9aém'‰°K}ÿíÂÃ0[êë<=¸‡#~½Ž5­Å<tqÄ¡¾Æ8¦úq:¢à¶¯Õ Ÿ¤ÊüÓCT™*2ùªSÔ°¸q”¦¤¾¼WªË´w²êR:S/â8ßÈ•÷rk#÷rQA¯Ð¢cGR9½¢SŽªDÖ-“ˆÑÒRŸŸTŽznÐN-­Èùÿ¯cÅÁ~ÿøüàÅA_Eæ`]õ¥TÔk÷Ðzæ«ƒ—¯á¤œ99ì¿w~rŠc	ÖdŠ+Ò <ë³åútt¨R±GÞSï
yÇJ5Û	ú:E3LRNççýW´Á>¦ÜX‚Œ“/)N._³à(0Y‹Œø-FW"d…Ûñ	ÀƒcI>•uúLœú±Í¤kÙæË^fªœ
¸¶<Æäz_õ:FéˆÞ>üõÝþÁËÖ¯í÷Ï{ ŒûâùëÃÃ¾­ñ{¼ñµ©KYŒ =É”WÌÝ˜mG'€‘þÌÕEbˆÈŒr"uÈøx
‡ŽxÊ„ì@D¦YÉÁÜ­ÕøÊÒMXÃµhÑ¶Gât9Db‰^Ÿr>E^²UìÈ,µ»Ÿ¦ÝóÎj@û@F*Ö¦¡v'B…›Ñ”ªù@9ï¢ï5…´Â8=Ë“Ï³ÑšÈÍ3vúî/AHB>y ËKš'»Ñqé98ô¶u,È m.]½[")#FÄ*ož';ÑýÑS	ãÇ#™K©MºtžË!ñX3k¼D,KWfH¡E8ÙÒùø¼œMS’,¸ .ÎcËîÀCæû²\»››‚Ÿn:&Ýt6ï¦É´;ÉÞm>ÞþúOO¶ÿióó¤2Riˆ–¤ÈD¨ RQ}p]È°œÖ^6š±ŽÄsJRÂ¼¾$ncâ¸Ôƒ9]}•’P«6Š3:hNÒ.—«Htú {\Ý®?¬5S`ýp¯nõaüá ®y·{¼¾åÑ¾T¢ï€¹É’5§&âÂ:”—úVœ/jŒz\22:[jÏÂá- TmJU©÷Ö>UŽù0¶•Ä¶bGm¶Wê’4‹Tmö)»0“ÒéÉŸÿ‰uªdÂðöÖº‚+áßõŽœ×”pÄ*â–a”l‰:c4.Y’ËžÄ™£Ó™~ôY~ý—Çßøgù±Ü¹	.fù~>ýÌ€©„fè¢Æ1¬˜€xsSÊÖ8ÿÁÊßÂ1„Ì®ã
Ë$ìãTf"u¹ËGYÆPZZöHgf&3ËhÚxD¥¢qŠ
ã^Â‡—:>%š±xÃPÊäæhš5ÎylËA'Ç42îÎ&,M4…=­MüˆÔhIIv7‘²Œ},«ŒÈw¹Û«äÓÆšKúG+€><*²ñ`ÒÌ~Û,‹ª0h1¢ñcò|){E¥˜/V†oþ‡ýŸìÈ&F/Î°ÒD¥šñUš—JßUÐIÉ$Ú$E{“Ö§ƒ^)/éúYæÒûUÝËá†rÝ1ž£ÖÔ;¤ro‡\•IÖ°Ü¤­©©6©f×DEÍèÚìä .E3)´¬5[ANÎÏHkoê=&Mu„f—¹Êð•]9Vðÿ±weÍm\Ùù]¿¢ÍrÔ@Ñ\$g<l€"Šà  –HŠM&± %1§ò”×T¥ò”§ü†<å9?Å !ç;çÜ­»RöØã™Då*Ý÷Þ>w9ë=Ë””O"·$\ÛáÊóx–Ú»Î©Œ=H‘·õòâ"ØuxQØÜ[.™¾Vè$åSårj pÒ5˜×wè%»­xºÕ'D×ÇƒXj`-,œœ–Ù}[³¦ ” Á4UŽ¸)‹I×«4†Ô¦×Ç^î`.ª<š²åtO/®<t2)žm}“ýczqQÁ5‹3g|IÖÞßL !Ýš6ÞTÛ[Éß]úÃø%JNÎºº-Z7,Î¼&!x‚JVžl8G_Ö=,ò9B@’p…zãIï<½£zm¯µÓaÏæHŠ7MD‚ú±sÚTcUÉùTZ70¥oÆ‘Rƒ‰<H,XîbÖÎóM&¹ªh?ov:­F³Ž¹*vXîlä‡žÃUCÏéhÒwÙ×i ¸h2zÖ÷Zû<n÷Õ³ƒ^ûíP£Õm¢vl	ÌáÓÚo4_FÍçµ½Ãp©¬¾AÉ¹ä‰ò³ï‡l'Qö¹ü ú3MˆÏ¦âw‡U„'£D«öÁhâq$ËÀ©þú)Õ¦{pâxñ¹ò]YØ&24¥>„0/n§¹%H,º"dn¸æs¾v‚­ÛsËcÄãçÞW,(U ñŸ¤DMRÓ/im‡@Ë|T÷P÷\^¢Bï\ž®QJÜŽï´j]oÛÐäÌÏ4Ù4gÊ8Kû`Ÿ#7ûä£ÌƒU‹yŸ7_LŽÄSW•›HÖ£OÚÑ)7){¹£$Ï |t5El´ØÀ%{åj™YAOO9ÁwQó…Mõ@°œ'/ÒÁiª‘w\'ÈØ«<šðx
^ý3N}Åh?’ô	|]˜uÅf ¯?mTš­gNƒ¦jÌ» ³Ü’=z>bI*ã¼œ˜ªë§Æ‹Ùvˆ|V³5ç¯ó%$àÂÌ<ðÜ©½‚ÐV°àE#>ˆäu*>ðµ¯n$î>'Ç0©"È…ªmî2¸¥ŸØe*úÞÅdrUÁ	O}¸¦/éŽšDËˆ2Àí'*7à¹à»·U†ÞÄêe¿ó°¸v9.`­bÛåDóÚô)­ØXbƒÂ&mMm@Ëlv5$èã„–¹á™#n—£–+7É)„c‰`.ŽË¢Oÿðïÿñ?ÿõ/Ñþº&ŸK_„©M[ð@óÿ‹ë¶$ð7m»’€AVQrü!ØÆóË·(K`2/zÒêöÚÆò½öã¨ÞîtÄÏ/àFWd!vG­)ÙäcÍFx’«`îwžSûtƒåÉCgðÉsaÿ ‰úx(áI´í °êªÀ†È­ä>ÚlÝßd)å~²%?ï•“;@[ƒÃZK@
;[­¨z‡ŽD˜²ÐL¦ÃÈ%a6ì¿µ8>³	8¥náœ2Â“’°DTEôâIÙîÐ!0©£ØJ·Ol÷½É©]»!Ÿå'Í×€’'bÈ¨zGäŠ`}i¡ÄÞè÷soh‘ÝÑµÊ(íÃÞ^‹øÿÝè ÖA´¨Öéµv‘‹¯Ñìéy|Xë4:µÖžÜ5’V«’Jz;ÖÝ±(\§ËCÓíý 5z¤Ž	è_ðÎ×5ÐBÂ¶l¥¥0r‹8:¡ä,*}{ïáÊz?{ÙLNÌ6Ñ†=ÜL¶?éu¿&UºÖÞÕhz69¾BžKYü&ÚÚJ¾Ž¶6ÿîwÈÜ!7uté÷’mmX®*ùògmFx@K¦•D¨„1ùÇ}}ä³¥:ˆ;Nyó`ÝšÛ“m‹eU<@A˜RõñbåŠãí°œº•Ðá¯ÊrG#h799#£Ï$É$[Ùðßœ Z«2ì{ tÅmIžˆa‘¦‚*tðÜ„ƒÖÉÒ™$Ë”+z8Êj¬Ùß_áE9˜_Ž$KÅ¬àŸ6=Ð¿?$I»Wã(àZ·[{%‘«½WM¾jvž‹h‰“ìÄÄ].YB”A#¸)ÍN}’IOôôx¿ù˜Ç‡‡õA»Û2K §üeÐ§ÙˆË8ð¯N9¦8Ší9UWs`
†NûW0dI´)W ²çÀ °Æ1Àûž5	æÂôöç¢‰®$lv¼S-RxB …ž_"%	1<Ü2À?I`ÇêšàI§$H¦2ÑäRO²ºYíaHLú“GdÅ™ÐŠ¹cÌåæ§š‰Öž‡	2E Ð¯¼óó7b„DÈ¬cÄMÍfg“á ‘é-µ»ì[SÞä\‹º<“Ò“F·[FcZÙA~ˆï ë»)aú;3S}IgÃJßÍ—õæTâÙIÏH®žÌ˜÷Ày_ü&ÞfÅ}H7ïØŠî>%‹Ñ0é»\ÆÚ·,’ª0a:@lsB"çFí°Ñêi¤ñ¼5Úœ¨VR&iÎ< ï"ñ(òÜ“/ç&žÍZäs ¡Æ„”ÉÍ¯µÕÌDøMô[ÛèxU³{¶YÑü³­·îhO6ŽIý‡t6©XIPbF‰_6J7ŸÈ†Ö0`†e¾è­$‚ŽÍG±6Œ	ív9Ã yÉÚ(B!RàÒŒËª"¨ètÌ9X‡•Õ½|..˜}Õ§¸fèy¹›à	‘R'e¥•f»ßRedTx'‘®y<›ÌE—áÃ	ß½·Šr:qEÇðÄlSJzÓÂÇ7è]5¹-‰°”UÜŒÅ¨–H%¬ò†/¨ïÅœR¦ÈvÏ›rHD©/¼ž—ˆvÛ‡ÔÉ"rÖi´þ¶ÙpôPˆž¥;Zý©Dz	Ž`°6Ò‰ökÏš]¢Jô‚œ‰x.X`öã6ÑÌ›ð©ò;<’¸{A2når4ÝÊ5$œ¬°ùv¶yG$…ˆ"J4;š¹ößQ—è-ÂÊÕ¸ïFšzNfG4–Ú¼‰Ðt¸„€Rû“èáËo9¡“Í¦È9ãærB öÆŠE”ªW¯†”P'"ºQÜ½<ª„+ifx¸œ•3Í‰­q]éàÉö‡„¹æ›‰¤P™3‚IèºìRIg$ŽœáJ÷dž|~èîK‚„ÏÏhrÂ>èìa¾˜œ§ci]N“ÝÙˆhªx›L¾ŒX_‡ùC’ÃÀþ2ó}{ÖQ³Çs6‡§óÏ­@¡ÿÌ8—HM”úš³®&HÞ²*»
ê5¹ŠD=0ÄW•¥_[–Ó¥(ÏL© —K%:d¯µÍ35¯ûÌÀ¯¢#}…Ùü¥¶Â0ë%³K\jyižª©ÚßÈ’Æ LxsŽÙˆ¹@Ú·ŒAzb™Æ:Jà‘|ÏVV.¦m2&­9ü,a|ÇÁâJäc[72Ft_-"vSTLù²íhÄÑƒIòBöH²M˜ül,T[YÉ‹ª–]fód¨ò°õuò-Ëövò»èütc´óf…|«u¥˜g6Ä”¥^ƒÄ&ÍŸD½í­dSG6‰ôtkë«h4zr*Ïº;åuæU}íÍÅ.9	¥ÕŸyBJ¥÷I¬·÷»­n¯¹_eW¤$~_BŒšZVÜ$Îsf’õÀt""§NI(ë!oÓª^Ï,•Œžò×o“™H"q™ËsDDÏ"eø‚SµÅ\+8— ?QÂµàpFú§d´I­!Ñ¥£#eÁ:¼´y!E‰a¥…íY1vã¿ÿ36æSÿr5´œóÓ8‰êfÄ7œ˜¸Ø_JÊ)|ÄµevH8æg‡e'“è/<`F¥cºÓ½Z÷)±µf§‹<¤ï5¢'ÍÚ^ï‰dÆiv'VÞÍÙ×Š`òDÆbsr9§6‹ãlÄŸ»ÝÒ¤wÖräš¤K6}cÙL=z¬UX¤Pw5 ÕrŒ•Ý7¯Î%³Ë©¦<sªæHb£PpÆWC¾™£Aýƒ¹–Çaú<®XW`²!³4Vp i0~à(Ïo¿=®t©¯&»æ¾ß#1"rö§kJ.Ôuè{bTÄØ€LóÓt\‘LØKÆa²ÿ0zÉ^!n®•£Ë©õÊ	{²ÛUÐ•z¼BÅW,Ûˆ“óuKªW	 `[øvm¦÷jléB¥ZŽ!ÍlA{§ÌZ„×±«²Ö“5‰šàx@LƒéÔ61Ž–¯]åDí+ ôãúi:ÓëCÕÅ×Ç,â@pÞß¨­±Ub­·ÓX/8Çúä$U@
@?à½ˆ:'!<ÿ“HA	¨!^GœêÒ\GæpŒGÖÊ^ø‰…î´?à2ö´ãŠùŒ79:~aÎ¤œˆS”Ek-+â „qz’"s8—¨+'lm`Å ´0“Jäg?x¾<„Û™ÕˆfìÔÕfi²Âþú*Å÷Ðibt÷Ðcr.ñÄ&È%9žŠ„6.rl'ÀÞ¤Ç*ŒX Óüý!áñ3Bçnè.`¥¸±TŠC 76ZJ{4Ê$Ùƒý^¦Üœ—B-Ç+ëó¤Z˜ÇÝu/)"ìùæÖmÁ‡|&ÝÈDŠ¹™ÞzÎtÆ	e$±ˆzÃòM´f+BÂ‘ä"¥I•kÓáÓôªÔv:fb,ÔåŒ{ŠëO«cNÈî[¾nÊðÝ½kÓñ{õNoÏp ÓšëŸ¹R’ï¿üþ,6]#œä,Ñ´¥×ïË	lˆ¥µ7c"¸¿‰ÖÖÆ¹&Ð‘ì@íÈß°£Òƒ|ƒ¹¶ÀEÓh8J{„e®špÍïnhþÑ«ÓëÕìWFÆÂÈ_K×%€€ÆÓæ¼0ÃÑ©ùr9[rØ”}4 s×ÓdN*Ý¢´ö`­üzó­ùU¥_[\x‡ßønšžz«çF’ÿõ}=ÌÞxë<BØCK‘»53kå?Ë¦fö&X‚ÝÛ[ç6ÅŠŠ—«@m~ì:®‚7^~2Ó¸íj¸«UŽ1L}ñÉ|°Á>hæøð/ïE¢÷ðC³ÉÏô¸}ä2y}˜6ÄN;O¥”°ÉIp‰xuù:yU¼Î ¹a¬÷î¦lmPÌtYñKóï†"˜æß­Šaš|I&h4¶ÏýÆ5WA/¿ÙYQ3y˜÷uö–icƒ™üÔ£
æAkô¾×6j”{ëZv•ÅÓ«,¢ãÜû_S›·ì6è>ˆØ…M E¶ˆ.é )n7³nQÓX‹x_G>ßÒCqRÀ•EßC˜üuñ+àæzÙu*¯ Œ!|(Ÿ¼Ì¸ÂKªÃU_£Ž\I}=ÛU"›oêÊÂfè?¿Œp/ùÒåOyôó ¨[ ‹¬óbÊÈ†ËTØ^ëpVsO¤p^,Î½¿î¹
í“"HkƒyG4¡^\âU9æb \ _ÎáÂ­I/n.eªå”ÅY$rß.î|cés7@F.+ÏÕk]VÕ:X°S +¿<Eû³õ‘ì[k\«;|OzÖ;¦èµ¹í7XÄ×ÿ7sö^6Ó&þVû°»÷*j¾ìujðà©¾ù½6¾Î²¨ÈÇ+LWÔÝ.ÉõÇ©¿%ÆK¨ÃïYö$øUDÏÏ”-"d:æš¦-¶Añ‰‡¢ÌyU[°éš< Wþž=i¹¹y=…ÓÒŠO,9-Áº=êq@š¤5ÁÝ€ß<SÇï‚½£WÐî‘Úf"»±‰«+Ø['ƒ©&Ô•oKHáç‡
Â—ßçß]¿cL~Ã£y×‚é*"Óy€=PóŠ³³z‹´0ÏèhµÆ‹‹2J™¿Råè'ÒA›Í	sz‚>Ð²d2dî¯„Î¾ß µ’‹T î$CnCâúéÇBHât\©×b\~ ªá¼Ö¹8I•9Œ"Ô–Ó Ñ“íÊ€	—×ƒþ•÷;#ÖGù9D!ˆ‰„e” 'ÚÒÒK©TJ³¸P4´$YLZÝv—w—~©ÈÞc`È
BFá›Mý°ÓÁµ£øÙÙ—]’×#ÔjDÍÆF£‘:Ã¹ÖWÌ/l›sÀ%›ßYóûN¨M¯"˜'hÐ-5 .&´úÜ¯Øæ«?$ø—óÓdÚÌá8ÜèÔ^°{˜bª#-×_~o¨¶þÉXKëZÑ_E¯½OÝ¢C¸Ìv!—ø©R‘ÌŒ=h1LÈlÜŽ,ß­ætïÏ`NoÆ;‡ðÔ ú|p WWËi-1;º„öYŸ8ÜvVÆwþj	:G*=%Ã'æXbqß±¯‰®»õÁS'5‹œ›C<ÑÙ¨)¯ßú_±FM÷(z]ØèmÐª•jð¦N†sþÉN¥L#¸yÁ¤è«o¢¬O¦©f:«ÅbMÆæ&Â|´4‡ƒRÈ#EêÌªÍ2	äÚn¥îèâýîE.úós¹óè‡×ê&Þö‡ú·pL€"Þxøí&)\¦ŒF&/8BÃÎ¡8¥ùÕø˜MðòC£I$ÁàrCÃój«á–TŠ¼×9+õ¢¬ÁNð±—C}	”ÆÛÅ}	b LŒ%OÊø¬óZq‰¬‘¾PêQ^ÄÆZôpK²¼3¨K@K^¿ÎæÄÉ‰ÜÝjlÔ‰Ï\±æ–•}íy]j§Œ–Á—QýñÏfíy-]>ìÍŠ„å£@kÿÂ·q”—}_ôû gÍuˆQ¸RÔ·T¼Få¸	b¹½ú,	'àf>ŸŒR™¶ß&?­ÜW²&ñìªCd…Ní`µ!æ3wÄìÊjóŸ–=ÈôÊC‘•ñÏZ‘\®ï˜ôÈ›VîsQn†×EçÖLÓˆz^:ª¶²äèæÍx÷poÏÄaFuôjù˜OLàó2^˜3|–3ëyóüÊx»íúa×©×Ž ´5_@x-5ûùë(Kù°×üZADne×•vj½ú–µÝèl½ÆÝen±<{ÈgÇZå¯¨˜r{¦Ï7qK#V'jn™¥(¹Å çY¡áu‘ò»Âi·#ÿxÅ¾pYêynÒè•¡¦na—@Q B…ð4ø,È
ú/…1kÔQÛO`Û€Ó‰Þ/ÏKq5.çaR£I¶@3½E÷D×,¥RÃ.’$‚Ò©üÉ©9gKï:Ñ[Úxýf¼þv£,ÌaØ¾ç	è#k¿{óªy#…Úp«É2q¾Vð¡X¹v‚.9*¼lB&©{â=äÝù)giµŸöo	\ßÌÄ®CV¯«Í:E#=Á0ŽÀÞ)Ähó7y!+
ˆÀàí(d¤™ïZ0€Yî¬9éQd‡ãî T8ñ`ð-à9FÍ å !‰i¿í/‘NJýà õÃ$cfNUyÉyæÔ"Þ$ùâðÈlÙßçÅýÕ@m«Vð˜¼²p®©b´TŠswF+…ª¬ØÃ>«Ä eøâoÉ»¸àtã_8ýdz9?+…'±¼'+b}ºÙo	X×Y$]²…³þÇçlý½½L^üÚ,@áôsà=
ÛåÞW­—‰®ÎëÍ·qìzôCOçƒX²eRòq¦óîA0ï9ÃÿÈ<©F±qú6¢Ã1ê#ÏÃ´ø³¬úúˆÀ<D0¿Kç	"ö^g%žÇ¢Bð~•%‚Ê¾‰¤e:7Luqø•üUå ö‘‹—â¯ó1ÑØ{îcsø8Î-†‘ê‹ØH5:Ïæ%“ëØüS¯äígþý‡ï°Ðßqç_æ"þ«Ì\Õ¥kRÏe<"Uß¦”q™}›R9ÃÖ³)Ž~øçr’a=§èb&žþX²\pÒ˜nç.Ò‡K§’éhº¸r‹mÝ‘Å¯[3ÿ…¸ª““YÒ9-'ÙÄ9:˜BÌYF“?“ÿGy²YPdýó†ì‘ýMÄãœû&¾A£9Ð<ŸÈ¾µl"û"Ž4÷´ŠŸŒ.¿FZP•¨ÿy“}‡°ÿŒŒ I’£QžžþŠøÃgQâ_óuÇj˜gwacK´Ûî+QÁ'-…^ö½›nËþßèâýûK2ºäìü¦oüqåˆÏÑÏ¤4ðGTW²Âú'VY^¥5¯¶ßøüÿ—Õ[oÖ\Œîº‚a.çÆ™5/Ã6¾‰i®f›Æý5/êÄq!h~%ð¥òDqß¡ýüYNÈŸÌ Ñ_˜dPßkÖö[ûŠlwŠ¢(š‹õ.ö„ýåÝmxž5§Æ)¶JÃ±¸Þˆ{[Ùzß(ä™µp–j¶Å3LÝlÂßøå^Ò±ðCk"W»“É ©ùhŒó'‘¿PÀ0oÊr»-?üHzìÄ¼/òîÄ+ßoßðþ^Ñ{¹Àû_   ÿÿì½kvW–&úŸ£¡ _¢,Ó–Õ	É,“”Š;Ý‹A0Š ‚ DÑ*ÞUs¸=’»VO †Ò#¹ûÛû<ã€’œé¬.U¥IFœ8ï³Ï~~[x•ŸW¾y\ö¦àÀdgÏü>QO ¬áM™gunjËü 67ñÊôÓZß(ÙÕÃ8ì1hè3çkÑˆ‚$’ÞuXÂ/ ï£é¤è,¯ûM’ŸJéZhÜ§³M4Ž9l&mOzçÔ^fœµu:Ê¦21‡AÇÐ¾¹’ò¼Ô¸…Rãæå×ôê®‡hö\}Û’ÇQª-ÿà¾_Õ'¾“/$Ù¬_÷‘äÅCÝ…’Õ•ªD"~UotêKT¦JTWqIäÇûœ³.âSz3c8N’ÆÜH¢I`êp‹Í¨Œ3æªQY¹þý~XQ|æŠfŸ¯>Ê{Ç y^}¾ê¼ì#pþ«tb‚¿«tõ×¾ú(Š°ûÂæðW{½§só÷¾Ã—ê¾(PŠó7[Ç»ƒãú	×Ûp9Ù{ýêUg‡®­½#í(4öàÆçsÎe
î™dr©ŠÀ7Qù¥¢h}Ö‘È#"§Ôß3ôã;VÞðÈU¼¯×gšžãZõçê^E*ÂÇ˜á³lD5Î¿ß×ØYßÎ÷çN•Ä m#Ø_{Âa¾œàãûYí±÷öb-ÚÁÂùOª:ŠHõ\.ãÀ¹¹…Ûû^Ø;S÷nò'ŽOÎ~†n.iíãï Ü—%#¾úœ|fs±êàuŽ÷wË_·ö÷Êo²aôá0fvxæ¦ øy°Nsºê/.Üøe_¯ø/²iá'¦ÇÅÖ£^o'¾˜öiço5ÄúbøS9O3yÃˆ-½ 8™tHøH°~~Nõqiž‡Œ.‹ØÑ#AuÛí9Gô¡ÝÞÌ¯×ìF²x„ÖÐ(nD§¤ØdóÄ Ð·Ûu×QñöJ’¬¨‰þÞ]1º¡©‰ö¯bUú/qI‘ÝFðÍƒ“#·ïíí7üÛ|˜öâÁnoÓ8ÏÐ„B#îr ´+ä©µè¿ùsÚ1ò7+âj}F(h­·7Z—ƒ(»j!3Y.;Qa%©ŸÕ¤ûÏÝøëê7tÁ{æaînø¸}ü¯ÎÝó †Ù[fâ•;…S‚µÏâ:¹9¾xMÁ?ößÓ"ÊRŽz5Ë;­„àj¶â9´Uïk0<]ývÆbÔ!å“qÄ€ÅÎ»2tC¹+ý¹"\¸ V¥î\‰bSÅ¸‚‚,þ¼LS"YtQOûõ‹êl—è	Á&OD}W¦ßâ´/Pí9µëëàUèf*¤s%‡Ø]€¬pójÅäÐ®È¨h”ÝÆ
·XåcbøçI¹Ã	žLÖ¢v!ñ°3:äç©ÛbS„µ!$—mæÅç’kbUÉtVÿ|÷¡_)õÕÃ>½å«mCÀª&ÿÆ¢ðz`Ü†:S|íJF¬…ò†ö,6,çÐ9@t²UAûIG¥©¿T¾1ÙŽ<Û³¦¢$oU®/^¿†ViFnf«ŠÁù;µDÌÿªšP@ëtë½\Ø[±ûð›Œ1Ti8,80Qü‰»xR2z<vT+ÓWô´$)Ö"g|ëðpë×Ï9âì62ãt/JO$’¸½âÏ5‚ù¶&=g†bfÕ3µWy±h¿wKÎØi¬f?øZé ÷s%éÉŸ¾×*4sŒbÀÚ©¼6+šÊc	þ¬c vñö·už†rvŸ@#%ÀU!KbLÈjz7»™1ã§-ÔÐcŠ9iuSNÞˆàÈÍ’²<~ê&‡`ëEë‡`¥MÏ½¬,ÍZ©&#>!‘=Œ-¨ö”KBôj•Ÿþ2XùÃ²®¸`>¦ØH¾¦Ù¬h3ÎËš„…Ÿ+–©à—0r¨P$¢7Áq,e¥VÃºzªWèq…¢E$½CÍ£©Dx=¨˜¬äô\+¢ˆß]¹ºWPõµƒ—0ê0Êh@·w‡]ÞGßEŠ¬.wÁ[+iµt3§í9’c©ìXèd0sy2/@ÎƒúÈ,—áˆLÏö…ßa§¤uãÆòùùyãù&¤¡æóå~B{»ÖTA	åÚßËdœM íÉÎ¦ºö6»7½¾lÔ>Ö*>DŒ{ñ;<ÝÕßÞ¿å GÛ$4þ­UÑ¶º²g?8ý,³»Ó¢td/¢@{xÚ0ïÊŸ=£=Ïbcþâ¿fÔQZòA‚¦ë”>ûMR9Ôe+RÕ6—ûMíq ›;ß+z8X×·R6µÒo9^bBòß—ÄÒ_Ä:@\Ìw€¸È9@ä‚œ·¥-ãŸ[È¶=ÃõÔmØv@ýÆÍ«Ê–ñÏá¿À*â#)–ùFà_ùÕôé¾ù2¥û+É Z}=>‘ÔlÅÀ§²P*1±)ø^ÎíÅàQ«KoeY<º+ÎÂ"å`–]¤î¬Z9qI²Æ¤úçiÌaÁeckf²úå9çÚ0²š ^Õpæ>½ae?³’øÿö™µ0 pá"ŸG§øNriÊ³g9ª’Ö.ÓKGí	÷ÙÜ@¢»l¥'Íê¤!àˆ§ 5·p@Êœíñ»ø¿ðÌNë07Ñ&úê£ÊýfÐQ£„§‰;à{f‰áÌôS˜~œé¹/šÆ\M¨‰ í¾>Üä[ÈªœÞtëŠÛÁ®™ãbë¹œãê« ˜è|Ç=vì@² 73ÊØ¤Z·ÛN"SÓ+¸¼™ ‚³ XÛºúv ’7gìµƒè$9¸Nn@†Ûç³é•…Ë­ÓX! 5½F|ë(©€8r|Zv¿•ïÆf~[Á6Àf±Û“%œci¥BcÞVÚ'K7Wõ¾uqßôÏ%§Ç#|79Ôðö4ù–!E·+)˜º¯
ÍLúÏ±MÅ)Û¬30^EÙ>‰Ç•¬`qB™""šö’þMþÊPK‘Êùp:"!aïð"ƒÃõ‚È3ÙÕ¼ßYm\×òe3 }¶¬|•»S?ºY$d­TäM^¾Fï¥­Ú{\ÕF®9ŸI³ö¬¹±Â† 3E¨fÙ1Ep˜”ÿ|äùÐ(¼)#;xÎ¾•¥²‡½9‘S¸ÊE6S!a=õþâ*i¨ºJîS·óWS,ZüVÄðrVX9:E´•?§x™ô©1ãî½ÏÏßú•xT+ŽÜ©¥Šñvý†¹Z…wwö¾<z©¢Œ
*y»)Kƒ–lWÕæà~¸Ð’àtòï°‚GIvÈ¹y‰–*…@°J1Cy]M‡ªå|©àò¸‚*YC}«@/w‚Û’vú‹=$ChH¡¿SæÔ<F‚‡¸w  õ
<=l¨Fÿ¬®¬4ƒeüÈ¡ùø3ú™‹Ù,{ùÌï`ÕX,J¹YùŠ¶KÛ|P[U3àUo•DÇ[~hñ¯Lš,‘çÈŒ•m<sä.ôè¿µ—ÿ£G¥µ,pï” ³Îlº6¨¬k”£¬ÎìCù'Ï‚& 3+®® Ýü"Ê¿<Ú=®~Ü;ä´¼Øªøóêøžró\R&9§ÃŸzøñ.Û²i»íA¼{[Ã}S\7¯î²ytxlˆû¢« £0µ›V¶vƒØ¯†§ÜrÎe^±›déV7ƒ·ÚPR?›zHã!yc38×Úna$¢Oƒ„@ñé‹c©sNý¾yÜ;ßÈ%Ô§á³:ô~ToÒlÒâUÎ¯ÓWs:3ggäY×çAõ[­Ÿtm:iq²ùú=Ó[ "ébÞ»Î–ÔØÛÛ'~ýr‚\~êè»b9CjÙÑ6—5äÍŽ¤¸±³ì£GÎ‹\1êœ$f°Ïž·ñÐXž?Vî›ólå"ÅÙªz™ŽieèŒ}™ifHÉ¢‡úÙ’ÇÒ’Û°òk_	ƒ5º¿…yÎÙ#iç_}[îŽã£þÏ¿ÿ/ZÃƒ;¬xäºù¾|†WþmMeÆmçW'¸-ajÁeÉ•ð­iÞ¸¥:èÝÈ×ZhçwŒ˜‹I	xšpþ¼IÒ¾œÃ9D¢¤[Ø+‘W,å‰c·C;ÉóÜ--WSýñ¡Ý~%ƒ˜‘AY'T2Ž˜znt£p œÛ-ó›bÆHES‰»ál>¢*™ˆ³sDì,ºŒÕ²à@¬”#m7‹±Ÿ6Þ?ºÙä”ÓãÞ÷:CüüÐ‹k·A¹´
ÍØ®w?	DÅÇû¦@¦`­”ÞmvÚU5R¼½ƒ÷§t(u_h¹OK„RLáûçJœTãÐÆ÷±ÑgÖŒ¤¹=ìe:¢¯Ð‘ê·t¤+mÄ#:ÎWbZÞ/~œùZxÕ7ß^[ë—Qóàõb—Œs;º#K÷ø©ß5j¶»£YGâ
vz?º²ž2šg?ú½îþcÍÈ¢:g37y§Qv–œUÄº$ª	Ñ8(!}^ñRG'ŒÝÜ²[6ƒ†Ú ö…Þ­›"_ù—rs]ò]æÈ²M>ñÊeŠ©âÒ}wž<ŠßÑwCÝýà`·déâW½þÇžð.£*DQÉLRÌóW¦æ˜Mé…è±BZ²™ïC%<D¹ü…ü7ê¥`%Ü¼ôjªoËEä£‹C¯º„Š%;¨¤šüäÜu‡jÕªš*®ªÓTñeIS%…ž¹-3«ì_5NapÛÔY¢÷4–»‡Šô>±p¶ï<:QÍÁ¹õ«Õ=ò’n^v÷ÇËF…Aì"¾Õ‡I¡G9ýÚó’›…»¥”}I¡Û¤eÝV	”á—øé’w‘!–‹!ìp(oÌCðîEª“d¿ŒÓQ'MÇEÚßÛZåõ|žÊ©ÆÔ31 6sCõª}÷EÎ‰ÜªµÚCu[vRª•[›²’³u\Å³Qaù\qË8³øÇW[-$MòŸ•ÁLßxJŽ ¿ØCw+â'79Yû1@“¤ëq%Hö£DÿIf2õüz‘ÏæIâ•ªrü»Ž¡-»â?•¬à$ÙR_}´Kvÿ·bÄ‹ú•V :‚aÜ»$ätóüaL¹RÞåô"Ó+—&©ªU§´ÖágÆ³›‹s·ÿ3,Ä’ÿÓ9åì¹¬Œ¤œ¯7ú;:—p+ïÇv[tªàëRÖï@?yäªèµ.ªzÊ_xOÚÙ ‚<ù±o;¤=zº&ßyô’¨?J™òEtÝdòëpÜ˜ŽzVNþA4í%N¸Ùr³»qfV#¬ýbK„€ÀJ•eÈ«Þåd>=Ž»ä4?!×ƒ_Ñ^?ºÉÄkÓ“4<æê“(ž’Îge‰J-žúÛÑÝÐ¤Ó“™·$+QÕvœIív§ÄÜ•Ni5·pzMò']¦ÆJ+ä¿˜'åø¯XÆÉOOù+šñŠúNÕÎÓbª+Ó¼Ygå/äôÌ%i°ü®%£I<æÌ ˆ5âhmõyñUÙ…(÷MGÁ)ô«—dÝ)+¾sxfÃa×ŸÿäO#ô>®.!Þ<bWò–¯vú¬…ó{k®Q<}
3‹jhrPqf«Õ^ù34ó ä_–mÁª¦d·Íß^ÿ÷ì¦<Wÿ{ÈYå«ñ7“³þ€•^L¿ërŽ=CcNf.0ÁáwÅç:Õ^×X;ÙÈ‹euÔfÍš$U‰‰YP-Ý™T(ø‹”7â†ô˜ûK¿q*8úÝÜ´oˆx4jË4}Ë2òe!-7š8BNANÀÖ"3–5áæ>U—fNBÍ»„T|¨A8â3Ô+!ãjˆÁ{'æfŽN5Ðt7¸š¤Ç%“´ŸpdîWMßôXC¹+”êIÜE=¶è.æ†wQš3¶;êY¦š}¶-“£æf Ûª(*CÅ µ^h”*œ«úÇx#+%}×èÐå‚,¥£;Þ|7Â¦1çI· Yøš
%Þˆ…€-ã¬Ÿð/tÚ¶2(b£Ñ¤Î8¢Wð‰œÄ½á ƒQ+5ÄjÔô2GˆŒDd2'EºÞÏ½¿è £uÛ¾¹ÄD‚aªn´ÉXÉØ¸¬F¥úà†Æ~AyV,{ºàìºï—ÇÅâWR¼;ô‹_U7¸~qó¸ø,—4b"Ùÿ/ß˜wüñÑ.}ü·@RYlòƒ 1¦ƒå=:yøIÿk"º¤~r„WýåÞ^siI|$-L ¦—!w©A÷0?×Ù&êÒA6)²‰(¸”" g
œ¤RKJ

Ìn¡Z‹¶ë•Vx#Å^äqvù+?ˆ>ÿóV£qÉ”M¼†ô<éQ?°°T§…*FÈ”[»©îŒú(X9`Ýäè W7Ó1 EèC¥-£%`‹Šƒ°ê)òÈf
LƒáŒ5ÏgÆÑF} QÙ&÷{½éM»p"BTµü­­{÷£q¯ ÏÃ•ÁšíØ è—Ü=*3àà-^˜a’q¤m,ð=eà)‚O‘Q¥Krì7—à¦	 Ñ…ñt ýÖirÏ¨ËgÎ´É˜ZAíd”åºÅáþC1žÑqh‰Tó¸e¾»Š’ø#UùSÛ‡»Ç ¸ÝÔ
L:ˆÝ$‹U¶`Þu™ré%†ï[4&Æ€Æoòüö§Ô¥c˜*PI†ËüùH-‡DCÕK.ùLO¬ØE<¹ã<î°›9-›^¤7`¢uqSr~O2ÞL“ìŠvZÄ–¾AruX:ß¢èñ4Ògt'L0Ï|óT¦G½Äu9 êÏQ’yù~9ß°‡‚Ã3açí˜˜Î »à*±Î´ß×;NïbS•ó“•îóB¹CKKCE´—…ê.¿ØßmÚ¾tC*¸¹"&)ÀKŸ†š%ý·L3D\K:áÉÐüÅ´î–	í¨ÉÝ €$—4½l•ãþ›E½‰&W·Ñ]¦17JöÏ®¼Ñý‡g[ÆÂ›Z^;*Ga’	rÇö¶GneI4j‚¿JÒ±d7rf¨eÈéB2BX¥Ù|2 {_°F»'“öBÓàQÚ¥y¸ÃÈ~Œiœ˜¶»åƒøæj,¿î$ÄYÓ1^Þ¹ËÉ50L"ÛýÉƒ«tÐ#–ñåîáÑqÀ®¦¿Ð”’ÌgË]¨t3™²—ûAÒÁé-f†º£{è,þŽµ¤é5’K—;P+ýíMz3¨)½S‡2~˜ÆÓgŒF¦;l+²ýå*ÅÚ‡ô‹ ™šö“JÝí Î”×Ž/* ÝûˆzÇË‚C€8B³ž2Î ?N§7ÎPµŸ!ú¯ä37ßhRdzÍ¡¤jIQò|O™Q–}Fç}|ÖåÎÜufŒÎòm¡=Eÿú×ÓºD’b:Î÷ºžÃ­ ao‚]Ñ(Z}dÎB‘y¹¸£¹»Œà>…åH›xo‡Jýˆÿ°\I£ ‹+˜Òµp<Núƒ».-l’+WiÇ0AŠÆAãe$ÒWƒi—hü³ÌôˆÕmThj›äayBDæäˆ/ÂL³Uv»ì¤Ó‹Ñß«t­¨X&F2ÆÓïj§ OŒSÕº5&ê\÷±º„#Žøàõ1]ÅPjHî#}¼é8Ñi ¥,ØhÊøøòÆÍsË4ï	©`Æ‰NòtÐÃ«)óÌëíU¨…ÓçK}¦…ˆÃy‚µµ§>z¾º¶Ñb—hK¦%¾®Ë¬ÔƒË$ð´âH9¢]l|ÅiØL3Y„:7SçëÜ•:·£kÈx#:8‚›½Æù€
•®‡ßb»Pyn(Å{ºÜd˜’>H†SwÓ1ÜàUëüšîò–ºÌy;S{‰Ç<…ìRO\àïjèªå˜Ä‘ÁÌªëÖ±³i›¥—bP0&°üÅDîr·8z¤að{E+Ê@³w–k´¢Àcü‡AFÓV/«scµ¡ë."\]“!Û‹ŠZ©ö„1q­7!ÏšÅò„t½´r}n7Î¾WÓ]Ì{ æ5±ƒ»Åæ	ÛÛ^eýAzÞLÝhsÆÍZ³ŠCYÆ=èMl5>S’C;•6IÝ‘ùŠîñ£~G¶&l	bÚéƒ±“Ñ~#É™“Ô<ÇhìÜ¼Å0îëE¹ºˆV»g gô?â.3z†-Ló’ŒÎèe½éÍ«§ofÊvô³EBiŠo¹»Q:º0ŽäPD·àÄ›JŽ„»Œ{ÈÐT†çvŒ+2bS&ñDdÁÃmÁÃ$½½ºóëêXÖµîu8ó;.šÑÊ¾¡ÈÛSéay›Þf0<µî@â…f_‹ÄešæVéËqKiÇ= fqW-¡àÖob¶X]¾Ûô’ÀœIVl?Ñ²Ö›†þÌ)W)1Ùöïˆ	»l¦@ójÆóZi¹”ÂâØ#–¾ÐŠ¸‡z³¦>Ö¬ü9ß:Ð"Æ./6Áè:ä‚Å7£­Cë@Ž¯b‡˜çoyœ¹€;‚m×ºA"ä
ø6ô`ÅÎA›\ÄUƒ²=fô´A
%q†¤PX6 C•Ì¥œd±+Ÿ)ž•µu·´ý¦dY4wŠdÞ¸˜«æB1âšº<—!“¨X† 7™e€ˆ®‡&åVî±f½Õ’eºšbæ/“Éa’]ç±aÕ«ed¥dS“,´‡3Ch-°k‚4©5ÊÐaAò–™|¨R>þkMÍSÉ=È'Î­­ÞÐ¤’jË)C7B÷Œ¹óÉ-gÎóFÒcÊÇÄÿmžúŸ¢oOìbycu’61ƒí±õòº¹)(}–+u“ô³~_S{qÆÑR{Ž8á¦mr)±º=nŠùw&ûÏMöÒ[ˆ‹ô—°[·cDÁŽ•ÂåÝ9þúkÜ*>*sF$>Ç|‚ZÒYö­4ôQ3å·ñ`ÐÂY„õwÔß¦vN1ùÙ©ÜDœ
b¿,„ßè˜ÃÖ”Ýa&¾¾AÖ×V—ùØø•¨øŠ}ªì¸þºˆx_…l¯1%ØÜ*x¬vàs¼¡Ü·Ëý¢‡”N²'pÙ~æ¶S‚
	s‘),ÈÖ„nöâdû´p…8]vvF —úô;úë{¯)…¸$ù‹ë¤Àé¹l±·É©¸Q‡¤)7ß‚A(ûâ^Ñj}çU¯z\ÌOêÏ¸ÛYšäN4sAW2Úxndã8º®ò–»7+KiaÏ\W8û®ÄoM:£ÍÂÚ$Ì:ãq.ü4gæƒþ†}Ù"2‘·ÁÂH¬k3ËÕsHDÄÐ‹Û(Ã7voš¯H(Ko!ÉHkÈ‰d,ÊÜ‰­][‘HA%ãDCÜ¼¶)P6™>³%í<µ5½­È…=³¤NCùÈ-•'ÿÍ’Õ)–âˆÔ·Õ÷ÃéfuWîctŠ:®	ˆð¨îw…ÂÊA±‹p}NÔ„õ$`Ã¸í…¸8.³^qÚäÑ)ÄÍvUˆí^a
o÷™r>²Æ?Él¹[‚ÒE´"‘wgx%ØS«ýŒ7‚VšäTa!t4Tlþ ŸÌèåŒ<;é\½ÏÃGcvšs£©•ÂÐxÏüïŸ·ùñó\Â{fYC}jÚ½Jn£«ö ™þ÷>ž¶»éøÝ2sKükz5úïæeS==ø"ñb˜Ç·
áÿ”µªýÙ—Xì€Y°‰õD•<GÿË”óÁqûºcµû’|çCåOèÖ¦í7¼Ùdr¶C|eƒnÔt÷èµ‚sòÜ{ÔÖÝÊµwÌj’ö¾Î¨GŒÀjøÍÊÊÿù÷ÿw5|JÒìå<ãnt*ºÚ·\ŽJõ‰æãiwBlrÒ!ýtî+7àrµúìÉFÐÏ»Ü9yå¨˜ˆA«¨½›OWé÷vöòµOG¹×ÑÆãbé0îGëT`­ë…^æ?LÇäSîÆ€nW»ùÆ£^/î©\ª×k+…Šeˆ´Å¦{ÅB´Å &×ÅV¹í…f S©õô´…"+Yâ^¼	Ô"!±h~Q©wY&5¬‡¼‡+\GÞ÷5ê“Ø%EKÁµ’bÔ×®Z-¯'³ô´øæ7’2ðÝjñU—&ÕnlÃn¡Rš†OÝÆJÉë›«4£ÿá-Yû¦¬Wï:YÉh[„û½{4¬6
ó€~Š½‹3•ŸKUÅ‹Õ5ÞgKúq™D…ñx¥¬›ª†m>c•}ìð0+_ÿ„×k3ªßâêgxñU´¿)61¹JP€'º½V|?N.Rºß3™Xm¯KŒ’¨+oŸà¥óÎËh0¤ûpw&ÄÏ!q¼zL0
cˆø…àR&.òÿüûÿ
Æi6}©t”3XÎ;‚™gÖ¥¥ÉH¬iŽÍ’èwp›kÎâ+”xØØ.¶V»Êá fs+Õ Ýfa_|¯ûH‰ÓÁ[o|:L¸a¬;9[ÍMMzÄÊDþÂòGÃ—QÓ…ÙÚIa­”Ñ*c‰èD=}˜›ü–\?jãUS0šÜ{V|ÓÈ[Û<fg†húc¢K0­D[=ôCµ£fK8{Úóá	6óC•ŠY/¼7®à%¸<U"ÔöÒ.±55ïe.aFåü¯UÍ?Sô¦¬Ù’ \Á!¿ÐFOG“«LvÍ¥&áwÒSŽ·úœ%ø“½Çà#]K-»p>,ƒjÊ½tL”Æ—vpÌæ+z—@:âÝ¯oßm¶1	Ÿ6×ëUsÝÉ€6gvÁKç'9gûvpØ“ñ«—‡ÎýÆþÿsfxÇ]þ‚,ˆ£1‘“Œ“ÃÀ©ü ¯‚°-ªbÃiÐdHÈAü!íßÇêÆlÒQk÷Ó	'ÿÎùãª9GÔLð³Ü ÁN@Ç?ddG"buçM¯{iFœÇ(q†HsIY2¼‰À:cZít Õ=«ÍCµïAÐ ­VHp]K‰šu§‡é„j†µcÆÃ,=þí'y£’ˆ@}“L¦po„:ÛåHÆ rž&hÿŠ.9žwŽL [yLÂY@D;JÍ™ÿCxþ7,É¡²—i%4‹ûG/ºÃ¾EØ‚¸‚±À
±0VI»¬óÄìÉþœýlüÎróíüåÒ°póB,Å»Uâ"á6Sº¸ÕíN‡p‚Šƒub€š÷˜–.ØÊqpîö­%•=Guˆ™Yó—$›Ã¦ÜÆñu-,Œ±°MlÖrýéõ‚UAVËnR1ÛôÅw„Ø¨Y,
>œÚíÊæàaÍ¯ûÍkò™­Bbüã¢ë¸d»|fëýÖwáB,Vƒy,%+Ebâ`^Gp&y“Ý °WÓìºé­ÇJûX}ZÚŸª=„m€Bâ±2A£SËÞÍÛ>‚å,à#Ç×S‡KÚNa—Ë
‡Â™Ñ
ÀŽ¦zÚCúÒ ô&Ê'Ç”Æ®’‹d¢Üïc(éØf‰Ì© ÷ùÌ\¢øŠ‚ ¸ã;¸1±H†	Æƒ³>6Ã‰²`uL4ñÃÊ'Ðõ"”lÅPW•Üø&âØ<ÚÀÃ©š"¸ñå%ÔEBW1ãÕdr“m./ßL/ˆh·GÝ‹¤=Û£äªÝOß/¯¯­<^]{º±ü ‚¬íHí,°¹w/Ðó­nÒŽb6´+Õã~Ü½ŠFÄÙÎX4ƒôB] -‡²bPM‡˜ŒÕ•>›½]Í„+h¼O¢ å­}AŒG|Ç&þo—£vè˜23«ìL{GŒ_ŒXav64Þ,, Rå;ÐMÆ]^&ø¹DtyZ£>ÔÞTÛ NÙwÁÆŸ°kVWþÄ„Öù)Sµùu{{[\¥›awY×¾üfûñÓõµÕÕü¢UH¹þq¤^ÒõÓ¥šWXÝŸ¶ÁOƒž¸&õÇŠ‹°ÕÓŒš#”:˜¤Ã9`ñQ&WÌšå™}.n¨¬žäìƒÁZ ~]¡/‹œ5­ÐGW13ê2¨1	Û?íäçX]Á–4žØ@¤WG…îqÚŒÄÐð¦7mÍó^NGr‡|+õèZF3à^¿ž¬„z«ð%õù§vÐÑÂÜ¡š“3àâáD_×VX[ñ'LõED;0·XöÇ_)þ¸M‡©K2£Ü"J&¾¥
TVBÞ”Lš?Ç­ª•Ë ¼±Å‘8ßv„7Â†º­Ò±H¤4îUí(Nî{-8S2ò|DÕ"äuQÝŽ‘ý/šÚsCøßÊñ¾‘å2»qfô5Ñ/ÎhAþŒ‹…×ípXîX”K‰+@(Äoé¨ S˜.ñR½V•¹æˆ[a©”Dñvð£bÔg‘±Ì³.¾o7B-i2Ùf NÃ ¥ùã+†¯‘ßèˆrhˆ,±·„™19k{º¥üo6¦Ô5-ÀPK÷ºXb¶¶Ù·G7	UR[ü¤á‰©B@ÿPÅ¡ñß½ýÓÙO_kö…‹vQûõõÉáY­éÚØþHÚù¥2O;ÿå¾­RD‹&Ež”¨¡K5ñk…rEµûJ¹^ÛQ»£ÄZ»¨™/(Þ¹s«ß++Ñ·¯ëóõí¨k½ÄäàëÛŸ¢Åâ0ºõ2ÍqA…>WuþŸYiþ_:ñ¿¹Nœ¥8'îáø}Žû,´Bàg}Š”ØCX1´r{GTPlR5J­èñ’¬¯ÈbBâQ/ûµß
)ˆas@;b«—’ÐL×8¾‚XD7—
Íº¸?áJ:[yòÂC$§âýÄ„>Žû|*•$ìèì«Lü¢ðRN¿ Í?–¢{›cuxDÏ)àX#Fñ Mþµ5æ©£Òé<³l-™®Ì¨X‰Ÿh‘7FŠâ†m"Ä1D›bfUj¼Kæ­DIå9òÿ~ú©UàVMý®E¾‘v²£ ¡‘ŽàEšr__ú™j™œNÊQQz$Eé‚»é ×bÉÅê$éÂ—ÕÄìHÌ*„zHÉØ¥ûfföÇº;ê%´kfÈó[|d[—¨Ç‹SÇ>–€’ÑµhââÑ§zFpØxÒ¢ÍID’&‡Ú‰ LèÃ©%tGÏ=NßCÑ³Î€£¤¦"µßäMÒHÖ¿PqÃ½#7¢ÞŠXµÕÕ¤¬<Y]ûfmíËåG¢4µ2Î$¹¼!˜õA$Ó™ÜXÍå‘BväèÜKb\€*€µ½"ahÂÊVV
Ó»#¢ï‡vêì!ÑR»tb„,'‹5*Â"é×Ï98/b±0˜©Xc¬`O‹ODÆý;‘´fŠ¸oÆ¬Í‰s¼F¡,’Lã†+]‹H¶yº`N r¶êffK´‡éÅ4s–PdL©€ƒI‡¹&êÏ¦h:éQA®(AF;šd¸?Î–Y}y”©ë!R^ã‹5L2Æñr—€ýÁá38rI¢šä‡Ÿ&‹Á‹œw|’êõßtN²¸Qt¢ó<ÛTÚ›AÚ/¦Œt &uúDª˜!’4Z
0.^VúFÅ´œE“Ò×p<ãÀÒ×ˆ+ÿNcé»¤—ó]ãÇj6›m™§ŠQC6§¹Ìí*
¢,rou‚zßWQÖßFjÛÓT=lë{¿÷Ú8¼+ï~¢"¯|¤¸ŠÔ/oO9ù‹ZµÊícÓ¶,8+îfÍŽ®¾½¹Ô/¨ôZ)>ê<M&óh”¦ŽÆáú's™µ•×è¡ö^[×G?K N%gÍW•óðÌ§³yÞ~KuxÈøìŒNSoaSÓó6mÓþí§:x¯üñÛúÉ¨«žÐÔ½ÊY'ä£Kq[Í¦ió-ÿRøŠŸº»pÅùdV“Î¯R‡ÙcŽ´’T‘±ç‘·ù¸k§Í äaÖ}Ö÷6ƒ;–¯´¶öÍ4ãÍäçpá÷šþ1Ê%%© …óë¼	nIn7ÜÉïÃ c¡¡òLøû…¯–b¹rî¯éTþXQDŒe÷Ý!5Ü’†Ø/WgWAEt)ÀÖgÆwTHÿîà‘ÏƒseÊ{‰‹¯9âˆ£	dµ“Ë»†ùT¤µVWšÍûs ƒ¤\¯`‘˜	8„1.N·OæŒÚŽU“¿wÖÑ¾ªo•559JêDBýö$þÑ‰6àmÍûXìÉ,kÅÛxvì?À²æ–ÚµüSñOØboD«]%ôË†O!Á
Tð8=¡âähe$1Ÿb`„¥ž`„¶¹Œ£­Ô#g—èGùEÒÏ×zZšÐ£ÎapØy¹{ÐÙïÓ¯ÿ|Ò9:ÞŽ5ò06H$×Aø\…T’d“2†‘ËÀœ
Š[gÏsÖ…cA/ã¸P£M„ˆÙ>™0—Z;Ød©ùP¾êÂ´©¢Íp~ò«jëAI³qxykN4	 žF±Î1'¸5k xÅ‘Õ¥F0èºA©ªœNÖe—È.ï-Ã¸KkSˆÔÈ¦$„Ñ\º.›­=:áð‘Þ²?˜@¤À•_."%|±Ðp·¬m¢®“œ>RzüÌ*2Z5¥­†
®Å3–}K 4XŽÀºTb—ÈÁF¬®Èëµ–R”dþ^~Â5ÔM£•µíô²ÀÙ³ÚAþ0’àKÁd=öS#²PG$DâPõÕU“å¨¹raÍØCº{ôš-"˜Bi Vf©ùfMBP•|½§œD8v¡e#|7×š²¾öKiûÈœb®å£ª?Ö8‘ë‰o8™Ó’OæòÌ'sÊZÊBSãÈ¼Épì(s‹²+ÞìBÆ–2§œ1¨Ì¶«Ì)ãÊœ"°²Ì ²¶ÌkŒ.óæÁ˜^æÔ˜ÅŠ½X]›SPŒ1‹Õ¶½X±ÎbÅ~Z¬ØÖ‚#}2o‹+«ÍœbÖx3§ ØpŠ…,óìÐ¼RK¾=2Óa4j]¦Ý© ]¹NÅ:—„ªû¥æ+N}Á¢–ôjlÉLà± ¨=óõ25˜ PÎÜ]ÀàÐ¶6ä¿p´ýøh2|Wàÿõx'ÅCåkÑjúšÖÓÿf¼wñ+ÝÎùOŒz¹Vªº¯As_³6ÔÂZ|®®ÌÝÔê‰ýgÍSç‰)Öªv”åÛ‚5ÿ¢í/.ö’)©4ësæaî|uûì1±²øY«•ÓËÇée[Tùž)E¾^m­q:nÆ_4›n¦ÑmT4ÙµTÙív…¢ÏmQg/Xövâ‰
Ú…€¡ù.Hšï?F2¶RK÷CLT>=ÕôïPéÚ—®Ô* gW¬YVFÞR<0ŒræûŠjçÍÂ§Ö;o"æ×[Ô‹Zc>ì1¢t¸²h”q‚õ‡ì¯i´ðäˆ4ñ]%é˜¶¾‘'`Ö8è§Ÿ‚ÿÏü+eì¦®}æT]lŠ5¦­áhš‰+QÂÙ Ø´u9<3%Á¨ FrÄo¡È’³SØ+¸@Žcmþ`Ðbô$ ÷M¦‰Ø2Ä©”ö¨›ÜÛÃR(æ’rDEmJt¹"’<nY[‚µŸÛ›­÷iÒ3ÀF
	†@†Ô‚®¥aâ>\›L£W:@¡cñï{ßA¸šÄQ¡ðt±ÂÌÏ:Éº®Øíù–Ö†«PA÷:3;¦…änc±lgjù
Ø5ØÜuè
á†ÑµÂtM‰µƒ†V%FÝ"íhx_ôÙ˜7V“’Ûï6ÿÅÂÀ6:­€Î3àg§]ÿ­s
ÈßÍ/‹£Ÿ,u@ÓÄ»€”O>lê+ãŒnÍWu<œÏÉf³s"åˆ™fx`dšeì/Ii¿Ê¡q”/¿!SÁm:ôZ]šÓˆ'À{¦óænÞÏÝµe»M-ïViòkatzi˜Zñ4Ÿ–èä¾€2'Á‰iíË$8š<ýH0Ó[Pbf¶Þ¤rˆe¿P¨œªƒG¼\°Y-iÇöëÿÔÙ>Æ”KÀ×„}N?ªÞû®®¥Ÿ©#˜û”‹ÓñCŽSå˜œsšµµî¼òi<ˆ;hEµÿÄG}`sÝ>â¬Ø‚µÅîÌM,A÷
[Å gƒ8¾p¦0 CúGuÈ—ÞÍôjÍ,³1Ív©Dç[¤*Ç¸ux¸õ«;DÚÃ‚ÛoåÏšhù§RwŒõø±8¿y7 @\JËÎ£ok{¾‚Ú>llPü®"ðûØN‹U×u<Žp°â8ßß9; l(\{“â¥‹(låHû@ îFOŠ? ½8¤c` ŸÅ=*ÑÔüL<Ó”ëNhàÍ>£á•*¹E¢WKÐ®åR˜žÑlïïÜìöŽü+ÝA…Ëö‘ü›µ›ünþ„¤(m)Õ<ëgý,Ý^þÂîë›‡.§±(¢‡t­Â‹f˜NˆÑoWú‚ýø}°F¿6CþŽ8ìž$T!¬¯¶•¿ë5GaÅHù§ÔÛµª>r+÷¸´DÙŽ­*™ŸD–e:>NåÔpÝ%µS)Pdþ–Õà‘êµ{•’M¬út¢6Ð¥û>!	@ÆìFT®¯ýq4äèÖ÷IÖ…½È˜Ñì¥ÑDƒ2Ø 5v&a¡.±'Ô3#$²&Ã•[]þÝ—<-w‰‚ŸàÛš³Û@ZœM„?MoÄfus…¦xd[¢}©Øï„óf]1|Ø*>ù”u0Z*³eS>X¿‘=2Ùl]p`³#§cKt9ýhr—Í¤¼`í@„'öÄ@97Ò;NöRå›¬$.¸º›TzV¡n³Þª«+¸ >2¡[éë&öjËrèw½i²hXT}8šãÚˆCD3ŸR9féX‡ì¨pë¦°Kæ®G“åéÈJš"ÀGfëªšºizm<æÌ”&ƒLM¿Y¼‡¼¿sKèn—™À6`NÁî{¯ãYî2Ã£Üyóöã“g;0IofFDý-9©‡ßzóî»âÞm3ïÜÎX¨O¡™÷38íô&Xo=	8"Ð˜¶mšã› °wV¤¸èN˜Q¢¢âÙ®‚pÎPË
óC¤.hŒÚÁ®¼8øºÇÆAÅBÆãaNÃÚ¶ŸsÆÃ9B}3ê
b©e‡•µLpþ¡ÈxCI
òµÓ(ö¯ä¸–sý´_‰ãë9q|ÿµkÿ¦»6êõ”ûþ²§!üÝ7péQzÖE7Hq½ýAnºP—™¨| ì…²Dï‰à²Ð\CŒ]®´P¬ùNñvšhxð\@Aõ.³Q©ltº@a?*s‘¼(Ô>0Q²‹”µq‹ûE»áF².P<"»ð´/>*Ðu¢ùÐß>ÑAÀueš5»@Y	 ]  ÄÓ.2i&ºv‘æU¨í"ûÎ	»] ¸Á]¼0‡ã.P\‡æ.^óöC
wRø§‡ÞzÐl<YìL™8ß
»A¿×Àó.Tï3ç2õ*³îr¡ãÕæ¼µÂœ+[hýäB×u(Ú†ß²0ï}fš3¤%ðky'¸Ðxº…®cWh½·Bå¢*?¬Ðq¶
GUè¹M…ŽoTè9@…ÆË)t\™BÇ_)tœ’BÇó(tÝ‹BÇ‡(ô…BãäŒÛr1ÆØlMU–)*èË¥nW»,Óœ—”ÔÓR~ïÊÅ\q¢ttÇíŠrê<]º¯Ä(N¼¥“}Vy’MHÎ*¬q}Ç@åG@í@„Ž“/\—÷ðÛY<ù1ŽHPhÔ¶%	w'ˆç$þ0YfsJKª­9èÛþ—Q÷*nWZÄ´ÕÅ³ê/ÒÑH`'Qü:ŽoZbkeáeU¨ì‹`±‡¸ê?îíÚ{ÓÉëKÎñìxãÔvçÃÿ
‹ûì°¸êÈ2 ÏAWÃ§¢Ìrq 2ÇÌŒç>þ(¹²ôŸïay£ù¾÷«ãÿ,/G@vQhŽ%=« Â‘€”Œ±€>„HhvsºÂ&[¸vÓ¹¤Š=úYßÄ‘Ix«ÑlžSÓU(ÓÎnÉ¤QoÕÍÙÃ÷\ÄÇZÏ'láoWNÝBM‹˜‡ûÑ†‹èmÃ	qÊ<çD TåÚé}Kÿ¾êü¾rz^RS.ÎpvÃ¹Gk÷ì!{KÇ òž¶Q¼ÑˆˆxÓ­v—§qÑÆú6ƒ–ÿ8’Çv·šáuåïÇø¨¸Û9~°YrøE!,µT”Õûäû`£™“s«¾à0¹*Æ"Áø„ùC“ÞÜûñt–˜M'ÈeNê/Cœñ)_ A„P©9e—òëP`åZ‰XE^n ƒ$¹´ßŒkÝ­øa*¹”ið_®yç<ÉÒÉ	OD.r¡¢#yãÜg_4Ì”ùQ{…Â2ßt…•n»97é$Ñ‘¥×8ýÈ¥$Q¡¯þÓ¦j©ÉÞK£ÙíKp>ÓóÇ”ÿDlñåkøÌá¹TØ, )öøÊ®Š#äÓ}¹R~ŽF}
Nçé»²jåžQ03q…¿©©i_}¼âCy¿É¿RM Ñÿš&£FÝ^(^å–—’æF)s…HãÓ¦DE7.,¼(ŽÖÛý¥OªÕkå¹ò
w9u†ë¥½sƒ«éîØöªé¹¿Â’n|F·WÏ0&Á¡']a*ñÓöñÞoÙè_KÚ(þSI7ÇVéÛ05çænÀ—¥¯ÕÜÍèÖî1öƒó ¡QÅ;a›ö«ûæ¹!Ä6›éM[1¯Úâ”~î¶´ä(µEÜúD].bHhmîƒÆ6³xf€0¨7©'Í’A{ûÓíŒIÕGûu^w²MçŽì\¡¿ÓÕFí>í©ÏËßåµ’°
bPL@m÷»‰æ]í¡÷Œ÷ÿsãb·ã½nðÎ!¼®åÃj›"ßÖéôÃïQ;&¢Êˆ‹h–d?Š¸I^ñÊ¢%T}lKTëä50Î3;,óN¥?ºüñÔAòf€î¾Üàw Ü°s¡°šÚvÍçÐÊ×·€ºû´?è&ŸH·øý¹í¥9‹vÑØ)×Ýà –BzuÙÝfâœÝJ,Ò~tãáî«Ò˜#GÆ\[Ösí*X;^„gÜ‹<ÔÏ^á±ê_R€îSÚ¤uqNºË¯DT/YVçÐ¥Óq7ö9º6KŸzýäoÛÒIŠÙ6Ÿ¿€Çí¦·M¼ýò¨R@~ëÌO£²\NXì£©ê†a9ð¾I£´ÓtÿÕG}#ÜŠ,6ê}øÚ}gû½® †pº-žWÉ8¥}hÀÈ2ÿŒb¾]N²rvšÎ³§°¤b‡YŠD×±ùnd–zÁ¶´ÂFyO"Ì·ø>òo¿úˆ¢÷§ïFç‹,µÀèVØ›3'w–µ#œ%Jß{í8rœ¯÷ÃÜ«[¼8íÅë½l†½ÏÏáJÿöåÞÖ«W`9898ì½Þû™þ8îìuö;Ç‡¿ÃÃ×‡GA£ó×í½“zõòðõ~°½·{°»½µllíýz´{ÔÄ\™Ám€™¸dfB~i9ˆw£zÓù–‰.‰±@W —:hUt‘¾µ™:ÈpVFýeäŽ_&Eü³«är¢œ±ƒÇOa°Ò¦Ÿ€?´^V°HÒÇ•*®%Ê ?l›kŸ‡?ù \¡RÔ}LFæªÐÂUp~|ËÁ*(Gh„O±[Ê2OÊöèµšG:â¹]GÜ®?GíHryxÈbáxŸ±kÆpª¹‚®<Ø‡#.hO$•ú‚P?¥Îÿ)ùd>PÉG z¼Öqñ£>?/íÜ†ê“£ügãÇ©Š_¶Ï?ÙF[\>Ø&XZÊÁÚ”á×,A"ÜúykwoëÅ^'889>ÜbÍO_ -.mÃ§J›–è¢ÔÈÐø„žsGèyn„Ú-#´>¡q¨o‰Ðw…?‡P91,mÿ·G¾Í1T>	¡u8µ7AÈ®!û„ÆÈ*~è˜çCc{Ãz¨¬ææÙ¶ù­c~ûÉü¶e¿}sèCe–eøÃ×­ÃÎÎÉÁÎÖÁö¯ÁÞÖ/¼«íàÏ>bö²¥8³]»î›þsÐa—P{­¸kƒXã:¯jß«P»©¦Ýt ¡aœotScÃ¼>èÕ°:CÛãÆn¢»AõÚKkÜ½î˜8äWƒô‚Úß£z2ôkGB“MôÀ8´I\‚‹é€æ20Ã’Ëö>²÷´/5G6‡ç1+Â*K@$¥¢¾ì¥Ý)ãáq˜eXø¹rö=Ó„ë¢Ï–ÁN 7˜â\*$8óNf,ñtlC13®¹~€{v¯ÛKë˜"Ãî­ïÌÀL¿ÅÝ ­ã[?eÇµ˜¾¢•ºµ´Àjdu0,®DA£˜\Q®ÒA/ïÇÙ7.#Ú.Ñ€ZíÝ×£ô6k/Ù1ÐJcÆ¹¸¶’¢¨'q1N–`€/=ÆØœbxçÙãH#Ed"o¨›¤{-ñ7T&ž|ÿåzÊ®§
ÆîE®¢€Œ¾Â@í ¶Ðã­ÃWãàÍag{÷h—Ž)ÈÖ` S Ò:SiSyýõ9æ«âóŽn¾;Ïy}¿=m;nœïÎ¹OïÎË}è5ªÛ?9‡7ßiM!g`»1HÞõ}üß?£Ïø˜s2— %@]Ñ<Ç	Ž	xKÞ¹cÎPbühçÒÕŠKs&Žö4âhÅÂ"dAíû`µ†BµïŸ+µö|8€sG°¸o«,øš6<µ»Ý.	/ˆ»Û¤ÚšN®(¹ƒ#ê‚!lKQK¯DŒoú‰ïFÙÊ3À­M$}Âr€N7È 1Ø½- úÕŸQk/mÑ’¶^!Æ‘ÞáLœ";·Ô'œNhùot_$fß(gz‰ ïétbÂ(k»°º=`zE[1Žþ1m¨^t'ó)]g»ä·ß".Eåî8 ŠÓ¬PêØµ4šD’h Èf ß)&š‡^OVîJòÓ´pHC	NK´²Eæ€+?`”)•¾ô>W|Û.,ð¹XQ=úup¤öÑ>í:Ôïì‚¥cšàÎ· F!Õfð±m¢¾bæLùö¨£ª³Ž¢vÉà>0]™”ˆÜ¥{¡-"21äƒT‚ÇxÛˆœïÌè·Ø(4Ç2¯œþ¨½¤Ç·—Œ®i¯l.µø×àç$ë2\ÄV/¹¡¡Mî–_ìï:yâ$bO´^ï“Œç£iùøÙˆZ‹mF%ãÛèÎÉôÙ‹cíq\®Iºloªï¿­»Åé[Qäå`Jûê…€ck€¨Ð3Ž¥ë[pÆà-èÒ åd²KÇ’#ŒëÃÌŽ$™²&õtQ&·®é!,Ä(é®šE¸Ä½‹¦×{Ýâ¹T‚•ýžŽ.¦ãgû³1ªÌ3FDÀ¢,‰ÇpF£qèŒV´É§2^úÉ\Ý==ÄOKP‘©ØN¸ ˆ+Ñ„:JH—ClNš:ÿC¼?­-ƒ|ŽQi“©°Rvv‡ðU†dh¡jp†®T
çý½€Ì0‰;Ó¶<ƒcn¶ºFê˜HæÄX8œÉMÄ@)œŒQ4“ÛuëN`Q&`{ÄÞ.ÙkMêÿ³¶!XƒË²R§™ñ9_WˆÐÓa4Â´()u€;•XÅ”Å\UÍJ{mª:›hS€R¢`u­Åé5Ü¿v2$ï…Jvd×ð@Š˜/ïbóFØdn”é6í*¾eTÌ´výLzKWc–	m‰VRõ3–DÆ„f¯212Ð$M
2WèÔ…^þÁqªéÆ…ðÍ`L»ŸØYâ bN«Èw7æ¨^$ Û  €Êgõ°fºIO±…}ˆ3§ãËûK`F¡˜Z_m™­§iH[ú5Íø˜¶E¶´ÀPx6òôiô„L®ifTÔ¨ˆ
ÞHåÜÇhp¼ÅÖÞÞŒè:mŸ;‡‘%bhÅD‚ï„‰‰qq«ŠjpPFUh´NNó^oêÎ_·¶uü´6]ûv¥¯¸„M×
aÓª\OtnQåZu5.ê_ùöVLöTàå-„qTÄÌy¤`‹RÃÆÒB2íÏŸï—Š3_Ýì¥Ý ÁÓ(ÍÛ%Bx™˜Í‚ù‚‚¶•à«t FkÐõ°4YµV6Á:Ð¹ØêÇË¢Y
w¶è”V°“u£›8ø#Î6S„Sj¥æïÆj¥u‚×®ÿç*rÂ@§“VzÙfÙ&x2»yÂAšÐ	Ù>Ü=fýðÎÖñV°{pÜyEOX»àôŠu±"šš
sjX,«D	>Ã:8ÖMô¨p¨FwN ÈÓd	xêbzîS’ÝˆÙ"ÎMiJ™uæí&â¡+¡½¡^wvgCÑ”ãàh5Øy%÷Óq°2æbåÿÛñ—tYÁ§Ùœ^czrÜ_AJžìŽþUœ°79Ãb NºT:òMë‰þ<ht¯¦£kë<›dª©ç›ÈÀPº_¼8T)ßLŸq¬çØ›%àÙØHÔë N\ÑfÀáü¦}p‡Pî˜ýÜ1BÌ‰ŸÖþƒ›5ÖLÇ¢hˆülÜ,·ó»ý>|—ý¹ñöþÝéis™–­öÕjÍmÞ¢KIm6!ðÑ¸x~ø‰À%#TèPüº3ÛÅv«3¾Oá_Œ#1£›sŽš×—ÚÇZÁß…N]Éxº«¿ºw¿bc¢mÞ-I–ÍzöƒÓ7Ã>˜lÆæ›€uè¹*Û0j:“1QÞtá¶$MaË„s¯ä-]-ÿ»ÑñxÊ¦²žÒ¡¡€³ñ2d:ãÔ¬ÎCe›k“´ÒtF'CÑÕçÌíKÖÃ–ÿ—zå²-—ë6Ý›‘“û,£±ÛxÞ–(œBÎZK?£‰§Àñý/œ¼¶óŠZGï."<óŽÞÒG¿u*ØÎ¦éïª’¶Qi3º©ÑÄÕ*æÝ´Íµùž¶«Ê´›ûÂ£!~Ýø
þG+µb½Aà×þ÷Áj¿–¯(òîüu_F$}/Ú*'ùª$ ó¤Çmã·!G8ÄNçåÖÉÞñÙ«ÎAçpkïLÛëÎDï{Thòƒ†“Õ2™‡é¬@ÎÅ‰X“_kÎµ¯’ÿ|³b±½TÃ}úÒ}™KL3ºá|iÂ¨é…óQ!ãðÁºó™É3üC°Ú~bŸ’¯swHv·e¼´Â$mäÇ¡’S‹î(üÂÔ®÷R%†¨µ²â$|u“S…½—nšàÿÍŒ¦¼W*7ðÁSç¡JL…W§NFà‚7Û­ILŸl¬¸o¼<ÀXh·q'°tÌIì%ÿý!Xk?v«5ye¨ÝBÛüîÛ’Ö:ª›Å7?É›µ²ú¶T}eï8½/6Ï7NNf_¼Zs^yI}ñrÝyiòùÒ‹':¡¯ò)'ð–ú°\‘DWâÙï¿ð'éÀ%zW`ÃÇ,QSnƒ1[nQOGñ¤ñ¶î\8ë#ÎhKæìá/96õSC4]?šyTÍºq+ÿ*È½‹¸ÇG™ó*æUAvÂñ×#É¯òYÇ+z¦.ÂêU¬ÕSgç9×ÉL\ÈÔíH—]‰¢.*W¢‘}Ò/>¢í¿9M{z;´¯"É;F²•Ü ÿ*uÑ-¿ýþ‡gïZ§Ëç©úÕÌ·„¢…FŠ¹éÐù÷$ý¼W.“þ-^2wþ§?TºTþûCW[jŸË0<xQhTmTy˜õ<1’ÕzJ
ÇÓ—*¶àwAˆß<ïÿI ¿Xå‚ôŠÅ£ž‰Åô÷A¥ø1³#„W\h}&n1'@¤á_q´{˜ñ‡m‡Ç97¶rPã/ÔÃP–êƒ3Ï.¼2’šÇ¼x"5dåßÚr³ò~9ÓfÎÃ8¢îÀÇ‡
(‘³IâÐ€ôkz#Æ¨F
\Z—.LnÀýD T—È/;PÎ+/#,‡z Ø}Ü2ÊÚÚÒâ5ŸÚ «ÂSªÐ
”fx¿³js¾o‡vÑ€ºÖ®;ì¬¬Ñ>Äj;ý³Õã›q[ôËÿš^¨LC¬m^©Ã@ahH6;™&•õx>ÍÆ÷Éu‚a€Ÿ-¯‰öÒÒ–1Añ“öý:ÿºZß´î)Û6bC(¶Ì°iöTùŠÄ×Æî‘üæùº¡pÖ4õ¯¹õoeí¶;Õ·Í5O÷µë>5’32Øz×ÝzŒÆC:¿Íì¹ÐÄDp9©j’ÆâáÅàN*.¦Ýkè.L©E6ß¢@šá" Ýƒöì9¡†àNã“•Ea–<BdŽ_†ÇŠ¸•õ£§Á4˜*ÜO×÷\¼ÃK­ë×0â¤ýqts•t³g­0	m•ßØ1JRH§B1ÅuS8ö½wAá¼L‹šjÂ Šz/IäœœõâìÚ™Ÿ±¸+æ&_gQõñ.WÙÓ>'üvóA\ñQ(ý³¦Ô¶ÉmvmâfòYX\>'ùøZò° AÉ„Òd“X¶”»fE:D…³·¹ªV+Ruä¡áÓÙÖÅ]?®–Sš°\XóˆzMÚïîhû®`;ËÁ4˜µ²Co¾Ãâ|H’ÁÚØíÏ;ÍÂ—–¦€+­»¦zj¯ªtT¯Õ-¡µ˜ sìO‹!Œ¡‚bû£˜xhÒ—îg¹·³kÕ¾Ü
œˆTß¸`€ê÷µw#ÀXÂXtmhãGb>Óxö7N-Rg*~f¶|]
þ^éE˜¬²v,hé æq•Ÿ`ÛøËÆ¶k˜!/nÑ(ˆ„bˆ+´ÿ2H¶0GŠw(gÛpâ¶•"Èa¸ÙïÛÙ´Ûe×2Ýº"wâ‹i/í7Îßþ"j?ÛÖ„Ã=uÚ´Æl§S—\lS„YÝ’ÇõÞ·ƒÃè%ìæs‰¼ÂäŠNúØ£H'¬ù‘^|‘Ü§¨ïöjQªŒA&V}0à%”&èMcv+ôÇ0»iÌrsÍÒK§Ã9×ôx ºÿ%}§=hªjº©._™“Ì4 '¹›p¦tt^ÞÝÁM%¢ê;kë/¨^¼O\ºÂÂ=dÙâÊ}¶D¾rµÒsVï³×ÞÒ¸Uï–-¡—Kg–(Çë Ý!(Íxm^ß­Î5Òû	 ½•8nªÂg<˜ß —«š·|›9¡lÊaqOy7Ï2Ý—@ÁÖIòZ–ÃÿÂ¹Ö›>¸Œ½ÐÞþKÔúm¥õí)¬öŒÐ¢·«ï‡9îFéèn(.8ð›TI¯‰’³\A£8ÑÂEëŠ/ª`èHÒèƒ7þ)f$FF¡/Úî~ …ÏzÝ¿ï0-¯©0´áz†Î×ÞU÷H—.€êöÒŽøô™Šz2|ÍfÄÊ#I®8gº‹ýÑ¸õ´iÒmk¡Ã!G:éÐƒAB+–¹½U1B¸,í ÙhvŽ–´~u­v‰§K|-I3ƒô‚æ‡žÐVèîØ|o_°Ñ€^:	>©ŠAoÀÐOÇÑeém¡““»Ar“*{%¿ ¢¹Z®T-W…ZV^ÍU±šË~©ý³þ`Ú%žž«¼¼àäê»ôgÚê¡Ê©wÎ“\½lŒ<s{†š¿¹ [Xð^ðüK®*ZtšÚ˜½^¹šI_L3I?Ë•%QƒKdý1Ù0AB[qØ:jãIÊï.Iê+ŒÆ¨*K¥²(z´Ä…êô‹9vÇ7²f~ñ –È]$Z¾Œ—S{ ¤_‹2žõ¸®µXŒÓwêqu¬m¤Wîßú÷uõG/?ÅÙ•LìÕÝ8Mz´¶p²Å
“øO§‹GÉ/'ã”Èma\œgS¤]š¯x<:ÏÔ@'uVö;cßÊ†œÇ·Ýh”ò1õ9>…¨Lk*¾¡mÎzÂî†Œ=s	™©—µkªj‹4µ1ŸE(£Ÿ´UÖjµY°ÖhüU¹¾±HÕò]Ìù~°Ý(ßDÑnd)j¡pÞä‚VãÚXn²©f-É]oGÚIë ›Cpç|ÏÿÆ\I?y÷Ñµ75®Å,JÁ:#ÖÉC³vö¾*]Z.íÎ»wè¬d\yFä­sg‚ÓQŸT ž(2Êl³ÿ»Ç¯\ƒ1øœ+e…SÕÁŠjôyp¾Ûƒ+3Ô
@2…îÝ¥#QêR·ÕµJµÔ³:yê÷äâr¯]Ú¢³äÔHísÕ4½ ûJ£j•IWã®ô‘o¢ã¤M'8Ú þ]N1Þ‹¬lqFn˜óÜ„¹\²Yf˜êo-¿|šcè´YD¢jþËvOu¬¦Cîh£C(feU	Ëúñ~Þ*­ã>€‘×±GG’û\ŒàÔ•ìmíC+“w­¤W;EØ˜f‡ÙÁAê^.ß¥±•0”ÒQA?Åá®Ð+ÅcNýG°¥ U_Z=²Sœ`ªE7|Jì!«‚¸'ïÅ6ç¬À–
“ò\Ö{w¿ò÷’q¾d¸÷6(ObŸÔL¡TnîÀ½í“#,.°OYDjÄP”¹ýY~!Ø1âä¨o‡“#5j]3ì/÷öÂ`p‘ÁU•ÈÓ+zA…­Õˆc7›ì)q´«*YvEòVºXÕ]÷0,Så}ü( 41•'Þ—…výãL+âò¦´ÙÑ˜^Ð½À.µcPù…]¨_î"k>„Ì¶Ø…UÁê'GC„ª¿ìv¶;«~lŽdYÇLÝ÷ a´®üRÝ·­ÆßíÛÔðõ¥º²A)Ôa&Ú¢3·­IC*NëC„œu¡†ÆåMg÷Æ­÷AÈ1ÏÉ«ƒ6‰«“ÜÒÈ\p‚7YQîöMp‹xb×Ø§Vý~%B”ñÛV&h†:.RFK$D‹—‚·á•ý[vd;Ø­‡ÞŠ¥ã AJç©ª£ÝåÝâ°ÚÚ×_»kî ¤:œ½—"£‰tæ&WÁƒ¦=ÐÒ’Ð•ÊkÈÊ,$dµÜËíµ³Ž~=:îìÛ¯ŽŽ·vŽÌfé%È¡Øo|“Ž_¨`õ€š
eÍa½úÒÒ‰À£ž‰«ˆ%¢‚Ç0…ÃŽ4fÖëƒ½_U¼\äf$è=KK¯ýŠÅ¢ÌV7Œí—f¦Ô°_îvövàZ¶{°{¼Kƒ^¾>”ÖyøÂQ8*“ƒG`hRwÖÜ\Zrµ u¿!Ð4Ò±Q²ŸÐÀ
/-¹ëÁäÂ~u¬ãu‘r4æ‚Øé÷‰P¾Øå\×}ÎþNÂ¿­®üË·ôÂ=û§!†ª%úƒß®³ÍhÖ“„¨>Í™AA{& ™Ñ ˆc£>I`}šb_þ}ûuyKNõ4)°qX·€*úçmWÚ/	êŽz’óÒž `œi­÷‘Ð¿.G4whÎ`ÝßI.ùðNµþË‹í€“a`‘B2i›ÁJ{UÙ76þŒâ)dÒ+ä‘lýl´7Â`}íOÁànxs•vï×KÏ×ÛkaðÍŸèæÙ‡+íoÂàñŸ‚8¥[ÙÖ±Ò~ÜD üattãÁ [þÿ½ç÷`eE÷aueÅ)Ä_¯®ðç¿¨Hêž‘ë>¾{¼±¾ñíZÐH9JUˆÚf°Ö^[yüd¿Ò”Qh(ˆ)ïntccEŠYZlmãénbuyýiûÉ7\ï	Öv«›ôì'ÿñ¿Õ7ß¶?E¡ŸEOì£þòT™µöãoŸ Ì15rëDFº®‘m~ýñ7(·ŸdÌëôâ.ƒ³ú”˜‚Õ•²ðÀÍ‰J©¯4møêÀÛi@¿c|"¹ÙyC{gÙn5¤÷Õ¦7úV!úL…î9GøNyS3¶¨ "—Ÿ5YîÚºNÒ’»WËöiÐø3©©Ïø¥üNÔ èa²KÞ!w&JY£/×#s
ÞÅ˜}ìüukÿÍ^G]¹ÛƒUúBN ù%i$gŽ/X74'—¦9[ÚùÛ\ºF2ÆšŠ›ƒçf¯½@0õ/ú¡ºÂ@émaH7Ü2±Ñð)\[Y{ÒZyÚZ¡Ž¬>Ù8Uµ’dÇ§ì¬¡Ò©]=¶Õs¿E-ÃÀA§¦Ç´Õ‚öMUë«O°¹Vtë–RäÛ?0oÖƒ5îÁ“öú¬lÐðÕÕ·¹¤hr“\qdøÝŒèA[-ï<M+Ú„ó8;Ñ¾Ú¶»©½äÏdàpj[¶ê"-øRÄà$ÿ¡a¥½+i-?o•ímlä›sŽŒw”ˆ¤—v ¬ù¥Kµüý_C~1zîÜø5g?/Õò7;Þâž^ªåoâš%Øô6wy–¼ÌÔ¬N!¢ då™%4W	©…íµ5K)j†B,Õ˜øÕùõ´kK÷aÉ°ó®|øzw—NÁjÅØiGÌ¸"“ãò+4h,#úf¡1›3BÜ<S0Údzoýh¯
è†ïr·q& fq)ë¯*æªH¾àl-2WUWJƒÎD³p±|ñ©3e'Œø(g¾–N—°æë“ã7'ÇÁ.¤“máÈ]9DP¹`à¼+ø˜™»¢‰`¼@_&ÅÈü¡xú)}¡xçsj„-*h>á’’Õ€Oò«¼!'É4AŒ¬)ìÌ…áJ‡‘Eâƒ\¹«$­,p{i¦#ÿçTãƒädmGæÁ'8àp
Ñ 2½;Çÿ±C5ÂIæï\0°ÀzÿrušU@ÕQØËX­í“£ã×û…ÕB<EEÍ6\dAÍØ	3y’äÃæ|ßÊVÊ5WVCn]Ã<W<GÐƒW²¨W7Â5¦¬ÄŒþõ×%:ËRë’b³Œï6í.+îû6\´-gÐDOÜN»Æóà<ÇO|õÑûJ’ÒÙîœõq`3h$ÿC.‡Æé¹ÓÂ¦cþ7©ÞÀÔÈ.Ü< ÒŸñAÜT!µó\•Îªa?¶aÁð á-ëÅ5Ñ¯÷žoœ'¬õ<1'[¿§·º¿÷_}´Óï‚ç"‘LV½y›XcZ¨Êo]žcºÌ»¨$/j˜Ïÿ]P×l_zWAÄŠW†7T‚yu–û™V3By0L213ehGlVÞ5F×§Ñ˜òÚ Ôé

Æ°ÎöžÃçœV‹'sã¶]s½æù±¿_vyçz_0W|þ¶_ð³<ûìàdÿEç°øYnþK¿Êo›}O7£•,ƒ¸uï–õâåägW-c¶„à"ÒŠ6Ë_Â©…¢F¥®T,rxÓ_ygTy&g¡#!By×t¹[¹™*kÖ2B.óHóSÏ5Œ—¥Å-ñ¹çdÁ9IEe³ÍY‚¯ãœeqz°š‹ÅÏ»~p?"šƒVni/þ§£ö±<ñÝ»2¿RUF…>#(3ÉâïGÀú¡Ñ8ƒQÊÓÜegÚ¢ï2É
I6¤SòEõu$„Ï(-DÙ—3¸ 2AI.aú]]Ý fjŸíw‚ª~V!1ø.‘?˜†Á¬²Ù¸]k6C|Q"OõË!nƒ¡¬äg*óµÇ¿œ¿=þUúÜã_Ñï^6Åâ¾÷ny-U~Yybd)	ÝXÖ'gÍò2"_ÞËõrEµ³+L*1	±åHæˆy2 ,¯š¹6»®C×œ]?»À™Ú6ÚÕ¶øXÚÅr0_oÜÜÝúoQÚª½±—niSàÔiWyŠ¨öŒÛúÎ³¸1ðö Wõ7ÿQ>uc‰´è›^ýî>,‰ø¨8ò|dG
t*ÂˆÛ¼ ù|èbbg«9¿â3Éaÿ¦&9J\iþYÎûÕxÊÔ#TVoæ¢%’ìŸ!¹í;•Ztê{¼ömÍô3Ê°ÈUQªªŸ´ÖœXà,þpMa‡ªçCÊ”Q¥ª÷M3¡Ûx $Äp€x4D¸[÷ö|—²@Ùk`ÙR9
ˆ„³v»Ê¢¯úÁûÅ!ØˆxNï9!CÕÓµÚ1ÂÖû‚Q>Î¡D
(E€ÆqoÈßqRwc– é\§èÐ>7ˆ‡yåÆò»oßeïŽNÿüî~Ù	j1ß8gÌ½yývå´ °~Ö(¹b«©ãx„‡êúØt:œ÷}*»ÿÂ~BÎBGúRˆÿ¨o" ¢ê
ˆ€…ƒî]ošª£íg:n)‘–ŽÎâ@Ï­?¨§–N„¥à2Ç‹§Ü]Ë®Âg{kÍt¼úD§¤²Ý‘¢n—á‰8uõMYN,1¶'cÏIÅO&`‚ÕÃ" .c4§¥…ÖõÃ1DåßUj`Æw'ÿl6é9
‰M¤ý1*i½€:é½â5)Ç	0b¡îÑÍŽóHC‚"’}§0šÃ*²‰Uhõ}N¡®ü(èÞúÏÃ˜X>ûŽ–ƒýWõ“mW? |·LgÔKI‚yw‡Ã©ÿä žŽÅ7öë`;íÃGã}lÚ‰‘F%EÐù×4)#`¤KÀ¸.qœ~Hºú{$Œâ¥ßuÇq<RÐ¬ÀôúUD›0eË›×©ý)€üSË®¿™à"á–ü%€êßK.éXÝLï_ÓjùÊÿœ£“ÃŸ;¿…ÁÖÉÎîqp´ýú°CýóIçJèƒ­]ú)*¶;º6Ñ÷¤?š9!aåd°ñ¼z.4n¹ºr/Ñè_,oIöÎbê€J[bB0ÎDÊß}õ3³ÛØãÉøx=µ~÷Î‰‚ÑÎKœ U€Ùšøc6?ý)éâ;üfw#þ2*a4Ã ¦·;ycÖKU3Ù“{)ÖÉæt-¦£ì,›œÉBl{-ú~ZæK"/ba±ŽZ
>ZÉXDÝ^MÝÛSÉÒðÆÐC¹-M™5ÛÀt@~ˆ‘¸2dYÚM˜rÚLU¦¢Ð>äÜ
pW•$!‚íÍytT¢V}A»$[4tÓ«t ’î@‹³¥žÀ•Êî%L¹z“t^»`‡î(&°‰xIÁY,vâ ©ºwY§Úió!3?ƒÚb°]HgØ<¤v^ã ò±=989:¡§ôë‹Ý×€.ßÝö©ÈÉag¿£]Mbñ9„Ì„üO’¯$ï¦¢Aœ|Éìt|.©†„Q ¬oœ$I¯±x±ÑÍä$.»‘Zì×jàÑ“^©5(×a•ÞÒ¹#€™\"…,¸béZ¹Ž{¹~$é…mtYö—ÉªU;Š`àxäßå“ùF7°›•.0—Kew¤û ¼€TÊc)'rœÕe¯jT’Q„,@zÇÚîr_çï_ww.¸u¥wê"Õ¸&û4¬	çº1ý¼X¦„yºK¡Ÿõ(¹˜bg·IorUov~i‹.mævš€‚Äw¼}Ô~ê©mZÎÀ½¿ˆ}¸H`2.à°F‚ˆ¯ç#&õ`sþ,¡;vDÝ)§Cº…£j*ož¢!(;íšt>%¢@Bpâ'b€#<bôaåŒ,É\h)è>á)VgÉÂè%årkî5•–C’(Z÷p>µœ#â¯9\P¾oìTÎŸ©ìß\µ“tÁ!WJÙÂWõ ¡e'Eå5w'œæ¶Ãhº¦JÚë étÂö=‰™\\‘Eý0Ó3úP‘@3Ú¹kFy·—Ôe9Íd:÷µ_l÷¡dC`c>‘Z¨k¹OâD/Ä‡Aç½3^Ðð|áÖ”‹C¹åz© S&¢!Þ?Ö,|ÌB®˜TVF|RA	Žð"ÄOLüÚÔ¨4îAª{³ælV™¤TQ¯§”zÈàè~¾QÑ‡EÐÉ ±ÇÝå„éUCiÎÃ'öD»;®\9?žG]¦öøh¿öÂ ‘ÈÃ;N6ªòÖçR™w@MÛ¯Y6E®AVoØŸRÅcæÛ­˜ÿn…ÎQÐ¿öÉl±?³GïÏÁ\ÛhPl¿š¬ÿþ}ñí¶~]®}ÖuüC|Fù„ã•?›xR=¾ÚéRY_>ÁR\º…KÍÅ¿'€ò7bpurau}²F—²xÚ1ÿôAz«óIv!îÓvÐq>=ÙNýóíÌ¡_°ì!¿LÓKÿ?zöø?_Ç?«þÏUô;*áç®ø$eWáÆ-‚(éÌþ+\û´µùä¨:’¹l—šRâÓX@­²¨EýRÞ¿sl7OŒ¢…Ïmôí*°›ó¹²'µ
î~#È3üHž¼ yy<½HFN©—‚÷c¢ÓìWfŸm¿ØÆ_×ìJ†8´•YÇïJÎÒÎ¼(1¼ËÝ!?•àÞfMA¢Éóqäû¢å)HE”û#ÊH½•I½òÆd>è`ýÇé€£Òj´Ú_îºï07´Ï3ÍÝÆ*9«JåÆ6ÛÕùxG´æ`Ä™¿VpÏÃ„÷™25Ù½o³Eú¸µ–WÉ~ð±€Í97j!ôò3ÃvÅ*7<)ØvCcJ³±j -é¥âd7épNýÊ…Cì¬fPûB:ŠbO™¦ò3°k5´¡ÇÁÉÁî1ëvŽ;Û¿;»‡Ž)Ì(G†pŽx_¬üÉ¦f
€ó‹ô‘P®E] 1Ï”æÒ3RxiV`´èT ®r$L^ÔIhP+~Ü¡Í¸‡ÿüÌÿ= ;ƒŸ»xZÍÍ`kï—­_tø~CÈ|’YQýg{ ¤jýwl.¦CüòŠî)Í¨­­ªX#'ß˜äKO2÷t¾ÓlëôtcOU£öÐªVÍƒPÃË™'¶YuX½¦/t1j¦ý˜s¥µ7tÉïTeÒ„>ÐÕ+Õ‘ØTÕ¶TbÓ6‹Íè~ìÑŒ¯ƒý„U›™©„€x±Ï_K8]¶©Cpdµ‰œçW;ÔÝrˆ–Cð6eýeÜd:_±:<	OÛëZÿ‡Z{ïLRØR³/ ñ­FÌ¹6gÛã(1ªù3¡ï^ÈÂ?¹ËrXY‡§BîYY}“ÂI½¦?!¢†èä¦¯Uqçq­sàÇ6Èmã¥s:/ESÙ›i¨*:‚ýÑ‚ŽìI/UäÛs|ý%É “e„>&ŒzÅ¨ÕÉ¥RT¶2žÓ)Ò¯J-Dw±TßóæôG!¦$j=ú Z?±ß}Fë;Õ:ÒFUµî‡ªÂÕtZ ·’EZº¡¯màÓp	«ØuW ü~CŠ_â¾¬ýŽ×ß0pŠÕÇˆ«^o3Ð7*^^NG]Å HG¤kê–ÙÇæ>Ps ƒÓ÷Ïä
IïÓAO/fCK}°ßÊ²,ü­š“ýÙÐŸWN¹®¦c­ýDOÁzÍ[1Ñ¬qƒTÏ0‹Ô‰ÇmÇµÄ»2ÕÄTª™Ìgž‹EÐp*BëLjGŠÐs¢=ŠÐsžóŽ¡ç4V9L„ŸìPí–8H„EçˆÐwŒ+œ"Bí¡wA^·¥-¥©ïÄà­Àõ%e= áÔòwr#aÌRê™!¹¦yk[¶CUÖw±Ùn´]®V‹¿^iµ®%¾›šÈpÄÆ6ü²C“/ ÄâÜ•”&ÖÅr¤ÄQ_¥0«Åâê—_‡ÁO;»¯èÇÖÎýçÇ-‡Êr¸}*øv¦::ÓD³f›.g±„e1Éç0àŒ´'ò?€Æ±“m@·=A‰øÆ~sD­ZÈLàiY½—Ü—™ØÌ¬¾élïní¯Nvw:{»ÁÍÑŽ8Ê?‡áàøÇÃ×o”±_,g®­Ù÷‹œ1äLÐ]ù™J"rÖ-{HÝïÇg½±häüwýi2˜œiœã,ö_±·Jv†5&®9îùo‡øäîŒŽgæ¿0í\2MÜµ~3¹»Á*¢Æl:d#ßÛ­ÀÒ½Z5qN¢œ¼ÔDW²YÊtpeÞ
¸i¯·’™ÜÔ”_P7•­éîÐ^­Ö‚†e>VB‡àûzµ)ÝØé#ÔQz¢-D¦œÛ\–˜üøO‰ë¥b4òÉ®}}$‚É
.žÇŒö;úó™ìrp¤d¨­øîÔšÚ5À—­‚±!´¾òP/'ÂV'g7ÔöYi$™ÜéW8ãñUšô0CîgjAýÙv'j-¿TàóÀ—ŒU2)Î@Ñ·äká‡pcœMäŽ“ÆÙ×d3,ûÍÊ
¯’«ÖÂgP{ªÞ®È[ÝAT´Ü‹îÔõÁ&xxF!3>–!•"2p½d«W$7tÐÖšÀrŸxí3ã n¢¡¾¾Š2Äú9ÕªâjÝæúáŒzˆ­áæ¿óÑÀk˜áÚ‹ýÝ`õiÎÚãö·ÁuyøÿŸñ)rèîÕ Þõ’è¬7¢ÿ‘\¡t”YÄDâýÙÚÙØs•¼?[¥Ç´V	T–üK£³>ÝâØAqŸ¦ÝÁ(0>Ö$Á_=‡Í­œóF­š/G|çN‘¤pçjF'ã†²ìî°€öÜ	aþ-=ÖOsGàÓîTüäàé”-S§Y?/”^	WÐjÙÍ~¡˜üZ€#s	ÅCûä H¿g=PŸÅ¼Àb×•*£ü[Pw(.ÿÍ;ÿ˜ƒ4C2Ò’pqË/-ªo9ª…Š{ÈBàj)jÂUM<äƒ‡tÊ2CŠÝ[`q8ÅÓ[–tSSx’Ë‚ÎN©–ê¬ýÙ¨2lçp§uD2Š<]©['í’…4’éÎT<â×—utÛøê#U
ßš:øÙñ9¤3M«9jyÐû¤~õt³,;»/ù÷˜Jp)V¹ñQ^ÁÄep²¢¾HÁ#«zWu!÷Á„^ÄÂŽŠc˜pfCÝ«Ä‚Š#†î¿ÓÝ	]Þ—eð¦›/Q&CñK^Ê¸Çˆlw¢ÿr†úR}ù2ìieàÔàèl‰åÔ«„åþCøbYDèk×aðþæŽYåœàßÌ/‹kY^æ]zÄd>ØOz½AÌYfß¤Ù¤õFDLÂQ•òo uÝ¢ýÓb&áh¼SÖ»#Ž!ó*NÄAå] -¥HJªä×_ç Áäy»l‡y™fh\Û´€0yZã0dˆñ{:™"HÀÜDÝqšeÆI'Á°7upbµgÁŒnÒ˜|Ö(d+dJk:©}fT½HÃ we kz$×ð;B¡¹rÓÆ`³±™Q\ ûÖ5¸›Ë,—èF¼‘8S²1¤FÜ.O;€qÜ½‰ƒ”Ë¾6u§¼§ß•Ô$ß6¥²Éö)?˜kyÂª¤:vß#kÚvŒ’©´•²þ‡W}§£Ãáý…¿eºà|,çg×9‚´éž…ÎÅ#šìnìdÒ>‚çS>'^¨IªÎ²Å˜$Uýì/÷<¼7´¤|¬nò?f4ýå=o&¸}¯‚gÁ“•öJy%_P™§ëe\D>jO¹Q”·iÅ	´ºQQ£•!¨Ô7sJÙ†¡¹ûf#×°Ê>‹×Sþ~ÐóÀaNwõæÌeæÖAOÑÁ¬e·Š¹+±Ò^·+íož.²Œ,Ûââ,FUÃÞZ¬´7Z
ÓôÆÊüå`|aÜÕ°?mI¾Ög,‰ò™»&ëíÇóÖd­jfrkbÝ|X’…ŽÇê¢ÇcƒhP¼zIÔ´÷ØñÈ]’O›üÕ/0ùP¦ª(œåFµÐiX`ê«öEñ4°¡¬ýxîÄÃîÊZÿEg¼áÏ}TXƒbrÀ‡¯ÂêãµùëðxõÉb+AµAƒ²úd•X}ºØZlÌ)fÊ«1‹2©Õ¸ÇñÙäñìµ=`-f.ÅÍ‚+±ÀB¬U•É¯ƒ¤	@ñEVâñBôèÛE×á±¤o H²ë³Wâ¦¿<\t%Ö¾ÀJ¬W|g!ž,z+lp¶†E.……acÁ{ú±"‰¦ÉÓQø|ð?çì ¾|Q„€`g?xæ¾†üß¯×`žg\°½Ê²ã”ÍÛ`ç÷M²\Ø+Û(,­ÞxÎ³JTÀ‘²ÙÖ›¾\'€€Îæ÷í<ÙL-½¶d,PÔÙãÐù–•°[¼¢„·gç”á-[Q&wR´e»¬ÛùÍ=«¬§<¦ÂomixÔ¥™qìëüÏiòîîõÓïfœŠ-ß÷¢?%©}%ƒ¼¼­š85ÔraÉ8~¯	.RÙÛŠN±[è•âÓÊí}1Lê%$·táÊ1@¢^ 18¢™2N¼`nãÊºz'oQ8Ÿø™þ¬|qÜcdyó7î÷ð²	–éêyš¿îJç`^ù?Ä-^.üË×ÁlžÊcËžˆ q¤r]T™ã \¥Û_ÒÌ/4cãIöK2¹":ÎÎiB½¯Ûñ¨§ž‹÷•~n÷¢çœUÜ•…u–rßSÞGÏL	Ð{ûL|Ïµ’®¦JTô7+lAÕ¹œý“e1T.$á\Í—»æ2™ó˜¶j‡¸Žk­‚;ý;«ÒðÃZ]|X«Ÿ?¬ÕyÃ*¸>t÷->œo>8ß,&yCÒ›+]”8·>t)+ö]ÉØ+£ûúÂcÏïwì¥$ôK^Ë¥¾Ìxž=cÐüËd÷ŠÊk¼æè”yÓ0ë¾‡çý(¸Œ0¶Å»!2ë²elOWø¤Â¤a0¾èâwúÒÇKwÖW1·ô<÷(qË¼<òs(rõ& g°#P­3>WÖj3‘Éœ@#”:¯ôÍã¯kyEÅ½[³Ò¬J0p=’gÏLèûÜÓU­ó¸^Ï?ÀÂ¦£ÊãW6_¥¼‹¾Å‹Þ%¥Ågm.ÓTÐÏ™]qÔSÆgbsPyF7ö$Q&Îû¼?»Õ”ñ£«ðÑ)“ñJ‡[ßr]ƒ–‰éBÓË`~½EZÉö0:ž­Öa®
Æ•rþªj¬…ÏæÑm»!F6³–â ú*HxæÀ²˜(à™)ú°aå>þ¤AÍ¨£äN“øåF¤K~Ê€ô·Ÿ1ž²*¼#¨ Cý¾µÛm´âû÷}<Áz»õÚFÜÜ®GÎç\¬Ÿ¹þHåØÐè6™vÛèŒÇ~ ÆÜFãQ£¶ˆÛ³uÿ¸‰²,À‡ðKá$®NÒ‹Ouõ.EþùÏ…ì¿À,|>þÏ|È‹ÏÒ89‡ªOFâ$ÈÇ×b å¿7 Kýœ›¨èCÂ,èÖ?N: ­÷&F/Ž†ªSDÇw ,üˆÍÞã©¾lEÇ+å-ùà}O~äùmÔ·ÓHqZ	(&á‰¶Ì	“ZRmÝP§ü—Q÷*ná{\…!X¬VÏ<±5¡-•ÁU¨úût4ŠMÄòuß´hgBU]ñÁ_[[Ýn<h½˜:‚PQÞ\ë5»BgòQ6J./ý//ÓìJ¾ÍlF˜"`tÛìùYˆJUéN90Ñ/fÃj„%ì†*ç¸±£ÓæL\&ùjVo	ÝXUäRõ O2•ëfÂ¤ÝT5;¿)ÿxPUŠ"L€|Ó@'È’a˜iÌìÀU`MI¡€ág…®-)ôa€¹•[¹çþfä} O¼‡ÚÑƒ5P"åECïüu÷è¾Æ;»œ·vëðWv±GNˆ÷Êý‘¾7X$P°³2Ò?.ÇÍ¥¥mÎZ	Ì„‰xõgšC[N½¢Y48g  «	c†€V5»+ÄñÁÀMÙE< …/¤Aý8¢U¯%YÇ’Ücœ•j«·šïGàªM	’~ô,~ÇþÉ‡tÌÒá Ý½Å¾Úêõt,A¯+}Wã9a´éb©zf‚ˆxnPËQ“QÒÜ°õŠØö«'‚µ³gL"•x;ðš9!VaðØý5œšÒ!|þ@q@^îvöv‚ÎËÝƒ]'vÑ°Ø|Go
6Î‹Npüc‡¾?¤?¸"…¶ n›lWaœü+ç˜ð9•,ˆàp$ÅÃÖÁŽy\±ú‚qeè„:	8MçÒÙ:häãQµ’ŒQ¬ p…Ê™{û.PŸ¬t¸{ü¹Šµ–/i0]³³sÌníf%-ÅÂx©ƒþ*;nA¡ÛëêìÛ1o½l]ÇgÝˆ÷•ZngX*ß·Ð9¼}’©äà0²Ø¹bÿëÙÕ`þÝ”Ùd!u²µ«lç|néððôaÐ*HÑ(„ðG#Ee/5"~Ûlâéé-’}ªÔ;zAã"M!X4Å9„R¯Û¨ò‡²çnÃ¡náÌêNkàµÊ|À§ÊÌ‰W±E¹1ôÄô¤í¥¢§;êÍÞÖ±…_ã-fÐSt&ŒBÞx½!5aWá2÷™rCŽ¿|zw]!Q$ïƒÉþû6<1ßŠx3(?¶ÛÇ¥²ø’PjáR­xnéÍ[|ÃP•Ê‘HõT@úà”þdú¦~7O—õéõ¦,:=/êM^¾¥û¥Ó¥Ï	¯f½þábÅ•~úŽ(JÒ}3?©=‰Q.ð™
dÁ5ÄIÂ?ºîìHîÀ‡Dô¿½•1=lØò8.é óR’ŸAL{á$™P?Îyù¢I mH¯àôœÆybúÚ£ã>¢ƒG×y–ÀJÍ‰²Ig¥CrEVpù´]ý!uƒ­ã­`ìÏÃ£-¨Å_7—ÞÕðÃÎâ¦
±27#%kÚ0„ÊÜÂ<T\¦Îä”!íÚ½4A|Š·Í¢@>ú£DiµõéYô`|FL¿³O¡©ìØÿ0~ˆÓ¹Ìã‡
¼ûoòÑ‡ZÂy‚AKû#F3ôxá­šOÑÕ@Pÿý€ ë÷oŽ…#‡yr¥eX3#Y‹Uô<¼žâfŠk¶([†•Ôü˜»xŠ9+	µ6—æ¢QöîšûæÅë×{­ƒü@4‹f¹D¡!8£ ŒpÛ–ìÿ’A.ô…NëÄðuÿ?yWÛÕÆu„¿ó+¶›4’Z±€'-iì#cbÓ˜—nNæ!-°µ´Rµ’1%úïgfîÛî
„œ$'þb±{÷¾Î;/Ï±,í¾¶ÈmŒPi´³hÚ³aÛ»û¾&¹Ë µÒ*KH±0} ›Tn]úb2ËEíŠÚØv
a[u=²rP»¬³¶ë´ÔŸîîqU®«»yŒ4ÎÁY€$ÎÄ«Õè\žäDå&›ùf´GÇÂ?ŽÍmdœòÙìêðëºüÓÏ!<i6ß¶5‰|é¢¦m)úÖOP-]’/š¨o[Œý|ªÍr}œžšƒ~cã1i”r²ð0‰
qÆñd,.,ëÌø“¸Õjã»õõuçYri±'AÖw¹Ë7á®þ7þ•.rã_E<Ü\|¿ÿü;ÞáÐ/øËÙ~ysA»þDº^¹¤í¿åb9ßt6÷§ˆÍ5Ëß™t÷ÄŽ‹ã+¤h›>ÝŒŒJY¾ºkñZ²ŠA€ñùzBœ½y| ¤—’øG¼H>¦a¡´œ,õ•pê°ý˜î®7p
o:äM­ãÓþX[£Ã¾ú‚A²ˆÉ»€ïì+G+éÑ†™ÀÓ™ð• “I·‡¤lyV¿·U;ŠMØ¨[ì¶¶æx€m&V_óÄ «Ú'‡:æ`_Ÿz­ªþ­­Yw•Ýˆ‹TÞ&DˆOÃ+,ùCÙ-ìÅpñ6ƒúýÍ]Ÿ¡–qZ_‡ñ¬².C*p®:Tç|4A•¦˜x¶ØùÄ¯˜·É…[Äx¿ø"*?[ˆíFlû)ß[Ûÿçl4íúí{•WZôêûòÑß´{G™ÿ¢î¥õ“Vz4›ôÒ·é‡«îªŒ×iÙú2e@©Iï[œÚñÚ¶aJ/«ó|‡ï"Xüˆq’l ×.vu¹Ïó$:L‰&Ø%)
":†E’Ü­ô¹x'_£àªÍÿ`Ó§mÔêý`Ê»7(ÆâtD‹'éÓ 	Î‚cJ»%ÏÎÎâVygˆÑî[7„„Ÿ„<š'oŠ7G§zÚ¢§k™péV‰-˜¹à—'§ÁLÔ0|ÿ×‘ås=Yfã‰[LUÏ˜û•ft|Ø¿h6nU…‰n]i<Ý1_ÌÍ·W=î«ØÈ®’ºgO¼>yËà3Uö¦Ïº$wíãi%XI`¨Z&º‰í²òHQúá=År¸*˜6«5/áZ]ìè¿ïÔç³He=²6ÍTTdTHšƒ;/Ú³ùÜs ÿ’ÅóÿéHEu/ è`•0I:¨#*ù°Åªòxf8ç†bÛP=–çÁ+º¢è¡Ýðhã.`fbURfôn~E "ê2—pâkÒ†4¨Â>}…[}8;Ð¢pË<§Y::ë?´e‡§ÍÁZd—‚²Xžw’¥v(ˆ%R€ÐGY¤Ã*X…­¦jÔCÙÊêœŸœF?z—¼ÞdVpÅ—™éx­»A-S=ZTBH/7-1š¨Ò–v’?»L
&íºoâÖÉú©ùk“þÚ8e²áª×þ3N/ãoJ5òÕ—<ÅA]mþº¢¹ù1óâU`!´óê<ß	‚™­f•‰W8;5Zá€E®)ßˆ[Gì×ì£P¾ã´—ua9U´Ñd„«„ìÄ¹LáÓ0VUWT\u‘”ý\¼(3ÐXó}&É²aâ›±XTâ‚¸æš¬X«­B#g]÷­öø¾Q8¢ãª¨='ýé¿Ú— ‡”¹$)×dbÆ/<¦=u»¯˜'±ƒ‹Ì ¡¾ßþwtÜ9ú^ð	I),MùãµFNí*ïž„]ÝbTîus‡{ˆgœ99ÚrþDi¾e|ƒà~}èL¤ôsª4·‰Ô¯FÓ‘ä#—‡-¸‹R0LÖdüÚ!cðž—6ýDÔÙèµ£-‡òoIaƒ&…ÿØ6‰ÿ4÷•”àkßZäqòW}ú§¢<|´þè«Õõ¯W×7¸÷¤!¿º.é"iÐØ–0Ë™aŽ›,Ÿ2|ÉÆVüuc®Ín±™wZ¬IÈÿ&Pk^îÌˆLë”}ªC\ÄþŸdé…„‹&R™jÚ9/Û	;›³ik™£v×Íxq'Qc_‚DÍ-9Ÿ¨^š­t0º–t ß‘¶á<SlêOÐÐôn
]w7z1•0žÂ3ÒKó…w˜9Wß9†4«ÈæÈðà±…]Ù˜¸`ÃmZ€œŽrØ¼$ï’6my{ÓE¦|¬Û“†9½NÓÜŸ#Ó-f]M³×²Û_rŽ.I"êê4);bF+áò"
Ù{5Ñ)ÄÒZ@é¥÷J/ ó°mAn°‡žI˜AYºê³¼D%ð/OƒRªeI¿²YW>@ôVF'ÊféI‘¾¹G°}c\š/¡o<,Í.ãõ
IYZ¦÷!±õ-m*Å9mö„‰|Œe*È>Ô´‚tVÏ­G–¸ ó4¦D1pN’èÃpñi¬ëüºHµ¥ª0#Q¹k£œ1Nz)ð$q7QE¯8éÈÇà©tõ˜Ç¶Gê5§\ÀEQ.(ËdR{"]Yg]o@;i@»{gx \nU¶#Ø †r%FòŽ	HÖÂ6J”Øã`ôlÎ ôâ]Jû½F²îD¼)4,¦t¦UßQ7íí„glÒŒ´iîvö;{Ç›ÑKôí’¦œ|{Ñy•VÓè›Ëî5]“‹ÊQiÎFdcÑª@Æi¹ºÎî¶wú+“D!SbC93Sƒ7QØa¼×ìK™Ñ–—²ó/¥¡tp´}Ð9ºLÁÊ'cGR‡l&(bÍÜžnw¶^RãØ
ü	Xe·#úa`TÇ9èÛô]6äˆˆ‡ÛGû{GÛÈÚ´Û9S‹ÚÎù(Ý¥Y¡.D°~s=éŽ™nsdô›EQe=Ä!U¨SÜ”ú’V DÇžMø°‰@)ÏDÏÉ:9Ç›(fÃ!8¦rGIÉÇ.«šÉ|¯×á‹E+véßâqHÄ²£úqè¶ŠsA¿ÝRr€ 
ýù6W°°:¼‘_îï~AO~ôvˆuáÆ8¶0Ó×•ì‹%Z`2]Ø„¼­kÃ½Y¢åÂ6øe]öÅ-‘ja+¶@]KÁËÅ­Y3ÊéÊ\öp`£hëõ!Gå?:6@ÑŠ=)4bX0ÙÊ' kÕíßpñÞ1C7º÷±w¶²ZkhˆÊ¼&I¬#êaÙŠñ©êB¯Ui\d¡’¡èì¥¼F¿Ñ½š”G–þþô7µhNzøªóŒX9ŽËhgOÀÊ€Æq¼rßÀ­ØÀI¨z…/¦ù
£­|=tÒ[I”Æ6JCÆ/8‘_(.‘Nzû$¢šc ¶9WH#›Ž–³*¸R¥!¡_°ÐÏÄ‚¯Äjc#ÈW™Go.4²!'3L¬‘d­ÆfÕtFÔçzõB"çÑÏ"ú•1‚öñ/´ô´<ÚïbÐ½\˜Â§&!‰¿Ë¥Ò @‡,vzw4|¨°¿\ÝšvÏ/gh¼'Ïè=¾¸´³wwåø0K*ø£®ox^iþgÎ^QxŠþÅð´ˆy|øzëøõáös½Á±ù&¿ãÚ†ÇŒêïb@¬#e@Ý*×Õùk¨úÈžS—c)<Ÿ=zæÑö	ìÏ?E2*ƒ”["]Æbd@ýÉm"ÐñdœF‡$û+)°¥…‹.‡àf×Ö¢ÃÑùŒ! ºFÈòúžóªòrêf™þža¿\ÁGRãxßqnr ªTä“"W ½CE°uèqîdÂ†x¨U*`;òB=(©à~I¤Aí¸?dPG7Ÿ ÄØ!çËóÛl>Õ³jÅ^ÅUÒÓ¦w8îýlÐP©†Ã ‚Sè5õdzÅ½†85ÈÙüe0Àm¤ƒh³F@‡<pÎ9o=h£QŸ:BÂí¹wqLœK4fßE[R·ÙI#¹waƒÚ%æêx‚ ¡%¯¾×ÞWÚ>Ó¦§t‘¥ÐëßÓ=Ö——ë&¥÷òÐI§W9Èé¦TÊ>79­œÏAAûÜ4™ƒRòÐ¹ª+rë£¼Üšyl3ü·/2Ü.MªZÉÅh‚+ÕÍ&ü ¾SÛ¤Zô„
œVcÖ‘ø€îŒ#)/E6©ráÒ	æsY~wgTÄ(p›‚/Ouv4Åz´5¢!%Ñ
{˜/G$,ˆ‡™Ö«Àc&^ Ÿ*A«ì“hó§ðäñöPâL§½¤¥Æ|É[{2âÏ9ñÓ¥ègž§¼f!bD^\§uA™”–pn}öÙgbæ`6ÅFŽÓKãUËƒ¿®ó•CÞ\k{3½‰±ËÈše>M¸‡¦¼ÇßÎ©:?Ýl¥Ïf`Êo™q‹ÆT÷•n{û	Îiêèw˜0‹¨9Í´þ…˜Ü[5u4g‘››­¤ ÎŸ6W7·³q!©Æn%ñìE"ëPþÂÿóV‹?!wUA<‘³®~ËËÍà×ù»œÏÆ|å•2¦šŽž|zaEg)k2/ŽìÂìäp6ˆµ…[¯g™š9c*y1#2¤ùN 
ž!·U(¿{É˜Å$,"LP¶\„”ˆ3E„²I„1¸óy Îv†`Ý›"Š §4m3\m£|ŠÌðžñƒhZc»°×b*½gÌhLlBæ ‰Ù»NÅÈ^a$ÖB 5äî‚Óû¢‹pS£~6¶I™œS1ýŠ7-éòçX}´ðæºMàÔ` &¬+Ùÿ7ÑU÷=íÝÞU–sU ^ˆ\ñ¼D,ÒÕG|w‰Y¿ ¶C~îe3*š„r f#\µÛ(	œ×žïŠÎñwpSÐ6Œ!ãCøBD^.TtÝ±’ýI÷ZèÚÖ$¯ÉÒ)\%:ÝìÍÎ¾–À
Wf]‚æùhÐgºˆgU¥·ø'æê}„Ï´ÄÌÎÓîlš]ÌäNk·v˜ÀÉ§>#…‹3e¥p<›xýàôògžbª„šCãØ	Íú¦šQ_xº^X‰þ%ÜaÈÜáìóÛaÂ@$Iéƒ“!zJÛ˜lF6B7ælƒNÔ¦:?#1p”åÍÆ›¼HÏ¾
Xs·@{/¥}–Í½žÉMs9“Ä…od+’©Y•nã³Êù`kËæO}|@ÊÑ;ìT“,«2€‹\hD¶¥TL¦~™q÷ø÷‰±Š5D„n´|žòLØo(«ðß$eB¦\¼ÖÙ˜·Î¢ù©××P1òu¢P×¨iõ•±ÒMÓÒFüH%'))fiwI¥âì'õ}ài¶’¨˜]^
+³JÄÙƒ”§LX0ØMY3ºÅù¬OŠ÷n€÷ûð<÷xÇ}³—ÒaqsÀˆ†6ÐþG~ôÃW8ž¼—¦`};C¾ì<d¬ã¯–yñ/$v%>'HË
æxÑ|È/’*E)¢Uow
IÖîÎÓÆ<FÈ¼Èý‰¢™¿šyáZäçÜ"Ûz7ó8AÊb?!SñcØý¾yÁ$Ñgß§7ÍÖ"s„Ïö4z±½»³·ó¶s°óHÇµèÅþþ‹WÛöÔ0º"Ë££´7!A3ñ‘óæ–_¸ùÍö7±5 KZºENY}9›¤6ö6L“šÓ$LïÆ+¸0°ùWºuJL´1õÞ­n4BoÈ™ñ‹I6À.ÝºÊz@’uÝ~\òš€,%rB|t¦ÓËIšæ¥B4ãÈn²ý  ÿÿì}éVY’ðžâZÇÇ’l)xé*hš‘…Àj³}Tu5¦AK"²‘”*¥¦(}gâ{‚oÞdeždb¹{¦^z–sÚuÊVfÞ5nÜ¸qcÉ­­ÂAzG!²Z€˜ûñ¨‡xxúÑ«¡öÍ~„Þ´¹ëéÚJåîî.èÇqh‹
I%íÑ½®lØZ{A/·ÌH^­­¾’=¾jM_q‡¯Rýu€
]ESÛÛFä> #µää8³mÔAS§>2÷È(Q£1ïõÀkqÚî#ô¹‘cnoöã;Qƒ;wË÷ä&ø8ÜkÁºûiÅ=|¯6Æ¿ÿÛ›àíj.ÕÆ5ÝŸNÔ¤ù7Šâ@ ##Y0Þ¼[}÷ã«kåNûÇ·?þØþCøîuwã,n1CõÀ²ÕÄãw[ïVW_üºõÃj.óZHyù{&ÚÒœÎ–[ò‰4fk«øÇñ¥P]•VÏT¾±Ót
[ôC•÷IŠQÃËèt<IÂr?Œ»1™`³8žÀoŽ‡,ùØtèzû«¬ØA…Î„’½f'”iÈ¶¹ÄY3^†É3ÍJgÈ^•ë{!–Y¤>ƒ_Ôò*¥åï -÷u‘îLS†a 3ÎÈåÔ¼5Šx]ådY¬§É€\q…¯í˜n$?T2­À-@ˆ‡	=³"0¯Ê Éñó{®ó’óbÔŸ4£?Œ‡¸tÑ=Wí Ûj6MJ¸Å¬åUˆ$—jŒtÝxâñÄHKOú‰)Û¼¶–ß®¿€qlyÃz1ˆG[ÞÈ.KÉ•RÞv:Û–xô2qoy É¬ÿÑ§{u<Ô¨¬«¢P»k_ûÑì_úC` p#=ÒÇ¸ãiy8„l{l0¡e{ÞÞ´N˜ƒ¨ON~î’ò[sçë.×îè6¢Xe]êA|ã†4ÐK"]CxMda:,è²%*x.@ë€šÝ“qš2!{£eÕÜtê=†¢ÜªC(’YÙB§1±$Ý3{b-€l:$Ãòa|899fÆXš«â‘Ðãs»/}‹®8|(šöÝÚ¢úþÜT¶ÿæ7¾”Pí #›ôO2lâþæÅ€ˆÑh†äÃôJ°•ºÒŒ÷Ð1ý1Q}J–ºLÆÌh@ïÙ±•lR”¥ŠÊéìP(MõÝ²Ï #Š¦ßfziiõ0jûz5ª$ÙÊjƒµ‚«%ñ®¸¸GrF Ìàå€	ïŒf®€a‚†Q!e<gàó‡ôàtm2²¡Àu÷EŒïÎö?	Î:ÔjÍÆI£VÝ;f½vÒø©¾!>(kí>Õ¬C	9(X£iÎXT´)®h"h{GN0"©Ãè²þHz‹HúA{,þ>£Ì¡wøåè”‡ÉÒë¸Qûˆ6Æ'ÕÓf;ï6ÄÉ‡FKì7Z'ÏÄÎ©>T÷÷OkC´š<jŠ½Óz«%Ž÷«µz+Çúê Wþºü6í‡"¡*}5t\@iÇ­4ùQˆ–ŸF–7]ÆèTÐFöbÊ¤`þjK\–eˆ3”Í´kç9QØoÓ.ƒ7|ºîó™‹Ïp„?.}jŸ$TÌîHˆªâø©!YzžÝº˜ðè¸éÅ-~À¯²=§†Ûê|âAK¹O£]	ò¼–]0ä;L>ÏJåü@Ãqùd¦¡T?$ä‹ú_ªµi.ÃíÜÃAûÀq\Äœ@aR†,¤Uú™^ò´uÑ	E®žÎÊù5—rtéæ[÷Æfë|Æn1")©»	Uâ-m oÐÅ 1ösqã3w:rO»Íj´§×˜Ì«’
^
4(	ÌOVY¤ÚR` ±£Âó!dKÎ7#8²Îr°Ö£hzŸû¿93ðß»í«ðwÌÝuê£ßñ¯¼À˜æÎöv8è¼ä³´ßXÜ,nâ9øzuÓÙ0›fnóŠ¹UEÊ ½”eÚwhNÉã ,×1jŽZ'si1°n^(nÛr}.ƒ ^F–¹<›ð"N—¼o“ˆ&¨ˆ——[yTöQ¹ÓfÝáâ4^p£èVWlkÞz¼«K<V'µ7Š ŽÔÊ‚wŠ­õ×ÄáníŠi×m\qºösB¶›]ôa‹aŒbËÖUC[Ú¹Š€îÑ4õØ¹üIÇ‡7	—¡±:r:ÎæcøÏãÜŒÛ”bE$wÆa¹r1©jOå`øÏ?ù˜oãcä¶u—âQNfìÓüŒÆÊG˜šx”bjÌ”íœå‘eÙ`U@þ<½¡ŽÉg}2Z›§¾ “„£Ù°°;ç¬ˆ>¯ÄæËíðE_8l›¿Êlíi#š?¾mþ—paêÏ"š¤Õ¶
à©’ºÞN“ƒÉY­qÑ€cnYmP›¦IHº·•Gz^Ôo¦BÂ>ð2´®ÄÜ=¦Ô_tZûú‰ðqåÄâi}‹bË¦˜ð/ÈÔÍ¤õåHGkSÌ~nÝ'Šmq©œÆØ€ªÚa V4zW7æ~îgmï…~–æyn	6á›ßôKp’e`¾yw\
 ¾4 y	‚ÇÞŒí†GKõO¤MŸ;'cë‡„¯1štøÇÂ¼•
Å@)Ôd†.ÌŸÿ
uü>LØ°)™Z3Ë$¸ùpT>m!ë+TCî3¬ø€CçÑZxµÆ¢
Žh:ë…iõ~<ê§?¯°Å528 o=—9ÂùòñR60¤ÈÍ#ÎÒ‡ªÁ »¦ºÛEDEâ2~_Ç(,Tk"
|È¾‘·–ªž‹¼=x|©#‡Ì°{ÞŽO†}º—@x­®æªïÙ9	©~´8dì@ZêÑ'¦]’mbà<*ÎÉ‰¶RyêŠŒ&=N|­Åã¸<h|]'ö‘¥Ä>¬[0ûF›_¢Åæ@a¨—JbÚ2{wM•l,ƒâÂÙòÌYsu…h@ßƒé!dŠÕ¢:(cŠ=>ÂØ
ä€Ô	—‹äÊ²Îó¦T8þìÒ1q6v
ûxoÙV«iË…´aÔ²ÒE,¾¬€-"IÊ»½¼ÙWuœxY—ÿñ¯ÿWR›N/“SÍm€—aŸAB[ÆûÌeTQ²3¼¸Óž?HâÖ‘ç-R½Stã€´s4ê·
÷::ÝÏ1#&‹çŸÜ¦I?/fO3‡ý¥ÌY†nŽ¡˜}o™631G¼k]¦<»í²´ç•3Ñ¬Æˆg˜”yŒ‹Ûøb“ëW¢iÔ+LUaÍWˆRË_†žâ“¢7ø[oz|°¶ >j"g»«'ô½ß8:¨6?Ö›âçjó°q¸×BWlw‡`½Gfnµ,6ëÿçÄÑƒ:	€ ÞýToVk“_Ä±´GE«µHˆµ_6ÐÚö§úái]´êûuJwÃBãqóè§ÆN}‡Ç¡ƒmœÉ)tavA6 ’")Ø®¡³ªÚÊ2¢ I„nÑI¼TÁ¼ÃL7:¶ €wáÈþÃÁºXÐ^“Ã¸§²ÚX…É†]Pk'b¯~´×¬hÔD³ºÓ8m‰ú! ´F°Ý@Ó×{í¨ÉÔ}Æ‘zR2BvJr~6P²€°ªD[O"°šyP³¸n³®º³¦ñ:½°µ£Cr¸'À-[+{™Œ‡X/œSÌ¾Û·ð‹ŒcMú®Œ5ƒz zdÅ\A+å; ëhÅ{P=FíÄáG@¹z­ÑÂ¾õf0÷Cõpg›§ûõñóuH’ ´{¶Ú,‘½(ÍéÓ%ìÇ6º@¡’ˆ.¢Þ§K˜L<Ð(stX«#-°™tŽ[É™‡ôK"<¹RE¥ãÕ¡vÙè+ÑqT¿%>ýÐìŽƒåØæM9qÚÜ×8@‹ð€ß€y|©ÙÓ´tQ?¬Á¶½8¬ÔçüA`ët<ù§Ë%ÈÁ&¼Ø=:=ÜA“%Z
²EÛ­6öëø.Æ´¢ì–
³ÍµNŽŽÅÉÑÑ>ÆÉÙ<JJÒÖËCQ` ™¯‚"ÏE“îlÈ˜Ÿ`ìOŒ•Pˆ<
:³b¬aQüg…ÍØ¾_9¯€8Ôë'üPŠâ‡)´(³Ù<5„ûD‰ˆ„#wã dPÑwO­8 2$Õ”›ëi†tÇPFh™.iÕÑqñáè´éÑ©“lþLÅLR¢D`È}·=žÊ°RI)õBÒ#fèGrƒ ':ŒPF,”I”rÐÎdI(©ÝÑe›¤„RŽè0a’$	Ûtp=ÒF  M"P¾\Î\(q €ú!Êá„9í&2äŠ8V§H þ ÇùÕôp´®X%žl4ö÷	¢b jN4 Ÿ­¼àpÛ­7ëHO’m­Þ‚ögˆ«rVVt-ízŒ;eZ"c²²?ZbeÎ]Øš0º± *‰,&¬fJŒ¯®"HŠ…“C¶ ‘o»?i+»0±zŒÉ8ùd«½Û(ÁLÄôæ—p0–?íèx{´OÄìkôËI¨˜VÍÈZkDÁØdé~Fþ1E¨)AË[ÛŽwÜö¯[Aä‹Ø©j…Vá:ôÈ¤¹h7Ø5dÕÄÎÄ_ëÍ£ònãpGìV÷÷ßWkáÄû€êlN.Ì§¤ƒ•Øç®5ëÉ´h¥°|Áa,¯=¡Çœ
%£G µN÷öêð»zø‹V¯7¤‡Aî,t ”T\„	{¼Ü)	’s.»ÿ]Ç¤Q½D‹5nIAt Ì3ŒE:KB!&­»±>EejÜ`0än@QÚW²¯QÚWÞ,6„¥Ôxú@Í%«yÕ„a€ï†’3&1´a·×…u8¥ä”Œ‡K½ñ8 •†„K÷ýdÊ‘7'‰L_eæRÀ©yDVô^wó5ÔìJð‹­uL¹{\’Íµ(Ð?E™0É¿vÅÛ3®tòôœƒOQ'Ä	i@NX±F+”7˜¸ ²A+ei°-ãHª*,…”ªÐˆ)s’ß³]•¹Ä-°ø¦8’­Yråôî·×BFO…å—G•¤Æ
3‚"Ñ2Wãdu^{ÀQUi&|å»x2èù<X Ž†(2\iÏ<‡h/”qcHÍ	u¨ÎëŽ‡¯éƒËDPS¼Mâû¿™Òø©8¡Z‰B6†µ–G^’&9Ï©/¼©ZÐ—Ö!~·Î3û4 ìS@w`„°¦¢YµªÄ–­Bª7Iñ×'<ðf6õÎ²’PÙ‚­ùl²3¢T|]*O:ç0BÑ±&xh&Ïp¨¶e}6`i_ö¯§eô?5˜ *"D%»ÁJNæùãÖ÷L/‡…Ÿö”9¿‚!%‚VYÅÇk˜õbãa`çôA1ˆl¦íå“ûa'ðæ>¾9oÞ–ÐÚžvô¿ÿÛkt!ðæe!
L*Î†ÊZòˆSÛrB04‰D¢’q°TQÇ%zœJïIH±B# tw|* tð^ŒPbP¨ Îÿ0â`ê"9$,D×°hÊ!=m¦ÇŒ›F5)Zõ,žŸ¯ï5·£ÝK,CÞ¯`3ìXâçY—NÍËüM°²Íg»h§¸zâ¯1;4uòÚêÆêª¨€äÈ?r0½Ž×"ƒ·í“‘.m¸vô<\NŽu'e_FbfIqØcC¥ÒY›*#æÈŸ“[ªOú$ÂïMsÀ Äé¢Á+.,¼¶þ(ú{Åª“N1Ma8 `ù]°¾úÃæ-e&_[}üðæí;óÚe¿ÂËéC|ó>ù"~íºñç];½.¯µ[ošïÖ:¯›Éç†­S+>¬$ß~·×ñ )tD½Š)nHhÎñNÊy”Œ ª©Œ]]“„Ü?Ô1Iw™ÞlØ±¿Í@1Upc!"á5Ü:ðïºqÓÊÙ{‡°!c'¬¨ë\NóžºÖMî“'%W'£¯&f¨ÜÑdƒ¬kX]-óO¨m¡nlÚR©È{oy>m)Jg‡Ë}[L¼ïä¥½$AÍò¨{_ëÐ½00oKf…68é®Ž°C¡Sˆ‚4z'q‡ß³gÊk8ÝÒ§ÕÊ±“ä	QìžI.b(âÞð;Û^×|[ÔK[eÐçEÙ	Ñ–{Èy~eiËÍMï¦Í›;ã/9‰S$4@_G
Ö0œœQÆ‹ÿcœMw†©ëL¿„å¥œª¼•z%úÀOs1h9qÃo¶Gð†Èã«4·EÓˆ`ßŠð@†Ó¬¬'s	y—øú]1HfØD…õ’øQÝÿÍU*G9Yk`môb“1·Ä%6aïKnùßL×ØºÀÐE¬SþÚ D3»/
Ñ@œz–¿¸Î\äÆNN"îkÞKÅ–#2‹/´=–åÁ¸Œ“âÁÉ·Ê½n¹¶­Ø•oÖÌuçY%(·ê#ešõÖÑi³V¿¨ÿåC$–úN.m©Cµ’>¦²F§oØs§Œ$T¥ƒõÂàl@
4.A—Yèà‹†¨¢Àøúnüò‚ŒÔdX‡²›LLÎm!Ûâ*¼Ðì•SÊ‡zãIÃA¶Nq$ó#_£ŠTÛ¦i;Geè’‚•ƒP¯°le—§Ï‚8%
˜:Ô«+à`)‡ä ·‚+$À|@ÖÝ±=[A…5¢¤N“îàdd´Ö	²ñ;³»…_9ÌƒJ—&sÁ±Q4tU•Èê(æ–•…ÛGK¤œ¶^Ìÿô§Í•ùŠäÑ¨ïfØ¦{·'svH…¢F¥|°ø9º‰ÆxSîàcIa”¥[ŠS†:ŸjG/à5‘˜«¾¼cóø ©+Ã^Æ_Ð­KöCmCæ°7¹É‘È˜'7	/Ç¢:+¹ûl2@R­˜r`ÿïTÇä}‡>#Áøz¼ÍÁÎ¶¨õ–Gô´ßB˜2GÿbB ,Rýo.ƒ¼Ä“-è‹~2á_[HS~ÔCqŽÅJPŠæ'ÕúüE<‰`-¶^ZæÈ:ƒ·çs[äƒíØ¶æÌò kÏ.Ø'À?Ü„“Ê;t½VàéãÔ:$ªtïÚ×ƒ¨Â…ËS.]~·)2Ü´³C&ÌS®ZS¶Uá9à–Ä¶·E7¡SÌõß,ù†EqÓ¾ÖHÛïÚ“vÄ(¥È“áNÐnxTv«uG¤øÔ•vÙX·Ó83Õ 5õ™•ÏoîM©—â5IÛîN	¬CyA¡òäS@×HYä|¿´•*›á&Ý{·œa
Ò±Lcª=ì(“Üw¶›é2·xg\Ýi\±€˜÷Â0§æ¾	85ø"¢c²—€Ü,ã¾­:P¥÷ 'Ü°K9ò{&µ³`T&åš‚ßÍãOJmÖžb¬ÂbæX:ºa€cŽk¡”Ü½†\“¼Çz7	£>iŸ0bx2ÅÜ¬9n2â?ÃxD¹ ¨\ÄúT®ÜG•"þÇÌTaîÜŸ+‚W	à8ÀNöˆ.¤4×€¯‹©e”3C³íÐoÛ÷jÆ³äºnF7f•üàûÂ:‚2 ]AŸP‹	ó6°xQoÃ##úÍ/Ó­èpLæ,ñ§ºÌ ½Ñ$4Eà3fI¼` |Ÿw›Û´Ió™ÌfzÁS”†’—ø$^¿¶Gž–^ˆ›Df¬ ØEçfê„åZ\tÑ!k	ùKNYâF=jäýÆ^8qg®	}4Äè¥…Ü¿°~¡ åR‡C;’fíV+…G(/)ÜHRéFyÕ7*lM4D‘ÞÀíˆ•0I ´I‡Oýez_¥›YWÒŒ—HÆLP&Šè‚ítšUV™«["P¨/DÁ… <„Ò-Óe¨T0ßâQÁ©(­ÜÁ¥×óUÄùO€µdqÍÕà<ÌAÞrdt
"\N*¶ÄþþAÎ¥Ó.Î%{KÃ7Ð/“íàlõÜ_‡¾ÂÔƒpÚ–G¤®²¤>/¬_»žnðpKU±Z‘…(¾ìÂidŸ“Ö)ÙÅVp©¼v]ÒJ¿ø>@ãŒ‡¡ Wø¢à¼Áã’	þ>îçI\Xb<z¬&#Î§éýR.)¸i“O^è†7¹öhjîŒÂ/6~R)M£jäåE®Sé¥rØ¸w˜[®7ÊKë'602·Sh¢ù‘ŽÑß­ð˜Ä¢°ÒlpÂI‚äWJhQ \"§%»Ïz<‘Ý8lQíÔÒsþ t9%:Ù®ð% ð£Ñ4°›¬’uˆõÛ£»5{#³ÅÜ,¡òÚŠqÌ³mØÑ³éæi§ÚSÏ2y}ãiö6ûñ$îÂ`n&bW-Ðtÿü²ÊýceD`‡™¹âý SyçEÓ‚“B	wÞ'Ržh9Àá^ÑpI€z³ºJÿcÝR¦ (û-Î-YOÎÞÃrÿ¦6«Ù¨(	ZÒì•78ç Ñ[Ô¸Ù…ç_Š(öú~-š¼Öæ5Ng8ž›Cåj­z’(¶åÙ3d¸©n
¹rùÏü€Š÷\µñ[»u¿³7>º=ög¸ªwÆýa²Ö¨Ínwoÿü9úaç`ï¶šûNüS›ÒÃ©ý…nˆÞ¬†«ë?t:W?†ÝÞüøz=•’ÞÃGsÑ
,TÂ2=5,o[o×¶IE‘ù‹îgTL|ž¿øu¹ƒ›Ã»¥-BÈ ø(•ÆüiZŒ×³o1&a%ðžPœ
-Q“u–{.J3Ÿ}(/àSæ%ƒµù°L–øcö •@Ã/†¨óŠo2ž^Rãâ.2âÖÖ¤ËÀŒÌ«÷…}º¿AšÑ-~ë!ð&ï'èä@÷æKö6•Zº¯ñgð¾Yý©~ÑªW›µZ: Wø†MØ[[½§:²pñ;maVä6þæQ=²ÁQqÉ#:Ø¡l
ØÙÒøàiô‚&èh!¿Mù(r)·f-·”Oâ›M$x–©¿fçKgñÞ_À}Íî_À5{dÀ¤[ÜpÕ ½÷ÎiŸ:àÓ…,¯íHôÚæltÞ$ßk“óÆüÚ¾W³_áÐe3·D1Ž
¿jgSmž…!­ï¯EÕ ;Wj{dËðÅŠº—hbz¹•Éå;	ÈÛ“$fÔR~¦=ð&G5CÿkƒOggût~þòÓy¥O¦¦—õÌ^0oÔhz&Úô{(.é¡pö·"tPLuð;`+ViÅÜÀØÍaa®šNgÞF2iEÆ0áH>I4Öôê^ª%W>%/ýÉï}àÅFýß;7“ß;í›ö¤¨Ì*ÌPÞè¹æ^‰Ãj«Á”ð»Dê7kòoÒPÐã’î_a÷#¨ÿ;–t:]P›ý”¼ÂâO(Ýõž^ø†ó‚×Xä8<šü´Í4_°Ú%Ã+–·*ùÇ$Dg‘ ê§Diçé*’Œ0DLNÚ'*óÊî+Ñàæ*J®s¢ü'c}®ßW¬NÖ-pÅdAÔYê¦‰ž'XJ^TËIS)©Š™ëY¼Ãè~Uê£þ F  @ñ[–,fèÝ§úfv.ö§Îm[W•¿ÂIOmtûC Ðþb,Ð,Ø¥~àÙcòzÀ¹ŽÆhJï–t—¼Rk
­hâÔå;×ùÊ
æ©Y¶—lG“cPµâ€Ì‹†E)Oâø
( L{4EÏ£ãhLÉ{Š+Ìh§¢X‘}¸èÚ»×…7Œ%t4¢Rqˆö M²sâwÊ•Ž1ÃÜ&KÛÚ{¾òí—¿*Ã¶uLØeee{*`šb‹ ½M]çQÖxf¤N¥S‹çeÊM)KU8Sœ9(¿nJÊCzC|¿™je,þ._±![O–ML" ¾Û¦yé!ñ»º,ºå]ž«`rÊúO±†”w”ÀƒB¤\h’4±œ‰Ù#n}î‘.^YêÐYÃØXwl›@»Æ2„ˆ·ÏåQÎ©?&è\o¯9†ãgŒ6˜SZiMAåtŸkó„çÖŠb €¥E•À€ä ¯hÁFqc*>Ä–$E8ÄÃöƒÁf±U`•°G;m¼*·IÅ¨,‡‹Ìð!#ïQ»sÆ²—´pÊ¨‰Q8ñ9íÙ6µj™ÙVYIšyØà.É	”„¿’
8n‹kšÌÜ8ˆŽö†éÔñ“Ð.Hå²‚iˆI“*ä­BÙ%1‰Ê¬ÉJ·4_Y¬‰´^Qi xè3ö§[Ev„Åú¨G
×¥©r°B9‘`Sæ¨Û+)î!¾KtOå‹É0KÃ>xL€RñlŠÖGQN“ý~ÕÉ\äÖºTG.wdª×Ðè*¸n'’èºL@—L²ÐèË¯ ”5æ Âú(A¯feÉÇöˆlÂÃ©‘ Þ†è€Ç£ãubSž,SAÂ23AU,+AG–(pý"lWßmµüäC,ÉZ"aêÈ•ë¦FÊtË;JÅ‰ŠI»m^d¢Å|äæÄ¶|¹!Ö­‘™¼Â;a¹7cûéP;ŽÌG^4(ÖøåAsÊ‰†ÙB‰K¯:[°vòŠ€eÑaßˆ¢ðXF•L¼úÙ´Z×K¼ewDñó!6–\ËKe>º6lÃ®oâ)ÉšõôXEåì@õÌƒA9… Š”%‘ˆbáÇŠg~˜R¯[ùc„Úˆ/©ª0*[»E7}üÕîlƒš*3Á\©2N–ÄF¶?ì„VÓvw'ÊDNùMÉ5‘ös•¤Qo@+  ™J†o$]5£Ì+ñÍlŒÿŒÓf#v}$µæŠ‚MEJ
dEßÒ¼4}´oDk>MŒ—¤Ksˆ	Cí,3×Ìõ<àÑ\Ê®Æ’WïSÉ¥zB–›ŽôúÒ#‚ðÖOr,òlÕg®< &š*ìÂ-£Ïñá5ñÙ¹M ¥Á®U+ú™ð·›îëÐÜrg†ª4®XÝ„þè_½Ú2Í©áÈ†˜¥5øØ±ªX5ÌÐ°#ØSM5pml mcSL<È?´¹ælzzn&BÖ :ÏçÐÂÅoÒ0ÈŸì‰ÎNˆ¬÷hP1¸—&°{ÑÎYz&¡C@QÂ°-„ËâÜŠÄ>÷xÍLnùìù×NdÒÌcö‚}ò1}p3c„ý—‹xÛïh¼òÓc¸b€¤Å§Ø‰|¹qˆcjYƒÈ‘l¤Â *ÛdJçwÎ­þµ–%^íÖlŒ|Ðc–%º˜c[òí6*²!	Úmæ79ƒ„½Ó	ÙHÁŽÙLn†mö¬ÂsJ÷ËßRw…<¹÷©Ï-î{‘í¥Õ}+ìSàBÖ4˜cF£€èÙ¬({tÕ¦¬È7¶MXUd"ù“‘Ä{vçaôjfÆicÉÔüäX6Ýb–d*ÿd«Ðaà¶˜9s¥Ö3Sº=aÇ}5|¿ÄC™Ì¶¨c$DcÃ%½~ê*Œ³MUŸºÙ«à€Áª8ËãõcwßxÛ¶?eö£§”[œ¬À24#‡@Jç÷xƒŽÛŒMu˜Äœ™æÏS{ˆëØVk)¶E›ƒiSôÑ­à‘¸¯¼¤SÄZ“ÓÔü|, pˆ·Ça:;ˆi©ä'£î5¥ëqÿíÊ[ôˆø9õâ»DžˆµÕ 8'xñîÍ¦øüîMQPÖºŸÃÎÇhZyûúÁëw¢ðñÃÉÁ~‰CÜí…Ý›¸(j×p²†•µuh ÿ­öU{É*9?eˆ0i?(ôv‹(4F§ä.n…T<zÌõt8Ð0ÑPJ9[X5žÓÒ†á$Š
Ø„_ÔYÀç…üN¹3yÓy¿•‹ûÄÞåÎóÅ =N
yy²çý–ˆDšæŠ˜nÍE2-£d£©i¢EÓV¡ärOGUTK£4—¤Ûã}‚*ûÂ4ŠÒå.™euÛƒkM60·äc
¬4ÝTùlr˜Ï&WrÛÎa“ËrûÎÀ?™¶†xYæÐ£«ûÂƒRb1“2ªÙ;ÉH2SÅ°S´U37©Œ×KóÂx›Qk Doó'¢'k{FzF9¸øtÔ3¢“´ãe€ÛwÖŒæ»‹4º¹÷T€%gglObDÿ‰èÿcý	˜óú§'· AÇ“:c¡>ÕâŠÕ8!kÆ†úªÖý\ü?™YwgÃÙ€Â“žtx#z³‰ÓCh¾bä"(V5JU[%A%ÕM&Åè†Ñ àêt*â­¹ó/¦x~õJMÝéSMzã}þ€ÑÑMH¢Ô¥Ò2¤|±Ë
W¥."Ô®C´q'»y°JÖŠNYáŒÑH^©­UPIŒ&îçD£ŽYÂe3Y~7@ñõÔ øŠ`PQ¼$°o“èwZY¦¬x2Ãço.+œ!ÊöHKXy)âÆ@&um!^VHˆ·,Žúp&Óò—ë±Ú>k
ÑÓð}^‰&úÂú¨jB›±GF;øhBNÛä3¸×îÅÿÂ‡VŒaèîÛC|8ˆB«âÈjíNûM¢ß‡Ãqx#ŽÛƒpØ‘½ÕQƒ¾ã>`Câ8Ý‡ä¨¸wÚ¬ÔEµU=ÕÃF‹*´ÄI}¿ÞÕýãÓÕEýý~õ£¨Õ?Ö›Ôu£…>–áñ¾ú±u„/?þ\?iTOÅÞQ³~¸'ZõêîÑÅ_þóiËnzx_=Ü;Õ=è¦qR?À·'G‡{öEë´ÑÇõ“:øÚ^µ	Åa˜\°vzÐPœÔO÷r¬nñ¯•€oÆÝx 5¹úQYÞ9©/ðà’	ð™c9äÜƒÍMÃæš‰ƒŸÃAøüÏ—*¢/­{‚ªÁLïˆ”o¿ò \p<2­Û°±X’9e|SNVÚ‡azc’Û¼{7áÜKXõ9-
IEÕ–¼!upçV€®Iåµl#(çäpÏÌ £ÞàQ!¯ë|ô“lzÐÃ{á2~<\´ûh M9J±L —ç,÷¹,¿•£^îÊ*-`•¾)º·H®?ˆ;í6Ä¬,Í:ëwT}rqµÌQÔg;*¤®º“3]ëÜhBþ@Väæt=uYLÑu²aÑù„Ç Æ®æeHA?}›CUËÿƒáq`/ƒòV=èšB+¾eG&:ôŠaN 
{¢sOaU(•à²$²‡)¶­Îþ*…=y ëUiÑr²‡\I"Ÿ¼¶R].—E#If¼¸PD¼É5)¢×”„³p}Ò•j¬LÈØ*œPÍ÷\‘Ì,’ S?kîÀJ$}c¦g°íä¹±¡å­rä	àZÛøðŒï¼%`ðÒÛ/¡î8ýµÖMú2ÚLAÏÞ’×÷°ÊÉ¨=N®cT,wo ÍuQIC`ÁÔ‘ö"ŠGýJú“ÿxc„Q©èÖú£shµ%õAîFÆ¨·'’Þ|½Àyø‘N[¯ù2O¹ðY¯
T¦3Cn¦\Û?:ÝÙÝ¯6ëÍõ‹÷§µ25Ï:p|ú¾¤ÊŸ¾ßoÔ.N›û¥ï!z¥=Œé>òôß3Sg`ï1äÊflY47Ž1¹	
ZŽt>´{@XP[,³˜Ìú¼ÖÁµnéa`tçëßÓÛ‹œôÓçÈSg/â˜[àUoø h[ò`±hB¶ÖSy=¬Ìøºw=L%žCþùPjø‚ $yÒ!^%7Û¡ ´nDàûðFbF%6m6I`‹nË«#9<ò.@‡ãÖT%P×Y­#ù®hÇol_Öå2öá <n£‘‚5[=¢K3¿‹çzuæð``L?O/Óœ¡Žî,9Rd“«;CÌàÔõ¿5O>NÈ:PT±¯‰‚wJ¨Î6È†sQJÄâüÓ¨Åƒ,k†ŒÁò¶žú‡#ëiüB<Œtš§ÜÜæßaEï&pží<iU`K)(À"Ì¦W?81ßÈL(‰1G±Ú–óÀ†Åtà!Þ,P]„8Ió\xÄ†|´ Á•v—®n.Ý¤L‡‡¢çãµXâä†hÚÂËXßÕu,Tœ‹‚\w]È¢Ì†6¦èÍ‘Ëù²Ô?ãÝá¹¨9Í)'7":‡–ßSØê¸hâ¶"å
ˆ3°+ ©»HÂÜs®mµzs«}=„0L‘ÌŸ›+©/RO6s¦'	ðtÑN0«ç‡B´è`‡„†)S¨p²pÊ‡‡ ´tfÃÐ„VS°Ä¶…6Ážþ˜ã †]D=âóï°å¢XN¦…±r#¢g` Žœ ç™o™3(_¡•aÔG»—übeKúê‚°(uüä?—©½2åìÔê¼Øø­E½íx·D®.{Í*&»hÕkÍú	6 »B>îñ
†ô§eÙ7«k> ó§£öÄü	æöË{Ç€¼Ž‡yoËšˆz#ÂÓÃšQ¯³l +˜ß0lzÌIàÙ"
ÙGJ6dˆ¼O£ž3¨YÔ³bÊ %klÞOÌÇ~~9ÄÒ®*z™ƒs8j”|";FNPI—Ì*iSb
ØQI·ÉÏŸ(k7æÒ¥´Vÿñ¯ÿD˜¯RÚ5èÎˆ£Îsg5l¸}¼¢¡mTgc´jZôz'îÚoY§Þ½Š†i}Òi›!Ù*“l†!PP= bÑXñ$>hk—ž]–t#½É}sDú£ÏÊ MÃÒZŸÆ8¤g!OËƒ^Ü-èÕ-’.¥˜BhG2KË—ü¿ä—p$“ˆk’ƒàbh×èÓS*¹"½0‰59=ëzÆ~žéqž»7nSênK•¦[ºGÊ'mJ ÛhnˆdºQ,S»ÆD¥=¾¾Lt(7§9Z¸]Î%¿%Îò½ÝÉzh¤gb£—`®_ùRg]M}áúûÇð>Ék œ¾ý{L·ö%® š§rF5Ï3b8¢[Ïà=¸+æöÅ‘ÕwD{íyHÜÔYDJÚnÑ¾Ûuc–êo¦‹˜¥0DTa%!OæzõÊ”4·TjË’7nI“·1â 
l%Ù<0V´}*Ï »æ™aüÒçÒ¡Î]äÁÎe˜{I3ØŸbÑ ¾¤#«·¤)LKŠ’\¨í0	¯Èz]àØ¦Iß—~,ØÛ”Ò€\ãFMÉVV$³Ž!I‰³‘¬÷š‚ÙCÂXŒ5SÆ •E,¦Ës«)ßÙ¨"nÝ”´	 ×EeƒZH93ã…J]»,îÑüƒ4¾¦è‰Ud)6²b>1rÄ à_jHcS¦~Î ü]4÷Ç²9íñ|c?¦´ßNCÕô†ò0£gEñÔ¶‰B–Mˆl_r²>Ã¾ÔW#@¬2
¾\4ŸvÍXruâÄV÷¯OŽF!ß•‡ãÈ7AAÿ(Íw,	ÂçñM­Ù¸Ýi«,{¤Æ<‘PcE[ë-åÜÅ	ú/Ã6:´Ñ},§UíEWW!FcÜ—“qHžõÕVzâ·ñ¦ªÌ [!ÿ2ç•yýÚVü ö¡†¹bÚ£‹n<Ï’îlÐž\\wàqÔ½è_8×+¸ýrÃîudÌä‡Â6ÛÆˆ£^™2 ÇwÀ¯H¡"pèÊ¯Ön… E'Œ‹9â<fEÉtŽ0¤?6Ë'2xIÍ_ƒI¼%È¡d	L{ô	Âá ƒ9÷fx›<µ–Š–h¸Pš:1üEj‰„³DìK½©ÄÎ8¡ƒ£…ã$HË`=èh–õ“:ðŸÙ7Hdÿ¥¥òßãnŽ–TÛtÃZŸL¬È°‰$¤´‘ãdçÈ¼K:òÊ+àÜì…<f[»‚qaõ‹>!ý(’KŠ{Ñžšúá¯…¼]/_2³d5Ø/U5fzàéÜï°ÇÒ`ÿ¨î"Hû“:¸-6 ÷"¬1íyº€õÄ©QƒBxþã>Bî“Ü‹{p^ÊG:ÂJØž*,? GÒ+>ch1kÉ,GÝ(ž%Þ1*2'hy[ù*
‹+W¼øÔ{X[-Í/ÎÚåßVË?ž?¼-ý8^±Q>%{¢¦–@Ñ¥¨Å"Ú†žl<]@‘<Œ”<¶…W„ÜÎž÷r‡¥ë-ÆÕ…V¦Ië&ñS†°Ü—XŸØZ»3FLªqN†•<p8¼&Q\¤YK\)*§¬Éþ(Ö‹ä©eÇñ–ü„7Yä)·{
æ‡!Ì¹»Ž1¸)q˜`ØTô&eKõ¶¨¢&„,£a`™’MÊÊ³¬gZ4ÇI›O<ÂÉ&§ñ¾‹6*£Ë]¥ŒD×Û½AoÉ0p7at]ƒ `8ø®P Þªã]Ó2okF†
iÐx¤€I„Šb[¬	XÙM¯rç‘ÊìÊÄ“bU$°Ø†ŽÜAoËôÎ–Lè›Ü•4 €tÉ!êh€ç)ÈOÔ1æõ<ìÌ8\‚RÊŸŽÀŸèïÒIs­¨±AÆk!ä7Œ=î6tê/pû¡›H`æE1wû¡uiêi9]Ò\n¢ÉÆs‡»@ÌÕ.a*{Uöa5þ'½œÄ‰âaçð\m.ÝU`zd²E¥MÖým9ißÁJ‚B[˜Üj[ríX²„¯
ù$ó ïFz¶¥À½Ðe%ÿ´9¢ÌW…RR_à*¢Æ&à
6P4¨&PÅU…°}	9àd6¸øcÁKäL®Q¢ëð¼›âjÐî«ôÐDSmV¸?Ã»žQ?p–ÄÍ'ÂÊ˜T!Ü=þ5æT­Ù)gue¡[L-_!’ ¾*y4µåø˜þó¨,p=mŽt²^Ëø*ÏüÌØ­cØXg‚’A}*¨ùàtç¬ðÏrîŠJ0×°6¸Ÿ†°Í\m,¼fv-è‰÷"ŽK“	/®#OÃÅ5™¹O•‹K+VkÓÝ–^æ?mÁºA
S	v™ãQ»ãò ²Ùwƒ4Ëyç]4’0R#ô@Äý/·©@Ä¥Ó ú(vHüÎZÍÞ©IÝW§l/¢DÞSK«Ývò~¦;œÖÅµ½0Í¨¶¡Êì ï[Žd´Ä³ž vTTÄåh<”’èR%©§ûV6ÇÄÚThå{áí¥(L“ÏEJñÇÍa.ïŸ0¢Åß¹»G”O¸j¤‚"WM‰°I…w7$ý.ééiƒ[K¢é@°…{EÞ$dÆŽ¢>ry‰Èu&}5Ðp±an$¤-ÊÏ"¶h•lÙx÷óÐýÔ8©sxœµœ`©R0Ó‹Atvï»ƒð‚C–Pq˜zªHY·ì=\hOW)üí÷³OŸ*çE€Q~ýþ¼X‘\ÑZI²\FgU_¼ÏRÓQõ9aÓh—g8žžc\/4¶ÀÄ2¦Õm‰<äå¯Î±üÅìçŒ»O©®)üœÍ?e:«áx ÂÏ¤Ò¤=u5*&PÛ¿Ì4¯Ò;Jša<—Íe¿eRª¨iµÂlÈ'DS~“‘Ì…ÀäXá£ÕöZÐ±)Ù…¡_Ã¨×„wÀPä&ÓÿÜ!ùqšEýQLÉÏÎ!ÿòe…ÔqhPA6¤Äp½É—R¥Ñ’ÊË—Ÿ’é¬ÅÙß(œÞm˜ýñ%¢\V_Ã1V°ÞŸ§©±‰M4–¹z“±Ê7·qÁØ%*
ËÊŠžr2?îüH¹R Ë•²Žo+P¯L\HK@AyÓW’ˆìÐ&nG©Â';²ÿ^Ù|µSÉþUßº0|Ÿ¾.Äáu\™Ú¬ÿpý™<¿3€bšáƒ¿Ù¿ñkYyè÷Èî<z›èßÙko8¹Hör•ˆ.üUÑ{CÓejdgü…¤‹H{úQá¿ÜŠû/%)Ë¸:ñ×‘Z³8ª%·“ü·vZëº—Òt{@WûòfPã”+[Ž¼#ì$ÃQ¥Ús‘/õùä;ól<L_µ}úcùGbã’Û²¯ÁFñJäaŽþòOÄR†ê— ª¬ñ|ÍºêË^zÓð— î—×SúÝ°ÒÞlš<b¦|ë-oaí­›t>ÜR%t‘õïÚ·ÖÅ.Ú[ê…œÏnR÷¸Ù@Xä„«1s%
òéEQ^pÃ›yHY‘å¹ô§ïs0}Ýº¹« ï\h;s)Ý†}V…iÑ­ñç^§¸€}/{µ×U`·Û€~*3Í~ªÎªå¿¶Ë¿•_ýª¸‰"é»7¥Bðªø¼âì0lÅŠhãÄ¤{´3Ã;WÁ{úÁ®¬~¶~^ü¥NýpÚ…¯ÈŒÜ|ÝžŒÜ¦Ÿ“3àÂxCUô×ƒ¸Š¦˜à"ñ%A«®x6­x{3$7yûî7†)ÓÈµŸRòmˆ·«…¦1ÏÊ÷Ó7ìÍ-Õ­ÕÄ¦¨Aà)šó vBµºM£ìWh‘vñÔcò¦kmz%íJþ#É¸o#è"¸–Q–lAøOÀñyÕnÆÍ¡ón“B«¿‚˜-5¹]`òÍ”‹¥îŸÛ“¡˜é’“ìHì<ñ—Œ ¬lcMÁ$\•É\‚C³aRñQ-F£+R’FýÙ„n]¤œ•*Ž‚	D™|1˜^‡£ t”(SŠš®[r5Rb^týö³êX(xYväˆÉ‡()È.åÝþšÁò§y'dO…(é¹ØÛºûùƒ®Lwws†^"0›î0b[{Š¾­ fEÝžŽÁYL2{¦lÐy§k\0X¯;N
-µS©·°gâ6§íW@ÊíqŽ ¶…NB8B1’´ñ±ó %W³Ã2Š<ªh„i]´Èh`ŠùÉl<Åx`(&ÿ9îhØËXÅöRò+'$ˆ~ÓŠø9Æ3ÿ\X}ÐUG;j÷m§2€µJå…e½<z¹Ð¢™·cháÑë¡;ÌX	”väÈP@g’’ÈÉXZ¨)¦;åysÒrQ‹»7c Õñø\ì)CÏó‚”R{ƒj6º~þ€]HÏò\]Y‘ŒZãux´S¿¨þÄœ*ˆN9†(¨5kI;â¤
„ZüO   ÿÿ Ž»$