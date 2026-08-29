import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { scoutSystemInstruction } from "./server_vision_scout.ts";

dotenv.config();

function generateMarkdownReport(imageName: string, parsed: any): string {
  let mdContent = `# Vision Scout Report: ${imageName}\n\n`;
  mdContent += `**Timestamp:** ${new Date().toISOString()}\n`;
  mdContent += `**Image File:** \`prototype/${imageName}\`\n`;
  mdContent += `**Model:** \`gemini-3.5-flash-lite\`\n\n`;
  mdContent += `## Content Type & Dining Environment\n`;
  mdContent += `- **Content Type:** \`${parsed.contentType || "N/A"}\`\n`;
  mdContent += `- **Dining Environment:** \`${parsed.diningEnvironment || "N/A"}\`\n\n`;
  mdContent += `## Internal Reasoning\n> ${parsed._internalReasoning || "N/A"}\n\n`;
  mdContent += `## Identified Items & Direct Nutrient Profile\n\n`;

  if (Array.isArray(parsed.items) && parsed.items.length > 0) {
    parsed.items.forEach((item: any, idx: number) => {
      const n = item.nutrients || {};
      const bbox = Array.isArray(item.boundingBox2D) ? `[${item.boundingBox2D.join(", ")}]` : "N/A";
      const ings = Array.isArray(item.ingredients) ? item.ingredients.join(", ") : "N/A";

      mdContent += `### Dish ${idx + 1}: ${item.originalName || "Unnamed Dish"}\n`;
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
  const files = fs.readdirSync(protoDir).filter((f) => f.endsWith(".jpg"));

  console.log(`Found ${files.length} image(s) to test in prototype folder: ${files.join(", ")}`);

  for (const file of files) {
    const imagePath = path.join(protoDir, file);
    console.log(`\n=================== PROCESSING: ${file} ===================`);
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Data = imageBuffer.toString("base64");

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Data,
              },
            },
            {
              text: "Identify all dishes in this image and provide full nutrient estimations with bounding boxes and ingredient lists.",
            },
          ],
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
      console.log(`Successfully parsed output for ${file}. Items detected: ${parsed.items?.length ?? 0}`);
    } catch (err) {
      console.error(`Failed to parse JSON for ${file}:`, err);
    }

    const reportFileName = `REPORT_${path.basename(file, ".jpg")}.md`;
    const reportPath = path.join(protoDir, reportFileName);
    const mdContent = generateMarkdownReport(file, parsed);
    fs.writeFileSync(reportPath, mdContent);
    console.log(`Report generated: ${reportPath}`);
  }

  console.log("\nAll images processed successfully!");
}

runScoutTestAll().catch((err) => {
  console.error("Error running scout tests:", err);
  process.exit(1);
});

