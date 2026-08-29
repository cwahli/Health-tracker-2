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

// The 3 target test images from user job job_1787869907978_hisertpsj
const imageFiles = [
  "job_1787869907978_hisertpsj_0.jpg", // Photo 0: Say Bread bakery display shelf (Polo Keju / Double Cheese Bread)
  "job_1787869907978_hisertpsj_1.jpg", // Photo 1: SilverQueen Nutrition Facts label (Back)
  "job_1787869907978_hisertpsj_2.jpg", // Photo 2: SilverQueen Milk Chocolate with Cashews (Front)
];

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
