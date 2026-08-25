import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { scoutSystemInstruction } from "./server_vision_scout.ts";
import {
  calculateDerivedNutrients,
  BaseNutrients,
} from "./derivation_engine.ts";
import { formatPatientContext, DIETITIAN_CORE_DIRECTIVES } from "../agents/dietitianInstructions.ts";

dotenv.config();

const MODEL_NAME = "gemini-3.5-flash-lite";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function generateContentWithRetry(ai: GoogleGenAI, params: any, retries = 4, delayMs = 10000): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await ai.models.generateContent(params);
      return response;
    } catch (err: any) {
      if ((err.status === 429 || err.message?.includes("429") || err.message?.includes("quota") || err.message?.includes("RESOURCE_EXHAUSTED")) && attempt < retries) {
        console.warn(`[Gemini API Rate Limit 429] Waiting ${delayMs / 1000}s before retry attempt ${attempt + 1}/${retries}...`);
        await sleep(delayMs);
      } else {
        throw err;
      }
    }
  }
}

export interface FullLedger {
  calories: number;
  protein: number;
  totalFat: number;
  saturatedFat: number;
  transFat: number;
  unsaturatedFat: number;
  carbohydrates: number;
  sugar: number;
  addedSugar: number;
  totalFibre: number;
  solubleFibre: number;
  sodium: number;
  potassium: number;
  magnesium: number;
  calcium: number;
  iron: number;
  zinc: number;
  selenium: number;
  iodine: number;
  phosphorus: number;
  vitaminD: number;
  vitaminB12: number;
  folate: number;
  vitaminC: number;
  vitaminE: number;
  vitaminK: number;
  vitaminA: number;
  vitaminB6: number;
  thiamine: number;
  riboflavin: number;
  niacin: number;
  omega3: number;
  salt: number;
}

function calculateDeterministic33Nutrients(item: {
  name: string;
  weightGrams: number;
  nutrients: Partial<BaseNutrients>;
  foodType?: string;
}): FullLedger {
  const w = item.weightGrams || 100;
  const n = item.nutrients || {};

  const calories = n.calories || 200;
  const protein = n.protein || 10;
  const totalFat = n.totalFat || 8;
  const saturatedFat = n.saturatedFat || 2.5;
  const transFat = n.transFat || 0;
  const derived = calculateDerivedNutrients({
    calories,
    protein,
    totalFat,
    saturatedFat,
    transFat,
    addedSugar: n.addedSugar || 0,
    totalSugar: n.totalSugar || (n as any).sugar || 0,
    totalFibre: n.totalFibre || 2,
    sodium: n.sodium || 350,
    potassium: n.potassium || 250,
    omega3: n.omega3 || 0.1,
    calcium: n.calcium || 40,
    iron: n.iron || 1.5,
    magnesium: n.magnesium || 25,
    vitaminD: n.vitaminD || 0,
  });

  return {
    calories,
    protein,
    totalFat,
    saturatedFat,
    transFat,
    unsaturatedFat: derived.unsaturatedFat,
    carbohydrates: derived.carbohydrates,
    sugar: n.totalSugar || (n as any).sugar || 4,
    addedSugar: n.addedSugar || 0,
    totalFibre: n.totalFibre || 2,
    solubleFibre: parseFloat(((n.totalFibre || 2) * 0.25).toFixed(1)),
    sodium: n.sodium || 350,
    potassium: n.potassium || 250,
    magnesium: n.magnesium || 25,
    calcium: n.calcium || 40,
    iron: n.iron || 1.5,
    zinc: parseFloat((1.2 * (w / 100)).toFixed(2)),
    selenium: parseFloat((8.5 * (w / 100)).toFixed(1)),
    iodine: parseFloat((3.0 * (w / 100)).toFixed(1)),
    phosphorus: parseFloat((85 * (w / 100)).toFixed(1)),
    vitaminD: n.vitaminD || 0,
    vitaminB12: parseFloat((0.2 * (w / 100)).toFixed(2)),
    folate: parseFloat((25 * (w / 100)).toFixed(1)),
    vitaminC: parseFloat((8 * (w / 100)).toFixed(1)),
    vitaminE: parseFloat((0.5 * (w / 100)).toFixed(2)),
    vitaminK: parseFloat((5.0 * (w / 100)).toFixed(1)),
    vitaminA: parseFloat((45 * (w / 100)).toFixed(1)),
    vitaminB6: parseFloat((0.15 * (w / 100)).toFixed(2)),
    thiamine: parseFloat((0.08 * (w / 100)).toFixed(2)),
    riboflavin: parseFloat((0.07 * (w / 100)).toFixed(2)),
    niacin: parseFloat((1.5 * (w / 100)).toFixed(2)),
    omega3: n.omega3 || 0.1,
    salt: derived.salt,
  };
}

function sum33Ledgers(ledgers: FullLedger[]): FullLedger {
  const result: any = {};
  const keys = Object.keys(ledgers[0]) as (keyof FullLedger)[];
  for (const k of keys) {
    const sum = ledgers.reduce((acc, curr) => acc + (curr[k] || 0), 0);
    result[k] = parseFloat(sum.toFixed(2));
  }
  return result as FullLedger;
}

async function runIndonesianComparison() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is required in environment!");
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });
  const protoDir = path.join(process.cwd(), "prototype");

  console.log("================================================================================");
  console.log("   INDONESIAN MEAL (MENU PAGES) - REGIONAL CUISINE AUDIT TEST");
  console.log("   Model: " + MODEL_NAME);
  console.log("================================================================================");

  // Load Indonesian Menu Pages 1 & 2
  const img1Path = path.join(protoDir, "06_indonesian_menu_page_1.jpg");
  const img2Path = path.join(protoDir, "06_indonesian_menu_page_2.jpg");
  const img1Base64 = fs.readFileSync(img1Path).toString("base64");
  const img2Base64 = fs.readFileSync(img2Path).toString("base64");

  console.log("\n[1/2] Running Vision Scout on Indonesian Menu Pages...");
  const scoutResp = await generateContentWithRetry(ai, {
    model: MODEL_NAME,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: img1Base64 } },
          { inlineData: { mimeType: "image/jpeg", data: img2Base64 } },
          { text: "Extract the authentic Indonesian dishes and direct nutrients from these restaurant menu pages (e.g. Nasi Goreng, Rendang, Satay, Gado Gado, etc.)." },
        ],
      },
    ],
    config: {
      systemInstruction: { parts: [{ text: scoutSystemInstruction }] },
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  const scoutResult = JSON.parse(scoutResp.text || "{}");
  const scoutItems = scoutResult.items || [];
  console.log(`Scout extracted ${scoutItems.length} Indonesian dish(es):`);
  scoutItems.forEach((it: any, i: number) => {
    console.log(`  ${i + 1}. ${it.originalName} (${it.estimatedWeightGrams}g) - Cal: ${it.nutrients?.calories}kcal, Fat: ${it.nutrients?.totalFat}g (Sat: ${it.nutrients?.saturatedFat}g), Sodium: ${it.nutrients?.sodium}mg`);
  });

  const patientContextObj = formatPatientContext({
    biomarkersNeedingImprovement: [
      { name: "Blood Pressure", status: "elevated", value: "138/88", unit: "mmHg", normalRange: "<120/80" },
      { name: "Triglycerides", status: "borderline", value: 180, unit: "mg/dL", normalRange: "<150" },
    ],
    remainingAllowance: {
      saturatedFat: 14,
      calories: 1500,
      sodium: 1200,
      protein: 75,
      carbohydrates: 150,
    },
  });
  const patientContext = `${patientContextObj.biomarkersList}\n\n${patientContextObj.targetLimits}`;

  // Take the first 3 representative dishes as an ordered meal set (e.g. Nasi Goreng + Satay + Side/Drink)
  const mealItems = scoutItems.slice(0, 3);
  console.log(`\nSimulating User Meal Selection of 3 dishes:`, mealItems.map((i: any) => i.originalName).join(" + "));

  // Architecture A Run with Regional Cuisine Directives
  console.log("\n--- Executing Architecture A (Post-Populate) with Regional Calibration ---");
  const systemInstructionA = `You are a Dietician coach operating within a personalized health application. Provide direct, practical nutritional guidance as a raw JSON object without markdown wrappers.

${DIETITIAN_CORE_DIRECTIVES}

=== CRITICAL REGIONAL & CUISINE CALIBRATION DIRECTIVE ===
You MUST evaluate and adjust baseline data to accurately reflect authentic regional cuisine differences of the dining location (e.g. Indonesian / Southeast Asian cuisine):
- Cooking Fats: Frequent use of coconut milk/santan (high in saturated fat - lauric/myristic acid) and palm oil frying.
- Seasonings: Heavy use of kecap manis (sweet soy sauce - high in added sugar), terasi (shrimp paste - intense sodium), and salt/MSG.
- Audit each baseline item against these regional culinary realities and apply corrections in 'correctedNutrients' and 'clinicalCorrectionNote' if the baseline under-represents regional saturated fat, sodium, or added sugar.

=== PATIENT CONTEXT PAYLOAD ===
${patientContext}

=== REQUIRED OUTPUT JSON SCHEMA ===
{
  "_internalReasoning": "string",
  "verdict": {
    "label": "string (3-6 words max)",
    "level": "string ('good' | 'warning' | 'alert' | 'neutral')"
  },
  "message": "string (35-70 words in 4 beats)",
  "foodData": {
    "date": "2026-08-24",
    "name": "string (Meal title)",
    "itemsBreakdown": [
      {
        "scoutIndex": 0,
        "canonicalDbName": "string",
        "weightGrams": 0,
        "foodType": "string",
        "cookingMethod": "string",
        "correctedNutrients": {
          "calories": 0,
          "protein": 0,
          "totalFat": 0,
          "saturatedFat": 0,
          "sodium": 0,
          "addedSugar": 0,
          "totalFibre": 0
        },
        "clinicalCorrectionNote": "string | null"
      }
    ]
  }
}`;

  const userPromptA = `Analyze this Indonesian meal request.
=== VISUAL FOOD SCOUT IDENTIFIED ITEMS ===
${mealItems
  .map(
    (it: any, idx: number) =>
      `- Index: ${idx} | Item: "${it.originalName || it.keyword}" | Weight: ${it.estimatedWeightGrams}g | Context: "${it.originalName}"`
  )
  .join("\n")}

=== SERVER BASELINE ESTIMATE ===
itemsSummary=${JSON.stringify(
  mealItems.map((it: any) => ({
    name: it.originalName || it.keyword,
    weightGrams: it.estimatedWeightGrams,
    calories: it.nutrients?.calories || 250,
    protein: it.nutrients?.protein || 12,
    carbs: it.nutrients?.carbohydrates || 30,
    totalFat: it.nutrients?.totalFat || 10,
    saturatedFat: it.nutrients?.saturatedFat || 2.5,
    sodium: it.nutrients?.sodium || 400,
  }))
)}
`;

  const respA = await generateContentWithRetry(ai, {
    model: MODEL_NAME,
    contents: [{ role: "user", parts: [{ text: userPromptA }] }],
    config: {
      systemInstruction: { parts: [{ text: systemInstructionA }] },
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  const outputA = JSON.parse(respA.text || "{}");

  // Architecture B Run with Regional Cuisine Directives
  console.log("\n--- Executing Architecture B (Pre-Calculated Ledger + Last-Pass Regional Audit) ---");
  const initialItemLedgers = mealItems.map((scoutIt: any) =>
    calculateDeterministic33Nutrients({
      name: scoutIt.originalName || scoutIt.keyword,
      weightGrams: scoutIt.estimatedWeightGrams,
      nutrients: scoutIt.nutrients,
    })
  );
  const initialMealLedger = sum33Ledgers(initialItemLedgers);

  const systemInstructionB = `You are a clinical AI Dietitian Coach operating within a personalized health application.
You are provided with the PRE-CALCULATED 33-NUTRIENT MEAL LEDGER produced deterministically by the backend.

=== CRITICAL REGIONAL & CUISINE CALIBRATION DIRECTIVE ===
You MUST evaluate and adjust the aggregate data to accurately reflect authentic regional cuisine differences of the dining location (e.g. Indonesian / Southeast Asian cuisine):
- Cooking Fats: Frequent use of coconut milk/santan (high in saturated fat - lauric/myristic acid) and palm oil frying.
- Seasonings: Heavy use of kecap manis (sweet soy sauce - high in added sugar), terasi (shrimp paste - intense sodium), and salt/MSG.
- Conduct an expert clinical audit on the aggregate numbers against these regional realities.
- If the pre-calculated numbers under-represent regional saturated fat, sodium, or added sugar for Indonesian cooking, provide your clinically adjusted aggregate figures in 'accuracyReview.correctedMealNutrients' with your clinical reason in 'accuracyReview.correctionNote'. Otherwise, confirm the calculation as accurate.

${DIETITIAN_CORE_DIRECTIVES}

=== PATIENT CONTEXT PAYLOAD ===
${patientContext}

=== REQUIRED OUTPUT JSON SCHEMA ===
{
  "_internalReasoning": "string",
  "verdict": {
    "label": "string (3-6 words max: positive outcome or pre-calculated metric overage)",
    "level": "string ('good' | 'warning' | 'alert' | 'neutral')"
  },
  "message": "string (35-70 words in 4 beats grounded in the authoritative numbers)",
  "accuracyReview": {
    "isAudited": true,
    "status": "string ('confirmed_accurate' | 'clinically_adjusted')",
    "correctionNote": "string | null (Detailed clinical and regional cuisine justification if adjusted)",
    "correctedMealNutrients": {
      "calories": 0,
      "protein": 0,
      "totalFat": 0,
      "saturatedFat": 0,
      "sodium": 0,
      "potassium": 0,
      "addedSugar": 0,
      "totalFibre": 0
    }
  },
  "mealTitle": "string"
}`;

  const userPromptB = `Analyze this authentic Indonesian meal with the pre-calculated nutrient ledger.

=== IDENTIFIED INDONESIAN DISHES & PORTIONS ===
${mealItems
  .map(
    (it: any, idx: number) =>
      `- Dish ${idx + 1}: "${it.originalName || it.keyword}" (${it.estimatedWeightGrams}g) [Cuisine: Indonesian]`
  )
  .join("\n")}

=== PRE-CALCULATED 33-NUTRIENT MEAL LEDGER ===
${JSON.stringify(initialMealLedger, null, 2)}
`;

  const respB = await generateContentWithRetry(ai, {
    model: MODEL_NAME,
    contents: [{ role: "user", parts: [{ text: userPromptB }] }],
    config: {
      systemInstruction: { parts: [{ text: systemInstructionB }] },
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  const outputB = JSON.parse(respB.text || "{}");

  console.log("\n================================================================================");
  console.log("   INDONESIAN MEAL COMPARISON RESULTS");
  console.log("================================================================================");
  console.log("\n--- ARCHITECTURE A (Item-Level Corrections) ---");
  console.log("Verdict:", outputA.verdict);
  console.log("Message:", outputA.message);
  console.log("Items Breakdown & Corrections:");
  console.log(JSON.stringify(outputA.foodData?.itemsBreakdown, null, 2));

  console.log("\n--- ARCHITECTURE B (Aggregate Clinical & Regional Audit) ---");
  console.log("Verdict:", outputB.verdict);
  console.log("Message:", outputB.message);
  console.log("Accuracy Review Status:", outputB.accuracyReview?.status);
  console.log("Correction Note:", outputB.accuracyReview?.correctionNote);
  console.log("Corrected Meal Nutrients:", outputB.accuracyReview?.correctedMealNutrients);

  // Write Indonesian report
  const report = `# Indonesian Meal: Regional Cuisine Dietitian Calibration Report

- **Date:** ${new Date().toISOString()}
- **Model:** \`${MODEL_NAME}\`
- **Images Tested:** \`06_indonesian_menu_page_1.jpg\` and \`06_indonesian_menu_page_2.jpg\`
- **Dishes Tested:** ${mealItems.map((i: any) => i.originalName).join(", ")}

---

## 1. Architecture A (Item-Level Corrections)

- **Verdict:** \`${outputA.verdict?.label}\` (${outputA.verdict?.level})
- **Message:**
  > "${outputA.message}"

### Item Adjustments Made:
${JSON.stringify(outputA.foodData?.itemsBreakdown || [], null, 2)}

---

## 2. Architecture B (Aggregate Regional Audit)

- **Verdict:** \`${outputB.verdict?.label}\` (${outputB.verdict?.level})
- **Message:**
  > "${outputB.message}"
- **Audit Status:** \`${outputB.accuracyReview?.status}\`
- **Regional Correction Note:**
  > "${outputB.accuracyReview?.correctionNote || 'None'}"
- **Adjusted Aggregate Nutrients:**
${JSON.stringify(outputB.accuracyReview?.correctedMealNutrients || {}, null, 2)}

---
`;

  fs.writeFileSync(path.join(protoDir, "INDONESIAN_MEAL_REGIONAL_REPORT.md"), report, "utf8");
  console.log("\nReport saved to prototype/INDONESIAN_MEAL_REGIONAL_REPORT.md");
}

runIndonesianComparison().catch((err) => {
  console.error("Error running Indonesian comparison:", err);
  process.exit(1);
});
