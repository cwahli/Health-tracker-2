import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import {
  scoutMealSystemInstruction,
  scoutMealResponseSchema,
} from "./scout_meal_instructions.ts";
import {
  calculateCompleteMeal,
  ProcessedCompleteMeal,
  ScoutMealResponse,
} from "./meal_nutrient_calculator.ts";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("ERROR: GEMINI_API_KEY is not set.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const imagesDir = path.join(process.cwd(), "prototype", "meallog", "images");

// Ground truth values for Image 1 from Image_nutrients_true_value.md
const image01GroundTruth = {
  caseName: "01: YOLK Chicken Sandwich & Roasted Sides",
  weightGrams: 600,
  calories: 950,
  protein: 49.0,
  carbohydrates: 92.0,
  totalFat: 42.0,
  saturatedFat: 8.5,
  dietaryFibre: 11.5,
  sodium: 1250,
  totalSugar: 8.5,
  addedSugar: 1.5,
  potassium: 1450,
  calcium: 160,
  iron: 4.6,
  magnesium: 125,
  vitaminD: 0.4,
  // 15 requested summary nutrients
  solubleFibre: 3.2,
  vitaminA: 120,
  thiamine: 0.45,
  riboflavin: 0.42,
  niacin: 14.5,
  vitaminB6: 1.1,
  folate: 140,
  vitaminB12: 0.8,
  vitaminC: 85,
  vitaminE: 4.8,
  vitaminK: 160,
  zinc: 3.6,
  selenium: 42,
  iodine: 35,
  phosphorus: 580,
};

async function runMealPrototypeOnImage1() {
  console.log("==========================================================================================");
  console.log("SCOUT DIRECT COMPLETE MEAL PROTOTYPE (Single-Stage, No Dietitian)");
  console.log("Model: gemini-3.5-flash-lite");
  console.log("Scope: Hierarchical Dishes/Foods + Verdict/Severity + Message + 15 Summary Micronutrients");
  console.log("==========================================================================================\n");

  const imageFileName = "01_yolk_panini_wrap.jpg";
  let imgPath = path.join(imagesDir, imageFileName);
  if (!fs.existsSync(imgPath)) {
    // fallback check
    imgPath = path.join(process.cwd(), "prototype", "images", imageFileName);
  }
  if (!fs.existsSync(imgPath)) {
    console.error(`Image not found: ${imgPath}`);
    process.exit(1);
  }

  const userPrompt = "I had it from Yolk";
  console.log(`Testing Image 1: ${imageFileName}`);
  console.log(`User Prompt: "${userPrompt}"`);
  console.log(`Reading image from: ${imgPath}\n`);

  const imageBase64 = fs.readFileSync(imgPath).toString("base64");
  const parts = [
    {
      inlineData: {
        mimeType: "image/jpeg",
        data: imageBase64,
      },
    },
    {
      text: `${userPrompt}. Identify all distinct dishes and constituent foods with weights and 6 core nutrients (protein, saturatedFat, addedSugar, totalFibre, sodium, carbohydrates). Provide dish-level dishNutrients (saturatedFat, totalFat, totalSugar, potassium, omega3, calcium, iron, magnesium, vitaminD). Generate a clinical verdict with severity level (good | warning | alert | neutral), a constructive 4-beat user message, and meal summary totals for the 15 micronutrients (solubleFibre, vitaminA, thiamine, riboflavin, niacin, vitaminB6, folate, vitaminB12, vitaminC, vitaminE, vitaminK, zinc, selenium, iodine, phosphorus).`,
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
        systemInstruction: scoutMealSystemInstruction,
        responseMimeType: "application/json",
        responseSchema: scoutMealResponseSchema,
      },
    });

    const elapsedMs = Date.now() - t0;
    const rawText = response.text || "{}";
    const scoutOutput: ScoutMealResponse = JSON.parse(rawText);

    const meal: ProcessedCompleteMeal = calculateCompleteMeal(scoutOutput);

    console.log("==========================================================================================");
    console.log(`STAGE 1: SCOUT DIRECT COMPLETE MEAL OUTPUT (${elapsedMs} ms)`);
    console.log("==========================================================================================");
    console.log(`Meal Name:            ${meal.mealName}`);
    console.log(`Dining Environment:   ${meal.diningEnvironment}`);
    console.log(`Content Type:         ${meal.contentType}`);
    console.log(`Scout Internal Logic: ${meal._internalReasoning}`);
    console.log("------------------------------------------------------------------------------------------");
    console.log(`VERDICT:              [${meal.verdict.level.toUpperCase()}] ${meal.verdict.label}`);
    console.log(`MESSAGE:              ${meal.message}`);
    console.log("==========================================================================================\n");

    console.log("==========================================================================================");
    console.log("HIERARCHICAL DISHES & CONSTITUENT FOODS BREAKDOWN");
    console.log("==========================================================================================");
    for (let i = 0; i < meal.dishes.length; i++) {
      const d = meal.dishes[i];
      console.log(`\n[Dish ${i + 1}] ${d.dishName} (${d.estimatedWeightGrams}g, method: ${d.cookingMethod}, chain: ${d.chainName || "none"})`);
      console.log(`  -> Dish Nutrients: ${d.calories} kcal | P: ${d.protein}g | C: ${d.carbohydrates}g | F: ${d.totalFat}g (Sat: ${d.saturatedFat}g) | Fiber: ${d.totalFibre}g | Sod: ${d.sodium}mg | K: ${d.potassium}mg | Ca: ${d.calcium}mg | Fe: ${d.iron}mg | Mg: ${d.magnesium}mg | VitD: ${d.vitaminD}mcg`);
      console.log("  Constituent Foods:");
      for (const f of d.foods) {
        console.log(`    - ${f.foodName}: ${f.estimatedWeightGrams}g | P: ${f.protein}g | C: ${f.carbohydrates}g | SatFat: ${f.saturatedFat}g | Sugar: ${f.addedSugar}g | Fib: ${f.totalFibre}g | Na: ${f.sodium}mg (Cal: ${f.estimatedCalories})`);
      }
    }

    console.log("\n==========================================================================================");
    console.log("MACRONUTRIENT ROLLUP & COMPARISON (Ground Truth vs Scout Output)");
    console.log("==========================================================================================");
    console.log(`| Nutrient          | Ground Truth | Scout Direct Output | Delta (%) |`);
    console.log(`|-------------------|:------------:|:-------------------:|:---------:|`);
    const printRow = (label: string, gt: number, pred: number, unit: string) => {
      const delta = gt > 0 ? (((pred - gt) / gt) * 100).toFixed(1) : "0.0";
      const deltaStr = Number(delta) >= 0 ? `+${delta}%` : `${delta}%`;
      console.log(`| ${label.padEnd(17)} | ${(gt + " " + unit).padStart(12)} | ${(pred + " " + unit).padStart(19)} | ${deltaStr.padStart(9)} |`);
    };

    printRow("Total Weight", image01GroundTruth.weightGrams, meal.totalMealWeightGrams, "g");
    printRow("Calories", image01GroundTruth.calories, meal.totals.calories, "kcal");
    printRow("Protein", image01GroundTruth.protein, meal.totals.protein, "g");
    printRow("Carbohydrates", image01GroundTruth.carbohydrates, meal.totals.carbohydrates, "g");
    printRow("Total Fat", image01GroundTruth.totalFat, meal.totals.totalFat, "g");
    printRow("Saturated Fat", image01GroundTruth.saturatedFat, meal.totals.saturatedFat, "g");
    printRow("Dietary Fibre", image01GroundTruth.dietaryFibre, meal.totals.totalFibre, "g");
    printRow("Sodium", image01GroundTruth.sodium, meal.totals.sodium, "mg");
    printRow("Total Sugar", image01GroundTruth.totalSugar, meal.totals.totalSugar, "g");
    printRow("Added Sugar", image01GroundTruth.addedSugar, meal.totals.addedSugar, "g");
    printRow("Potassium", image01GroundTruth.potassium, meal.totals.potassium, "mg");
    printRow("Calcium", image01GroundTruth.calcium, meal.totals.calcium, "mg");
    printRow("Iron", image01GroundTruth.iron, meal.totals.iron, "mg");
    printRow("Magnesium", image01GroundTruth.magnesium, meal.totals.magnesium, "mg");
    printRow("Vitamin D", image01GroundTruth.vitaminD, meal.totals.vitaminD, "mcg");

    console.log("\n==========================================================================================");
    console.log("THE 15 SUMMARY MICRONUTRIENTS (Ground Truth vs Scout Direct Output)");
    console.log("==========================================================================================");
    console.log(`| #  | Nutrient            | Ground Truth | Scout Output | Unit | Accuracy Rating |`);
    console.log(`|----|---------------------|:------------:|:------------:|:----:|:---------------:|`);

    const summaryList = [
      { name: "Soluble Fibre", gt: image01GroundTruth.solubleFibre, pred: meal.totals.solubleFibre, unit: "g" },
      { name: "Vitamin A", gt: image01GroundTruth.vitaminA, pred: meal.totals.vitaminA, unit: "mcg" },
      { name: "Thiamine (B1)", gt: image01GroundTruth.thiamine, pred: meal.totals.thiamine, unit: "mg" },
      { name: "Riboflavin (B2)", gt: image01GroundTruth.riboflavin, pred: meal.totals.riboflavin, unit: "mg" },
      { name: "Niacin (B3)", gt: image01GroundTruth.niacin, pred: meal.totals.niacin, unit: "mg" },
      { name: "Vitamin B6", gt: image01GroundTruth.vitaminB6, pred: meal.totals.vitaminB6, unit: "mg" },
      { name: "Folate (B9)", gt: image01GroundTruth.folate, pred: meal.totals.folate, unit: "mcg" },
      { name: "Vitamin B12", gt: image01GroundTruth.vitaminB12, pred: meal.totals.vitaminB12, unit: "mcg" },
      { name: "Vitamin C", gt: image01GroundTruth.vitaminC, pred: meal.totals.vitaminC, unit: "mg" },
      { name: "Vitamin E", gt: image01GroundTruth.vitaminE, pred: meal.totals.vitaminE, unit: "mg" },
      { name: "Vitamin K", gt: image01GroundTruth.vitaminK, pred: meal.totals.vitaminK, unit: "mcg" },
      { name: "Zinc", gt: image01GroundTruth.zinc, pred: meal.totals.zinc, unit: "mg" },
      { name: "Selenium", gt: image01GroundTruth.selenium, pred: meal.totals.selenium, unit: "mcg" },
      { name: "Iodine", gt: image01GroundTruth.iodine, pred: meal.totals.iodine, unit: "mcg" },
      { name: "Phosphorus", gt: image01GroundTruth.phosphorus, pred: meal.totals.phosphorus, unit: "mg" },
    ];

    summaryList.forEach((item, idx) => {
      const pct = item.gt > 0 ? (item.pred / item.gt) * 100 : 100;
      let rating = "Good";
      if (pct >= 80 && pct <= 120) rating = "Excellent (±20%)";
      else if (pct >= 60 && pct <= 140) rating = "Good (±40%)";
      else rating = "Moderate";

      console.log(
        `| ${(idx + 1 + "").padStart(2)} | ${item.name.padEnd(19)} | ${(item.gt + "").padStart(12)} | ${(item.pred + "").padStart(12)} | ${item.unit.padEnd(4)} | ${rating.padEnd(15)} |`
      );
    });

    console.log("\n==========================================================================================");
    console.log("PROTOTYPE EXECUTION COMPLETED SUCCESSFULLY");
    console.log("==========================================================================================");

    return { scoutOutput, meal, elapsedMs };
  } catch (error: any) {
    console.error("Error executing prototype:", error);
    process.exit(1);
  }
}

runMealPrototypeOnImage1();
