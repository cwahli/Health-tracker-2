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

const imageFilesSet1 = [
  "set1_saybread_bakery_shelf.jpg",
  "set1_silverqueen_nutrition_label.jpg",
  "set1_silverqueen_chocolate_front.jpg",
];

const imageFilesSet2 = [
  "set2_snack_green_bar_label.jpg",
  "set2_snack_pack_front.jpg",
  "set2_snack_yellow_cake_label.jpg",
  "set2_snack_blue_bread_label.jpg",
];

const imageFilesSet3 = [
  "set3_restaurant_menu_page1.jpg",
  "set3_restaurant_menu_page2.jpg",
];

const imageFilesSet4 = [
  "set4_juice_and_beverage_list.jpg",
];

const imageFilesSet5 = [
  "set5_packaged_product_photo.jpg",
];

const imageFilesSet6 = [
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

const activeSetKey = process.env.COMPARE_SET || "2";
export const activeCompareSet = compareSets[activeSetKey] || compareSets["2"];
const imageFiles = activeCompareSet.files;

function loadImages(files: string[]) {
  return files.map(f => {
    const fullPath = path.join(imagesDir, f);
    const buf = fs.readFileSync(fullPath);
    return {
      inlineData: {
        mimeType: "image/jpeg",
        data: buf.toString("base64"),
      },
    };
  });
}

async function runDetailedDiagnosis() {
  console.log("==========================================================================================");
  console.log("DETAILED DIAGNOSTIC RUN: CONSOLIDATED INSTRUCTION & STRICT 4 ENUM SCHEMA");
  console.log("==========================================================================================\n");

  const loadedParts = loadImages(imageFiles);

  console.log("--- Test A: Consolidated Prompt with [1,2,0] Reordered Images (Temp 0.1) ---");
  const reorderedPartsA = [loadedParts[1], loadedParts[2], loadedParts[0]];
  const promptA = buildConsolidatedScoutPrompt("Analyze this meal photo.", 3);
  const resA = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: [...reorderedPartsA, { text: promptA }],
    config: {
      systemInstruction: consolidatedScoutSystemInstruction,
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: scoutSchemaStrict4Enums,
    },
  });
  const jsonA = JSON.parse(resA.text || "{}");
  console.log(`Reordered [1,2,0] -> ContentType: "${jsonA.contentType}" | Dishes:`, jsonA.dishes?.map((d: any) => d.dishName));
}

runDetailedDiagnosis().catch(console.error);
