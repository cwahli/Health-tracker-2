/**
 * Live Side-by-Side Test: Old System vs New Method (Procedural Graph)
 * 
 * Rules:
 * 1. Both systems run with ZERO Dietitian (1 single agent / 1 API call each).
 * 2. Both systems run on the EXACT same input: Golden Meal 01 (5 photos, no text hints).
 * 3. Model: gemini-3.5-flash-lite.
 * 4. Records instruction, schema, raw LLM emission, token usage, latency, and derived output.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, Type, Schema } from '@google/genai';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error('ERROR: GEMINI_API_KEY is not set');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const MEAL01_DIR = path.join(process.cwd(), 'golden', 'meal', 'Meal_01');
const OUTPUT_FILE = path.join(process.cwd(), 'prototype', 'meallog', 'procedural_graph', 'side_by_side_live_results.json');

const photoPaths = [1, 2, 3, 4, 5].map((n) =>
  path.join(MEAL01_DIR, `photo_0${n}.jpg`)
);

for (const p of photoPaths) {
  if (!fs.existsSync(p)) {
    console.error(`Missing photo: ${p}`);
    process.exit(1);
  }
}

const imageParts = photoPaths.map((p) => ({
  inlineData: {
    mimeType: 'image/jpeg',
    data: fs.readFileSync(p).toString('base64'),
  },
}));

// ============================================================================
// SYSTEM A: Old System (Unified Vision Scout in Production, 1 Agent, 0 Diet)
// ============================================================================

const oldSystemInstruction = `=== USER OUTPUT LANGUAGE ===
The patient's UI language is English (code: en).
Write every user-visible string you generate (verdicts, summaries, chat replies, dietitian lines, card titles, explanations, medicalInsight) in English.
Keep JSON keys, nutrient codes, biomarker keys, enum values, and schema field names in English. User-visible nutrient labels must be in the UI language; never show raw keys like Saturated_fat to the patient.
Keep numbers, units (g, kcal, mg/dL), and scientific abbreviations as-is.
Food identity fields (keyword, originalName, dish names, brand names) stay as observed on labels or common culinary names used for database matching. Do not translate food names.

- HIERARCHY: Extract each distinct food item/ingredient (e.g. Tofu, Beef, sides, meal prep items, drinks, packages) directly as its own separate 'dish' with its own boundingBox2D & nutrients. Never group distinct food items into a single composite dish with sub-items. Do not duplicate identical dishes across multi-angles or cooking prep.
- QUANTITY & MULTIPACKS: Output 'weightGrams' (consumed serving) and 'packGrams' (container total). For unopened grocery multi-packs (e.g. '5 x 65ml', 'pack of 6') without explicit user notes stating all N units were consumed, set 'weightGrams' to a single unit/serving size (e.g. 65g) and 'packGrams' to the container total (e.g. 325g). Never estimate the whole container as consumed: weightGrams is ALWAYS one serving here — the portion question resolves the true amount.
- GROCERY/SCALE STICKERS: Treat supermarket stickers as atomic: pair printed text with printed weight (e.g. 'Berat 0.252' -> 252g). Output text in 'packageLabelText'. Never transpose weights between packages.
- LOCAL NAMES: Preserve the verbatim printed name from stickers, packaging, or menus in local language as foodName (e.g. 'Ikan Cendro', 'Cumi Bangka'). Do not genericise when specific local name is readable. ALWAYS provide the generic English translation of the ingredient in 'genericEnglishName' (e.g. 'needlefish', 'squid').
- INGESTION: Extract ALL visible food items/packages from ALL provided images into dishes[]. After dishes[], emit 'perImage': one entry per provided image in 0-based order with the dishName values seen in that image ('itemsFound'; empty array only when that image truly shows no food, or when no images are attached) — every provided image must appear exactly once; never skip an image. Before emitting, verify the anchor both ways for images 0..N-1: each 'perImage' entry must match at least one dish carrying that same 'sourceImageIndex', and any entry with no matching dish must be confirmed food-free — a food image with no matching dish means you stopped early, so go back and extract it. 'contentType' is post-extraction metadata and must not restrict extraction.
- DIRECT OCR: Transcribe nutrition labels into 'rawNutritionLabel' for packaged items with labels. Preserve exact 0 values when printed as 0g / 0mg.
- % AKG / % DV: If nutrition labels state % AKG (Angka Kecukupan Gizi) or % DV for micronutrients (e.g. Vitamin D 8% AKG, Kalsium 2% AKG), preserve the % in rawNutritionLabel.
- BRANDS & CONDIMENTS: Set 'chainName' for brands. Set 'isStandaloneCondimentPacket' for packets <=30g.
- COOKING FATS: Include cooking oils/fats in 'dishNutrients.totalFat' based on 'cookingMethod'.
- CLINICAL VERDICT & NARRATIVE: Provide a 3-6 word 'verdict' ('level': good|warning|alert|neutral) and a direct 35-70 word clinical 'clinicalAdvice' in 2nd person ("You got..."). Balance two sides: celebrate positive nutrient achievements (protein, soluble fiber, healthy fats) while plainly flagging any nutrient over budget (sodium, saturated fat) with its magnitude and actionable movement.
- PATIENT CONTEXT (special case — shapes verdict/advice only, never identity or weights): at-risk: LDL (high); HbA1c (high). Budgets: see NUTRITIONAL TARGET STATUS below. Prefer a verdict level and advice that move those numbers the right way.
=== NUTRITIONAL TARGET STATUS ===
3 days avg: Sat fat (27.7g - 38% over), Calorie (2500kcal - 39% over), Sodium (3000mg - 30% over), Protein (100g - 17% under), Carbohydrates (263.3g - 32% over), Total Fibre (22.3g - 26% under), Potassium (2100mg), Soluble Fibre (3.5g), Added Sugar (45g - 50% over), Trans Fat (0.1g)

=== REQUIRED OUTPUT JSON SCHEMA ===
Output exactly ONE JSON object matching this schema:
{
  "_internalReasoning": "string (<15 words)",
  "contentType": "visual | menu_or_poster | label | text",
  "diningEnvironment": "home_cooked | casual_restaurant | fast_food_chain | fine_dining | airline | unknown",
  "verdict": {
    "label": "string (3-6 words)",
    "level": "good | warning | alert | neutral"
  },
  "clinicalAdvice": "string (35-70 words, 2nd person)",
  "perImage": [{ "imageIndex": 0, "itemsFound": ["Dish Name"] }],
  "dishes": [
    {
      "dishName": "string",
      "genericEnglishName": "string",
      "chainName": "string | null",
      "estimatedWeightGrams": 0,
      "packGrams": 0,
      "cookingMethod": "raw | baked | grilled | boiled | steamed | deep_fried | pan_fried | stir_fried",
      "boundingBox2D": [0, 0, 1000, 1000],
      "sourceImageIndex": 0,
      "isStandaloneCondimentPacket": false,
      "foods": [
        {
          "foodName": "string",
          "genericEnglishName": "string",
          "packageLabelText": "string | null",
          "weightGrams": 0,
          "packGrams": 0,
          "sourceImageIndex": 0,
          "rawNutritionLabel": "object | null",
          "nutrients": { "protein": 0, "saturatedFat": 0, "addedSugar": 0, "totalFibre": 0, "sodium": 0, "carbohydrates": 0 }
        }
      ],
      "dishNutrients": { "saturatedFat": 0, "totalFat": 0, "totalSugar": 0, "potassium": 0, "omega3": 0, "calcium": 0, "iron": 0, "magnesium": 0, "vitaminD": 0 }
    }
  ]
}`;

const oldUserPrompt = `Analyze the provided 5 meal images. Inspect all visible prepared dishes, cooking pots, grocery packages, and barcode labels. Read any visible OCR text on cups, wrappers, or menus to identify fast-food brands or commercial chains, and use these to anchor the nutritional estimation (e.g. calories and fat for commercial deep-fried items) to standard commercial nutrition tables. Ingest all visible foods and packages completely into dishes and constituent foods. Audit every image independently and extract distinct food items seen across ALL images. Do not stop after analyzing a label. Extract all physical dishes and constituent foods into the hierarchical schema with weightGrams, packGrams, and nutrients.`;

const oldResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    _internalReasoning: { type: Type.STRING },
    contentType: { type: Type.STRING },
    diningEnvironment: { type: Type.STRING },
    verdict: {
      type: Type.OBJECT,
      properties: {
        label: { type: Type.STRING },
        level: { type: Type.STRING },
      },
      required: ['label', 'level'],
    },
    clinicalAdvice: { type: Type.STRING },
    perImage: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          imageIndex: { type: Type.INTEGER },
          itemsFound: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
      },
    },
    dishes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          dishName: { type: Type.STRING },
          genericEnglishName: { type: Type.STRING },
          chainName: { type: Type.STRING, nullable: true },
          estimatedWeightGrams: { type: Type.NUMBER },
          packGrams: { type: Type.NUMBER },
          cookingMethod: { type: Type.STRING },
          boundingBox2D: {
            type: Type.ARRAY,
            items: { type: Type.NUMBER },
          },
          sourceImageIndex: { type: Type.INTEGER },
          isStandaloneCondimentPacket: { type: Type.BOOLEAN },
          foods: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                foodName: { type: Type.STRING },
                genericEnglishName: { type: Type.STRING },
                packageLabelText: { type: Type.STRING, nullable: true },
                weightGrams: { type: Type.NUMBER },
                packGrams: { type: Type.NUMBER },
                sourceImageIndex: { type: Type.INTEGER },
                rawNutritionLabel: { type: Type.OBJECT, nullable: true },
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
                },
              },
              required: ['foodName', 'weightGrams'],
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
          },
        },
        required: ['dishName', 'estimatedWeightGrams'],
      },
    },
  },
  required: ['verdict', 'clinicalAdvice', 'dishes'],
};

// ============================================================================
// SYSTEM B: New Method (Procedural Graph Architecture, 1 Agent, 0 Diet)
// ============================================================================

const newProceduralInstruction = `=== USER OUTPUT LANGUAGE ===
The patient's UI language is English (code: en).
Write every user-visible string you generate (verdicts, summaries, chat replies, card titles, explanations, clinicalAdvice) in English.
Keep JSON keys, nutrient codes, biomarker keys, enum values, and schema field names in English.
Food identity fields (originalName, dish names, brand names) stay as observed on labels or common culinary names used for database matching.

=== PROCEDURAL GRAPH MEAL AGENT (SOLE AGENT) ===
You are the Meal Agent executing Active Graph Nodes [EXTRACTION -> AUDIT -> RECONCILE]. There is NO Dietitian in this system.
Your responsibility: Extract dishes, inspect labels, estimate weights, and provide clinical coaching.

- GRAPH STEP 1 (DISH EXTRACTION):
  Group distinct physical plated items, separate cooking pots/bowls, drinks, or companion sides into separate 'dishes', and constituent ingredients into 'foods'. DO NOT duplicate identical dishes shown across cooking prep, multi-angles, or sliced/whole views. DO NOT group separate packages into a single dish. Each barcode package MUST be its own distinct 'dish'.
- GRAPH STEP 2 (PORTION & PACKAGING AUDIT):
  Output 'weightGrams' (consumed serving) and 'packGrams' (container total). For unopened grocery multi-packs without explicit user notes stating all N units were consumed, set 'weightGrams' to a single unit/serving size and 'packGrams' to the container total. Treat scale stickers as atomic: pair printed text with printed weight in 'packageLabelText'.
- GRAPH STEP 3 (DIRECT OCR & PREPARATION):
  Transcribe nutrition labels into 'rawNutritionLabel' for packaged items. Preserve exact 0 values when printed as 0g / 0mg. Classify realistic 'cookingMethod' (raw, baked, boiled, deep_fried, pan_fried, steamed).
- GRAPH STEP 4 (CLINICAL COACHING & VERDICT):
  Provide a 3-6 word 'verdict' ('level': good|warning|alert|neutral) and a constructive 35-70 word clinical 'clinicalAdvice' in 2nd person ("You got...") covering key nutritional assets, metabolic/glycemic impact, and an actionable next step/movement.
- PATIENT CONTEXT: at-risk: LDL (high); HbA1c (high).
=== NUTRITIONAL TARGET STATUS ===
3 days avg: Sat fat (27.7g - 38% over), Calorie (2500kcal - 39% over), Sodium (3000mg - 30% over), Protein (100g - 17% under), Carbohydrates (263.3g - 32% over), Total Fibre (22.3g - 26% under), Potassium (2100mg), Soluble Fibre (3.5g), Added Sugar (45g - 50% over), Trans Fat (0.1g)`;

const newProceduralPrompt = `Analyze the provided meal images (5 photos, one logging session). Inspect all visible prepared dishes, cooking pots, grocery packages, and barcode labels. Read any visible OCR text on cups, wrappers, menus, or nutrition panels to identify brands and transcribe printed nutrition facts into 'rawNutritionLabel' exactly as printed (values + % AKG). Ingest all visible foods and packages completely into dishes and constituent foods. Extract all physical dishes and constituent foods into the hierarchical schema with weightGrams, packGrams, and nutrients. Do not merge distinct plated items, sides, drinks, or packages into one dish. Each barcode package MUST be its own distinct 'dish'. For unopened multi-serving packs with no consumed-amount note, weightGrams is ONE serving and packGrams is the container total — the user will be asked to choose.`;

const newProceduralSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    _internalReasoning: { type: Type.STRING },
    contentType: { type: Type.STRING },
    diningEnvironment: { type: Type.STRING },
    verdict: {
      type: Type.OBJECT,
      properties: {
        label: { type: Type.STRING },
        level: { type: Type.STRING },
      },
      required: ['label', 'level'],
    },
    clinicalAdvice: { type: Type.STRING },
    dishes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          dishName: { type: Type.STRING },
          genericEnglishName: { type: Type.STRING },
          chainName: { type: Type.STRING, nullable: true },
          estimatedWeightGrams: { type: Type.NUMBER },
          packGrams: { type: Type.NUMBER },
          cookingMethod: { type: Type.STRING },
          boundingBox2D: {
            type: Type.ARRAY,
            items: { type: Type.NUMBER },
          },
          sourceImageIndex: { type: Type.INTEGER },
          isStandaloneCondimentPacket: { type: Type.BOOLEAN },
          packageLabelText: { type: Type.STRING, nullable: true },
          rawNutritionLabel: {
            type: Type.OBJECT,
            properties: {
              caloriesPerServing: { type: Type.NUMBER, nullable: true },
              servingSizeGrams: { type: Type.NUMBER, nullable: true },
              servingsPerPack: { type: Type.NUMBER, nullable: true },
              protein_g: { type: Type.NUMBER, nullable: true },
              fat_g: { type: Type.NUMBER, nullable: true },
              carbs_g: { type: Type.NUMBER, nullable: true },
              sodium_mg: { type: Type.NUMBER, nullable: true },
            },
          },
          foods: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                foodName: { type: Type.STRING },
                genericEnglishName: { type: Type.STRING },
                packageLabelText: { type: Type.STRING, nullable: true },
                weightGrams: { type: Type.NUMBER },
                packGrams: { type: Type.NUMBER },
                sourceImageIndex: { type: Type.INTEGER },
                rawNutritionLabel: { type: Type.OBJECT, nullable: true },
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
                },
              },
              required: ['foodName', 'weightGrams'],
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
          },
        },
        required: ['dishName', 'estimatedWeightGrams'],
      },
    },
  },
  required: ['verdict', 'clinicalAdvice', 'dishes'],
};

// ============================================================================
// Execution
// ============================================================================

async function runTest() {
  console.log('--- STARTING LIVE SIDE-BY-SIDE TEST: MEAL 01 (5 PHOTOS) ---');

  // Test System A: Old System
  console.log('\n[1/2] Running System A (Old Production System without Dietitian)...');
  const t0A = Date.now();
  const respA = await ai.models.generateContent({
    model: 'gemini-3.5-flash-lite',
    contents: [
      { role: 'user', parts: [{ text: oldUserPrompt }, ...imageParts] }
    ],
    config: {
      systemInstruction: oldSystemInstruction,
      responseMimeType: 'application/json',
      responseSchema: oldResponseSchema,
      temperature: 0.1,
    }
  });
  const latencyA = Date.now() - t0A;
  const rawTextA = respA.text;
  let parsedA: any = null;
  try {
    parsedA = JSON.parse(rawTextA);
  } catch (err) {
    console.error('Failed to parse System A response JSON', err);
  }
  const usageA = respA.usageMetadata;
  console.log(`System A Complete: ${latencyA}ms, prompt tokens: ${usageA?.promptTokenCount}, candidates tokens: ${usageA?.candidatesTokenCount}`);

  // Test System B: New Procedural Method
  console.log('\n[2/2] Running System B (New Method / Procedural Graph Architecture)...');
  const t0B = Date.now();
  const respB = await ai.models.generateContent({
    model: 'gemini-3.5-flash-lite',
    contents: [
      { role: 'user', parts: [{ text: newProceduralPrompt }, ...imageParts] }
    ],
    config: {
      systemInstruction: newProceduralInstruction,
      responseMimeType: 'application/json',
      responseSchema: newProceduralSchema,
      temperature: 0.1,
    }
  });
  const latencyB = Date.now() - t0B;
  const rawTextB = respB.text;
  let parsedB: any = null;
  try {
    parsedB = JSON.parse(rawTextB);
  } catch (err) {
    console.error('Failed to parse System B response JSON', err);
  }
  const usageB = respB.usageMetadata;
  console.log(`System B Complete: ${latencyB}ms, prompt tokens: ${usageB?.promptTokenCount}, candidates tokens: ${usageB?.candidatesTokenCount}`);

  const results = {
    testDate: new Date().toISOString(),
    model: 'gemini-3.5-flash-lite',
    testInput: {
      photosCount: 5,
      photoPaths: photoPaths.map(p => path.basename(p)),
      userTextPrompt: ''
    },
    systemA: {
      name: 'System A (Production Vision Scout without Dietitian)',
      apiCalls: 1,
      latencyMs: latencyA,
      usage: usageA,
      systemInstructionLengthLines: oldSystemInstruction.split('\n').length,
      systemInstructionText: oldSystemInstruction,
      userPromptText: oldUserPrompt,
      parsedOutput: parsedA,
    },
    systemB: {
      name: 'System B (Procedural Graph Architecture)',
      apiCalls: 1,
      latencyMs: latencyB,
      usage: usageB,
      systemInstructionLengthLines: newProceduralInstruction.split('\n').length,
      systemInstructionText: newProceduralInstruction,
      userPromptText: newProceduralPrompt,
      parsedOutput: parsedB,
    }
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\nResults saved to: ${OUTPUT_FILE}`);
}

runTest().catch(console.error);
