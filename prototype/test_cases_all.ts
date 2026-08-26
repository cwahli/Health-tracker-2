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

interface TestCase {
  id: string;
  name: string;
  imageFiles: string[];
  userPrompt: string;
  groundTruth: {
    weight: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    satFat: number;
    fibre: number;
    sodium: number;
  };
}

const allTestCases: TestCase[] = [
  {
    id: "01",
    name: "01: YOLK Chicken Sandwich & Roasted Sides (Brand: Yolk)",
    imageFiles: ["prototype/images/01_yolk_panini_wrap.jpg"],
    userPrompt: "I had it from Yolk",
    groundTruth: {
      weight: 600,
      calories: 950,
      protein: 49.0,
      carbs: 92.0,
      fat: 42.0,
      satFat: 8.5,
      fibre: 11.5,
      sodium: 1250,
    },
  },
  {
    id: "02",
    name: "02: Lidl Chicken Bites & Chocolate Muffin (Brand: Lidl)",
    imageFiles: ["prototype/images/02_lidl_chicken_muffin.jpg"],
    userPrompt: "Analyze this meal photo from Lidl",
    groundTruth: {
      weight: 195,
      calories: 557,
      protein: 21.7,
      carbs: 58.0,
      fat: 26.5,
      satFat: 7.5,
      fibre: 3.0,
      sodium: 628,
    },
  },
  {
    id: "03",
    name: "03: Salmon Sushi Roll, Shrimp Pasta Salad & Demi-Baguette",
    imageFiles: ["prototype/images/03_sushi_shrimp_salad.jpg"],
    userPrompt: "Analyze this meal photo",
    groundTruth: {
      weight: 650,
      calories: 1000,
      protein: 55.5,
      carbs: 134.0,
      fat: 25.0,
      satFat: 5.5,
      fibre: 9.5,
      sodium: 1350,
    },
  },
  {
    id: "04",
    name: "04: Berry Parfait, Pastries & Cobb Salad",
    imageFiles: ["prototype/images/04_seaside_fish_chips.jpg"],
    userPrompt: "Analyze this meal photo with parfait, pastries, and salad",
    groundTruth: {
      weight: 1000,
      calories: 1630,
      protein: 75.0,
      carbs: 148.0,
      fat: 80.0,
      satFat: 26.0,
      fibre: 18.0,
      sodium: 1450,
    },
  },
  {
    id: "05",
    name: "05: Airline Breakfast Tray (Congee, Croissant, Cake, Coffee)",
    imageFiles: ["prototype/images/05_cafe_waffles_coffee.jpg"],
    userPrompt: "Analyze this airline breakfast meal tray",
    groundTruth: {
      weight: 640,
      calories: 838,
      protein: 23.0,
      carbs: 104.0,
      fat: 37.0,
      satFat: 19.0,
      fibre: 3.5,
      sodium: 520,
    },
  },
  {
    id: "06",
    name: "06: Mie Gacoan (Mie Suit, Siomay, Es Petak Umpet)",
    imageFiles: ["prototype/images/06_indonesian_menu_page_1.jpg", "prototype/images/06_indonesian_menu_page_2.jpg"],
    userPrompt: "Analyze this Indonesian noodle meal and receipt from Mie Gacoan",
    groundTruth: {
      weight: 570,
      calories: 780,
      protein: 27.0,
      carbs: 111.0,
      fat: 25.0,
      satFat: 5.0,
      fibre: 4.0,
      sodium: 1250,
    },
  },
  {
    id: "07",
    name: "07: Fresh Fruit Plate & Greek Yogurt Oats Mug",
    imageFiles: ["prototype/images/07_sainsbury_oat_fruits.jpg"],
    userPrompt: "Analyze this fresh fruit and yogurt oats meal",
    groundTruth: {
      weight: 550,
      calories: 442,
      protein: 14.2,
      carbs: 89.0,
      fat: 5.3,
      satFat: 1.8,
      fibre: 12.6,
      sodium: 65,
    },
  },
  {
    id: "08",
    name: "08: Sunrise Rolled Oats Porridge (Direct Label)",
    imageFiles: ["prototype/images/08_rolled_oats_1.jpg", "prototype/images/08_rolled_oats_2.jpg"],
    userPrompt: "Analyze this rolled oats porridge with its nutrition facts label",
    groundTruth: {
      weight: 220,
      calories: 212,
      protein: 5.0,
      carbs: 35.0,
      fat: 5.8,
      satFat: 0.8,
      fibre: 5.0,
      sodium: 0,
    },
  },
  {
    id: "09",
    name: "09: Sizzling Steak & Fish & Chips Plates",
    imageFiles: ["prototype/images/09_steak_fish_chips_1.jpg", "prototype/images/09_steak_fish_chips_2.jpg"],
    userPrompt: "Analyze these two sizzling and fried meal plates with drink",
    groundTruth: {
      weight: 1135,
      calories: 1340,
      protein: 78.0,
      carbs: 102.0,
      fat: 67.0,
      satFat: 16.0,
      fibre: 10.0,
      sodium: 1850,
    },
  },
  {
    id: "10",
    name: "10: Indonesian Beef Hotpot (Barcoded Groceries)",
    imageFiles: ["prototype/images/10_beef_soup_barcode_meal_0.jpg", "prototype/images/10_beef_soup_barcode_meal_1.jpg"],
    userPrompt: "Analyze this home cooked beef soup meal from Hari Hari Lokasari grocery barcodes",
    groundTruth: {
      weight: 825,
      calories: 616,
      protein: 65.2,
      carbs: 45.9,
      fat: 23.5,
      satFat: 6.2,
      fibre: 17.8,
      sodium: 380,
    },
  },
];

async function runBenchmarkCases() {
  console.log("==========================================================================================");
  console.log("MASTER SCOUT BENCHMARK: ALL 10 BENCHMARK IMAGE SETS");
  console.log("Model: gemini-3.5-flash-lite");
  console.log("==========================================================================================\n");

  const results: any[] = [];

  for (const tc of allTestCases) {
    console.log(`\n==========================================================================================`);
    console.log(`RUNNING CASE ${tc.id}: ${tc.name}`);
    console.log(`==========================================================================================`);

    const contents: any[] = [];
    for (const imgPath of tc.imageFiles) {
      if (!fs.existsSync(imgPath)) {
        console.error(`Image not found: ${imgPath}`);
        continue;
      }
      const buf = fs.readFileSync(imgPath);
      contents.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: buf.toString("base64"),
        },
      });
    }

    contents.push({ text: tc.userPrompt });

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

      const rawJson = response.text || "{}";
      const parsed = JSON.parse(rawJson);

      const mealSummary = calculateMealNutrients(parsed.dishes || []);

      console.log(`[Scout Detected Dishes: ${mealSummary.dishes.length} | Latency: ${elapsed}ms]`);
      for (let i = 0; i < mealSummary.dishes.length; i++) {
        const d = mealSummary.dishes[i];
        console.log(`  ${i + 1}. ${d.dishName} (${d.estimatedWeightGrams}g, Brand: ${d.chainName || "None"}) -> ${d.calories} kcal (P: ${d.protein}g, C: ${d.carbohydrates}g, F: ${d.totalFat}g, Sat: ${d.saturatedFat}g)`);
      }

      const t = mealSummary.totals;
      const g = tc.groundTruth;

      const calDelta = Math.round(((t.calories - g.calories) / g.calories) * 100);
      const pDelta = Math.round(((t.protein - g.protein) / g.protein) * 100);
      const cDelta = Math.round(((t.carbohydrates - g.carbs) / g.carbs) * 100);
      const fDelta = Math.round(((t.totalFat - g.fat) / g.fat) * 100);

      results.push({
        case: tc.id,
        name: tc.name.split(":")[1]?.trim() || tc.name,
        dishes: mealSummary.dishes.length,
        scoutCal: t.calories,
        truthCal: g.calories,
        calDelta: `${calDelta >= 0 ? "+" : ""}${calDelta}%`,
        scoutP: `${t.protein}g`,
        truthP: `${g.protein}g`,
        pDelta: `${pDelta >= 0 ? "+" : ""}${pDelta}%`,
        scoutC: `${t.carbohydrates}g`,
        truthC: `${g.carbs}g`,
        cDelta: `${cDelta >= 0 ? "+" : ""}${cDelta}%`,
        scoutF: `${t.totalFat}g`,
        truthF: `${g.fat}g`,
        fDelta: `${fDelta >= 0 ? "+" : ""}${fDelta}%`,
        latency: `${elapsed}ms`,
      });
    } catch (err: any) {
      console.error(`Error in Case ${tc.id}:`, err.message);
    }
  }

  console.log("\n==========================================================================================");
  console.log("MASTER SCORECARD: ALL 10 CASES");
  console.log("==========================================================================================");
  console.table(results.map(r => ({
    Case: r.case,
    Name: r.name.substring(0, 32),
    Dishes: r.dishes,
    "Scout kcal": r.scoutCal,
    "Truth kcal": r.truthCal,
    "Cal Delta": r.calDelta,
    "Scout P": r.scoutP,
    "Truth P": r.truthP,
    "Scout C": r.scoutC,
    "Truth C": r.truthC,
    "Scout F": r.scoutF,
    "Truth F": r.truthF,
    Latency: r.latency,
  })));
}

runBenchmarkCases();
