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
import {
  hierarchicalScoutSystemInstruction,
  hierarchicalScoutResponseSchema,
} from "../scout_hierarchical_instructions.ts";
import { calculateMealNutrients } from "../backend_nutrient_calculator.ts";

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
    sodium: number;
  };
}

const testCases: TestCase[] = [
  {
    id: 1,
    imageFileNames: ["01_yolk_panini_wrap.jpg"],
    userPrompt: "I had this for lunch from Yolk",
    groundTruth: {
      caseName: "01: YOLK Chicken Sandwich & Roasted Sides",
      weightGrams: 600,
      calories: 950,
      protein: 49.0,
      carbohydrates: 92.0,
      totalFat: 42.0,
      sodium: 1250,
    },
  },
  {
    id: 2,
    imageFileNames: ["02_lidl_chicken_muffin.jpg"],
    userPrompt: "I had these from Lidl",
    groundTruth: {
      caseName: "02: Lidl Chicken Bites & Chocolate Muffin",
      weightGrams: 195,
      calories: 557,
      protein: 21.7,
      carbohydrates: 58.0,
      totalFat: 26.5,
      sodium: 628,
    },
  },
  {
    id: 3,
    imageFileNames: ["03_sushi_shrimp_salad.jpg"],
    userPrompt: "My lunch today",
    groundTruth: {
      caseName: "03: Salmon Sushi Roll, Shrimp Pasta Salad & Baguette",
      weightGrams: 650,
      calories: 1000,
      protein: 55.5,
      carbohydrates: 134.0,
      totalFat: 25.0,
      sodium: 1350,
    },
  },
  {
    id: 4,
    imageFileNames: ["04_seaside_fish_chips.jpg"],
    userPrompt: "Park takeaway with salad, parfait, and pastries",
    groundTruth: {
      caseName: "04: Berry Parfait, Pastries & Cobb Salad",
      weightGrams: 1000,
      calories: 1630,
      protein: 75.0,
      carbohydrates: 148.0,
      totalFat: 80.0,
      sodium: 1450,
    },
  },
  {
    id: 5,
    imageFileNames: ["05_cafe_waffles_coffee.jpg"],
    userPrompt: "Inflight meal tray",
    groundTruth: {
      caseName: "05: Airline Breakfast Tray",
      weightGrams: 640,
      calories: 838,
      protein: 23.0,
      carbohydrates: 104.0,
      totalFat: 37.0,
      sodium: 520,
    },
  },
  {
    id: 6,
    imageFileNames: ["06_indonesian_menu_page_1.jpg", "06_indonesian_menu_page_2.jpg"],
    userPrompt: "Mie Gacoan Indonesian noodle meal",
    groundTruth: {
      caseName: "06: Mie Gacoan Noodles & Siomay",
      weightGrams: 570,
      calories: 780,
      protein: 27.0,
      carbohydrates: 111.0,
      totalFat: 25.0,
      sodium: 1250,
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
      sodium: 65,
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
      sodium: 0,
    },
  },
  {
    id: 9,
    imageFileNames: ["09_steak_fish_chips_1.jpg", "09_steak_fish_chips_2.jpg"],
    userPrompt: "Sizzling pepper steak, fish & chips, and iced tea",
    groundTruth: {
      caseName: "09: Sizzling Steak & Fish and Chips",
      weightGrams: 1135,
      calories: 1340,
      protein: 78.0,
      carbohydrates: 102.0,
      totalFat: 67.0,
      sodium: 1850,
    },
  },
  {
    id: 10,
    imageFileNames: ["10_beef_soup_barcode_meal_0.jpg", "10_beef_soup_barcode_meal_1.jpg"],
    userPrompt: "Indonesian beef hotpot ingredients with barcodes",
    groundTruth: {
      caseName: "10: Indonesian Beef Hotpot",
      weightGrams: 825,
      calories: 616,
      protein: 65.2,
      carbohydrates: 45.9,
      totalFat: 23.5,
      sodium: 380,
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
      sodium: 473,
    },
  },
];

const calcAcc = (gt: number, pred: number) => {
  if (gt === 0) return pred === 0 ? 100 : Math.max(0, 100 - pred * 10);
  const diff = Math.abs(pred - gt);
  return Math.max(0, Math.min(100, (1 - diff / gt) * 100));
};

async function runComparison() {
  console.log("==========================================================================================");
  console.log("HEAD-TO-HEAD COMPARISON: 1-AGENT DIRECT SCOUT vs 2-AGENT ARCHITECTURE (CURRENT MAIN)");
  console.log("Model: gemini-3.5-flash-lite");
  console.log("==========================================================================================\n");

  const comparisonTable: any[] = [];

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    console.log(`\nEvaluating Case ${tc.id}: ${tc.groundTruth.caseName}...`);

    if (i > 0) {
      await new Promise((r) => setTimeout(r, 6000));
    }

    const imageParts: any[] = [];
    for (const fn of tc.imageFileNames) {
      const imgPath = path.join(imagesDir, fn);
      if (fs.existsSync(imgPath)) {
        imageParts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: fs.readFileSync(imgPath).toString("base64"),
          },
        });
      }
    }

    // 1. Run 1-Agent (Direct Scout Meal)
    let agent1Totals = { weight: 0, calories: 0, protein: 0, carbs: 0, fat: 0, sodium: 0 };
    try {
      const parts1 = [
        ...imageParts,
        {
          text: `${tc.userPrompt}. Identify all distinct dishes and constituent foods with weights and 6 core nutrients.`,
        },
      ];
      const res1 = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: [{ role: "user", parts: parts1 }],
        config: {
          systemInstruction: scoutMealSystemInstruction,
          responseMimeType: "application/json",
          responseSchema: scoutMealResponseSchema,
          temperature: 0.1,
        },
      });
      const parsed1: ScoutMealResponse = JSON.parse(res1.text || "{}");
      const processed1: ProcessedCompleteMeal = calculateCompleteMeal(parsed1);
      agent1Totals = {
        weight: processed1.totalMealWeightGrams,
        calories: processed1.totals.calories,
        protein: processed1.totals.protein,
        carbs: processed1.totals.carbohydrates,
        fat: processed1.totals.totalFat,
        sodium: processed1.totals.sodium,
      };
    } catch (e: any) {
      console.error(`1-Agent failed on Case ${tc.id}:`, e.message);
    }

    await new Promise((r) => setTimeout(r, 4000));

    // 2. Run 2-Agent (Hierarchical Scout + Calculator)
    let agent2Totals = { weight: 0, calories: 0, protein: 0, carbs: 0, fat: 0, sodium: 0 };
    try {
      const parts2 = [...imageParts, { text: tc.userPrompt }];
      const res2 = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: [{ role: "user", parts: parts2 }],
        config: {
          systemInstruction: hierarchicalScoutSystemInstruction,
          responseMimeType: "application/json",
          responseSchema: hierarchicalScoutResponseSchema as any,
          temperature: 0.1,
        },
      });
      const parsed2 = JSON.parse(res2.text || "{}");
      const meal2 = calculateMealNutrients(parsed2.dishes || []);
      agent2Totals = {
        weight: meal2.totalMealWeightGrams,
        calories: meal2.totals.calories,
        protein: meal2.totals.protein,
        carbs: meal2.totals.carbohydrates,
        fat: meal2.totals.totalFat,
        sodium: meal2.totals.sodium,
      };
    } catch (e: any) {
      console.error(`2-Agent failed on Case ${tc.id}:`, e.message);
    }

    const gt = tc.groundTruth;

    // Accuracy calculations
    const a1 = {
      calAcc: calcAcc(gt.calories, agent1Totals.calories),
      pAcc: calcAcc(gt.protein, agent1Totals.protein),
      fAcc: calcAcc(gt.totalFat, agent1Totals.fat),
      naAcc: calcAcc(gt.sodium, agent1Totals.sodium),
    };

    const a2 = {
      calAcc: calcAcc(gt.calories, agent2Totals.calories),
      pAcc: calcAcc(gt.protein, agent2Totals.protein),
      fAcc: calcAcc(gt.totalFat, agent2Totals.fat),
      naAcc: calcAcc(gt.sodium, agent2Totals.sodium),
    };

    comparisonTable.push({
      caseId: tc.id,
      name: gt.caseName,
      gt: { cal: gt.calories, p: gt.protein, f: gt.totalFat, na: gt.sodium },
      a1: { totals: agent1Totals, acc: a1 },
      a2: { totals: agent2Totals, acc: a2 },
    });
  }

  // Print Comparison Analysis Output
  console.log("\n\n==========================================================================================");
  console.log("COMPARISON ANALYSIS SCORECARD (1-AGENT vs 2-AGENT vs GROUND TRUTH)");
  console.log("==========================================================================================\n");

  comparisonTable.forEach((row) => {
    console.log(`------------------------------------------------------------------------------------------`);
    console.log(`CASE ${row.caseId}: ${row.name}`);
    console.log(`GROUND TRUTH:    Cal: ${row.gt.cal} kcal | P: ${row.gt.p}g | F: ${row.gt.f}g | Na: ${row.gt.na}mg`);
    console.log(
      `1-AGENT DIRECT:  Cal: ${row.a1.totals.calories} (${row.a1.acc.calAcc.toFixed(0)}%) | P: ${row.a1.totals.protein}g (${row.a1.acc.pAcc.toFixed(0)}%) | F: ${row.a1.totals.fat}g (${row.a1.acc.fAcc.toFixed(0)}%) | Na: ${row.a1.totals.sodium}mg (${row.a1.acc.naAcc.toFixed(0)}%)`
    );
    console.log(
      `2-AGENT CURRENT: Cal: ${row.a2.totals.calories} (${row.a2.acc.calAcc.toFixed(0)}%) | P: ${row.a2.totals.protein}g (${row.a2.acc.pAcc.toFixed(0)}%) | F: ${row.a2.totals.fat}g (${row.a2.acc.fAcc.toFixed(0)}%) | Na: ${row.a2.totals.sodium}mg (${row.a2.acc.naAcc.toFixed(0)}%)`
    );

    const calDelta = (row.a1.acc.calAcc - row.a2.acc.calAcc).toFixed(1);
    const fatDelta = (row.a1.acc.fAcc - row.a2.acc.fAcc).toFixed(1);
    const pDelta = (row.a1.acc.pAcc - row.a2.acc.pAcc).toFixed(1);
    const naDelta = (row.a1.acc.naAcc - row.a2.acc.naAcc).toFixed(1);

    console.log(
      `DELTA (1-Agent vs 2-Agent): Cal Acc: ${calDelta}% | Fat Acc: ${fatDelta}% | Protein Acc: ${pDelta}% | Sodium Acc: ${naDelta}%`
    );
  });

  // Save comparison file
  fs.writeFileSync(
    path.join(process.cwd(), "prototype", "meallog", "meal", "comparison_1_vs_2_results.json"),
    JSON.stringify(comparisonTable, null, 2)
  );
  console.log("\nSaved comparison data to prototype/meallog/meal/comparison_1_vs_2_results.json");
}

runComparison();
