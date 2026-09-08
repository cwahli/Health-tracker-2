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

interface CompareTestCase {
  id: string;
  name: string;
  kind: string;
  imagePaths: string[];
  userPrompt: string;
  expectedChecks?: (result: any) => { passed: boolean; details: string[] };
}

const testCases: CompareTestCase[] = [
  {
    id: "compare_set1",
    name: "Compare Set 1: User Job Bakery Shelf & SilverQueen Chocolate",
    kind: "mixed_selection",
    imagePaths: [
      path.join(process.cwd(), "prototype", "meallog", "compare", "images", "set1_saybread_bakery_shelf.jpg"),
      path.join(process.cwd(), "prototype", "meallog", "compare", "images", "set1_silverqueen_nutrition_label.jpg"),
      path.join(process.cwd(), "prototype", "meallog", "compare", "images", "set1_silverqueen_chocolate_front.jpg"),
    ],
    userPrompt: "Compare these items and advise on healthier choices.",
  },
  {
    id: "compare_set2",
    name: "Compare Set 2: 4 Reference Snack & Pack Nutrition Labels",
    kind: "nutrition_labels",
    imagePaths: [
      path.join(process.cwd(), "prototype", "meallog", "compare", "images", "set2_snack_green_bar_label.jpg"),
      path.join(process.cwd(), "prototype", "meallog", "compare", "images", "set2_snack_pack_front.jpg"),
      path.join(process.cwd(), "prototype", "meallog", "compare", "images", "set2_snack_yellow_cake_label.jpg"),
      path.join(process.cwd(), "prototype", "meallog", "compare", "images", "set2_snack_blue_bread_label.jpg"),
    ],
    userPrompt: "Compare these 4 snacks and help me choose the healthiest one.",
    expectedChecks: (result: any) => {
      const details: string[] = [];
      let passed = true;

      const items = result.items || [];
      const groups = result.groups || [];
      details.push(`Extracted ${items.length} items (expected 4).`);
      if (items.length < 3) passed = false;

      details.push(`Created ${groups.length} comparison groups.`);
      if (groups.length === 0) {
        details.push("FAIL: No comparison groups created!");
        return { passed: false, details };
      }

      const allAssignedIndices = new Set<number>();
      groups.forEach((g: any, gIdx: number) => {
        (g.scoutItemIndices || []).forEach((idx: number) => allAssignedIndices.add(idx));
        details.push(`Group ${gIdx + 1} ("${g.groupName}"): ${g.scoutItemIndices?.length || 0} item(s), Verdict: [${g.verdict?.level?.toUpperCase()}] "${g.verdict?.label}"`);
        if (!g.verdict?.level || !g.verdict?.label) {
          details.push(`FAIL: Group ${gIdx + 1} missing verdict!`);
          passed = false;
        }
      });
      details.push(`Diet Grouping: ${allAssignedIndices.size}/${items.length} items mapped to groups.`);

      const levelRank: Record<string, number> = { good: 1, neutral: 2, warning: 3, alert: 4 };
      let previousRank = 0;
      let orderOk = true;
      groups.forEach((g: any) => {
        const lvl = (g.verdict?.level || "neutral").toLowerCase();
        const r = levelRank[lvl] || 2;
        if (r < previousRank) orderOk = false;
        previousRank = r;
      });
      if (!orderOk) {
        details.push("WARN: Groups not strictly sorted by healthiness (best choice first).");
      } else {
        details.push("PASS: Diet Ordering verified: Groups sorted best-choice first down to alert/caution.");
      }

      return { passed, details };
    },
  },
  {
    id: "compare_set3",
    name: "Compare Set 3: Restaurant Menu Pages (Sambal Bakar Pencok)",
    kind: "menu_items",
    imagePaths: [
      path.join(process.cwd(), "prototype", "meallog", "compare", "images", "set3_restaurant_menu_page1.jpg"),
      path.join(process.cwd(), "prototype", "meallog", "compare", "images", "set3_restaurant_menu_page2.jpg"),
    ],
    userPrompt: "What are the healthier options on this menu?",
  },
  {
    id: "compare_set4",
    name: "Compare Set 4: Juice List",
    kind: "menu_items",
    imagePaths: [
      path.join(process.cwd(), "prototype", "meallog", "compare", "images", "set4_juice_and_beverage_list.jpg"),
    ],
    userPrompt: "Compare the juices on this list and recommend the best option.",
  },
  {
    id: "compare_set5",
    name: "Compare Set 5: Product Item",
    kind: "food_items",
    imagePaths: [
      path.join(process.cwd(), "prototype", "meallog", "compare", "images", "set5_packaged_product_photo.jpg"),
    ],
    userPrompt: "Evaluate and analyze this product.",
  },
  {
    id: "G5_snack_labels",
    name: "G5: Compare 5 Printed Snack Nutrition Labels & Pack Fronts",
    kind: "nutrition_labels",
    imagePaths: [
      path.join(process.cwd(), "tests", "Golden_meal", "5. Compare nutrition labels", "PXL_20260716_202623948.jpg"), // 0: Green bar
      path.join(process.cwd(), "tests", "Golden_meal", "5. Compare nutrition labels", "PXL_20260716_203120402.jpg"), // 1: Keripik Pisang Kepok (front only)
      path.join(process.cwd(), "tests", "Golden_meal", "5. Compare nutrition labels", "PXL_20260716_203925382.jpg"), // 2: Green bread
      path.join(process.cwd(), "tests", "Golden_meal", "5. Compare nutrition labels", "PXL_20260716_203945117.jpg"), // 3: Yellow cake
      path.join(process.cwd(), "tests", "Golden_meal", "5. Compare nutrition labels", "PXL_20260716_204340336.jpg"), // 4: Blue bread
    ],
    userPrompt: "Compare these snacks and help me choose the healthiest one.",
    expectedChecks: (result: any) => {
      const details: string[] = [];
      let passed = true;

      const items = result.items || [];
      const groups = result.groups || [];
      details.push(`Extracted ${items.length} items (expected 5).`);
      if (items.length < 4) passed = false;

      details.push(`Created ${groups.length} comparison groups.`);
      if (groups.length === 0) {
        details.push("FAIL: No comparison groups created!");
        return { passed: false, details };
      }

      // Check Grouping: Every item is mapped in scoutItemIndices
      const allAssignedIndices = new Set<number>();
      groups.forEach((g: any, gIdx: number) => {
        (g.scoutItemIndices || []).forEach((idx: number) => allAssignedIndices.add(idx));
        details.push(`Group ${gIdx + 1} ("${g.groupName}"): ${g.scoutItemIndices?.length || 0} item(s), Verdict: [${g.verdict?.level?.toUpperCase()}] "${g.verdict?.label}"`);
        if (!g.verdict?.level || !g.verdict?.label) {
          details.push(`FAIL: Group ${gIdx + 1} missing verdict!`);
          passed = false;
        }
        if (!g.comparisonSentence || g.comparisonSentence.length < 15) {
          details.push(`FAIL: Group ${gIdx + 1} missing comparative sentence!`);
          passed = false;
        } else {
          details.push(`  + Compare Sentence: "${g.comparisonSentence}"`);
        }
        if (!g.message || g.message.length < 20) {
          details.push(`WARN: Group ${gIdx + 1} clinical message is too short or missing.`);
        }
      });
      details.push(`Diet Grouping: ${allAssignedIndices.size}/${items.length} items mapped to groups.`);

      // Check Ordering: Best choice first (good/neutral before warning/alert)
      const levelRank: Record<string, number> = { good: 1, neutral: 2, warning: 3, alert: 4 };
      let previousRank = 0;
      let orderOk = true;
      groups.forEach((g: any) => {
        const lvl = (g.verdict?.level || "neutral").toLowerCase();
        const r = levelRank[lvl] || 2;
        if (r < previousRank) {
          orderOk = false;
        }
        previousRank = r;
      });
      if (!orderOk) {
        details.push("WARN: Groups not strictly sorted by healthiness (best choice first).");
      } else {
        details.push("PASS: Diet Ordering verified: Groups sorted best-choice first down to alert/caution.");
      }

      // Check Keripik Pisang Kepok has no fabricated label
      const banana = items.find((o: any) => /pisang|banana|keripik/i.test(o.name));
      if (banana) {
        details.push(`Found banana chips: "${banana.name}", hasNutritionLabel: ${banana.hasNutritionLabel}`);
        if (banana.hasNutritionLabel === true && banana.perServing?.calories > 0) {
          details.push("WARN: Front-only banana chips has fabricated label calories");
        }
      } else {
        details.push("Keripik Pisang Kepok not explicitly separated.");
      }

      // Check Green Bar OCR (approx 90 cal, ~3g fat, ~7g sugar, ~20mg salt)
      const bar = items.find((o: any) => /bar|chunky|green|wafer|biscuit/i.test(o.name) || o.sourceImageIndex === 0);
      if (bar?.perServing) {
        details.push(`Item 0 / Bar OCR: calories=${bar.perServing.calories}, sugar=${bar.perServing.sugar}g, salt=${bar.perServing.saltMg}mg`);
      }

      // Check Cake OCR (yellow cake high calories/sugar: ~250 cal, ~19g sugar)
      const cake = items.find((o: any) => /cake|bolu|yellow|chiffon/i.test(o.name) || o.sourceImageIndex === 3);
      if (cake?.perServing) {
        details.push(`Item 3 / Cake OCR: calories=${cake.perServing.calories}, sugar=${cake.perServing.sugar}g`);
      }

      return { passed, details };
    },
  },
  {
    id: "G6_menu_items",
    name: "G6: Compare Indonesian Restaurant Menu Pages (Sambal Bakar Pencok)",
    kind: "menu_items",
    imagePaths: [
      path.join(process.cwd(), "tests", "Golden_meal", "6. Compare menu items", "Menu_page_1.jpg"),
      path.join(process.cwd(), "tests", "Golden_meal", "6. Compare menu items", "Menu_page_2.jpg"),
    ],
    userPrompt: "What are the healthier options on this menu?",
    expectedChecks: (result: any) => {
      const details: string[] = [];
      let passed = true;
      const items = result.items || [];
      const groups = result.groups || [];
      details.push(`Extracted ${items.length} menu items from 2 pages.`);
      if (items.length < 5) passed = false;
      details.push(`Created ${groups.length} ranked menu comparison groups.`);

      // Validate Ordering & Verdicts
      groups.forEach((g: any, idx: number) => {
        details.push(`Group ${idx + 1} [${g.verdict?.level?.toUpperCase()}]: "${g.groupName}" -> ${g.verdict?.label}`);
      });
      return { passed, details };
    },
  },
  {
    id: "G7_shelf_compare",
    name: "G7: Supermarket Chip Aisle Compact Shelf Comparison",
    kind: "shelf_selection",
    imagePaths: [
      path.join(process.cwd(), "tests", "Golden_meal", "7. Compare large set of similar choices", "Large_food_item_comparison_Up_to_50.jpg"),
    ],
    userPrompt: "Compare the chip options on this shelf.",
    expectedChecks: (result: any) => {
      const details: string[] = [];
      let passed = true;
      const items = result.items || [];
      const groups = result.groups || [];
      details.push(`Extracted ${items.length} snack brands/choices from shelf.`);
      const names = items.map((o: any) => (o.brand || o.name || "").toLowerCase()).join(" ");
      const expectedBrands = ["happy tos", "chitato", "lay", "qtela", "doritos", "taro"];
      const foundBrands = expectedBrands.filter(b => names.includes(b.split(" ")[0]));
      details.push(`Found recognizable brands: ${foundBrands.join(", ")} (${foundBrands.length}/${expectedBrands.length})`);
      if (foundBrands.length < 3) passed = false;

      // Invariant check: Taro brand, not taro leaves!
      const taro = items.find((o: any) => /taro/i.test(o.name) || /taro/i.test(o.brand || ""));
      if (taro) {
        if (/leaf|leaves|sayur|vegetable/i.test(taro.name)) {
          details.push("FAIL: Invariant violated: Taro snack misclassified as vegetable taro leaves!");
          passed = false;
        } else {
          details.push("PASS: Taro correctly recognized as snack brand.");
        }
      }

      // Check Grouping and Verdicts
      details.push(`Shelf Groups (${groups.length}):`);
      groups.forEach((g: any, idx: number) => {
        details.push(`  Group ${idx + 1}: "${g.groupName}" [${g.verdict?.level?.toUpperCase()}] - "${g.verdict?.label}" (${g.scoutItemIndices?.length || 0} items)`);
      });

      return { passed, details };
    },
  },
];

function loadImagesAsInlineParts(paths: string[]) {
  const parts: any[] = [];
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    if (!fs.existsSync(p)) {
      throw new Error(`Image file not found: ${p}`);
    }
    const buf = fs.readFileSync(p);
    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: buf.toString("base64"),
      },
    });
  }
  return parts;
}

async function runScoutOnlyComparePrototype() {
  console.log("==========================================================================================");
  console.log("SCOUT-ONLY COMPARE PROTOTYPE BENCHMARK (Mode D)");
  console.log("Model: gemini-3.5-flash-lite | Architecture: Direct Scout-Only Comparison (No Dietitian/USDA)");
  console.log("==========================================================================================\n");

  const summaryReport: Array<{
    id: string;
    name: string;
    optionsCount: number;
    recommended: string;
    durationMs: number;
    checkResults: string[];
    passed: boolean;
  }> = [];

  for (const tc of testCases) {
    console.log(`\n------------------------------------------------------------------------------------------`);
    console.log(`TEST CASE: [${tc.id}] ${tc.name}`);
    console.log(`Input Images: ${tc.imagePaths.length} | Kind: ${tc.kind}`);
    console.log(`User Prompt: "${tc.userPrompt}"`);
    console.log(`------------------------------------------------------------------------------------------`);

    try {
      const startTime = Date.now();
      const imageParts = loadImagesAsInlineParts(tc.imagePaths);
      const userPromptText = buildScoutComparePrompt(tc.userPrompt, imageParts.length);

      const contents = [
        ...imageParts,
        { text: userPromptText },
      ];

      console.log(`Calling gemini-3.5-flash-lite with Scout-Only Compare instruction...`);
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
      const rawText = response.text || "{}";
      let json: any = {};
      try {
        json = JSON.parse(rawText);
      } catch (e) {
        console.error("Failed to parse response JSON:", rawText);
        continue;
      }

      console.log(`\n[Scout Response received in ${durationMs}ms]`);
      console.log(`Internal Reasoning: ${json._internalReasoning}`);
      console.log(`Comparison Title: ${json.comparisonTitle}`);
      console.log(`Comparison Type: ${json.comparisonType}`);
      console.log(`Summary: ${json.summary}`);
      console.log(`Recommended Option: ${json.recommendedOption}`);
      console.log(`Total Items Extracted: ${json.items?.length || 0}`);
      console.log(`Total Comparison Groups Formed: ${json.groups?.length || 0}`);

      console.log("\n--- Extracted Items ---");
      (json.items || []).forEach((item: any, idx: number) => {
        const cal = item.perServing?.calories != null ? `${item.perServing.calories} kcal` : "N/A";
        const sugar = item.perServing?.sugar != null ? `${item.perServing.sugar}g sugar` : "";
        const salt = item.perServing?.saltMg != null ? `${item.perServing.saltMg}mg salt` : (item.perServing?.sodiumMg != null ? `${item.perServing.sodiumMg}mg sodium` : "");
        const label = item.hasNutritionLabel ? "[Has Label OCR]" : "[No Label Panel]";
        console.log(`  [Item ${idx}] (Img ${item.sourceImageIndex}) ${item.name} | ${cal} ${sugar} ${salt} ${label}`);
      });

      console.log("\n--- Diet Groups (Ranked & Ordered with Verdicts) ---");
      (json.groups || []).forEach((g: any, idx: number) => {
        const indices = (g.scoutItemIndices || []).join(", ");
        const cal = g.averageNutrients?.calories != null ? `${g.averageNutrients.calories} kcal` : "";
        const na = g.averageNutrients?.sodium != null ? `${g.averageNutrients.sodium}mg Na` : "";
        console.log(`  Rank ${idx + 1}: "${g.groupName}" [${g.verdict?.level?.toUpperCase()}] - "${g.verdict?.label}" (Items: [${indices}]) ${cal} ${na}`);
        console.log(`    Comparative Sentence: "${g.comparisonSentence}"`);
        console.log(`    Clinical Message: ${g.message}`);
      });

      let checkRes = { passed: true, details: [] as string[] };
      if (tc.expectedChecks) {
        checkRes = tc.expectedChecks(json);
        console.log(`\nValidation Checks:`);
        checkRes.details.forEach(d => console.log(`  - ${d}`));
        console.log(`Outcome: ${checkRes.passed ? "✅ ALL INVARIANTS PASSED" : "⚠️ CHECK WARNINGS DETECTED"}`);
      }

      summaryReport.push({
        id: tc.id,
        name: tc.name,
        optionsCount: json.items?.length || 0,
        recommended: json.recommendedOption || "N/A",
        durationMs,
        checkResults: checkRes.details,
        passed: checkRes.passed,
      });

    } catch (err: any) {
      console.error(`Error in test case ${tc.id}:`, err?.message || err);
      summaryReport.push({
        id: tc.id,
        name: tc.name,
        optionsCount: 0,
        recommended: "ERROR",
        durationMs: 0,
        checkResults: [`Error: ${err?.message || String(err)}`],
        passed: false,
      });
    }
  }

  console.log("\n==========================================================================================");
  console.log("SCOUT-ONLY COMPARE BENCHMARK SUMMARY");
  console.log("==========================================================================================");
  summaryReport.forEach(s => {
    console.log(`${s.passed ? "✅ PASS" : "❌ FAIL"} | [${s.id}] ${s.name}`);
    console.log(`       Items: ${s.optionsCount} | Recommended: "${s.recommended}" | Latency: ${s.durationMs}ms`);
  });
  console.log("==========================================================================================\n");
}

runScoutOnlyComparePrototype().catch(console.error);
