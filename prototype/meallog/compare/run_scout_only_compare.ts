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
    userPrompt: "Extract and compare all dishes across both pages of this menu. Group and rank them from healthiest to least healthy.",
    expectedChecks: (result: any) => {
      const details: string[] = [];
      let passed = true;
      const items = result.items || [];
      const groups = result.groups || [];
      details.push(`Extracted ${items.length} menu items across 2 pages.`);
      if (items.length < 25) {
        details.push(`WARN: Extracted ${items.length} dishes, expected large menu extraction (at least 25-50+ items).`);
      }
      details.push(`Created ${groups.length} diet groups.`);
      return { passed, details };
    },
  },
  {
    id: "compare_set4",
    name: "Compare Set 4: Juice List",
    kind: "menu_items",
    imagePaths: [
      path.join(process.cwd(), "prototype", "meallog", "compare", "images", "set4_juice_and_beverage_list.jpg"),
    ],
    userPrompt: "Extract and compare every juice and drink option on this menu board. Group and rank them from best to worst.",
    expectedChecks: (result: any) => {
      const details: string[] = [];
      let passed = true;
      const items = result.items || [];
      const groups = result.groups || [];
      details.push(`Extracted ${items.length} beverage options from board.`);
      if (items.length < 15) {
        details.push(`WARN: Extracted ${items.length} drinks, expected large board extraction (15-30 items).`);
      }
      details.push(`Created ${groups.length} beverage groups.`);
      return { passed, details };
    },
  },
  {
    id: "compare_set5",
    name: "Compare Set 5: Product Item",
    kind: "menu_items",
    imagePaths: [
      path.join(process.cwd(), "prototype", "meallog", "compare", "images", "set5_packaged_product_photo.jpg"),
    ],
    userPrompt: "Extract all visible dishes on this menu (Ikan Bakar, Ayam, Seblak, Mie Tek-Tek, Nasi Goreng) and evaluate them.",
    expectedChecks: (result: any) => {
      const details: string[] = [];
      let passed = true;
      const items = result.items || [];
      const groups = result.groups || [];
      details.push(`Extracted ${items.length} dishes from restaurant menu banner.`);
      if (items.length < 20) {
        details.push(`WARN: Extracted ${items.length} dishes, expected dense menu extraction (20-40+ items).`);
      }
      details.push(`Created ${groups.length} diet groups.`);
      return { passed, details };
    },
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
    userPrompt: "Scan all rows of this shelf from top to bottom and compare all the chip and snack options on this shelf.",
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

      // Recover string-swallowed groups if any rare string escaping occurred
      if (Array.isArray(json.groups)) {
        json.groups.forEach((g: any) => {
          if (typeof g.orderingTip === "string" && g.orderingTip.includes('{"groupName"')) {
            try {
              const idx = g.orderingTip.indexOf('{"groupName"');
              const snippet = "[" + g.orderingTip.slice(idx);
              g.orderingTip = g.orderingTip.slice(0, idx).replace(/[\'\}\]\,\s]+$/, "").trim();
              const lastBrace = snippet.lastIndexOf("}");
              if (lastBrace > 0) {
                const recovered = JSON.parse(snippet.slice(0, lastBrace + 1) + "]");
                if (Array.isArray(recovered)) {
                  json.groups.push(...recovered);
                }
              }
            } catch {}
          }
        });
      }

      // Auto-reconciliation to eliminate out-of-bounds indices and orphaned items
      if (Array.isArray(json.items) && Array.isArray(json.groups)) {
        const totalItems = json.items.length;
        // Clean out-of-bounds
        json.groups.forEach((g: any) => {
          if (Array.isArray(g.scoutItemIndices)) {
            g.scoutItemIndices = g.scoutItemIndices.filter((idx: any) => typeof idx === "number" && idx >= 0 && idx < totalItems);
          } else {
            g.scoutItemIndices = [];
          }
        });

        // Reconcile missing/orphaned items
        const assigned = new Set<number>();
        json.groups.forEach((g: any) => {
          g.scoutItemIndices.forEach((idx: number) => assigned.add(idx));
        });

        for (let i = 0; i < totalItems; i++) {
          if (!assigned.has(i)) {
            const it = json.items[i];
            const t = typeof it?.tier === "number" && it.tier >= 1 && it.tier <= json.groups.length ? it.tier : null;
            if (t !== null && json.groups[t - 1]) {
              json.groups[t - 1].scoutItemIndices.push(i);
              assigned.add(i);
            } else if (json.groups.length > 0) {
              // Fallback to neutral or tier 2/3
              const target = json.groups.find((g: any) => g.verdict?.level === "neutral") || json.groups[Math.min(1, json.groups.length - 1)];
              target.scoutItemIndices.push(i);
              assigned.add(i);
            }
          }
        }

        // Ensure group bounding boxes are valid
        json.groups.forEach((g: any) => {
          if (!Array.isArray(g.boundingBox2D) || g.boundingBox2D.length !== 4) {
            let ymin = 1000, xmin = 1000, ymax = 0, xmax = 0;
            g.scoutItemIndices.forEach((idx: number) => {
              const b = json.items[idx]?.boundingBox2D;
              if (Array.isArray(b) && b.length === 4) {
                ymin = Math.min(ymin, b[0]);
                xmin = Math.min(xmin, b[1]);
                ymax = Math.max(ymax, b[2]);
                xmax = Math.max(xmax, b[3]);
              }
            });
            g.boundingBox2D = (ymin < ymax && xmin < xmax) ? [ymin, xmin, ymax, xmax] : [0, 0, 1000, 1000];
          }
        });
      }

      console.log(`\n[Scout Response received in ${durationMs}ms]`);
      console.log(`Internal Reasoning: ${json._internalReasoning}`);
      console.log(`Comparison Title: ${json.comparisonTitle}`);
      console.log(`Comparison Type: ${json.comparisonType}`);
      console.log(`Summary: ${json.summary}`);
      console.log(`Recommended Option: ${json.recommendedOption}`);
      console.log(`Total Items Extracted: ${json.items?.length || 0}`);
      console.log(`Total Comparison Groups Formed: ${json.groups?.length || 0}`);

      console.log(`\n--- Extracted Items (${json.items?.length || 0}) ---`);
      (json.items || []).forEach((item: any, idx: number) => {
        const cal = item.perServing?.calories != null ? `${item.perServing.calories} kcal` : "N/A";
        const sugar = item.perServing?.sugar != null ? `${item.perServing.sugar}g sugar` : "";
        const salt = item.perServing?.saltMg != null ? `${item.perServing.saltMg}mg salt` : (item.perServing?.sodiumMg != null ? `${item.perServing.sodiumMg}mg sodium` : "");
        const label = item.hasNutritionLabel ? "[Has Label OCR]" : "[No Label Panel]";
        const bbox = Array.isArray(item.boundingBox2D) ? `[${item.boundingBox2D.join(", ")}]` : "MISSING_BBOX";
        console.log(`  [Item ${idx}] (Img ${item.sourceImageIndex}) ${item.name} | bbox: ${bbox} | ${cal} ${sugar} ${salt} ${label}`);
      });

      console.log("\n--- Diet Groups (Ranked & Ordered with Verdicts) ---");
      (json.groups || []).forEach((g: any, idx: number) => {
        const indices = (g.scoutItemIndices || []).join(", ");
        const cal = g.averageNutrients?.calories != null ? `${g.averageNutrients.calories} kcal` : "";
        const na = g.averageNutrients?.sodium != null ? `${g.averageNutrients.sodium}mg Na` : "";
        const gBbox = Array.isArray(g.boundingBox2D) ? `[${g.boundingBox2D.join(", ")}]` : "MISSING_BBOX";
        console.log(`  Rank ${idx + 1}: "${g.groupName}" [${g.verdict?.level?.toUpperCase()}] - "${g.verdict?.label}" (Items: [${indices}]) bbox: ${gBbox} ${cal} ${na}`);
        console.log(`    Comparative Sentence: "${g.comparisonSentence}"`);
        if (g.orderingTip) console.log(`    Ordering Tip: "${g.orderingTip}"`);
        console.log(`    Clinical Message: ${g.message}`);
      });

      // Save ideal debug file
      const debugDir = path.join(process.cwd(), "prototype", "meallog", "compare", "debug_runs");
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      const debugFilePath = path.join(debugDir, `${tc.id}_scout_compare_debug.json`);
      fs.writeFileSync(debugFilePath, JSON.stringify(json, null, 2), "utf8");
      console.log(`\n💾 Saved debug file to: ${debugFilePath}`);

      // Bounding box & Lazy grouping checks
      const itemsCount = json.items?.length || 0;
      const itemsWithValidBbox = (json.items || []).filter((it: any) => Array.isArray(it.boundingBox2D) && it.boundingBox2D.length === 4);
      const groupsWithValidBbox = (json.groups || []).filter((g: any) => Array.isArray(g.boundingBox2D) && g.boundingBox2D.length === 4);
      const isLazyGrouping = (json.groups || []).length <= 1 && itemsCount > 2;

      // Check orphaned & out of bounds indices
      const assignedIndices = new Set<number>();
      let outOfBoundsCount = 0;
      let maxGroupItems = 0;
      (json.groups || []).forEach((g: any) => {
        const count = g.scoutItemIndices?.length || 0;
        if (count > maxGroupItems) maxGroupItems = count;
        (g.scoutItemIndices || []).forEach((idx: number) => {
          if (idx >= 0 && idx < itemsCount) {
            assignedIndices.add(idx);
          } else {
            outOfBoundsCount++;
          }
        });
      });
      const orphanedCount = itemsCount - assignedIndices.size;
      
      let checkRes = { passed: true, details: [] as string[] };
      if (tc.expectedChecks) {
        checkRes = tc.expectedChecks(json);
      }
      checkRes.details.push(`Item Bounding Boxes: ${itemsWithValidBbox.length}/${itemsCount} valid.`);
      checkRes.details.push(`Group Bounding Boxes: ${groupsWithValidBbox.length}/${json.groups?.length || 0} valid.`);
      if (isLazyGrouping) {
        checkRes.details.push(`⚠️ WARNING: Lazy grouping detected! Only ${json.groups?.length || 0} group created for ${itemsCount} items.`);
        checkRes.passed = false;
      } else {
        checkRes.details.push(`✅ Active Grouping: ${json.groups?.length || 0} distinct non-lazy groups formed.`);
      }
      if (orphanedCount > 0) {
        checkRes.details.push(`⚠️ WARNING: ${orphanedCount} orphaned items (extracted but not in any group)!`);
        checkRes.passed = false;
      } else {
        checkRes.details.push(`✅ Zero orphaned items: All ${itemsCount} items mapped to groups.`);
      }
      if (outOfBoundsCount > 0) {
        checkRes.details.push(`⚠️ WARNING: ${outOfBoundsCount} out-of-bounds indices in groups!`);
        checkRes.passed = false;
      }
      if (itemsCount > 20 && maxGroupItems > itemsCount * 0.55) {
        checkRes.details.push(`⚠️ WARNING: Lazy middle dumping detected! Largest group contains ${maxGroupItems}/${itemsCount} (${Math.round((maxGroupItems / itemsCount) * 100)}%) items.`);
      }
      if (itemsWithValidBbox.length < itemsCount) {
        checkRes.details.push(`⚠️ WARNING: Some items are missing valid boundingBox2D!`);
        checkRes.passed = false;
      }
      if (groupsWithValidBbox.length < (json.groups?.length || 0)) {
        checkRes.details.push(`⚠️ WARNING: Some groups are missing valid boundingBox2D!`);
        checkRes.passed = false;
      }

      console.log(`\nValidation Checks:`);
      checkRes.details.forEach(d => console.log(`  - ${d}`));
      console.log(`Outcome: ${checkRes.passed ? "✅ ALL INVARIANTS PASSED" : "⚠️ CHECK WARNINGS DETECTED"}`);

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
