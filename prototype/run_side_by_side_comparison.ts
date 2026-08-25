import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("ERROR: GEMINI_API_KEY is not set.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const imagesDir = path.join(process.cwd(), "prototype", "images");

// ============================================================================
// METHOD A: TOP-DOWN CALORIE SCHEMA & INSTRUCTION (Atwater Residual Carbs)
// ============================================================================
export const topDownSchema = {
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
            },
            required: [
              "servingSize",
              "calories",
              "protein",
              "totalFat",
              "totalCarbohydrate",
            ],
          },
          nutrients: {
            type: Type.OBJECT,
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
            required: [
              "calories",
              "protein",
              "totalFat",
              "saturatedFat",
              "transFat",
              "sugar",
              "addedSugar",
              "totalFibre",
              "sodium",
              "potassium",
              "omega3",
              "calcium",
              "iron",
              "magnesium",
              "vitaminD",
            ],
          },
        },
        required: [
          "originalName",
          "keyword",
          "estimatedWeightGrams",
          "cookingMethod",
          "ingredients",
          "sourceImageIndex",
          "nutrients",
        ],
      },
    },
  },
  required: ["_internalReasoning", "contentType", "diningEnvironment", "items"],
};

export const topDownInstruction = `System Instruction:
STEP 1: SCENE CLASSIFICATION & ENVIRONMENT
- 'contentType': 'visual' (food photo), 'menu_or_poster' (menu/kiosk screen), 'label' (nutrition panel), or 'text'.
- 'diningEnvironment': 'casual_restaurant' | 'fast_food_chain' | 'home_cooked' | 'fine_dining' | 'airline' | 'unknown'.

STEP 2: UNIVERSAL DISH EXTRACTION & OCR ATTACHMENT
- USER SCOPE ANCHOR: Extract EVERY distinct physical food, drink, side, or companion dish in 'items'. For open cups, estimate weight by fill level.
- KNOWN BRANDS: For any restaurant chain or branded product (e.g. McDonald's, Yolk, Starbucks, Pret, Lidl, Sainsbury), output brand name in 'chainName' and dish title in 'originalName'.
- DIRECT OCR FIRST: If a package label or menu panel is visible, transcribe ALL printed facts directly into 'rawNutritionLabel' FIRST.

STEP 3: 15 MANDATORY DISH NUTRIENTS (TOP-DOWN CALORIES)
- For EVERY dish, provide complete numeric portion estimates across all 15 required keys in 'nutrients': calories, protein, totalFat, saturatedFat, transFat, sugar, addedSugar, totalFibre, sodium, potassium, omega3, calcium, iron, magnesium, vitaminD.
- ZERO-MATH FOR SCOUT: Do not calculate carbohydrates. The backend pipeline derives carbs via Atwater ((Calories - 4P - 9F) / 4).`;

// ============================================================================
// METHOD B: BOTTOM-UP CALORIE SCHEMA & INSTRUCTION (Direct Carbs -> 4P+4C+9F)
// ============================================================================
export const bottomUpSchema = {
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
            },
            required: [
              "servingSize",
              "calories",
              "protein",
              "totalFat",
              "totalCarbohydrate",
            ],
          },
          nutrients: {
            type: Type.OBJECT,
            properties: {
              protein: { type: Type.NUMBER },
              carbohydrates: { type: Type.NUMBER },
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
            required: [
              "protein",
              "carbohydrates",
              "totalFat",
              "saturatedFat",
              "transFat",
              "sugar",
              "addedSugar",
              "totalFibre",
              "sodium",
              "potassium",
              "omega3",
              "calcium",
              "iron",
              "magnesium",
              "vitaminD",
            ],
          },
        },
        required: [
          "originalName",
          "keyword",
          "estimatedWeightGrams",
          "cookingMethod",
          "ingredients",
          "sourceImageIndex",
          "nutrients",
        ],
      },
    },
  },
  required: ["_internalReasoning", "contentType", "diningEnvironment", "items"],
};

export const bottomUpInstruction = `System Instruction:
STEP 1: SCENE CLASSIFICATION & ENVIRONMENT
- 'contentType': 'visual' (food photo), 'menu_or_poster' (menu/kiosk screen), 'label' (nutrition panel), or 'text'.
- 'diningEnvironment': 'casual_restaurant' | 'fast_food_chain' | 'home_cooked' | 'fine_dining' | 'airline' | 'unknown'.

STEP 2: UNIVERSAL DISH EXTRACTION & OCR ATTACHMENT
- USER SCOPE ANCHOR: Extract EVERY distinct physical food, drink, side, or companion dish in 'items'. For open cups, estimate weight by fill level.
- KNOWN BRANDS: For any restaurant chain or branded product (e.g. McDonald's, Yolk, Starbucks, Pret, Lidl, Sainsbury), output brand name in 'chainName' and dish title in 'originalName'.
- DIRECT OCR FIRST: If a package label or menu panel is visible, transcribe ALL printed facts directly into 'rawNutritionLabel' FIRST.

STEP 3: 14 MANDATORY PHYSICAL NUTRIENTS (DIRECT MACROS, ZERO CALORIE INPUT)
- For EVERY dish, provide complete numeric portion estimates across all 14 required keys in 'nutrients': protein, carbohydrates, totalFat, saturatedFat, transFat, sugar, addedSugar, totalFibre, sodium, potassium, omega3, calcium, iron, magnesium, vitaminD.
- ZERO CALORIE ESTIMATION: Do NOT estimate calories. Backend computes Calories = (4 * Protein) + (4 * Carbohydrates) + (9 * TotalFat).
- DIRECT CARBOHYDRATE ESTIMATION: Estimate carbohydrates directly based on visible physical starch mass and sweet liquids (e.g. potato wedges ~20–25% carbs, fried batter ~25–30% carbs, lean meat/fish 0% carbs, cooked rice/pasta ~25–28% carbs, bread ~50% carbs).`;

interface BenchmarkCase {
  id: string;
  name: string;
  imageFiles: string[];
  userPrompt: string;
}

const benchmarkCases: BenchmarkCase[] = [
  {
    id: "case_1",
    name: "01: Yolk Sandwich & Sides (Brand Lock)",
    imageFiles: ["01_yolk_panini_wrap.jpg"],
    userPrompt: "I had it from Yolk",
  },
  {
    id: "case_2",
    name: "02: Lidl Chicken Bites + Muffin (OCR + Plated)",
    imageFiles: ["02_lidl_chicken_muffin.jpg"],
    userPrompt: "Analyze this meal",
  },
  {
    id: "case_3",
    name: "03: Salmon Sushi Roll & Shrimp Salad (Visual)",
    imageFiles: ["03_sushi_shrimp_salad.jpg"],
    userPrompt: "Analyze this meal photo",
  },
  {
    id: "case_4",
    name: "04: Seaside Fish & Chips, Yogurt Cup & Salad",
    imageFiles: ["04_seaside_fish_chips.jpg"],
    userPrompt: "Fish and chips meal by the seaside",
  },
  {
    id: "case_5",
    name: "05: Cafe Waffles with Fruit & Coffee",
    imageFiles: ["05_cafe_waffles_coffee.jpg"],
    userPrompt: "Waffles and coffee at a cafe",
  },
  {
    id: "case_6",
    name: "06: Indonesian Mie Gacoan Menu Set (2 Pages)",
    imageFiles: ["06_indonesian_menu_page_1.jpg", "06_indonesian_menu_page_2.jpg"],
    userPrompt: "Analyze these 2 menu pages together and extract all options",
  },
  {
    id: "case_7",
    name: "07: Sainsbury Rolled Oats with Fruits & Milk",
    imageFiles: ["07_sainsbury_oat_fruits.jpg"],
    userPrompt: "Sainsbury rolled oats with fruits and milk",
  },
  {
    id: "case_8",
    name: "08: Rolled Oats Package Facts + Bowl (2 Photos)",
    imageFiles: ["08_rolled_oats_1.jpg", "08_rolled_oats_2.jpg"],
    userPrompt: "Analyze this meal photo.",
  },
  {
    id: "case_9",
    name: "09: Fish & Chips + Sizzling Beef Steak Platter (2 Photos)",
    imageFiles: ["09_steak_fish_chips_1.jpg", "09_steak_fish_chips_2.jpg"],
    userPrompt: "Analyze this meal photo.",
  },
];

async function runSideBySideBenchmark() {
  console.log("==========================================================================================");
  console.log("COMPREHENSIVE SIDE-BY-SIDE BENCHMARK: METHOD A (TOP-DOWN) vs METHOD B (BOTTOM-UP)");
  console.log("Model: gemini-3.5-flash-lite | Cases: 9 full benchmark image sets");
  console.log("==========================================================================================\n");

  const comparisonTable: any[] = [];

  for (const tc of benchmarkCases) {
    console.log(`==========================================================================================`);
    console.log(`EVALUATING: ${tc.name}`);
    console.log(`Images: ${tc.imageFiles.join(", ")} | Prompt: "${tc.userPrompt}"`);
    console.log(`==========================================================================================`);

    const imageParts = tc.imageFiles.map((img) => ({
      inlineData: {
        mimeType: "image/jpeg",
        data: fs.readFileSync(path.join(imagesDir, img)).toString("base64"),
      },
    }));

    // ------------------------------------------------------------------------
    // RUN METHOD A (Top-Down)
    // ------------------------------------------------------------------------
    let topDownRes: any = null;
    let topDownTotals = { cal: 0, p: 0, c: 0, f: 0, na: 0 };
    try {
      const partsA = [...imageParts, { text: tc.userPrompt } as any];
      const resA = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: [{ role: "user", parts: partsA }],
        config: {
          systemInstruction: topDownInstruction,
          responseMimeType: "application/json",
          responseSchema: topDownSchema as any,
          temperature: 0.1,
        },
      });
      topDownRes = JSON.parse(resA.text || "{}");
      (topDownRes.items || []).forEach((it: any) => {
        const n = it.nutrients || {};
        const p = Number(n.protein) || 0;
        const f = Number(n.totalFat) || 0;
        const cal = Number(n.calories) || 0;
        const c = Math.max(0, Math.round(((cal - (4 * p) - (9 * f)) / 4) * 10) / 10);
        const na = Number(n.sodium) || 0;
        topDownTotals.cal += cal;
        topDownTotals.p += p;
        topDownTotals.c += c;
        topDownTotals.f += f;
        topDownTotals.na += na;
      });
    } catch (e: any) {
      console.error(`Method A Failed on ${tc.name}:`, e.message);
    }

    // ------------------------------------------------------------------------
    // RUN METHOD B (Bottom-Up)
    // ------------------------------------------------------------------------
    let bottomUpRes: any = null;
    let bottomUpTotals = { cal: 0, p: 0, c: 0, f: 0, na: 0 };
    try {
      const partsB = [...imageParts, { text: tc.userPrompt } as any];
      const resB = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: [{ role: "user", parts: partsB }],
        config: {
          systemInstruction: bottomUpInstruction,
          responseMimeType: "application/json",
          responseSchema: bottomUpSchema as any,
          temperature: 0.1,
        },
      });
      bottomUpRes = JSON.parse(resB.text || "{}");
      (bottomUpRes.items || []).forEach((it: any) => {
        const n = it.nutrients || {};
        const p = Number(n.protein) || 0;
        const c = Number(n.carbohydrates) || 0;
        const f = Number(n.totalFat) || 0;
        const cal = Math.round((4 * p) + (4 * c) + (9 * f));
        const na = Number(n.sodium) || 0;
        bottomUpTotals.cal += cal;
        bottomUpTotals.p += p;
        bottomUpTotals.c += c;
        bottomUpTotals.f += f;
        bottomUpTotals.na += na;
      });
    } catch (e: any) {
      console.error(`Method B Failed on ${tc.name}:`, e.message);
    }

    console.log(`\n  [METHOD A - TOP-DOWN]:`);
    console.log(`    Items (${topDownRes?.items?.length || 0}): ${(topDownRes?.items || []).map((i: any) => i.originalName).join(", ")}`);
    console.log(`    Totals: Calories=${topDownTotals.cal} kcal | Protein=${topDownTotals.p.toFixed(1)}g | Carbs=${topDownTotals.c.toFixed(1)}g (Derived) | Fat=${topDownTotals.f.toFixed(1)}g | Sodium=${topDownTotals.na}mg`);

    console.log(`\n  [METHOD B - BOTTOM-UP]:`);
    console.log(`    Items (${bottomUpRes?.items?.length || 0}): ${(bottomUpRes?.items || []).map((i: any) => i.originalName).join(", ")}`);
    console.log(`    Totals: Calories=${bottomUpTotals.cal} kcal (Computed 4P+4C+9F) | Protein=${bottomUpTotals.p.toFixed(1)}g | Carbs=${bottomUpTotals.c.toFixed(1)}g (Direct) | Fat=${bottomUpTotals.f.toFixed(1)}g | Sodium=${bottomUpTotals.na}mg`);

    const calDelta = bottomUpTotals.cal - topDownTotals.cal;
    const carbDelta = bottomUpTotals.c - topDownTotals.c;
    console.log(`\n  >>> VARIANCE: Calories Δ = ${calDelta > 0 ? "+" : ""}${calDelta} kcal | Carbs Δ = ${carbDelta > 0 ? "+" : ""}${carbDelta.toFixed(1)}g\n`);

    comparisonTable.push({
      Case: tc.name.split(":")[0],
      "Top-Down Cal (kcal)": topDownTotals.cal,
      "Bottom-Up Cal (kcal)": bottomUpTotals.cal,
      "Cal Δ": calDelta,
      "Top-Down Carbs (g)": topDownTotals.c.toFixed(1),
      "Bottom-Up Carbs (g)": bottomUpTotals.c.toFixed(1),
      "Carb Δ": carbDelta.toFixed(1),
      "Protein (g) [A/B]": `${topDownTotals.p.toFixed(0)}/${bottomUpTotals.p.toFixed(0)}`,
      "Fat (g) [A/B]": `${topDownTotals.f.toFixed(0)}/${bottomUpTotals.f.toFixed(0)}`,
    });
  }

  console.log("==========================================================================================");
  console.log("FULL 9-CASE COMPREHENSIVE SIDE-BY-SIDE SUMMARY TABLE");
  console.log("==========================================================================================");
  console.table(comparisonTable);
}

runSideBySideBenchmark();
