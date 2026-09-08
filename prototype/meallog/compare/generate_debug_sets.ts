import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import {
  scoutOnlyCompareSystemInstruction,
  scoutOnlyCompareResponseSchema,
  buildScoutComparePrompt,
} from "./scout_only_compare_instructions.js";
import { buildDebugMarkdownReport, DebugReportInput } from "../../../src/utils/debugPayload.js";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY environment variable is required");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const imagesDir = path.join(process.cwd(), "prototype", "meallog", "compare", "images");

interface SetConfig {
  key: string;
  name: string;
  description: string;
  files: string[];
  userPrompt: string;
  contentType: string;
  outputFilename: string;
}

const setsToRun: SetConfig[] = [
  {
    key: "2",
    name: "Set 2: 4 Snack & Pack Nutrition Labels",
    description: "4 snack labels and pack fronts (green bar, pack front, yellow cake, blue bread)",
    files: [
      "set2_snack_green_bar_label.jpg",
      "set2_snack_pack_front.jpg",
      "set2_snack_yellow_cake_label.jpg",
      "set2_snack_blue_bread_label.jpg",
    ],
    userPrompt: "Compare these 4 snacks and help me choose the healthiest one.",
    contentType: "nutrition_labels",
    outputFilename: "debug_set2_snack_labels.md",
  },
  {
    key: "3",
    name: "Set 3: Restaurant Menu Pages (Sambal Bakar Pencok)",
    description: "2-page Indonesian restaurant menu comparing dishes/options",
    files: [
      "set3_restaurant_menu_page1.jpg",
      "set3_restaurant_menu_page2.jpg",
    ],
    userPrompt: "What are the healthier options on this menu?",
    contentType: "menu_items",
    outputFilename: "debug_set3_restaurant_menu.md",
  },
  {
    key: "4",
    name: "Set 4: Juice & Beverage List",
    description: "Beverage and juice menu options list",
    files: [
      "set4_juice_and_beverage_list.jpg",
    ],
    userPrompt: "Compare the juices on this list and recommend the best option.",
    contentType: "menu_items",
    outputFilename: "debug_set4_juice_list.md",
  },
  {
    key: "5",
    name: "Set 5: Packaged Product Item",
    description: "Standalone packaged beverage / snack product evaluation",
    files: [
      "set5_packaged_product_photo.jpg",
    ],
    userPrompt: "Evaluate and analyze this product.",
    contentType: "product_item",
    outputFilename: "debug_set5_product_item.md",
  },
  {
    key: "6",
    name: "Set 6: Supermarket Chip Aisle Shelf",
    description: "Compact comparison across snack choices on a supermarket shelf",
    files: [
      "set6_supermarket_chip_aisle_shelf.jpg",
    ],
    userPrompt: "Compare the chip options on this shelf and advise on healthier choices.",
    contentType: "shelf_selection",
    outputFilename: "debug_set6_supermarket_chip_aisle.md",
  },
];

async function runSet(cfg: SetConfig) {
  console.log("==========================================================================================");
  console.log(`GENERATING DEBUG REPORT: [${cfg.name}]`);
  console.log(`Description: ${cfg.description}`);
  console.log(`Files: ${cfg.files.join(", ")}`);
  console.log("==========================================================================================\n");

  const imageParts: any[] = [];
  for (const filename of cfg.files) {
    const fullPath = path.join(imagesDir, filename);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${fullPath}`);
    }
    const buf = fs.readFileSync(fullPath);
    imageParts.push({
      inlineData: {
        data: buf.toString("base64"),
        mimeType: "image/jpeg",
      },
    });
  }

  const userPromptText = buildScoutComparePrompt(cfg.userPrompt, imageParts.length);
  const contents = [...imageParts, { text: userPromptText }];
  const jobId = `job_compare_set${cfg.key}_${Date.now()}`;
  const startTime = Date.now();
  console.log(`Calling gemini-3.5-flash-lite for ${jobId}...`);

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents,
    config: {
      systemInstruction: scoutOnlyCompareSystemInstruction,
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: scoutOnlyCompareResponseSchema,
    },
  });

  const latencyMs = Date.now() - startTime;
  const rawText = response.text || "{}";
  let scoutJson: any = {};
  try {
    scoutJson = JSON.parse(rawText);
  } catch (err) {
    console.error("Failed to parse JSON response. Length:", rawText.length);
    console.error("Head:", rawText.slice(0, 300));
    console.error("Tail:", rawText.slice(-300));
    return;
  }

  console.log(`[Response received in ${latencyMs}ms]`);
  console.log(`Extracted ${scoutJson.items?.length || 0} items across ${scoutJson.groups?.length || 0} groups.`);

  // Ensure groups are sorted best-choice first (good -> neutral -> warning -> alert)
  const rankMap: Record<string, number> = { good: 1, neutral: 2, warning: 3, alert: 4 };
  if (Array.isArray(scoutJson.groups)) {
    scoutJson.groups.sort((a: any, b: any) => {
      const rA = rankMap[(a.verdict?.level || "").toLowerCase()] || 2;
      const rB = rankMap[(b.verdict?.level || "").toLowerCase()] || 2;
      return rA - rB;
    });
  }

  // Transform extracted items into scoutItems format for debug report
  const scoutItems = (scoutJson.items || []).map((item: any, idx: number) => ({
    originalName: item.name,
    name: item.name,
    sourceImageIndex: item.sourceImageIndex,
    estimatedWeightGrams: item.estimatedWeightGrams || (item.perServing?.servingSizeGrams ? item.perServing.servingSizeGrams : 50),
    packGrams: item.packGrams || null,
    hasNutritionLabel: item.hasNutritionLabel,
    cookingMethod: item.name.toLowerCase().includes("soup") || item.name.toLowerCase().includes("rebus") ? "boiled" : (item.name.toLowerCase().includes("goreng") ? "fried" : "packaged"),
    packageLabelText: item.perServing ? `${item.perServing.calories ?? ""} kcal | Sugar: ${item.perServing.sugar ?? ""}g | Sat Fat: ${item.perServing.saturatedFat ?? ""}g` : null,
    rawNutritionLabel: item.hasNutritionLabel ? item.perServing : null,
    nutrients: {
      calories: item.perServing?.calories ?? null,
      protein: item.perServing?.protein ?? null,
      carbohydrates: item.perServing?.carbohydrates ?? null,
      totalFat: item.perServing?.totalFat ?? null,
      saturatedFat: item.perServing?.saturatedFat ?? null,
      totalSugar: item.perServing?.sugar ?? null,
      sodium: item.perServing?.sodiumMg ?? (item.perServing?.saltMg != null ? Math.round(item.perServing.saltMg * 0.4) : null),
    },
  }));

  // Build narrative message from scout evaluation
  let narrative = `### ${scoutJson.comparisonTitle || "Option Comparison"}\n\n`;
  narrative += `**Summary:** ${scoutJson.summary}\n\n`;
  narrative += `**Recommended Option:** ${scoutJson.recommendedOption}\n\n`;
  narrative += `#### Comparison Groups & Verdicts\n`;
  (scoutJson.groups || []).forEach((g: any, gIdx: number) => {
    const itemNames = (g.scoutItemIndices || []).map((i: number) => scoutJson.items?.[i]?.name || `Item ${i}`).join(", ");
    narrative += `\n**Rank ${gIdx + 1}: ${g.groupName}** [${g.verdict?.level?.toUpperCase()}] — *${g.verdict?.label}*\n`;
    narrative += `- **Items Included:** ${itemNames}\n`;
    narrative += `- **Comparative Sentence:** "${g.comparisonSentence}"\n`;
    narrative += `- **Clinical Guidance:** ${g.message}\n`;
    if (g.averageNutrients) {
      narrative += `- **Nutrient Profile:** ${g.averageNutrients.calories ?? "—"} kcal | P: ${g.averageNutrients.protein ?? "—"}g | C: ${g.averageNutrients.carbohydrates ?? "—"}g | F: ${g.averageNutrients.totalFat ?? "—"}g | Saturated Fat: ${g.averageNutrients.saturatedFat ?? "—"}g | Sodium: ${g.averageNutrients.sodium ?? "—"}mg\n`;
    }
  });

  const photoUrls = cfg.files.map((_, i) => `https://pub-2ae421ce82904986ae87c8bc27552cff.r2.dev/photos/${jobId}_${i}.jpg`);

  const reportInput: DebugReportInput = {
    jobId,
    status: "succeeded",
    pack: "food",
    mode: "compare",
    version: 3,
    savable: false,
    exportedAt: new Date().toISOString(),
    userPrompt: cfg.userPrompt,
    prompt: cfg.userPrompt,
    userMessage: cfg.userPrompt,
    message: narrative,
    scoutItems,
    scoutInternalReasoning: scoutJson._internalReasoning || `Evaluated products for ${cfg.name}.`,
    rawScout: scoutJson,
    scoutContentType: cfg.contentType,
    diningEnvironment: "supermarket_or_store",
    photoUrls,
    lastUserAction: {
      action: "submit_meal_job",
      timestamp: new Date().toISOString(),
      mode: "compare",
      prompt: cfg.userPrompt,
      imageCount: cfg.files.length,
    },
    userActionBreadcrumbs: [
      {
        timestamp: new Date(Date.now() - 15000).toISOString().slice(11, 19),
        action: "click",
        target: "button",
        details: { label: "Compare Foods / Menu", id: "compare-toggle-btn" },
      },
      {
        timestamp: new Date(Date.now() - 12000).toISOString().slice(11, 19),
        action: "select_photos",
        target: "camera_roll",
        details: { imageCount: cfg.files.length, files: cfg.files },
      },
      {
        timestamp: new Date(Date.now() - 5000).toISOString().slice(11, 19),
        action: "input_change",
        target: "input",
        details: { name: "compare-query-input", valueLength: cfg.userPrompt.length },
      },
      {
        timestamp: new Date(Date.now() - 1000).toISOString().slice(11, 19),
        action: "submit_initiated",
        target: "chat_composer",
        details: { prompt: cfg.userPrompt, imageCount: cfg.files.length, submissionMode: "compare" },
      },
      {
        timestamp: new Date().toISOString().slice(11, 19),
        action: "submit_meal_job",
        target: "chat_compose_dock",
        details: { jobId, promptLength: cfg.userPrompt.length, imageCount: cfg.files.length, submissionMode: "compare" },
      },
    ],
    clientConsoleLogs: [
      `[INFO] Compare mode triggered with ${cfg.files.length} images for job ${jobId}`,
      `[INFO] Scout-Only Compare single-pass pipeline invoked for ${cfg.name}.`,
    ],
    networkErrors: [],
    dialogInventory: {
      open: true,
      title: "Food Item & Shelf Comparison",
      on_card: {
        totalOptions: scoutJson.items?.length || 0,
        groups: scoutJson.groups?.length || 0,
        recommended: scoutJson.recommendedOption || "Recommended Choice",
      },
      visible: ["View Comparison Details", "Download Debug Report", "Close Modal"],
      hidden: ["Retry", "Attempt 1 of 3", "Save Meal to History"],
      composer: { photo: 1, add_image: 1, paste: 1, send: 1 },
      expand: true,
    },
    dispatches: [
      {
        id: `dispatch-scout-compare-${cfg.key}`,
        parent: jobId,
        turn: 1,
        agent: "scout",
        user: cfg.userPrompt,
        received: { imageCount: cfg.files.length, prompt: cfg.userPrompt, mode: "compare" },
        systemInstruction: scoutOnlyCompareSystemInstruction,
        output: rawText,
        called: true,
        model: "gemini-3.5-flash-lite",
        latency_ms: latencyMs,
        tokens: { input: response.usageMetadata?.promptTokenCount || 0, output: response.usageMetadata?.candidatesTokenCount || 0 },
      },
    ],
    stageLedger: [
      {
        stage: "Vision Scout & Comparison Extraction",
        status: "success",
        attempt: 1,
        decisions: [
          { key: "SinglePassArchitecture", value: "Enabled" },
          { key: "GroupOrdering", value: "BestChoiceFirst" },
          { key: "ComparativeSentences", value: "GeneratedPerGroup" },
        ],
        errors: [],
      },
    ],
    backendLogs: `[backend] [${jobId}] Compare request received with ${cfg.files.length} images. Mode: compare.\n` +
      `[scout_only_compare] Dispatched to gemini-3.5-flash-lite with single-pass instruction.\n` +
      `[scout_only_compare] Latency: ${latencyMs}ms. Usage: ${response.usageMetadata?.promptTokenCount || 0} in / ${response.usageMetadata?.candidatesTokenCount || 0} out tokens.\n` +
      `[scout_only_compare] Extracted ${scoutJson.items?.length || 0} items into ${scoutJson.groups?.length || 0} ranked groups.\n` +
      `[scout_only_compare] Status: SUCCESS. Finalized compare payload.`,
  };

  const markdownReport = buildDebugMarkdownReport(reportInput);
  const outputPath = path.join(process.cwd(), "prototype", "meallog", "compare", cfg.outputFilename);
  fs.writeFileSync(outputPath, markdownReport, "utf-8");
  console.log(`\n✅ Generated: ${outputPath} (${markdownReport.length} bytes, ${markdownReport.split("\n").length} lines)\n`);
}

async function main() {
  const targetKey = process.env.COMPARE_SET;
  const list = targetKey ? setsToRun.filter(s => s.key === targetKey) : setsToRun;
  for (const cfg of list) {
    await runSet(cfg);
  }
}

main().catch(err => {
  console.error("Batch debug generation failed:", err);
  process.exit(1);
});
