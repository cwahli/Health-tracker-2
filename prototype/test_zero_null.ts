import { GoogleGenAI, Type } from "@google/genai";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const imagesDir = path.join(process.cwd(), "prototype", "images");

// Schema: BOTH rawNutritionLabel and nutrients have ALL OPTIONAL fields (NO required arrays inside them)
const optionalAggregateSchema = {
  type: Type.OBJECT,
  properties: {
    _internalReasoning: { type: Type.STRING },
    contentType: { type: Type.STRING },
    diningEnvironment: { type: Type.STRING },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          originalName: { type: Type.STRING },
          keyword: { type: Type.STRING },
          chainName: { type: Type.STRING, nullable: true },
          estimatedWeightGrams: { type: Type.NUMBER },
          cookingMethod: { type: Type.STRING },
          ingredients: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          sourceImageIndex: { type: Type.INTEGER },
          boundingBox2D: {
            type: Type.ARRAY,
            items: { type: Type.NUMBER },
          },
          isStandaloneCondimentPacket: { type: Type.BOOLEAN, nullable: true },
          // rawNutritionLabel: ALL fields optional strings (omitted when not on label)
          rawNutritionLabel: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
              servingSize: { type: Type.STRING },
              calories: { type: Type.STRING },
              protein: { type: Type.STRING },
              totalFat: { type: Type.STRING },
              saturatedFat: { type: Type.STRING },
              transFat: { type: Type.STRING },
              totalCarbohydrate: { type: Type.STRING },
              sugar: { type: Type.STRING },
              addedSugar: { type: Type.STRING },
              sodium: { type: Type.STRING },
              salt: { type: Type.STRING },
              potassium: { type: Type.STRING },
              totalFibre: { type: Type.STRING },
              solubleFibre: { type: Type.STRING },
            },
          },
          // nutrients: ALL fields optional numbers (omitted when present in rawNutritionLabel)
          nutrients: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
              calories: { type: Type.NUMBER },
              protein: { type: Type.NUMBER },
              totalFat: { type: Type.NUMBER },
              saturatedFat: { type: Type.NUMBER },
              transFat: { type: Type.NUMBER },
              sugar: { type: Type.NUMBER },
              addedSugar: { type: Type.NUMBER },
              totalFibre: { type: Type.NUMBER },
              sodium: { type: Type.NUMBER },
              potassium: { type: Type.NUMBER },
              omega3: { type: Type.NUMBER },
              calcium: { type: Type.NUMBER },
              iron: { type: Type.NUMBER },
              magnesium: { type: Type.NUMBER },
              vitaminD: { type: Type.NUMBER },
            },
          },
        },
        required: [
          "originalName",
          "keyword",
          "estimatedWeightGrams",
          "cookingMethod",
          "ingredients",
          "sourceImageIndex",
        ],
      },
    },
  },
  required: ["_internalReasoning", "contentType", "diningEnvironment", "items"],
};

const aggregate14Instruction = `System Instruction:
STEP 1: SCENE CLASSIFICATION & ENVIRONMENT
- 'contentType': 'visual' | 'menu_or_poster' | 'label' | 'text'.
- 'diningEnvironment': 'casual_restaurant' | 'fast_food_chain' | 'home_cooked' | 'fine_dining' | 'airline' | 'unknown'.

STEP 2: UNIVERSAL DISH EXTRACTION & DEDUPLICATION
- Extract EVERY distinct physical food, drink, side, or companion dish in 'items'. Exactly 1 item per real food dish. NEVER create a separate dummy label dish.

STEP 3: 14 AGGREGATE NUTRIENTS LAW (MANDATORY EXACTLY 14 IN TOTAL)
For EVERY dish, you MUST output EXACTLY 14 target nutrients in aggregate across 'rawNutritionLabel' and 'nutrients' combined:
[calories, protein, totalFat, saturatedFat, transFat, sugar, addedSugar, totalFibre, sodium, potassium, omega3, calcium, iron, magnesium, vitaminD].

Follow these strict partition rules:
1. PACKAGED DISHES WITH VISIBLE LABELS:
   - In 'rawNutritionLabel': Transcribe ALL visible printed facts from the package as literal raw strings (e.g. servingSize: "30 g", calories: "120 kkal", protein: "3 g", totalFat: "3.5 g", saturatedFat: "0.5 g", totalCarbohydrate: "21 g", sugar: "0 g", sodium: "0 mg"). OMIT unprinted keys completely (NEVER emit "key": null).
   - In 'nutrients': OMIT every nutrient that was already transcribed in 'rawNutritionLabel' (NEVER duplicate printed numbers, NEVER emit null).
   - In 'nutrients': You MUST provide numeric portion estimates for ALL remaining unprinted targets from the 14 list (e.g. potassium, calcium, iron, magnesium, vitaminD, omega3, totalFibre, addedSugar).
   - The SUM of nutrients in 'rawNutritionLabel' + 'nutrients' MUST equal exactly 14 with zero missing fields, zero duplicate fields, and zero nulls!

2. UNPACKAGED VISUAL DISHES (NO LABEL):
   - Set 'rawNutritionLabel' to null.
   - In 'nutrients': You MUST output ALL 14 numeric portion estimates (calories, protein, totalFat, saturatedFat, transFat, sugar, addedSugar, totalFibre, sodium, potassium, omega3, calcium, iron, magnesium, vitaminD). Do not omit any of the 14 targets.

- ZERO-MATH FOR SCOUT: Do not calculate carbohydrates, unsaturated fat, or salt conversions.
- CONCISE REASONING: Keep '_internalReasoning' under 20 words.
- INGREDIENTS: Plain string list in 'ingredients'.
- COOKING METHOD: 'raw' | 'baked' | 'grilled' | 'boiled' | 'steamed' | 'deep_fried' | 'pan_fried' | 'stir_fried'.`;

async function testCase(title: string, imageFiles: string[], promptText: string) {
  const parts = imageFiles.map(img => ({
    inlineData: { mimeType: "image/jpeg", data: fs.readFileSync(path.join(imagesDir, img)).toString("base64") }
  }));
  parts.push({ text: promptText } as any);

  const startTime = Date.now();
  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: aggregate14Instruction,
      responseMimeType: "application/json",
      responseSchema: optionalAggregateSchema as any,
      temperature: 0.1,
    }
  });

  const elapsed = Date.now() - startTime;
  console.log(`\n================================================================================`);
  console.log(`TEST: ${title} (${elapsed}ms)`);
  console.log(`================================================================================`);
  console.log(response.text);

  const parsed = JSON.parse(response.text || "{}");
  (parsed.items || []).forEach((item: any, i: number) => {
    const rawKeys = item.rawNutritionLabel ? Object.keys(item.rawNutritionLabel).filter(k => k !== 'servingSize' && k !== 'totalCarbohydrate' && k !== 'salt' && k !== 'solubleFibre') : [];
    const nutKeys = item.nutrients ? Object.keys(item.nutrients) : [];
    console.log(`\nItem ${i+1}: "${item.originalName}" (${item.estimatedWeightGrams}g)`);
    console.log(`  - rawNutritionLabel printed target keys (${rawKeys.length}): [${rawKeys.join(", ")}]`);
    console.log(`  - nutrients estimated unprinted keys (${nutKeys.length}): [${nutKeys.join(", ")}]`);
    console.log(`  - TOTAL AGGREGATE TARGETS: ${rawKeys.length + nutKeys.length} / 14`);
  });
}

async function main() {
  await testCase("Case 1: Packaged Rolled Oats (2 Photos)", ["08_rolled_oats_1.jpg", "08_rolled_oats_2.jpg"], "Analyze this meal photo.");
  await testCase("Case 2: Visual Restaurant Meal (Yolk Sandwich)", ["01_yolk_panini_wrap.jpg"], "I had it from Yolk");
}
main();
