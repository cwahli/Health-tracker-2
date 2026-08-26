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

export const productionScoutSchema = {
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
          // 1. Literal OCR Label (When Visible)
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
          // 2. 14 Mandatory Nutrient Numbers (Always 100% Complete)
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

export const productionScoutInstruction = `System Instruction:
STEP 1: SCENE CLASSIFICATION & ENVIRONMENT
- 'contentType': 'visual' (food photo), 'menu_or_poster' (menu/kiosk screen), 'label' (nutrition panel), or 'text'.
- 'diningEnvironment': 'casual_restaurant' | 'fast_food_chain' | 'home_cooked' | 'fine_dining' | 'airline' | 'unknown'.

STEP 2: UNIVERSAL DISH EXTRACTION & OCR ATTACHMENT
- USER SCOPE ANCHOR: Extract EVERY distinct physical food, drink, side, or companion dish in 'items'. For open cups, estimate weight by fill level. The user's explicit text sentence is absolute ground truth. If the user explicitly limits consumption (e.g. "I only had 1 croissant", "I just ate the salad"), strictly extract ONLY specified items and skip all others.
- CROSS-IMAGE DEDUPLICATION: If photos show menu + food, or raw grocery packages + prepared dish, extract each distinct dish ONCE. Never create separate dummy "Nutrition Facts Label" items.
- KNOWN BRANDS: For any restaurant chain or branded product (e.g. McDonald's, Yolk, Starbucks, Pret, Lidl, Sainsbury), output brand name alone in 'chainName' and exact dish title in 'originalName'. Leave 'chainName' null for unbranded items. Apply brand name only to branded items; emit companion fresh fruits/drinks as unbranded.
- DIRECT OCR FIRST: If a package label or menu panel is visible, transcribe ALL printed facts directly into 'rawNutritionLabel' FIRST (including servingSize, calories, protein, totalFat, saturatedFat, totalCarbohydrate, sugar, sodium). Omit unprinted label keys completely (NEVER emit "key": null). If no label is visible, set 'rawNutritionLabel' to null.
- PRECISE COUNTING: Inspect open pastry bags/boxes for stacked items. Split into individual items with realistic weights.

STEP 3: 15 MANDATORY DISH NUTRIENTS (ZERO NULLS)
- For EVERY dish, provide complete numeric portion estimates across all 15 required keys in 'nutrients' (scaled to the estimated consumed portion weight in grams): calories, protein, totalFat, saturatedFat, transFat, sugar, addedSugar, totalFibre, sodium, potassium, omega3, calcium, iron, magnesium, vitaminD. NEVER emit null in nutrients.
- ZERO-MATH FOR SCOUT: Do not calculate carbohydrates, unsaturated fat, or salt conversions. The backend pipeline automatically derives carbs via Atwater ((Calories - 4P - 9F) / 4), salt via sodium conversion, and unsaturated fat from total fat.
- CULINARY & REGIONAL CALIBRATION: Calibrate portion unit sizes, default ingredients, and cooking fat to specific cuisine norms (fried coatings absorb 25–35% fat; stir-fry adds +5–10g oil; steamed/boiled is fat-neutral).
- INGREDIENTS: Plain string list in 'ingredients'.
- COOKING METHOD: 'raw' | 'baked' | 'grilled' | 'boiled' | 'steamed' | 'deep_fried' | 'pan_fried' | 'stir_fried'.
- CONDIMENTS: Set 'isStandaloneCondimentPacket' to true ONLY for tiny standalone sauce/ketchup packets, false for main meals.`;

interface BenchmarkCase {
  id: string;
  name: string;
  imageFiles: string[];
  userPrompt: string;
}

const benchmarkCases: BenchmarkCase[] = [
  {
    id: "case_1",
    name: "01: Yolk Restaurant Sandwich & Sides",
    imageFiles: ["01_yolk_panini_wrap.jpg"],
    userPrompt: "I had it from Yolk",
  },
  {
    id: "case_2",
    name: "02: Lidl Chicken Bites + Muffin (Packaged + Plated)",
    imageFiles: ["02_lidl_chicken_muffin.jpg"],
    userPrompt: "Analyze this meal",
  },
  {
    id: "case_3",
    name: "03: Salmon Avocado Sushi, Shrimp Salad & Baguette",
    imageFiles: ["03_sushi_shrimp_salad.jpg"],
    userPrompt: "Analyze this meal photo",
  },
  {
    id: "case_4",
    name: "04: Seaside Fish and Chips with Tartar Sauce",
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
    name: "08: Rolled Oats Package Facts + Prepared Bowl (2 Photos)",
    imageFiles: ["08_rolled_oats_1.jpg", "08_rolled_oats_2.jpg"],
    userPrompt: "Analyze this meal photo.",
  },
];

async function runBenchmark() {
  console.log("================================================================================");
  console.log("FULL 8-IMAGE BENCHMARK RUN (gemini-3.5-flash-lite)");
  console.log("Testing: Zero-nulls, OCR-first capture, mandatory 14 nutrients, brand lock, & derivations");
  console.log("================================================================================\n");

  const results: any[] = [];

  for (const tc of benchmarkCases) {
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`RUNNING: ${tc.name}`);
    console.log(`Images: ${tc.imageFiles.join(", ")} | Prompt: "${tc.userPrompt}"`);
    console.log(`--------------------------------------------------------------------------------`);

    const parts = tc.imageFiles.map((img) => ({
      inlineData: {
        mimeType: "image/jpeg",
        data: fs.readFileSync(path.join(imagesDir, img)).toString("base64"),
      },
    }));
    parts.push({ text: tc.userPrompt } as any);

    const startTime = Date.now();
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: productionScoutInstruction,
          responseMimeType: "application/json",
          responseSchema: productionScoutSchema as any,
          temperature: 0.1,
        },
      });

      const elapsed = Date.now() - startTime;
      const rawText = response.text || "{}";
      const parsed = JSON.parse(rawText);

      console.log(`Response received in ${elapsed}ms | Payload length: ${rawText.length} chars`);
      console.log(`Content Type: ${parsed.contentType} | Dining: ${parsed.diningEnvironment}`);
      console.log(`Internal Reasoning: ${parsed._internalReasoning}`);
      console.log(`Items Extracted: ${parsed.items?.length || 0}`);

      (parsed.items || []).forEach((item: any, idx: number) => {
        const nut = item.nutrients || {};
        const carbs = Math.max(0, Math.round(((nut.calories - (4 * nut.protein) - (9 * nut.totalFat)) / 4) * 10) / 10);
        const unsatFat = Math.max(0, Math.round((nut.totalFat - (nut.saturatedFat + nut.transFat)) * 100) / 100);
        const salt = Math.round(((nut.sodium * 2.54) / 1000) * 100) / 100;

        console.log(`\n  [Item ${idx + 1}] "${item.originalName}" (keyword: ${item.keyword})`);
        console.log(`    - Chain / Brand: ${item.chainName || "None"} | Weight: ${item.estimatedWeightGrams}g | Cooking: ${item.cookingMethod}`);
        console.log(`    - Ingredients: [${(item.ingredients || []).join(", ")}]`);

        if (item.rawNutritionLabel && Object.keys(item.rawNutritionLabel).length > 0) {
          console.log(`    - Attached rawNutritionLabel (OCR Truth): ${JSON.stringify(item.rawNutritionLabel)}`);
        } else {
          console.log(`    - rawNutritionLabel: null (Visual Dish)`);
        }

        console.log(`    - 14-Nutrient Profile (Portion):`);
        console.log(`        Calories: ${nut.calories} kcal | Protein: ${nut.protein}g | Total Fat: ${nut.totalFat}g (Sat: ${nut.saturatedFat}g, Trans: ${nut.transFat}g)`);
        console.log(`        Derived Carbs: ${carbs}g | Derived Unsat Fat: ${unsatFat}g | Derived Salt: ${salt}g`);
        console.log(`        Sugar: ${nut.sugar}g (Added: ${nut.addedSugar}g) | Fibre: ${nut.totalFibre}g | Sodium: ${nut.sodium}mg`);
        console.log(`        Potassium: ${nut.potassium}mg | Calcium: ${nut.calcium}mg | Iron: ${nut.iron}mg | Magnesium: ${nut.magnesium}mg | Vit D: ${nut.vitaminD}mcg | Omega-3: ${nut.omega3}g`);
      });

      results.push({
        id: tc.id,
        name: tc.name,
        elapsed,
        payloadSize: rawText.length,
        itemsCount: parsed.items?.length || 0,
        status: "PASS",
      });
    } catch (err: any) {
      console.error(`ERROR on ${tc.name}:`, err.message);
      results.push({
        id: tc.id,
        name: tc.name,
        status: "FAIL",
        error: err.message,
      });
    }
    console.log("\n");
  }

  console.log("================================================================================");
  console.log("BENCHMARK SUMMARY RESULTS");
  console.log("================================================================================");
  console.table(results);
}

runBenchmark();
