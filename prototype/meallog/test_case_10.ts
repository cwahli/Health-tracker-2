import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import {
  hierarchicalScoutSystemInstruction,
  hierarchicalScoutResponseSchema,
} from "./scout_hierarchical_instructions.ts";
import {
  calculateMealNutrients,
  ProcessedMeal,
} from "./backend_nutrient_calculator.ts";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("ERROR: GEMINI_API_KEY is not set.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const imagesDir = path.join(process.cwd(), "prototype", "images");

async function runTestCase10() {
  console.log("==========================================================================================");
  console.log("TEST CASE 10: RAW GROCERY BARCODES + PREPARED MEAL (2 IMAGES)");
  console.log("Model: gemini-3.5-flash-lite");
  console.log("==========================================================================================\n");

  const img0Path = path.join(imagesDir, "10_beef_soup_barcode_meal_0.jpg");
  const img1Path = path.join(imagesDir, "10_beef_soup_barcode_meal_1.jpg");

  if (!fs.existsSync(img0Path) || !fs.existsSync(img1Path)) {
    console.error("Error: Image files not found in prototype/meallog/images/");
    process.exit(1);
  }

  const imageParts = [
    {
      inlineData: {
        mimeType: "image/jpeg",
        data: fs.readFileSync(img0Path).toString("base64"),
      },
    },
    {
      inlineData: {
        mimeType: "image/jpeg",
        data: fs.readFileSync(img1Path).toString("base64"),
      },
    },
  ];

  const userPrompt = "Analyze this meal photo. Group the meal into dishes. For each dish, list all distinct component foods/ingredients with 6 core nutrients (protein, saturatedFat, addedSugar, totalFibre, sodium, carbohydrates). For the whole dish, provide combined dishNutrients (saturatedFat, totalFat, totalSugar, potassium, omega3, calcium, iron, magnesium, vitaminD). If printed package labels or barcodes are visible, transcribe printed facts into rawNutritionLabel and preserve printed weights.";

  const t0 = Date.now();
  console.log("Calling Gemini 3.5 Flash Lite API with 2 images...");

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: [
      {
        role: "user",
        parts: [
          ...imageParts,
          { text: userPrompt },
        ],
      },
    ],
    config: {
      systemInstruction: hierarchicalScoutSystemInstruction,
      responseMimeType: "application/json",
      responseSchema: hierarchicalScoutResponseSchema,
      temperature: 0.1,
    },
  });

  const latencyMs = Date.now() - t0;
  const rawJsonString = response.text?.trim() || "{}";
  const scoutData = JSON.parse(rawJsonString);

  console.log(`\n==========================================================================================`);
  console.log(`API RESPONSE RECEIVED (Latency: ${latencyMs}ms)`);
  console.log(`==========================================================================================`);
  console.log(`\n--- RAW SCOUT JSON OUTPUT ---`);
  console.log(JSON.stringify(scoutData, null, 2));

  // Run through deterministic backend calculation engine
  const processed: ProcessedMeal = calculateMealNutrients(scoutData.dishes || []);

  console.log(`\n==========================================================================================`);
  console.log(`BACKEND DETERMINISTIC NUTRIENT BREAKDOWN (Zero-LLM Math)`);
  console.log(`==========================================================================================`);

  for (let i = 0; i < processed.dishes.length; i++) {
    const d = processed.dishes[i];
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`DISH ${i + 1}: ${d.dishName} (${d.estimatedWeightGrams}g) [Brand: ${d.chainName || "None"}]`);
    console.log(`Calculated Calories: ${d.calories} kcal | Protein: ${d.protein}g | Carbs: ${d.carbohydrates}g | Total Fat: ${d.totalFat}g (Sat: ${d.saturatedFat}g, Unsat: ${d.unsaturatedFat}g)`);
    console.log(`Dish Micronutrients: Total Sugar: ${d.totalSugar}g | Fibre: ${d.totalFibre}g | Sodium: ${d.sodium}mg (Salt: ${d.saltGrams}g) | Potassium: ${d.potassium}mg | Calcium: ${d.calcium}mg | Iron: ${d.iron}mg | Mg: ${d.magnesium}mg | Vit D: ${d.vitaminD}mcg | Omega-3: ${d.omega3}g`);
    console.log(`\nComponent Food Ingredients (${d.foods.length}):`);
    for (const f of d.foods) {
      console.log(`  - ${f.foodName.padEnd(28)} | ${String(f.estimatedWeightGrams).padStart(4)}g | ${f.cookingMethod.padEnd(10)} | P: ${String(f.protein).padStart(4)}g | C: ${String(f.carbohydrates).padStart(4)}g | SatFat: ${String(f.saturatedFat).padStart(4)}g | Fibre: ${String(f.totalFibre).padStart(4)}g | Sodium: ${String(f.sodium).padStart(4)}mg | AddedSugar: ${f.addedSugar}g`);
    }
  }

  console.log(`\n==========================================================================================`);
  console.log(`TOTAL MEAL SUMMARY (${processed.totalMealWeightGrams}g total weight)`);
  console.log(`==========================================================================================`);
  console.log(`Calories:       ${processed.totals.calories} kcal (Derived: 4*${processed.totals.protein}P + 4*${processed.totals.carbohydrates}C + 9*${processed.totals.totalFat}F)`);
  console.log(`Protein:        ${processed.totals.protein} g`);
  console.log(`Carbohydrates:  ${processed.totals.carbohydrates} g`);
  console.log(`Total Fat:      ${processed.totals.totalFat} g (Saturated: ${processed.totals.saturatedFat} g | Unsaturated: ${processed.totals.unsaturatedFat} g)`);
  console.log(`Total Sugar:    ${processed.totals.totalSugar} g (Added Sugar: ${processed.totals.addedSugar} g)`);
  console.log(`Dietary Fibre:  ${processed.totals.totalFibre} g`);
  console.log(`Sodium:         ${processed.totals.sodium} mg (Salt: ${processed.totals.saltGrams} g)`);
  console.log(`Potassium:      ${processed.totals.potassium} mg`);
  console.log(`Calcium:        ${processed.totals.calcium} mg`);
  console.log(`Iron:           ${processed.totals.iron} mg`);
  console.log(`Magnesium:      ${processed.totals.magnesium} mg`);
  console.log(`Vitamin D:      ${processed.totals.vitaminD} mcg`);
  console.log(`Omega-3:        ${processed.totals.omega3} g`);
  console.log(`==========================================================================================\n`);
}

runTestCase10();
