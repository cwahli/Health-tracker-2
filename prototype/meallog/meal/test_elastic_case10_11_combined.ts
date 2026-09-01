import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type, Schema } from "@google/genai";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error("ERROR: GEMINI_API_KEY is not set.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const imagesDir = path.join(process.cwd(), "prototype", "meallog", "images");

// -------------------------------------------------------------
// SCHEMAS
// -------------------------------------------------------------

// Lead Agent Output Schema
const leadAgentSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    status: {
      type: Type.STRING,
      enum: ["COMPLETE", "DELEGATE"],
      description: "COMPLETE if all items could be analyzed with full precision in this turn. DELEGATE if remaining items need parallel specialist workers.",
    },
    mealName: { type: Type.STRING },
    diningEnvironment: {
      type: Type.STRING,
      enum: ["home_cooked", "casual_restaurant", "fast_food_chain", "fine_dining", "cafe", "takeaway_street_food", "packaged_food", "airline_meal"],
    },
    crossReferenceIndex: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          refId: { type: Type.STRING },
          type: { type: Type.STRING, enum: ["RECEIPT", "STICKER", "BARCODE", "PROMPT_OVERRIDE", "VISUAL_PLATE"] },
          itemText: { type: Type.STRING },
          lockedGrams: { type: Type.NUMBER },
          sourceImageIndex: { type: Type.INTEGER },
        },
        required: ["refId", "type", "itemText", "lockedGrams"],
      },
    },
    solvedDishes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          dishName: { type: Type.STRING },
          estimatedWeightGrams: { type: Type.NUMBER },
          cookingMethod: { type: Type.STRING },
          referenceIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          calories: { type: Type.NUMBER },
          protein: { type: Type.NUMBER },
          carbohydrates: { type: Type.NUMBER },
          totalFat: { type: Type.NUMBER },
          saturatedFat: { type: Type.NUMBER },
          totalFibre: { type: Type.NUMBER },
          solubleFibre: { type: Type.NUMBER },
          sodium: { type: Type.NUMBER },
          potassium: { type: Type.NUMBER },
          calcium: { type: Type.NUMBER },
          iron: { type: Type.NUMBER },
          magnesium: { type: Type.NUMBER },
          vitaminD: { type: Type.NUMBER },
          vitaminA: { type: Type.NUMBER },
          vitaminC: { type: Type.NUMBER },
          vitaminE: { type: Type.NUMBER },
          vitaminK: { type: Type.NUMBER },
          thiamine: { type: Type.NUMBER },
          riboflavin: { type: Type.NUMBER },
          niacin: { type: Type.NUMBER },
          vitaminB6: { type: Type.NUMBER },
          folate: { type: Type.NUMBER },
          vitaminB12: { type: Type.NUMBER },
          zinc: { type: Type.NUMBER },
          selenium: { type: Type.NUMBER },
          iodine: { type: Type.NUMBER },
          phosphorus: { type: Type.NUMBER },
          foods: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                foodName: { type: Type.STRING },
                estimatedWeightGrams: { type: Type.NUMBER },
                protein: { type: Type.NUMBER },
                carbohydrates: { type: Type.NUMBER },
                saturatedFat: { type: Type.NUMBER },
                sodium: { type: Type.NUMBER },
              },
              required: ["foodName", "estimatedWeightGrams", "protein", "carbohydrates", "saturatedFat", "sodium"],
            },
          },
        },
        required: ["dishName", "estimatedWeightGrams", "cookingMethod", "calories", "protein", "carbohydrates", "totalFat", "sodium", "foods"],
      },
    },
    delegationBatches: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          batchId: { type: Type.STRING },
          batchTitle: { type: Type.STRING },
          assignedEntities: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                entityName: { type: Type.STRING },
                lockedGrams: { type: Type.NUMBER },
                referenceIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                suggestedCookingMethod: { type: Type.STRING },
                notes: { type: Type.STRING },
              },
              required: ["entityName", "lockedGrams"],
            },
          },
          contextGuidance: { type: Type.STRING },
        },
        required: ["batchId", "batchTitle", "assignedEntities", "contextGuidance"],
      },
    },
  },
  required: ["status", "mealName", "diningEnvironment", "crossReferenceIndex", "solvedDishes"],
};

// Worker Output Schema
const workerAgentSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    batchId: { type: Type.STRING },
    solvedDishes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          dishName: { type: Type.STRING },
          estimatedWeightGrams: { type: Type.NUMBER },
          cookingMethod: { type: Type.STRING },
          calories: { type: Type.NUMBER },
          protein: { type: Type.NUMBER },
          carbohydrates: { type: Type.NUMBER },
          totalFat: { type: Type.NUMBER },
          saturatedFat: { type: Type.NUMBER },
          totalFibre: { type: Type.NUMBER },
          solubleFibre: { type: Type.NUMBER },
          sodium: { type: Type.NUMBER },
          potassium: { type: Type.NUMBER },
          calcium: { type: Type.NUMBER },
          iron: { type: Type.NUMBER },
          magnesium: { type: Type.NUMBER },
          vitaminD: { type: Type.NUMBER },
          vitaminA: { type: Type.NUMBER },
          vitaminC: { type: Type.NUMBER },
          vitaminE: { type: Type.NUMBER },
          vitaminK: { type: Type.NUMBER },
          thiamine: { type: Type.NUMBER },
          riboflavin: { type: Type.NUMBER },
          niacin: { type: Type.NUMBER },
          vitaminB6: { type: Type.NUMBER },
          folate: { type: Type.NUMBER },
          vitaminB12: { type: Type.NUMBER },
          zinc: { type: Type.NUMBER },
          selenium: { type: Type.NUMBER },
          iodine: { type: Type.NUMBER },
          phosphorus: { type: Type.NUMBER },
          foods: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                foodName: { type: Type.STRING },
                estimatedWeightGrams: { type: Type.NUMBER },
                protein: { type: Type.NUMBER },
                carbohydrates: { type: Type.NUMBER },
                saturatedFat: { type: Type.NUMBER },
                sodium: { type: Type.NUMBER },
              },
              required: ["foodName", "estimatedWeightGrams", "protein", "carbohydrates", "saturatedFat", "sodium"],
            },
          },
        },
        required: ["dishName", "estimatedWeightGrams", "cookingMethod", "calories", "protein", "carbohydrates", "totalFat", "sodium", "foods"],
      },
    },
  },
  required: ["batchId", "solvedDishes"],
};

// -------------------------------------------------------------
// PROMPTS
// -------------------------------------------------------------
const leadPromptInstruction = `You are the Lead Chief Nutritional Vision Scout.
You receive all uploaded meal images (including cooked plates, ingredients, thermal receipts, price stickers, and brand packaging) along with the user's prompt.

Your Responsibilities:
1. Global Indexing & Cross-Referencing:
   - Read every receipt line, price sticker, barcode, and user prompt statement across all images.
   - Cross-reference OCR items to the visual foods on the plate/table.
   - Lock exact gram weights from OCR into crossReferenceIndex.
2. Direct Execution of Primary Dishes:
   - Immediately solve the primary/anchor protein dish(es) of the meal with exact calories, macros, and all requested micronutrients.
3. Elastic Delegation Assessment:
   - This is a large, complex multi-image feast combining multiple meats, seafood, vegetables, and staples.
   - Package the remaining distinct food groups into logical "delegationBatches" (e.g. BATCH_BEEF_MEATS, BATCH_PRODUCE_GREENS, BATCH_OATS_STAPLES) and set status = "DELEGATE".

Follow USDA nutritional standards. Calculate dish calories using 4P + 4C + 9F.`;

const workerPromptInstruction = `You are a Specialist Nutritional Worker Agent.
You receive:
1. The full meal context and images.
2. A specific assigned delegation batch with pre-locked gram weights from the Lead Chief Scout's OCR pass.

Your Task:
- For each assigned entity in your batch, analyze its exact nutritional density, constituent ingredients, and 31 micro/macronutrients using the locked gram weights.
- Never alter locked OCR weights. Account accurately for cooking method (e.g. boiled in plain water broth vs fried) and nutrient retention.`;

// -------------------------------------------------------------
// COMBINED CASE 10 + CASE 11 DATA (MEGA BANQUET)
// -------------------------------------------------------------
const combinedImages = [
  "10_beef_soup_barcode_meal_0.jpg",
  "10_beef_soup_barcode_meal_1.jpg",
  "11_seafood_squid_fish_ingredients.jpg",
  "11_seafood_squid_fish_receipt_1.jpg",
  "11_seafood_squid_fish_receipt_2.jpg",
];

const combinedPrompt = "We had a big hotpot dinner party with [Mr Oat Rolled Oats 70g] and all the fresh beef, seafood, vegetables, and ingredients in all the photos and receipts.";

// Sum of Case 10 GT + Case 11 GT
const groundTruthCombined = {
  caseName: "Mega Feast: Combined Case 10 (Beef Hotpot) + Case 11 (Seafood & Oats Hotpot)",
  weightGrams: 825 + 892, // 1717g
  calories: 616 + 822, // 1438 kcal
  protein: 65.2 + 95.1, // 160.3g
  carbohydrates: 45.9 + 69.0, // 114.9g
  totalFat: 23.5 + 20.8, // 44.3g
  sodium: 380 + 473, // 853 mg
  dietaryFibre: 15.0 + 12.2, // 27.2g
  potassium: 1450 + 1980, // 3430 mg
  calcium: 180 + 210, // 390 mg
  iron: 8.5 + 7.2, // 15.7 mg
  magnesium: 140 + 185, // 325 mg
  vitaminD: 0.8 + 4.2, // 5.0 mcg
  vitaminA: 350 + 420, // 770 mcg
  vitaminC: 85 + 38, // 123 mg
  zinc: 9.5 + 6.2, // 15.7 mg
  selenium: 45 + 95, // 140 mcg
};

// -------------------------------------------------------------
// RUNNER
// -------------------------------------------------------------
async function runCombinedMegaTest() {
  console.log("==========================================================================================");
  console.log("MEGA STRESS-TEST: COMBINED CASE 10 + CASE 11 (5 IMAGES, MULTIPLE RECEIPTS, STICKERS, 10+ FOODS)");
  console.log("Model: gemini-3.5-flash-lite");
  console.log("==========================================================================================\n");

  const imageParts: any[] = [];
  for (const fn of combinedImages) {
    const p = path.join(imagesDir, fn);
    if (fs.existsSync(p)) {
      imageParts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: fs.readFileSync(p).toString("base64"),
        },
      });
    }
  }

  // -----------------------------------------------------------
  // PHASE 1: LEAD CHIEF SCOUT (Agent 1)
  // -----------------------------------------------------------
  console.log("[Phase 1] Launching Lead Chief Scout (Agent 1) across 5 high-res images...");
  const t0 = Date.now();

  const leadRes = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: [
      {
        role: "user",
        parts: [
          ...imageParts,
          {
            text: `${combinedPrompt}. Index ALL price stickers, barcodes, and receipts across all 5 images. Solve the anchor protein dishes, and partition the remaining produce, beef, and staples into parallel delegation batches.`,
          },
        ],
      },
    ],
    config: {
      systemInstruction: leadPromptInstruction,
      responseMimeType: "application/json",
      responseSchema: leadAgentSchema,
      temperature: 0.1,
    },
  });

  const leadTime = Date.now() - t0;
  const leadData = JSON.parse(leadRes.text || "{}");

  console.log(`\nLead Agent Completed in ${leadTime}ms.`);
  console.log(`Status:               ${leadData.status}`);
  console.log(`Meal Name:            ${leadData.mealName}`);
  console.log(`Dining Environment:   ${leadData.diningEnvironment}`);
  console.log(`\nGlobal Cross-Reference Index (Locked Facts from OCR across all 5 images):`);
  leadData.crossReferenceIndex?.forEach((ref: any) => {
    console.log(`  • [${ref.refId.padEnd(8)}] ${ref.type.padEnd(16)}: ${ref.itemText.padEnd(26)} -> ${ref.lockedGrams}g (Image ${ref.sourceImageIndex ?? "N/A"})`);
  });

  console.log(`\nDishes Solved Directly by Lead Agent (Agent 1):`);
  leadData.solvedDishes?.forEach((d: any, idx: number) => {
    console.log(`  [Lead Dish ${idx + 1}] ${d.dishName} (${d.estimatedWeightGrams}g, ${d.cookingMethod}) -> ${d.calories} kcal, P:${d.protein}g, C:${d.carbohydrates}g, F:${d.totalFat}g, Na:${d.sodium}mg`);
  });

  let allDishes = [...(leadData.solvedDishes || [])];

  // -----------------------------------------------------------
  // PHASE 2: PARALLEL WORKER DISPATCH (If DELEGATE)
  // -----------------------------------------------------------
  if (leadData.status === "DELEGATE" && leadData.delegationBatches?.length > 0) {
    console.log(`\n[Phase 2] Spawning ${leadData.delegationBatches.length} Parallel Worker Agents concurrently...`);
    const workerT0 = Date.now();

    const workerPromises = leadData.delegationBatches.map(async (batch: any, bIdx: number) => {
      console.log(`  -> Launching Worker Agent ${bIdx + 2} for Batch: "${batch.batchTitle}" (${batch.batchId}) with ${batch.assignedEntities.length} items...`);
      const workerRes = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: [
          {
            role: "user",
            parts: [
              ...imageParts,
              {
                text: `You are assigned batch: "${batch.batchTitle}" (ID: ${batch.batchId}).
Context: ${batch.contextGuidance}
Assigned Entities with Locked Gram Weights from Lead Scout:
${JSON.stringify(batch.assignedEntities, null, 2)}

Global Cross Reference Registry:
${JSON.stringify(leadData.crossReferenceIndex, null, 2)}

Calculate complete dish and constituent food nutrients for these assigned entities only.`,
              },
            ],
          },
        ],
        config: {
          systemInstruction: workerPromptInstruction,
          responseMimeType: "application/json",
          responseSchema: workerAgentSchema,
          temperature: 0.1,
        },
      });

      const wData = JSON.parse(workerRes.text || "{}");
      return { bIdx, wData };
    });

    const workerResults = await Promise.all(workerPromises);
    const workerTime = Date.now() - workerT0;
    console.log(`\nAll ${workerResults.length} Worker Agents finished concurrently in ${workerTime}ms!`);

    workerResults.forEach(({ bIdx, wData }) => {
      console.log(`\n  === Worker Agent ${bIdx + 2} Output (${wData.batchId}) ===`);
      wData.solvedDishes?.forEach((d: any, dIdx: number) => {
        console.log(`    [Dish ${dIdx + 1}] ${d.dishName} (${d.estimatedWeightGrams}g, ${d.cookingMethod}) -> ${d.calories} kcal, P:${d.protein}g, C:${d.carbohydrates}g, F:${d.totalFat}g, Na:${d.sodium}mg`);
        allDishes.push(d);
      });
    });
  }

  // -----------------------------------------------------------
  // PHASE 3: DETERMINISTIC MERGE & COMPARISON
  // -----------------------------------------------------------
  console.log("\n==========================================================================================");
  console.log("PHASE 3: DETERMINISTIC AGGREGATION & COMBINED BENCHMARK EVALUATION");
  console.log("==========================================================================================");

  let totalWeight = 0;
  let totalCal = 0;
  let totalP = 0;
  let totalC = 0;
  let totalF = 0;
  let totalNa = 0;
  let totalFib = 0;
  let totalK = 0;
  let totalCa = 0;
  let totalFe = 0;
  let totalMg = 0;
  let totalVitD = 0;
  let totalVitA = 0;
  let totalVitC = 0;
  let totalZinc = 0;
  let totalSelenium = 0;

  allDishes.forEach((d) => {
    totalWeight += d.estimatedWeightGrams || 0;
    totalCal += d.calories || (d.protein * 4 + d.carbohydrates * 4 + d.totalFat * 9);
    totalP += d.protein || 0;
    totalC += d.carbohydrates || 0;
    totalF += d.totalFat || 0;
    totalNa += d.sodium || 0;
    totalFib += d.totalFibre || 0;
    totalK += d.potassium || 0;
    totalCa += d.calcium || 0;
    totalFe += d.iron || 0;
    totalMg += d.magnesium || 0;
    totalVitD += d.vitaminD || 0;
    totalVitA += d.vitaminA || 0;
    totalVitC += d.vitaminC || 0;
    totalZinc += d.zinc || 0;
    totalSelenium += d.selenium || 0;
  });

  const gt = groundTruthCombined;
  const printComparisonRow = (name: string, gtVal: number, predVal: number, unit: string) => {
    const acc = gtVal > 0 ? Math.max(0, Math.min(100, (1 - Math.abs(predVal - gtVal) / gtVal) * 100)).toFixed(1) : "100.0";
    const delta = (predVal - gtVal).toFixed(1);
    const deltaStr = Number(delta) >= 0 ? `+${delta}` : `${delta}`;
    console.log(`| ${name.padEnd(18)} | ${(gtVal + " " + unit).padStart(12)} | ${(predVal.toFixed(1) + " " + unit).padStart(12)} | ${(deltaStr + " " + unit).padStart(11)} | ${(acc + "%").padStart(10)} |`);
  };

  console.log(`\nTotal Food Entities Resolved across all Agents: ${allDishes.length} distinct dishes.`);
  console.log(`\nMaster Macro & Key Nutrient Comparison:`);
  console.log(`| Nutrient           | Ground Truth | Elastic Pred | Delta       | Accuracy   |`);
  console.log(`|:-------------------|:------------:|:------------:|:-----------:|:----------:|`);
  printComparisonRow("Total Weight", gt.weightGrams, totalWeight, "g");
  printComparisonRow("Calories", gt.calories, totalCal, "kcal");
  printComparisonRow("Protein", gt.protein, totalP, "g");
  printComparisonRow("Carbohydrates", gt.carbohydrates, totalC, "g");
  printComparisonRow("Total Fat", gt.totalFat, totalF, "g");
  printComparisonRow("Dietary Fibre", gt.dietaryFibre, totalFib, "g");
  printComparisonRow("Sodium", gt.sodium, totalNa, "mg");
  printComparisonRow("Potassium", gt.potassium, totalK, "mg");
  printComparisonRow("Calcium", gt.calcium, totalCa, "mg");
  printComparisonRow("Iron", gt.iron, totalFe, "mg");
  printComparisonRow("Magnesium", gt.magnesium, totalMg, "mg");
  printComparisonRow("Vitamin D", gt.vitaminD, totalVitD, "mcg");
  printComparisonRow("Vitamin A", gt.vitaminA, totalVitA, "mcg");
  printComparisonRow("Vitamin C", gt.vitaminC, totalVitC, "mg");
  printComparisonRow("Zinc", gt.zinc, totalZinc, "mg");
  printComparisonRow("Selenium", gt.selenium, totalSelenium, "mg");
}

runCombinedMegaTest();
