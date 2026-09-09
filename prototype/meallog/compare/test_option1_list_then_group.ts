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

const systemInstruction = `=== NUTRITIONAL TARGET STATUS ===
3 days avg: Sat fat (27.7g - 38% over), Calorie (2500kcal - 39% over), Sodium (3000mg - 30% over), Protein (100g - 17% under), Carbohydrates (263.3g - 32% over), Total Fibre (22.3g - 26% under), Potassium (2100mg), Soluble Fibre (3.5g), Added Sugar (45g - 50% over), Trans Fat (0.1g)

You are a Clinical Dietitian & Vision Scout evaluating competing food options (Mode D).

TASK:
STEP 1: FIRST, EXHAUSTIVELY LIST EVERY LEGIBLE DISH/DRINK ACROSS ALL IMAGES INTO 'allExtractedDishes'.
STEP 2: THEN, GROUP EVERY EXTRACTED DISH INTO GRANULAR NUTRITIONAL CLUSTERS WITH <=10% MACRO VARIANCE.

CLINICAL INVARIANTS:
1. EXHAUSTIVE EXTRACTION FIRST (NO OMISSIONS):
   - In 'allExtractedDishes', scan every column, section, and page top-to-bottom across ALL images.
   - List EVERY single legible dish/beverage without stopping, sampling, or truncating (dense menus have 80-110+ dishes). Format as 'Local Name / English Translation'.

2. <=10% MACRO VARIANCE CLUSTERING (STRICT HOMOGENEITY):
   - Group items together ONLY if estimated macronutrients (calories, fat, saturated fat, protein, carbs per 100g) differ by <=10%.
   - CRITICAL ANTI-COLLAPSE RULE: Do NOT dump dozens of items into a giant catch-all warning group. You MUST separate culinary categories:
     * Clear / Water-Poached Soups & Broths (Sayur Asem, Sop Ayam)
     * Boiled Vegetables & Fresh Lalapan (Kangkung Rebus)
     * Steamed Whole Plant Proteins (Pepes Tahu, raw/boiled bitter beans)
     * Stir-Fried Non-Starchy Greens with Oil (Tumis Kangkung, Tumis Caisim)
     * Plain Carbohydrate Staples (Nasi Putih)
     * Coconut Rice & Fried Carb Dishes (Nasi Uduk, Nasi Bakar, Nasi Goreng)
     * Lean Grilled / Steamed Whole Fish (Pepes Ikan, Ikan Bakar)
     * Deep-Fried Poultry / Meat Packages (Paket Ayam Goreng, Bebek Goreng, Lele)
     * Highly Salted Cured Proteins (Ikan Asin, Peda, Teri)
     * Spicy Sambal & Pencok Relishes (Pencok Kacang, Jengkol Balado/Goreng, Terong Balado, Kol Goreng)
     * Organ Meats & Fried Offal (Sate Usus, Sate Kulit, Ati-Ampla)
     * Ultra-Processed Spicy Starches (Seblak varieties, Kerupuk)
     * Sweet Confectionery & Porridges (Bubur Manis, fruit pickles with sweet syrup)
   - Every single dish from 'allExtractedDishes' MUST appear in exactly one group. Total items across groups must equal the count in 'allExtractedDishes' (no missing dishes).

3. UNLISTED HARMS & BENEFITS ISOLATION:
   - Isolate oxidized deep-frying oils, trans fats, and ultra-processed starches into Warning or Alert tiers.
   - Elevate whole cardioprotective foods (marine Omega-3s, soluble fiber) into Good or Neutral tiers.

4. TARGET-DRIVEN RANKING & COMBINED GUIDANCE:
   - Rank groups strictly descending from safest choice addressing active surpluses/deficits to highest metabolic risk.
   - For each group, write 35-70 words of clinical guidance concluding with an actionable ordering tip.
   - Estimate average nutrients per 100g for the 10 allowance keys.`;

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    allExtractedDishes: {
      type: Type.ARRAY,
      description: "FIRST: Exhaustive list of ALL legible dishes and drinks across all columns, rows, and pages. Format as 'Local Name / English Translation'. Must contain every single item before grouping.",
      items: { type: Type.STRING },
    },
    comparisonTitle: {
      type: Type.STRING,
      description: "Descriptive title of the evaluated menu, shelf, or products.",
    },
    comparisonType: {
      type: Type.STRING,
      enum: ["nutrition_labels", "menu_items", "shelf_selection", "food_items"],
    },
    summary: {
      type: Type.STRING,
      description: "High-level clinical summary synthesizing the choices against the patient's metabolic surpluses and deficits.",
    },
    recommendedOption: {
      type: Type.STRING,
      description: "Top recommended dish formatted as 'Local Name / English Translation'.",
    },
    groups: {
      type: Type.ARRAY,
      description: "THEN: Granular nutritional clusters with <=10% macro variance. Every dish from allExtractedDishes must be assigned to exactly one group. Do not create giant catch-all buckets.",
      items: {
        type: Type.OBJECT,
        properties: {
          groupName: {
            type: Type.STRING,
            description: "Tier and descriptive cluster name (e.g., 'Tier 1 - Safest Choice: Clear Vegetable Soups & Broths').",
          },
          sourceImageIndex: { type: Type.INTEGER },
          verdict: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              level: { type: Type.STRING, enum: ["good", "neutral", "warning", "alert"] },
            },
            required: ["label", "level"],
          },
          comparisonSentence: {
            type: Type.STRING,
            description: "Exactly ONE comparative sentence contrasting how this group moves targets compared to alternatives.",
          },
          message: {
            type: Type.STRING,
            description: "35-70 words combining clinical guidance relative to active surpluses/deficits, concluding with an actionable ordering tip.",
          },
          boundingBox2D: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
            description: "[ymin, xmin, ymax, xmax] normalized (0 to 1000) framing this cluster's visual region.",
          },
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
            description: "All dishes classified into this <=10% macro cluster. Must be dishes listed in allExtractedDishes.",
          },
        },
        required: ["groupName", "sourceImageIndex", "verdict", "comparisonSentence", "message", "boundingBox2D", "servingWeightGrams", "averageNutrientsPer100g", "items"],
      },
    },
  },
  required: ["allExtractedDishes", "comparisonTitle", "comparisonType", "summary", "recommendedOption", "groups"],
};

async function testListThenGroup() {
  console.log("=== Testing Single-Agent Option 1: List All Dishes First, Then Group ===");
  const files = [
    "set3_restaurant_menu_page1.jpg",
    "set3_restaurant_menu_page2.jpg",
  ];
  const startTime = Date.now();
  const imageParts = loadImages(files);
  const promptText = `FIRST: Read both menu pages completely and list EVERY single legible dish/drink into 'allExtractedDishes' without skipping or summarizing (expect 80-110 items).
THEN: Classify all of those dishes into granular nutritional groups with <=10% macro variance (including spicy sambal/pencok dishes, clear soups, boiled vegetables, plain carbs, coconut carbs, fried sets, salted fish, offal, seblak, sweets). Every single dish from 'allExtractedDishes' MUST be placed into a group so that zero dishes are left out.`;

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: [...imageParts, { text: promptText }],
    config: {
      systemInstruction,
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema,
      maxOutputTokens: 8192,
    },
  });

  const durationMs = Date.now() - startTime;
  const json = JSON.parse(response.text || "{}");

  const allDishes = json.allExtractedDishes || [];
  const groups = json.groups || [];
  const groupedItems = groups.flatMap((g: any) => g.items || []);

  console.log(`⏱️ Duration: ${durationMs}ms`);
  console.log(`📦 allExtractedDishes Count: ${allDishes.length}`);
  console.log(`📊 Groups Formed: ${groups.length}`);
  console.log(`🏷️ Grouped Items Count: ${groupedItems.length} / ${allDishes.length}`);
  console.log(`🏆 Recommended: "${json.recommendedOption}"`);

  console.log("\n==================== CLINICAL CLUSTERS FORMED ====================");
  groups.forEach((g: any, idx: number) => {
    const macros = g.averageNutrientsPer100g || {};
    console.log(`\nGroup ${idx + 1}: ${g.groupName} (${g.items?.length || 0} items) — [${g.verdict?.level?.toUpperCase()}] ${g.verdict?.label}`);
    console.log(`  Macros per 100g: ${macros.calories} kcal | Protein: ${macros.protein}g | Fat: ${macros.totalFat}g (Sat: ${macros.saturatedFat}g) | Carbs: ${macros.carbohydrates}g | Sodium: ${macros.sodium}mg`);
    console.log(`  Sample Items: ${(g.items || []).slice(0, 4).join("; ")}`);
    if ((g.items || []).length > 4) {
      console.log(`  ... and ${(g.items || []).length - 4} more items`);
    }
  });

  const outputPath = path.join(process.cwd(), "prototype", "meallog", "compare", "list_then_group_output.json");
  fs.writeFileSync(outputPath, JSON.stringify(json, null, 2), "utf-8");
  console.log(`\n💾 Saved detailed output to: ${outputPath}`);
}

testListThenGroup().catch(console.error);
