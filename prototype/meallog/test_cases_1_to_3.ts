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

const testCases: TestCase[] = [
  {
    id: "01",
    name: "01: YOLK Chicken Sandwich & Roasted Sides (Brand: Yolk)",
    imageFiles: ["prototype/meallog/images/01_yolk_panini_wrap.jpg"],
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
    imageFiles: ["prototype/meallog/images/02_lidl_chicken_muffin.jpg"],
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
    imageFiles: ["prototype/meallog/images/03_sushi_shrimp_salad.jpg"],
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
];

async function runPrecisionTests() {
  console.log("==========================================================================================");
  console.log("SCOUT PRECISION BENCHMARK: IMAGE CASES 01 TO 03 (VERIFIED GROUND TRUTH)");
  console.log("Model: gemini-3.5-flash-lite");
  console.log("==========================================================================================\n");

  const results: any[] = [];

  for (const tc of testCases) {
    console.log(`\n==========================================================================================`);
    console.log(`RUNNING CASE ${tc.id}: ${tc.name}`);
    console.log(`Prompt: "${tc.userPrompt}"`);
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

    contents.push({
      text: tc.userPrompt,
    });

    const startTime = Date.now();
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

    console.log(`\n[Scout Detected Dishes: ${mealSummary.dishes.length} | Latency: ${elapsed}ms]`);
    for (let i = 0; i < mealSummary.dishes.length; i++) {
      const d = mealSummary.dishes[i];
      console.log(`  ${i + 1}. ${d.dishName} (${d.estimatedWeightGrams}g, Brand: ${d.chainName || "None"}) -> ${d.calories} kcal (P: ${d.protein}g, C: ${d.carbohydrates}g, F: ${d.totalFat}g, Sat: ${d.saturatedFat}g)`);
      for (const f of d.foods) {
        console.log(`     - ${f.foodName} (${f.estimatedWeightGrams}g): P ${f.protein}g, C ${f.carbohydrates}g, SatFat ${f.saturatedFat}g, Fib ${f.totalFibre}g`);
      }
    }

    const t = mealSummary.totals;
    const g = tc.groundTruth;

    const calDelta = Math.round(((t.calories - g.calories) / g.calories) * 100);
    const pDelta = Math.round(((t.protein - g.protein) / g.protein) * 100);
    const cDelta = Math.round(((t.carbohydrates - g.carbs) / g.carbs) * 100);
    const fDelta = Math.round(((t.totalFat - g.fat) / g.fat) * 100);
    const fibDelta = Math.round(((t.totalFibre - g.fibre) / g.fibre) * 100);
    const sodDelta = Math.round(((t.sodium - g.sodium) / g.sodium) * 100);

    console.log(`\n--- COMPARISON AGAINST VERIFIED GROUND TRUTH ---`);
    console.log(`Weight:   Scout: ${mealSummary.totalMealWeightGrams}g | Truth: ${g.weight}g`);
    console.log(`Calories: Scout: ${t.calories} kcal | Truth: ${g.calories} kcal (Delta: ${calDelta >= 0 ? "+" : ""}${calDelta}%)`);
    console.log(`Protein:  Scout: ${t.protein}g | Truth: ${g.protein}g (Delta: ${pDelta >= 0 ? "+" : ""}${pDelta}%)`);
    console.log(`Carbs:    Scout: ${t.carbohydrates}g | Truth: ${g.carbs}g (Delta: ${cDelta >= 0 ? "+" : ""}${cDelta}%)`);
    console.log(`Fat:      Scout: ${t.totalFat}g (Sat: ${t.saturatedFat}g) | Truth: ${g.fat}g (Sat: ${g.satFat}g) (Delta: ${fDelta >= 0 ? "+" : ""}${fDelta}%)`);
    console.log(`Fibre:    Scout: ${t.totalFibre}g | Truth: ${g.fibre}g (Delta: ${fibDelta >= 0 ? "+" : ""}${fibDelta}%)`);
    console.log(`Sodium:   Scout: ${t.sodium}mg | Truth: ${g.sodium}mg (Delta: ${sodDelta >= 0 ? "+" : ""}${sodDelta}%)`);

    results.push({
      case: tc.id,
      name: tc.name,
      dishes: mealSummary.dishes.length,
      latency: `${elapsed}ms`,
      scoutWeight: mealSummary.totalMealWeightGrams,
      truthWeight: g.weight,
      scoutCal: t.calories,
      truthCal: g.calories,
      calDelta: `${calDelta >= 0 ? "+" : ""}${calDelta}%`,
      scoutP: t.protein,
      truthP: g.protein,
      pDelta: `${pDelta >= 0 ? "+" : ""}${pDelta}%`,
      scoutC: t.carbohydrates,
      truthC: g.carbs,
      cDelta: `${cDelta >= 0 ? "+" : ""}${cDelta}%`,
      scoutF: t.totalFat,
      truthF: g.fat,
      fDelta: `${fDelta >= 0 ? "+" : ""}${fDelta}%`,
      scoutFib: t.totalFibre,
      truthFib: g.fibre,
      scoutSod: t.sodium,
      truthSod: g.sodium,
    });
  }

  console.log("\n==========================================================================================");
  console.log("FINAL PRECISION SUMMARY (CASES 01 - 03)");
  console.log("==========================================================================================");
  console.table(results.map(r => ({
    Case: r.case,
    Name: r.name.split(":")[1]?.trim() || r.name,
    Dishes: r.dishes,
    "Scout kcal": r.scoutCal,
    "Truth kcal": r.truthCal,
    "Cal Delta": r.calDelta,
    "Scout P": `${r.scoutP}g`,
    "Truth P": `${r.truthP}g`,
    "P Delta": r.pDelta,
    "Scout C": `${r.scoutC}g`,
    "Truth C": `${r.truthC}g`,
    "C Delta": r.cDelta,
    "Scout F": `${r.scoutF}g`,
    "Truth F": `${r.truthF}g`,
    "F Delta": r.fDelta,
    Latency: r.latency,
  })));
}

runPrecisionTests();
