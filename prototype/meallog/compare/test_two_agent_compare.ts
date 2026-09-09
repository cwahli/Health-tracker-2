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

// ============================================================================
// AGENT 1: VISION SCOUT (Exhaustive OCR & Section Inventory)
// ============================================================================
const agent1SystemInstruction = `You are a Specialized Vision Scout extracting text and food items from menus, shelf displays, and food packaging.

TASK: EXHAUSTIVE TRANSCRIPTION OF ALL VISIBLE SECTIONS AND ITEMS ACROSS ALL IMAGES.

INVARIANTS:
1. EXHAUSTIVE DISH EXTRACTION (NO SAMPLING):
   - Scan every single column, box, banner, and row across all provided images from top to bottom.
   - Transcribe EVERY single legible dish, drink, or product without skipping, truncating, or summarizing.
   - Large restaurant menus contain 50 to 120+ items; missing items is a critical failure.
2. SECTION STRUCTURING:
   - Organize items by their visible printed section or category header (e.g., 'PAKET SAMBAL BAKAR', 'MENU UTAMA', 'TUMISAN', 'SAYURAN', 'IKAN ASIN', 'NASI', 'MINUMAN').
   - For each section, record the source image index and a normalized 2D bounding box [ymin, xmin, ymax, xmax] (0-1000) encompassing that section.
3. BILINGUAL TRANSLATION:
   - Format non-English food names as 'Local Name / English Translation'.`;

const agent1ResponseSchema = {
  type: Type.OBJECT,
  properties: {
    comparisonTitle: {
      type: Type.STRING,
      description: "Descriptive title of the evaluated menu, shelf, or products.",
    },
    comparisonType: {
      type: Type.STRING,
      enum: ["nutrition_labels", "menu_items", "shelf_selection", "food_items"],
    },
    menuSections: {
      type: Type.ARRAY,
      description: "Exhaustive list of all detected visual sections with every dish printed in each section.",
      items: {
        type: Type.OBJECT,
        properties: {
          sectionTitle: {
            type: Type.STRING,
            description: "Header or category name as printed on the menu.",
          },
          sourceImageIndex: {
            type: Type.INTEGER,
            description: "0-based index of the photo containing this section.",
          },
          boundingBox2D: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
            description: "[ymin, xmin, ymax, xmax] normalized (0 to 1000) coordinates framing this section.",
          },
          items: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Every single item in this section. Format as 'Local Name / English Translation'.",
          },
        },
        required: ["sectionTitle", "sourceImageIndex", "boundingBox2D", "items"],
      },
    },
  },
  required: ["comparisonTitle", "comparisonType", "menuSections"],
};

// ============================================================================
// AGENT 2: CLINICAL DIETITIAN (<=10% Macro Clustering & Target-Driven Ranking)
// ============================================================================
const agent2SystemInstruction = `=== NUTRITIONAL TARGET STATUS ===
3 days avg: Sat fat (27.7g - 38% over), Calorie (2500kcal - 39% over), Sodium (3000mg - 30% over), Protein (100g - 17% under), Carbohydrates (263.3g - 32% over), Total Fibre (22.3g - 26% under), Potassium (2100mg), Soluble Fibre (3.5g), Added Sugar (45g - 50% over), Trans Fat (0.1g)

You are a Clinical Dietitian evaluating competing food options for a patient with High LDL and High HbA1c (Mode D).

TASK: <=10% MACRO VARIANCE CLUSTERING, HAZARD/BENEFIT ISOLATION, AND TARGET-DRIVEN RANKING.

CLINICAL INVARIANTS:
1. EVALUATION ONLY (NON-ADDITIVE):
   - Items are mutually exclusive choices. Never sum totals or prompt to log a consumed meal.

2. <=10% MACRO VARIANCE CLUSTERING (STRICT HOMOGENEITY):
   - Group items together ONLY if estimated macronutrients (calories, fat, saturated fat, protein, carbs per 100g) differ by <=10%.
   - DO NOT create giant catch-all buckets. You MUST partition the menu into clinically distinct culinary clusters:
     * Clear / Water-Poached Soups & Broths (Sayur Asem, clear chicken/beef soup)
     * Boiled Vegetables & Fresh Lalapan (Kangkung Rebus, raw greens)
     * Steamed Whole Plant Proteins (Pepes Tahu, plain tofu)
     * Stir-Fried Greens & Non-Starchy Veggies with Cooking Oil (Tumisan)
     * Plain Carbohydrate Staples (Nasi Putih)
     * Coconut Rice & Fried Carb Dishes (Nasi Uduk, Nasi Bakar, Nasi Goreng)
     * Lean Grilled / Steamed Whole Fish (Pepes Ikan, Ikan Bakar without sweet glaze)
     * Deep-Fried Poultry / Meat Packages (Paket Ayam Goreng, Bebek Goreng, Lele)
     * Highly Salted Cured Proteins (Ikan Asin, Peda, Teri)
     * Organ Meats & Fried Offal (Sate Usus, Sate Kulit, Ati-Ampla)
     * Ultra-Processed Spicy Starches (Seblak varieties)
     * Sweet Confectionery, Porridges & Desserts (Bubur Manis, fruit pickles with syrup)
   - EVERY single item from the input inventory MUST be classified into exactly one cluster. No items may be left out or orphaned.

3. UNLISTED HARMS & BENEFITS ISOLATION:
   - Isolate oxidized deep-frying oils, lipid peroxides, trans fats, and ultra-processed gelatinized starches into Warning or Alert tiers.
   - Elevate whole foods offering cardioprotective marine Omega-3s (EPA/DHA) and antioxidant polyphenols into Good or Neutral tiers.

4. TARGET-DRIVEN RANKING & COMBINED GUIDANCE:
   - Rank groups strictly descending: Best choices addressing the patient's active surpluses and deficits at the top ('good'), highest metabolic risk at the bottom ('alert').
   - For each group, write a 35-70 word clinical explanation addressing the patient's targets, concluding with an actionable ordering tip.
   - Estimate average nutrients per 100g for the 10 allowance keys.`;

const agent2ResponseSchema = {
  type: Type.OBJECT,
  properties: {
    comparisonTitle: { type: Type.STRING },
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
      description: "Distinct nutritional clusters with <=10% macro variance, ordered strictly from healthiest to least favorable.",
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
            description: "35-70 words combining clinical guidance relative to active surpluses/deficits, ending with an actionable ordering tip.",
          },
          boundingBox2D: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
            description: "[ymin, xmin, ymax, xmax] normalized (0 to 1000) coordinates.",
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
            description: "All dishes classified into this <=10% macro cluster.",
          },
        },
        required: ["groupName", "sourceImageIndex", "verdict", "comparisonSentence", "message", "boundingBox2D", "servingWeightGrams", "averageNutrientsPer100g", "items"],
      },
    },
  },
  required: ["comparisonTitle", "comparisonType", "summary", "recommendedOption", "groups"],
};

async function runTwoAgentCompare() {
  console.log("=================================================================");
  console.log("🚀 TESTING 2-AGENT ARCHITECTURE (Vision Scout → Clinical Dietitian)");
  console.log("=================================================================\n");

  const files = [
    "set3_restaurant_menu_page1.jpg",
    "set3_restaurant_menu_page2.jpg",
  ];
  const imageParts = loadImages(files);

  // --------------------------------------------------------------------------
  // STEP 1: AGENT 1 (VISION SCOUT) — Multimodal OCR & Section Inventory
  // --------------------------------------------------------------------------
  console.log("📡 STEP 1: Launching Agent 1 (Vision Scout)...");
  const t1Start = Date.now();
  const agent1Response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: [
      ...imageParts,
      {
        text: "Exhaustively transcribe every single visible menu section, header, and food/beverage item across all pages into 'menuSections'. Do not skip, sample, or summarize any dish.",
      },
    ],
    config: {
      systemInstruction: agent1SystemInstruction,
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: agent1ResponseSchema,
      maxOutputTokens: 8192,
    },
  });
  const t1Duration = Date.now() - t1Start;
  const agent1Json = JSON.parse(agent1Response.text || "{}");

  const sections: any[] = agent1Json.menuSections || [];
  const allDishes: string[] = sections.flatMap((s: any) => s.items || []);

  console.log(`✅ Agent 1 finished in ${t1Duration}ms`);
  console.log(`📋 Sections Detected: ${sections.length}`);
  console.log(`📦 Total Dishes Extracted: ${allDishes.length}`);
  sections.forEach((s, idx) => {
    console.log(`   ${idx + 1}. [${s.sectionTitle}] (${s.items?.length || 0} items)`);
  });

  // --------------------------------------------------------------------------
  // STEP 2: AGENT 2 (CLINICAL DIETITIAN) — Text-only <=10% Macro Clustering
  // --------------------------------------------------------------------------
  console.log(`\n📡 STEP 2: Launching Agent 2 (Clinical Dietitian) on ${allDishes.length} items...`);
  const t2Start = Date.now();

  const inventoryPayload = sections.map((s, idx) => {
    return `### Section ${idx + 1}: ${s.sectionTitle} (Image #${s.sourceImageIndex}, Box: [${(s.boundingBox2D || []).join(", ")}])\n` +
      (s.items || []).map((it: string) => `- ${it}`).join("\n");
  }).join("\n\n");

  const agent2Response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: [
      {
        text: `Here is the exhaustive inventory of ${allDishes.length} dishes transcribed from the restaurant menu across ${sections.length} sections:\n\n` +
          inventoryPayload +
          `\n\nTASK:
1. Classify EVERY single one of these ${allDishes.length} dishes into distinct nutritional clusters where macronutrients differ by <=10%.
2. Do not create giant catch-all tiers. Split into separate groups (clear broths, boiled greens, stir-fried vegetables, plain carbs, coconut rice/fried carbs, grilled fish, fried poultry/meats, salted fish, offal, seblak, desserts).
3. Every dish must be present in exactly one group. Total items across groups must equal ${allDishes.length}.
4. Rank groups from safest/healthiest for the patient's active surpluses/deficits to highest risk.
5. Emphasize ordering tips in every message.`,
      },
    ],
    config: {
      systemInstruction: agent2SystemInstruction,
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: agent2ResponseSchema,
      maxOutputTokens: 8192,
    },
  });
  const t2Duration = Date.now() - t2Start;
  const agent2Json = JSON.parse(agent2Response.text || "{}");

  const groups: any[] = agent2Json.groups || [];
  const groupedDishes: string[] = groups.flatMap((g: any) => g.items || []);

  console.log(`✅ Agent 2 finished in ${t2Duration}ms`);
  console.log(`⏱️ Total Pipeline Latency: ${t1Duration + t2Duration}ms`);
  console.log(`📊 Groups Formed: ${groups.length}`);
  console.log(`📦 Grouped Items: ${groupedDishes.length} / ${allDishes.length}`);
  console.log(`🏆 Recommended: "${agent2Json.recommendedOption}"`);

  console.log("\n==================== CLINICAL CLUSTERS FORMED ====================");
  groups.forEach((g: any, idx: number) => {
    const macros = g.averageNutrientsPer100g || {};
    console.log(`\nGroup ${idx + 1}: ${g.groupName} (${g.items?.length || 0} items) — [${g.verdict?.level?.toUpperCase()}] ${g.verdict?.label}`);
    console.log(`  Macros per 100g: ${macros.calories} kcal | Protein: ${macros.protein}g | Fat: ${macros.totalFat}g (Sat: ${macros.saturatedFat}g) | Carbs: ${macros.carbohydrates}g | Sodium: ${macros.sodium}mg`);
    console.log(`  Message: "${g.message}"`);
    console.log(`  Sample Items: ${(g.items || []).slice(0, 4).join("; ")}`);
    if ((g.items || []).length > 4) {
      console.log(`  ... and ${(g.items || []).length - 4} more items`);
    }
  });

  // Combine data into complete Mode D result
  const finalResult = {
    ...agent2Json,
    menuSections: sections,
    _meta: {
      agent1DurationMs: t1Duration,
      agent2DurationMs: t2Duration,
      totalDurationMs: t1Duration + t2Duration,
      totalDishesExtracted: allDishes.length,
      totalDishesGrouped: groupedDishes.length,
    },
  };

  const outputPath = path.join(process.cwd(), "prototype", "meallog", "compare", "two_agent_test_output.json");
  fs.writeFileSync(outputPath, JSON.stringify(finalResult, null, 2), "utf-8");
  console.log(`\n💾 Full 2-Agent Result saved to: ${outputPath}`);
}

runTwoAgentCompare().catch(console.error);
