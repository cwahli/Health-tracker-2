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

interface TestCase {
  id: string;
  name: string;
  imageFiles: string[];
  userPrompt: string;
}

const testCases: TestCase[] = [
  {
    id: "case_target_10",
    name: "Target Diagnostic Case: Raw Grocery Labels + Cooked Beef Soup/Plate (2 Photos)",
    imageFiles: [
      "10_beef_soup_barcode_meal_0.jpg",
      "10_beef_soup_barcode_meal_1.jpg",
    ],
    userPrompt: "Analyze this meal photo.",
  },
  {
    id: "case_oats_08",
    name: "Rolled Oats Nutrition Label + Prepared Bowl (2 Photos)",
    imageFiles: ["08_rolled_oats_1.jpg", "08_rolled_oats_2.jpg"],
    userPrompt: "Analyze this meal photo.",
  },
  {
    id: "case_yolk_01",
    name: "Yolk Panini Sandwich & Sides (Brand Lock)",
    imageFiles: ["01_yolk_panini_wrap.jpg"],
    userPrompt: "I had it from Yolk",
  },
  {
    id: "case_lidl_02",
    name: "Lidl Chicken Bites with UK Label (OCR + Plated)",
    imageFiles: ["02_lidl_chicken_muffin.jpg"],
    userPrompt: "Analyze this meal",
  },
  {
    id: "case_sushi_03",
    name: "Salmon Sushi Roll & Shrimp Salad (Visual Plated)",
    imageFiles: ["03_sushi_shrimp_salad.jpg"],
    userPrompt: "Analyze this meal photo",
  },
];

async function runHierarchicalPrototype() {
  console.log("==========================================================================================");
  console.log("HIERARCHICAL DISH-FOOD VISION SCOUT PROTOTYPE RUN (gemini-3.5-flash-lite)");
  console.log("Food level: 6 core nutrients (Protein, Sat Fat, Added Sugar, Fibre, Sodium, Carbs)");
  console.log("Dish level: 9 combined nutrients (Sat Fat, Total Fat, Total Sugar, Potassium, Omega-3, Calcium, Iron, Magnesium, Vitamin D)");
  console.log("Backend level: Pure TypeScript deterministic Atwater (4P + 4C + 9F) calories & rollups");
  console.log("==========================================================================================\n");

  for (const tc of testCases) {
    console.log(`==========================================================================================`);
    console.log(`RUNNING: ${tc.name}`);
    console.log(`Images: ${tc.imageFiles.join(", ")} | Prompt: "${tc.userPrompt}"`);
    console.log(`==========================================================================================`);

    const imageParts: any[] = [];
    let allFound = true;
    for (const f of tc.imageFiles) {
      const imgPath = path.join(imagesDir, f);
      if (!fs.existsSync(imgPath)) {
        console.error(`Image not found: ${imgPath}`);
        allFound = false;
        break;
      }
      imageParts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: fs.readFileSync(imgPath).toString("base64"),
        },
      });
    }
    if (!allFound) continue;

    const parts = [
      ...imageParts,
      {
        text: `${tc.userPrompt}. Group the meal into dishes. For each dish, list all distinct component foods/ingredients with 6 core nutrients (protein, saturatedFat, addedSugar, totalFibre, sodium, carbohydrates). For the whole dish, provide combined dishNutrients (saturatedFat, totalFat, totalSugar, potassium, omega3, calcium, iron, magnesium, vitaminD). If printed package labels or barcodes are visible, transcribe printed facts into rawNutritionLabel and preserve printed weights.`,
      },
    ];

    const t0 = Date.now();
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
          systemInstruction: hierarchicalScoutSystemInstruction,
          responseMimeType: "application/json",
          responseSchema: hierarchicalScoutResponseSchema,
        },
      });

      const latencyMs = Date.now() - t0;
      const rawText = response.text?.trim() || "{}";
      const scoutData = JSON.parse(rawText);

      console.log(`Scout Response Time: ${latencyMs}ms`);
      console.log(`Internal Reasoning: ${scoutData._internalReasoning}`);
      console.log(`Detected Dishes: ${scoutData.dishes?.length || 0}\n`);

      // Run Deterministic Backend Calculation Engine
      const processed: ProcessedMeal = calculateMealNutrients(scoutData.dishes || []);

      for (let i = 0; i < processed.dishes.length; i++) {
        const d = processed.dishes[i];
        console.log(`--------------------------------------------------------------------------------`);
        console.log(`DISH ${i + 1}: ${d.dishName} (${d.estimatedWeightGrams}g) [Brand: ${d.chainName || "None"}]`);
        console.log(`Dish Calculated Calories: ${d.calories} kcal | Protein: ${d.protein}g | Carbs: ${d.carbohydrates}g | Fat: ${d.totalFat}g (Sat: ${d.saturatedFat}g, Unsat: ${d.unsaturatedFat}g)`);
        console.log(`Dish Micronutrients: Total Sugar: ${d.totalSugar}g | Fibre: ${d.totalFibre}g | Sodium: ${d.sodium}mg (Salt: ${d.saltGrams}g) | Potassium: ${d.potassium}mg | Calcium: ${d.calcium}mg | Iron: ${d.iron}mg | Mg: ${d.magnesium}mg | Vit D: ${d.vitaminD}mcg | Omega-3: ${d.omega3}g`);
        console.log(`Component Foods (${d.foods.length}):`);
        for (const f of d.foods) {
          console.log(`  * ${f.foodName.padEnd(30)} | ${String(f.estimatedWeightGrams).padStart(4)}g | ${f.cookingMethod.padEnd(10)} -> P:${String(f.protein).padStart(5)}g | C:${String(f.carbohydrates).padStart(5)}g | SatF:${String(f.saturatedFat).padStart(4)}g | Fib:${String(f.totalFibre).padStart(4)}g | Sod:${String(f.sodium).padStart(4)}mg | AddSug:${f.addedSugar}g (Food Base Cal: ${f.estimatedCalories} kcal)`);
        }
      }

      console.log(`================================================================================`);
      console.log(`TOTAL MEAL SUMMARY (${processed.totalMealWeightGrams}g total weight)`);
      console.log(`Calories:       ${processed.totals.calories} kcal (Backend Atwater: 4*${processed.totals.protein}P + 4*${processed.totals.carbohydrates}C + 9*${processed.totals.totalFat}F)`);
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
      console.log(`================================================================================\n\n`);

    } catch (err: any) {
      console.error(`Error running case ${tc.id}:`, err?.message || err);
    }
  }
}

runHierarchicalPrototype();
