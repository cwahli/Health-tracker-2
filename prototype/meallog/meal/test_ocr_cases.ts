import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { scoutMealSystemInstruction, scoutMealResponseSchema } from "./scout_meal_instructions.ts";
import { calculateCompleteMeal, ProcessedCompleteMeal, ScoutMealResponse } from "./meal_nutrient_calculator.ts";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error("ERROR: GEMINI_API_KEY is not set.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const imagesDir = path.join(process.cwd(), "prototype", "meallog", "images");

const ocrTestCases = [
  {
    id: 2,
    fileName: ["02_lidl_chicken_muffin.jpg"],
    prompt: "I had these from Lidl",
    caseName: "02: Lidl Packaged Foods",
    ocrFocus: "Brand name & package size identification ('Lidl')",
    gt: { weight: 195, cal: 557, p: 21.7, c: 58.0, f: 26.5, na: 628 }
  },
  {
    id: 6,
    fileName: ["06_indonesian_menu_page_1.jpg", "06_indonesian_menu_page_2.jpg"],
    prompt: "Mie Gacoan Indonesian noodle meal",
    caseName: "06: Foreign Menu OCR (Mie Gacoan)",
    ocrFocus: "Indonesian menu item names & price list OCR ('Mie Suit', 'Siomay', 'Es Petak Umpet')",
    gt: { weight: 570, cal: 780, p: 27.0, c: 111.0, f: 25.0, na: 1250 }
  },
  {
    id: 8,
    fileName: ["08_rolled_oats_1.jpg", "08_rolled_oats_2.jpg"],
    prompt: "Sunrise rolled oats porridge with nutrition label",
    caseName: "08: Nutrition Label OCR (Sunrise Rolled Oats)",
    ocrFocus: "Back-of-pack Nutrition Facts table OCR (Per 100g & serving size)",
    gt: { weight: 220, cal: 212, p: 5.0, c: 35.0, f: 5.8, na: 0 }
  },
  {
    id: 10,
    fileName: ["10_beef_soup_barcode_meal_0.jpg", "10_beef_soup_barcode_meal_1.jpg"],
    prompt: "Indonesian beef hotpot ingredients with price stickers and barcodes from Hari Hari Lokasari",
    caseName: "10: Price Sticker & Barcode OCR (Hari Hari Lokasari)",
    ocrFocus: "Supermarket price stickers (grams, product code, price) & barcode text",
    gt: { weight: 825, cal: 616, p: 65.2, c: 45.9, f: 23.5, na: 380 }
  },
  {
    id: 11,
    fileName: ["11_seafood_squid_fish_ingredients.jpg", "11_seafood_squid_fish_receipt_1.jpg", "11_seafood_squid_fish_receipt_2.jpg"],
    prompt: "I had [Mr Oat Rolled Oats 70g] and all food in the pictures",
    caseName: "11: Supermarket Receipt OCR + Raw Seafood Ingredients",
    ocrFocus: "Thermal receipt line items ('Squid Ring 200g', 'Fish Fillet 150g') + prompt override",
    gt: { weight: 892, cal: 822, p: 95.1, c: 69.0, f: 20.8, na: 473 }
  }
];

async function runOCRTest() {
  console.log("==========================================================================================");
  console.log("SPECIALIZED OCR & PRECISION AUDIT — SINGLE-AGENT SCOUT EVALUATION");
  console.log("==========================================================================================\n");

  for (let i = 0; i < ocrTestCases.length; i++) {
    const tc = ocrTestCases[i];
    console.log(`\n------------------------------------------------------------------------------------------`);
    console.log(`TEST CASE ${tc.id}: ${tc.caseName}`);
    console.log(`OCR Focus Area: ${tc.ocrFocus}`);
    console.log(`------------------------------------------------------------------------------------------`);

    if (i > 0) {
      await new Promise(r => setTimeout(r, 6000));
    }

    const parts: any[] = [];
    for (const fn of tc.fileName) {
      const imgPath = path.join(imagesDir, fn);
      if (fs.existsSync(imgPath)) {
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: fs.readFileSync(imgPath).toString("base64")
          }
        });
      }
    }

    parts.push({
      text: `${tc.prompt}. Carefully read all visible text, labels, receipts, barcodes, nutrition tables, and price stickers in the images. Identify all distinct dishes and constituent foods with exact weights derived from OCR where visible, and calculate 6 core nutrients.`
    });

    try {
      const t0 = Date.now();
      const res = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: scoutMealSystemInstruction,
          responseMimeType: "application/json",
          responseSchema: scoutMealResponseSchema,
          temperature: 0.1
        }
      });
      const elapsed = Date.now() - t0;

      const raw = JSON.parse(res.text || "{}");
      const meal: ProcessedCompleteMeal = calculateCompleteMeal(raw);

      console.log(`Latency: ${elapsed}ms | Meal: ${meal.mealName}`);
      console.log(`Extracted Dishes & Foods:`);
      meal.dishes.forEach((d, dIdx) => {
        console.log(`  [Dish ${dIdx + 1}] ${d.dishName} (${d.estimatedWeightGrams}g) -> ${d.calories} kcal, P:${d.protein}g, C:${d.carbohydrates}g, F:${d.totalFat}g, Na:${d.sodium}mg`);
        d.foods.forEach(f => {
          console.log(`     * ${f.foodName} (${f.estimatedWeightGrams}g): P:${f.protein}g, C:${f.carbohydrates}g, SatF:${f.saturatedFat}g, Na:${f.sodium}mg`);
        });
      });

      console.log(`\nNutrient Accuracy Comparison vs Ground Truth:`);
      const gt = tc.gt;
      const pred = meal.totals;
      console.log(`  Weight:   ${meal.totalMealWeightGrams}g vs GT ${gt.weight}g (${((meal.totalMealWeightGrams / gt.weight) * 100).toFixed(1)}%)`);
      console.log(`  Calories: ${pred.calories} kcal vs GT ${gt.cal} kcal (${((pred.calories / gt.cal) * 100).toFixed(1)}%)`);
      console.log(`  Protein:  ${pred.protein}g vs GT ${gt.p}g (${((pred.protein / gt.p) * 100).toFixed(1)}%)`);
      console.log(`  Carbs:    ${pred.carbohydrates}g vs GT ${gt.c}g (${((pred.carbohydrates / gt.c) * 100).toFixed(1)}%)`);
      console.log(`  TotalFat: ${pred.totalFat}g vs GT ${gt.f}g (${((pred.totalFat / gt.f) * 100).toFixed(1)}%)`);
      console.log(`  Sodium:   ${pred.sodium}mg vs GT ${gt.na}mg (${((pred.sodium / gt.na) * 100).toFixed(1)}%)`);

    } catch (err: any) {
      console.error(`Error executing OCR case ${tc.id}:`, err.message || err);
    }
  }
}

runOCRTest();
