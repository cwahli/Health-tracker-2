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
   - Read every receipt line, price sticker, barcode, and user prompt statement.
   - Cross-reference OCR items to the visual foods on the plate/table.
   - Lock exact gram weights from OCR into crossReferenceIndex.
2. Direct Execution of Primary Dishes:
   - Immediately solve the primary/anchor dish(es) of the meal with exact calories, macros, and all requested micronutrients.
3. Elastic Delegation Assessment:
   - If the meal has multiple remaining sides/components and you need to preserve token precision, assign the remaining items to "delegationBatches" and set status = "DELEGATE".
   - If you can comfortably solve everything with 100% precision in this turn, complete all dishes and set status = "COMPLETE".

Follow USDA nutritional standards. Calculate dish calories using 4P + 4C + 9F.`;

const workerPromptInstruction = `You are a Specialist Nutritional Worker Agent.
You receive:
1. The full meal context and images.
2. A specific assigned delegation batch with pre-locked gram weights from the Lead Chief Scout's OCR pass.

Your Task:
- For each assigned entity in your batch, analyze its exact nutritional density, constituent ingredients, and 31 micro/macronutrients using the locked gram weights.
- Never alter locked OCR weights. Account accurately for cooking method (e.g. boiled in broth vs fried) and nutrient retention.`;

// -------------------------------------------------------------
// TEST CASE 11 DATA
// -------------------------------------------------------------
const case11 = {
  id: 11,
  imageFiles: [
    "11_seafood_squid_fish_ingredients.jpg",
    "11_seafood_squid_fish_receipt_1.jpg",
    "11_seafood_squid_fish_receipt_2.jpg",
  ],
  userPrompt: "I had [Mr Oat Rolled Oats 70g] and all food in the pictures",
  gt: {
    caseName: "11: Seafood & Vegetable Hotpot with Oats",
    weightGrams: 892,
    calories: 822,
    protein: 95.1,
    carbohydrates: 69.0,
    totalFat: 20.8,
    saturatedFat: 4.6,
    dietaryFibre: 12.2,
    sodium: 473,
    totalSugar: 3.5,
    addedSugar: 0.0,
    potassium: 1980,
    calcium: 210,
    iron: 7.2,
    magnesium: 185,
    vitaminD: 4.2,
    solubleFibre: 3.8,
    vitaminA: 420,
    thiamine: 0.55,
    riboflavin: 0.48,
    niacin: 14.5,
    vitaminB6: 1.15,
    folate: 165,
    vitaminB12: 8.5,
    vitaminC: 38,
    vitaminE: 4.2,
    vitaminK: 110,
    zinc: 6.2,
    selenium: 95,
    iodine: 180,
    phosphorus: 920,
  },
};

// -------------------------------------------------------------
// RUNNER
// -------------------------------------------------------------
async function runElasticCase11() {
  console.log("==========================================================================================");
  console.log("TESTING ELASTIC MULTI-AGENT DELEGATION FRAMEWORK ON CASE 11");
  console.log("Images: 1 Plate + 2 Thermal Receipts | User Prompt with Oats Override");
  console.log("Model: gemini-3.5-flash-lite");
  console.log("==========================================================================================\n");

  const imageParts: any[] = [];
  for (const fn of case11.imageFiles) {
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
  console.log("[Phase 1] Launching Lead Chief Scout (Agent 1)...");
  const t0 = Date.now();

  const leadRes = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: [
      {
        role: "user",
        parts: [
          ...imageParts,
          {
            text: `${case11.userPrompt}. Perform full cross-referencing between receipts/stickers and visual plate items. Solve anchor seafood dishes, and if delegation is needed for produce/oats, emit delegationBatches.`,
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

  console.log(`Lead Agent Completed in ${leadTime}ms.`);
  console.log(`Status:               ${leadData.status}`);
  console.log(`Meal Name:            ${leadData.mealName}`);
  console.log(`Dining Environment:   ${leadData.diningEnvironment}`);
  console.log(`\nCross-Reference Index (Locked Facts from OCR & Prompt):`);
  leadData.crossReferenceIndex?.forEach((ref: any) => {
    console.log(`  • [${ref.refId}] ${ref.type.padEnd(16)}: ${ref.itemText.padEnd(20)} -> ${ref.lockedGrams}g (Image ${ref.sourceImageIndex ?? "N/A"})`);
  });

  console.log(`\nDishes Solved by Lead Agent (Agent 1):`);
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

Calculate complete dish and constituent food nutrients for these entities only.`,
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
    console.log(`All ${workerResults.length} Worker Agents finished concurrently in ${workerTime}ms!`);

    workerResults.forEach(({ bIdx, wData }) => {
      console.log(`\n  --- Worker Agent ${bIdx + 2} Output (${wData.batchId}) ---`);
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
  console.log("PHASE 3: DETERMINISTIC AGGREGATION & GROUND TRUTH BENCHMARK");
  console.log("==========================================================================================");

  let totalWeight = 0;
  let totalCal = 0;
  let totalP = 0;
  let totalC = 0;
  let totalF = 0;
  let totalSatF = 0;
  let totalFib = 0;
  let totalNa = 0;
  let totalK = 0;
  let totalCa = 0;
  let totalFe = 0;
  let totalMg = 0;
  let totalVitD = 0;
  let totalSolFib = 0;
  let totalVitA = 0;
  let totalThiamine = 0;
  let totalRiboflavin = 0;
  let totalNiacin = 0;
  let totalB6 = 0;
  let totalFolate = 0;
  let totalB12 = 0;
  let totalVitC = 0;
  let totalVitE = 0;
  let totalVitK = 0;
  let totalZinc = 0;
  let totalSelenium = 0;
  let totalIodine = 0;
  let totalPhosphorus = 0;

  allDishes.forEach((d) => {
    totalWeight += d.estimatedWeightGrams || 0;
    totalCal += d.calories || (d.protein * 4 + d.carbohydrates * 4 + d.totalFat * 9);
    totalP += d.protein || 0;
    totalC += d.carbohydrates || 0;
    totalF += d.totalFat || 0;
    totalSatF += d.saturatedFat || 0;
    totalFib += d.totalFibre || 0;
    totalSolFib += d.solubleFibre || 0;
    totalNa += d.sodium || 0;
    totalK += d.potassium || 0;
    totalCa += d.calcium || 0;
    totalFe += d.iron || 0;
    totalMg += d.magnesium || 0;
    totalVitD += d.vitaminD || 0;
    totalVitA += d.vitaminA || 0;
    totalThiamine += d.thiamine || 0;
    totalRiboflavin += d.riboflavin || 0;
    totalNiacin += d.niacin || 0;
    totalB6 += d.vitaminB6 || 0;
    totalFolate += d.folate || 0;
    totalB12 += d.vitaminB12 || 0;
    totalVitC += d.vitaminC || 0;
    totalVitE += d.vitaminE || 0;
    totalVitK += d.vitaminK || 0;
    totalZinc += d.zinc || 0;
    totalSelenium += d.selenium || 0;
    totalIodine += d.iodine || 0;
    totalPhosphorus += d.phosphorus || 0;
  });

  const gt = case11.gt;
  const printComparisonRow = (name: string, gtVal: number, predVal: number, unit: string) => {
    const acc = gtVal > 0 ? Math.max(0, Math.min(100, (1 - Math.abs(predVal - gtVal) / gtVal) * 100)).toFixed(1) : "100.0";
    const delta = (predVal - gtVal).toFixed(1);
    const deltaStr = Number(delta) >= 0 ? `+${delta}` : `${delta}`;
    console.log(`| ${name.padEnd(18)} | ${(gtVal + " " + unit).padStart(12)} | ${(predVal.toFixed(1) + " " + unit).padStart(12)} | ${(deltaStr + " " + unit).padStart(11)} | ${(acc + "%").padStart(10)} |`);
  };

  console.log(`\nMaster Macro & Key Nutrient Comparison:`);
  console.log(`| Nutrient           | Ground Truth | Elastic Pred | Delta       | Accuracy   |`);
  console.log(`|:-------------------|:------------:|:------------:|:-----------:|:----------:|`);
  printComparisonRow("Total Weight", gt.weightGrams, totalWeight, "g");
  printComparisonRow("Calories", gt.calories, totalCal, "kcal");
  printComparisonRow("Protein", gt.protein, totalP, "g");
  printComparisonRow("Carbohydrates", gt.carbohydrates, totalC, "g");
  printComparisonRow("Total Fat", gt.totalFat, totalF, "g");
  printComparisonRow("Saturated Fat", gt.saturatedFat, totalSatF, "g");
  printComparisonRow("Dietary Fibre", gt.dietaryFibre, totalFib, "g");
  printComparisonRow("Sodium", gt.sodium, totalNa, "mg");
  printComparisonRow("Potassium", gt.potassium, totalK, "mg");
  printComparisonRow("Calcium", gt.calcium, totalCa, "mg");
  printComparisonRow("Iron", gt.iron, totalFe, "mg");
  printComparisonRow("Magnesium", gt.magnesium, totalMg, "mg");
  printComparisonRow("Vitamin D", gt.vitaminD, totalVitD, "mcg");

  console.log(`\n15 Summary Micronutrients:`);
  console.log(`| Nutrient           | Ground Truth | Elastic Pred | Delta       | Accuracy   |`);
  console.log(`|:-------------------|:------------:|:------------:|:-----------:|:----------:|`);
  printComparisonRow("Soluble Fibre", gt.solubleFibre, totalSolFib, "g");
  printComparisonRow("Vitamin A", gt.vitaminA, totalVitA, "mcg");
  printComparisonRow("Thiamine (B1)", gt.thiamine, totalThiamine, "mg");
  printComparisonRow("Riboflavin (B2)", gt.riboflavin, totalRiboflavin, "mg");
  printComparisonRow("Niacin (B3)", gt.niacin, totalNiacin, "mg");
  printComparisonRow("Vitamin B6", gt.vitaminB6, totalB6, "mg");
  printComparisonRow("Folate (B9)", gt.folate, totalFolate, "mcg");
  printComparisonRow("Vitamin B12", gt.vitaminB12, totalB12, "mcg");
  printComparisonRow("Vitamin C", gt.vitaminC, totalVitC, "mg");
  printComparisonRow("Vitamin E", gt.vitaminE, totalVitE, "mg");
  printComparisonRow("Vitamin K", gt.vitaminK, totalVitK, "mcg");
  printComparisonRow("Zinc", gt.zinc, totalZinc, "mg");
  printComparisonRow("Selenium", gt.selenium, totalSelenium, "mg");
  printComparisonRow("Iodine", gt.iodine, totalIodine, "mcg");
  printComparisonRow("Phosphorus", gt.phosphorus, totalPhosphorus, "mg");
}

runElasticCase11();
