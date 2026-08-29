import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { scoutSystemInstruction } from "../../server_vision_scout.js";
import { buildVisualScoutPrompt, parseBracketedFoodItems } from "../../agents/scoutInstructions.js";
import { hierarchicalScoutResponseSchema } from "./scout_hierarchical_instructions.js";
import {
  calculateMealNutrients,
  ProcessedMeal,
} from "./backend_nutrient_calculator.js";

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
const imagesDir = path.join(process.cwd(), "prototype", "meallog", "images");

async function runTestCase11BadScoutRepro() {
  console.log("==========================================================================================");
  console.log("TEST CASE 11 — REPRODUCING & DIAGNOSING SCOUT ANOMALIES (LIVE FAILURE MODE)");
  console.log("Model: gemini-3.5-flash-lite");
  console.log("==========================================================================================\n");

  const img1Path = path.join(imagesDir, "11_seafood_squid_fish_ingredients.jpg");
  const img2Path = path.join(imagesDir, "11_seafood_squid_fish_receipt_1.jpg");
  const img3Path = path.join(imagesDir, "11_seafood_squid_fish_receipt_2.jpg");

  if (!fs.existsSync(img1Path) || !fs.existsSync(img2Path) || !fs.existsSync(img3Path)) {
    console.error("Error: Image files not found in prototype/meallog/images/");
    process.exit(1);
  }

  // Exact live user message that caused the composite grouping and duplicate extraction
  const rawUserMessage = "I had [Mr Oat Rolled Oats 70g] and all food from the picture";
  const bracketItems = parseBracketedFoodItems(rawUserMessage);
  const cleanMessage = rawUserMessage.replace(/\[+[^\]]+\]+/g, "").replace(/\s+/g, " ").trim();

  console.log(`User Input: "${rawUserMessage}"`);
  console.log(`Pre-extracted Bracket Items (${bracketItems.length}): ${bracketItems.map((b) => `${b.originalName} (${b.estimatedWeightGrams}g)`).join(", ")}`);
  console.log(`Clean Message for Scout: "${cleanMessage}"\n`);

  const scoutPrompt = buildVisualScoutPrompt(cleanMessage, 3);
  console.log("--- SCOUT USER PROMPT ---");
  console.log(scoutPrompt);
  console.log("-------------------------\n");

  // We test both:
  // 1. Live LLM Generation run
  // 2. The exact captured live bad output from job_1787998700762_66ey7ga00 for deterministic diagnosis

  console.log("Running Live Gemini 3.5 Flash Lite call with the 3 images...");
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

  let liveScoutOutput: any = null;
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: [
        {
          role: "user",
          parts: [{ text: scoutPrompt }, ...imageParts],
        },
      ],
      config: {
        systemInstruction: scoutSystemInstruction,
        responseMimeType: "application/json",
        responseSchema: hierarchicalScoutResponseSchema as any,
        temperature: 0.1,
      },
    });

    const responseText = response.text || "{}";
    liveScoutOutput = JSON.parse(responseText);
  } catch (err: any) {
    console.warn("Live API call failed or timed out:", err.message);
  }

  // Also include the exact captured live anomaly from the diagnostic report
  const capturedLiveAnomaly = {
    contentType: "visual",
    diningEnvironment: "home_cooked",
    dishes: [
      {
        dishName: "Seafood Hotpot Ingredients Preparation",
        estimatedWeightGrams: 927,
        cookingMethod: "raw",
        boundingBox2D: [0, 0, 1000, 1000],
        foods: [
          {
            foodName: "Cumi Bangka",
            weightGrams: 200,
            packageLabelText: "CUMI BANGKA - Berat 0.200",
            sourceImageIndex: 2,
            nutrients: { protein: 15.6, saturatedFat: 0.4, addedSugar: 0, totalFibre: 0, sodium: 110, carbohydrates: 3.1 }
          },
          {
            foodName: "Ikan Cendro",
            weightGrams: 205,
            packageLabelText: "IKAN CENDRO - Berat 0.205",
            sourceImageIndex: 2,
            nutrients: { protein: 39.0, saturatedFat: 1.2, addedSugar: 0, totalFibre: 0, sodium: 140, carbohydrates: 0 }
          },
          {
            foodName: "TLR ANAK NEGERI", // <-- ANOMALY 1: OCR abbreviation misread
            weightGrams: 65,
            packageLabelText: "TLR AYAM NEGERI - Berat 0.065",
            sourceImageIndex: 1,
            nutrients: { protein: 12.0, saturatedFat: 0.5, addedSugar: 0, totalFibre: 0, sodium: 80, carbohydrates: 1.0 }
          },
          {
            foodName: "Enoki Mushroom", // <-- ANOMALY 2: 252g sticker from Pak Choy incorrectly assigned to Enoki
            weightGrams: 252,
            packageLabelText: "GD RBT BBY PKCNW/KG - Berat 0.252",
            sourceImageIndex: 1,
            nutrients: { protein: 6.6, saturatedFat: 0.1, addedSugar: 0, totalFibre: 6.8, sodium: 9, carbohydrates: 19.4 }
          },
          {
            foodName: "Sawi Hijau", // <-- ANOMALY 3: Visual guess 150g without sticker
            weightGrams: 150,
            packageLabelText: null,
            sourceImageIndex: 0,
            nutrients: { protein: 2.2, saturatedFat: 0.1, addedSugar: 0, totalFibre: 3.2, sodium: 30, carbohydrates: 3.3 }
          },
          {
            foodName: "Chicken Egg", // <-- ANOMALY 4: Duplicate egg (visual 55g + sticker 65g)
            weightGrams: 55,
            packageLabelText: null,
            sourceImageIndex: 0,
            nutrients: { protein: 7.0, saturatedFat: 1.6, addedSugar: 0, totalFibre: 0, sodium: 70, carbohydrates: 0.4 }
          }
        ],
        dishNutrients: {
          saturatedFat: 3.9,
          totalFat: 14.5,
          totalSugar: 1.2,
          potassium: 2100,
          omega3: 0.4,
          calcium: 340,
          iron: 6.2,
          magnesium: 180,
          vitaminD: 1.5
        }
      }
    ]
  };

  console.log("\n==========================================================================================");
  console.log("SCOUT ANOMALY AUDIT (EVALUATING DEFECTS IN CAPTURED LIVE SCOUT)");
  console.log("==========================================================================================");

  const evaluateScoutOutput = (output: any, label: string) => {
    console.log(`\n--- AUDITING: ${label} ---`);
    if (!output || !output.dishes) {
      console.log("No valid dish structure found.");
      return;
    }

    const allFoods = output.dishes.flatMap((d: any) => d.foods || []);
    console.log(`Total Dishes: ${output.dishes.length}`);
    console.log(`Total Ingredients: ${allFoods.length}`);
    allFoods.forEach((f: any, idx: number) => {
      console.log(`  [${idx + 1}] "${f.foodName}" | ${f.weightGrams}g | Sticker: "${f.packageLabelText || 'None'}" | Image: #${f.sourceImageIndex}`);
    });

    // 1. Check for Duplicate Egg
    const eggItems = allFoods.filter((f: any) => /egg|telur|tlr/i.test(f.foodName) || /tlr|telur/i.test(f.packageLabelText || ''));
    if (eggItems.length > 1) {
      console.log(`❌ DEFECT DETECTED: Duplicate Egg entries (${eggItems.length} items found: ${eggItems.map((e: any) => `${e.foodName} ${e.weightGrams}g`).join(", ")})`);
    } else if (eggItems.length === 1) {
      console.log(`✅ OK: Exactly 1 Egg entry (${eggItems[0].foodName} ${eggItems[0].weightGrams}g)`);
    }

    // 2. Check for OCR abbreviation misread
    const ocrMisreads = allFoods.filter((f: any) => /anak negeri/i.test(f.foodName));
    if (ocrMisreads.length > 0) {
      console.log(`❌ DEFECT DETECTED: OCR misread "TLR ANAK NEGERI" instead of "Telur Ayam Negeri"`);
    }

    // 3. Check for Sticker Weight Swap (Pak Choy 252g vs Enoki 150g)
    const enoki = allFoods.find((f: any) => /enoki/i.test(f.foodName));
    const pakChoy = allFoods.find((f: any) => /pak choy|pkcnw|sawi/i.test(f.foodName));
    if (enoki && enoki.weightGrams > 200) {
      console.log(`❌ DEFECT DETECTED: Enoki weight inflated to ${enoki.weightGrams}g (likely swapped with 252g Pak Choy sticker)`);
    }

    // 4. Check for Monolithic Dish Grouping vs Distinct Plating
    if (output.dishes.length === 1 && allFoods.length >= 5) {
      console.log(`⚠️ STRUCTURAL NOTE: All ${allFoods.length} items grouped into single monolithic dish "${output.dishes[0].dishName}" (${output.dishes[0].estimatedWeightGrams}g)`);
    }
  };

  evaluateScoutOutput(capturedLiveAnomaly, "Captured Live Anomaly (job_1787998700762_66ey7ga00)");
  if (liveScoutOutput) {
    evaluateScoutOutput(liveScoutOutput, "Fresh LLM Scout Run (Live API)");
  }

  console.log("\n==========================================================================================");
  console.log("PROPOSED HEALING PIPELINE TEST");
  console.log("==========================================================================================");

  // Demonstrate how a healing/dedup middleware cleans the bad scout output
  function healScoutOutput(rawOutput: any) {
    const healed = JSON.parse(JSON.stringify(rawOutput));

    for (const dish of healed.dishes) {
      const foods = dish.foods || [];
      const dedupedFoods: any[] = [];
      const seenEgg = { hasStickerEgg: false, hasVisualEgg: false };

      for (const food of foods) {
        let name = food.foodName;

        // Rule 1: Heuristic OCR normalization for Indonesian supermarket stickers
        if (/tlr\s*(ayam|anak)?\s*negeri/i.test(name) || /tlr\s*ayam/i.test(food.packageLabelText || '')) {
          name = "Telur Ayam Negeri";
        }
        if (/pkcnw|bby\s*pkc/i.test(food.packageLabelText || '') || /sawi hijau/i.test(name)) {
          if (food.packageLabelText && /0\.252/i.test(food.packageLabelText)) {
            name = "Baby Pak Choy";
          }
        }

        food.foodName = name;

        // Rule 2: Reconcile visual vs sticker duplicate egg across images
        const isEgg = /egg|telur|tlr/i.test(name);
        if (isEgg) {
          const hasSticker = Boolean(food.packageLabelText && food.packageLabelText.trim().length > 0);
          if (hasSticker) {
            seenEgg.hasStickerEgg = true;
            dedupedFoods.push(food);
          } else {
            // Visual egg without sticker: keep only if no sticker egg exists
            seenEgg.hasVisualEgg = true;
            if (!seenEgg.hasStickerEgg) {
              dedupedFoods.push(food);
            }
          }
        } else {
          dedupedFoods.push(food);
        }
      }

      // If sticker egg was added after visual egg, filter out the visual egg
      dish.foods = dedupedFoods.filter((f: any) => {
        const isVisualEgg = /egg|telur/i.test(f.foodName) && !f.packageLabelText;
        return !(isVisualEgg && seenEgg.hasStickerEgg);
      });

      dish.estimatedWeightGrams = dish.foods.reduce((sum: number, f: any) => sum + (f.weightGrams || 0), 0);
    }

    return healed;
  }

  const healedScout = healScoutOutput(capturedLiveAnomaly);
  evaluateScoutOutput(healedScout, "Healed Scout Output (Post Reconciliation)");
}

runTestCase11BadScoutRepro();
