import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import {
  scoutOnlyCompareSystemInstruction,
  buildScoutComparePrompt,
  scoutOnlyCompareResponseSchema,
} from "./scout_only_compare_instructions.ts";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("ERROR: GEMINI_API_KEY is not set.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const imagesDir = path.join(process.cwd(), "prototype", "meallog", "compare", "images");

interface TestCase {
  id: string;
  setNum: number;
  name: string;
  kind: string;
  files: string[];
  userPrompt: string;
}

const sixTestCases: TestCase[] = [
  {
    id: "set1",
    setNum: 1,
    name: "Set 1: Bakery Shelf & SilverQueen Chocolate",
    kind: "shelf_selection",
    files: [
      "set1_saybread_bakery_shelf.jpg",
      "set1_silverqueen_nutrition_label.jpg",
      "set1_silverqueen_chocolate_front.jpg",
    ],
    userPrompt: "",
  },
  {
    id: "set2",
    setNum: 2,
    name: "Set 2: 4 Reference Snack & Pack Nutrition Labels",
    kind: "nutrition_labels",
    files: [
      "set2_snack_green_bar_label.jpg",
      "set2_snack_pack_front.jpg",
      "set2_snack_yellow_cake_label.jpg",
      "set2_snack_blue_bread_label.jpg",
    ],
    userPrompt: "",
  },
  {
    id: "set3",
    setNum: 3,
    name: "Set 3: Restaurant Menu Pages (Sambal Bakar Pencok)",
    kind: "menu_items",
    files: [
      "set3_restaurant_menu_page1.jpg",
      "set3_restaurant_menu_page2.jpg",
    ],
    userPrompt: "",
  },
  {
    id: "set4",
    setNum: 4,
    name: "Set 4: Juice & Beverage List",
    kind: "menu_items",
    files: [
      "set4_juice_and_beverage_list.jpg",
    ],
    userPrompt: "",
  },
  {
    id: "set5",
    setNum: 5,
    name: "Set 5: Indonesian Street Food & Seafood Menu Banner",
    kind: "menu_items",
    files: [
      "set5_restaurant_banner_menu.jpg",
    ],
    userPrompt: "",
  },
  {
    id: "set6",
    setNum: 6,
    name: "Set 6: Supermarket Chip Aisle Shelf (50+ Items)",
    kind: "shelf_selection",
    files: [
      "set6_supermarket_chip_aisle_shelf.jpg",
    ],
    userPrompt: "",
  },
];

function loadImages(files: string[]) {
  return files.map(f => {
    const fullPath = path.join(imagesDir, f);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Image not found: ${fullPath}`);
    }
    const buf = fs.readFileSync(fullPath);
    return {
      inlineData: {
        mimeType: "image/jpeg",
        data: buf.toString("base64"),
      },
    };
  });
}

async function runSixCasesBenchmark() {
  console.log("==========================================================================================");
  console.log("SCOUT-ONLY COMPARE BENCHMARK: EVALUATING ALL 6 PROTOTYPE CASES");
  console.log("Testing: Bilingual Names, Normalized 100g Metrics, Sub-Item Sorting & Estimated Nutrients");
  console.log("Model: gemini-3.5-flash-lite");
  console.log("==========================================================================================\n");

  const results: any[] = [];

  for (const tc of sixTestCases) {
    console.log(`\n------------------------------------------------------------------------------------------`);
    console.log(`[Case ${tc.setNum}/6] ${tc.name}`);
    console.log(`Kind: ${tc.kind} | Files (${tc.files.length}): ${tc.files.join(", ")}`);
    console.log(`------------------------------------------------------------------------------------------`);

    const startTime = Date.now();
    const imageParts = loadImages(tc.files);

    const mockPatientContext = {
      remainingAllowance: {
        saturatedFat: "27.7g - 38% over",
        calories: "2500kcal - 39% over",
        sodium: "3000mg - 30% over",
        protein: "100g - 17% under",
        carbohydrates: "263.3g - 32% over",
        totalFibre: "22.3g - 26% under",
        potassium: "2100mg",
        solubleFibre: "3.5g",
        addedSugar: "45g - 50% over",
        transFat: "0.1g"
      }
    };

    const promptText = buildScoutComparePrompt(tc.userPrompt, imageParts.length, mockPatientContext);
    const contents = [...imageParts, { text: promptText }];

    console.log(`Sending to Gemini 3.5 Flash Lite...`);
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents,
      config: {
        systemInstruction: scoutOnlyCompareSystemInstruction,
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: scoutOnlyCompareResponseSchema,
      },
    });

    const durationMs = Date.now() - startTime;
    let json: any = {};
    try {
      json = JSON.parse(response.text || "{}");
    } catch (e) {
      console.error("Failed to parse JSON response:", response.text);
      continue;
    }

    const items = json.items || [];
    const groups = json.groups || [];

    // Quality metrics analysis
    const itemsWithTranslations = items.filter((it: any) => typeof it.name === "string" && it.name.includes("/"));
    const itemsWith100g = items.filter((it: any) => it.per100g && typeof it.per100g.calories === "number");
    const groupsWith100g = groups.filter((g: any) => g.averageNutrientsPer100g && typeof g.averageNutrientsPer100g.calories === "number");
    const groupsWithNutrients = groups.filter((g: any) => g.averageNutrients && typeof g.averageNutrients.calories === "number");

    // Check sub-item sorting in scoutItemIndices
    let subItemsSortedCount = 0;
    groups.forEach((g: any) => {
      const indices = g.scoutItemIndices || [];
      if (indices.length <= 1) {
        subItemsSortedCount++;
      } else {
        let sorted = true;
        for (let i = 0; i < indices.length - 1; i++) {
          const tA = items[indices[i]]?.tier ?? 2;
          const tB = items[indices[i + 1]]?.tier ?? 2;
          if (tA > tB) { sorted = false; break; }
        }
        if (sorted) subItemsSortedCount++;
      }
    });

    console.log(`\n⏱️ Duration: ${durationMs}ms`);
    console.log(`📊 Comparison Title: "${json.comparisonTitle}"`);
    console.log(`🏆 Recommended: "${json.recommendedOption}"`);
    console.log(`📦 Extracted Items: ${items.length}`);
    console.log(`🌐 Bilingual Translated Items: ${itemsWithTranslations.length}/${items.length} (${Math.round((itemsWithTranslations.length / (items.length || 1)) * 100)}%)`);
    console.log(`⚖️ Items with per100g: ${itemsWith100g.length}/${items.length}`);
    console.log(`🏷️ Groups Formed: ${groups.length}`);
    console.log(`🥗 Groups with Non-Null Serving Nutrients: ${groupsWithNutrients.length}/${groups.length}`);
    console.log(`📏 Groups with Normalized 100g Nutrients: ${groupsWith100g.length}/${groups.length}`);
    console.log(`🔢 Groups with Sorted Sub-Items: ${subItemsSortedCount}/${groups.length}`);

    // Print sample items
    console.log(`\nSample Extracted Dishes/Products:`);
    items.slice(0, 5).forEach((it: any, idx: number) => {
      console.log(`  ${idx + 1}. [Tier ${it.tier}] "${it.name}"`);
    });
    if (items.length > 5) {
      console.log(`  ... and ${items.length - 5} more items`);
    }

    // Print groups
    console.log(`\nComparison Groups & Normalized Densities:`);
    groups.forEach((g: any, idx: number) => {
      const srv = g.averageNutrients ? `${g.averageNutrients.calories} kcal, ${g.averageNutrients.sugar ?? "—"}g sugar, ${g.averageNutrients.sodium ?? "—"}mg Na` : "N/A";
      const n100 = g.averageNutrientsPer100g ? `${g.averageNutrientsPer100g.calories} kcal/100g, ${g.averageNutrientsPer100g.sugar ?? "—"}g sugar/100g, ${g.averageNutrientsPer100g.totalFat ?? "—"}g fat/100g` : "N/A";
      console.log(`  Rank ${idx + 1}: "${g.groupName}" [${g.verdict?.level?.toUpperCase()}] - "${g.verdict?.label}" (${g.scoutItemIndices?.length || 0} items)`);
      console.log(`     Serving: ${srv} | Normalized: ${n100}`);
      console.log(`     Comparative: "${g.comparisonSentence}"`);
    });

    results.push({
      setNum: tc.setNum,
      id: tc.id,
      name: tc.name,
      itemCount: items.length,
      groupCount: groups.length,
      translatedCount: itemsWithTranslations.length,
      groupsWithNutrients: groupsWithNutrients.length,
      groupsWith100g: groupsWith100g.length,
      recommended: json.recommendedOption,
      durationMs,
      data: json,
    });
  }

  // Save report
  const outPath = path.join(process.cwd(), "prototype", "meallog", "compare", "six_cases_precision_eval.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n💾 Saved detailed 6-case precision evaluation to: ${outPath}`);

  console.log("\n==========================================================================================");
  console.log("6-CASE BENCHMARK PRECISION & QUALITY SUMMARY");
  console.log("==========================================================================================");
  results.forEach(r => {
    console.log(`Set ${r.setNum}: ${r.name}`);
    console.log(`  Items: ${r.itemCount} | Groups: ${r.groupCount} | Translated: ${r.translatedCount} | Non-Null Nutrients: ${r.groupsWithNutrients}/${r.groupCount} | 100g Normalized: ${r.groupsWith100g}/${r.groupCount}`);
    console.log(`  Recommended: "${r.recommended}" | Latency: ${r.durationMs}ms`);
  });
  console.log("==========================================================================================\n");
}

runSixCasesBenchmark().catch(console.error);
