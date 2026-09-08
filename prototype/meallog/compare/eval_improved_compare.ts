import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import {
  scoutOnlyCompareSystemInstruction,
  scoutOnlyCompareResponseSchema,
  buildScoutComparePrompt,
} from "./scout_only_compare_instructions.js";

import dotenv from "dotenv";
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY environment variable is required");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const imagesDir = path.join(process.cwd(), "prototype", "meallog", "compare", "images");

async function runSet(title: string, files: string[], userPrompt: string) {
  console.log(`\n======================================================`);
  console.log(`RUNNING LIVE EVALUATION: ${title}`);
  console.log(`Files: ${files.join(", ")}`);
  console.log(`======================================================`);

  const imageParts: any[] = [];
  for (const filename of files) {
    const fullPath = path.join(imagesDir, filename);
    const buf = fs.readFileSync(fullPath);
    imageParts.push({
      inlineData: {
        data: buf.toString("base64"),
        mimeType: "image/jpeg",
      },
    });
  }

  const promptText = buildScoutComparePrompt(userPrompt, files.length);
  const contents = [...imageParts, { text: promptText }];

  const res = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents,
    config: {
      systemInstruction: scoutOnlyCompareSystemInstruction,
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: scoutOnlyCompareResponseSchema,
    },
  });

  const parsed = JSON.parse(res.text || "{}");
  return parsed;
}

async function main() {
  // Test Set 1: Say Bread & SilverQueen
  const res1 = await runSet("Set 1: Say Bread Bakery & SilverQueen Chocolate", [
    "set1_saybread_bakery_shelf.jpg",
    "set1_silverqueen_nutrition_label.jpg",
    "set1_silverqueen_chocolate_front.jpg",
  ], "Compare these bakery items and chocolate bar, and help me choose the healthier option.");

  // Test Set 2: 4 Snack & Pack Nutrition Labels
  const res2 = await runSet("Set 2: 4 Snack & Pack Nutrition Labels", [
    "set2_snack_green_bar_label.jpg",
    "set2_snack_pack_front.jpg",
    "set2_snack_yellow_cake_label.jpg",
    "set2_snack_blue_bread_label.jpg",
  ], "Compare these 4 snacks and help me choose the healthiest one.");

  // Test Set 6: Supermarket Chip Aisle
  const res6 = await runSet("Set 6: Supermarket Chip Aisle Shelf", [
    "set6_supermarket_chip_aisle_shelf.jpg",
  ], "Compare the chip options on this shelf and advise on healthier choices.");

  fs.writeFileSync("prototype/meallog/compare/live_eval_results.json", JSON.stringify({ res1, res2, res6 }, null, 2));
  console.log("\nResults written to prototype/meallog/compare/live_eval_results.json");
}

main().catch(console.error);
