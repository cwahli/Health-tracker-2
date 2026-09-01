import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error("ERROR: GEMINI_API_KEY is not set.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const imagesDir = path.join(process.cwd(), "prototype", "meallog", "images");

async function auditOCR(caseId: number, imageFiles: string[], description: string) {
  console.log(`\n==========================================================================================`);
  console.log(`DEEP OCR AUDIT FOR CASE ${caseId}: ${description}`);
  console.log(`==========================================================================================`);

  const parts: any[] = [];
  for (const fn of imageFiles) {
    const imgPath = path.join(imagesDir, fn);
    if (fs.existsSync(imgPath)) {
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: fs.readFileSync(imgPath).toString("base64"),
        },
      });
    }
  }

  parts.push({
    text: `Your task is a strict 100% precision OCR extraction. Transcribe EVERY visible piece of text, barcode digit, price sticker number, gram weight, line-item description, ingredient list, and nutrition facts table cell EXACTLY as printed in the image(s). Do not guess or interpolate. Format as a structured JSON object containing:
1. "rawTextExtracted": Array of exact string transcriptions per image.
2. "lineItems": Array of objects with { "printedText": string, "extractedGrams": number | null, "extractedPrice": string | null, "itemCodeOrBarcode": string | null }.
3. "nutritionFactsTable": Object with exact printed numbers per 100g / per serving if a nutrition label is present.
4. "potentialAmbiguitiesOrFailures": Array of strings noting any cropped, blurry, distorted, or low-contrast text that could cause character misreads.`,
  });

  const res = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: [{ role: "user", parts }],
    config: {
      temperature: 0.0,
      responseMimeType: "application/json",
    },
  });

  console.log(res.text);
}

async function runAudit() {
  await auditOCR(8, ["08_rolled_oats_1.jpg", "08_rolled_oats_2.jpg"], "Sunrise Rolled Oats Nutrition Facts");
  await new Promise((r) => setTimeout(r, 5000));
  await auditOCR(10, ["10_beef_soup_barcode_meal_0.jpg", "10_beef_soup_barcode_meal_1.jpg"], "Indonesian Price Stickers & Barcodes");
  await new Promise((r) => setTimeout(r, 5000));
  await auditOCR(11, ["11_seafood_squid_fish_ingredients.jpg", "11_seafood_squid_fish_receipt_1.jpg", "11_seafood_squid_fish_receipt_2.jpg"], "Thermal Receipt OCR");
  await new Promise((r) => setTimeout(r, 5000));
  await auditOCR(6, ["06_indonesian_menu_page_1.jpg", "06_indonesian_menu_page_2.jpg"], "Mie Gacoan Menu Page OCR");
}

runAudit();
