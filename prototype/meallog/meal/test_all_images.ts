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

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error("ERROR: GEMINI_API_KEY is not set.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const imagesDir = path.join(process.cwd(), "prototype", "meallog", "images");

interface TestCase {
  id: number;
  imageFileNames: string[];
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
  };
}

const testCases: TestCase[] = [
  {
    id: 1,
    imageFileNames: ["01_yolk_panini_wrap.jpg"],
    userPrompt: "I had this for lunch",
    groundTruth: {
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
    },
  },
  {
    id: 2,
    imageFileNames: ["02_lidl_chicken_muffin.jpg"],
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
    },
  },
  {
    id: 3,
    imageFileNames: ["03_sushi_shrimp_salad.jpg"],
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
    },
  },
  {
    id: 4,
    imageFileNames: ["04_seaside_fish_chips.jpg"],
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
    },
  },
  {
    id: 5,
    imageFileNames: ["05_cafe_waffles_coffee.jpg"],
    userPrompt: "Inflight meal tray",
    groundTruth: {
      caseName: "05: Airline Breakfast Tray (Congee, Croissant, Mousse Cake & Coffee)",
      weightGrams: 640,
      calories: 838,
      protein: 23.0,
      carbohydrates: 104.0,
      totalFat: 37.0,
      saturatedFat: 19.0,
      dietaryFibre: 3.5,
      sodium: 520,
      totalSugar: 48.0,
      addedSugar: 35.0,
    },
  },
  {
    id: 6,
    imageFileNames: ["06_indonesian_menu_page_1.jpg", "06_indonesian_menu_page_2.jpg"],
    userPrompt: "Mie Gacoan Indonesian noodle meal",
    groundTruth: {
      caseName: "06: Mie Gacoan (Mie Suit, Siomay, Es Petak Umpet)",
      weightGrams: 570,
      calories: 780,
      protein: 27.0,
      carbohydrates: 111.0,
      totalFat: 25.0,
      saturatedFat: 5.0,
      dietaryFibre: 4.0,
      sodium: 1250,
      totalSugar: 35.0,
      addedSugar: 30.0,
    },
  },
  {
    id: 7,
    imageFileNames: ["07_sainsbury_oat_fruits.jpg"],
    userPrompt: "Fresh fruit plate and Greek yogurt oats mug",
    groundTruth: {
      caseName: "07: Fruit Plate & Greek Yogurt Oats Mug",
      weightGrams: 550,
      calories: 442,
      protein: 14.2,
      carbohydrates: 89.0,
      totalFat: 5.3,
      saturatedFat: 1.8,
      dietaryFibre: 12.6,
      sodium: 65,
      totalSugar: 54.0,
      addedSugar: 0.0,
    },
  },
  {
    id: 8,
    imageFileNames: ["08_rolled_oats_1.jpg", "08_rolled_oats_2.jpg"],
    userPrompt: "Sunrise rolled oats porridge with nutrition label",
    groundTruth: {
      caseName: "08: Sunrise Rolled Oats Porridge",
      weightGrams: 220,
      calories: 212,
      protein: 5.0,
      carbohydrates: 35.0,
      totalFat: 5.8,
      saturatedFat: 0.8,
      dietaryFibre: 5.0,
      sodium: 0,
      totalSugar: 0.0,
      addedSugar: 0.0,
    },
  },
  {
    id: 9,
    imageFileNames: ["09_steak_fish_chips_1.jpg", "09_steak_fish_chips_2.jpg"],
    userPrompt: "Sizzling pepper steak, fish & chips, and iced tea",
    groundTruth: {
      caseName: "09: Sizzling Pepper Steak & Fish and Chips Plates",
      weightGrams: 1135,
      calories: 1340,
      protein: 78.0,
      carbohydrates: 102.0,
      totalFat: 67.0,
      saturatedFat: 16.0,
      dietaryFibre: 10.0,
      sodium: 1850,
      totalSugar: 32.0,
      addedSugar: 25.0,
    },
  },
  {
    id: 10,
    imageFileNames: ["10_beef_soup_barcode_meal_0.jpg", "10_beef_soup_barcode_meal_1.jpg"],
    userPrompt: "Indonesian beef hotpot ingredients with price stickers and barcodes from Hari Hari Lokasari",
    groundTruth: {
      caseName: "10: Indonesian Beef Hotpot (Barcoded Groceries)",
      weightGrams: 825,
      calories: 616,
      protein: 65.2,
      carbohydrates: 45.9,
      totalFat: 23.5,
      saturatedFat: 6.2,
      dietaryFibre: 17.8,
      sodium: 380,
      totalSugar: 12.4,
      addedSugar: 0.0,
    },
  },
  {
    id: 11,
    imageFileNames: [
      "11_seafood_squid_fish_ingredients.jpg",
      "11_seafood_squid_fish_receipt_1.jpg",
      "11_seafood_squid_fish_receipt_2.jpg",
    ],
    userPrompt: "I had [Mr Oat Rolled Oats 70g] and all food in the pictures",
    groundTruth: {
      caseName: "11: Seafood & Vegetable Hotpot with Oats",
      weightGrams: 892,
      calories: 822,
      protein: 95.1,
      carbohydrates: 69.0,
      totalFat: 20.8,
      saturatedFat: 4.6,
      dietaryFibre: 12.2,
      sodium: 473,
      totalSugar: 3.5,
      addedSugar: 0.0,
    },
  },
];

async function runTestCase(tc: TestCase) {
  console.log(`\n==========================================================================================`);
  console.log(`RUNNING TEST CASE ${tc.id}: ${tc.groundTruth.caseName}`);
  console.log(`==========================================================================================`);

  const parts: any[] = [];
  for (const fn of tc.imageFileNames) {
    const imgPath = path.join(imagesDir, fn);
    if (!fs.existsSync(imgPath)) {
      console.error(`Image file not found: ${imgPath}`);
      return null;
    }
    const b64 = fs.readFileSync(imgPath).toString("base64");
    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: b64,
      },
    });
  }

  parts.push({
    text: `${tc.userPrompt}. Identify all distinct dishes and constituent foods with weights and 6 core nutrients (protein, saturatedFat, addedSugar, totalFibre, sodium, carbohydrates). Provide dish-level dishNutrients (saturatedFat, totalFat, totalSugar, potassium, omega3, calcium, iron, magnesium, vitaminD). Include bounding boxes for detected dishes/items when identifiable. Generate a clinical verdict with severity level (good | warning | alert | neutral), a constructive 4-beat user message, and meal summary totals for the 15 micronutrients (solubleFibre, vitaminA, thiamine, riboflavin, niacin, vitaminB6, folate, vitaminB12, vitaminC, vitaminE, vitaminK, zinc, selenium, iodine, phosphorus).`,
  });

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

  console.log(`\nDishes & Bounding Boxes Extracted:`);
  meal.dishes.forEach((d, idx) => {
    const bboxStr = d.boundingBox2D ? ` [bbox: ${JSON.stringify(d.boundingBox2D)}]` : " [no bbox]";
    console.log(`  [${idx + 1}] ${d.dishName} (${d.estimatedWeightGrams}g, ${d.cookingMethod})${bboxStr} -> ${d.calories} kcal, ${d.protein}g P, ${d.carbohydrates}g C, ${d.totalFat}g F, ${d.sodium}mg Na`);
    d.foods.forEach((f) => {
      console.log(`      * ${f.foodName}: ${f.estimatedWeightGrams}g (P:${f.protein}g, C:${f.carbohydrates}g, SatF:${f.saturatedFat}g, Na:${f.sodium}mg)`);
    });
  });

  const calcAcc = (gt: number, pred: number) => {
    if (gt === 0) return pred === 0 ? 100 : Math.max(0, 100 - pred * 10);
    const diff = Math.abs(pred - gt);
    return Math.max(0, Math.min(100, (1 - diff / gt) * 100));
  };

  const gt = tc.groundTruth;
  const calAcc = calcAcc(gt.calories, meal.totals.calories);
  const pAcc = calcAcc(gt.protein, meal.totals.protein);
  const cAcc = calcAcc(gt.carbohydrates, meal.totals.carbohydrates);
  const fAcc = calcAcc(gt.totalFat, meal.totals.totalFat);
  const naAcc = calcAcc(gt.sodium, meal.totals.sodium);
  const wAcc = calcAcc(gt.weightGrams, meal.totalMealWeightGrams);

  console.log(`\nAccuracy Summary:`);
  console.log(`  Weight Accuracy:   ${wAcc.toFixed(1)}% (GT: ${gt.weightGrams}g, Pred: ${meal.totalMealWeightGrams}g)`);
  console.log(`  Calories Accuracy: ${calAcc.toFixed(1)}% (GT: ${gt.calories} kcal, Pred: ${meal.totals.calories} kcal)`);
  console.log(`  Protein Accuracy:  ${pAcc.toFixed(1)}% (GT: ${gt.protein}g, Pred: ${meal.totals.protein}g)`);
  console.log(`  Carbs Accuracy:    ${cAcc.toFixed(1)}% (GT: ${gt.carbohydrates}g, Pred: ${meal.totals.carbohydrates}g)`);
  console.log(`  Fat Accuracy:      ${fAcc.toFixed(1)}% (GT: ${gt.totalFat}g, Pred: ${meal.totals.totalFat}g)`);
  console.log(`  Sodium Accuracy:   ${naAcc.toFixed(1)}% (GT: ${gt.sodium}mg, Pred: ${meal.totals.sodium}mg)`);

  return {
    tc,
    meal,
    elapsedMs,
    acc: { calAcc, pAcc, cAcc, fAcc, naAcc, wAcc },
  };
}

async function runAll() {
  console.log("==========================================================================================");
  console.log("FULL BENCHMARK EVALUATION — ALL 11 IMAGE TEST CASES");
  console.log("Model: gemini-3.5-flash-lite (with 8s rate-limit pacing)");
  console.log("==========================================================================================");

  const summaryResults: any[] = [];

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    if (i > 0) {
      console.log("\n[Rate Limiting] Waiting 8 seconds before next API call...");
      await new Promise((res) => setTimeout(res, 8000));
    }

    let retries = 3;
    let success = false;
    while (retries > 0 && !success) {
      try {
        const res = await runTestCase(tc);
        if (res) summaryResults.push(res);
        success = true;
      } catch (e: any) {
        console.error(`Error on case ${tc.id}:`, e?.message || e);
        if (e?.status === 429 || e?.message?.includes("429") || e?.message?.includes("quota")) {
          console.log("[429 Rate Limit Hit] Backing off for 12 seconds...");
          await new Promise((res) => setTimeout(res, 12000));
          retries--;
        } else {
          break;
        }
      }
    }
  }

  console.log("\n\n==========================================================================================");
  console.log("BENCHMARK MASTER SUMMARY TABLE (ALL 11 CASES)");
  console.log("==========================================================================================");
  console.log(
    `| Case | Name | Weight Acc | Calorie Acc | Protein Acc | Fat Acc | Sodium Acc | Over/Under 90% Threshold |`
  );
  console.log(
    `|:----:|:-----------------------------------|:----------:|:-----------:|:-----------:|:-------:|:----------:|:-------------------------:|`
  );

  summaryResults.forEach((r) => {
    const c = r.acc;
    const below90List: string[] = [];
    if (c.calAcc < 90) below90List.push(`Cal (${c.calAcc.toFixed(0)}%)`);
    if (c.pAcc < 90) below90List.push(`P (${c.pAcc.toFixed(0)}%)`);
    if (c.fAcc < 90) below90List.push(`F (${c.fAcc.toFixed(0)}%)`);
    if (c.naAcc < 90) below90List.push(`Na (${c.naAcc.toFixed(0)}%)`);

    const status = below90List.length === 0 ? "✅ ALL ≥ 90%" : `⚠️ Below 90%: ${below90List.join(", ")}`;

    console.log(
      `| ${String(r.tc.id).padStart(2)} | ${r.tc.groundTruth.caseName.padEnd(34)} | ${c.wAcc.toFixed(1)}% | ${c.calAcc.toFixed(1)}% | ${c.pAcc.toFixed(1)}% | ${c.fAcc.toFixed(1)}% | ${c.naAcc.toFixed(1)}% | ${status} |`
    );
  });
}

runAll();
