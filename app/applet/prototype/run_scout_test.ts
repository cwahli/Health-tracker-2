import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { scoutSystemInstruction } from "./server_vision_scout";

dotenv.config();

interface TestGroup {
  name: string;
  reportFileName: string;
  files: string[];
  prompt: string;
}

function generateMarkdownReport(group: TestGroup, parsed: any): string {
  let mdContent = `# Vision Scout Report: ${group.name}\n\n`;
  mdContent += `**Timestamp:** ${new Date().toISOString()}\n`;
  mdContent += `**Image File(s):** \`${group.files.map((f) => `prototype/${f}`).join(", ")}\`\n`;
  mdContent += `**Model:** \`gemini-3.5-flash-lite\`\n\n`;

  mdContent += `## Content Type & Dining Environment\n`;
  mdContent += `- **Content Type:** \`${parsed.contentType || "N/A"}\`\n`;
  mdContent += `- **Dining Environment:** \`${parsed.diningEnvironment || "N/A"}\`\n\n`;

  mdContent += `## Internal Reasoning\n> ${parsed._internalReasoning || "N/A"}\n\n`;

  mdContent += `## Identified Items & Direct Nutrient Profile\n\n`;

  if (Array.isArray(parsed.items) && parsed.items.length > 0) {
    parsed.items.forEach((item: any, idx: number) => {
      const n = item.nutrients || {};
      const bbox = Array.isArray(item.boundingBox2D) ? `[${item.boundingBox2D.flat().join(", ")}]` : "N/A";
      const ings = Array.isArray(item.ingredients) ? item.ingredients.join(", ") : "N/A";

      mdContent += `### Dish ${idx + 1}: ${item.originalName || "Unnamed Dish"}\n`;
      mdContent += `- **Source Image Index:** ${item.sourceImageIndex ?? 0}\n`;
      mdContent += `- **Chain / Brand:** ${item.chainName || "None (Unbranded)"}\n`;
      mdContent += `- **Estimated Weight:** ${item.estimatedWeightGrams || "N/A"}g\n`;
      mdContent += `- **Cooking Method:** ${item.cookingMethod || "N/A"}\n`;
      mdContent += `- **Bounding Box [ymin, xmin, ymax, xmax]:** \`${bbox}\`\n`;
      mdContent += `- **Item Confidence:** ${item.itemConfidence || "N/A"}\n`;
      mdContent += `- **Detected Ingredients:** ${ings}\n\n`;

      mdContent += `#### Direct 15-Nutrient Breakdown:\n`;
      mdContent += `| Nutrient | Estimated Value |\n`;
      mdContent += `| :--- | :--- |\n`;
      mdContent += `| **Calories** | ${n.calories ?? "N/A"} kcal |\n`;
      mdContent += `| **Protein** | ${n.protein ?? "N/A"} g |\n`;
      mdContent += `| **Saturated Fat** | ${n.saturatedFat ?? "N/A"} g |\n`;
      mdContent += `| **Trans Fat** | ${n.transFat ?? "N/A"} g |\n`;
      mdContent += `| **Added Sugar** | ${n.addedSugar ?? "N/A"} g |\n`;
      mdContent += `| **Total Fibre** | ${n.totalFibre ?? "N/A"} g |\n`;
      mdContent += `| **Sodium** | ${n.sodium ?? "N/A"} mg |\n`;
      mdContent += `| **Total Fat** | ${n.totalFat ?? "N/A"} g |\n`;
      mdContent += `| **Total Sugar** | ${n.totalSugar ?? "N/A"} g |\n`;
      mdContent += `| **Potassium** | ${n.potassium ?? "N/A"} mg |\n`;
      mdContent += `| **Omega-3** | ${n.omega3 ?? "N/A"} g |\n`;
      mdContent += `| **Calcium** | ${n.calcium ?? "N/A"} mg |\n`;
      mdContent += `| **Iron** | ${n.iron ?? "N/A"} mg |\n`;
      mdContent += `| **Magnesium** | ${n.magnesium ?? "N/A"} mg |\n`;
      mdContent += `| **Vitamin D** | ${n.vitaminD ?? "N/A"} mcg |\n\n`;
    });
  } else {
    mdContent += `*No items detected.*\n\n`;
  }

  mdContent += `## Raw Scout JSON Output\n\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\`\n`;

  return mdContent;
}

async function runScoutTestAll() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("No GEMINI_API_KEY found!");
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });
  const protoDir = path.join(process.cwd(), "prototype");

  const testGroups: TestGroup[] = [
    {
      name: "01_yolk_panini_wrap.jpg",
      reportFileName: "SCOUT_REPORT_01_yolk_panini_wrap.md",
      files: ["01_yolk_panini_wrap.jpg"],
      prompt: "I had it from Yolk",
    },
    {
      name: "02_lidl_chicken_muffin.jpg",
      reportFileName: "SCOUT_REPORT_02_lidl_chicken_muffin.md",
      files: ["02_lidl_chicken_muffin.jpg"],
      prompt: "Scanning product package & muffin for afternoon snack.",
    },
    {
      name: "03_sushi_shrimp_salad.jpg",
      reportFileName: "SCOUT_REPORT_03_sushi_shrimp_salad.md",
      files: ["03_sushi_shrimp_salad.jpg"],
      prompt: "Identify all dishes in this image.",
    },
    {
      name: "04_seaside_fish_chips.jpg",
      reportFileName: "SCOUT_REPORT_04_seaside_fish_chips.md",
      files: ["04_seaside_fish_chips.jpg"],
      prompt: "Identify all dishes in this image.",
    },
    {
      name: "05_cafe_waffles_coffee.jpg",
      reportFileName: "SCOUT_REPORT_05_cafe_waffles_coffee.md",
      files: ["05_cafe_waffles_coffee.jpg"],
      prompt: "Identify all dishes in this image.",
    },
    {
      name: "06_indonesian_menu (Sambal Bakar Pencok 89)",
      reportFileName: "SCOUT_REPORT_06_indonesian_menu.md",
      files: ["06_indonesian_menu_page_1.jpg", "06_indonesian_menu_page_2.jpg"],
      prompt: "Extract distinct dishes across both Indonesian menu pages (Sambal Bakar Pencok 89) for multi-language evaluation.",
    },
  ];

  console.log(`Running Vision Scout tests for ${testGroups.length} test group(s)...`);

  for (const group of testGroups) {
    console.log(`\n=================== PROCESSING: ${group.name} ===================`);

    const parts: any[] = [];
    for (let i = 0; i < group.files.length; i++) {
      const fileName = group.files[i];
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
      text: group.prompt || "Identify all dishes in this image and provide full nutrient estimations with bounding boxes and ingredient lists.",
    });

    const response = await ai.models.generateContent({
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

    const responseText = response.text || "{}";
    let parsed: any = {};
    try {
      parsed = JSON.parse(responseText);
      console.log(`Successfully parsed output for ${group.name}. Items detected: ${parsed.items?.length ?? 0}`);
    } catch (err) {
      console.error(`Failed to parse JSON for ${group.name}:`, err);
    }

    const reportPath = path.join(protoDir, group.reportFileName);
    const mdContent = generateMarkdownReport(group, parsed);
    fs.writeFileSync(reportPath, mdContent);
    console.log(`Report generated: ${reportPath}`);
  }

  console.log("\nAll Scout test groups processed successfully!");
}

runScoutTestAll().catch((err) => {  console.error("Error running scout tests:", err);
  process.exit(1);
});
