import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import {
  hierarchicalScoutSystemInstruction,
  hierarchicalScoutResponseSchema,
} from "./scout_hierarchical_instructions";
import { calculateMealNutrients } from "./backend_nutrient_calculator";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function runTestCase08() {
  console.log("==========================================================================================");
  console.log("TEST CASE 08: ROLLED OATS (PACKAGE NUTRITION FACTS + PREPARED BOWL)");
  console.log("Model: gemini-3.5-flash-lite");
  console.log("==========================================================================================\n");

  const imagePaths = [
    "prototype/images/08_rolled_oats_1.jpg",
    "prototype/images/08_rolled_oats_2.jpg",
  ];

  const contents: any[] = [];
  for (const imgPath of imagePaths) {
    if (!fs.existsSync(imgPath)) {
      console.error(`Image not found: ${imgPath}`);
      return;
    }
    const buf = fs.readFileSync(imgPath);
    contents.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: buf.toString("base64"),
      },
    });
  }

  contents.push({
    text: `Analyze this meal. Image 1 shows the product packaging/nutrition label, and Image 2 shows the prepared/served meal.
Extract the distinct dishes and their constituent food ingredients following the system instructions.
Preserve exact printed OCR label values if visible.
Provide numeric estimates for the 6 food-level core nutrients and 9 dish-level combined nutrients without estimating calories.`,
  });

  console.log("Calling Gemini 3.5 Flash Lite API with 2 images...\n");
  const startTime = Date.now();

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: contents,
      config: {
        systemInstruction: hierarchicalScoutSystemInstruction,
        responseMimeType: "application/json",
        responseSchema: hierarchicalScoutResponseSchema as any,
        temperature: 0.1,
      },
    });

    const elapsed = Date.now() - startTime;
    console.log("==========================================================================================");
    console.log(`API RESPONSE RECEIVED (Latency: ${elapsed}ms)`);
    console.log("==========================================================================================\n");

    const rawJson = response.text;
    console.log("--- RAW SCOUT JSON OUTPUT ---");
    console.log(rawJson);
    console.log("\n");

    const parsed = JSON.parse(rawJson || "{}");

    console.log("==========================================================================================");
    console.log("BACKEND DETERMINISTIC NUTRIENT BREAKDOWN (Zero-LLM Math)");
    console.log("==========================================================================================\n");

    const mealSummary = calculateMealNutrients(parsed.dishes || []);

    for (let i = 0; i < mealSummary.dishes.length; i++) {
      const d = mealSummary.dishes[i];
      console.log("--------------------------------------------------------------------------------");
      console.log(`DISH ${i + 1}: ${d.dishName} (${d.estimatedWeightGrams}g) [Brand: ${d.chainName || "None"}]`);
      console.log(`Calculated Calories: ${d.calories} kcal | Protein: ${d.protein}g | Carbs: ${d.carbohydrates}g | Total Fat: ${d.totalFat}g (Sat: ${d.saturatedFat}g, Unsat: ${d.unsaturatedFat}g)`);
      console.log(`Dish Micronutrients: Total Sugar: ${d.totalSugar}g | Fibre: ${d.totalFibre}g | Sodium: ${d.sodium}mg (Salt: ${d.saltGrams}g) | Potassium: ${d.potassium}mg | Calcium: ${d.calcium}mg | Iron: ${d.iron}mg | Mg: ${d.magnesium}mg | Vit D: ${d.vitaminD}mcg | Omega-3: ${d.omega3}g\n`);

      console.log(`Component Food Ingredients (${d.foods.length}):`);
      for (const f of d.foods) {
        console.log(
          `  - ${f.foodName.padEnd(28)} | ${String(f.estimatedWeightGrams).padStart(4)}g | ` +
          `P: ${String(f.protein).padStart(4)}g | C: ${String(f.carbohydrates).padStart(4)}g | ` +
          `SatFat: ${String(f.saturatedFat).padStart(4)}g | Fibre: ${String(f.totalFibre).padStart(4)}g | ` +
          `Sodium: ${String(f.sodium).padStart(4)}mg | AddedSugar: ${f.addedSugar}g`
        );
      }
      console.log("");
    }

    console.log("==========================================================================================");
    console.log(`TOTAL MEAL SUMMARY (${mealSummary.totalMealWeightGrams}g total weight)`);
    console.log("==========================================================================================");
    console.log(`Calories:       ${mealSummary.totals.calories} kcal (Derived: 4*${mealSummary.totals.protein}P + 4*${mealSummary.totals.carbohydrates}C + 9*${mealSummary.totals.totalFat}F)`);
    console.log(`Protein:        ${mealSummary.totals.protein} g`);
    console.log(`Carbohydrates:  ${mealSummary.totals.carbohydrates} g`);
    console.log(`Total Fat:      ${mealSummary.totals.totalFat} g (Saturated: ${mealSummary.totals.saturatedFat} g | Unsaturated: ${mealSummary.totals.unsaturatedFat} g)`);
    console.log(`Total Sugar:    ${mealSummary.totals.totalSugar} g (Added Sugar: ${mealSummary.totals.addedSugar} g)`);
    console.log(`Dietary Fibre:  ${mealSummary.totals.totalFibre} g`);
    console.log(`Sodium:         ${mealSummary.totals.sodium} mg (Salt: ${mealSummary.totals.saltGrams} g)`);
    console.log(`Potassium:      ${mealSummary.totals.potassium} mg`);
    console.log(`Calcium:        ${mealSummary.totals.calcium} mg`);
    console.log(`Iron:           ${mealSummary.totals.iron} mg`);
    console.log(`Magnesium:      ${mealSummary.totals.magnesium} mg`);
    console.log(`Vitamin D:      ${mealSummary.totals.vitaminD} mcg`);
    console.log(`Omega-3:        ${mealSummary.totals.omega3} g`);
    console.log("==========================================================================================\n");

  } catch (err) {
    console.error("Error executing test case 08:", err);
  }
}

runTestCase08();
