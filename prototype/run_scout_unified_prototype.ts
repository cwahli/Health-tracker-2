import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import {
  unifiedScoutSystemInstruction,
  unifiedScoutResponseSchema,
} from "./scout_unified_instructions.ts";

dotenv.config();

interface TestCase {
  name: string;
  imageFiles: string[];
  userPrompt: string;
}

const testCases: TestCase[] = [
  {
    name: "Case 1: Rolled Oats Prepared Bowl + Nutrition Label (2-Photo Multi-Image Set)",
    imageFiles: ["08_rolled_oats_1.jpg", "08_rolled_oats_2.jpg"],
    userPrompt: "Analyze this meal photo.",
  },
  {
    name: "Case 2: Yolk Restaurant Sandwich (Brand Lock / Single Dish)",
    imageFiles: ["01_yolk_panini_wrap.jpg"],
    userPrompt: "I had it from Yolk",
  },
  {
    name: "Case 3: Lidl Chicken Bites with UK Nutrition Label",
    imageFiles: ["02_lidl_chicken_muffin.jpg"],
    userPrompt: "Analyze this meal",
  },
  {
    name: "Case 4: Salmon Sushi Roll & Shrimp Salad (Visual Plated Dishes)",
    imageFiles: ["03_sushi_shrimp_salad.jpg"],
    userPrompt: "Analyze this meal photo",
  },
  {
    name: "Case 5: Multi-Image Menu Set (Page 1 + Page 2 Analyzed Together)",
    imageFiles: ["06_indonesian_menu_page_1.jpg", "06_indonesian_menu_page_2.jpg"],
    userPrompt: "Analyze these 2 menu pages together and extract all options",
  },
];

async function runUnifiedScoutPrototype() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("ERROR: GEMINI_API_KEY environment variable is not set.");
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });
  const imagesDir = path.join(process.cwd(), "prototype", "images");

  console.log("================================================================================");
  console.log("UNIFIED VISION SCOUT PROTOTYPE RUN (gemini-3.5-flash-lite)");
  console.log("Objective: Verify single unified item output without dummy label items or 3x duplication");
  console.log("================================================================================\n");

  for (const tc of testCases) {
    const parts: any[] = [];
    let allFound = true;
    for (const f of tc.imageFiles) {
      const imgPath = path.join(imagesDir, f);
      if (!fs.existsSync(imgPath)) {
        console.error(`Image not found: ${imgPath}`);
        allFound = false;
        break;
      }
      const imageBuffer = fs.readFileSync(imgPath);
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: imageBuffer.toString("base64"),
        },
      });
    }
    if (!allFound) continue;

    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`RUNNING: ${tc.name}`);
    console.log(`Images (${tc.imageFiles.length}): ${tc.imageFiles.join(", ")} | Prompt: "${tc.userPrompt}"`);
    console.log(`--------------------------------------------------------------------------------`);

    parts.push({
      text: `${tc.userPrompt}. Identify all dishes in these images and provide full nutrient estimations. If printed package labels or menu screens are visible, transcribe them into rawNutritionLabel on that specific food item.`,
    });

    const startTime = Date.now();

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: [
          {
            role: "user",
            parts,
          },
        ],
        config: {
          systemInstruction: unifiedScoutSystemInstruction,
          responseMimeType: "application/json",
          responseSchema: unifiedScoutResponseSchema as any,
          temperature: 0.1,
        },
      });

      const elapsed = Date.now() - startTime;
      const rawText = response.text || "{}";
      const parsed = JSON.parse(rawText);

      console.log(`\nResponse received in ${elapsed}ms:`);
      console.log("\n--- RAW JSON OUTPUT ---");
      console.log(rawText);
      console.log("-----------------------\n");
      console.log(`Content Type: ${parsed.contentType} | Dining: ${parsed.diningEnvironment}`);
      console.log(`Internal Reasoning: ${parsed._internalReasoning}`);
      console.log(`\nExtracted Items Count: ${parsed.items?.length || 0}`);

      (parsed.items || []).forEach((item: any, idx: number) => {
        console.log(`\n  [Item ${idx + 1}] "${item.originalName}" (keyword: ${item.keyword})`);
        console.log(`    - Chain / Brand: ${item.chainName || "None"}`);
        console.log(`    - Weight: ${item.estimatedWeightGrams}g | Cooking: ${item.cookingMethod}`);
        console.log(`    - Ingredients: [${(item.ingredients || []).join(", ")}]`);

        if (item.rawNutritionLabel && Object.keys(item.rawNutritionLabel).length > 0) {
          console.log(`    - Attached rawNutritionLabel (OCR Truth): ${JSON.stringify(item.rawNutritionLabel)}`);
        } else {
          console.log(`    - rawNutritionLabel: null (No printed package label on image)`);
        }

        const n = item.nutrients || {};
        // Pure-TS derive Carbs, Unsat Fat, and Salt
        const carbsDerived = (n.calories != null && n.protein != null && n.totalFat != null)
          ? Math.max(0, Math.round(((n.calories - (4 * n.protein) - (9 * n.totalFat)) / 4) * 10) / 10)
          : null;
        const unsatFatDerived = (n.totalFat != null && n.saturatedFat != null)
          ? Math.max(0, Math.round((n.totalFat - (n.saturatedFat + (n.transFat || 0))) * 10) / 10)
          : null;
        const saltDerived = (n.sodium != null)
          ? Math.round(((n.sodium * 2.54) / 1000) * 100) / 100
          : null;

        console.log(`    - 14-Nutrient Profile (Portion):`);
        console.log(`        Calories: ${n.calories} kcal | Protein: ${n.protein}g | Total Fat: ${n.totalFat}g (Sat: ${n.saturatedFat}g, Trans: ${n.transFat}g)`);
        console.log(`        Derived Carbs: ${carbsDerived}g | Derived Unsat Fat: ${unsatFatDerived}g | Derived Salt: ${saltDerived}g`);
        console.log(`        Sugar: ${n.sugar}g (Added: ${n.addedSugar}g) | Fibre: ${n.totalFibre}g | Sodium: ${n.sodium}mg`);
        console.log(`        Potassium: ${n.potassium}mg | Calcium: ${n.calcium}mg | Iron: ${n.iron}mg | Magnesium: ${n.magnesium}mg | Vit D: ${n.vitaminD}mcg | Omega-3: ${n.omega3}g`);
      });

    } catch (err: any) {
      console.error(`Error processing ${tc.name}:`, err);
    }
  }

  console.log("\n================================================================================");
  console.log("PROTOTYPE RUN COMPLETE");
  console.log("================================================================================");
}

runUnifiedScoutPrototype();
