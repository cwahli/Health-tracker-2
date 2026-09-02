import fs from "fs";
import { GoogleGenAI, Type } from "@google/genai";
import type { IntakeRow } from "./schema.ts";

export async function parseLabImages(
  ai: GoogleGenAI,
  imagePaths: string[]
): Promise<IntakeRow[]> {
  const schema = {
    type: Type.OBJECT,
    properties: {
      rows: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            printed: { type: Type.STRING },
            value: { type: Type.NUMBER },
            unit: { type: Type.STRING },
            date: { type: Type.STRING },
            printedRange: { type: Type.STRING }
          },
          required: ["printed", "value", "unit", "date"]
        }
      }
    },
    required: ["rows"]
  };

  const parts: any[] = [
    "Extract all lab results from these medical records. Pay close attention to dates - some panels might have been taken on different dates (e.g. 03-Jun vs 05-Jun). Use YYYY-MM-DD for dates. Keep the exact printed name (e.g. 'HbA1c levl'). For ranges, extract the printed range exactly as shown."
  ];

  for (const p of imagePaths) {
    const data = fs.readFileSync(p).toString("base64");
    parts.push({
      inlineData: {
        data,
        mimeType: "image/png"
      }
    });
  }

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite", // could be gemini-2.5-flash
    contents: parts,
    config: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0.1
    }
  });

  const raw = response.text;
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  
  return (parsed.rows || []).map((r: any, i: number) => ({
    ...r,
    id: `img_${i + 1}`,
  }));
}
