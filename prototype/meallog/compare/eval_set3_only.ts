import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import {
  scoutOnlyCompareSystemInstruction,
  buildScoutComparePrompt,
  scoutOnlyCompareResponseSchema,
} from "./scout_only_compare_instructions.js";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("ERROR: GEMINI_API_KEY is not set.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const imagesDir = path.join(process.cwd(), "prototype", "meallog", "compare", "images");

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

async function testSet3() {
  console.log("=== Testing Set 3 Exhaustive OCR Extraction with Updated Schema & Prompt ===");
  const files = [
    "set3_restaurant_menu_page1.jpg",
    "set3_restaurant_menu_page2.jpg",
  ];
  const startTime = Date.now();
  const imageParts = loadImages(files);
  const promptText = buildScoutComparePrompt("", imageParts.length);

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: [...imageParts, { text: promptText }],
    config: {
      systemInstruction: scoutOnlyCompareSystemInstruction,
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: scoutOnlyCompareResponseSchema,
      maxOutputTokens: 8192,
    },
  });

  const durationMs = Date.now() - startTime;
  const json = JSON.parse(response.text || "{}");
  const groups = json.groups || [];
  const groupItems: string[] = groups.flatMap((g: any) =>
    Array.isArray(g.items) ? g.items.map((it: any) => typeof it === "string" ? it : it.name) : []
  );

  console.log(`⏱️ Duration: ${durationMs}ms`);
  console.log(`📊 Comparison Title: "${json.comparisonTitle}"`);
  console.log(`🏆 Recommended: "${json.recommendedOption}"`);
  console.log(`📦 Total Extracted Dishes in Groups: ${groupItems.length}`);
  console.log(`🏷️ Groups Formed: ${groups.length}`);

  groups.forEach((g: any, idx: number) => {
    console.log(`\nGroup ${idx + 1}: ${g.groupName} (${(g.items || []).length} items)`);
    console.log(`  Verdict: [${g.verdict?.level}] ${g.verdict?.label}`);
    console.log(`  Combined Message: "${g.message}"`);
    console.log(`  Sample Items: ${(g.items || []).slice(0, 5).join("; ")}`);
    if ((g.items || []).length > 5) {
      console.log(`  ... and ${(g.items || []).length - 5} more items`);
    }
  });
}

testSet3().catch(console.error);
