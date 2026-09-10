/**
 * Live Comparison on Complex Case: Meal 03 Compare Set 3 (2 Menu Pages)
 * Sambal Bakar Pencok 89 - Laminated Multi-page Indonesian Menu (100+ items)
 * 
 * Compares:
 * 1. Existing Compare (Production scout_only_compare_instructions.ts)
 * 2. New Method (Procedural Graph Compare Engine)
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import {
  scoutOnlyCompareSystemInstruction,
  buildScoutComparePrompt,
  scoutOnlyCompareResponseSchema,
} from '../compare/scout_only_compare_instructions';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error('ERROR: GEMINI_API_KEY is not set');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const SET3_DIR = path.join(process.cwd(), 'golden', 'meal', 'Meal_03_compare');
const OUTPUT_FILE = path.join(process.cwd(), 'prototype', 'meallog', 'procedural_graph', 'compare_set3_live_results.json');

const page1Path = path.join(SET3_DIR, 'set3_restaurant_menu_page1.jpg');
const page2Path = path.join(SET3_DIR, 'set3_restaurant_menu_page2.jpg');

if (!fs.existsSync(page1Path) || !fs.existsSync(page2Path)) {
  console.error('Missing Set 3 menu photos!');
  process.exit(1);
}

const imageParts = [page1Path, page2Path].map((p) => ({
  inlineData: {
    mimeType: 'image/jpeg',
    data: fs.readFileSync(p).toString('base64'),
  },
}));

// ============================================================================
// METHOD 1: Existing Compare (Production Monolithic Mode D Scout)
// ============================================================================
const existingPrompt = buildScoutComparePrompt("", 2);

// ============================================================================
// METHOD 2: New Method (Procedural Graph Compare)
// ============================================================================
const proceduralCompareInstruction = `=== PATIENT METABOLIC TARGETS ===
3 days avg: Sat fat (27.7g - 38% over), Calorie (2500kcal - 39% over), Sodium (3000mg - 30% over), Protein (100g - 17% under), Carbohydrates (263.3g - 32% over), Total Fibre (22.3g - 26% under), Potassium (2100mg), Soluble Fibre (3.5g), Added Sugar (45g - 50% over), Trans Fat (0.1g).
At-Risk: LDL (high); HbA1c (high).

You are the Meal Agent executing the Procedural Compare Graph (Mode D Product Evaluation).
INVARIANT: EVALUATION ONLY (NON-ADDITIVE). Do not log as consumed meal.

=== PROCEDURAL GRAPH STEPS ===
- NODE 1 (EXTRACTION): Scan the 2 menu pages and extract all legible menu items. Capture original local name and generic English translation.
- NODE 2 (CLINICAL CLUSTERING & ANTI-COLLAPSE):
  Do NOT dump all meal sets together. Distribute items into 4 distinct clinical tiers:
  * Tier 1 (Good): Clear broths, boiled vegetables, tamarind soups (low fat, hydrating, antioxidant).
  * Tier 2 (Neutral): Whole fish rich in marine Omega-3s (e.g. Ikan Kembung, Ikan Nila Bakar), steamed tofu (Pepes Tahu), lean proteins. (Do NOT put mackerel/kembung in the warning tier!).
  * Tier 3 (Warning): Deep-fried meal sets, crispy chicken, duck, balado sauces (high saturated fat and sodium).
  * Tier 4 (Alert): Salted fish (high sodium >1500mg), offal satays (intestine, liver, skin - high cholesterol/purines), seblak.
- NODE 3 (NUTRITIONAL NORMALIZATION):
  Provide typical single serving weight and 10-nutrient allowance profile per 100g. Calories must strictly follow Atwater math (4P + 4C + 9F).
- NODE 4 (CLINICAL TRADE-OFF RECOMMENDATION):
  Select the optimal dish addressing high LDL and HbA1c, and provide an actionable ordering tip.`;

const proceduralComparePrompt = `Analyze the provided 2-page restaurant menu (Sambal Bakar Pencok 89). Execute the Procedural Compare Graph:
1. Extract distinct menu items across both pages.
2. Form 4 granular clinical tiers following the Anti-Collapse rule: separate cardioprotective whole fish (Ikan Kembung) and clear broths into Tier 1 and Tier 2; isolate deep-fried sets into Tier 3; isolate high-sodium salted fish and offal satays into Tier 4.
3. Formulate the single healthiest clinical recommendation and ordering tip for this patient.`;

const proceduralCompareSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    _internalReasoning: { type: Type.STRING },
    comparisonTitle: { type: Type.STRING },
    recommendedOption: { type: Type.STRING },
    clinicalTradeOffs: { type: Type.STRING },
    groups: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          groupName: { type: Type.STRING },
          tier: { type: Type.STRING },
          verdict: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              level: { type: Type.STRING },
            },
            required: ['label', 'level'],
          },
          comparisonSentence: { type: Type.STRING },
          message: { type: Type.STRING },
          itemCount: { type: Type.INTEGER },
          sampleDishes: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          allDishes: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          servingWeightGrams: { type: Type.NUMBER },
          averageNutrientsPer100g: {
            type: Type.OBJECT,
            properties: {
              calories: { type: Type.NUMBER },
              protein: { type: Type.NUMBER },
              carbohydrates: { type: Type.NUMBER },
              totalFat: { type: Type.NUMBER },
              saturatedFat: { type: Type.NUMBER },
              sodium: { type: Type.NUMBER },
              totalFibre: { type: Type.NUMBER },
            },
          },
        },
        required: ['groupName', 'verdict', 'message', 'averageNutrientsPer100g'],
      },
    },
  },
  required: ['comparisonTitle', 'recommendedOption', 'groups', 'clinicalTradeOffs'],
};

// ============================================================================
// Execution
// ============================================================================

async function runCompare() {
  console.log('--- STARTING LIVE COMPARE TEST ON SET 3 (2 MENU PAGES) ---');

  // Test 1: Existing Compare
  console.log('\n[1/2] Running Existing Compare (Production Mode D Scout)...');
  const t0A = Date.now();
  const respA = await ai.models.generateContent({
    model: 'gemini-3.5-flash-lite',
    contents: [...imageParts, { text: existingPrompt }],
    config: {
      systemInstruction: scoutOnlyCompareSystemInstruction,
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: scoutOnlyCompareResponseSchema,
      maxOutputTokens: 8192,
    },
  });
  const latencyA = Date.now() - t0A;
  let parsedA: any = null;
  try {
    parsedA = JSON.parse(respA.text);
  } catch (err) {
    console.error('Failed to parse Existing Compare JSON', err);
  }
  const usageA = respA.usageMetadata;
  console.log(`Existing Compare Complete: ${latencyA}ms, prompt tokens: ${usageA?.promptTokenCount}, candidate tokens: ${usageA?.candidatesTokenCount}`);

  // Test 2: New Method (Procedural Graph Compare)
  console.log('\n[2/2] Running New Method (Procedural Graph Compare)...');
  const t0B = Date.now();
  const respB = await ai.models.generateContent({
    model: 'gemini-3.5-flash-lite',
    contents: [...imageParts, { text: proceduralComparePrompt }],
    config: {
      systemInstruction: proceduralCompareInstruction,
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: proceduralCompareSchema,
      maxOutputTokens: 8192,
    },
  });
  const latencyB = Date.now() - t0B;
  let parsedB: any = null;
  try {
    parsedB = JSON.parse(respB.text);
  } catch (err) {
    console.error('Failed to parse Procedural Graph Compare JSON', err);
  }
  const usageB = respB.usageMetadata;
  console.log(`Procedural Graph Compare Complete: ${latencyB}ms, prompt tokens: ${usageB?.promptTokenCount}, candidate tokens: ${usageB?.candidatesTokenCount}`);

  const results = {
    testDate: new Date().toISOString(),
    benchmarkCase: 'Meal_03_compare Set 3 (Sambal Bakar Pencok 89 Menu)',
    model: 'gemini-3.5-flash-lite',
    existingCompare: {
      latencyMs: latencyA,
      usage: usageA,
      title: parsedA?.comparisonTitle,
      recommended: parsedA?.recommendedOption,
      allExtractedDishesCount: parsedA?.allExtractedDishes?.length || 0,
      groupsCount: parsedA?.groups?.length || 0,
      groups: (parsedA?.groups || []).map((g: any) => ({
        name: g.groupName,
        level: g.verdict?.level,
        label: g.verdict?.label,
        itemsCount: (g.items || []).length,
        sampleItems: (g.items || []).slice(0, 4),
        caloriesPer100g: g.averageNutrientsPer100g?.calories,
        satFatPer100g: g.averageNutrientsPer100g?.saturatedFat,
        sodiumPer100g: g.averageNutrientsPer100g?.sodium,
      })),
    },
    proceduralGraphCompare: {
      latencyMs: latencyB,
      usage: usageB,
      title: parsedB?.comparisonTitle,
      recommended: parsedB?.recommendedOption,
      clinicalTradeOffs: parsedB?.clinicalTradeOffs,
      groupsCount: parsedB?.groups?.length || 0,
      groups: (parsedB?.groups || []).map((g: any) => ({
        name: g.groupName,
        level: g.verdict?.level,
        label: g.verdict?.label,
        itemCount: g.itemCount || g.allDishes?.length || g.sampleDishes?.length || 0,
        sampleDishes: (g.allDishes || g.sampleDishes || []).slice(0, 4),
        caloriesPer100g: g.averageNutrientsPer100g?.calories,
        satFatPer100g: g.averageNutrientsPer100g?.saturatedFat,
        sodiumPer100g: g.averageNutrientsPer100g?.sodium,
      })),
    },
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\nComparison saved to ${OUTPUT_FILE}`);
}

runCompare().catch(console.error);
