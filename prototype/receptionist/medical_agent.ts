import fs from "fs";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import type { HandoffPayload } from "./schema.ts";

export interface ExtractedBiomarkerItem {
  biomarker: string;
  display_name?: string | null;
  date?: string | null;
  numeric_value?: number | null;
  qualitative_value?: string | null;
  unit?: string | null;
  explanation?: string | null;
}

export interface MedicalExtractOutput {
  extractedData: ExtractedBiomarkerItem[];
  unmappedTests?: Array<{
    raw_name: string;
    suggested_key: string;
    numeric_value?: number | null;
    unit?: string | null;
  }>;
  text: string;
  hasMoreMarkers: boolean;
  estimatedTotalMarkers: number;
}

export const medicalExtractSchema = {
  type: Type.OBJECT,
  properties: {
    extractedData: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          biomarker: { type: Type.STRING },
          display_name: { type: Type.STRING, nullable: true },
          date: { type: Type.STRING, nullable: true },
          numeric_value: { type: Type.NUMBER, nullable: true },
          qualitative_value: { type: Type.STRING, nullable: true },
          unit: { type: Type.STRING, nullable: true },
          explanation: { type: Type.STRING, nullable: true },
        },
        required: ["biomarker"],
      },
    },
    text: { type: Type.STRING },
    hasMoreMarkers: { type: Type.BOOLEAN },
    estimatedTotalMarkers: { type: Type.INTEGER },
  },
  required: ["extractedData", "text", "hasMoreMarkers", "estimatedTotalMarkers"],
};

export function buildMedicalExtractInstruction(): string {
  return `You are the Expert Clinical Lab Parser and Medical Extraction Specialist.
Your primary role is to parse incoming complex clinical lab reports, blood panels, and medical logs lossless-ly into structured biomarker entries.

RULES:
1. Lossless Math & Units: Extract the exact numerical value and exact unit provided.
2. Standard Nomenclature: Map each clinical test to its standard snake_case key (e.g., total_cholesterol, ldl_cholesterol, hdl_cholesterol, triglycerides, fasting_glucose, hba1c, alt, ast, egfr, creatinine, hs_crp).
3. Calibration Context: Provide a clear clinical confirmation explaining how these lab entries integrate with the user's clinical profile and cardiovascular risk history.

Your response must be valid JSON matching the medicalExtractSchema.`;
}

export async function callMedicalAgent(
  ai: GoogleGenAI,
  handoffPayload: HandoffPayload,
  modelName = "gemini-3.5-flash-lite"
): Promise<{ output: MedicalExtractOutput; raw: string; ms: number }> {
  const promptText = `Parse and extract all clinical biomarkers from this handoff payload:
Summary: ${handoffPayload.summaryForAgent}
Insights: ${(handoffPayload.actionableInsights || []).join("; ")}
Tasks: ${JSON.stringify(handoffPayload.recommendedTasks || [])}`;

  const contentParts: any[] = [{ text: promptText }];

  if (handoffPayload.images && Array.isArray(handoffPayload.images) && handoffPayload.images.length > 0) {
    for (const img of handoffPayload.images) {
      if (typeof img === "string") {
        const resolvedPath = path.isAbsolute(img) ? img : path.resolve(process.cwd(), img);
        try {
          if (fs.existsSync(resolvedPath)) {
            const buf = fs.readFileSync(resolvedPath);
            contentParts.push({
              inlineData: {
                mimeType: "image/png",
                data: buf.toString("base64"),
              },
            });
            continue;
          }
        } catch {}

        const match = img.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          contentParts.push({
            inlineData: {
              mimeType: match[1],
              data: match[2],
            },
          });
        }
      }
    }
  }

  const started = Date.now();
  const response = await ai.models.generateContent({
    model: modelName,
    contents: contentParts,
    config: {
      systemInstruction: buildMedicalExtractInstruction(),
      responseMimeType: "application/json",
      responseSchema: medicalExtractSchema,
      temperature: 0.2,
      maxOutputTokens: 8192,
    },
  });

  const durationMs = Date.now() - started;
  const rawText = response.text || "{}";
  let output: MedicalExtractOutput;
  try {
    output = JSON.parse(rawText);
  } catch (err) {
    output = {
      extractedData: [],
      text: "Error parsing medical extractor output",
      hasMoreMarkers: false,
      estimatedTotalMarkers: 0,
    };
  }

  return { output, raw: rawText, ms: durationMs };
}
