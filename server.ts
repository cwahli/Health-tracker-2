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
  logStagePrefix
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
                  _internalReasoning: { type: Type.STRING, description: "STEP 1: CLASSIFICATION, STEP 2: EXTRACTION & OCR ATTACHMENT, STEP 3: 14 PORTION NUTRIENTS" },
                  contentType: { type: Type.STRING },
                  diningEnvironment: { type: Type.STRING, description: "home_cooked | casual_restaurant | fast_food_chain | fine_dining | airline | unknown" },
                  items: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        keyword: { type: Type.STRING, description: "Base food name in database-friendly English" },
                        originalName: { type: Type.STRING, description: "Exact localized food name" },
                        chainName: { type: Type.STRING, nullable: true, description: "The restaurant/brand/chain name ONLY (e.g. 'McDonald\'s', 'YOLK', 'Pret'), separate from the dish title. Null if not branded." },
                        estimatedWeightGrams: { type: Type.NUMBER },
                        cookingMethod: { type: Type.STRING },
                        ingredients: { type: Type.ARRAY, items: { type: Type.STRING } },
                        sourceImageIndex: { type: Type.INTEGER, description: "0-based index of which image this item appears in" },
                        boundingBox2D: {
                          type: Type.ARRAY,
                          items: { type: Type.INTEGER },
                          description: "4-element bounding box array [ymin, xmin, ymax, xmax] scale 0-1000"
                        },
                        isStandaloneCondimentPacket: { type: Type.BOOLEAN, nullable: true },
                        // 1. Literal OCR Label (When Visible)
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
                            salt: { type: Type.STRING, description: "Verbatim printed salt if label lists Salt instead of Sodium." },
                            potassium: { type: Type.STRING },
                            totalFibre: { type: Type.STRING },
                            solubleFibre: { type: Type.STRING }
                          },
                          required: ["servingSize", "calories", "protein", "totalFat", "totalCarbohydrate"],
                        },
                        // 2. 14 Mandatory Physical Nutrients (Zero Calorie Input)
                        nutrients: {
                          type: Type.OBJECT,
                          properties: {
                            protein: { type: Type.NUMBER },
                            carbohydrates: { type: Type.NUMBER },
                            totalFat: { type: Type.NUMBER },
                            saturatedFat: { type: Type.NUMBER },
                            transFat: { type: Type.NUMBER },
                            sugar: { type: Type.NUMBER },
                            addedSugar: { type: Type.NUMBER },
                            totalFibre: { type: Type.NUMBER },
                            sodium: { type: Type.NUMBER },
                            potassium: { type: Type.NUMBER },
                            omega3: { type: Type.NUMBER },
                            calcium: { type: Type.NUMBER },
                            iron: { type: Type.NUMBER },
                            magnesium: { type: Type.NUMBER },
                            vitaminD: { type: Type.NUMBER },
                          },
                          required: [
                            "protein", "carbohydrates", "totalFat", "saturatedFat", "transFat",
                            "sugar", "addedSugar", "totalFibre", "sodium",
                            "potassium", "omega3", "calcium", "iron", "magnesium", "vitaminD"
                          ],
                        },
                        source: { type: Type.STRING },
                        anomalyFlags: { type: Type.ARRAY, items: { type: Type.STRING } },
                        visualIngredients: { type: Type.ARRAY, items: { type: Type.STRING } },
                        nutritionFacts: { type: Type.OBJECT, nullable: true }
                      },
                      required: ["keyword", "originalName", "estimatedWeightGrams", "cookingMethod", "nutrients", "ingredients", "boundingBox2D", "sourceImageIndex"],
                      propertyOrdering: ["originalName", "keyword", "chainName", "estimatedWeightGrams", "cookingMethod", "ingredients", "rawNutritionLabel", "nutrients", "boundingBox2D", "sourceImageIndex", "isStandaloneCondimentPacket"]
                    }
                  }
                },
                required: ["contentType", "diningEnvironment", "items"],
                propertyOrdering: ["_internalReasoning", "contentType", "diningEnvironment", "items"]
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
          sumCarbs = Math.roundxœì½ÛrW–(ø®¯ØF¸€/²\Ut«	IlóÖe—[æ¡@È"‰ÊLˆ¢eNœ§~ˆç}¾b~`>¥¿`>aÖeßs'J²ÝgN+ºËDæÎ}]{Ý/­b9ß‹òa!¾Û[m±	ÿûí£GBÿÛÜ½Åbv+Êi,Šh‹<ŽfIy+FÓxt-–E<IJ¯y¼1Šf£å,*“,‹¨(D‘á;·ÇY<žÄùf½ƒË¬Œf…Hãwq.â÷£ž-¦·E’Í²IýÁà4fQ&#øô]<+ºnœ×"ÏÞÅi”Ž`ŠËY,¢Â™Ífþ7/“h¶1ŒF×WÉl&’2žÃ,Kü{—¼¬xl0ÊÒ¢„9ŒâdQ¾ŠŠçòÛxü"‰gãB<½<n»IAÿmµ’²»È“y”ß>Šx{kk‚Ó‰ÒÛö³îeƒÍ£R}ÝøƒXñEåƒî,N'åTüUÀQÕÌ²uÊä]¼?dËöäéª<Y4Œg—r{b—¦4V_ÿòlT· íÚQÏ4öp—ežÄi	{~²|üÏ<H'‘.çÃ8ÿ+Ìèƒ€“É 4"@œuðË8IéÁi‡¡ãETÒoøo€°\æ´òé *ùE6N–sztu ë|˜MoÇØVõ€~W~RìeóEV ,œñJÄS«‘-÷|a+FøAŠë£ósžèz*vÚ°uNWÚ°ìY>?þýY×~ ž>}*{'G§'¯÷/ú½Ã†ßÁæOÃÖ0»™ý²È®ã_ŠhÂ°Yû§áfÒ…Å–­m5Îvw’¤Ñì¯Ÿâu|{ç!¥òE£Ñn;7?Âk¯NÑ>Ù¢åÌgÝA:ÞWñü‡8™LË—î‹U ä¶eÙ5¬ÎÚyÇûñp99Ì&Áž+WÃmõÁù%„½¶ÝšÅªG‡Ù(´	¯KùxwEL{Ù20_	ÏÂà·+¶ünmXÛ]Š•M£$Õ› áJÓålæ7/nSÀ¾€±:£Ï*OýÏ’b?)¦}‰ðv½ßý4Òjåñ?Úî—wÖ/?¹„â,Þˆ˜šåKØ¡YÐHv¬ˆÚ5@W9Â ñ.‰Äb™ÇbÏq^ÁLËÎ©¿§¸FêZƒ,îÏ‡ÊøpJó]|[€ð<x#à/‰(ÿŠÇ<£&ª7lŠÂaÁôvŠ–5~;€™«•ˆÓQ2äV,g8mÂ©ýŠ:À	-÷ 65¨ü÷ÁØîY[+ö^T6‹€®úøc1N•NX¯ï\ô™\‰V`ó»¸õI(*-p4imóXh¬õöÍ!­ù }åI”–Bv#ÆÜ²â*Ëà<EãËc¸BçI9‹ï»Ðïß—œ…>Hq•gs‘g7°ápzâË¡y§jKºêÃ»·¼Ý­¿ø»½á¹z ïö˜çÉ8^w#d'ÝþìžMøâ! €ŒÄªªÛF¬G(¸™õ[´, Y{‚ŒzÇÛíù²ŒS&“4Ëã±¿!AÔˆÐÐzpFž§÷~/ñRøsÀ?÷v 0Y¸Fb÷vb#¿pGÇÑýÐÉ‡?gyÿfZ¸Õ—ðNàÆÜäI‰èè\‰˜nÁdå %q,ÆÙ	‡?§ÁA‹ÓÑ­ï¥>2¢„tÊßºä™È÷§Þ[µáòµ·cÈ?X›)ñ1øíøJ?•ûû­?Kk/ôTa+’oQÀNƒ ²(üÿrLkÏ@¼èîø<)€7MEñÍëãÃ“½ïúûBo½ÈÒÙm»rtãäêŠoA…èN£¢ÕT{ÙDo¸¹£¨œv£aÑRìæ¼Hj³ô‡9­DžÇê1Nå§5ýë›P3ˆ}j«G’=mX'[3&]šºñèôWßoHè¨Òm„‘Y’"+l°ó1ì”Y%ëpŽl©øãSñöñÕ~.Ñ©P}ØÄù?þûÿÊR;ÀÝWâxõ}4k©C½s‹Õœ4ý§Š¥
¼BÖª9çç?¥oì,âYÓš<þUlw·‘ÉdÈù«Øên?Q¿åù¸a+é£ÕdOA &™äÈ¯ùºxHvÂrŠw`‡„Är1F0bRÛ‡ª
1Qö20û§_~ð.Çøÿ´ãüsuBù »OvyVƒåpã‡µš„Îû+·5€&¥Û»ÉWx¦_}åŸjõ±:Ùêçt«¯Í	ã;:ckÒ@àc<Ú?±2½>U/O+¯ðÀÿDÈôZ‚Äë°15ùcË©!û£ƒ‡½&¼—ªÜY[˜8%é(ç€yaÅïá,éÄf õ#Qƒ»ïÅx‰r õhÿµ:+bXõÖ[Dy» i´Éô¯	’KMðÁX]vxVN³%Ìk×…’;àf¼ð}ÿìåÁñKqüúüì |>/þ&Z½åDìlí|ÓÞçÓXu¨V‘ebÚ–H¾¤07)ï“R¦ÚƒÜ$pñ’t/`U¸ì<[¦cÒÄÝL [S åpkXÓš+ ˜ˆ”§ã¸Œó9Ü4Ò½^%yQnV×àí"Ê`g£22Ç[øÀ;11šÁöoA ¼éŠb‘Âu+¢«Æ¾Èò˜>°;—Kß ¥7hœà±½¥õV#oA’ça"Ú(HJÒ/‹¸Ò7ª†ã÷¸6ì.¼
¤éøÝâñú@žöžF9P5©â6Mó,M~&VØèŽ™^Ñ·’ãòÌ°MÏžéÛúm¨“ÓÚ.c¥z8~/Ö`šùR]8ÙêÄ0¾Á~Mõåã«;fÃ]1§:±q‡³³’®Ù[›Ù3ì²{AÄþÿþ_ÿç¿‹—g½ã}šXq~rÿ‹øÝBJ>~W‡íãi>¿ 
·vµþý*o­ÜYÈSg].îù.Žî²‹ú]bòz™ ­Îa`7 m¸"E†òAŽh$/ÄÕr6ä2&ìBwäõ= Üo¶ªH¡>
Ñ”X²I7‹2Su,‡ËÒºk€ba.7ÔƒšðÎ"^¾îÁñœ÷ßþ·þÙÉÆþÁ`ï¬Ú;ÞûQ~<Þ{uvr|ðo½óƒ“cÑÛ;;DïðP÷ÎÎàá÷}À¶ýÃýÁ®Ýçð'D3^‚è3Þ'À¾[7<¶î}¿/i('Ïâ$Nb#*è©‡™%zMãÌABKø\k¡'AÚ“ 0£´o='ËÕsØÛkÍÈŠX.Ä3à'ãñQ6ŽÉžÐ„y$ñM™ªpƒxœ”ôúÿ}ÛeêpfytsJ“èÎã¢ 2XaŠý ‡Öþ«í;‡Ý«öÖÑèRþuÚÑ¸«#œ«¢ï…AµÊkßÌ¬*ƒ[»Ö«,£¯ýÅ†[u‡q_%¨œ÷í	+¯·O•Ï>ãŽ¹{V»º<)®×[µ|àºè›ß~QS¸·åô`¾ˆFZpmö\¢ýéïp|1pÀ!£â9|ŽÎ'=Pçã_m½´¾ò¡Kk!„úËh´jíæ¿òéÚ”?|)ýkÎÿ·¸„Öp«/_MÃ5—ò^6—[yÉj›®{@¿õ¥RI‘Y«çQ¦3ñC”#×x!€i¡ AhÊ„Ç· ÿÔøòƒÍðÚ§+zÀúæ‡8Áa,~Žó¬Ëú#ê$Ÿ9ÈÆ(ÏtÿéÚ:ž õÔ1ÉâZ,O\Ç _iiüò»þ÷èBý½Ï. SËç.4oáOÅ»ç”lëÞ6ØöÇV{äÑ¼ØevòóÄnhL´[¾ñuË]ç åè³+ÚÛ¨ÑÇÀ£}ß¬ìB­R+Ï€iî§ÚÈ•)	Á8y|vÝ‚ÌçÉ;¥¶3¾·¸\`qÅ»¤XâÛt’_Š4TmoZ•v½%j›:Ì­ÕÊ^ÅÓúìÎ£ºzí’›–xúWPfq‰k”9ôÑhTµØ¸ÞÃì&Æ÷Æ_g¥é…÷‡ž"T:é€œN_íEEÜ
(Ç“â=¹H)IþÚ‡‹X}rój:þ\þ3<þv„“¼,~HÊ)ÚP,_.½ŽPsÉßÕù\6ÝÌ¨BˆË.÷>m¼o.¾uP·­ðÉaRÁÁZì3øLº­Uû„e½¹p&IÖYû{”Ÿ¾p!G„>\jPå\ƒ{¶UuýªBŸë«ão€µÇ…‡@kd õ€˜F|Vì Ò„%`Å#£nGùhú¯Ë8¿åÒ¿¨Ý½Jf Ï·žgÙ,ŽÒZ9ÉÛ¡šýøÃüýø+î†»6@/hP‘`_DË
ùãD-˜=ü9™E?ã# Üq2§í[@ë3ÔOŠÑ¼-çN§Êéæ}‚!¬4¨g@Vyt›¥i”ôK„ÓHôG½»Å?®ãr4].è³%B8¢»Æ;@L	@MYêßÖœ˜Ú¹³¸;aT`æýÎ»ððÉ½×ÿ1ù_¨uÃÍÇ-ø…Cq§Ý$Í–ã=‚Þ·}ŠîÚ¸ü³I¬›BjÛp¹RÖJåÁ˜¥Õ€à˜"×lüAçQ‚Ôÿû¤øl;uÏ!¸jœjvƒ;‚‹'÷ð*îÅÿ¶ãU”ŽgDÁæ€ö£áµ&ìÙ°Y,‡|åŠÀ˜j¦è¹I ƒ·#0<ï™N¨[ùåªÎÚíxˆ²~¾üØŽñ$.Ú÷0Ž¯j{Æ—¢(ŽÞ×­|WæË¸
ÑöïªÜkà
$%‘~+Z_~p>û{–¤-Dí»ö[oüûñ§œû[6÷ÖÒõ;xOS¸³†¸k[ƒW.\Ÿ²s¢–î €ÿM®nkø™dLšàt‡Ùø¶‘óëEÏà’Ý•¬¯æÑ$~ÏÚ"ð°¶CõÖ·²Añ¬ûfëâþÑ	?¶B/¬Cõ£ª	ŒÀÐøÄß|}Io.AdŠ.¤Ò²¹ƒÁ‘ïY£e¦Ô {‚cF€W(´à©@äxÄzÆôÓyfÃ¨DÏ*­—»æf¤*ããÌUZÔéÎã|b- å®§c©‡Ì8m÷$Ív>„_©ß®½ÃL/FË<²ÄóvbDž=Ò£¶~Lf´††å¢Ò1PQM°Ó _ Dé‹AŠ¡9@z„RR{˜b·@ƒB -…Î¥òLO¯ÀŸfŠ¡Ð1†šÙë«÷…Xo|Ú<38È–ã÷»2À#@Üù¨†R6©?ØÙ±}*Æ¶Ï¨z•·x0•ˆüýp†!¦ý)²øz_Åùy†ñH/²lÜ†ðþ%{9¼ïöÂOÛîQ9£¡–Vè¯àôG©ZúŒo¨õS±F/5TÙïYˆn·Kó÷Ýúý0
9zµ™¨m¡Õ?Øêž«¥!1[úÀëõ®ž¶ëÅRgÎ}±;lK25á£û÷"Koú9Ðê]`çˆX7ý‹ò‘Œrt&\D°ÑV±öÇh†Ü˜Ý`Þˆi¤m¬cq?Y(‘•Ïã+´ô{o\Ôºoí¾e_¿V÷HŠm¥—ýÆHËSÒîí’µ™ÿÀS»™!B»Uåô·Hö¢ÙÌþ]˜³úpåÒxöÇ0?.¢{f]†doûÔ)îdžÁ61|nþc¥%:Á1¢D¥×2EÓ9¬£x\4Kòâ(ÊW©6BÃ’þS:Ý<^Ì¢QÜÚüiüÇŸŠ¯Z“_&÷¿d?ÿ2¿\O~)âüJ4¿,FðÿIDâ—b´‚ÿ·h?Ûœ$Ñl‚Ø•'ó–}¼àjQ[”—–À{y˜e×ËÅ…èl§ˆðh	PB›Š·&Oâw 8äpÃvõlŒŠaw­wÑ"=bHeÜüó6 »Ba?Ì'HÇ¢›ˆÜhDÂÓ4Ã¢åŽÔÔ…á±5PQAÁXÛžô@càaýôøTë°§—íbÓ0Ï]óñ·÷}JŠ’š=ýÆºç8XŽ J
¼—·"*ËûÖ»:–çZ§ÜßÎC5—ÚhŠ;1bëd>éç¹$»¢nÛè¢I=³±?ræpç#dšÙœ²Šeöyö{˜æß–e®Nß{ò@¾î³pu¿O÷Ÿ£ût~î“¹¹^®Ž“[‹»‹ûü<Ü]mÔqoÊoãæ”£Ÿ/“ÙøœÅâvc•Scåà]ÿ@¬5ëô®¢†@] Âz*±â+üþ>×}Z<aˆóù{FV7-ÙÓoóÚú»!ý„ih3FÞ7Æ¤ìê§ï’<Kçke©Œ•N·XÀñit‹ÓhDÕ½H:	Ç}9Ë&»ûæk×àj#øòöç˜½†‘_Ø%§IŸÚ|õjö¬§Š»kÛÜèz¬îçSò¿.ì8hÊžŸ6sÄÑ;tÝÜ%©"ëpÎk‡Ç3ß}k3ÊI!]îyÏŒÝ¿Š#tµ±JB\ÖzË«ýòÃ¿NŽ»¬QA¨õÇ—«À–3r£wî®}÷SúSj“gKØ‚-lUoµ/y}ÊdstþìúboWˆ”lÀhˆÒqA`.ZÉ²A]¨²ža"‘‚5v¸'såT©¤<³^<6<ƒ'‰£“ýƒ?ò °/“IœˆÑPâ…¥mñ¶7b®~Xai3_˜ÇíZÖ%SØ”b—Ž39wä4_ eèE;Zf9™†xÅÝšªHÃ+.xã yíÙ8m–²Wºn4ø0EÒ›?Çˆ€Ô›T~Áé &š@·âØú"¦¾ˆÛP ÃõåÜß~>|UüÌ
ëˆ°bW¦÷¸ú#tvPõŠX(õÃ3…›£Eã¢„Ù]qpe€h7 íè2a™7‚Ô¢z>h(T'šD	Ò"ÆŽÚ¹ê{Xå¥þ‰žúÞV÷¨£5ÝS,ö½V¥V³cy\l5}sQq‘pµæƒ0š“ÚaÌž6V›–Ù?ß{†í0É¼¼K«•ÍÆ5.jžÐD2ŸÒVKß„xP~áóÇüTù0ÂÁ¶óJõÃ·‘)¾ ÏÈè©·çl"oKR?ÿ*û,W@_…VÀ/üðÓ‡­@ãF=8\#µ•¼+ø§±šÊvm9 ûR¶˜ýíßtÍ­M«*‡0×],‹iËoÈ|h–îbxBÙ%R³ª¯å ?ÜsIõó2ÉºÜ'Ž˜?A§$•uÆ×ã®rdlûñ‚úš°È¡âP@ÄA‚¸6€é;²Æ~?ã‘)6=ŸÌc_ãâ“¼òÖÿž÷þ÷º5Ö.¢O†-©ÂÃcÒŽ´*ïÚ¤°oM?N“Ïs€/¹ã•WÑš†ÚëÑƒ.¥õ}3«ÁÆ8â~í~Ýw©MÌú÷ËçÙV@÷#·{î³†r”ñ(¾<ÐÛgÛ¡z´‡»Úƒz™ZÙàBLG ÔÕw{W#N‘¿Ž¿z[Áfš¥ŒT£5šw>Ÿ{¯ØtX¶@‡~ 9Q!Ðr‹ä/Ìg›(¢y¾H	* .cTÐ.K”Mœ£@f:_ÊLg€y9‹fÄ¯û0éè×–… nk=QHÒ)+#ÙVÓÀoƒŸ{èÂé²‹®#à5£ÑH)É;Âö‡â¢%ïsâá(u«ÝAÐ‚¿¶=­[QÌDùX*j>`¬Á®`ÝÉü6¾þj`×á_?•^ÿüûîÎQß‘+ž›Üm§û¤;ÐÝzb:ÚîþÙNÌ†.}ŸÖÃhšŒ®ãÔíd»ûM¨—m+Œ¡û'gp˜Eù‰,²¼²_zxl÷à,æ*)¦þ$îƒÓCÍæYêÏ¢Ð}<±;ybw’'ÒáNãq »ƒ­mw?³Ñ(›%n/[ÝÇ¡ÕØÝ<¶{‰'“uvã±_ÛDï²Q4Î*çèdÇYL8Æþ–†ú°ÁôkÐ—eçn'ênû<éZGûÄ/`YâÂ;—¯«G÷ÃtñMwÇƒ%[Ý{ŽÄ9Ø2æ)ó»Øþó}ÐáÀW–ÌÜþÜ­t°MWÇtà^´20‰‡Ía÷=ú ¯è´uN	Â¶Ò¦(ZŠÉ)GaÞŽÃó3ÁŒo[áXWpRNÎvç)zÅ×Ëdami(7÷¤øašÍ¨¯#²—?eŸx5GOš“²©rµ'Ï–ºê\í¥L³§>´—à„*­ìKIrÆkÜí:ñYäÔvŠ1Oõ=(LîÞVÀGTÒ,Ã¿–3K¦ä²ÙÞ+PcZó[7L¬µ*¢‹ÍÛ2h¡zÎV°âh>Æ`EÃ³úËœ´ìòÿ$€ÉFú'ÍÌol P6·<SJ ÷yÛx"½ùo?½ßÙÚøéýŸú›Ç³ˆÝf8Takaþs}ýLÛÌiW^BÊ’uÕW€gìÇWÊ¡Ð=Þ??­JAî‹‰y›ÿ]¾Cúù¥qƒ7µAL_à-ª¦òú×WûÁ¹Öñø<{M»±Š~&UA6àJ¸õô4z`=îû6MsÅ8N€=ÕÑ2ÿAfùÓ3~f±Ñæq…¡ÞþfÁ
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
Ð¼ÔäÚã$H
Qôò„­ÉãB&YŒÙI‘ß‘†—ÙbƒŠœ“;FEõ\%,/Uªßµ¾•Ñ¹hrÍ5¼»Ê1õÞ4]xÕðÁðéV'BAe4R*ëcdûZÀ^×[ËêÐ—óÿ€û ®­G´AêÈå¶É‡¨•\¦×)tÑ}·B.oÉÞŠü»ò2–á”Iœ5³“¯a Ø§sõª¥€Á9®Ñ‰^Š/h˜ÖvX‚¥²N&Ë…]¾LlŠí­­êž`,‡±v5¼-˜wlUaz1Ë¢’âvÔ‚º‘lrçXi_žÅ
†ÚíÞ­óT7ÂÀâØ?z(‹y]9˜jW?ÐvÛ??ØÓãøæ¾=…ã¯ÙS~>~OU÷Á=­ŒðI{ª†ªÙÓÊ`¹§=*ŸÌ˜Gãì5-¥¾¼mÍO›L·:"¨ÛÜ¨Í+k~°ûÁÊ4”þ-ù£wÄ÷û*¸˜ö©Á¥>Å­ìü¬Èdõj‹[°I¸VRÌº6»­œK¨uàœjZš3q2õ„1«?¯ÝøÕŸ}:ø¢píJµzäãVji`²RýÙ†ƒìÿh£©•¶öúØþ¸5®w•îÿôÓî”¿bÊº3ZÎµ^¦öXA­m™GiÁkŠzò÷’]˜ã^}®õ]ŠBÜ¿a¡N‚_¹‹¯?#ì
U‰Y­zÅæ{(ê~-’Ë›«$q–X°Ëò€ªÒ cGXŠÐøKÅÈK/ÆñŒSÌ´*d°Š4lqGzòŽÐ¤Wàò«Ýé
Õ.¬Ú»sÂ —wQ¹×îÇ¾Üó{©‚gõ±B™”šêõ]%)ýõÉ«,Wvë©-¸×ÈòÇž¤KIT^(®}»»å¿¼Ò/1˜Ä[XoŸÀËÊœgè-gëÍ¿Þ•ÜòýÇ0ÀŽdÔŠÔÇž'k:AÐn9qƒ‰GOÁ8pC§!¿q½9^­«ÂU¥å*¢Ú:hÍ§ò?+u®•í•'\± s,Œ·á®UÏá¾§õ:ÆÌŠÉÞŠ5øJí®Ã­¸ßMçNW~;•>\Ã·óuqïÂÕ¡¼&•JQvØ
þ[­È¸Çó©:ÓèzÊAý{8Šc“Ø9dÄŽŽ™¢½Vö2lUò
Õûíûù|V©¾)]ÜŒ‡h¾íÝ8¨R¢h¥úVD*>þ¨Y—"¨¬
5ø-¯ZýaÜ_ã†½A*¨6Üì¿p¬n²Žý<(è#Ð
ô£nû.Uõ
ba½j•ÉÁ3Ý•Y™|pŽøÎŽR}¶¸(w¼¹c<CÛ7hÏ`3`ö¨r2—@P•ÕœÜ/1
Z7IÚkšIâËÉÊ~eÐ$o”m|rR¤TKêLA®<Èìg:Mü^OÔÊÿãÿW±NÞ÷Œ‡
'ö£Wf’óPêÿš¶uáÍ„~ÓhÜl¯Þ„šž×[âzû[­N)£7Ã•¥Ì™Ú€àT,rSå›µ«AÈ2ÿ%ž¥]‘§~švtt]R0[žïÓðsS2…£¥ÆÍmFíí~PÉõMO’ÓLFÁóæ¢¶£eïX[¦11TÓU¶I2ç,tª³Âe3œööæÝU@ÀÚ6·êG–g-£Ä' YãÍYƒa¡ï«ñú„Ñ>iá•Ú§Œe{¤9í>e·ÔöAÕ¿]ãø>%¼I4¦Î'¤;_Gùkz²÷?¤:÷æ9òé]Ú¢äÎÛa+ÀÅhØnHIH¥ÙÄ¿]m(>+6‰Ã_æ[ÇIÛ°an9‰rÓ_Œ2þ*²Ùr8‹õoLkR0m§Ëy4Icù´šiù'f^Çÿþ×•z‹×«w°ú”ûœfü¾,œNß%e4OÒ}®^J?ßÞÁ_W*¾­ç{Öß}ëïïBöì¿¡%OüA=æÉ0»šEïxsÓ$Á_²‹P®
YXÛ>+›TÔ™'¸²ö
³DýGÆ;³¾ÍW>+V£ä®ð›µÅÐïù×¯Î‰ö¹êTJØÃ=ë®S1@¯‹GÏb ZW³‡sMOg“Ö(1P©µ:¥ìÏÈ*QÕ,à? £‚å4£²-TÀq¼·µ“ÕÙééîÍ‰÷+Ž]W6 tœŸ¹lÀÿ.¬šC1fstJ!¸f³¸KoZ7$8ô¸2„Lþ¸˜‘^Ëé67­dèû1XcJŸŒDëtŠYá·M) Š=;š¯>õ¡V0¹0|Ç"à7îÝù«®vÀ®Fùís˜ù†`÷þÃ:g Kp•¸°6å*Jf0ü"ÎçQJyó;”BVµaÝ¤9Úº¸AW¢Ù;*F/òâ©ÔJPæUl{“ID¿4ÑDÅª8<ÍJ¿>?;èŸ_~×ÿq s\ã¦®èúÍ5$Ã3Ö¯Wø©ÒÆ‘°G­³¢,ÂÂ\ïó±by¾’òÞåÚ^G­{Z³Wa…6©¾üð*tº.)¨š¬›A03`´ˆ^ æc¤8ƒN~®Ú‡l¸,Á˜¡_MîÔµ¾òfŒ[ö<%BQdÆënÁŒª uÍNêÐ²G«¹\Ñ-D|U™F=B€¼ì:²h•|:(±ÈžÛªë¾×†ÞCY?ÃPÈ–Á™á“‚ÑDï@Œf	é ë¼KF±H
«Ç2…3NfxÌ6=ýOOù¼³yáó-UVC`ÎÊeÑÚÙÚj31t‡ñtò1°$Êv„i,x‘ôòíÆåe†±ÇØ/35*3p«Ïí¾üà€5)Nö²4åz¡èž÷²lÞµuñ¬±IÅ@˜Š€i½ºŠñ‰Qœ±ßˆñ§¿‚ë–gÎ,­Ž”Ný8+{
$x×ÉÓUGûÐêÝî>È=ruSþçßÖ~QÂ,ÏYgk}g½0,‹¼ÑëäýàhOÈ‡¹0Äyð¶
ÚœÎ-¾ëãmü‡º‹¬([M¸~›“$Ðd oø†¬ÅœVTÜ¦#ª†NwF“=Òš ¶žòÚß4ßo ²À]ÜHÆM"<«ÞÅ‘º³6Î?/‹ ÞZMT‘ÇùˆXF×[]ë×[åZ?¨[Ñ<ŸFúÅDÄNcŒ¡Rôóƒãæ£Ï&öƒ£°”*”X0[`eà~âÑ’*ê6%™ÃSy@åásE(*"‹§JPÓpNu4šºàAÖA8BBo6$™eÂúbÙ¼Õ”€¸Øì@× mÆïð¨Daÿ;¬º_çÙ?L3àðàËlƒÜÎ0ºîk ðÓë8^lD3 Å5Íÿ¶ÑÌ6Ûx¾D4çÉÖ¶¶µq² Œ?)RÀ4öwW³e1•{§.AeG-a×Íé7 @¡sRPÓbâÅœ2˜Ù©v­	ÂZœÖË8›ø¸CR?í¯áoÔS@8Æ	 ãSe.?š´awU‚V¡c™I’$¹hÍpÚGØÃ‰ÊôñÎD×Ençû‡«DG“9ñ@MÑtfø&^-Sãv ‰MÆ•0
sTôXçïâÛ¦­A™å@àºù2maúÑ@
`¬Ó•å7Q>”¥VÀÿ34<)dsxx”µXàÐ›â‰6•ÀLÌ€×‚?P¡SfªÏóWEä›…@£+¢»‘!éd&ûÿþ?ežÇh3Y H£ÏgRÌqll&2…ê»4ˆwÖ Y%eYjÂ”à–ÂÿrÖ¥¦\<Ó%lE‡x
¸Qs’ö1}hšÝ´Ú
‹jj¢·Ê ƒd~Þcøiü!Q
ŠkÙT¤aS‘Æ®Hí>ê†@DŽ öU™h×À1jsž¢¿ˆ\‡Hå"ÎIå¥Â<zV½ëm’½3¦÷š¢L84ž¬ ‘†|P²„ìE«”©´³û«pîS*2õ¨#@î­þ½"Üø°’úYŒ¡‚ÖOÔÀ^<O2¢à ô+bñxòÉP5zå4¬~U-Ò-š\±8¥–ÐË|p[×ªÖÖ¹¯¿òùK[râ$?KvS˜Úßêj”éðÅ~M€ò”ÉHôpA‚„¼-îëö®jÞO‹%ˆDü˜/™¬Ë‘ ª‹<žÅï"èeL½˜uû±à½n«NñYR{Æ®Šë"¬ÂÝ*¸œ°'T¬‚ô†êZ2“>i¤±¬Ê ¬ì6 azFû¨JJXû‰VÇ1Â÷­°ÚyšK?,ÌgÖ² åY—7ß@eû»ã•]´m½œœ(nÜö ŒÛàCæ‘%ÓðÝAHêž<ÿ—þÞ¹š ì×"ÎKò=2ƒ.É¨Têz[wbõÔ;;ëýhûø¯ŠŸ\±vèUð`:”°Ñêwp~vpü²šg£<Yp–ªÆ9ˆSÚ=C™tPÆÒÃt1ü™Š2¡6®ÿ·ƒÁ9ô+ö{ç½çXYµJÁÕ2#Ä£°GØQ—Ã¦Ð"r âÓ3}éëNºâùAí¨{G¼ ¾@$íˆ½vn )8È-wÐÛÆ”ÝþF(9it_ÒŸ¸â­Kîø»!ö~¹½#Çw%ûo¶»o*‰Ña+TwÖÛI »st4ûþmmìï7ª½‹¬êè’b½n_=ïŸùÝâñžÊoá˜èkdDdb2¿tÅaŒÖ	*£ÎïfêUƒ•UF®ÎÌjœ]xÑfv²`‚;°>ƒí­¿ˆMñä1îþqÿeïüàû>ì~uÊf9kÌy™&å§‰ŸOƒÌ-\n5.ádÖ—fS9`axˆ5&ñÃ”
CM³„N,5G¯Ü1] é%–J
  ðj³èö’½.ƒã¸ûä{Öÿ××gý}q3…+k‡+¡.`S_ÏMy7ñ!aHÒš»Þ¸›ÙÕpKXW©æ€½œËûÜ|c!À·?'9üÎò|š%ã¢	W™g	XW’nôÓÉ,Öù
x[´=v‘v †‰À'íL8šaÅ—[Y¤	\x¢¸—®>ÙÝYäf“<ïŠ7Ý=š¾ÇÒÄŽ ‚ÿµÎ™^[çÑ¸k¨ÍHË”ù8¯â÷#yt³
€ª·¥æ|µ–¨ì(ná–dóM ²cö&
=‚R“ñ;@0ÙïýÑR•±¤ëgï)’’±(fi‚às‡‡îJ±œ +
.©¤V`­Bð÷áŸu°ùçÂ»Ÿ€ïûô~Dæ÷°î½R`G.0öÙÜqØ`º‹¦„1ðÅRmF~*4`„(d']Ø™FÅQ–ÇGÌQzƒ>?99ì÷Žíö³¨@Ãj¿ã1…µyßŸ÷_V¿ž*”L€:A¬P„™e€LŒ²%pç7X„\Á>Þ4ÀÓˆRºâµº)RuY$c,±44]šª|€-)Ëüð/P´.(¹{0Ñsv")~È³t²Ÿeyx*K@p89>ü	¥Ú]u±$Æ3ÛÏnµ,1!ñ‹îF ÿ=[¢J¢ T:è™RgLøˆ”§XžÃ›†iDG	ÒkÒ&ôŽTYÂa4U¸ËÔ†rrŸ»<Cã'¤>·áÛAHäPOð¿.H	)¯Á­,À©ŸÅï’øæS­Xãí¹w¦XÎÑ€j©k•cô®LR0'ëÊ‘9M•¢<álC!H&! $ Ž$ÇsÄ÷00ô#TL“ÉtF>òÐp.°±w\üÕ¾ùè÷#¤utÅßO-¡C•pYêŒ*úU:Üïk©È°}µ)O\“Cí¿'Ž0¦¸¬‚–-çÑ,[RmbŸçI!‹ô®"Á½ÑÚœñ€¿±¸YˆbnîQð¸t±¢y4Ûàðæ W¨½×6“Ç»äÐ)^Àý”Šo@<6J‰ÿüà¹§E~šÉ?$¿®ËCdäœAÄÛ­1RÐU¨Y¤Ÿ,kiŽé“‰£×ƒs±v7G6e	¯`TG‚žOAn9=°¨jÔ½L­<aœð\
2ø©–!um‘µoÄÕÀº='¡ ®G¾%%¦¸Þz’
S®ÓÛ"ÉÈ§œ-Ë‚Kë¯ß‹%p"¹˜%óí_âŸ·º;ïY3ÃÛ
! Ã‰q6Z"í G"x´	ÿ/o>ÙRå!ùÇ3ú'±½Ýýó?I?Y2¤Ñ3»Œ%s„¯ÅöÖûËæ!ˆ'HjnT	YÜAè"¹OÇÙšê=Çðn–»ß¸c´1ãPâ¯P~Y‹9µbÜ%à	õØñ¾[Ë¡]ø—1D­—ÞØqÔa#OÛ¢íic§ãxÆ%7\<og‘j·ä‰ên^%1	ŽÒ£Ù/°v7/Ç àOòh1MF½å˜@|•n2„ÖîCmøOÅãþ€:OÑ]­UkKµÈž³ìZLfÙxJÙ³6uá?Jt×/§pú'ùY<!‰´ÿ’YÊLÌîç²ÀØMIŒAK6Ö˜ˆ/°Ã1—S'JÜì–ôQléà†@ÏÍcxÔ¬™?€I/¿Äèï|0M®Êõæü
ä„0œÚ„>Ž!3˜B„WŒÉåÔNÖáÞbcÜ3œãÚ¦ÊÂH9Psv›-‰“dŸquË†änñžxç°49a4ŸKÀÉÚÜBœ!{°(ª¤²áºÞ	‡½ÎLoø›x|Œtfv† »ö.Nc8°)ZŽÈŸjK^÷ë®ìÔ%ÊÊ6¤&ÅµQâþ¹ûDlˆî_Äõds¾CX…]  äfk0ëÐØ½Þá.)§ý½ƒ{b Mûâäôüà¨w(Î{g/ûçâûÞáë¾9h7å!‹ÖQI¤º³ÝÝ’S¥ÇÏ`·Ä|žÍ6áÿùñ«ao{„Ü~o^Møéàù)>ëîpëC~Ú[dÏÛq|rŽ(™¶QbM¼)òq˜›2j§æ´(¡‘Ì\Ew¾Iÿ…Ê5J†#ùt.¼´NŽˆH¾œ³Å…q÷ê­(¦”*HnGÇ¥@—aº”kn­¦‘è¤Ë)0JÓlTDÓbŸƒ¼{ûªLþ·ŠÑåAv·òqu¸Ÿ><€A•a¶TBø	ƒnGôÑš
—­#Ž’ê–öcÔÐ‚xk{ÖÃçQKJì„D]r}*þ²Õßlmüù/JM:Ô:ÂÈ72ÍÄ$Z7ÿNÐFoJ%ÇdÏÇ@¤ò©½ž5V¼³vfÂ<./™c½Ü ?Á®Qg$”°®5È¶dnïpŒ·ŠÕa¨cŠè²V—]YkP¬<žœK3¬™XœbÒˆ7	P¸×ƒåpCþ--Å¿ÙnãË^)Îàþ5.ªœƒtlÊoQ*©íŠ%eÙYÓxUûÛºÜŠ4<Ðž¦Å;rùB[¹„?PS‰(‘Óbiœ’CóÐ<rB6F ŠÀ|·ðòDìlí|-^.1"Í%½Þ~O(‰’X=àšÖQÞ;A£€D”¸)ä¸¦bùñÆ×Â€-ˆõ×R;šfìÎì4.(½„ÀtFYž“DÀÎ*Ø:Ÿ|BugL.\?\Ž!]oø°²öF§Sàa€ô^;~(Dˆ‚Ø-Ê"ä	FR5 zuPû4ŽÇhÎü=HÀÚ{Å¤l’º	kÇÐùEÂ¦±ê×S€ûyAK›ü
¤{¹‹ÌÔ£÷aã¤ñIL¼ó&Ð›^V>TZÞ”ðEÜ^B²*£Î¹!?’ž)‹mE»çnÅ5Ã
Ö¡xÔ+*ŠªÉŠ­[ti,íþ®ÈÏ^K•h­›Í
L‰À5aW¬­ÍéÐx>A@½'#,ü«Š0ÍtW‚t•ÝDZ&xÞ¾ö4da>øt¥8ÝO5Œ¬Mzb(óªã›'ySÉ˜1Œ”@Z52^*Ü‡15è¹¶1¼Ý Xº3Æ$t“Pè ì¥.6>$îÊ^tÖT=RÂ»Ø¨ìAJÿ™¯]µù‡LB$J 0Ž=»[— PÿgÐ“¯-&ì³gÂÚÚk,7ŸSª=tù8~ˆÏGŒÇ­æ2ûÃ,g%Œ‘Wš¯â2¹â…t8§QÏ‚b9LÊ:Pë«d2ÅkyeºŠÃì¦Ê—žÊÞ%*îõy2¯ò‡ìÝ’wÈØÊ%>s@AÓ"¸(´ÄŸ“±f]¢ß7Ÿ(úaa7¢¤~DKùñíï#½Gº9‚hh¼œ=xp‹Ó<_Œ}Ò4ÖÄxV‰!>2+£	:†û{3I+@µmš=éWµ¯,nûhHÅßälÞÄñuÒ2NŠÜÿ‹Må×œrÖË¨HÈó.Jf›³¸Dí¢Ä¨ì‰â:^°<÷òëìàé¥×…q:g1«­÷d•Á`Wìeó!JZ;"ÙöŽÖ^JlE.ò$’ù¶c.àDË#ƒã€tI:(3¢	ýþLåd¼!¿1'1´ñ”HÁ£ÿàÔÈ²®Oc¢K3KÎ5¡ƒ£e×WÊ±&
WJ\Ì'²ä÷ë2TZ7QE¤Ì1âá&ŽÁG.B ÎÌ¿¨Ä©‹ƒ?jÀ—”½ëy*‘uëe´ø	Zùbsl³yÂ\0ê©²M)ÜÛŽ³9É&¯gelA<Œ‘Ž“¬–½PÄ¥˜fyy‰Ž„tVY:áòbŠÖ?‹q‹†0²réDë¯Oõ›ßŸÞ}
= "0¼Õªx”‹XKª?v‹Z›2±*yOùe®MyÇÀz =¹b)§ÎaL.c¸(TÔ˜ëŸÇi|µ¶][;""Šæ%{g!I’äÄu“ oø`ÿáÖËW4M„*Ùš]†ðèVÊTC—r)_ÄáQ4¦S!AÈúáâ‰Éä¿ëS¢ ZI—FVwßÇÎAÄë§™% ­ÂÆ÷¢aN&µÆÁ –¤çHHësRœ!¤±ZÆUbsUðc/#¨³ä_ò#Ô4âÚ,]Èô_J´¦bâd"n
³Òpc…G²üg0Ã×ùZµS6§õ	h¾˜vG`ÝVq½2äÜ´³Òucçêƒú\Ý ÷žò]šh4©;(:ÆÜ‰óÃ«ÁmÆ”öCÈá¼‰;@Ns396jÔy®lúÆL¿Zã#Ê¶ò°þÍré»•ŸQú$µ‚•-‡€–Óèþv@AÑˆR£mµó³ÕÁ€cd¤×ªéKÝÔÒÅW¥æ¢èÉ‹j<¥
¥d2’pØ%ÜÌj°#k-üpGUã¶û¶SÖ©-è? ¦ÏwÄNw{Wp’1½ nŽ) Ý5òèd©¿³Š¼+~@Ä,Ãlð!ª?K}ïP”‡M•xQèTc¼ªíK|ºÝAníR6í(gçËq˜¥Í†-JÚ ƒa.K•ì9¶,õZRôõxO…‹LšöˆMÊHç¾·æzíÌ*Ô€ûoZ¡›Ð¯§T—t¬ÌRøÚ¿Òµi}ùAygöìMF·,UàIv§êW¿+ß\|KµýÓ¦ Ý®.[Í~oç0ÑØ
îÚ1‰¶.9êm	"q•2ª&¿L¿˜Ý`pî,~Ž*k°úÖÂ¶2ùrV&{&¯ÂO5æç´¹²ÚM‰ >¬Ijmä¢Û…µX?»8î3ÕÍ3§å.'õ: GÏ©.¶Š† A`Ýtb¤{ø‹6 q¶h«ÒÜ‡ë0ºómÜÌ˜4Š§_~ ¾¸ØºgžÁã;òi×/ñ°<WÌÈí¡ëÝ¸šE˜úJ7’¿å[#ký^?‘-Šëd¡_â…~Ek‡wôß»•à«Nïj[)pá )å¦h“=¾*‘'8ã?1á æ[£oû-GUÍå2dREòž"ûƒÛ{žõí¸‹`÷:Uù|LÙoxwùk®•É|%ðàsÀþEM'‚%ª!¢Ñ3—€|'ç—xXÈ‡­F.êŸŸß2`)&‹ÆÛ9+ae| ßmdÉégè
º8¼	Pµ,Î.³ÛÔBë·LIù¡ƒö•
#`ËÏ[ì¿y×óÂâÞTê
ænMv/ë`tˆÊ+/N_ÿ¬¶ô¿ˆY©6Å{!f,ò¡ú¡&úæ"`87—q—ïbµÍ¼
Ù»t:¥±krzúÜyÐçÊ„*–ÎÜt·õñ¨Äu8Žˆe¨ ^†R7æ÷_K8¬tú<?NÆ2S:a™ÛÀà<Ò	ä€l‰ZÊ»Þ¾o–ZpT€`¨~îæ£ýÈéÊd«Ù"N1¥wüÌNÄÇVÓ';àZ³8“ evf¤ô-Å©¶³’Ë2\û#òËsÒ-–Cö­ÄB–Û[[í»n·ÛX1q™h§ÕdA¹Ùoyšˆne¦fêÛž¢-—5T8©«3Î>@~^k·Xšû†e5†r,‚y¹cÝ	$ÅJƒcÓ“þB/«móÝRE ¹ú†¥I@aÌ,†êoù‰pðóÆ·V‹y6ºÞW‰¹œÔºTÝËÉ½)?¶ô÷é.Dpo”žà‘P{lDÀBô
LÄDÊAê°ûèG<þŒòÊ Ô®L¦ Òººfa¹Aë´Eœ3ˆUf(Mv”ÆŽµÒ¸¢ƒM¥K!	v˜s‰,L¨¥cASF\Ý*Ã¹r’ß@Wéì ,è8qŽbÊ–%ÆÿP¸m„ž:€™0e™\•IÒb"
ò”Ø}´!CSw…viÀ%0à Çkƒe/”Æ%l•×ƒ2¨déFÑßy<SÒ©Zî8Š\õBúx ¿1NJ/wº<ˆÊuÅ+bŠó $0Ò#¡c›ä¥ýMj‰œý×qpŒ¹h8yÊ»vwPéìvÅ'xHtl÷ˆNpåzÂR;ÑÚÞØ¡œ79Eä'„ÉCÞkË±½•rÛÒØjšvE¿¸+´£ CŽòÃ¢x
+w”½s8÷„Zqd‹ò2hJí°ÌwÛ\È¢'Þ+¼ö3É&ŠrsÎx™Hs½YF×ñÅ
±xÕªì1Ñ_	2½†\¢Në©îÓ¦ÖÜkî…gD$¥ãB^åf]µ? ûJõÃ{†æŸ3¥ù§H.xp0_€@†1%gd¬ïò6ZáÀ!*ÄBYÓ¥…ÀÒÎ0¬[§,°«óÅ›¦1Ã5Å/˜dNÚÞš¿®®ÿ·9I:ÇêqÈK¯O„v> ÄßûqÉÌ–	‘WoIk§ü¶¨Rá»ÖÂ)AÆ¨ðÖp‰Š¬"E•ž)AÁ^sŠ©Ëá1×=V•P¥5¬Ñ:ÚÂaì^Bé:j¬Ø„ªò®a)ÿB¯å_£ZIŒÌà§ Ä?Õ™5u&=VrfTªàfÞ×õLp±ó$åªçW³,Ë[ºQ»#071ðsO¬ª£«œ#¯ûRÂBCÙÛ¯ÀVÌ8/…
¥c²€³¢˜a‚lz‡×`‰PÏýh>;#É†”†æ ñö›”wWåW”*l4ÔÙdpp·Ì©¢«¤)¼¢%Ä¹ÉxpœüË8zYùkÃ2—ˆh.%Š“ÄDu¶O=¥nÇ$8VYÁá¿El›)7xM ²* p»´ÕÈAÜZÎ€Zwöˆî/†]Í“÷¼Öå‚²º‘Q®1ÂDoÐ\ug|‰æìÂœéÏqž]bÄÈ¥Ú%«1.]qšzN°[ÃdØ–C³pÿ˜]ºµ=1±H€ô²V¿•öC2\ø°« ÇbÜüdo*BÔÊb†&ñI³Œãt.òõRìüB9úW+
žSöê ¤æ1–9À¤Ëð7)(W2™R<<ÆÑ§%ýIUä093{	Ž5GlàJù…Z¹X,ïE“¬ce‰*(K<9ƒ;‚¡%3ÀÙ˜ß¹â·Š÷PŠA _vP¿2Þ¨ ~x­(10<A½MnnÀË),eÆÈ½ñ&£÷B½Dÿå1]¨rz¸Ñ˜9#7ã¶µµ’˜S?'!GuURAYyó´+–hR‡Ñ;Þ½ÃÁ‰î¸‰Ø,‰ðÒï½å%ª‚^;Ò‹{ã3lÂm^³‡'ý
 ¢qB¶5µŸŽ"{Çñ«K:ÑKó’\.‹S‚òÁ½?¦q£(GÃe¬ã°LD­ã¿G$`G$j‘Þ>L£“-#¤Q	ÒÉãè½Þ?8ßØ#v‡w‘Ú°£ãæöNS%¥“Ë¬¬kŠ×“p8M“ú&ÿI†È0wÛC1ä Ô¤¦¦¿t3âQ6šz(æó>—\íõ²ˆ‘³WË?'Î©c‚²8A’qdÑ¬³ä@ä€HŸcøW=k2K>ŒU~AØ#ºÊ°UÇýïûg*;–ÄÖTÌŠhŠBÔ”ßé•À^›”ß^â`òê bgiÙ\{“¯Å3Dœáƒú
M5~€i+ŠÃço'q>öž¶ÃyH_dy•
)ld2Ø*jx¨Ñ"ËMg"„¨¢Q‚’äÕlùb…LLhùD;¸çL†Ø7HRZ7lLm	Ã)nÇG/Y‰ã¡Uy«öƒñŠð0`§Û“1zÕ„œŠÌó77ÓƒÂc¹š­¦õj0hcfUûÂ›}Ð@>0[#šÿÏÿ=Á kÂBKú·ovÝÊúó”¯Z0ß[Î'õe	NºâÝÁ 9*«¾I¨…Õž%6V¨PÏÜÈâŠxvu©ÀåÒax|b±Ì
/7€¯ª@Æj"h8wå¾E=¦èÈ‚zß’ŠfÆ9 ³IºªW)—>ytÙ‘UI‰šr„,«#¸î\X'W`®g™/Ã5×µëj.dÚø€HidÖ˜sÃë!§ìø~®[˜”¬áC«L4Ä£õw0S™÷4Â üŠ«É—ÖÐ›¹Ë”l¶…1¡Ûw¹zpµx~Öò­1"0ÖK ó9ÈÃÙb
8ŒwFýøÃ½ìŸíoðˆ=¾Š˜X†°	l¬D(øÔ5â\¾Z¤g®“õžzëeÛÍ+ª,ŽnY<1¼¯å–d5$VÛ[ §Å¤ã €Ù¯dšíÏßŠä h°l+¶áåGÛdo,¢UPÎ9 ¬£Q¤´ sh­w°5Ð”nÚú"ƒÍ£ã¦¼¦p“È¤/9q*¬¢Ü¼ŠoÄ¶‹§ v¥õ¬	C<Æ2Ô¸~R8LrÖÄŠÖ4ŽÞÝjàê°˜û¶‰
Ô½ªÑ áI#±¡)FÙbÚ_A³Ya-›êšU×I4Ã…jsÚŠKy ÒÏ¥¾¼+o»¹âœ8ye6ápIl¬;GíÝÁçœÉâä¸0IšÛšÛÈUå÷¢ÐŠÕtÖÍ¸ü ¢§„Q97ÉÖÌ¾DSþ¥½ÚO2(‚dvBç""Ž“èümø?¸0Âs° äõ{»ÝRšs©^àWDÞÚâ?þýØçØÊå>-(Åæ-‹•@Q˜
å{¯ÏÎúÇçÈ®õ¹¨‰Žëo–ŽjC€(všý”ãÈ›ö67ÿy?òÀy]Ä&‘°ÌÇlúÖé˜ßõ¬¼¸— ^3VØ¿õ,+¯:”F»ŽÉ´ñ:–WÉàJÐŽFJö#`â#
 Íµ¹AÌþÜè¡h˜Tû]JíÅŸ(U-ºµ3&—ùÒª¢1»JZ™f	£y¦!²KRVn[c…_²ºj1ÍÊL²8¬.°Õ1Óez£dIZg–”/ŽÑ	¶j ÍØÑÞ)¡=á¦-T…‰†Ò qŒ³0ä õ~–ÎL§CHùiP“± …L6•“®œ.'¹»ªvvDFbÙt]Lš&Ûž´h‘ýNÖ¬ÑÏ¤kl%¿¾Êl2é‘"&Kež`œ³L¬O’¾CGMß¥ÉÉÜ9}0‡Z Y”¡œmŽÛñýqãIÕ
ˆ,àüsX:ó=C_ÊÂÞW^Õkê¥wÄuBYœ“uiFoëñ‰æ¸èBDhNËTŽœØ=BrÌ³r[Ö­~Z°ÚCã4Ã$S¶Qe«—å$.4¼«€€K5.YÏjé“åò/ÙPÛ0]^na
H!`‰<³ñ¥•r=`ÒÑ¼êVž!°§Mµ‡@=(ã¢ÌN½AÅóHëY*ÜÛgí¿ƒV­Û*Ÿ“%#¿Ì1ÖÉFL³h¸ÉXUÖ-5ƒôJ’…
|N,³ÔÉŠ–~´#˜„¸G$K]e7[A Æ7Ž¥1F"±¢CÞŸ'%0…Ë`v~Sš'QU¥¡<è…RC^É¸UZ(úŽÛ³ÕùóUö1™ALÕM7Y>–J!b–èv3m*¦X²ËÕñ(ÉßÔV(ëCóì ˜ˆé~—äÖI•gûULA­î£¹tÛNþ/¼uØ=µ‘µ%]
“!XçÁƒçó¬yñF¦!f@Êß:›¹m'6f£S¸q…Ÿ¾¯w²ýÞÓÆ.4QmZqÓ>‚ÊµÃ\ž5Sâ›]ò–cl1€ŠiRÅ{Ö.µTzM•”©‘Jzºˆ–”<MwN‡nõw`††®ÊZéÆnôr”¤\êcº0„à61©….‚÷GçÚ‘WŒL&íÆ#µ­Œ´5ê$ƒ‰AÍŒ¾4‚6i ¬­?2x²®TÒÉÙz%Œœ²,7Ú§¨Ñb	
õé€Î¬vÊ•T ª+Ö¨sÜÿáÕaNÙ,åpó&žqv»¡².4éâ}\i•ALˆ*â˜‘)®“qÎâ1wX$£k‰èˆäX€þ†“!-!º@Uq	^(ƒ¥KhfX›E|_ÇÓ<ŠgqQš\FþC¶c½Y¢ÝÂ¯zCD7Í¤º…U"Ê
Äü
ÕmT–¤‰-¢bÚB‰ä‡1gŒÅ8íŸõŽQR³ñ9rd,„¸Š~«°‚Öæî§ÅÓ!i¢’Ü¾,ìd¶ƒÞQßÕ/qáIô|“ÁÌøpè$Ä Xæïm¡'·üž‚]ÍN&©¨…?¥–íˆsÄÀv%VâÛ‹¢(ƒUµK¿[—"<ˆø” å£äc£É IhÝLo7WÕ‘²PÚó¡¨°Fîó’¸zKwÌ¡9×æ­ä)ª8H3Ci<ÆZÕ¡Ìl
ÏãUºƒé
ËÀ³äÁlC«öoT=õïsr{„X6ûã
8µŒM‡Á^é¥*0·7sša,hG¾U›Zý×ªÃÌSÔ³šž™ uÏ3ÌÏz¯)‚0$n›j‰g#àÅÄ£`Å^@ß$‘±Ñ*1àÒÒ¬·¾ÔpÜÿÛ¹”€J/x£ë¥ñÂý¿õöÎAˆ×²†ösò…Ð ƒàÇ¹v;FÃÖae>«F±&ŒÚb»ÉcX"4H"==ëpòz ƒÃäÏ`@Qæ2j­%Õ¥ÐŽƒå‚øˆOÕµÑ˜Õ¶”}Æ.´Ö"åH$Â±VäÑÝ£GèâTƒÍàÕ£/?„Jk®[Sócªi^´Û]´§´zÛw5.ik{=À—k<«8öƒ®‡rö>;P}ËõÒ½{‘'\¶Æsó^h+é)•Ò[çRä$¥î}oª )]ª´¬JU¤	HéêÚNRZv#ÿGÕ§ÃÑY˜ÀOºr™
Yéz¶¨›ÑeÚ;9ë‹óÞà;†›míW„»ü1pm°»¼«RÕ3ÊÈI¡HLN$¹”ÄŸ›¥•§e£Æ<Cõ2æ¦@“á(^J«¸˜Y›ª}Ä1æ´†QyUæèž
ý6z3‰áã7\83L·Õ;<o£CöN×¸Ø¡ë¬ð5¹„´TBñö®x€ë–ë¶åûhI¬B•C-÷Z²/Nÿ­G»ÂvÏâªÀÖŠÈ·‚a;Pl³¡\¸ÐÅ–\¸ðJtc¹!%eÀGªûèkô|Q\ £,ÖôŽ1œý3 u¦+4Kš¸ÂŸƒ”ÅDcFh0cÇ?7Ý¼_!–•:«ÏW–ŸÌ¾|d" ÙÄ¤®	²žtâ’{·ËÖdT"ë[öi*ô¼A1{ìyMéNÝ,Ù10Ò¯õBöð6gï¢7Gdý]2NaÁÓÛ1û5IZ)£!úuÁ‹ÉìvÏ“>?D‡lLiË„
×À®È’cXòÍƒ©Så%zGeV€•á¹««.1óË<[òÂ°–”1I&(M¡ÓÌ§ir²¿_Ê®×|‘¡³pörtín›ø<ÇdvlD6øŠw}ƒ÷ÖIFÄ5¦\:½äJªÙm÷Î`;Æâë9ý—œT^]+VªIà’~ êI)bÁ9ÂŒìXW“%aóy4Ž•œh+Æj,š¬º÷²o~wþâ‚çøâ¤Ös$T?ÎûGâ¬ÙwöÎNŽy¦ÁÅ>;ÊÅÍŠ‚Zê8$ÖØò(,kŠVŸ[lÙ’Ê›à[OëNî ŸÈþì„üâ-·úOb$”¥œpBæv îò"-Ì'+vv…D6Å·%UFÅu±‹¼Ã
SC…€ê?–q€•¥Ÿéá%ŽúYºoÍŒÀW¶á";ŒdIÍ±è 6éaºŽ}ÊLw3Ü'Õ6iÌãëŠnS¨áT2°yœ'gáÕó•‹­ÁŽ°j¹E…ÑÏ $`Š}rË%Lä×€Ü>	‰¢œñ¨šf=õÎG¹m(œ%j£ƒ5E9²$ü¦¹ŸDC—âz0	€ë%@.ÜGHö.?ÂÏ’fÙKá|"³"<—>—QYÞ
:9ü¹7Í±ˆ/=š Ë
‹½Þyÿ%ð-¢7¼<>B¥ØÙëÃ>#vô|ýQÙQ,†$á“gËÛÑ°Ð4^¦IŠ6/`:Š’ÎMMÑ—x‹«UgT\Ù.òî8¯Ï[0õT;µ]’9Ôž˜:-£KÅ~WvM×ÖŽJ…1îä®Å‘¡áÝ”u{^üëë¾x~prÔ;û®Æ%ÚÐ¼/á–8¤>	s™P4,ZÛ1žÂ ¯šè7OjR‡5Åc‹‘Å9J;©ÞxøI‰¯P!ûøS¹–£@@’?…“ÒSS&©j;[`ž+Èf±Îí
~”ü‘	éeûï˜U3‘ÍëYuY¤øm7¢÷JÚ{Œš}c’GãÊrt ¯]
Ùœa¢ýÉ† Ü^QÓN\‚"za\iÔèdAôu¢
ª^—©h‰ÆÑ-Œ–f‘FP¶ëXçËêCŠ¥sï&î ìÉZÖ¡³	J'žµSÚŒ¥\öN•=$®xlÑ3É‚UNÆ¿ìúKË·sÕÝÀè³×©¿D£^Ø}DáiT±ÊRâúõM#D÷Ê‰¯–(™ï”Êk%exÓpp<®¿ŠãÆ‚~áWÎ½Ž6¯3I	×œ½EQHHöˆÏutg¤f%_`©º¶J]Óu<8	øq®ä¾=Ã¹·­}âÕ±¸eö.–VÍ±Z"L¤ŸŠK‰ðj«Eà~ïMîØ×¸\ØŽ¾$|'¹v$¬øõ)9¢H±ë¸”8¨ÑCdhä\)¤ºâ×<™-Gc&@Ñ¤‚†ûæ¢À²ÌŽE¬mò6¿;æ-¯L§š%Yaký×Zlš]Ä Æœ÷ÎÎûìéôPTqw"¢¤Føaµ…¡-z~˜’‚Ë!	ÊÏDÙ‹)£è)%ÀìÖÌ©²ð”9k ®åå‰xÞÛûNlâj@TÚ½)¯Ÿœ–dhþIBÅ6.Žüú¨ ŒC õ~[sEû'ÊÀ/¤Ý9kØ,è¶<æh|eIÌ¢ª,Zs«—™x³hP"*:¼Ê££è!8—&c.C¯DÇ¤°¤FÇ{ÊÚE‡>Q||øø!ùNŒJg1Ê2„@è—qÇë‰€wYµ(wù¶*ÿéý'îØHæN#›’B¼]ún;à&Ý^µ‚Ü•iR®»@Zóû¸L…ÙNÓ°˜ÐøÌ2±"þ~¶’Ò#ÈÄ;ÊEyB4ÁÄþ÷²¼×/{/é: šä »P²©kÏîf³˜¿P®íXñó^£³²mÎŽàÆ¨Rr= X)á9ˆU]Wbg¯¯×ñ(×AÛ’V0÷²ñÃ[i›¢2À$Ì5d^¶#QNÊx¥òuÁM)Á û9K¿UyU4GYŽ’.1Fv\ÝÒíºJÐEÕh˜™õ°œè|N>æï²Ù»ØEºÖ
Û¤ÿß˜9'ÌË>|l¨I™ÁëL×–%>u€¦TŒê‰ô™ +¬\Ptû»Â`™ÄÅr„Î]˜¯IÇÝ£[‹£ØÁÒ -´`'ódÉ3òÖPÚ6X4ùtUtFÚ«»¶˜y_Í Ÿº9¤^Š–Ò·Þ­™†¥m¤àuWWTI	ê¢:?,ý±ÁEj0dùã<Bg0ÉÁJoFCù_ør»Ò:PÁ‰Vd§`fD+pÒ8}èÔ”b¤Î¤O Â+,â˜
T¡?4\‘;'†=qEq‡´4þ0Á>Êc³§C¾'¦›ö©¹ÇÞž
9ø"µ6¯™‹ãW™ƒÏšm¶‰_ÔŸ„†û ˜^«­fR$Úlnê¤¨ÅË®>Qu&õf\@Û»ÙÐñÕ§_'ý¸šM.N”åpmta
ƒÃX¿ë‘c3Üz‚v,]ÖíøsH‰fAÏºÇª‘¦ÅS2s4Üq4‡ã;yÉ7æÒU.œ•IR¸3îý¤ë…
_³õ´FíH6F
ÁÒ»þcïèÐ2lHÐ–\©N]4Î³"¹®8É'QªÕïZÎÔ×FºžØ¾bŠ;É“¢âtFñX¹Içª
¢jPFäU¢¤’6wØf“Üjb›·R&ÚÌdžP"Õ¥p8&»pŽâ™`u[@d;[;ßllÁÿm»"'ð¼®Ì)yU³Ö¾É–.-ìÔÉ¢Ö‡aQô·4‘}ÖÀÖš›B%ÄŸˆ8°jhÖÐÛ¶¶,Z]¹F-pDQËÙ±Ï"‹î4 Ñ²˜2@Gïî•E•ü‰mñW’³€¥…M–sÊ7	ýS£wÉóSåÍNfô}ªèùu íºòo?9Ñ‹1Cv‹—ñ™iß\ØÕºÖÚØ~â<EcpknŠ‚Ì»¤T…ÏçÝ’\–éO,­p¬_Ø±É˜	¶ét)Î?çèƒ¶Îª»—HBì’0ø›NÀïµåÜKum½Æl«Æ­XÃ„í4âR>ãïÐæ©ÔíEº&s9r»Sßdè›Ðij»{dæÛž÷£Ñ´uí×k‘sÞ¯`®rô7×þÒTC,ÇøÔ’—±é _:‡´xæ½Ý¥Î»ºnµO‚“§ÜLÁÌuµq¨²ýM èNš¶ËÆ+JºC<¬û,Ô-gÌS}Ê_ØV&|’¤1Øê›j-]=ÊE°’Sãªñ1ž.ëMíçˆÂ+UÚ3zÑ¢Ñ\NSéÛý¤üþÍë.–Å´’‹žâë¯+åÑPÑì=“©¤à?¡Ú‚•Ìiíšã®Ôz§=ðŸJò€Ð€<$§™›ø<;\TðÉÞXµ²Gösý35+ïÍç2 ÁEVD3•×¹qœqà¸I´±M02&Gå€[ÄA¥DŽ(vÁ Èh2)è¿v[·i;THgÀg»w1]«"u½4¬"½Tkâ5~#öåiV*gØó¨Ü˜šýDlj}ÖewÎšCrö³¾Ç§ën{õPTwNbì®cÅ**»îudg¼÷(¦reÍBaÁ‰ä#8ýL5WŽO=ÓÆ]ŽyîÐø{ýª0lø×Î$þ1‰Á»‚½ãŽO_Sæž8=;ùþ`¿¿/ÎOÄ'¯•³÷käˆåFr÷Ñ—HÎ-ôL¸Š²íû0€hd‚¹™sï?Ä×q9Åx:,©é´ÐÏ±Ñ¼ê†é4®¼Çø¾Ä¤v^sëÍ£»WÝ;m€¦®è)gs.øõ‚sM
Ÿ$E3¥
0ÅÄyá	àyÐ‡mªyg»â0"Ge£Þ!n`æ\œ¾-RçÚ¶¨4’þíÐØ™uÆüº~L4rÈq½ú¤Ëéõ	ö
}n?ÌÿfTÀ¥ÅÒAh–¾áôGžµÒ;\{*òg^róChèßCN÷ë EÇƒó³×–—(…= '7æ¡ÆÃ]7l²£Pâkþ~zë§Fÿé-Æ 8«KÌ‘2ç¼ªw«~z«ï÷+¾Þ?½•Ú+åxBÉsdjsƒ0b35£ºÄ„è¤…NQðŸÞº5aéØ7àÅ’‚Rh¥{&~aWÿˆe•ÝÐ1	©Üú:Ù{©ò¶+cDu]q"³çÍÈ&ÈvÈÔ¨U¹…ñ¾¼<5ðà¤ü­>&ù&ÞÊäÝÞ…‘k²„Ã
”°ÊðJù	LâðŽ.žºÁe8…ø&åw«¸º±2…øî>@Œ_É/š›E|SU‘G(fWÃˆ’jW«à¸FBÅ4¹Â¸ŸJuò`Íñ.ô*qæÒ%_Ÿ|Ly	èŽÂô¤j¾¢ˆ”~uì«¤²èÊuµ&V••`“D8{c`%[·s %©§xìž«ïˆ k«ìÖTvh|BisH²tGCæ€©Ô_ð2	(3Á¾­-ýàL–*¤ ‹8/à]‚ÙtªñWVFá§ô$ó ’”7ë«.X	4œìQE$~\-þÀbÙÖ¼ÜšrNtd¨CPC>Ä
;YØƒx…ÛÝÚØpˆ6)ÿYÉJØ`9l»]©H »´òè:˜–òÜÐmYÝµ]Ä@™á’”nž)AS–^®: ²RˆŽ21ÕC÷$;&_3P]y„ôØ§+ßù)ý)=ÑœÐ §\Rön
£%á"ßà“êBŒ—„ÛßhtÜ—8Jl^i€˜é¢+Þx¦F]¯Y×*žrw"Å8õ ú¹ÀÔQzMÞ
Wœ´HlÜ%—aíIÅÖŠ*ZÄª–ÑUx¥7v¥­GçÐ®ãÓ)y‹cæÝjÞ•-­‹wl]WX &ëÕÃ­SpßŽ1Ê6ûõð†zûèÒhƒÒ¥7à–éÂq)W\„O©;orÏxU>RM~å•úujÄÖË•jûj’^ hH*Þ(L)ÿþ 2›Èç‹LÏ/ìkdx1•šG~£7¯¤¾¸wø(²!ª«ló/O+×M²}h§ëúÀ(WÂ”Ò¯WòÃÃƒ
K… ‹—¼Šg³ìq#“%„4	¿’[õiÆî6l•W•!@øÑùŒãl eLgÿÒoQô"Ã3G˜’Ç mÚ5ÑAÚ‰ŒGZôw•Á.e‹PØ‘Ò8V+U˜BS7«\Œq!sõê®E€3…@}{‚^¥ûÏŽ¸Ör!‚êÌ†Ü¿†¯nä©OôeM³ Ëb}ÅùÍê¾µq9|ô¤ûçJÎÜ˜Ï³Ùæa`p‡/Ù¥„;_SNÔ¢ÒÜeE õÖöüßÎÖÎ×ÕåûØšo?©m®KF!–A'Ì;8ü—”B‰sïRºH¿‰ÂþùW÷ÃàShòÄ8a²£k´ÛO(&E«eÁ÷ŒMäÅråÏehûÎÉ‘n’¼“â¢Ç¿¨s}&æqº•)ÕàÛñ2ìf‡9Šƒ#X;ºU2»2ñcö;rU0ø@º]	 'ÁpÓáH¾Èø›7=&Ç¼ŠSØ§i‚·èÉ¤#R´²`‰\t¦+N·NÃ¡ƒÊBÎ™ÑI
Ý$¯…Y‡¯(ÛoI„!±vöW3ô`Oj-¶¶oÙ$bÖ‹hˆ|)‹¿“(çØÅ½]—ßríÖ/§0­Å!Ý‡EÊê­—.@Õû.Ù ‡ZëæílÕÞ¼‡ÝÊ¨5g‹BhE™vÊy#Õn´×jÌþ?b”GW­òB¤Ë2göÉ›"¼¿Îñ¶V^Àv”ëœ®ë­¹W²µŠ½h™»À9P•Â¾©HuÍK‹'Q]˜M¨Sa¿-˜ûVNZ™Ž¹i®=¿`§®0§15‘çŠœDB7ÀaÂŽeŽÚ• ö²
C1Gão°Ç©Ú.oì–æ}g]xî-²ç«€¸Ê½¯‚aMl¾YÃ6‹á=Äóx48=ÄÜ «Ë‚’Äòe÷0Åå¥âÂ(é³Œä#tITxMqr³d‘h• ˆç¢…ÓmÛœgâG^$cNä”iÅà­`¤ŒË&1Æ/0»Ôh†Kv]s¢œ1ôáþáÆžˆà¼âŽü =0eÆc<ÆÈFŽƒ&_Ž¢ÄsÕm-ŒJ„ËÖ€P×T3V`gco[Ó;èÉCOŒ²`¼”û×;-cŠBæ¤ùË
2•ý=J#™NÙ"# ‚¡\è±ê”]=Ñûj±‡´~›”øNŠ$­e§³°²`F”°svFtˆ3ÐKÚM¢@ðÑ£×ƒþÚÝ^öÑ¯³7¡’Ö¾MV¶6¹}šwèÎ&íj^{¶¬…?é[›÷•¶¶…>|¤ca›JÅ‰>Ø?è½<>œì‰Áë#øöGüÐ˜bFŒ5Tšuihô³ŸÓÁa:¼LÌ£¿s¥)² c,{Íw›¾Íæ9&Z;ÿQìœõ÷Î¾ï‹æ^ÃØüóƒ£þÉëóAÛdüP…Ö÷K_þÙ­.|ØwY2V©ÌÑ€‘IÜïáQz™´ŽÒucM]b/¨À<GÌ£÷É|9ïªš–‡N©§ÇIY8–|ÛëL´¶ŸPdÝkÛtp
jÞ×„J´«zµùëßúg'l)><ÄÁ1î,æ@ ÄxÙu6»ÂšØN•áòª>ã‡Îf`Í
÷êÊîséõkE…ƒðÙJ†´Ucs@dcdã—±¥RïÞ›éã¾8š•¥wÒâs¢¾<ã 5'*ŒR¿ m¿tòò¬wú
A÷ðGÑÛÿXG_c¾šCqÖ;~ÙØöEÜ@³$>Ð±RüHfj£‚ß«ÉÄDR©,9sï‘6\+5ØIŽ¶ýŽ´ãsÈ•Æœ“‰à<*d²IT¡3*:~Oâ•/"~ùâ¬#¿ÞÐØ•H°¤R‡fõ÷_ï‘;2ìÄ~ Wü”L±»âÊ²É¨µíÌ¶Û›
Jö¤¥CDYxÁ‚X•¬VƒÓþÞÁÀZdgG7áþßÎùðU?F×‚ûUn}À6CÞo%Í†šY³õR0}'ò•Ô•ªm1Q.ÒëŽ‹8Ã1åHSðt¾r¿ c¢¯(m§:âëø}={¯úG=ð/Q*Þö\ó™²NeWÒùØ"£ì‚íBCeQ•ªÚ[Uk¨š£í‘«¾Uªö¯·,ufƒ„5±!¾ÞaþßÊÉk „ÔÛ$Èì¯pŠ°x$µ¬­ðDÍ»RÍ›DªÊÚdé~Súq6Ä/ÀÇ—2:E7«¢iüq8¢žÅ0Øë@@ÀRàs–€¤.47Ž°ž/KëJ¼çô¶öÑÝ#£AöXÌ¿HÔ|e«S, 2æ¬‡ ò.eØSá*É@]ÄBJfíõ#±iãce°F…¯{ï+që ð>¥‚T>ºÐ¨þi ´aRý«ÍU©þY Z…O‚¾8Gž3Æ2Zzµ¨,#”øpƒ1/0ÖKRÑ©P'¤•ê¸OtÍÖ+£÷Jƒ*¤sbæ\By¢ÉüƒAˆ7WPþ3Öi ²`€³­Ò&=X^ùæ!òÊ)/>&Ç>vÿ:L®@ø¼%“ŒÔõ¡cÚ½Z=“‡—ŒÒB;ÔH9BÓw;C¹ò0òƒ¬I‡µ©T:n%LUf£lö©r—­´çš­OÄõ¾zþjZûÕhþ12Í'‰&ôòìäõñþºÒ	æž„­J?ý»:^ùøõ9J%@uÏ{g/ûçÑÚWIYÎ,¨jžQYU´wM¦p>QyŒ’/bÍj4#zBŽ¨Úè Ö`Hùý©6 vDÈ/ð±Þ/ ESÉ4âv[Èäl”©¬·÷ŠU‰P¥,|ëùî8i*¡ê»|o6Lè#Zje¦Zæbºº‰´ŒŸOe•cæ×°2ŒXÂÌ3ù¤Ñ6_èÈäžÉkc\ BÁÊXL"f\x•0HYfÀúÆŽäžØÄÉ9^ê¢É¯€
£Š†»•vlÌtCÒ†Ë~ñöéx¸íe	"æ
“ ß&s÷^PX}Õ{~p|­ªo±³ñX©1tÇÓh˜XÕÿÔy²µ%Ð7‰â‡o¡Íd‰sÿ†ˆsGê“8)!&$ âƒØB¢+Ô!oo‰Ó£&sÜG½säY’Tñ/ý=Éq«™¿Œ}l”Ùm¨*›â)E0/5yu(Näb±?š%õÛb$ÈñJ#` £ÉDêÁ
¸¹øµU¡@Ý%|b@wûÏO¶¬˜]—&<þ<S…#²–™Äp¥QÂÎ0Ï˜€©ä^ˆ¸)ƒ0ŸG4Bqûz–EcÔ4ÀˆM¸e2ãÎ®ÄÎc’\€¨ ‘7”¹!q€·€m{þ“Êä™[mFÚr¥°BD å¹©†‡I’ +ñÏH­Ø_€åz’„ŸÜ)îì¬˜¢ÑÿK‚—X_76RâŒ%EÂ¼ 4½ B:Fë€bh€kšÄ•-ÍðŠ+§™ù=Y1=ì ¤EDB’ ê-œi"'C<¹ÆšL¿§ÀâÕTkÍÎÆéÞI?©Ÿæ€)ŒLPž•L–œJ×¼ï÷Í\X2–Î.¬½GÿTobCš¥?á?oh$§'lÈŽ;ÝÇ+v•\ ø Å°çãÕ`
AêD£a‘å}©ä-‹Åd‰Ù&Fy†¨<–Ç²ÖÖQôïÿ–=Ï¹7Ñ3¹¡jM_³áaÂNÑœåWþÕl™ŒÅ»l¶”	ÕÕ‹r@¾«*WøZ“EÊíÝ£ pˆõ=JúG_<Q™·OYA£$DFR”eGBvp_yâTþ=ò¡¬C˜ ±*ãõÂ~ˆf×âÏ-E¼˜ºùž_4–nc½¾“)àcl;5#I:Å 0¾ñ)±<A¬¡õ¬ÅtÔ÷d’7*Ro<•fïLòêö"–÷ÜÊ8E“¤l!ÞAÞØ~òO„à ¨ÖySÈŽxyC˜á 9ŠS–ø;1“„¨£B„“s™j)†‘5T^k}‰‚FøûìÚ.)SA<³¡é¸]ÓK€äN	3Ç	p~2¦^Ðžw²øŒ]CG@Y'äÊ®K°ë) c€wM†Rnÿ±‚t’<ß5«Zp?ÉHûzs•à	KMä“À…ˆ$ÈY_#-u×,v á%Ý·ç·õDOobÏíHÑ¤rŸ‘ÊHš_’‚;“ >2›äÝšÉÎöVx&Š‹$w•Ø'åp “	_¾ñ{,æElÝÙ\¡?©žË“šMé“w’ˆÆñ?–ÄÈÂ— úØ( iã,§aqéÂAßò¾ömjnŸß×á™îÇxMŠØ£ÙøTÑt‰´÷6ÐVi¶}xÓmõÏÐnkrwÂ“ q¦ì•“ˆ¨¢ ‚*	çl¿B	lH~T!LO£)ã¥GF	à0NˆŒ1G>Æõ÷“ˆ°½“²nêÜ™ï™"Ó¬ùRÄWû¤¡³™¼Z«Z	Y2Hhí»P³qGII>@À*@*0å½b3áêÌÙ<2ŽUEæ§iMÇ™[…>WT ,]*òlÉ–Š<K@ƒzbÈ²@"©ÉqÅ»E÷ÊôÕMíNm¬:•­êÅ,ï/¨JŠ¯¨œ°ô¶“DØ¥¾ÿÇöÎ?áa˜-õužÜ†‰Cƒ¿^ÇšÖbº€8âP_ãSýÀ8QpÛ×jÐOReþé!ªL™|HÕ)êXÜ8ÊGSR_Þ+Õå@Ú;Yu)©qœoäÊ{¹Àµ‘û
¹¨ WhÑ±#©†œ^Ñ)GU"kŒ–IÄhi©ÏO*G=7h§–Väüÿ×±â`¿|~ðâ ¿/Œ"s°®úR*êµ{h½óÕÁËW‡ðÿ¤œ99ì¿w~rŠc	ÖdŠ+Ò <ë³åútt¨R±GÞSï
yÇJ5Û	ú:E3LRNççýW´Á>¦ÜX‚Œ“/)N._³à(0Y‹Œø-FW"d…Ûñ	ÀƒcI>•uúLœú±Í¤kÙæË^fªœ
¸¶<Æäz_õ:FéˆÞ>üõÝþÁËÖ¯í÷Ï{ ŒûâùëÃÃ¾­ñ{¼ñµ©KYŒ =É”WÌÝ˜mG'€‘þÌÕEbˆÈŒr"uÈøx
‡ŽxÊ„ì@D¦YÉÁÜ­ÕøÊÒMXÃµhÑ¶Gât9Db‰^Ÿr>E^²UìÈ,µ»Ÿ¦ÝóÎj@û@F*Ö¦¡v'B…›Ñ”ªù@9ï¢ï5…´Â8=Ë“Ï³ÑšÈÍ3vúî/AHB>y ËKš'»Ñqé98ô¶u,È m.]½[")#FÄ*ož';ÑýÑS	ãÇ#™K©MºtžË!ñX3k¼D,KWfH¡E8ÙÒùø¼œMS’,¸ .ÎcËîÀCæû²\»››‚Ÿn:&Ýt6ï¦É´;ÉÞm>ÞþúOO¶ÿióó¤2Riˆ–¤ÈD¨ RQ}p]È°œÖ^6š±ŽÄsJRÂ¼¾$ncâ¸Ôƒ9]}•’P«6Š3:hNÒ.—«Htú {\Ý®?¬5S`ýp¯nõaüá ®y·{¼¾åÑ¾T¢ï€¹É’5§&âÂ:”—úVœ/jŒz\22:[jÏÂá- TmJU©÷Ö>UŽù0¶•Ä¶bGm¶Wê’4‹Tmö)»0“ÒéÉŸÿ‰uªdÂðöÖº‚+áßõŽœ×”pÄ*â–a”l‰:c4.Y’ËžÄ™£Ó™~ôY~ý—Çßøgù±Ü¹	.fù~>ýÌ€©„fè¢Æ1¬˜€xsSÊÖ8ÿÁÊßÂ1„Ì®ã
Ë$ìãTf"u¹ËGYÆPZZöHgf&3ËhÚxD¥¢qŠ
ã^Â‡—:>%š±xÃPÊäæhš5ÎylËA'Ç42îÎ&,M4…=­MüˆÔhIIv7‘²Œ},«ŒÈw¹Û«äÓÆšKúG+€><*²ñ`ÒÌþÿÇÞµ5·qdçwÿŠ1Ëñ µÀð")ë…,«@‘ %+CÄ„‰[0 $®Ã­<å5U©<å)¿!OyÎOñÈ_ÈùÎéëL¤ìµãÝDå*3Ý=§/çÚçR¶V‰Eu"Z?¦œ/e=ôÆÈ«Â7ÿ†ýŸÜÈaF;Í6
‰ïtª™¼ Êpéô]ï”J¢ÍZth³;ðJ‘xIßÏr¦¼ÿ`ê¾9«j×ë9ê€^a“õ=“ªLª†å*—hÛj“º†šók»’tÅƒÌèZµìäŒxFž{l´Û»ŒõÚU–*ÃnåXó…×();žDvI¸¶Ã{”çíó,%´·Â©ŒH‘·õf8ôv^&÷–M¦¯*t’‚ò±z35P8é*˜×uè%»­xºmMˆ®û±ÔÀš89-3{–N‡·§’ÇnæØ„‰¸wÌc÷kc6O+Æ>tåîå%W¬s€¸†¨]•¿E‘’¾¯’öˆÃ´'qÑK³‘JÈôúÜÉbÌåGSèÜÐrÛAllÚT:Ð‰Ù?¤Ãa_Tù¤9÷L²òî~R9ñÁTÚÄ´^5ÚmRÐkÑÑ˜ëGû…Á^&åNÝ8-‘öÊFÂ./Œž[{Í·ófÿ°ÛÚ'ê¾Ýì4PeµƒTßðil7¾¯ê{Gì.IEå†õW×‡7“ŒJ	s=vM…”ZtÀ…ú”çÏÙ„hÖl*jÈ3 Ÿ?‰ëìÍ½ÑÄ7GB{±ç½÷ôSê2wá:Ãö¦ád•·TÈe0J
Bæ¹ÊÂ@Ä-a«¾Ê2¾Hµ" õ85ÔX|c=a‘¢
Ýø"%¼KE ½¡µ \×i%¥+GV^¢ +OW‹ï¶œÌf³Þq¶][Ë´yE{¦Ò2sN‰«´÷ÆÃìYÌ'd,„¿Fpøl¼úb89ŸV%n«Y±1¡½ÞmE—Ü¤ìdY’ˆ|øìv
/|i±Šëèê+Ü1Ú^^r*$î¢}“`¹O>ÓþeªbÔ¸¢Ž&š©œMx<ÞÖfœº*ÄA:%9MêÝ3[«š\Ý[/·«Ãæêþv{›¦ª¡ Ü’}_Þ“
FÊUVNt}òKíïk:D>£¬‰—3½¹²pa¦¹˜
¾s˜»ãxì”N6,˜8Ò¼)FË¤jÓ ›ö8„lH½=.él²|ÁûÂ,Sè{ÃÉäBµ!Ž¢pu_Ò²tIy‹
u…žà…_kðì@*¼çè€hF¤b[ÛI£ýF·Îñ=/Žêíív½¹'æ@¾5ÐyÌX[â£l¾)a»“1W&¸0cŽ‰"p±X…µŠÅpÔ3a»Z/Cõa1ŠOòR¿éæ°lÖÇ}1Ïr¡,†B|	_B#ù•Ø&°Fg¦ÞG5{F“ ¹¾Äm\Ð™@zwf%å¨i+Frl	áæX‚Ã¡Uôéþíßÿû?ÿ9:˜ ÆV§dé‰<´fj¨þâ}-9øuÛŽäPí•4}ˆ—q\ë-!0yçv›n«Íäg¯õ"ÚjµÛâªgh?ö¬më$Ä’>V	/
EÈúÌµOWYT‘TrÑ/ô÷ŠÏaDG ”_y°-q=yŒ6ë×x§'ëòóQ9ùmÊÈàcXkâUÈBg
Õ>£#ágÔ2DÚ0ÖK¤»`ÍÏ¯LŽÎŠ„‹4«Oð¤$²ÐÆE!»A^µÏèèìƒQlÔ]Ó}oriÖnÀH–cñÅ2NòDl5§hˆXù+kõ |F}¿ð†ÙÝ)Œnu÷š„h_F‡õ6j˜Eõv·¹ƒtzÛ®:"9ÌÖš ­V5•u¬~cQ¸Ô–Žg¦ÿ$ÂÛû^•ÙÉÂ÷üw®J§b%$òÊKòƒ¯HÔ ”œE¥o}$\™BugG™É…Þ&Ú°¯×’êÆŽ_“¶uiïv4½šœß"U%G>‹Ö×“¯¢õµ¿û’oHÒL5Ž;:ôÇGÉ†jXÖäGt˜ë3ÂÂÈX’¥$B%´Õ>î©×@þ8_mƒØö”7ªÌœlã,«â 
Â”*7-Ö8dËé [	þª,×,‚v“‹¨"2úLòD²¡ÿÁa®ÊM&âTý„.LÐ*LòDÖñë,
Éá|		Ž×"ÄFEþù–¾®*\ìïop„ì“Ú?’,*U½64‚{ÚÔþýq¨nyëNýŸvß6ø*§Ñ~%2/ó(#¿îpÕ¢ê8‚ÍÓìT®N’ ‚Šª4^ðøp’>lušúo‰Á”¿4ú4¶ã2ü+¤ÅæœÇÚ0«ÒX
†N{·°EIÀ(ñ1ç@°Âa¼ë•š6×½Ý¹¨\UùSÜ¥ª3xA …ÎnU„˜®ëXÞŸ¤I`uuü£Õ^$Ù˜(/r/'‰ÙŒZCJbúÑ¡²âÌNè@ÅÜ1æŠñÓ	ÍD•‡™9.E P_9u{ó7bD5È¬c„>ÍfW“A¿7Ìõ–ò[æ­.ë®Ó¦EžIiw»Ó)£1­l¿8Äw€õtJ˜~ªgª^ÒÙ0jAãÛ­Æ¡ÓÙL¯HàŸÌ˜÷Àÿ^\&Cg³â¤›S6„ÛOÉÃóðã3&=íÓÁ}ªyËR*é0¦Ä6'$¯Ö¶›],œ•£íçš•¬G*íÐwžŠðz–9sDÔ›L§Â3‰‡Üx "4P[2…ùÕ¢–²ÑÇ¿~ýÖ4:_Öì‘iš¾õúgªF'[ˆ¤þ!MªF”0…QâVþ‰3u¢!ÓŒ–ù¢³l’ 8¶ ÅªaLh·ÃI‘‹KŽÐjAÈ€{/®ŒŠ¸ Ë1§`åZ:¬Tó™xQö”¢Çe?ÌËí/ˆ”Ú)ËÚ4ÛÕH_ÿ¯’Ž%£ÂÁˆ”àóÙ$ç¥²àëófH §YDsGÌÖÕ ×||	ÞQV³A’²Šk±Øñ”1QVyÃwÌ€…÷bþ)Ó$¬çM!eC¨/v‰KD;­£6J]9ko7ÿ–C…è¸Ù®o½”`-ÁÖ¢QÚÑA}¿Ña!!ªFÇätÐr`Ù[$¯Á-Êí°? õtgH2nõfê5]/4ô%",Ø|#ß¼ƒ#’BDíž}Ålûoƒ¨Kt‚Èð†QÛ;R"9evDcù§I}M‡« (j}ýí7œ“É$Dä´o™Ÿˆ¡®j¥æ”œ!íØŠˆ€îiwnÎªáJ*¹;¼ÆÊ¹æÄÖ¸4´÷dã©EÂBóµDCTæ´`§MŸžÎ^tFâ»ÇIªÔžh•úSò ^@ûè@r|zR’v#g'ñùä:‹HkÓ’tg-¢)‹€NÆËˆõ•Ÿ$Y2Cc±À·fmeyÅvšó4ûÔÑ
ý'ŽÀé@ê¢Ô×­Asù0^þ•e	Rà¯ò£8@äÑC<©.üÚ¢´,¡T1¥@:–jtÄŽgš'e²ˆ‘¹Ù£3Õ@I\
*QCyWÈ·,¬>ÇS*š½G•1Â¦Kr)–h:jÉATPz»Bdš¾›ËÄ(«KÙ@Ípª|–	%·¯•<!LÞØH~]_®Ž6b^'ŸeÔ¢Ž”ÂÌh²À©ñGGq9ã“”µ±ž¬©‘uX=]_F»—ò¬³yX®0›è©Þ\*’S8Õ•'dln$†mµ:ÍN·q°õÆ¬HI¼¦„4TQnvÎZ(*žÕB¤=5%U~X]¯ñ6-[àJn©d,ÿ€Ÿ$3aÊ"ìè}DDÅ!=tÈ‰Îb®´[H/Ÿ¨Ã‹KµÁŒT?ÉÍgRBC˜JGg‚ûhø8§b„þÀú›’bìÆýG¬MªîÕd(×—qméWípb]bo#)Fð—~ù!áÖž–­KœŠ¡7w€e	Q;Ý­w^Gi´;È`CªÖv´Û¨ïuw%¯L£<1ºëNÁWÑÒ¹Žî´±äâf<NMÄÙˆ…-¹§à›lÅÈW
”’ C±\;ÕLùÃK±€öº@jÍhË»kH^ž‰e‡59–L•aˆí1Þ­_ÍÙ	”uæJ‡éó¸\‚Ély™¯xš³Îû™¤£‰DÈe]}XÎ›¬ôIÒüœ2þÊ2´’ç˜¤l²Ç$)™Ü¼ZIF‹ZKá2t“¶,51…Ÿ0_Á-G,„•;u5YlŒ$UY&•±ÚnE:±²ØÛÇ±9—ÀaûÎ‚8!ŽÈE`ÍØÛî\±#pµ¿?"YkŸ$¬Ž–¥„j´M,•´è
Ú-¥’S¨“Á8ƒûh]ŽËI1Æf¹¥õKL)ysÃ¹ Èªã»¸eâ3FÚ“ÞË]sâ8i'I”ÙÃ"*óõ³hÅTÌÃõöç„,/HOêÓÁËô¶äÕ¾ó:æ|Ð5ÔåÜ¥¹íO+Ç….nˆÝoË×u™²/¿4éÊzž7œ?nÍõ`¯l©½w_|• ›îàn•¨´ŽwïÊ	4¥•·ã•rô›hù2`¬ë–ý ™“•‘î;r<-6ÈTXñGƒQÚå mÇÇ˜5ÉÓýƒSÇÔ©iê¯ŒŒ…‘¿®‹§šóÂF—úËå|IV]OÌ]/“ŒäåyiåéJùxíDÿªÑ¯u®ÖºÂÃ¯~7M/Õ³£Éÿú±:ÌÎxÁï¡J5Û5Ókåâ‡õËJæöÆ[‚ÝÙ[ëÌÁBÅ½U 6?v‚«àŒW\‡Ü4ºöÀª*°fkþQp›=côñá_ÎŠžGïàc’C©ãöËˆõ 7Š,K¥Ô°ÉIp©­”ï’wQÍÃë`¸1«KM]ÖÓ+ö¸¨8 þwO‘@ýïAÅõ?¾4õ›çnã*_Q Ç‘Ûì*ÔL}AeZ]e&?u¨ä5Ðu™fšz5œu-ÛÊËémÑqîÝÆÇÔæ„™ìQ 8ØPä‹Œ’”—âê(ßá5_U‘ãá`äò-u(î|
¸´(¶“».n…ÐB/³N¥ë%„Ñ‡å¥—9WaI·ìkÔ‘+MWò]%òó¾®¬<øþÅ‹ˆa€{9È—ö*¢ŸEÍÛR]4`Û8/ºÌ¦¿LÁöªNa­ðDÊ¥†ðâaUåýShf˜„ Ö„óþŽ$hB½€\âTåb‰œ,½W.àÂQI7—2¾rÊâ<Ùo‡;ß[Ú“ËÂãÙz–‹ªþzKÖ£—'´?ë§ˆô]_áZÆþûaïìTz­¯ÒúÄU…¸3âžÿ&cŸJ=mb`á`=m¶Ž:¤²7¾í¶ë¸Œå©½ñ½j|—gQ‘‹W˜î,Eü~‡äúóÔÝí‚Ñæ÷]UK]‰èùÂÌùÃ€².„Lç\ó±ÉV>â­ƒ9/k6}O“¯=ÀÏŸ´ÂÜœ„ÂçiiÉ'œoíu9`Ç=Ò*XŸßì«ÕÀÞ‰Ùƒ+wImÓ‘¯ØÄåƒöÖÊ`JêÊ¦è³¡<T |ñ}ñÝÝÛ1Æä÷^°0šçpÍ#˜¶b,PˆÑ58{¥³HsýŒŽVs<&±ÐPÊ •Ê(×=¾Oû-6'dô} e?ÍdþÈœ1}·jÉ†T î$Cî7âúé‡ $q:®nÕcÜ,i jþ¼*\¼¡Æ‡±EÔ–ÓÄÐ“jŸ	7ƒýÞ­ó;'ÖGÅ9D>ˆ‰8‹— 'ÚÒêÓK©¡RJó¸Ú’Ì'ÍN«Ã»K¿”ÈÞe`È
BFá›ÍÖQ»;1á²‹';¢V"Ô²CM»íí2Dê<ttŽ2UÒ3¿°mBÎ—´Ó>@ì?hÌ7|1­Ülª‚ép}ÝRéçZ}Hî·lÕS?$8’óºÒd"ÌaŸXÜh×_³ïÂTKZî¾ø^Smõ'c-ý­ÖŠþÒ(zç|êžÂe6‚\â§b¼OEr3v Å0>³±K 9Ž·|šÓ£?ƒ9½oáœèóá!ü§5Äìì¶Ó}±—>t–Æ¿ýj	úˆÌKÒ9\bŽ%ÛMóšèº]<ÝôÒ7ŸÇæ8tÖjÊñ‰û³`ÔÄ#pÏ£ã`£¯U-*Õáªš2þÉL¥L#ØyÁ¤èªo¢¬žO¦©Ê-V‹ùDn½›’Rï¤ØFèÔáT6ËÄk_qŒòõ×b'ÒjÞË®+r esÑè‡üWL€"®Nüí)\ºÌ@.o2B«Œ×z)»Ÿ³	ÞS~h4qÓîŸ"w.ÜZ*\	÷`R{‹³öÎË*ÄWñC€Y]rAo¼øÓÀÁ\Ç ñ¤´C0¯å ×„*J=Ê/GöAOò¼Óß’0†¢~ÏR¸»ÑØ¨Ÿ¹°æ–—}Íy]h§ŒÁ—SýñÏŽfìE-]>ìÌŠ„å3OkÿÜµq”}_ô{¯§Í‘¿RÔ·^£rÜ„ˆ
±\Ï^}•ø°3Ï&£T¦í¶)N«ð•¼I<¿jšÄY¡SÛ_nˆùÄÑ»²äâ§er½ŠPä%Eü3Vä>—3»FÝ{gZ…ÏE…Þå3M-ê9ézleÁÑó8ÌÛñÎÑÞžˆc8$¤ãÍâ1wu`è"^å™3\–P0ë9óü’ñvZ[G¤n+‚ÒÖxá58jþów9Pò`¯þµ„ˆ< ÊŽ3*mÖ»[»,kÛÑÙz»ËÂb9öOŽ *Ê_QbÊÃ™>ßÄ–F¬NÔÜüÒKP
‹ ®óBÃq‘Š»àÃi¶£øxÉ¾pÙÞ¬0iôÊQS»° ˆP><ŸY ÿBóFeûñl{pªA¢î—³R\‹ËE˜”Ñ¤7›{ éÞ¢{¢kžR)Ã.’ÈÒ)ù“Ræœuu×‰Þj Õã·ãÊÉjY˜CæÙ¾³ô‘µß=ÄÐly#…Zs«ÍÉ2q¾Vp¡Xºf¼.*¼h|&©öÄyÈ»!òSÁÒj>íÞØ¾¹‰Ýù¬^­6ëÛé†ñtÎaCŒ¶xCQ²"8 ÞŽ #Í}×è<€Ì20¸µæô¥GÈ¯È~©Ô·âA?á;#ZÀkŒšCÊ~B9Ò"1š_"”zÞAêù'HÆÌªò‚óÌ©œIòÅ	à‘Ù<7¿¯Ãý•?€Šb¬q@À{ªónBÀ¹RÅh¡gïŒ–
Uy±‡}–‰A‹ðÅß‚wqàtãŸ?ýdz“]•|‰ˆ“üÝŒÙI—XŸZü7BÖ]Ilá¬÷á[.“‡_ëN¿ Þs¿]á}Íx™¨Õ9^;yžˆWäóç2<÷bÉ–IÉÇ™ÎÛÞ4œçÿsý¤ÅÚ£:ZŽÆ¨;CŽÇðgYõu8ˆ —®„C½Ì¯J:ö‰Eï9<ç%<
Ê¾·¢eºÖLuCø•üUc}öù‹â¯õ1óÑØyîb³ÿ8.,†–êCl¤]çó6Éulñ©S’‹ö³øþý’wXèÀw,äÅ—…pêZ3—uéèÔ\9dH•oSÊ¸Ì¾M©œaãÙG?üÓ¿DÉ1‰œžºX„‰§7–Üœ*¦Ë¹ótÄ±¨©äÊOÆÕt4ßÚÅ6§ù‰­É~!®jåd–tÎF‹I¶ qN#æ³G†ÑÏäÿQž¬×Yýù9CöÜü&âñ Î}ß Ñ¬Gh‘Oäß6‘Çš}ZÃOF—_#­¨Š¨ÿy“}Ÿ°ÿŒŒ I’³Q‘žþŠøÃ'Qâ_óuÇr˜cwacK´Ójk+Qà“†B/úÞ}·eÿotqþý%]
v}ß7þ´rÄ§èç?Røª«?Yaý_VY^¥µ¨¶†o\þÿËê­÷k®?Fw]Â0óFíÌZ”á‚ïcšËÙ¦v-Š:qÍ­”¼Pž÷ýúØÏ¯‘$âÉôªµü…I[{úAóàÅO‘ŠÎ!ðQ±A¡¹á°'ì/ïnÃ;°ßØæ85Î_TŒÅõFÜÛÊÆûFAž[k©f[<ÃÔÉ§!õ‰o(Ké‚ŽÁ©X¹ÚØ™LúÈ{Fc\è?‰üù†~S–ÛmùáF¢Ðc+æ}^t'^ú~ãž÷BïÝ¼…Ý¾yzSp`²«gþ€œ¨€k4yVç–6ä%9As¯®~ªžNõ(í÷8Uä3§·XHÄ@R‰ý:\@^ ìã›yÑYžáþ   ÿÿì½kvW–&úŸ£¡ _¢,Ó–Õ	É,“”Š;Ý‹A0Š ‚ DÑ*ÞUs¸=’»VO †Ò#¹ûÛû<ã€’œé¬.U¥IFœ8ï³Ï~~›úM’ŸJçZhÜ§³M4Ž9l&mOzçÔ^fœµuº¾¦21‡AÇÐ¾¹²ï¼Ô¸…Rãæå×ôê®‡xå\}Û’çNª-ÿà¾_Õ'“/$§_÷‘äCÝ…’Õ•ªD~Uotj@T¦JTWqIäÇûœ³ÒáSz3c8N»ÜH¢I`êp‹Í¨Œ3¸åªQYÝ¸þý~XQ|æŠfŸ¯>Ê{Ç y^}¾ê¼ì#Ìü«tb‚¿«tõ×¾ú(Š°ûÂæðW{½§só÷¾Ã—ê¾(PŠó7[Ç»ƒãú	×Ûp9Ù{ýêUg‡®­½#í(4öàÆçsÎe
î™dr©ŠÀ7Qù¥¢h}Ö‘È#"§Ôß3ôã;VÞðÈU¼¯×gšžãZõçê^E*ÂÇ˜±‰lD5Î¿ß×ØYßÎ÷çN•Ä mÆA{Âa¾œàãûYí±÷öb-ÚÁÂùOª:Š¥ò\.ãÀ¹¹…Ûû^Ø;S÷nrŽOÎ~†n.iíãï Ü—%#¾úœ|fsUêàuŽ÷wË_·ö÷Êo²aôá0fvxæ¦ øy°Nsºê/.Üøe_¯ø/²iá'¦ÇÅÖ£^o'¾˜öiço5°öbøS9èNáwÃ˜½ 8™tHøH°~~Nõqiž‡Ý‰ØÑ#ÌÚí9Gô¡ÝÞÌ¯×ìF²x„ÖÐYD§¤ØdÕÂ`·Ûu×QñöJ’P¨‰þÞ]1º¡©‰ö¯bUú/qI‘ÝFðÍƒ“ãuïíí7üÛ|˜öâÁnoÓ8ÏÐ„B#îr ´+ä©µè¿ùsÚ1ò7+âj}F(h­·7Z—ƒ(»j!sS.{Ka%©qÕ¤ûÏÝøëê7tÁ{æaînl®}ü¯ÎÝó †Ù[fØ•[‚S«µÏâ:¹9¾ìB—õßÓ"ÊRÜ‹z5Ë;­„àj¶â9´Uïk0<]ývÆbÔ!å“qÄ€ÅÎ»2tC¹+ý¹"\¸ V¥î\‰bSÅ¸‚‚,þ¼LS"YFQOûõ‹êl—è	á#OD}W¦ßâdPí9µÍéàUèfJ)¤»%ÇÒ]€¬YŒ¡iÒWä „P h”ÝÆ
Vå«aøçIIÂ	pLRŽv!1«3:ä/©ÛbS„µ!$—mæÅç’kbUÉtVÿÙô¡_)õÕÃ>½å«mCÀª&ÿÆ¢ðz`Ü†:S|íJÆ …ò†ö,6,­ëÌ:¥ ý¤£ÒÔH*“lGžíYSQ’×'×¿¯_C«4£7óOÅàüZ¢?æUM(kºõÞ
èfˆŒ–Ø}øMÆ*Œwƒ¼‰Lâ.ž”ŒÝÕÊtÇ=-I´Èß:<ÜúõsŽ8»Ì8Ý‹Ò“‰…$¶®8Äs D¾­I`Ï™!¤˜YõLíU^,ÚÂïÝR§3v«Ù>VA:èý\Izò§ïµ
Mg€÷Qà2Ên³F©<–àÏ:f"ao['!ð€g7ð	4R\v Æ„¬w³›ÑéÔhèˆ1År¹¬8+˜åŽÜ›Áã§.ò>[/Z?+mzî¥¼hÖªˆH5ñ	‰ìalAµ§\¢W«üô—ÀÊ–uÅíó1ÅFò5ÍfE›yp^Ö$,ü\±L÷ø¸„‘C…"½¡µÇSÊ$J­†uõT1®Ðã
E‹Hz‡šGƒâ%yl3_}´’Ós­ˆ"~wå>è^AÕ×^Âd¨Ã(£mÜÞvyA~)RfÜo­¤ÕÒÍœ¶çHŽ¥²c¡“aÀ(¹	äÉ¼ 9ê#°\†/ 2=Û_~‡’66VÔËçççç›†šÏ—û	ííZS%”k/“q6x#;›êÚÛìÞôú²QûX«ø1îÅïðtW{_ü–m“Ðø·V!DÛêÊžýàô³ÌîN‹Ò‘½ˆ 1ìáiÃ¼/t(öŒö<‹ù‹ÿšQGi´£˜¦ë|)ûMR9Ôe+RÕ6—ûMíq ›;ß+z8X×·R6µÒo9^bBòß—ÄÒ_Ä:@\Ìw€¸È9@ä‚œ·¥-ãŸ[È¶=ÃõÔmØv@ýÆÍ«Ê–ñÏá¿À*â#)–ùFà_ùÕôé¾ù2¥û+É Z}=>‘¼WÅÀ§²P*1±)€VÎèÅàQ«KoeY<Dœ…EÊÁ,»H9ÜYµrâ’d;ŒIõÏÓ˜Ã‚ËÆÖ(Ìd!ôËsÎµad5¼ªáÌ}z%ÂÊ~f%ñþí3káTj…‹|â;É¥)Ïžå¨4JZ»L/µ'Ügs; ‰î²•ž4«“†€S< ž‚ÔPÜÂ)s¶Ç?ìàÿÀ_0;¬ÃÜD›è«j(÷›AGž&î€ï™%†3KÐOaúq¦ç¾hs5¡&‚¶sxøúp“!epzÓa¬+n»fŽ‹­çr2«o¬`¢³°öØ±ã‚f	ÐÞŒr ¶©Öí¶“¾Rãô
.o&˜Ï,HÖ$]};P)e%Å9¢ cÜ€·ÏgÓ+4—[§±B, 4jzøÖQRqäø´ì~+ßÍü¶‚m€Íb·!&'J:í.ChÒÛJûdéæªÞ·.î›þ¹äôøo„ïæ1‡~Àž&ß2¤±èv%¿A·óU¡™É­8¶ye›µsÆ«(Û'ñX£’,N(SDDÓ^Á¿‰Ã_*p)RÙ"NG@§ï /b18\/ˆ<“]Íû=ÕöÁu-_6ÑçaËÊWù¸;õ£›IBÖÚ)±@EÞäåkô^Úª½ÇUmäšó™4ËaÏš+l03Q„jöÓQ‡IÙÐøÏGžòHÀ›2²ƒçì[Y*{èÐ›‰A1…«\d3ÖSè¿ñ'®’†ª«ä¾1u;Ÿq5Å¢Åoõ@Ì/g…•£SD[ùqŠ—IŸ3îÞûüü­_Q‰GµâÈZªo×o˜«UxwgïË£—*Ê¨ð¡’·›ò°4hÉvUmî‡-	N'ÿÎ+x”dÑœ›—ÈØ R«3”×Õt(¡ZÎ—
.+¨’5Ô×±
ôr'¸­RÏ'éhÉÒFèï”95‘’!îèh½OªÑ?«++Í`?rh>þŒ~æb6Ë^>ó;X5‹RnV¾¢íÒ6ÔVÕ8GÕ[%Ññ–Zü+“&K¤Æ92c%E›Ïã\ ¹=:äoíÂåÿèQi-Ü;%À¬3›.Ã…*ëZ å(«3ûPþÉ³à€	ÈÌŠ« „+@7¿ˆò/vO§«÷9ç)¶*þ<‚:¾§ÜÄ<—”IÎéÃð§~¼Ë¶lÚn{ïÞÖpß×Í«»lÝâ¾PIé9djÓÊÖîcûÕÂð”»QÎ¹Ì+v“l#—åfðVJêâgSi<$olçZÛ­#ŒDôi(>=pq,uÎ©ß7Ïƒ{á;˜3›³:ô~ToÒlÒâUÎ¯ÓWs:3ggäY×çAõ[­Ÿtm:iq&ïú=Ó[ "ébÞ»N`ÜØÛÛ'~ýr’ÒÕ¥Žn±+–3¤–msYCÞìHþà;Ë>zä¼È£ÎIbûìyµáùó`å¾9ÏVP.Rœ¡ª—é˜V†ÎØ—™f†”,z¨Ÿ!cl,-¹+¿ö•0X£û[˜ç±áœ=’vþÕÇ±åî8>êÿüûÿ¢5ü7¸ÃŠG®ûïËgxåßÖTfÜv~u²,Û¦\–\	ßšæëPªÃÞüx­…v~Çˆ¹˜”€§	çÏ›$íáË	rC$Jº…½rzƒ=‹‰c·C;ÉóÜ--WSýñ¡Ý~%ƒ˜‘AY'T2Ž˜znt£p œÛ-ó›bÆHES‰»ál>¢*™ˆ³sDì,ºŒÕ²à@¬”#m7‹±Ÿ6Þ?ºÙä|¾ãÞ÷:CüüÐ‹k·A¹´
ÍØ®w?	DÅÇû¦@¦`­”ÞmvÚU5R¼½ƒ÷§t(u_h¹OK„RLáûçJœTãÐÆ÷±ÑgÖŒ¤¹=ìe:¢¯Ð‘ê·t¤+mÄ#:ÎWbZÞ/~œùZxÕ7ß^[ë—Qóàõb—Œs;º#K÷ø©ß5j¶»£YGâ
vz?º²ž2šg?ú½îþcÍÈ¢:g37y§Qv–œUÄº$ª	Ñ8(!}^ñRG'ŒÝÜ²[6ƒ†Ú ö…Þ­›"_ù—rs]ò]æÈ²M>ñÊeŠ©âÒ}wž<ŠßÑwCÝýà`·déâW½þÇžð.£*DQÉLRÌóW¦æ˜Mé…è±BZREïC%<D¹ü…ü7ê¥`%Ü¼ôjªoËEä£‹C¯º„Š%;¨¤šüäÜu‡jÕªš*®ªÓTñeIS%…ž¹-3«ì_5NapÛÔY¢÷4–»‡Šô>±p¶ï<:QÍÁ¹õ«Õ=ò’n^v÷ÇËF…Aì"¾Õ‡I¡G9ýÚó’›…»¥”}I¡Û¤eÝV)rá—øé’w‘!–‹!ìp(oÌCðîEª“d¿ŒÓQ'MÇEÚßÛZåõ|žÊ©ÆÔ31 6sCõª}÷EÎ‰ÜªµÚCu[vRª•[›²’³u\Å³Qaù\qË8³øÇW[-$MòŸ•ÁLßxJŽ ¿ØCw+â'79Yû1@“¤ëq%Hö£DÿIf2õüz‘ÏæIâ•ªrü»Ž¡-»â?•¬à$ÙR_}´Kvÿ·bÄ‹ú•V :‚aÜ»$ätóüaL¹RÞåô"Ó+—&©ªU§´ÖágÆ³›‹s·ÿ3,Ä’ÿÓ9åì¹¬Œ¤œ¯7ú;:—p+ïÇv[tªàëRÖï@?yäªèµ.ªzÊ_xOÚÙ ‚<ù±o;¤=zº&ßyô’¨?J™òEtÝdòëpÜ˜ŽzVNþA4í%N¸Ùr³»qfV#¬ýbK„€ÀJ•eÈ«Þåd>=Ž»ä4?!×ƒ_Ñ^?ºÉÄkÓ“4<æê“(ž’Îge‰J-žúÛÑÝÐ¤Ó“™·$+QÕvœIív§ÄÜ•Ni5·pzMò']¦ÆJ+ä¿˜'åø¯XÆÉOOù+šñŠúNÕÎÓbª+Ó¼Ygå/äôÌ%i°ü®%£I<æÌ ˆ5âhmõyñUÙ…(÷MGÁ)ô«—dÝ)+¾sxfÃa×ŸÿäO#ô>®.!Þ<bWò–¯vú¬…ó{k®Q<}
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
¼ûoòÑ‡ZÂy‚AKû#F3ôxá­šOÑÕ@Pÿý€ ë÷oŽ…#‡yr¥eX3#Y‹Uô<¼žâfŠk¶([†•Ôü˜»xŠ9+	µ6—æ¢QöîšûæÅë×{­ƒü@4‹f¹D¡!8£ ŒpÛ–ìÿ’A.ô…NëÄðu†¤Ík@n7€J£“EÓžC'ö}Yr—Aj÷¸U–à<jBôáÙ¤øÖ…“™/
bchÂPÉz(dø 0/³†eRê—‹=.òue‘ÇHãìÝÿ?y×ºÝ¶q„ÿë)P$5ÉšE7NZ¥¶-+¶jKVE¹9=ŠŽE‘‰š· eUáËõÉ:ßÌì (Qvr’œø)`±×™ÙÙ™ogÄ™dµs—'9Q¹Éf¾Ò¶ð÷v¤™£ŽSÜ›]~]—úochO«ÕwuM"_¸¨i[
žø	ª¥KòEõí‰±Ÿwµ\³\C»§æ o6Ó‰Rv6 fBá!Ž x¡žLeÃ…eÖju|·µµå<K.-ö,—õGîòÍC¹+¿Ä…‹Üø·¤n¯¾ßþï%åÐ/xŸËÙ~ysA»|GÏu}é’¶ÿv2Ëù¶³¹ï 6×|üÞ¤»'qœž¢-ÛÙÌ‘²xu×âµä2Æç«Iöê9ðÐ^
êÉ"ù˜†…Ðr²Öw^ÀQ¨ÃöS¸½ÞœSxÛ!oJŸöG£AŒÃ¾ú‚A²ˆÉ\ÀwöU¢O•ôˆa²!d:¾d4ët‘”mœ¤$ïmÕŽb#ö*‹Ý”öÃ\O°ÍÄ*ðë¯žztUûäP&ìë3¯U=kkÖ]eca•ÊcB„ø4²ÂŠ?ÝÂ^ì /`;W¿ÏÜ%ñJ§õuÏ*ŸeHBåœ«ÎÕº˜ÌP¥)&ž-v>ñ+–mraÆ1ÞÄ‚â³•ØnÄ¶ÏøÞB¾ýÌ'YÇoß«|©E¯¾¯ýU@»·”ùê^QjU?i¥'óY7~tæ8ÊxÖ—)JMz_ãÔŽW¶SzÝ3Ïwø.€Å'épí‚«‹}^DÁqL4Áæ(IQÐ¶0J£èöC¿‹·óU1Ê!®Ú<õ76}ZG­nÐ÷¦¼;ƒb¬NG´z’>à,8¦´[òðüü<¬9CŒvOÜ"~’äQ=ý!ý¡}ö§=mäÈ„K×
bÁÌ¿<mžåf¢Dàûß¸Ž¬ŸëÉ
OÝbªzÆrØ¯4¡Màã›ËjåÆøQU™è”•ÆÓ}óÅÂ|q{Õá¾Ù#»JÊž=õúä-ƒ7vÎTÙÍžu†HîÚÃÓ¥`%9CÕ:ÑMl—5GìŒÒ÷7è)–ÃUÁ´¹\ó®ÕÕŽþ»v}Þ‹T÷Ñ-kÛLÅ’.€
éäàö‹íY|î9ÐIÈÎêùÿ|¤ÎªºW t°J˜$T›JÞo±J <žÎ¹¡Ø6TŽå¹÷Š®‡(ºo7<Ú¸X„™Ø””Ýë_¨ˆ:„Ì%œøšÎ #TjŸ¾Æ­>ì¿hQžežÓ¬-õŸÚ²ÏÓæ`-2kAY¬Ì»ÉR:Ä(@è“À,Òá#U,ˆBFö¤jŽ‡ÂÊê\œž?z—¼ÞdVpÅ—™éxl¹AæZ¦z´¨„õ·-1çN¢J[ÚIþ¬¥4LâºoÃÚéÖ™ùk›þjž1ÙpÕOã~øm¡& C¾þŠ§8WW¿^:¹ù1óâU`!´‹åy¾43[É*“¬pvj´&Ê/Š\S¾·ŽØ¯ÙG¡|?H§q7éÀrªh£ÙW	Ù‰ÓáÓ0VUW”:HÊ~!^”9h¬ú!‘dÙ0ñÍ§X,*qIR³!+V««ÒÈY×}«=¾¯¤Î€è¤ªjAÏéüŒô_õœ— ‹”¹$)×dbÆ/<%Æq»§˜'±ƒÓÄ ¡^íý+8iµ_	¾£‘–ÂÚ”?^käÔ®2÷Dìê£r·3v¸‡ qÆY2`“#–ó'Jó=¨@àðëãÌD‡~N•fâö#‘ú`’M$¹¸<¤hÊÕX|”*€ùdMÆï¡0_àyiÓO­f·ì:”M
s4)üÇºIü§¹¯¤_ûÖ"£¿èÓçØåá£­G_on}³¹ÕäÞ_ÒùÕpI7IƒÆ†@ˆ„ù˜éæ8ˆÉâ.Ã—llÅßTÚì.›y³´!!ÿ«@­y¹C0#2­ûTG:¹ˆý?KâK	M¤’iÚ9/Û	;›“¬¶ÌQ†€Ëf<½•¨Á—AuWGÎ;ª—f+N®$ÈwtÚpž)6õOgèNÞôn
.:ÍnˆD%Œ§ðŒôÒ|jÀfÎÕwŽá#MÇ&²92<xjaW6&®Øp› gA“1l^’÷I›v=Þt‘)+{Ò0³«8ûsdºÅ¢«jx-YÁþ’pÒ'¨£Ó¤âˆ­„Ë‹(dïÕD»kk9J/¼çPz9:Ï·-ÈöÐ³#	3#(K·B=Ö—¨Äþå,Ç …ÚX—ô++õÒˆÞÊèDa–®ÉÓ7×á¶§aŒó%ô‡…Ùe¼ž¡C!)KËô>Ol=K›JqNDž0‘±,PAÙ‡š6Îê¹õÈ’`™Æô‚(ÎI})ž…ºÎoÓX[Jpf$*wm2æMŒ“^
<IÜM@TÑ+Nº ò1x*]=–±uÅ‘zÍ©ÔpQ	”Ž%2©]Ñ®¬³®;$N—‚w6Ë­Êz ÄH®ÄHÞ1ÉZØF‰»ŒžÍ€^¼‰ÐkÄ!ëÌÄ›B#ÁbJgjåuÑÞÎxv &ÝÆHñ˜æîàèÍñIëðd;x©‘‚:)'Ó!ßÞCt^¥Õ8hƒ¹,¯éšì_.m•foD6­
d«kìy»¿Ê7I’‘³à15xc^³/eFk^ÊBÎ¿çµƒöÞQëè2k¨œI³™ 5szº×Ú}IƒøˆÊ.³#úa`TÇèlú>™
rDTŽã½öÑ›Ãö²6´Nò©Emç|‰ri’*Ãål€ß\Í:S¦Û±²	zÍ¢¨2—=Ä!U¨SÜ”ú’6 D‡žMø°©@	ž‰žSÒuÆo"F˜*U%$»¬J&ð5(¼F]‡/­Ø¥‡Æ!
GõÂ¼Û*úí†ZUèÏwcu‹¨Ãùå^0wðzò£Ç!Ö…bXÙÂ\C\/µ`_¬Ñ“éÊ&ämYîÍ€,W¶Á/Ëš°/ÖhÁ¨T+[±ÊZÊ½\Ýš5£œm,„€«´ƒÝ·Ç•¿}b€¢Kö¤¼Ã‚É6>½XzÜþÍï	tsönóËpg›¥†† ˆÁ«’ÆÀgDÝ,k!>Õ³Ð[=4®²PÉ¼êì¥¼F¿Ñ½’”G+–þîô7¥hNzøºõŒD9¶Ë`ÿPÀÊ€†a¸q×À­ÚÀI¨ç
_MóŒF´úõÈioUlçÿàD~¡¸DÚé9ì“¨
hŽÚf_¡s¹ik9_B«4$ô+úƒXñ•ØBu0"À|•IqôæBÓ0q2sÁÄMÖžØì1õc½z!‘óèçýŠAûø—ƒZzZíw9ìôW¦ð)IHâ¯Æz©…4Ðý!‹­î-Íä>Ë¨°¿\ÝšvÏ/gh¼#Ïä¾º´³·wåø0K*ø£¬ox¾ÔüÏœ½¢ð<BxZD‰<9~»{òöxï¹ÞàØþa|ËµO•ßÅ€Z;EÊ€²+Tª®W–ç¯¢ÇGöœºká±xïÑ=Ø'gþ)’i,HY±5Òe¬F”ïÜ&² ýOÆYpLº¿’[Z¸èzHn¶ÑŽ's† è!ËëÎ«ÊË©[˜	dú{†ü~pŸHGâ}Ç¾É¨bÑOî‰\ôÁÖ¡Û¹Óuî	{¸â¡ô°v°#ÿ$ÔƒÊ%¼Á/‰4(÷çƒÊèæs€;¤ó|y~ûOÒ£ú¯7­Â«¸Iç´ìÇ½?ƒ*Õpœ«àçš™z½‡â^ã˜™d‘0pè ê|" Í8çœ·´ËÉ¤G!åöÂ»8&Î%‹ï´.)ëì¤‘Ü»°AÐfp2CÐ‚Wßë	ó•¶Ï´é:ÈRèõo'BõejÝ¬ð^š"q6ƒœ®¥ìsS£ÑÊþœ+hŸ›‚&óq®”<4EeE¹"ðbýw2.¶fÅÿ½n—ª?Uµèr2Ã•êj~ ß©m7R-zJÎ–c–‘ø€n#-/F6©báÂæKY~wkTÄHq›‚/Oµö5Åz°;¡!EÁ{˜ûRÄÃLë@«œÇL¼@>U‚VÙ'QçOáÉcöPâŒ³nTSc¾ä­Æ=ñç\€øéRÎgž§¼„Ç1bœ^Å3uA™”–pn}ñÅbæ`1ÅFŽÙ†¥ñeËƒ¿®‹cf®ÆáFol'r²äCaÃˆ{hÊkq,ñÍ‚ªóÓÍ.ÕàÙLù]3n91•}¥lo?Á>MýóaT³„AëÄä^+©£j$‹ÜÜ¬E)Iþ¸ºÙ|\ÌÆ¥¤»‘Ä³—‘\¬C}øÿ/j5jüd‚ÜU)ÉDÎºþå/7{€ßŽßIñ¬,6^«`*éˆ‘Y¹/P/¬è,Â•aU–Å]˜ý1œbmáÖËÆY„fÎ˜J^Ì‰i¾ã€‚gÈmÕ%Êïô“¡˜„U„	Ê–‹ð"q¦H‚P6	aƒ0wÞÄÙÎŒ´sá÷ô”¦mŽ«m4ƒ;Èï?ˆ¦5¶{-2é={`&S2HÌÞr*Fö
#±¨!wœÞ—„›šô’ù¨NjÈì‚ŠqèW¼©I—G<Çê£…7×1-€SÃ¡š°Âÿ×Á óx·;Hb`®RÄ‘+ž}Ä"mn>âÛ@¸KÌçê`=/oò¼lFE“P„Ãb„«vŒÁyíù®h7¥‘ u#Þ„/E•áåBEWÙ+Ù›u®®mÍbÈš$Îà*Ñéfo¶HFÈµP¸2ËBT/&ÃÓÍP<«ª½Õ ?4Wï#|¦avwæYr9—;­Äa'ŸúŒ.Î”m…ÓùÌë§—?÷¦ª@¨94Ò¬o–!êï¬—¯Dÿé0bépþåÍ(b ’¤ôÁÎìóí ÂFèÊ‚mÐ‘ÚTç¤N’qµòÃ¸’Óžý#@Îš»Ú{)í³nîõLnšËž$.|£[‘ÎHÍªvž/m‘÷¶¶lÿ4ÐÇ{¤½ÅŽÁ1Ñèh’ŒÃeÀE.4*ÛR–L¦~R™q÷ä÷©±ŠUD…®Ô|žò\Äo^Vå¿J‡	™HñRXgeQ;g^_ó#ÿL”?k”´ú™‡±Òeq?ñ”fqgÍCÅù)vê}úÀ;IØJ‚tÞï‹(³‡ˆó{"Ü)`ÆŠÁAÌÊ˜9[\Ì{¤ hp÷x¿Ïq×±½Ñ7‡1m×GŒh¨C ½¹äÈ~ø
'“ã¢oÄ—GŒu\áÕ2/þ‰Ä®$çi¹„9^5_ò‹¤
#`QÒ`SGÆìîQ!éÚù0«,ÂÜY¹?QôÏ‹÷#3/\‹ü\Xd[÷zFHù@â'/Tüv o^0I´¦É«øºZ[eŽpãù^Ãž/öö÷ßµŽößéØ^¼yóâõž}@5Œ®æ ‘ŒƒvÜ‘¢ùÈysË/Ïü†ýMlÀ’Ön‘SV÷ç³ØÆÒ†iRÇ4	³È»ñ
Nl@þn’­Œ&Ý÷›ÍJÞ[ zføb–Á¥»ƒ¤$I»3ìôÂ‚×d)‘ÂöUgýY…hÆ‘Ý„Š4·h#½âYm"Ì×“qtøöUáÃ7¯Ü¦YF
m£quuõ'“>É$ÚþÒFJìÑ4vH
<i>à€—O\O6·j‹ÛÙCiðáR{$….“Ì¿m„/q‘Z59Él›\ êÔ‡rE‰ãM…×£BY§Ù—JŽ¤x^O®‚]bèð,_¾§Lðj´4£Gù—A÷ð™aŒÿý  ÿÿì}éVY’ðžâZÇÇ’l)ÞºM3²Xm¶O‚ª®Æ4hID6’R¥”ÀÖœyˆy‚™7ùežä‹åî™xéofÎi×)[™y×¸qãFÄå?_oVs©6®èfød2° &Í¿ÑP É‚„ñúíêÛwïV×Êö»7ïÞµÿ¾}ÕÝÂ8‹›ÌP=°lv'ñøÙíæÛÕÕg¿mþ´šË¼R^þž‰¶4§³eà¦|"ÙÚ*þq|)ÔFW¥Õ3•ol7ÂýPå}’bÔðG2D#:O’°ÜãnL¦ä,Ž'ð[…ã!K>6ºšÁþ*+vP¡3¡€d¯Ù	e²m.qÖŒ—aòD3‚Ò²WåúCˆ%F©Ïàµ|†Jiù; FË}F]¤{E Ó”aXÀŒsÄr95o"^W9^«Ài2 W\`aÄ+;¦€IÀ•L+°KâaBÏÂ¬Ì«2@rüôÞžë¼ä¼õçÍèâ!.]4DÏU;È¶šM“n1kyâÉ…Ú#]7‡x<ñ ÒÄ“~EbÊo†M¤å7/ŸÁ86½a=Ä£Mod%‡äJ)o;mK<z™¸·<dÖÿèÓ½:jTÖ‚UQ¨Ý¶¯‚½hö/ý!0P¸‘‹éÎcÜñ´¼Â¶=6ŽÐ²=ooZ'ÌAÔ''?wIù­¹óõ—kwtQ¬2ˆ®õ ¾vCè%‘®!¼&²0–NtÙ<—? u@ÍîÈ8Í™½Ñ²jn8õBQnÕ!É¬‹l!ŒÓ˜X’Œî™=±À 6’aù0>1c,ÍUq‡Hèñ‹¹Ý—¾EW>Mûî?nQ}n*Û¿ã‘_J¨vÐ‘M
ú'6qób@
Äh4CòÀ†az%ØJ]iFƒ;‹è˜þ˜¨>	%K]&cf4 €÷ìØJ6)ÊRÅåˆtv(”¦zŽnÙgÐEÓo3½´´zµ}½U’lfµÁZÁÕ’x[\ÜC9#fðòÀ„w‚F3WÀ0AÃ¨2ž†3ðé}zpº6ÙPàº;†"Æwgû‡gjµfã¸Q«î‰íF³^;nü\_”‰µvŸjÖ¡„¬Ñ´g,*Ú”	W4‘´½#'˜
‘ÔatY$½E$}¿=ŸQæÐÛ@üzxÂÆÃdéuÔ¨}DããêI³Šwš‡ûâøC£%ö­ã'bûÔ?ª{{'µÆZM6ÅîI½ÕG{ÕZ½ˆ£}u€+U~“öC‘P•¾:. ´ãVšü(DË‚O#Ë›.c	ô…*h#{1eR0±).Ê2ÄÊfÚµóœ(ìµi—Á>]÷øÌÅg8ÂŠŸF>5†O’*fw$DUqüÔ,=Ïn]LxtÜôâ?àWÙžSÃmu¾ñ ¥Ü§ÑŽy^Ë.ò&Ÿg¥r~ aÈˆ¸|2ÓPªòEý/ÕÚ±4—áöFîá }à8.bN 0©?CÒ*ýD/yÚº‚è„"WgåüšK9ºtó†­{m³u>c·˜‘”ŽTÈÝ„ª€ ñ–6€¿·èŽb€û¹¸ö™;¹§Ý‹fH5÷ÛÓ+LæUHIÏ
‡f‚§«,Rm)0ÐØQáyŠÇ²%g…Y§9XëQ4½ËýkÎüK·}~ÁÜ]ç¨>ú‚ãÆ4wVà°·ëÀÐ@ç%Ÿ¥õøÆâFqÏÁW«Î†Y8Ø4s›WÌ­*Rù8è…¤,Ó¾{@sJï`¹ŠQ3ptØ:ö˜K‹uóB@qÛ–ësõ2²ÌåÙd€9pºä}›DÔ0AE¼¼ÜÌ£²Ê4è ñ‚³E·ºb[3ðÖã]]ªà±:©½Q\ q¤V¼Sl­¿&wkWL³¸nãŠÓµŸƒp²Ýì¢X{d[¶®Ú\ÐÎe4 ¼p ¹¨ÏÀÎåO:>¼I¸Õ‘Óq6ÃæfÜ¦+"¹3Ë½‹IU{,ÃþÉÇ|#·­»r2`Ÿæg4V>ÀÔÄ£Scö lç4,Ë:«ògéµpL>ë“ÑÚ<õø˜$Í†€ÝgEôy%þ3_>h‡/úÊaÛüUfkÑüámó¿„SÑ$­°U O0À€Lµ°ìÐõvš¤HÎ‚h‹tsËjƒÚÄ0MBÒ½­<Ðó¢~3ö—¡•p5 æî1¥–øªÓÚ×O„+'Oë{X6µÀ„A¦n&­/G:Z›bösë>Ql‰å4ÆTÕ~±Š Y Ð»º1÷s?k{?(ô‹4ÏsK°	ßüº_‚“,« ðÍ»ÃàB ñ¥ÉK<öfl78Zz¬,múÜ9[?$|Ñt Ã?æ­T(J¡&3ta®XøüW¨ã÷aÂ^°h„MÉÔ²˜AX&ÁÍ‡£òIY_¡Zw‡˜aÅ:/ˆÖÂ«Õ0UpìDÓY/Lë¬÷âQ?ý	xý€-&¨‘À(xë¹ÌÎ—²!Enq–>TþÝm4ÕÝ†,"*â —ðû*Fq`¡ZQàCöýˆ¼µTõ\ŒàíÁãK08d€Ýó¾p|2ìÓ½Âku5W}ÏÎIHõ£Å!cÒR>!0í’lçQqÎHN´•ÊSWd¬0éùsâk-ÇÅ~û³àë:±‡,%öaÝ‚Ù7Úü"-67 
C½TzÓ–Ù»ËhªdcÎ–'Îš«+Dk úL!S¬ÕÁ@;PìñÆV ¤N¸\$W–už7¥Âñ'Ž‰³±SØÃÃxÓ¶ZM[.¤£–•.bñelIRÞ­åÈ¾ªãÄËºø¯û\Im:¼LN5·R\†}	mï3”YPDqÈjÌðâN{z/‰[Gž·HõNÐŒÒÎÑ0¨Ü(Üëèt?Ç\Œ˜,ž3|®s›&}ü¼˜=Íö ”2gº9†bö½eÚÌÄñ®u™òì¶ËÒžWnÌD³#
lœaRæ1.nã‹M®·A\‰¦Q{¬0U…-4_!J-zŠOŠÞào½éñÁÚ‚ø¨‰œíZT<ª7Ð÷þ}ãp¿ÚüXoŠ_ªÍƒÆÁn]±Ý‚õ˜¹Õ²LPØ¬ÿŸG÷ë$ ‚x÷s½Y­5ŽÏÄÞá.­Öj !Ö~]GkÛŸë'uÑªïÕ)ÝGÍÃŸÛõm×…¶Ar&§Ðq„ÙÙ`€<HNˆ¤`»†Î>¨jh+Ëˆ$QºE'ñRó23ÝèØ Þ…#ûëb@{MãžÊjc&btA­‹Ýúán³zô¡QÍêvã¤%ê ÐÁvM_ï´£&SOôGêIÈ9Ø)È!øuØH@ÊÂªm=ŠÀjæAÍâª=ÌºêÌšÆ«ôÂÖÈáž ·l­ìe2b½p
L1ûnßÀ/2Ž5é»2ÖZèè‘sp­”o®£ï~õµåêµFúLÔ›MÀÜÕƒí=tnžìÕ×Å/W!I‚ÒîÙj³Dö¢4§O°ÏÙLèM„ÎI":zŸ.`2ñ@£ÌáA­Ž´ÀfÒ9n%gÒ/IˆðäJ•ŽW‡Úe£¯DÇPý–øôC³;–c›7åÄIsOã E,Â~æñµfO÷ÐÒyý vÛöü º_Ÿó€Í{Òñœ7¶çŸ.–L ›ð|çðä`M–h)Èm§ÚØ«ã»ÓŠ²[*Ì6×:><Ç‡‡{_$gð()I[/uDd¾
Š<Mº³!c~‚±?1V@ ò èÌŠ±†EñŸ6cû`|á¼âP¯ó@)Š¦Ð¢ÌfóÔî9$B ŽÜƒAEßµâ€È<VSFLl®"¤1ÒC¡eº¤U‡Gu<DÄ‡Ã“¦G§Ž³ù3C0I‰!÷Ýöx*ÃZH%¥ÔIŒ˜¡É‚žè0B±P&9PÊA;“%¡¤vG—m’J9¢Ã„I’$lÓÁõH€t4‰@ùr9p Ä ê‡(‡æ´GH˜È+âX"úƒçWÓÃÑºb•x²uÜØÛ#ˆŠ5¨9AÒ |²ò6€Ãm§Þ¬#=AJ¶.´zÚŸ!®ÊYYÑµ´ë0î0”i‰ŒÉÊ2üh‰•9·ahÂèÚ‚¨$J°˜°˜)1¾¼Œ0 )N"Ù‚F¾íþ¤=¬ìÀÄ:è16&ãäãI4®ön¢3Ó›_ÃÁXþ´£ãíÒ>û°G@¬IÐ/'¡bZu6#k­c“¥[LøùÇ¡¦@-om;Þq[¿mA/b§ªZ…«xÐ#“æv¢Ýx`×U;cü!­7Ë;ƒm±SÝÛ{_­}„Cî>¨×e°=:¹0Ÿ’VbŸC¸Ö¬'Ó¢•Âò‡±¼jô„s*”ŒBÔ:ÙÝ­ÃïêÁ¯Z½Þ¹³ÐPRq
$ìñr'¤$HÎ¹ìþwSFuö-6Ö¸%EÑe 0k@Î0é,	…˜´îÆú•Y¨qƒÁ»5 Ei_É¾Fi_y³Ø–Rãmè5”¬æU† ¾JÎ˜ÄÐ†Ý^Öát”’S2.õÚã€V.mÜ÷“)GÞœ$2}•™K§VäYÑ{eÜÍW@P°+Á/¶VÔ1åzìqI6×¢@ÿeÂ4$ÿ2Ø!oGÌ¸ÒÉÐs>E'¤9aÅ5¬PÞ`vLà‚È­¯”¥Á¶Œ#]¨ª°,Rr\¨B#¤ÌI~ÇdtuVä·Àâ›âH¶fÉU”Ó»ß^=–_U’+ÌŠ0DËP\“ÕyíGV¥™ð•oãÉ çó`8¢Èp©=3ð¢½PÆ!5'Ô¡6:¨;¾¦.AMð6‰ïgüfJã§â„j%
MØÖZyIšäH<§¾ð¦jA_Z‡øÃ:sÌìÓ€²OIÜÂšŠzdÕª[´
©Þ$Å\?8œðHÀ˜ÙÔ;ËJBe¶zä³É:ÌˆRñu©<éœÃ]DÇštà¡™<Á¡Ú–õÙ€¥}Ù¿š–ÑÿÔ`‚ªˆ•dì+e8˜ç›Ü½~ØSæü
†”Z}d¯5f`Ö‹‡Ó{Å` :°™¶—Oî†xÀ›øøæX¼~SBk{ÚÑÿ÷?_¡7/Q`RÑp6TÖú04˜
Ü–‚¡I$•Œƒ¥Š:.ÑãDz'HBŠ¥»åSa ƒ÷b„zƒBuþ‡ù;TÉ!a!º†ESéi3=fÜÄ0ªIÑªgù˜(ðüru§¹í^bqò~›aÇ?Ïºtj^æo‚•m>ÛE;ÅÕ­ŒÙ¡¨3×V×WWEu$Gþy´Ÿƒé­p¼ü»mŸŒtiËÀµ£çárr¬;)ûÊ0ªxc0KŠ{°èÀÆ{*•ÎÚtxTé4GŽøœÜR}Ò'~oš N^qy`áµ—¯€2¡¿P¬1é#Ñ†ã 
–ß/WúÉ¼¥Ìäk«oƒŸ^¿yk^Û¢ì7x9}ˆ¯ß‡#_Ä¯]5þüñ¯k'Wå£µvëuóíZçU3ùüÓ°ubÅ‡•äÛïö*¾4…nƒ¨W1Å	Í9ÞI9’D5•±«k’û‡:&é.Ó›;ö·ˆ ¦
n,D$ü±†[þ}iÜ´röÞ!lÈØ	+ê:—Ó¼§®u“»äQGÉÕÉè«‰*wd4Ù ëVWËüj[¨›¶T*òÞ[žO[ŠÒÙ!ärßïyi/IP³<êÞ·:t/LÇÛ’Y¡uNº«#ìPè¢ ÞqÃá÷ä‰òG7ôéDu§rìdyD»ÇGR£‹Šx…w'üÎ¶×5ß–õÒVôyQ¶ÇB´åîsž_ÙÃAÚrsSç‡†ióæÎøKNâ	ÐÁ‘D†5'gT€ñâÿ'dÓ]À‚aê:Ó/ay)§*o¦^É„>ðÓ\ZŽÆ@Üð›í¼.òøêÍmÑ4"Å·…"<á4+ëÉ\BÞ%¾z[’Y6QáeI¼S÷s•ÊQNÖX½ØdLãMqÁ„MØû’ƒ[þ7Ó5¶.0´@ë”¿6 ÑÌî«B4çžå?..ƒ³¹±“…“ˆ»Äš÷R±åˆÌâmåGy°.càd‡xpò­r¯›nÄ†-+våë—ïrEÝyV	Ê­ú@™f½uxÒ¬ÕÏëùP‰¥¾K[êPíý¤i§¬ÑéöÜ	ã	Ué`½08ë‚ƒ‡KÐe:ø¢!ª(0¾~ ¤¿¼ #5Ö¡ì&“sEÈ¶¸o4;Cå”ò¡^ÔpC§­…SÉüÈW¨"Õ¶iZÇÎQº¤ Bå`'TÁ+¬[ÙÀåé³ N‰¦õ*Ã
8XÊ!9È­à	0uFwlÏVPa(©Ó¤{8­u‚lüÎìná7ó Ò¥É\p,Äc]Uå_'²úÇ{Š¹eeáöÄÑ)§­ó?ýice¾"y4ê»öéÅÞíÉœžR¡¨Q© ,~‰®£1ÞT€;¸ÅXReé†âT…¡Î'…ÚQããxCM$&Áª¿Þ±y´Ô•a/ã/èÖ%û¡¶.sØ›Ü‰äHdÌ‚›„—cQ•Ü}6 ©VL9°ÿ·ªcr¾EŸ‘`|5Þâ`g›Ôú3Ë#úZ‡o"L™£6!)‰~‰7—A^âÉ&ôY?™ð¯M¤Š)¿ê¡8Çb%(Es“êåüY<‰`-6Ÿ[æÈ:ƒ·çs[äƒíØ¶æÌò kÏ.ØÇÀ?\‡“Ê[t½VàéãÔ:$ªtoÛWƒ¨Â…ËS.]~»!2Ü´³C&ÌS®ZS¶Uá9à–Ä¶·E7¡SÌõß,ù†EqÓ¾ÖHÛoÛ“vÄ(¥È“áNÐnxTv«uG¤øÔ•vÙxi§qfªAjêS+ŸßÜ›R/Åk’¶Ý
X‡òŒBåÉ§€®‘²Èù~i3U6Ã=Lº÷n:Ã¤c)˜Æ=T{ØQ&¹ïl7Òenò(N¹ºÓ¸b118î…`NÍ}pjðE;DÇd/=¸YÆ}[u JïAN¸f—rä!÷LjgÁ¨LÊ5¾›Æ	ž”Ú¬=ÅX…ÅÌ±ttÃ Ç×B)¹{3¸"y9ŽônF}Ò>aÄðdŠ¹YsÜ8þdÄ†ñˆrP¹ˆõ©\¹*Eü9Ž˜©8ÂÜ™?W¯Àq€ì]$Hi®_SË(g†fÛ¡ß¶ïÕ !ŒgÉU!ÝŒ<nÌ*ùÁ÷…ue"@º‚>¡æ-`ñ¢Þ&†GFô›_¤[Ñá˜ÌYâOu™@z£+HhŠÀgÌ’xÀ@ø>ï6·i“$æ3™Íôƒ§(%.ñIü2PüÚ.yZRx!n™±`›©–kqÑE‡¬%ä/9e‰yð¨½—÷»áÄ¹&ôÑ£—rÿÂú…
l€v”KíHšµ[­îQ¡¼¤dp#I¥MäUß¨°e84ÑEz·#VÂ$
Ð&>ô—é}•næ¥’fœ¸D2Ö`‚2QD¬hç Ó¬²Ê\ÝrB}!
.ày ”n™.C¥‚ù
NEiåÎ.¼ž/#Î¬%‹k®ç~ò–s £S€árR±%ööös(=˜vApæ(Ù›¾~™l§«gþ:ô¦î‡Ó¶<"u•­ õyaýÚÕlt‡[ªŠÕŠ,DñeN#ûœ´NÉ.¶‚Kåµë’V²øÅ÷¯`<õ ½Âçf—üKð÷q?OàÂãÑC%0q>Mï—ÒpIÁM›|òB7¼Éý³GSsg~±ñ£JiíP#—(/rJ/%ÃÆ¥¸ÅÜr½Q^Z?±‘¹B³-ˆÈtŒþžh…Ç$…•fƒNê´ ¿RBÓˆå9-Ù}vÐã‰ìÆa‹úh§–žó‘ Ë)ÑÉv…/€¦Ýd•¬›0@¬ßÝ­Ù™-æf	•×VŒcžmÃîˆžM7;Õ{–ÉCè;O³7Ø‹'áps=;j	€¦ûç—Uî+#;ÌÌï™Ê;/ò˜œZH¸ó>‘òDË÷’†KÔëÕUúë–2AÙoqnÉz
tö–û7µYÍFEIÐúf¯¼Á9‰Þ¢6ÀÍ.<ûZD±×÷[Ñä•6Ï¨qz<Ãñ¤Ø*WkÕ3D±-Ož ûÀMsSÈEËæT¼çªßÛ­»íÝñáÍÉ´?ûÃe½3î“µFmv³sóçÏÑOÛû»7ÕÜâŸºèØ”Ní/tCôz5\}ùS§sù.ìþôúÝ«—©”ô>š‹V`¡–é©ayÛz³¶H*ŠÌŸu?£bâóüÙoËÕÜÞ-mB>ÁG©4æÓb¤ø¸ž}‹1É+Çð„âTh‰š¬³ÜsQ"˜ùìÓ@yÉ Ÿ2/¬Í‡e²Ä³©æx1DïT|+ñ¼ð’w‘·¶&]¶ ž`d\½/ìÓµøÒŒnñ{×x?A'º7_²·©ÔÒ}?ƒ÷ÍêÏõóV½Ú¬}ÐÒÝ¸Â7lÂÞÚê=Õ‘…‹?h³°"·ñwêŽŠKqÐÁæe`SÀÎ–ÆC g4AGù}ÊG‘ûK¹5ëh¹¥|_‡h¢ Á³LEø-;_28‹÷þè[vÿ®Ù#&ÝâV€«•è½wNûÔŸÎeymG¢×6·`£ó&ùQ›œ7æ·nðx¸œø
‡.›¹%ŠqTøM;›jó,i}+ªÙ¹RÛ [†/VÔ½DÓË…¬LŽ(ß¹H@Þž„ 1£–˜ðSíi„79ªú×X|:=ýÛ§³³çŸÎ*}250½¼ÌìóF¦Wa¢Mÿ±‡â’
§+BÅT¯°¶b•VÌŒÝ&æªét&áM$“VT`Žä“DC`M/ï$¡ZÒqåSò¼ÐŸ|é/6êé\O¾tÚ×íIQ™U˜¡¼ÖsÍ½ÕVƒ(áw;‰Ôo4Öäß¤¡ Ç%Ý¿ÀîGPÿ–t:]P›ý”¼Àâ(Ýõ_ø†óŒ×Xä8<šü´Í4Ÿ±Ú%Ã+–7*ùÇ$Dg‘ ê§Diçé*’Œ0DLNÚ'*óÊÎ+ûÑàú2J®r¢ü'c}®ßW¬NÖ-pÅdAÔYê¦‰ž'XJ^TËIS)©Š™ëY¼Åè~Uê£þ F  @ñ[–,fèÝ§úzv.ö§ÎM[W•¿ÄIOmtûC Ðþb,Ð,Ø¥~àÙcòzÀ¹ŽÆhJï–t—¼Pk
­hâÔå;×ùÊ
æ©Y¶—lG“cPµbŸÌ‹†E)Mâø( L{4EÏ££hLÉ{Š+Ìh§¢X‘}¸èÚ»×…7Œ%t4¢Rqˆö M²sâåJÇÈanƒ¥-mÈ=_ùþË_•ŽaËº&ì²²²…=0M±‰EÐ‡Þ†®ˆóÀ(k<3R§Ò©Åó2å¦”¥ªFœ…)Îœ”iJÊCz]ü¸™je,þ_±![O–ML" ¾Û¦yé!ñ»º,ºé]ž«`rÊúO±†”w”ÀƒB¤\h’4±œ‰Ù#n}î‘.^YêÐYÃØXwl›@»Æ2„ˆ·ÏäQÎ©?&è\o¯9†ãgŒ6˜SZiMAåtŸkó„§÷ÖŠb €¥E•À€ä ¯hÁFqc*>Ä¦$E8ÄÃö5ƒÁf±U`•°G;m¼*·IÅ¨,‡‹Ìð!#ïQ»sÆ²—´pÊ¨‰Q8ñ9íÙ6µj™ÙVYIšyØà.É	”„¿’
8n‹kšÌÜ8ˆŽö†éÔñ“Ð.Hå²‚iˆI“*ä­BÙ1‰Ê¬ÉJ·4_Y¬‰´^Qi xè3ö§[Ev„Åú¨G
×¥©r°B9‘`Sæ¨Û+)î!¾KtOå‹É0KÃ>xL€RñlŠÖGQN“ý~ÓÉ\äÖºPG.wdª×Ðè*¸j'’èºL@—L²ÐèË¯ ”5æ Âú(A¯feÉÇöˆlÂÃ©‘ Þ„è€Ç£ãubSž,SAÂ23AU,+AG–(pý"lWßmµüäC,ÉZ"aêÈ•ë¦FÊtË;JÅ‰ŠI»m^d¢Å|äæÄ–|¹.^Z#3y…·ÃroÆöÓ¡"v™¼h$P¬ñËƒæ„³…,—^u¶`íäË¢Ã¾Eá!°Œ*	˜xõ³aµ®—xÓîˆãç:m,¹–—Ê|tm.Ø†]ßÄS’5ëé¡ŠÊÙê™ƒr
A)9 J"ÅÂ-Î:ü0¥^·òÇ2µ_RUaT¶v‹núø«-ÜÙ5Uf‚¹Reœ,‰lØ	­8¦íî$N”‰œò›’k"í!ç.*I£:Þ€V@2•)ÞH4ºjF™WâëÙÿ3¦ÍFìúHjÍ›0$Š0”ÈŠ¾5¤yÿ`úhßˆÖ"|š/I—æ†"ÚYf®™ëyÀ£¹]%/®Þ§’K;ô„,7è%ôµGá­ŸäX*0ä7ØªO\;xþ@L4ÿTØ…[FŸã)ÂkâÓ3›@Jƒ%\«Vô;2áo6Ü×¡¹å&ÎU)h\±ºÿüÑ¾z±išSÃ‘1K!kð±bT±j˜¡aG°§šjàÚØ@ÚÆ¦˜xhsÍÙôôÌL„¬Atž3Î …;‹ß¤a?;ØYïÑ bp'M*`÷¢³ôLB†€¢„a[22—Å¹ˆ}îñš™ÜòÙó¯È¤™G:ìûäcú8àfÆ0û.ñ¶?Ðxå¦+ÆpÅ I1Š±ùzãÇÔ²‘#Ù
H…AU¶È2”Îïœ[ý[-K¼Ú­Ùù ‡,Kt1Ç¶äûmTdC´5ÛÌ=n*r	{'²‘‚³‘þÜÛìY…ç”î—¿¥î
xrïQŸ›Ü÷"ÛK«ûVØ§À…þ¬i$0ÇŒFÑ³YQöèªMY5ol›"°ª$ÈDò'#‰÷ìÎÃèÕÌŒÓÆ’©ùÉ±l¸Å,ÉTþÉ2V¡ÃÀm1sæJ­g¦t{Â6Žûfø~%ˆ†2˜mQÇHˆÆ†KzõØUg›ª>v²WÁÿ‚Uq–ÇëÆî¾ñ¶m~ÊìG)·8YehF”Îïá;·›ê0‰95ÍŸ¥ö×±­ÖR&l‹6Ó§èƒ[Á!"q_yI§ˆµ&'©øùX4 àoÃtvÓRÉOF'ÜkJ×/b?þ=Ú•7èñK4êÅ·‰88k«pNðâíëñùíë¢ ¬u¿„Ñ´òæÕ‚WoEáã‡ãý½‡¸Û»×qQÔ®àd+k/¡üO´Ú—íI$«äü”!Â¤ý ÐÛ-z hÐœ’»¸Rñè0WÓá@ÃDC)ålaÕxJK†“(P (`~QgŸòC8åNåMçÝf.î¯{—;Ëƒöt:)äåÉž÷["iš+f`º5É´Œ’¦¦‰M[…’Ë=UQU,Ò\’n÷qªìÓ(J—»d–Õm®@4YÇÜ’)°ÒtSå³Éa>›\ÉAn;‡M.Ëí;ÿdÚâe™C.ï
÷J‰ÅLÊüqX¨fïx$[ ÉLÃNÑVÍ@JÜ@¦2^/ÍãalFu ¬I¼qÌ‰vžh¬íéåàâãQÏˆNÒŽ—nß}X3š/Tì.ÒèæÞS–œ±=Šý'¢ÿEôG`ÎèŸžÜ‚êŒ…úT‹+Vã„¬ê›Z÷sMðÿdfÝg
LzÒ!àèÍ&:L¡ùŠ‘‹ XÕ(Um••T7™S Fƒ‚«Ó©ˆ7æJÌS¼˜àùÅ5u§O5éŽ÷ù}
DG7!‰R—JËlòÅ+\•ºˆ`P»
ÑÆìæ1À*Y/(:e…3F#y¥N´VA%1š¸7œ:f	—ÍdùÝ Å×Sƒâ+‚I@Eñ’À¾M¢ßie™R4²âÉŸw¾¹¬p†(Û#-aå¹ˆ™<Ôµa„x^!ý!Þ²8êÃi˜LË_¯CÄj{¬)DOÃ÷ax)šè?ê£ª	mnÄ.íà£	U8m“Ïàn»üZ1†¡»kña?
­Šû «µ;ík4mˆ|sÇáµ8jÂaGöVODúŽø€‰£pt’£âîI³º_ÕVu_ìW-ªÐÇõ½zST÷ŽN>Viõ÷{Õ¢VÿXoR×:úX†ÿÅûêÇÖ!¾üøKý¸Q=»‡ÍúÁ®hÕ«;‡‡ùÏ'-»5èá}õ`÷PTw¡›Æq}ßì~<Ü­“FSÕë4à_ah»Õ&‡arÁÚÉ~Cur\?:9ØÍ±ºÅ¿V¾uwãÔäêGeyç¤¾ÀƒK$<ÀgŽås67-›kR$j|áÓ{,<_ªˆ¾°î	¨3l0½#R¾ýÆƒrÁñÈ´nÝÆbyHfä”ñM9Y9h†émŒuJnóîÝ„s/aÕç´($U[ò† ÔÁAœ[º&•×° œ“Ã=S0ŒxG…¼®òÑO²éAï…ËøðpÑîO €6å(Å2\žÓÜç²üVŽz¹3T(«´€eTTú¦èÜ"¹þ î´ÚtB°²4ë¬ßQõÉÅAÖ2GQŸí\¨ºêNNu­3£	uøY‘›ÓõÔ!d-04D×]Ê†Eç»š—!ýômU-ÿZ„‡½Ê›Y@ö k
­ø–	™èLÐ+†9(ì‰Î…]T¡T‚‹’È¦Ø²>¬S8ûËhöä¬WT¥EËÉr%‰|òÚJ-t¹\$™ñâBñB$W4¦ˆ^SÎÂeôYHW¨±2!c«pB5ßsE2³H
€Lý¬¹¯+‘ôI˜žÁ–“çÆ†”·Ê‘'€hm/à/À¾ó–€ÁKo¿„ºãô×Z7éÈh3U={K\ßÃ*'£ö8¹ŠQ±Ü½@6_Š
ÔH*¦Ž°Q<êÒ·˜üÇ#ŒJE·Ö]˜C«-Ù¨r72@½=‘ô†àëÎÃØpÚzÅ—yÊ…ÏzU 2Úps0åÚÞáÉöÎ^µY?o¾<Rû(S`Áñ¬Ç0 ïÛIªìÑÉû½Fíü¤¹WúñB WPÚÅ˜î#@ÿ=3uöCž¡¼`Æ–Esãá“Û‘  åHwáC»„uµÅ2‹É¬Ïkýÿ!¸Ö-=Œî|ý{zc{Qƒ“~òyêìEsb¼ê?mK,¶MÈÖz*¯‡•_÷¶‡©ÄsÈ¿ JŸ„$¯C:ÄË$àf[ #dƒÖ|^ÃHìÏ¨Ä†¡Í&	lÑuryu$"‡çBÞòpÜšªê:K`£u(#ß-ãøõ€MãËÚ \Æ>„Gm4R°f«Gtaæwþô^¯ÎìÌƒéçéEš3ÔÑ%GŠlru{¿q€œZ¢þ—£Ãæñ§Ñ1YŠ*öµ.0 Q0°ãA	ÕÙ:Ùp.J‰Xœµx¢±eÍ1XÞæcÿpd=_ˆ1ãNó”›Ûü;¬èíÎ³€'­ªl)X„Ùôò''æ™	%1æ(VÛR`Ø°˜œ"Ä›¥ ª‹'iž‚€ØOƒ$¸ÒÎÒÕÍ¥›Tƒ‚éðPô|¼KœÜM[xëÛ¢zì¯Ž…ŠsQKã®Y”ÙÐÆ½Y r9B–úg¼;<õ!§9åäFDçÐò{
[M\ÁV¤\qv u£aIxƒ;Îµ­Voî`µ¯‡†)’ùss%õE
#ðÉfÎÔà$ž.Ò1f5àüPˆÌàÐ0e
NN9àð€–nâÁlšPÀj
–Ø¶Ð&ØÓsÄ ‹¨G|žã¶\ËÉ´³0VnDôÔ‘ä<ó-så+T¢2Œúh÷’_¬lIA]åq ŽŸüç2µWæ¯œZ[¿µ¨·ï–ÈÕù~c·YÅäcç­z­Y?ÆdWÈÇ=\Áþ´,ûzuÍ`þdÔž˜?ÁÜ~yï×Âñ#ïmZQ¯`DxzX3êu– có;†M9	<[D!ûHÉƒì±‘÷IÔs5‹zÖ@L€ dÍ;â‰ùØÏ/‡XzÀUE/sÐcG’ODbÇÈ	*‰ã’ùBÅ bJL;*é¶1ùÙ`@âeíÆ\º”Öê¿þíßùG„iñº!¥]ƒî€8êœ1çpVSÁÆÛÇûh ÚFu6F«¦E¯·ã®ý–uúèÝ;¡h˜Ö'v±’­2ÉfÕÚ ãýö¸ÆqéÙeI7Ò›Ü5g@¤Ÿ0:ñ¬ÜÚ´`0,­õéa,ÁÁ€Czò¹|1èÅÝ‚^Ý"éRŠ)d€v$³´|É_ûK~G2‰¸&9.†v]>=¥²+Øë “X“Ó³®Ç°aœ!àç©ç™{ã6¥î6UÙ@aº¥{¤|Ò¦²æ†H¦Å2µ+LTÚãëËD‡rsš£…Ûá\ò›â4ßÑ¬‡Fºp&6z	æú•/uÖÕÔŽ ¡¿ï’¼6 ± ÀéËÐ¿Çtk_âà
zq y*§Tó,#†#ºõÜÞÑÑƒ»bn_Y}GÔ±×žwÄMF¤D1a íí»]·1f™¡þFºˆY
CDVòdn /LIsK¥¶,yCá–4Ùp#Ò¨ÀV’ÍcEÛ§òô°k^‘Æ/x.êÜEì\†¹—4ƒý)àk:²ºpKú˜Â´¤(É…Ú“ð’¬×õîmšô}éÇ‚½M)Èõ@0nÔ”leE2ë’”8Éz¯)˜=$ŒÅX3eRÙQÄbº<·šòí*áÖ@I› zÍAQTÁP6¨…”33^¨ÔµËâ=Á?HSàkŠžXE–b#+æ³Q#Gþ¥F€46eêçÀßEs,K‘ÓÏwöcJûí¤1TMOa(c1z¦QOm›(dÙ„8Áöµp!'ë3ìK}5òûÄ*£àËEói×Œ%W'Nluÿúäpò]	y8Î€|„ñÒ|É’ |ÞßÔšÛ¶Ê²G:`Ì	5Vd°µ.ÐRÎ]œ ÿÒ0l£CÝÇrZÕ^tyb4†Á]9‡äYQm¥'~oªÊ°ò÷/Sp^™×¯aÅ÷kj˜+¦=:ïÆ“ñ,éÎíÉùUGÝóþù€s½‚°€Û/7ì^uAÖÁL~(ü`³mŒ81ê•)p|Ü!ðŠ*‡®üjíV	PtÂ¸˜#ÎcV”LçCúc³|"cÐç”Ñü91˜Ä[‚J@–ÀDq±7AŸ ì:˜so†·ÉSk h‰†¥©Ã_¤–H8ë@Ä~°Ô›JìŒŠ08Z8N‚´ÖƒŽÆaY/1©ÿ)‘}‡Dö¿PZZ ßð=î:áhIµM7¬õÉÄŠ›HB@J9NvŽÌ»¤#¯,±ÎÍ^Èc¶µKV?ŸáÒ’!9Ð±¤¸çí©©þVÈÛõò%9KQƒýJñXUóh¦žÎÝ6{Ì Ý vñê.‚ä±?©ƒÛbp/ÂÓž§X_à@l‘5(„ç¿1î#”á>É½¸ç¥|¤#¬„í©Âòr$½â¶á³¦‘Ì’qÔâYÒè¡"s‚–·•¿¡"ñPX\¹âù§ÞýÚji~~Ú.ÿ¾Z~wvÿ¦ônþ´b£|JöDM-¢KQ‹E´u=Øxº€"y)yl¯¹}$œ=ïå6K?Ö[Œ«­L“Öu4ã§a¹/;°>9±µv§Œ˜TãŒ+yàpxM¢¸H³–¸RTNY“ýQ¼,’§–Ç[òÞd‘§0Üî0(˜†0çö*Æà¦pTÄa‚aSÑ›”-ÕÛ¢6ˆF˜²Œ†eJ4)+Ï²žiÑ'm>mð`'œÆû6JØ¨Œ.w•2][XlCxôBd½%ÃÀAÞ„=ÒAv‚€áà»Bx«ŽtMË¼­*¤Q0@ã‘&*Š-±&`e7¼Ê*w²+OŠU‘Àb:r½-Ó;[2¡orWÒ€Ò%‡¨£ž§ ?QwÆ˜×ó°c0ãp	J):¢¿K'Íµ¢Æ¯…ß0ö¸ÛÐ©¿Àí†n"¹ŸÅÜí‡Ö¥I¨§åtIs¹	Lˆ&CrÌî 1W»„©ì!TÙ‡=Ô0øŸôþqv'Š‡Ãsµ¹tkTé‘É•4Y÷·å¤}C(	
mar#¨mÉµS`É¾®)äÌ}¼éÙ:”÷B—•üÓæü‰2cX<\ýJI5~S¨ˆ˜€+pØ@Ñ f˜@WÂö%ä€“Ù<â:tà/‘3¹F‰®·ÀónˆËA»¯ÒCMµYáþïzFýÀiX7Ÿ+cR…pwø×˜Sµ®gC¦Dœ1Ô•…n0e´|…H‚øªPäÁÔZh”ãcúÏ£²À]ôh´9vÐÉz-ã«<ð3c·Žac	Jõ© æ;€Óy˜³Â?Ë¹+*Á\ÀÚà~Â6sµ¾ðšÙµ 'Þ‹8.M&¼¸Ž<×ldæ>U6..­X­w[z™/ü´-ë)L%Ø1dFŒGMìŽËƒ4Èf?Ò,çœwÑHÂHÐ÷¿DÜ¦—Nƒè hØ&yðk4{¤&u_²½ˆyO-­vÛÉûY4˜nsZ×öÂ4£Ú†(³c€¾o9>ÑRdÏzØQQ£ñPPJ¢•¤žî[i|ØkS¡	”ï…7¢0M>)Å7‡¹¼Æˆçö*Q>aà
¨‘
Š\I4%Â
$Þ]“ôo¸,¤§'n-‰¤Áî0}x;ŠúÈå%"×™PôÕ@ÃÆ†¹‘¶(?‹Ø¤U²eãCÌC÷sã¸ÎáqÖrp‚¥JÁLÏÑeØ½ëÂsYBÅaê©
 eÝ°÷p¡M<]¥ð·/§Ÿ>UÎŠ £ýúò´X‘\ÑZI²\FgUŸ=ORÓQõ9aÓh§8žža\/4¶ÀÄ2¦Õ-‰<äå¯Î±üÅìçŒ»O©®)üœÍ?e:«áx ÂÏ¤Ò¤=u5*&PÛ?Ï4¯Ò;Jša<—Íe¿eRª¨iµÂ¬Ë'DS~“‘Ì…ÀäXá£ÕöZÐ±)Ù…¡_Ã¨×„·ÀïSä&ÓÿÜ"ùqšEýQLÉOÎ!ÿüy…ÔqçhPN6¤çÄp½É—R¥Ñ’ÊóçŸ’é¬ÅÙß(œÞM˜ýñ9¢\V_Ã1V°ÞŸ¥©±‰M4–¹z“±Ê7·qÁØ%*
ËÊŠžr2?îüH¹R Ë•²Žo+P¯L\HK@AyÓW’ˆìÐ&nG©Â';²ÿ^Ù|µSÉþUßº0|Ÿ¾.Äáu\™Ú¬ÿ5pý™<¿3€bšáƒ¿Ù¿ökYyèk÷Èî<x›èßÙko8¹Hëör•ˆ.üUÑ{]Óejd§ü…¤‹H{úQák¿ÜŠû/%)Ë¸:ñ×‘Z³8ª%·“ü·vZëº—Òt{@WûòfPã”+[Ž¼#ì$ÃQ¥Ús‘/õùä;ól<L_µ}úcùGbã’Û²oÁFñBäaŽþòÄR†ê× ª¬ñ|ÍºêË^zÓð× î#—×Sú]³ÒÞlš<b¦|ë-oaí›t>ÜP%t‘õïÚ7ÖÅ.Ú[ê…œOï¯S÷¸Ù@Xä„«1s%
òéEQ^pÃ›yHY‘å¹ô§s0}Ûº¹« ï\h;s)Ý†}V…iÑñç~Iq=, û^öj¯«Àn7ý.TþfšýT)œVËm—/¿ 6úEqEÒ·¯K…àEñiÅÙa&ØŠÑÆ‰I÷*;)hg†w®0‚÷ôƒ\YýôåY	ð—:õÃ}hF¼"3róU{2.p›~NÎ€ãUIÐ_÷â2šb‚wŠÄ”­ºâÙ´>àíÍÜ,äí»ß¦L#×~JÉ·.Þ¬fšÆ<+ßOß°47´T·V›V q€§h2Ìk€Ø	5Ôè6²_¡EÚÅPÉ›®µá•X´+ù$ã¾ kˆàZFYJ°á/< ÇçU»w6‡Î»Q0LB
­züb¶Ô8äfeÈwS.–ºiO†b6¦KN²c ±CòÄ_2°²5“ppY&s	Í†IÅGm´.IIõgºu‘rV>¨8
&eòÅ`zŽ
€ÒQ¢L)jºnÉÕH‰yÑõÛÏªc9 àfu0Ø–#&¢¤ »”wû÷hË_œæmœ5>¢h¤gb/ncèî§÷º2ÝÝÍz‰ÀlºÃˆmí)ú¶‚šu{^8ng1Éì™²Aç®qÁ`½n9)´ÔN¥n\<ÞÂž‰Ûœ¶_)·Ç9Ø:	áÅxHÒÆcÄÎp”\RÌRË(ò¨¢¦uÑ"£)æ'³ñã¡˜üç¸£a/cÛKÉ¯œ .øM+â—Ïü3aõAWu=Lü=î¨QÜI´Ê Ö*•–IôZðèåj@‹fdÞ:dŒ¡…G#¬‡î0ca$dPÚ#CIJ"'ci¡f¤˜î”çÍIËE-î^JTÇã3±D¤=SÌRjHíªÙèþùé=v!=;ÈsueEZ0j×Áávý¼~ð3sf¨@ :å¢ Ö¬%íHˆ*jñÿ  ÿÿ õÓ;Æ