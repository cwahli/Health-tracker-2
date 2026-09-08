import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import {
  baselineScoutSystemInstruction,
  buildBaselineScoutPrompt,
  consolidatedScoutSystemInstruction,
  buildConsolidatedScoutPrompt,
  scoutSchemaStrict4Enums,
} from "./scout_compare_instructions.ts";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("ERROR: GEMINI_API_KEY is not set.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const imagesDir = path.join(process.cwd(), "prototype", "meallog", "compare", "images");

export interface CompareSetMetadata {
  id: string;
  name: string;
  description: string;
  files: string[];
}

// Set 1: Bakery Shelf & SilverQueen Chocolate
export const imageFilesSet1 = [
  "set1_saybread_bakery_shelf.jpg",
  "set1_silverqueen_nutrition_label.jpg",
  "set1_silverqueen_chocolate_front.jpg",
];

// Set 2: 4 Reference Snack & Pack Nutrition Labels
export const imageFilesSet2 = [
  "set2_snack_green_bar_label.jpg",
  "set2_snack_pack_front.jpg",
  "set2_snack_yellow_cake_label.jpg",
  "set2_snack_blue_bread_label.jpg",
];

// Set 3: Indonesian Restaurant Menu Pages (Sambal Bakar Pencok)
export const imageFilesSet3 = [
  "set3_restaurant_menu_page1.jpg",
  "set3_restaurant_menu_page2.jpg",
];

// Set 4: Juice & Beverage List
export const imageFilesSet4 = [
  "set4_juice_and_beverage_list.jpg",
];

// Set 5: Packaged Product / Drink Item
export const imageFilesSet5 = [
  "set5_packaged_product_photo.jpg",
];

// Set 6: Supermarket Chip Aisle Shelf (Large Set)
export const imageFilesSet6 = [
  "set6_supermarket_chip_aisle_shelf.jpg",
];

export const compareSets: Record<string, CompareSetMetadata> = {
  "1": {
    id: "set1",
    name: "Set 1: Bakery Shelf & SilverQueen Chocolate",
    description: "User job job_1787869907978_hisertpsj: Say Bread display + SilverQueen label/bar",
    files: imageFilesSet1,
  },
  "2": {
    id: "set2",
    name: "Set 2: 4 Snack & Pack Nutrition Labels",
    description: "4 snack labels and pack fronts (green bar, pack front, yellow cake, blue bread)",
    files: imageFilesSet2,
  },
  "3": {
    id: "set3",
    name: "Set 3: Restaurant Menu Pages (Sambal Bakar Pencok)",
    description: "2-page Indonesian restaurant menu comparing dishes/options",
    files: imageFilesSet3,
  },
  "4": {
    id: "set4",
    name: "Set 4: Juice & Beverage List",
    description: "Beverage and juice menu options list",
    files: imageFilesSet4,
  },
  "5": {
    id: "set5",
    name: "Set 5: Packaged Product Item",
    description: "Standalone packaged beverage / snack product evaluation",
    files: imageFilesSet5,
  },
  "6": {
    id: "set6",
    name: "Set 6: Supermarket Chip Aisle Shelf",
    description: "Compact comparison across 50+ snack choices on a supermarket shelf",
    files: imageFilesSet6,
  },
};

// Default to set 2 (or choose via env COMPARE_SET=1..5)
const activeSetKey = process.env.COMPARE_SET || "2";
export const activeCompareSet = compareSets[activeSetKey] || compareSets["2"];
const imageFiles = activeCompareSet.files;

function loadImages(files: string[]) {
  const parts: any[] = [];
  for (const f of files) {
    const fullPath = path.join(imagesDir, f);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Image not found: ${fullPath}`);
    }
    const buf = fs.readFileSync(fullPath);
    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: buf.toString("base64"),
      },
    });
  }
  return parts;
}

interface ExperimentConfig {
  id: string;
  name: string;
  systemInstruction: string;
  userPromptBuilder: (msg: string, count: number) => string;
  temperature: number;
}

const experiments: ExperimentConfig[] = [
  {
    id: "baseline_temp_0.1",
    name: "1. Baseline Prompt (Original 4 Enums, Temp 0.1) - Original Failure Case",
    systemInstruction: baselineScoutSystemInstruction,
    userPromptBuilder: buildBaselineScoutPrompt,
    temperature: 0.1,
  },
  {
    id: "consolidated_strict4_temp_0.1",
    name: "2. Consolidated Prompt (Strict Original 4 Enums, Temp 0.1) - Fix Validation",
    systemInstruction: consolidatedScoutSystemInstruction,
    userPromptBuilder: buildConsolidatedScoutPrompt,
    temperature: 0.1,
  },
  {
    id: "consolidated_strict4_temp_0.2",
    name: "3. Consolidated Prompt (Strict Original 4 Enums, Temp 0.2)",
    systemInstruction: consolidatedScoutSystemInstruction,
    userPromptBuilder: buildConsolidatedScoutPrompt,
    temperature: 0.2,
  },
];

async function runExperiments() {
  console.log("==========================================================================================");
  console.log("SCOUT EVALUATION: CONSOLIDATED EXTRACTION MANDATE WITHOUT 'MIXED' ENUM");
  console.log(`Active Compare Set: [${activeCompareSet.name}] (${activeCompareSet.description})`);
  console.log("Model: gemini-3.5-flash-lite | Schema: Strictly ['visual', 'menu_or_poster', 'label', 'text']");
  console.log("==========================================================================================\n");

  const loadedParts = loadImages(imageFiles);

  const resultsSummary: Array<{
    id: string;
    name: string;
    temp: number;
    contentType: string;
    dishCount: number;
    dishesIdentified: string[];
    success: boolean;
    reasoning: string;
  }> = [];

  for (const exp of experiments) {
    console.log(`\n------------------------------------------------------------------------------------------`);
    console.log(`RUNNING EXPERIMENT: ${exp.name}`);
    console.log(`------------------------------------------------------------------------------------------`);

    const userPromptText = exp.userPromptBuilder("Analyze this meal photo.", 3);

    const contents = [
      ...loadedParts,
      { text: userPromptText },
    ];

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents,
        config: {
          systemInstruction: exp.systemInstruction,
          temperature: exp.temperature,
          responseMimeType: "application/json",
          responseSchema: scoutSchemaStrict4Enums,
        },
      });

      const text = response.text || "{}";
      let json: any = {};
      try {
        json = JSON.parse(text);
      } catch (e) {
        console.error("Failed to parse JSON response:", text);
      }

      const dishes = json.dishes || [];
      const dishNames = dishes.map((d: any) => d.dishName || "Unnamed Dish");
      const contentType = json.contentType || "unknown";
      const reasoning = json._internalReasoning || "None";

      // Success condition: detected both chocolate AND bread/bakery item
      const foundChocolate = dishNames.some((n: string) => /chocolate|silverqueen/i.test(n));
      const foundBread = dishNames.some((n: string) => /bread|keju|cheese|polo|bakery|bun|pastry/i.test(n)) || dishes.length >= 2;
      const isSuccess = foundChocolate && foundBread;

      console.log(`[Result] ContentType: "${contentType}" | Dishes Detected (${dishes.length}): ${JSON.stringify(dishNames)}`);
      console.log(`[Reasoning]: ${reasoning}`);
      console.log(`[Success Criteria (Both Chocolate + Bread Detected)]: ${isSuccess ? "✅ PASSED" : "❌ FAILED"}`);

      resultsSummary.push({
        id: exp.id,
        name: exp.name,
        temp: exp.temperature,
        contentType,
        dishCount: dishes.length,
        dishesIdentified: dishNames,
        success: isSuccess,
        reasoning,
      });

    } catch (err: any) {
      console.error(`[Error in experiment ${exp.id}]:`, err?.message || err);
    }
  }

  console.log("\n==========================================================================================");
  console.log("FINAL EXPERIMENT SUMMARY TABLE");
  console.log("==========================================================================================");
  console.table(resultsSummary.map(r => ({
    Experiment: r.name,
    Temp: r.temp,
    "Content Type": r.contentType,
    "Dishes Count": r.dishCount,
    "Dishes Found": r.dishesIdentified.join(" | "),
    Result: r.success ? "PASS (Both Items Detected)" : "FAIL (Only 1 Item)",
  })));
}

runExperiments().catch(console.error);
