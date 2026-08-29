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

export const bottomUpScoutSchema = {
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
          // 2. 14 Mandatory Physical Nutrient Numbers (Direct Macronutrient Estimation, ZERO-CALORIE input)
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

export const bottomUpScoutInstruction = `System Instruction:
STEP 1: SCENE CLASSIFICATION & ENVIRONMENT
- 'contentType': 'visual' (food photo), 'menu_or_poster' (menu/kiosk screen), 'label' (nutrition panel), or 'text'.
- 'diningEnvironment': 'casual_restaurant' | 'fast_food_chain' | 'home_cooked' | 'fine_dining' | 'airline' | 'unknown'.

STEP 2: UNIVERSAL DISH EXTRACTION & OCR ATTACHMENT
- USER SCOPE ANCHOR: Extract EVERY distinct physical food, drink, side, or companion dish in 'items'. For open cups, estimate weight by fill level. The user's explicit text sentence is absolute ground truth. If the user explicitly limits consumption (e.g. "I only had 1 croissant", "I just ate the salad"), strictly extract ONLY specified items and skip all others.
- CROSS-IMAGE DEDUPLICATION: If photos show menu + food, or raw grocery packages + prepared dish, extract each distinct dish ONCE. Never create separate dummy "Nutrition Facts Label" items.
- KNOWN BRANDS: For any restaurant chain or branded product (e.g. McDonald's, Yolk, Starbucks, Pret, Lidl, Sainsbury), output brand name alone in 'chainName' and exact dish title in 'originalName'. Leave 'chainName' null for unbranded items. Apply brand name only to branded items; emit companion fresh fruits/drinks as unbranded.
- DIRECT OCR FIRST: If a package label or menu panel is visible, transcribe ALL printed facts directly into 'rawNutritionLabel' FIRST (including servingSize, calories, protein, totalFat, saturatedFat, totalCarbohydrate, sugar, sodium). Omit unprinted label keys completely (NEVER emit "key": null). If no label is visible, set 'rawNutritionLabel' to null.
- PRECISE COUNTING: Inspect open pastry bags/boxes for stacked items. Split into individual items with realistic weights.

STEP 3: 14 MANDATORY PHYSICAL NUTRIENTS (DIRECT MACRONUTRIENT ESTIMATION, ZERO CALORIE INPUT)
- For EVERY dish, provide complete numeric portion estimates across all 14 required keys in 'nutrients' (scaled to estimated consumed weight in grams): protein, carbohydrates, totalFat, saturatedFat, transFat, sugar, addedSugar, totalFibre, sodium, potassium, omega3, calcium, iron, magnesium, vitaminD. NEVER emit null in nutrients.
- ZERO CALORIE ESTIMATION: Do NOT estimate or provide calories. The backend pipeline computes Calories bottom-up deterministically via: Calories = (4 * Protein) + (4 * Carbohydrates) + (9 * TotalFat).
- DIRECT CARBOHYDRATE ESTIMATION: Estimate carbohydrates directly based on visible physical starch mass and sweet liquids:
  * Potato wedges / French fries: ~20–25% carbs by weight (e.g. 60g wedges = 12–15g carbs).
  * Fried batter coating: ~25–30% carbs of coating weight (e.g. 50g batter = ~15g carbs).
  * Lean beef steak / fish / chicken: 0g carbs.
  * Mixed vegetables (corn, peas, carrots): ~10–12g carbs per 100g.
  * Sweetened iced tea / soda: ~7–10g carbs per 100ml.
- CULINARY & REGIONAL CALIBRATION: Calibrate portion unit sizes, default ingredients, and cooking fat to specific cuisine norms (fried coatings absorb 25–35% fat; stir-fry adds +5–10g oil; steamed/boiled is fat-neutral).
- INGREDIENTS: Plain string list in 'ingredients' (e.g. ["beef steak", "black pepper sauce", "potato wedges", "corn"]).
- COOKING METHOD: 'raw' | 'baked' | 'grilled' | 'boiled' | 'steamed' | 'deep_fried' | 'pan_fried' | 'stir_fried'.
- CONDIMENTS: Set 'isStandaloneCondimentPacket' to true ONLY for tiny standalone sauce/ketchup packets, butter tubs, or jam packs <=30g, false for main meals.`;

interface BenchmarkCase {
  id: string;
  name: string;
  imageFiles: string[];
  userPrompt: string;
}

const benchmarkCases: BenchmarkCase[] = [
  {
    id: "case_9",
    name: "09: Fish & Chips + Sizzling Beef Steak Platter & Iced Tea (2-Photo Restaurant Set)",
    imageFiles: ["09_steak_fish_chips_1.jpg", "09_steak_fish_chips_2.jpg"],
    userPrompt: "Analyze this meal photo.",
  },
  {
    id: "case_4",
    name: "04: Seaside Fish and Chips with Tartar Sauce",
    imageFiles: ["04_seaside_fish_chips.jpg"],
    userPrompt: "Fish and chips meal by the seaside",
  },
  {
    id: "case_1",
    name: "01: Yolk Restaurant Sandwich & Sides",
    imageFiles: ["01_yolk_panini_wrap.jpg"],
    userPrompt: "I had it from Yolk",
  },
  {
    id: "case_8",
    name: "08: Rolled Oats Package Facts + Prepared Bowl (2 Photos)",
    imageFiles: ["08_rolled_oats_1.jpg", "08_rolled_oats_2.jpg"],
    userPrompt: "Analyze this meal photo.",
  },
];

async function runBottomUpBenchmark() {
  console.log("================================================================================");
  console.log("BOTTOM-UP CALORIE & DIRECT CARBOHYDRATE ESTIMATION PROTOTYPE RUN");
  console.log("Model: gemini-3.5-flash-lite");
  console.log("Rule: Scout inputs Carbs (g), Protein (g), Fat (g) -> Backend computes (4P + 4C + 9F)");
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
          systemInstruction: bottomUpScoutInstruction,
          responseMimeType: "application/json",
          responseSchema: bottomUpScoutSchema as any,
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

      let totalMealCalories = 0;
      let totalMealProtein = 0;
      let totalMealCarbs = 0;
      let totalMealFat = 0;
      let totalMealSodium = 0;

      (parsed.items || []).forEach((item: any, idx: number) => {
        const nut = item.nutrients || {};
        const protein = Number(nut.protein) || 0;
        const carbs = Number(nut.carbohydrates) || 0;
        const totalFat = Number(nut.totalFat) || 0;
        const satFat = Number(nut.saturatedFat) || 0;
        const transFat = Number(nut.transFat) || 0;
        const sodium = Number(nut.sodium) || 0;

        // Bottom-up thermodynamic calorie calculation: (4 * P) + (4 * C) + (9 * F)
        const computedCalories = Math.round((4 * protein) + (4 * carbs) + (9 * totalFat));
        const unsatFat = Math.max(0, Math.round((totalFat - (satFat + transFat)) * 100) / 100);
        const salt = Math.round(((sodium * 2.54) / 1000) * 100) / 100;

        totalMealCalories += computedCalories;
        totalMealProtein += protein;
        totalMealCarbs += carbs;
        totalMealFat += totalFat;
        totalMealSodium += sodium;

        console.log(`\n  [Item ${idx + 1}] "${item.originalName}" (keyword: ${item.keyword})`);
        console.log(`    - Weight: ${item.estimatedWeightGrams}g | Cooking: ${item.cookingMethod} | Chain: ${item.chainName || "None"}`);
        console.log(`    - Ingredients: [${(item.ingredients || []).join(", ")}]`);

        if (item.rawNutritionLabel && Object.keys(item.rawNutritionLabel).length > 0) {
          console.log(`    - Printed OCR Label: ${JSON.stringify(item.rawNutritionLabel)}`);
        }

        console.log(`    - Direct Scout Estimates:`);
        console.log(`        Protein: ${protein}g | Carbohydrates (Starch/Sugar): ${carbs}g | Total Fat: ${totalFat}g (Sat: ${satFat}g)`);
        console.log(`        Sugar: ${nut.sugar}g (Added: ${nut.addedSugar}g) | Fibre: ${nut.totalFibre}g | Sodium: ${sodium}mg`);
        console.log(`    - Bottom-Up Computed Metrics:`);
        console.log(`        ✨ Computed Calories (4P + 4C + 9F): ${computedCalories} kcal`);
        console.log(`        ✨ Derived Unsat Fat: ${unsatFat}g | Derived Salt: ${salt}g`);
      });

      console.log(`\n  >>> TOTAL MEAL AGGREGATION (Bottom-Up):`);
      console.log(`      Calories: ${totalMealCalories} kcal | Protein: ${totalMealProtein}g | Carbs: ${totalMealCarbs}g | Fat: ${totalMealFat}g | Sodium: ${totalMealSodium}mg`);

      results.push({
        id: tc.id,
        name: tc.name,
        elapsed,
        itemsCount: parsed.items?.length || 0,
        totalCalories: totalMealCalories,
        totalProtein: `${totalMealProtein}g`,
        totalCarbs: `${totalMealCarbs}g`,
        totalFat: `${totalMealFat}g`,
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
  console.log("BOTTOM-UP BENCHMARK SUMMARY RESULTS");
  console.log("================================================================================");
  console.table(results);
}

runBottomUpBenchmark();
