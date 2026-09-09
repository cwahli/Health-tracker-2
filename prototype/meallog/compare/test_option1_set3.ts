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

// Option 1: Section-Anchored Structured Inventory
// 1. System Instruction emphasizes scanning every section header and transcribing all items under each section.
const option1SystemInstruction = `=== NUTRITIONAL TARGET STATUS ===
3 days avg: Sat fat (27.7g - 38% over), Calorie (2500kcal - 39% over), Sodium (3000mg - 30% over), Protein (100g - 17% under), Carbohydrates (263.3g - 32% over), Total Fibre (22.3g - 26% under), Potassium (2100mg), Soluble Fibre (3.5g), Added Sugar (45g - 50% over), Trans Fat (0.1g)

You are a Clinical Dietitian & Vision Scout evaluating competing food options (Mode D).

TASK: EXHAUSTIVE DISH OCR VIA SECTION INVENTORY, <=10% MACRO CLUSTERING, UNLISTED HAZARD/BENEFIT ISOLATION, AND TARGET-DRIVEN RANKING.

CLINICAL INVARIANTS:
1. EVALUATION ONLY (NON-ADDITIVE):
   - Items are mutually exclusive candidate choices. Never sum meal totals or log as a consumed plate. Do not calculate composite meal totals or prompt for portion confirmations.

2. SECTION-ANCHORED EXHAUSTIVE EXTRACTION (NO OMISSIONS):
   - Identify every distinct visual section, header, and column across ALL provided images (e.g. Paket Sambal, Olahan Ayam/Bebek, Ikan/Seafood, Sayuran/Tumisan, Gorengan/Sides, Sambal, Minuman Dingin, Minuman Panas, Cemilan/Dessert).
   - In 'menuSections', transcribe EVERY single item listed in each section without summarizing, sampling, or skipping any item.
   - In 'groups', classify EVERY single inventoried item into one of the clinical macro groups. Dense menus have 50-120+ total items. Missing items is a clinical failure.

3. <=10% MACRO VARIANCE CLUSTERING:
   - Group items together ONLY if estimated macronutrients differ by <=10%.
   - Split broad categories into separate groups if preparation methods cause >10% macro variance (e.g., water-poached broths vs open-flame grilled vs batter-fried vs carb staples vs sugary beverages vs unsweetened drinks).

4. UNLISTED HARMS & BENEFITS ISOLATION:
   - Beyond raw macros, actively evaluate physiological hazards and cardioprotective benefits:
     * UNLISTED HARMS: Isolate oxidized deep-frying oils, lipid peroxides, trans fats, sugary syrups, and ultra-processed gelatinized starches (e.g., Seblak) into Tier 3 (Warning) or Tier 4 (Alert).
     * BENEFITS: Elevate whole foods offering cardioprotective marine Omega-3s (EPA/DHA in whole sea fish) and antioxidant polyphenols (sour fruit broths) into Tier 1 (Good) or Tier 2 (Neutral).

5. TARGET-DRIVEN CLINICAL RANKING & COMBINED GUIDANCE:
   - Rank groups strictly descending: Best choice addressing the patient's active surpluses and deficits at the top ('good'), least suitable at the bottom ('alert').
   - Tailor all verdicts, comparative sentences, and clinical messages directly to the patient's target deviations.
   - Combine clinical guidance and an actionable ordering tip into a single cohesive message.`;

const option1ResponseSchema = {
  type: Type.OBJECT,
  properties: {
    menuSections: {
      type: Type.ARRAY,
      description: "Exhaustive inventory of every visual section/header detected across all menu pages, listing every item printed in that section.",
      items: {
        type: Type.OBJECT,
        properties: {
          sectionTitle: {
            type: Type.STRING,
            description: "Header or category name as printed on the menu (e.g., 'PAKET SAMBAL BAKAR', 'ANEKA SAYURAN', 'MINUMAN').",
          },
          items: {
            type: Type.ARRAY,
            description: "Every single dish/beverage item printed in this section. Format as 'Local Name / English Translation'.",
            items: { type: Type.STRING },
          },
        },
        required: ["sectionTitle", "items"],
      },
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
      description: "High-level clinical summary synthesizing the landscape of choices against the patient's specific metabolic surpluses and deficits.",
    },
    recommendedOption: {
      type: Type.STRING,
      description: "Top recommended dish or product formatted as 'Local Name / English Translation'.",
    },
    groups: {
      type: Type.ARRAY,
      description: "Distinct nutritional clusters with <=10% macro variance, ordered strictly from healthiest/safest to least favorable. CRITICAL: Every single item from menuSections MUST be classified into exactly one group. The total count of items across all groups MUST equal the total count in menuSections (no sampling or exemplars).",
      items: {
        type: Type.OBJECT,
        properties: {
          groupName: {
            type: Type.STRING,
            description: "Tier and descriptive cluster name (e.g., 'Tier 1 - Safest Choice: Tangy Poached Broths (Garang Asem)').",
          },
          sourceImageIndex: {
            type: Type.INTEGER,
            description: "0-based index of the photo containing this group's primary visual region (default 0).",
          },
          verdict: {
            type: Type.OBJECT,
            properties: {
              label: {
                type: Type.STRING,
                description: "3-6 word concise clinical verdict label.",
              },
              level: {
                type: Type.STRING,
                enum: ["good", "neutral", "warning", "alert"],
                description: "Clinical safety level: 'good' (Tier 1), 'neutral' (Tier 2), 'warning' (Tier 3), 'alert' (Tier 4).",
              },
            },
            required: ["label", "level"],
          },
          comparisonSentence: {
            type: Type.STRING,
            description: "Exactly ONE comparative sentence contrasting how this group moves the user's specific targets compared to alternatives.",
          },
          message: {
            type: Type.STRING,
            description: "35-70 words combining clinical guidance on why this group ranks here relative to the user's active surpluses/deficits, concluding with an actionable ordering tip.",
          },
          boundingBox2D: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
            description: "[ymin, xmin, ymax, xmax] normalized (0 to 1000) framing this group's visual region on the photo.",
          },
          servingWeightGrams: {
            type: Type.NUMBER,
            description: "Typical single-serving weight in grams.",
          },
          averageNutrientsPer100g: {
            type: Type.OBJECT,
            description: "Estimated nutrients per 100g reference across the 10 patient allowance keys.",
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
            description: "All items belonging to this nutritional group. Format non-English names as 'Local Name / English Translation'.",
            items: { type: Type.STRING },
          },
        },
        required: ["groupName", "sourceImageIndex", "verdict", "comparisonSentence", "message", "boundingBox2D", "servingWeightGrams", "averageNutrientsPer100g", "items"],
      },
    },
  },
  required: ["menuSections", "comparisonTitle", "comparisonType", "summary", "recommendedOption", "groups"],
};

async function testOption1() {
  console.log("=== Testing Option 1: Section-Anchored Structured Inventory on Set 3 ===");
  const files = [
    "set3_restaurant_menu_page1.jpg",
    "set3_restaurant_menu_page2.jpg",
  ];
  const startTime = Date.now();
  const imageParts = loadImages(files);
  const promptText = `Exhaustively transcribe all menu sections and every dish/drink across both pages into 'menuSections' (dense menus have 80-110+ items). Then, distribute EVERY single one of those items into the clinical 'groups' based on <=10% macro variance and patient target deviations. Do NOT sample or provide exemplars in groups; every dish in menuSections must appear in its matching group so the total item count across all groups equals the inventory count.`;

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: [...imageParts, { text: promptText }],
    config: {
      systemInstruction: option1SystemInstruction,
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: option1ResponseSchema,
      maxOutputTokens: 8192,
    },
  });

  const durationMs = Date.now() - startTime;
  const json = JSON.parse(response.text || "{}");

  const sections = json.menuSections || [];
  const totalSectionItems = sections.reduce((acc: number, s: any) => acc + (s.items?.length || 0), 0);

  const groups = json.groups || [];
  const groupItems: string[] = groups.flatMap((g: any) =>
    Array.isArray(g.items) ? g.items.map((it: any) => typeof it === "string" ? it : it.name) : []
  );

  console.log(`⏱️ Duration: ${durationMs}ms`);
  console.log(`📊 Comparison Title: "${json.comparisonTitle}"`);
  console.log(`🏆 Recommended: "${json.recommendedOption}"`);
  console.log(`\n📋 Section Inventory: ${sections.length} sections found, ${totalSectionItems} total items:`);
  sections.forEach((s: any, idx: number) => {
    console.log(`  ${idx + 1}. [${s.sectionTitle}]: ${s.items?.length || 0} items`);
  });

  console.log(`\n📦 Clinical Groups Formed: ${groups.length} groups, ${groupItems.length} total dishes grouped:`);
  groups.forEach((g: any, idx: number) => {
    console.log(`\nGroup ${idx + 1}: ${g.groupName} (${(g.items || []).length} items)`);
    console.log(`  Verdict: [${g.verdict?.level}] ${g.verdict?.label}`);
    console.log(`  Combined Message: "${g.message}"`);
    console.log(`  Sample Items: ${(g.items || []).slice(0, 5).join("; ")}`);
    if ((g.items || []).length > 5) {
      console.log(`  ... and ${(g.items || []).length - 5} more items`);
    }
  });

  // Save the full test output for inspection
  fs.writeFileSync(
    path.join(process.cwd(), "prototype", "meallog", "compare", "option1_test_output.json"),
    JSON.stringify(json, null, 2)
  );
  console.log(`\n💾 Saved detailed output to prototype/meallog/compare/option1_test_output.json`);
}

testOption1().catch(console.error);
