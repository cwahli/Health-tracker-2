import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import {
  scoutOnlyCompareSystemInstruction,
  buildScoutComparePrompt,
  scoutOnlyCompareResponseSchema,
} from "./scout_only_compare_instructions.js";

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
    name: "Set 6: Supermarket Chip Aisle Shelf",
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

function deriveServingNutrients(per100g: Record<string, number>, weightGrams: number): Record<string, number> {
  const serving: Record<string, number> = {};
  const factor = (weightGrams || 100) / 100;
  for (const [k, v] of Object.entries(per100g)) {
    if (typeof v === "number") {
      if (k === "sodium" || k === "calories") {
        serving[k] = Math.round(v * factor);
      } else {
        serving[k] = Math.round(v * factor * 10) / 10;
      }
    }
  }
  return serving;
}

async function runSixCasesBenchmark() {
  console.log("==========================================================================================");
  console.log("SCOUT-ONLY COMPARE BENCHMARK: EVALUATING ALL 6 PROTOTYPE CASES");
  console.log("Testing: Streamlined Schema-First Architecture (Groups[].items, <=10% macro variance)");
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

    const promptText = buildScoutComparePrompt(tc.userPrompt, imageParts.length);
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
        maxOutputTokens: 8192,
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

    const groups = json.groups || [];
    const extractedDishes = Array.isArray(json.allExtractedDishes) ? json.allExtractedDishes : [];
    // Extract all items from groups
    const groupItems: string[] = groups.flatMap((g: any) =>
      Array.isArray(g.items) ? g.items.map((it: any) => typeof it === "string" ? it : it.name) : []
    );
    const rootItems = json.items || [];
    const allItems = extractedDishes.length > 0 ? extractedDishes : (groupItems.length > 0 ? groupItems : rootItems);

    // Quality metrics analysis
    const itemsWithTranslations = allItems.filter((name: string) => typeof name === "string" && name.includes("/"));
    const groupsWith100g = groups.filter((g: any) => g.averageNutrientsPer100g && typeof g.averageNutrientsPer100g.calories === "number");

    console.log(`\n⏱️ Duration: ${durationMs}ms`);
    console.log(`📊 Comparison Title: "${json.comparisonTitle}"`);
    console.log(`🏆 Recommended: "${json.recommendedOption}"`);
    console.log(`📦 Total Extracted Dishes in Groups: ${groupItems.length}`);
    console.log(`🌐 Bilingual Translated Items: ${itemsWithTranslations.length}/${allItems.length} (${Math.round((itemsWithTranslations.length / (allItems.length || 1)) * 100)}%)`);
    console.log(`🏷️ Groups Formed (<=10% Macro Variance): ${groups.length}`);
    console.log(`📏 Groups with Normalized 100g Nutrients: ${groupsWith100g.length}/${groups.length}`);

    // Print groups
    console.log(`\nComparison Groups & Normalized Densities:`);
    groups.forEach((g: any, idx: number) => {
      const derived = (g.averageNutrientsPer100g && g.servingWeightGrams) ? deriveServingNutrients(g.averageNutrientsPer100g, g.servingWeightGrams) : null;
      const srv = derived ? `${derived.calories} kcal, ${derived.protein ?? "—"}g P, ${derived.saturatedFat ?? "—"}g SatF, ${derived.sodium ?? "—"}mg Na` : "N/A";
      const n100 = g.averageNutrientsPer100g ? `${g.averageNutrientsPer100g.calories} kcal/100g, ${g.averageNutrientsPer100g.protein ?? "—"}g P, ${g.averageNutrientsPer100g.saturatedFat ?? "—"}g SatF` : "N/A";
      const itemsList = Array.isArray(g.items) ? g.items : [];
      console.log(`  Rank ${idx + 1}: "${g.groupName}" [${g.verdict?.level?.toUpperCase()}] - "${g.verdict?.label}" (${itemsList.length} items, photo #${g.sourceImageIndex ?? 0})`);
      console.log(`     Serving (${g.servingWeightGrams}g): ${srv} | Per 100g: ${n100}`);
      console.log(`     Comparative: "${g.comparisonSentence}"`);
      console.log(`     Message (Combined Guidance & Tip): "${g.message}"`);
      console.log(`     Items (${itemsList.length}): ${itemsList.slice(0, 3).map((it: any) => typeof it === 'string' ? it : it.name).join("; ")}${itemsList.length > 3 ? ` ... and ${itemsList.length - 3} more` : ""}`);
    });

    // Save individual output
    const caseOutPath = path.join(process.cwd(), "prototype", "meallog", "compare", `live_output_set${tc.setNum}.json`);
    fs.writeFileSync(caseOutPath, JSON.stringify(json, null, 2));

    results.push({
      setNum: tc.setNum,
      id: tc.id,
      name: tc.name,
      itemCount: groupItems.length,
      groupCount: groups.length,
      translatedCount: itemsWithTranslations.length,
      groupsWith100g: groupsWith100g.length,
      recommended: json.recommendedOption,
      durationMs,
      data: json,
    });
  }

  // Save full report
  const outPath = path.join(process.cwd(), "prototype", "meallog", "compare", "six_cases_precision_eval.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n💾 Saved detailed 6-case precision evaluation to: ${outPath}`);

  console.log("\n==========================================================================================");
  console.log("6-CASE BENCHMARK PRECISION & QUALITY SUMMARY");
  console.log("==========================================================================================");
  results.forEach(r => {
    console.log(`Set ${r.setNum}: ${r.name}`);
    console.log(`  Items in Groups: ${r.itemCount} | Groups: ${r.groupCount} | Translated: ${r.translatedCount} | 100g Normalized: ${r.groupsWith100g}/${r.groupCount}`);
    console.log(`  Recommended: "${r.recommended}" | Latency: ${r.durationMs}ms`);
  });
  console.log("==========================================================================================\n");
}

runSixCasesBenchmark().catch(console.error);
