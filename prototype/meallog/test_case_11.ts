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

const apiKey =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.API_KEY ||
  process.env.GEMINI_API_KEYS?.split(",")[0]?.trim();

if (!apiKey) {
  console.error("ERROR: GEMINI_API_KEY / GOOGLE_API_KEY is not set.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const imagesDir = path.join(path.dirname(new URL(import.meta.url).pathname), "images");

async function runTestCase11() {
  console.log("==========================================================================================");
  console.log("TEST CASE 11: INDONESIAN SEAFOOD & VEG HOTPOT + MR OAT ROLLED OATS (3 IMAGES + PROMPT)");
  console.log("Model: gemini-3.5-flash-lite (Scout Only)");
  console.log("User Prompt: \"I had [Mr Oat Rolled Oats 70g] and all food in the pictures\"");
  console.log("==========================================================================================\n");

  const img1Path = path.join(imagesDir, "11_seafood_squid_fish_receipt_1.jpg");
  const img2Path = path.join(imagesDir, "11_seafood_squid_fish_receipt_2.jpg");
  const img3Path = path.join(imagesDir, "11_seafood_squid_fish_ingredients.jpg");

  if (!fs.existsSync(img1Path) || !fs.existsSync(img2Path) || !fs.existsSync(img3Path)) {
    console.error("Error: Image files not found in prototype/meallog/images/");
    process.exit(1);
  }

  const imageParts = [
    {
      inlineData: {
        mimeType: "image/jpeg",
        data: fs.readFileSync(img1Path).toString("base64"),
      },
    },
    {
      inlineData: {
        mimeType: "image/jpeg",
        data: fs.readFileSync(img2Path).toString("base64"),
      },
    },
    {
      inlineData: {
        mimeType: "image/jpeg",
        data: fs.readFileSync(img3Path).toString("base64"),
      },
    },
  ];

  const userPrompt = "I had [Mr Oat Rolled Oats 70g] and all food in the pictures";

  const t0 = Date.now();
  console.log("Calling Gemini 3.5 Flash Lite API with 3 images + user text prompt...");

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
      responseSchema: hierarchicalScoutResponseSchema as any,
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
    console.log(`Constituent Foods (${d.foods.length}):`);
    for (const f of d.foods) {
      const stickerInfo = (f as any).packageLabelText ? ` [Sticker: "${(f as any).packageLabelText}"]` : "";
      console.log(`   - ${f.foodName}${stickerInfo}: ${f.estimatedWeightGrams}g -> P: ${f.protein}g, C: ${f.carbohydrates}g, SatFat: ${f.saturatedFat}g, Fib: ${f.totalFibre}g, Na: ${f.sodium}mg, Cal: ${f.estimatedCalories} kcal`);
    }
  }

  console.log(`\n==========================================================================================`);
  console.log(`TOTAL MEAL 11 SUMMARY VS GROUND TRUTH`);
  console.log(`==========================================================================================`);
  const t = processed.totals;
  const gt = {
    weight: 892,
    calories: 822,
    protein: 95.1,
    carbs: 69.0,
    fat: 20.8,
    satFat: 4.6,
    fibre: 12.2,
    sodium: 473,
  };

  console.log(`Total Weight:  ${processed.totalMealWeightGrams}g  (Ground Truth: ${gt.weight}g)`);
  console.log(`Calories:      ${t.calories} kcal (Ground Truth: ${gt.calories} kcal) [Delta: ${Math.round(((t.calories - gt.calories) / gt.calories) * 100)}%]`);
  console.log(`Protein:       ${t.protein}g     (Ground Truth: ${gt.protein}g) [Delta: ${Math.round(((t.protein - gt.protein) / gt.protein) * 100)}%]`);
  console.log(`Carbohydrates: ${t.carbohydrates}g (Ground Truth: ${gt.carbs}g) [Delta: ${Math.round(((t.carbohydrates - gt.carbs) / gt.carbs) * 100)}%]`);
  console.log(`Total Fat:     ${t.totalFat}g    (Ground Truth: ${gt.fat}g) [Delta: ${Math.round(((t.totalFat - gt.fat) / gt.fat) * 100)}%]`);
  console.log(`Saturated Fat: ${t.saturatedFat}g (Ground Truth: ${gt.satFat}g)`);
  console.log(`Dietary Fibre: ${t.totalFibre}g  (Ground Truth: ${gt.fibre}g)`);
  console.log(`Sodium:        ${t.sodium}mg     (Ground Truth: ${gt.sodium}mg)`);
}

runTestCase11().catch(console.error);
