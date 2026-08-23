import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { scoutSystemInstruction } from "./server_vision_scout";
import {
  computeDishCoreKeyNutrients,
  aggregateDishNutrients,
  CoreKeyNutrients,
  BaseNutrients,
} from "./derivation_engine";
import { runDietitianAgent, dietitianSystemInstruction } from "./server_dietitian";

dotenv.config();

interface TestGroup {
  id: string;
  name: string;
  reportFileName: string;
  files: string[];
  userPrompt: string;
  isYolkCase?: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runEndToEndPipeline() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("No GEMINI_API_KEY found!");
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });
  const protoDir = path.join(process.cwd(), "prototype");

  const testGroups: TestGroup[] = [
    {
      id: "yolk",
      name: "01_yolk_panini_wrap.jpg",
      reportFileName: "REPORT_01_yolk_panini_wrap.md",
      files: ["01_yolk_panini_wrap.jpg"],
      userPrompt: "I had it from Yolk",
      isYolkCase: true,
    },
    {
      id: "lidl_muffin",
      name: "02_lidl_chicken_muffin.jpg",
      reportFileName: "REPORT_02_lidl_chicken_muffin.md",
      files: ["02_lidl_chicken_muffin.jpg"],
      userPrompt: "Scanning product package & muffin for afternoon snack.",
    },
    {
      id: "sushi_salad",
      name: "03_sushi_shrimp_salad.jpg",
      reportFileName: "REPORT_03_sushi_shrimp_salad.md",
      files: ["03_sushi_shrimp_salad.jpg"],
      userPrompt: "I ate this for lunch and went for a short 15 minute walk afterwards.",
    },
    {
      id: "fish_chips",
      name: "04_seaside_fish_chips.jpg",
      reportFileName: "REPORT_04_seaside_fish_chips.md",
      files: ["04_seaside_fish_chips.jpg"],
      userPrompt: "Ate this meal at a seaside pub.",
    },
    {
      id: "waffles_coffee",
      name: "05_cafe_waffles_coffee.jpg",
      reportFileName: "REPORT_05_cafe_waffles_coffee.md",
      files: ["05_cafe_waffles_coffee.jpg"],
      userPrompt: "Weekend brunch at cafe.",
    },
    {
      id: "indonesian_menu",
      name: "06_indonesian_menu (Sambal Bakar Pencok 89)",
      reportFileName: "REPORT_06_indonesian_menu.md",
      files: ["06_indonesian_menu_page_1.jpg", "06_indonesian_menu_page_2.jpg"],
      userPrompt: "Extract distinct dishes across both Indonesian menu pages (Sambal Bakar Pencok 89) for multi-language evaluation.",
    },
  ];

  console.log(`Starting End-to-End Test for ${testGroups.length} test group(s)...`);

  let masterMd = `# Prototype Master End-to-End Nutrition Pipeline Report\n\n`;
  masterMd += `**Generated At:** ${new Date().toISOString()}\n`;
  masterMd += `**Tested Cases Count:** ${testGroups.length} test groups (7 image files total)\n`;
  masterMd += `**Pipeline Architecture:** Stage 1 (Vision Scout) → Stage 2 (Derivation Engine & Brand Matcher) → Stage 3 (Dietitian Agent)\n\n`;

  masterMd += `---\n\n## Pipeline Architecture & System Instructions\n\n`;

  masterMd += `### 1. Vision Scout Agent System Instruction & Schema\n`;
  masterMd += `\`\`\`typescript\n${scoutSystemInstruction.trim()}\n\`\`\`\n\n`;

  masterMd += `### 2. Derivation Engine Logic (Pure TypeScript Formulas)\n`;
  masterMd += `\`\`\`typescript\n`;
  masterMd += `// Derived Nutrient Formulas:\n`;
  masterMd += `// - Carbohydrates (g) = Math.max(0, (Calories - (4 * Protein) - (9 * TotalFat)) / 4)\n`;
  masterMd += `// - Unsaturated Fat (g) = Math.max(0, TotalFat - (SaturatedFat + TransFat))\n`;
  masterMd += `// - Salt (g) = (Sodium in mg * 2.54) / 1000\n`;
  masterMd += `\`\`\`\n\n`;

  masterMd += `### 3. Dietitian Agent System Instruction & Schema\n`;
  masterMd += `\`\`\`typescript\n${dietitianSystemInstruction.trim()}\n\`\`\`\n\n`;

  masterMd += `---\n\n## Summary of Test Execution Across All 6 Prototype Cases\n\n`;

  for (let groupIdx = 0; groupIdx < testGroups.length; groupIdx++) {
    const group = testGroups[groupIdx];
    console.log(`\n=================== PROCESSING (${groupIdx + 1}/${testGroups.length}): ${group.name} ===================`);

    await sleep(2000); // Pace API calls

    // STAGE 1: CALL VISION SCOUT (Supports single image or multi-image)
    console.log(`[Stage 1: Scout] Segmenting image(s) and estimating 15 base nutrients...`);
    const parts: any[] = [];
    for (const fileName of group.files) {
      const imagePath = path.join(protoDir, fileName);
      const imageBuffer = fs.readFileSync(imagePath);
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: imageBuffer.toString("base64"),
        },
      });
    }

    parts.push({
      text: group.userPrompt || "Identify all dishes in this image and provide full nutrient estimations with bounding boxes and ingredient lists.",
    });

    const scoutResponse = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: [
        {
          role: "user",
          parts: parts,
        },
      ],
      config: {
        systemInstruction: scoutSystemInstruction,
        responseMimeType: "application/json",
      },
    });

    const scoutRawText = scoutResponse.text || "{}";
    let scoutParsed: any = {};
    try {
      scoutParsed = JSON.parse(scoutRawText);
    } catch (e) {
      console.error(`Error parsing JSON for ${group.name}:`, e);
    }

    console.log(`[Stage 1: Scout] Identified ${scoutParsed.items?.length || 0} dish(es).`);

    // STAGE 2: DERIVATION ENGINE & BRAND DATABASE MATCHING
    console.log(`[Stage 2: Derivation Engine & Brand Matcher] Processing items...`);
    const processedDishes: any[] = [];
    const dishCoreKeyList: CoreKeyNutrients[] = [];
    const brandMatchWarnings: string[] = [];

    if (Array.isArray(scoutParsed.items)) {
      for (const item of scoutParsed.items) {
        let base: BaseNutrients = {
          calories: item.nutrients?.calories || 0,
          protein: item.nutrients?.protein || 0,
          totalFat: item.nutrients?.totalFat || 0,
          saturatedFat: item.nutrients?.saturatedFat || 0,
          transFat: item.nutrients?.transFat || 0,
          addedSugar: item.nutrients?.addedSugar || 0,
          totalSugar: item.nutrients?.totalSugar || 0,
          totalFibre: item.nutrients?.totalFibre || 0,
          sodium: item.nutrients?.sodium || 0,
          potassium: item.nutrients?.potassium || 0,
          omega3: item.nutrients?.omega3 || 0,
          calcium: item.nutrients?.calcium || 0,
          iron: item.nutrients?.iron || 0,
          magnesium: item.nutrients?.magnesium || 0,
          vitaminD: item.nutrients?.vitaminD || 0,
        };

        let chainName = item.chainName;

        // SIMULATED POST-SCOUT BRAND DATABASE MATCHING
        if (group.isYolkCase && (item.originalName?.toLowerCase().includes("panini") || item.originalName?.toLowerCase().includes("wrap"))) {
          chainName = "Yolk (Official Brand DB)";
          const visualCal = base.calories;
          // Official Yolk Brand Entry replacement values
          base.calories = 680;
          base.protein = 45;
          base.totalFat = 28;
          base.saturatedFat = 9;
          base.sodium = 1180;

          const warnMsg = `[BRAND DATABASE MATCH APPLIED]: Dish "${item.originalName}" matched to official Yolk Brand Database entry. Initial Scout visual estimate (${visualCal} kcal) was REPLACED with official Yolk verified brand data (680 kcal, 45g Protein, 28g Total Fat, 9g Saturated Fat, 1180mg Sodium). Please review the total meal analysis in light of this brand replacement, highlight the change in your narrative, and update extended micronutrients as needed.`;
          brandMatchWarnings.push(warnMsg);
          console.log(`[Brand Database Matcher] ${warnMsg}`);
        }

        const computedCoreKey = computeDishCoreKeyNutrients(base);
        dishCoreKeyList.push(computedCoreKey);

        processedDishes.push({
          originalName: item.originalName,
          chainName: chainName,
          estimatedWeightGrams: item.estimatedWeightGrams,
          cookingMethod: item.cookingMethod,
          ingredients: item.ingredients,
          boundingBox2D: Array.isArray(item.boundingBox2D) ? item.boundingBox2D.flat() : item.boundingBox2D,
          sourceImageIndex: item.sourceImageIndex,
          itemConfidence: item.itemConfidence,
          computedCoreKeyNutrients: computedCoreKey,
        });
      }
    }

    const aggregatedCoreKey = aggregateDishNutrients(dishCoreKeyList);

    // STAGE 3: DIETITIAN AGENT
    console.log(`[Stage 3: Dietitian Agent] Reviewing accuracy & estimating extended meal nutrients...`);
    const dietitianResult = await runDietitianAgent({
      scoutDishes: processedDishes,
      aggregatedCoreKeyNutrients: aggregatedCoreKey,
      brandMatchWarnings: brandMatchWarnings,
      userBiomarkers: [
        "Prediabetes / Elevated Fasting Glucose",
        "Elevated LDL Cholesterol (145 mg/dL)",
        "Mild Hypertension (132/85 mmHg)",
      ],
      userPrompt: group.userPrompt,
    });

    console.log(`[Stage 3: Dietitian Agent] Verdict: "${dietitianResult.verdict?.label}" (${dietitianResult.verdict?.level})`);

    // BUILD CASE REPORT
    let caseMd = `# End-to-End Pipeline Report: ${group.name}\n\n`;
    caseMd += `**Generated At:** ${new Date().toISOString()}\n`;
    caseMd += `**File(s):** \`${group.files.join(", ")}\` | **Content Type:** \`${scoutParsed.contentType || "visual"}\` | **Environment:** \`${scoutParsed.diningEnvironment || "unknown"}\`\n\n`;

    caseMd += `### 1. User Input Context & Active Clinical Biomarker Profile\n`;
    caseMd += `- **User Prompt:** "${group.userPrompt || "N/A"}"\n`;
    caseMd += `- **Active Clinical Biomarkers:**\n`;
    caseMd += `  - Prediabetes / Elevated Fasting Glucose\n`;
    caseMd += `  - Elevated LDL Cholesterol (145 mg/dL)\n`;
    caseMd += `  - Mild Hypertension (132/85 mmHg)\n`;
    caseMd += `- **Daily Reference Targets:** 2,000 kcal | 100g Protein | 15g Sat Fat | 2,000mg Sodium | 24g Added Sugar | 30g Fibre\n\n`;

    caseMd += `### 2. Active Agent Pipeline Architecture & System Instructions\n\n`;
    caseMd += `<details><summary>Click to expand Stage 1: Vision Scout Agent System Instruction & Schema</summary>\n\n\`\`\`typescript\n${scoutSystemInstruction.trim()}\n\`\`\`\n</details>\n\n`;
    caseMd += `<details><summary>Click to expand Stage 2: Derivation Engine Formulas & Math</summary>\n\n\`\`\`typescript\n`;
    caseMd += `// Derived Core & Key Nutrient Formulas:\n`;
    caseMd += `// - Carbohydrates (g) = Math.max(0, (Calories - (4 * Protein) - (9 * TotalFat)) / 4)\n`;
    caseMd += `// - Unsaturated Fat (g) = Math.max(0, TotalFat - (SaturatedFat + TransFat))\n`;
    caseMd += `// - Salt (g) = (Sodium in mg * 2.54) / 1000\n`;
    caseMd += `\`\`\`\n</details>\n\n`;
    caseMd += `<details><summary>Click to expand Stage 3: Dietitian Clinical Coach Agent System Instruction & Schema</summary>\n\n\`\`\`typescript\n${dietitianSystemInstruction.trim()}\n\`\`\`\n</details>\n\n`;

    caseMd += `---\n\n### 3. Stage 1 Output: Vision Scout Analysis & Dish Detection\n`;
    caseMd += `**Scout Internal Reasoning:**\n> ${scoutParsed._internalReasoning || "N/A"}\n\n`;

    caseMd += `#### Discovered Dishes & Per-Dish Core + Key Nutrients\n\n`;
    processedDishes.forEach((d: any, idx: number) => {
      const ck = d.computedCoreKeyNutrients;
      const bbox = Array.isArray(d.boundingBox2D) ? `[${d.boundingBox2D.join(", ")}]` : "N/A";
      const ings = Array.isArray(d.ingredients) ? d.ingredients.join(", ") : "N/A";

      caseMd += `##### Dish ${idx + 1}: ${d.originalName || "Unnamed Dish"} (${d.estimatedWeightGrams || 0}g) [Image ${d.sourceImageIndex ?? 1}]\n`;
      caseMd += `- **Brand / Chain:** ${d.chainName || "Unbranded"}\n`;
      caseMd += `- **Cooking Method:** ${d.cookingMethod || "N/A"}\n`;
      caseMd += `- **Bounding Box:** \`${bbox}\`\n`;
      caseMd += `- **Ingredients:** ${ings}\n`;
      caseMd += `- **Core Nutrients:** ${ck.calories} kcal | ${ck.protein}g Protein | **${ck.carbohydrates}g Carbs [Derived]** | ${ck.totalFat}g Fat | ${ck.saturatedFat}g Sat Fat | ${ck.transFat}g Trans Fat | ${ck.addedSugar}g Added Sugar | ${ck.totalFibre}g Fibre | ${ck.sodium}mg Sodium\n`;
      caseMd += `- **Key Nutrients:** ${ck.totalSugar}g Total Sugar | **${ck.unsaturatedFat}g Unsat Fat [Derived]** | **${ck.salt}g Salt [Derived]** | ${ck.potassium}mg Potassium | ${ck.omega3}g Omega-3 | ${ck.calcium}mg Calcium | ${ck.iron}mg Iron | ${ck.magnesium}mg Magnesium | ${ck.vitaminD}mcg Vit D\n\n`;
    });

    caseMd += `### 4. Stage 2 Output: Derivation Engine & Brand Database Matcher\n`;
    if (brandMatchWarnings.length > 0) {
      caseMd += `> ⚠️ **Brand Database Replacement Notice:**\n`;
      brandMatchWarnings.forEach((w) => {
        caseMd += `> - ${w}\n`;
      });
      caseMd += `\n`;
    }

    caseMd += `| Nutrient Category | Nutrient | Value |\n`;
    caseMd += `| :--- | :--- | :--- |\n`;
    caseMd += `| **Core (High Precision)** | Calories | ${aggregatedCoreKey.calories} kcal |\n`;
    caseMd += `| **Core (High Precision)** | Protein | ${aggregatedCoreKey.protein} g |\n`;
    caseMd += `| **Core (High Precision)** | Saturated Fat | ${aggregatedCoreKey.saturatedFat} g |\n`;
    caseMd += `| **Core (High Precision)** | Trans Fat | ${aggregatedCoreKey.transFat} g |\n`;
    caseMd += `| **Core (High Precision)** | Added Sugar | ${aggregatedCoreKey.addedSugar} g |\n`;
    caseMd += `| **Core (High Precision)** | Total Fibre | ${aggregatedCoreKey.totalFibre} g |\n`;
    caseMd += `| **Core (High Precision)** | Sodium | ${aggregatedCoreKey.sodium} mg |\n`;
    caseMd += `| **Core (Derived)** | **Carbohydrates** | **${aggregatedCoreKey.carbohydrates} g** |\n`;
    caseMd += `| **Key (Moderate Precision)** | Total Fat | ${aggregatedCoreKey.totalFat} g |\n`;
    caseMd += `| **Key (Moderate Precision)** | Total Sugar | ${aggregatedCoreKey.totalSugar} g |\n`;
    caseMd += `| **Key (Moderate Precision)** | Potassium | ${aggregatedCoreKey.potassium} mg |\n`;
    caseMd += `| **Key (Moderate Precision)** | Omega-3 | ${aggregatedCoreKey.omega3} g |\n`;
    caseMd += `| **Key (Moderate Precision)** | Calcium | ${aggregatedCoreKey.calcium} mg |\n`;
    caseMd += `| **Key (Moderate Precision)** | Iron | ${aggregatedCoreKey.iron} mg |\n`;
    caseMd += `| **Key (Moderate Precision)** | Magnesium | ${aggregatedCoreKey.magnesium} mg |\n`;
    caseMd += `| **Key (Moderate Precision)** | Vitamin D | ${aggregatedCoreKey.vitaminD} mcg |\n`;
    caseMd += `| **Key (Derived)** | **Unsaturated Fat** | **${aggregatedCoreKey.unsaturatedFat} g** |\n`;
    caseMd += `| **Key (Derived)** | **Salt** | **${aggregatedCoreKey.salt} g** |\n\n`;

    caseMd += `### 5. Stage 3 Output: Dietitian Clinical Coach Review & Extended Micronutrients\n`;
    caseMd += `- **Verdict:** **${dietitianResult.verdict?.label}** (Level: \`${dietitianResult.verdict?.level}\`)\n`;
    caseMd += `- **Dietitian Message (4-Beat Narrative):**\n  > ${dietitianResult.message}\n`;
    caseMd += `- **Accuracy Review Status:** ${dietitianResult.accuracyReview?.isCorrected ? "⚠️ **Corrected by Dietitian**" : "✅ **Scout Estimates Approved (No Correction Needed)**"}\n`;
    if (dietitianResult.accuracyReview?.isCorrected) {
      caseMd += `  - **Correction Rationale:** ${dietitianResult.accuracyReview?.correctionNotes || "N/A"}\n`;
      caseMd += `  - **Adjusted Nutrients:** \`\`\`json\n${JSON.stringify(dietitianResult.accuracyReview?.correctedMealNutrients, null, 2)}\n\`\`\`\n`;
    }

    caseMd += `\n##### Aggregate Extended Nutrients (Filled by Dietitian):\n`;
    caseMd += `| Extended Nutrient (Directional Precision <50%) | Value |\n`;
    caseMd += `| :--- | :--- |\n`;
    const ext = dietitianResult.extendedMealNutrients || ({} as any);
    caseMd += `| **Soluble Fibre** | ${ext.solubleFibre ?? "N/A"} g |\n`;
    caseMd += `| **Vitamin A** | ${ext.vitaminA ?? "N/A"} mcg |\n`;
    caseMd += `| **Thiamine (B1)** | ${ext.thiamine ?? "N/A"} mg |\n`;
    caseMd += `| **Riboflavin (B2)** | ${ext.riboflavin ?? "N/A"} mg |\n`;
    caseMd += `| **Niacin (B3)** | ${ext.niacin ?? "N/A"} mg |\n`;
    caseMd += `| **Vitamin B6** | ${ext.vitaminB6 ?? "N/A"} mg |\n`;
    caseMd += `| **Folate (B9)** | ${ext.folate ?? "N/A"} mcg |\n`;
    caseMd += `| **Vitamin B12** | ${ext.vitaminB12 ?? "N/A"} mcg |\n`;
    caseMd += `| **Vitamin C** | ${ext.vitaminC ?? "N/A"} mg |\n`;
    caseMd += `| **Vitamin E** | ${ext.vitaminE ?? "N/A"} mg |\n`;
    caseMd += `| **Vitamin K** | ${ext.vitaminK ?? "N/A"} mcg |\n`;
    caseMd += `| **Zinc** | ${ext.zinc ?? "N/A"} mg |\n`;
    caseMd += `| **Selenium** | ${ext.selenium ?? "N/A"} mcg |\n`;
    caseMd += `| **Iodine** | ${ext.iodine ?? "N/A"} mcg |\n`;
    caseMd += `| **Phosphorus** | ${ext.phosphorus ?? "N/A"} mg |\n\n`;

    caseMd += `#### Raw Payloads & JSON Output\n`;
    caseMd += `<details><summary>Click to expand Raw Scout JSON</summary>\n\n\`\`\`json\n${JSON.stringify(scoutParsed, null, 2)}\n\`\`\`\n</details>\n\n`;
    caseMd += `<details><summary>Click to expand Raw Dietitian JSON</summary>\n\n\`\`\`json\n${JSON.stringify(dietitianResult, null, 2)}\n\`\`\`\n</details>\n\n`;

    // Save individual report
    fs.writeFileSync(path.join(protoDir, group.reportFileName), caseMd);
    console.log(`Saved individual End-to-End report: prototype/${group.reportFileName}`);

    masterMd += `### Case ${groupIdx + 1}: \`${group.name}\`\n\n` + caseMd.replace(`# End-to-End Pipeline Report: ${group.name}\n\n`, "") + `---\n\n`;
  }

  const reportPath = path.join(protoDir, "END_TO_END_REPORT.md");
  fs.writeFileSync(reportPath, masterMd);
  console.log(`\n=================== SUCCESS ===================`);
  console.log(`Master End-to-End Report generated at: ${reportPath}`);
}

runEndToEndPipeline().catch((err) => {
  console.error("Fatal Error running end-to-end pipeline:", err);
  process.exit(1);
});
