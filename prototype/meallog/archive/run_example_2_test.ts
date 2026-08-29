import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import {
  unifiedScoutSystemInstruction,
  unifiedScoutResponseSchema,
} from "./scout_unified_instructions.ts";

dotenv.config();

async function runExample2Test() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("ERROR: GEMINI_API_KEY environment variable is not set.");
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });
  const imgPath = path.join(process.cwd(), "prototype", "images", "02_lidl_chicken_muffin.jpg");

  console.log("================================================================================");
  console.log("TESTING EXAMPLE 2: Lidl Chicken Bites with UK Nutrition Label");
  console.log("================================================================================\n");

  const imageBuffer = fs.readFileSync(imgPath);
  const base64Data = imageBuffer.toString("base64");

  const startTime = Date.now();

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Data,
            },
          },
          {
            text: "Analyze this meal photo. Extract the food items. For the packaged chicken bites, transcribe the full visible nutrition information table into rawNutritionLabel.",
          },
        ],
      },
    ],
    config: {
      systemInstruction: unifiedScoutSystemInstruction,
      responseMimeType: "application/json",
      responseSchema: unifiedScoutResponseSchema as any,
      temperature: 0.1,
    },
  });

  const elapsed = Date.now() - startTime;
  const rawText = response.text || "{}";
  const parsed = JSON.parse(rawText);

  console.log(`Response received in ${elapsed}ms:`);
  console.log(JSON.stringify(parsed, null, 2));
}

runExample2Test();
