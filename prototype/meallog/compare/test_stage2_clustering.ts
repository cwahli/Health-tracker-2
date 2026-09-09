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

async function testStage2Clustering() {
  const opt1Path = path.join(process.cwd(), "prototype", "meallog", "compare", "option1_test_output.json");
  const opt1 = JSON.parse(fs.readFileSync(opt1Path, "utf-8"));
  const allDishes: string[] = opt1.menuSections.flatMap((s: any) => s.items);

  console.log(`=== Testing Stage 2: Pure Nutritional Clustering on ${allDishes.length} Items ===`);

  const systemInstruction = `=== NUTRITIONAL TARGET STATUS ===
3 days avg: Sat fat (27.7g - 38% over), Calorie (2500kcal - 39% over), Sodium (3000mg - 30% over), Protein (100g - 17% under), Carbohydrates (263.3g - 32% over), Total Fibre (22.3g - 26% under), Potassium (2100mg), Soluble Fibre (3.5g), Added Sugar (45g - 50% over), Trans Fat (0.1g)

You are a Clinical Dietitian clustering food options for Mode D evaluation.

TASK: PARTITION THE DISHES INTO NUTRITIONAL CLUSTERS WITH <=10% MACRO VARIANCE.
CRITICAL INVARIANTS:
1. <=10% MACRO VARIANCE CLUSTERING:
   - Group items together ONLY if estimated macronutrients (calories, fat, protein, carbs per 100g) differ by <=10%.
   - DO NOT create giant catch-all tiers. You MUST split into distinct preparation and culinary categories:
     * Clear / Water-Poached Soups & Broths (Sayur Asem, Sop)
     * Boiled Vegetables & Fresh Lalapan (Kangkung Rebus)
     * Stir-Fried Vegetables with Oil/Paste (Tumisan)
     * Plain Carbohydrate Staples (Nasi Putih)
     * Coconut Rice & Fried Carb Dishes (Nasi Uduk, Nasi Goreng)
     * Lean Grilled / Steamed Whole Fish (Pepes, Ikan Bakar)
     * Deep-Fried Poultry / Meat Packages (Paket Ayam/Bebek Goreng)
     * Highly Salted Cured Proteins (Ikan Asin, Peda)
     * Organ Meats & Fried Offal (Sate Usus, Kulit, Ati)
     * Ultra-Processed Spicy Starches (Seblak)
     * Sweet Confectionery & Porridges (Bubur Manis, Desserts)
   - Every single one of the provided ${allDishes.length} dishes MUST be classified into exactly one cluster.
2. TARGET-DRIVEN CLINICAL RANKING:
   - Rank the clusters from safest/healthiest for the patient down to highest hazard (good -> neutral -> warning -> alert).
   - Tailor verdict, comparative sentence, and clinical message (with ordering tip) to patient's active surpluses and deficits.`;

  const schema = {
    type: Type.OBJECT,
    properties: {
      comparisonTitle: { type: Type.STRING },
      recommendedOption: { type: Type.STRING },
      summary: { type: Type.STRING },
      groups: {
        type: Type.ARRAY,
        description: "Distinct nutritional clusters with <=10% macro variance, ordered strictly from healthiest to least favorable.",
        items: {
          type: Type.OBJECT,
          properties: {
            groupName: { type: Type.STRING, description: "Descriptive nutritional cluster name." },
            verdict: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING },
                level: { type: Type.STRING, enum: ["good", "neutral", "warning", "alert"] },
              },
              required: ["label", "level"],
            },
            comparisonSentence: { type: Type.STRING },
            message: { type: Type.STRING },
            servingWeightGrams: { type: Type.NUMBER },
            averageNutrientsPer100g: {
              type: Type.OBJECT,
              properties: {
                calories: { type: Type.NUMBER },
                protein: { type: Type.NUMBER },
                totalFat: { type: Type.NUMBER },
                saturatedFat: { type: Type.NUMBER },
                carbohydrates: { type: Type.NUMBER },
                sugar: { type: Type.NUMBER },
                addedSugar: { type: Type.NUMBER },
                totalFibre: { type: Type.NUMBER },
                sodium: { type: Type.NUMBER },
                transFat: { type: Type.NUMBER },
              },
              required: ["calories", "protein", "totalFat", "saturatedFat", "carbohydrates", "sugar", "totalFibre", "sodium"],
            },
            items: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Items in this <=10% macro cluster.",
            },
          },
          required: ["groupName", "verdict", "comparisonSentence", "message", "servingWeightGrams", "averageNutrientsPer100g", "items"],
        },
      },
    },
    required: ["comparisonTitle", "recommendedOption", "summary", "groups"],
  };

  const startTime = Date.now();
  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: [
      {
        text: `Here is the complete inventory of ${allDishes.length} dishes transcribed from the menu:\n\n` +
          allDishes.map((d, i) => `${i + 1}. ${d}`).join("\n") +
          `\n\nClassify all ${allDishes.length} dishes into distinct <=10% macro variance clusters and rank them based on the patient's nutritional targets. Do not leave any dish out.`,
      },
    ],
    config: {
      systemInstruction,
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: schema,
      maxOutputTokens: 8192,
    },
  });

  const durationMs = Date.now() - startTime;
  const json = JSON.parse(response.text || "{}");
  const groups = json.groups || [];
  const groupedItems = groups.flatMap((g: any) => g.items || []);

  console.log(`⏱️ Duration: ${durationMs}ms`);
  console.log(`📊 Groups Formed: ${groups.length}`);
  console.log(`📦 Total Grouped Dishes: ${groupedItems.length} / ${allDishes.length}`);

  groups.forEach((g: any, idx: number) => {
    console.log(`\nGroup ${idx + 1}: ${g.groupName} (${g.items?.length || 0} items) — [${g.verdict?.level}]`);
    console.log(`  Macros per 100g: ${g.averageNutrientsPer100g?.calories} kcal | P: ${g.averageNutrientsPer100g?.protein}g | F: ${g.averageNutrientsPer100g?.totalFat}g (Sat: ${g.averageNutrientsPer100g?.saturatedFat}g) | C: ${g.averageNutrientsPer100g?.carbohydrates}g | Na: ${g.averageNutrientsPer100g?.sodium}mg`);
    console.log(`  Sample items: ${(g.items || []).slice(0, 4).join("; ")}`);
  });

  fs.writeFileSync(
    path.join(process.cwd(), "prototype", "meallog", "compare", "stage2_test_output.json"),
    JSON.stringify(json, null, 2)
  );
}

testStage2Clustering().catch(console.error);
