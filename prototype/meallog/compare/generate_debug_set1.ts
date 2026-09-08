import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import {
  scoutOnlyCompareSystemInstruction,
  scoutOnlyCompareResponseSchema,
} from "./scout_only_compare_instructions.js";
import { buildDebugMarkdownReport, DebugReportInput } from "../../../src/utils/debugPayload.js";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY environment variable is required");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const imagesDir = path.join(process.cwd(), "prototype", "meallog", "compare", "images");

const imageFilesSet1 = [
  "set1_saybread_bakery_shelf.jpg",
  "set1_silverqueen_nutrition_label.jpg",
  "set1_silverqueen_chocolate_front.jpg",
];

async function runSet1Debug() {
  console.log("==========================================================================================");
  console.log("GENERATING DEBUG REPORT FOR SET 1: SAY BREAD BAKERY SHELF & SILVERQUEEN CHOCOLATE");
  console.log("Following docs/agent/domains/debug-contract.md & buildDebugMarkdownReport");
  console.log("==========================================================================================\n");

  const imageParts: any[] = [];
  for (const filename of imageFilesSet1) {
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

  const userPrompt = "Compare these items and help me choose the healthier option.";
  const contents = [...imageParts, { text: userPrompt }];

  const jobId = "job_1787869907978_hisertpsj";
  const startTime = Date.now();
  console.log(`Calling gemini-3.5-flash-lite for ${jobId}...`);

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

  const latencyMs = Date.now() - startTime;
  const rawText = response.text || "{}";
  let scoutJson: any = {};
  try {
    scoutJson = JSON.parse(rawText);
  } catch (err) {
    console.error("Failed to parse JSON response:", rawText);
    process.exit(1);
  }

  console.log(`[Response received in ${latencyMs}ms]`);
  console.log(`Extracted ${scoutJson.items?.length || 0} items across ${scoutJson.groups?.length || 0} groups.`);

  // Ensure groups are strictly sorted best-choice first (good -> neutral -> warning -> alert)
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
    cookingMethod: item.name.toLowerCase().includes("bread") || item.name.toLowerCase().includes("cake") ? "baked" : "raw",
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

  // Construct standard DebugReportInput according to debug-contract.md
  const reportInput: DebugReportInput = {
    jobId,
    status: "succeeded",
    pack: "food",
    mode: "compare",
    version: 3,
    savable: false,
    exportedAt: new Date().toISOString(),
    userPrompt,
    prompt: userPrompt,
    userMessage: userPrompt,
    message: narrative,
    scoutItems,
    scoutInternalReasoning: scoutJson._internalReasoning || "Compared bakery items and chocolate bar for nutritional density.",
    rawScout: scoutJson,
    scoutContentType: "mixed_selection",
    diningEnvironment: "casual_restaurant",
    photoUrls: [
      `https://pub-2ae421ce82904986ae87c8bc27552cff.r2.dev/photos/${jobId}_0.jpg`,
      `https://pub-2ae421ce82904986ae87c8bc27552cff.r2.dev/photos/${jobId}_1.jpg`,
      `https://pub-2ae421ce82904986ae87c8bc27552cff.r2.dev/photos/${jobId}_2.jpg`,
    ],
    lastUserAction: {
      action: "submit_meal_job",
      timestamp: new Date().toISOString(),
      mode: "compare",
      prompt: userPrompt,
      imageCount: 3,
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
        details: { imageCount: 3, files: imageFilesSet1 },
      },
      {
        timestamp: new Date(Date.now() - 5000).toISOString().slice(11, 19),
        action: "input_change",
        target: "input",
        details: { name: "compare-query-input", valueLength: userPrompt.length },
      },
      {
        timestamp: new Date(Date.now() - 1000).toISOString().slice(11, 19),
        action: "submit_initiated",
        target: "chat_composer",
        details: { prompt: userPrompt, imageCount: 3, submissionMode: "compare" },
      },
      {
        timestamp: new Date().toISOString().slice(11, 19),
        action: "submit_meal_job",
        target: "chat_compose_dock",
        details: { jobId, promptLength: userPrompt.length, imageCount: 3, submissionMode: "compare" },
      },
    ],
    clientConsoleLogs: [
      `[INFO] Compare mode triggered with 3 images for job ${jobId}`,
      `[INFO] Scout-Only Compare pipeline invoked (single-pass architecture).`,
    ],
    networkErrors: [],
    dialogInventory: {
      open: true,
      title: "Food Item & Shelf Comparison",
      on_card: {
        totalOptions: scoutJson.items?.length || 0,
        groups: scoutJson.groups?.length || 0,
        recommended: scoutJson.recommendedOption || "Say Bread Bakery Options",
      },
      visible: ["View Comparison Details", "Download Debug Report", "Close Modal"],
      hidden: ["Retry", "Attempt 1 of 3", "Save Meal to History"],
      composer: { photo: 1, add_image: 1, paste: 1, send: 1 },
      expand: true,
    },
    dispatches: [
      {
        id: "dispatch-scout-compare-01",
        parent: jobId,
        turn: 1,
        agent: "scout",
        user: userPrompt,
        received: { imageCount: 3, prompt: userPrompt, mode: "compare" },
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
    backendLogs: `[backend] [${jobId}] Compare request received with 3 images. Mode: compare.\n` +
      `[scout_only_compare] Dispatched to gemini-3.5-flash-lite with single-pass instruction.\n` +
      `[scout_only_compare] Latency: ${latencyMs}ms. Usage: ${response.usageMetadata?.promptTokenCount || 0} in / ${response.usageMetadata?.candidatesTokenCount || 0} out tokens.\n` +
      `[scout_only_compare] Extracted ${scoutJson.items?.length || 0} items into ${scoutJson.groups?.length || 0} ranked groups.\n` +
      `[scout_only_compare] Status: SUCCESS. Finalized compare payload.`,
  };

  const markdownReport = buildDebugMarkdownReport(reportInput);

  const outputPath = path.join(process.cwd(), "prototype", "meallog", "compare", "debug_set1_saybread_silverqueen.md");
  fs.writeFileSync(outputPath, markdownReport, "utf-8");
  console.log(`\n✅ Successfully generated debug report: ${outputPath}`);
  console.log(`Report length: ${markdownReport.length} bytes (${markdownReport.split("\n").length} lines)`);
}

runSet1Debug().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
