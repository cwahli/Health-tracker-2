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

interface TestCase {
  id: number;
  imageFileName: string;
  userPrompt: string;
  groundTruth: {
    caseName: string;
    weightGrams: number;
    calories: number;
    protein: number;
    carbohydrates: number;
    totalFat: number;
    saturatedFat: number;
    dietaryFibre: number;
    sodium: number;
    totalSugar: number;
    addedSugar: number;
    potassium: number;
    calcium: number;
    iron: number;
    magnesium: number;
    vitaminD: number;
    // 15 requested summary nutrients
    solubleFibre: number;
    vitaminA: number;
    thiamine: number;
    riboflavin: number;
    niacin: number;
    vitaminB6: number;
    folate: number;
    vitaminB12: number;
    vitaminC: number;
    vitaminE: number;
    vitaminK: number;
    zinc: number;
    selenium: number;
    iodine: number;
    phosphorus: number;
  };
}

const testCases: TestCase[] = [
  {
    id: 2,
    imageFileName: "02_lidl_chicken_muffin.jpg",
    userPrompt: "I had these from Lidl",
    groundTruth: {
      caseName: "02: Lidl Chicken Bites & Double Chocolate Muffin",
      weightGrams: 195,
      calories: 557,
      protein: 21.7,
      carbohydrates: 58.0,
      totalFat: 26.5,
      saturatedFat: 7.5,
      dietaryFibre: 3.0,
      sodium: 628,
      totalSugar: 28.4,
      addedSugar: 22.0,
      potassium: 440,
      calcium: 65,
      iron: 2.4,
      magnesium: 55,
      vitaminD: 0.1,
      solubleFibre: 0.8,
      vitaminA: 25,
      thiamine: 0.22,
      riboflavin: 0.18,
      niacin: 6.8,
      vitaminB6: 0.42,
      folate: 45,
      vitaminB12: 0.4,
      vitaminC: 2,
      vitaminE: 1.8,
      vitaminK: 12,
      zinc: 1.9,
      selenium: 18,
      iodine: 14,
      phosphorus: 260,
    },
  },
  {
    id: 3,
    imageFileName: "03_sushi_shrimp_salad.jpg",
    userPrompt: "My lunch today",
    groundTruth: {
      caseName: "03: Salmon Sushi Roll, Shrimp Pasta Salad & Demi-Baguette",
      weightGrams: 650,
      calories: 1000,
      protein: 55.5,
      carbohydrates: 134.0,
      totalFat: 25.0,
      saturatedFat: 5.5,
      dietaryFibre: 9.5,
      sodium: 1350,
      totalSugar: 12.0,
      addedSugar: 5.0,
      potassium: 920,
      calcium: 180,
      iron: 5.2,
      magnesium: 135,
      vitaminD: 3.5,
      solubleFibre: 2.4,
      vitaminA: 95,
      thiamine: 0.45,
      riboflavin: 0.38,
      niacin: 11.2,
      vitaminB6: 0.85,
      folate: 130,
      vitaminB12: 3.8,
      vitaminC: 18,
      vitaminE: 3.8,
      vitaminK: 45,
      zinc: 3.8,
      selenium: 65,
      iodine: 110,
      phosphorus: 540,
    },
  },
  {
    id: 4,
    imageFileName: "04_seaside_fish_chips.jpg",
    userPrompt: "Park takeaway with salad, parfait, and pastries",
    groundTruth: {
      caseName: "04: Berry Yogurt Parfait, Bakery Pastries & Cobb Salad",
      weightGrams: 1000,
      calories: 1630,
      protein: 75.0,
      carbohydrates: 148.0,
      totalFat: 80.0,
      saturatedFat: 26.0,
      dietaryFibre: 18.0,
      sodium: 1450,
      totalSugar: 52.0,
      addedSugar: 28.0,
      potassium: 1850,
      calcium: 480,
      iron: 7.8,
      magnesium: 210,
      vitaminD: 2.8,
      solubleFibre: 5.5,
      vitaminA: 320,
      thiamine: 0.65,
      riboflavin: 0.72,
      niacin: 15.8,
      vitaminB6: 1.4,
      folate: 210,
      vitaminB12: 2.2,
      vitaminC: 45,
      vitaminE: 7.2,
      vitaminK: 140,
      zinc: 5.2,
      selenium: 78,
      iodine: 65,
      phosphorus: 850,
    },
  },
  {
    id: 5,
    imageFileName: "05_cafe_waffles_coffee.jpg",
    userPrompt: "Inflight meal tray",
    groundTruth: {
      caseName: "05: Airline Breakfast Tray (Congee, Croissant, Mousse Cake & Coffee)",
      weightGrams: 638,
      calories: 838,
      protein: 23.0,
      carbohydrates: 104.0,
      totalFat: 37.0,
      saturatedFat: 19.0,
      dietaryFibre: 3.5,
      sodium: 520,
      totalSugar: 48.0,
      addedSugar: 35.0,
      potassium: 560,
      calcium: 190,
      iron: 2.6,
      magnesium: 58,
      vitaminD: 0.6,
      solubleFibre: 1.0,
      vitaminA: 210,
      thiamine: 0.24,
      riboflavin: 0.35,
      niacin: 4.8,
      vitaminB6: 0.38,
      folate: 65,
      vitaminB12: 0.7,
      vitaminC: 3,
      vitaminE: 1.6,
      vitaminK: 15,
      zinc: 1.8,
      selenium: 22,
      iodine: 32,
      phosphorus: 310,
    },
  },
];

async function runTestCase(tc: TestCase) {
  console.log(`\n==========================================================================================`);
  console.log(`RUNNING TEST CASE ${tc.id}: ${tc.groundTruth.caseName}`);
  console.log(`==========================================================================================`);

  const imgPath = path.join(imagesDir, tc.imageFileName);
  if (!fs.existsSync(imgPath)) {
    console.error(`Image file not found: ${imgPath}`);
    return null;
  }

  const imageBase64 = fs.readFileSync(imgPath).toString("base64");
  const parts = [
    {
      inlineData: {
        mimeType: "image/jpeg",
        data: imageBase64,
      },
    },
    {
      text: `${tc.userPrompt}. Identify all distinct dishes and constituent foods with weights and 6 core nutrients (protein, saturatedFat, addedSugar, totalFibre, sodium, carbohydrates). Provide dish-level dishNutrients (saturatedFat, totalFat, totalSugar, potassium, omega3, calcium, iron, magnesium, vitaminD). Generate a clinical verdict with severity level (good | warning | alert | neutral), a constructive 4-beat user message, and meal summary totals for the 15 micronutrients (solubleFibre, vitaminA, thiamine, riboflavin, niacin, vitaminB6, folate, vitaminB12, vitaminC, vitaminE, vitaminK, zinc, selenium, iodine, phosphorus).`,
    },
  ];

  const t0 = Date.now();
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

  console.log(`Execution Time:       ${elapsedMs} ms`);
  console.log(`Meal Name:            ${meal.mealName}`);
  console.log(`Dining Environment:   ${meal.diningEnvironment}`);
  console.log(`Dishes Count:         ${meal.dishes.length} dishes detected`);
  console.log(`VERDICT:              [${meal.verdict.level.toUpperCase()}] ${meal.verdict.label}`);
  console.log(`MESSAGE:              ${meal.message}`);

  console.log(`\nDishes Extracted:`);
  meal.dishes.forEach((d, idx) => {
    console.log(`  [${idx + 1}] ${d.dishName} (${d.estimatedWeightGrams}g, ${d.cookingMethod}) -> ${d.calories} kcal, ${d.protein}g P, ${d.carbohydrates}g C, ${d.totalFat}g F, ${d.sodium}mg Na`);
    d.foods.forEach((f) => {
      console.log(`      * ${f.foodName}: ${f.estimatedWeightGrams}g (P:${f.protein}g, C:${f.carbohydrates}g, SatF:${f.saturatedFat}g, Na:${f.sodium}mg)`);
    });
  });

  console.log(`\nCore Nutrient Accuracy Comparison:`);
  console.log(`| Nutrient          | Ground Truth | Scout Output | Delta (%) |`);
  console.log(`|-------------------|:------------:|:------------:|:---------:|`);
  const printRow = (label: string, gt: number, pred: number, unit: string) => {
    const delta = gt > 0 ? (((pred - gt) / gt) * 100).toFixed(1) : "0.0";
    const deltaStr = Number(delta) >= 0 ? `+${delta}%` : `${delta}%`;
    console.log(`| ${label.padEnd(17)} | ${(gt + " " + unit).padStart(12)} | ${(pred + " " + unit).padStart(12)} | ${deltaStr.padStart(9)} |`);
  };

  const gt = tc.groundTruth;
  printRow("Weight", gt.weightGrams, meal.totalMealWeightGrams, "g");
  printRow("Calories", gt.calories, meal.totals.calories, "kcal");
  printRow("Protein", gt.protein, meal.totals.protein, "g");
  printRow("Carbohydrates", gt.carbohydrates, meal.totals.carbohydrates, "g");
  printRow("Total Fat", gt.totalFat, meal.totals.totalFat, "g");
  printRow("Saturated Fat", gt.saturatedFat, meal.totals.saturatedFat, "g");
  printRow("Dietary Fibre", gt.dietaryFibre, meal.totals.totalFibre, "g");
  printRow("Sodium", gt.sodium, meal.totals.sodium, "mg");
  printRow("Total Sugar", gt.totalSugar, meal.totals.totalSugar, "g");
  printRow("Added Sugar", gt.addedSugar, meal.totals.addedSugar, "g");

  console.log(`\n15 Summary Micronutrients:`);
  console.log(`| #  | Nutrient            | Ground Truth | Scout Output | Unit | Accuracy Rating |`);
  console.log(`|----|---------------------|:------------:|:------------:|:----:|:---------------:|`);
  const summaryList = [
    { name: "Soluble Fibre", gt: gt.solubleFibre, pred: meal.totals.solubleFibre, unit: "g" },
    { name: "Vitamin A", gt: gt.vitaminA, pred: meal.totals.vitaminA, unit: "mcg" },
    { name: "Thiamine (B1)", gt: gt.thiamine, pred: meal.totals.thiamine, unit: "mg" },
    { name: "Riboflavin (B2)", gt: gt.riboflavin, pred: meal.totals.riboflavin, unit: "mg" },
    { name: "Niacin (B3)", gt: gt.niacin, pred: meal.totals.niacin, unit: "mg" },
    { name: "Vitamin B6", gt: gt.vitaminB6, pred: meal.totals.vitaminB6, unit: "mg" },
    { name: "Folate (B9)", gt: gt.folate, pred: meal.totals.folate, unit: "mcg" },
    { name: "Vitamin B12", gt: gt.vitaminB12, pred: meal.totals.vitaminB12, unit: "mcg" },
    { name: "Vitamin C", gt: gt.vitaminC, pred: meal.totals.vitaminC, unit: "mg" },
    { name: "Vitamin E", gt: gt.vitaminE, pred: meal.totals.vitaminE, unit: "mg" },
    { name: "Vitamin K", gt: gt.vitaminK, pred: meal.totals.vitaminK, unit: "mcg" },
    { name: "Zinc", gt: gt.zinc, pred: meal.totals.zinc, unit: "mg" },
    { name: "Selenium", gt: gt.selenium, pred: meal.totals.selenium, unit: "mcg" },
    { name: "Iodine", gt: gt.iodine, pred: meal.totals.iodine, unit: "mcg" },
    { name: "Phosphorus", gt: gt.phosphorus, pred: meal.totals.phosphorus, unit: "mg" },
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

  return { tc, meal, elapsedMs };
}

async function runAll() {
  console.log("==========================================================================================");
  console.log("SCOUT DIRECT COMPLETE MEAL PROTOTYPE — BATCH TEST (IMAGES 2 TO 5)");
  console.log("Model: gemini-3.5-flash-lite");
  console.log("==========================================================================================");

  for (const tc of testCases) {
    try {
      await runTestCase(tc);
    } catch (e: any) {
      console.error(`Error on case ${tc.id}:`, e);
    }
  }

  console.log("\n==========================================================================================");
  console.log("ALL BATCH TEST CASES (IMAGES 2 TO 5) COMPLETED");
  console.log("==========================================================================================");
}

runAll();
