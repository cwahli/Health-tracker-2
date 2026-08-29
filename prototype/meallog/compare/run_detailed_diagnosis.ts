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
const imagesDir = path.join(process.cwd(), "prototype", "compare", "images");

const imageFiles = [
  "job_1787869907978_hisertpsj_0.jpg", // Photo 0: Bakery Display Shelf
  "job_1787869907978_hisertpsj_1.jpg", // Photo 1: Nutrition Label Back
  "job_1787869907978_hisertpsj_2.jpg", // Photo 2: Chocolate Bar Front
];

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
