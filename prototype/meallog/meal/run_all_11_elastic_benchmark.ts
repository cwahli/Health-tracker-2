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
2. Cooking Technique & Environment Auditing:
   - Carefully inspect if food is restaurant-prepared, deep-fried (battered), pan-fried, or dressed with oil. Account for true fat and sodium absorption realistically.
   - For lean unseasoned water boiling (e.g. plain home hotpot), do NOT add phantom table salt.
3. Execution & Delegation Assessment:
   - For simple or moderate meals (<= 3 distinct items), solve all dishes completely and set status = "COMPLETE".
   - For complex, multi-dish or dense multi-receipt spreads, solve the primary/anchor items, package the remaining distinct food groups into logical "delegationBatches" (e.g. BATCH_SIDES, BATCH_PRODUCE) and set status = "DELEGATE".

Follow USDA nutritional standards. Calculate dish calories using 4P + 4C + 9F.`;

const workerPromptInstruction = `You are a Specialist Nutritional Worker Agent.
You receive:
1. The full meal context and images.
2. A specific assigned delegation batch with pre-locked gram weights from the Lead Chief Scout's OCR pass.

Your Task:
- For each assigned entity in your batch, analyze its exact nutritional density, constituent ingredients, and 31 micro/macronutrients using the locked gram weights.
- Never alter locked OCR weights. Account accurately for cooking method (e.g. boiled in plain water broth vs fried/oiled) and nutrient retention.`;

// -------------------------------------------------------------
// 11 TEST CASES DEFINITION
// -------------------------------------------------------------
const allCases = [
  {
    id: 1,
    imageFiles: ["01_yolk_panini_wrap.jpg"],
    userPrompt: "I had this for lunch from Yolk",
    gt: {
      caseName: "01: YOLK Chicken Sandwich & Roasted Sides",
      weightGrams: 600,
      calories: 950,
      protein: 49.0,
      carbohydrates: 92.0,
      totalFat: 42.0,
      sodium: 1250,
    },
  },
  {
    id: 2,
    imageFiles: ["02_lidl_chicken_muffin.jpg"],
    userPrompt: "I had these from Lidl",
    gt: {
      caseName: "02: Lidl Chicken Bites & Chocolate Muffin",
      weightGrams: 195,
      calories: 557,
      protein: 21.7,
      carbohydrates: 58.0,
      totalFat: 26.5,
      sodium: 628,
    },
  },
  {
    id: 3,
    imageFiles: ["03_sushi_shrimp_salad.jpg"],
    userPrompt: "My lunch today",
    gt: {
      caseName: "03: Salmon Sushi Roll, Shrimp Pasta Salad & Baguette",
      weightGrams: 650,
      calories: 1000,
      protein: 55.5,
      carbohydrates: 134.0,
      totalFat: 25.0,
      sodium: 1350,
    },
  },
  {
    id: 4,
    imageFiles: ["04_seaside_fish_chips.jpg"],
    userPrompt: "Park takeaway with salad, parfait, and pastries",
    gt: {
      caseName: "04: Berry Parfait, Pastries & Cobb Salad",
      weightGrams: 1000,
      calories: 1630,
      protein: 75.0,
      carbohydrates: 148.0,
      totalFat: 80.0,
      sodium: 1450,
    },
  },
  {
    id: 5,
    imageFiles: ["05_cafe_waffles_coffee.jpg"],
    userPrompt: "Inflight meal tray",
    gt: {
      caseName: "05: Airline Breakfast Tray",
      weightGrams: 640,
      calories: 838,
      protein: 23.0,
      carbohydrates: 104.0,
      totalFat: 37.0,
      sodium: 520,
    },
  },
  {
    id: 6,
    imageFiles: ["06_indonesian_menu_page_1.jpg", "06_indonesian_menu_page_2.jpg"],
    userPrompt: "Mie Gacoan Indonesian noodle meal",
    gt: {
      caseName: "06: Mie Gacoan Noodles & Siomay",
      weightGrams: 570,
      calories: 780,
      protein: 27.0,
      carbohydrates: 111.0,
      totalFat: 25.0,
      sodium: 1250,
    },
  },
  {
    id: 7,
    imageFiles: ["07_sainsbury_oat_fruits.jpg"],
    userPrompt: "Fresh fruit plate and Greek yogurt oats mug",
    gt: {
      caseName: "07: Fruit Plate & Greek Yogurt Oats Mug",
      weightGrams: 550,
      calories: 442,
      protein: 14.2,
      carbohydrates: 89.0,
      totalFat: 5.3,
      sodium: 65,
    },
  },
  {
    id: 8,
    imageFiles: ["08_rolled_oats_1.jpg", "08_rolled_oats_2.jpg"],
    userPrompt: "Sunrise rolled oats porridge with nutrition label",
    gt: {
      caseName: "08: Sunrise Rolled Oats Porridge",
      weightGrams: 220,
      calories: 212,
      protein: 5.0,
      carbohydrates: 35.0,
      totalFat: 5.8,
      sodium: 0,
    },
  },
  {
    id: 9,
    imageFiles: ["09_steak_fish_chips_1.jpg", "09_steak_fish_chips_2.jpg"],
    userPrompt: "Sizzling pepper steak, fish & chips, and iced tea",
    gt: {
      caseName: "09: Sizzling Steak & Fish and Chips",
      weightGrams: 1135,
      calories: 1340,
      protein: 78.0,
      carbohydrates: 102.0,
      totalFat: 67.0,
      sodium: 1850,
    },
  },
  {
    id: 10,
    imageFiles: ["10_beef_soup_barcode_meal_0.jpg", "10_beef_soup_barcode_meal_1.jpg"],
    userPrompt: "Indonesian beef hotpot ingredients with barcodes and price stickers",
    gt: {
      caseName: "10: Indonesian Beef Hotpot",
      weightGrams: 825,
      calories: 616,
      protein: 65.2,
      carbohydrates: 45.9,
      totalFat: 23.5,
      sodium: 380,
    },
  },
  {
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
      sodium: 473,
    },
  },
];

const calcAcc = (gt: number, pred: number) => {
  if (gt === 0) return pred === 0 ? 100 : Math.max(0, 100 - pred * 10);
  const diff = Math.abs(pred - gt);
  return Math.max(0, Math.min(100, (1 - diff / gt) * 100));
};

async function runBenchmark() {
  console.log("==========================================================================================");
  console.log("FINAL BENCHMARK RUN: ELASTIC MULTI-AGENT DELEGATION FRAMEWORK (ALL 11 CASES)");
  console.log("Model: gemini-3.5-flash-lite");
  console.log("==========================================================================================\n");

  const results: any[] = [];

  for (let i = 0; i < allCases.length; i++) {
    const tc = allCases[i];
    console.log(`\n------------------------------------------------------------------------------------------`);
    console.log(`[Case ${tc.id}/11] ${tc.gt.caseName}`);
    console.log(`------------------------------------------------------------------------------------------`);

    if (i > 0) {
      await new Promise((r) => setTimeout(r, 6000));
    }

    const imageParts: any[] = [];
    for (const fn of tc.imageFiles) {
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

    const t0 = Date.now();
    let leadData: any = {};
    try {
      const leadRes = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: [
          {
            role: "user",
            parts: [
              ...imageParts,
              {
                text: `${tc.userPrompt}. Index any receipts/stickers and solve the meal. If complex, delegate remaining food batches.`,
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
      leadData = JSON.parse(leadRes.text || "{}");
    } catch (err: any) {
      console.error(`Lead Agent failed on Case ${tc.id}:`, err.message);
      continue;
    }

    const leadTime = Date.now() - t0;
    console.log(`  Lead Agent: status=${leadData.status}, solvedDishes=${leadData.solvedDishes?.length || 0}, delegations=${leadData.delegationBatches?.length || 0} (${leadTime}ms)`);

    let allDishes = [...(leadData.solvedDishes || [])];
    let numWorkers = 0;
    let workerTime = 0;

    if (leadData.status === "DELEGATE" && leadData.delegationBatches?.length > 0) {
      numWorkers = leadData.delegationBatches.length;
      const wT0 = Date.now();
      const workerPromises = leadData.delegationBatches.map(async (batch: any, bIdx: number) => {
        try {
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
Assigned Entities:
${JSON.stringify(batch.assignedEntities, null, 2)}
Global Cross Reference Registry:
${JSON.stringify(leadData.crossReferenceIndex, null, 2)}

Calculate complete dish and constituent food nutrients for these entities.`,
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
          return wData.solvedDishes || [];
        } catch (e: any) {
          console.error(`Worker ${bIdx} failed:`, e.message);
          return [];
        }
      });

      const workerOutputs = await Promise.all(workerPromises);
      workerTime = Date.now() - wT0;
      workerOutputs.forEach((dishes) => allDishes.push(...dishes));
      console.log(`  Workers (${numWorkers} parallel): completed in ${workerTime}ms`);
    }

    // Summing in pure TypeScript
    let totWeight = 0;
    let totCal = 0;
    let totP = 0;
    let totC = 0;
    let totF = 0;
    let totNa = 0;

    allDishes.forEach((d) => {
      totWeight += d.estimatedWeightGrams || 0;
      totCal += d.calories || (d.protein * 4 + d.carbohydrates * 4 + d.totalFat * 9);
      totP += d.protein || 0;
      totC += d.carbohydrates || 0;
      totF += d.totalFat || 0;
      totNa += d.sodium || 0;
    });

    const gt = tc.gt;
    const acc = {
      weight: calcAcc(gt.weightGrams, totWeight),
      cal: calcAcc(gt.calories, totCal),
      p: calcAcc(gt.protein, totP),
      c: calcAcc(gt.carbohydrates, totC),
      f: calcAcc(gt.totalFat, totF),
      na: calcAcc(gt.sodium, totNa),
    };

    console.log(`  Total Prediction: Weight=${totWeight.toFixed(0)}g (${acc.weight.toFixed(0)}%), Cal=${totCal.toFixed(0)} kcal (${acc.cal.toFixed(0)}%), P=${totP.toFixed(1)}g (${acc.p.toFixed(0)}%), F=${totF.toFixed(1)}g (${acc.f.toFixed(0)}%), Na=${totNa.toFixed(0)}mg (${acc.na.toFixed(0)}%)`);

    results.push({
      caseId: tc.id,
      caseName: gt.caseName,
      agentsUsed: 1 + numWorkers,
      status: leadData.status,
      executionTimeMs: leadTime + workerTime,
      gt,
      pred: { weight: totWeight, cal: totCal, p: totP, c: totC, f: totF, na: totNa },
      acc,
    });
  }

  fs.writeFileSync(
    path.join(process.cwd(), "prototype", "meallog", "meal", "final_elastic_benchmark_results.json"),
    JSON.stringify(results, null, 2)
  );

  console.log("\n\n==========================================================================================");
  console.log("MASTER SCORECARD & SUMMARY (ALL 11 CASES)");
  console.log("==========================================================================================\n");

  console.log("| Case | Name | Agents | Time | Weight Acc | Calorie Acc | Protein Acc | Fat Acc | Sodium Acc |");
  console.log("|:----:|:----------------------------------|:------:|:----:|:----------:|:-----------:|:-----------:|:-------:|:----------:|");
  results.forEach((r) => {
    console.log(
      `| ${r.caseId.toString().padStart(4)} | ${r.caseName.slice(0, 33).padEnd(33)} | ${(r.agentsUsed + " Ag").padStart(6)} | ${( (r.executionTimeMs / 1000).toFixed(1) + "s" ).padStart(4)} | ${(r.acc.weight.toFixed(1) + "%").padStart(10)} | ${(r.acc.cal.toFixed(1) + "%").padStart(11)} | ${(r.acc.p.toFixed(1) + "%").padStart(11)} | ${(r.acc.f.toFixed(1) + "%").padStart(7)} | ${(r.acc.na.toFixed(1) + "%").padStart(10)} |`
    );
  });
}

runBenchmark();
