import { GoogleGenAI, Type } from "@google/genai";
import {
  buildHealthCoachSystemInstruction,
  buildHealthCoachPromptText,
} from "./coach_instruction.ts";
import type { HealthCoachOutput } from "./coach_schema.ts";
import type { HandoffPayload } from "./schema.ts";

/**
 * Health Coach Analysis Schema
 * Direct replica of healthBaselineAnalyzeSchema from server_routes_medical_gemini.ts
 */
export const healthBaselineAnalyzeSchema = {
  type: Type.OBJECT,
  properties: {
    report: {
      type: Type.OBJECT,
      properties: {
        timelineToOptimal: {
          type: Type.STRING,
          description:
            "The overall hard physiological timeline paired with user-perception benchmarks (e.g., sleep depth, waist trimming, puffiness reduction).",
        },
        riskCategories: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              categoryName: { type: Type.STRING },
              level: {
                type: Type.STRING,
                enum: ["Low", "Moderate", "Elevated", "High"],
              },
              targetTrajectory: {
                type: Type.STRING,
                description:
                  "Explains the concrete physical value of getting these specific biomarkers to target, what physical signs will improve, and the timeline speed for this specific category.",
              },
              nutrientTargets: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    nutrientKey: { type: Type.STRING },
                    targetValue: {
                      type: Type.STRING,
                      description:
                        "Must be a direct computed amount (e.g., '90g' or '< 20g'), NOT a formula like '1.2g per kg of body weight'.",
                    },
                    rationale: {
                      type: Type.STRING,
                      description:
                        "Mechanistic and precise explanation of why this target/amount was chosen.",
                    },
                  },
                  required: ["nutrientKey", "targetValue", "rationale"],
                },
              },
              dailyActivities: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    activity: { type: Type.STRING },
                    target: { type: Type.STRING },
                  },
                  required: ["activity", "target"],
                },
                description:
                  "Precise, time-bound behavioral or physical rules to implement daily.",
              },
            },
            required: [
              "categoryName",
              "level",
              "targetTrajectory",
              "nutrientTargets",
              "dailyActivities",
            ],
          },
        },
        topNutrientTargets: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              nutrientKey: { type: Type.STRING },
              targetValue: { type: Type.STRING },
              rationale: { type: Type.STRING },
            },
            required: ["nutrientKey", "targetValue", "rationale"],
          },
          description:
            "Top 3-6 core nutrients that the user has to focus the most on.",
        },
        topWeeklyNutrientTargets: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              nutrientKey: { type: Type.STRING },
              targetValue: { type: Type.STRING },
              rationale: { type: Type.STRING },
            },
            required: ["nutrientKey", "targetValue", "rationale"],
          },
          description:
            "Top 3-6 additional/micronutrients that the user has to focus the most on.",
        },
        generalNutrientTargets: {
          type: Type.OBJECT,
          description:
            "A flat map containing all 31 available nutrient keys populated with precise formatted values.",
          properties: {
            calories: { type: Type.STRING },
            totalFat: { type: Type.STRING },
            solubleFibre: { type: Type.STRING },
            saturatedFat: { type: Type.STRING },
            protein: { type: Type.STRING },
            potassium: { type: Type.STRING },
            transFat: { type: Type.STRING },
            addedSugar: { type: Type.STRING },
            carbohydrates: { type: Type.STRING },
            totalFibre: { type: Type.STRING },
            sodium: { type: Type.STRING },
            unsaturatedFat: { type: Type.STRING },
            omega3: { type: Type.STRING },
            magnesium: { type: Type.STRING },
            calcium: { type: Type.STRING },
            iron: { type: Type.STRING },
            zinc: { type: Type.STRING },
            selenium: { type: Type.STRING },
            iodine: { type: Type.STRING },
            phosphorus: { type: Type.STRING },
            vitaminD: { type: Type.STRING },
            vitaminB12: { type: Type.STRING },
            folate: { type: Type.STRING },
            vitaminC: { type: Type.STRING },
            vitaminE: { type: Type.STRING },
            vitaminK: { type: Type.STRING },
            vitaminA: { type: Type.STRING },
            vitaminB6: { type: Type.STRING },
            thiamine: { type: Type.STRING },
            riboflavin: { type: Type.STRING },
            niacin: { type: Type.STRING },
          },
          required: [
            "calories",
            "totalFat",
            "solubleFibre",
            "saturatedFat",
            "protein",
            "potassium",
            "transFat",
            "addedSugar",
            "carbohydrates",
            "totalFibre",
            "sodium",
            "unsaturatedFat",
            "omega3",
            "magnesium",
            "calcium",
            "iron",
            "zinc",
            "selenium",
            "iodine",
            "phosphorus",
            "vitaminD",
            "vitaminB12",
            "folate",
            "vitaminC",
            "vitaminE",
            "vitaminK",
            "vitaminA",
            "vitaminB6",
            "thiamine",
            "riboflavin",
            "niacin",
          ],
        },
      },
      required: [
        "timelineToOptimal",
        "riskCategories",
        "topNutrientTargets",
        "topWeeklyNutrientTargets",
        "generalNutrientTargets",
      ],
    },
  },
  required: ["report"],
};

export function formatHealthCoachInput(payload: HandoffPayload): {
  profileText: string;
  biomarkerOrGoalSummary: string;
} {
  const profile = (payload as any).consolidatedUserProfile || {};
  const profileText = `UserProfile: Age ${profile.age || "32"}, Ethnicity: ${profile.ethnicity || "Not provided"}, Weight: ${profile.weightKg || profile.weight || "92"}kg, Height: ${profile.heightCm || profile.height || "180"}cm, Gender: ${profile.gender || "male"}, Blood Type: ${profile.bloodType || "Not provided"}.`;

  const insights = payload.actionableInsights || [];
  const biomarkerOrGoalSummary = [
    `Primary Health Intent: ${payload.intent}`,
    `Summary from Receptionist: ${payload.summaryForAgent}`,
    ...(insights.length > 0
      ? [`Key Clinical Insights:`, ...insights.map((i) => `  - ${i}`)]
      : []),
    ...(payload.recommendedTasks && payload.recommendedTasks.length > 0
      ? [
          `Current Task & Habit State:`,
          ...payload.recommendedTasks.map(
            (t) => `  - [${t.status}] ${t.title}: ${t.details}`
          ),
        ]
      : []),
  ].join("\n");

  return { profileText, biomarkerOrGoalSummary };
}

export async function callCoachAgent(
  ai: GoogleGenAI,
  handoffPayload: HandoffPayload,
  modelName = "gemini-3.5-flash-lite"
): Promise<{ output: HealthCoachOutput; raw: string; ms: number }> {
  const { profileText, biomarkerOrGoalSummary } =
    formatHealthCoachInput(handoffPayload);
  const promptText = buildHealthCoachPromptText(
    profileText,
    biomarkerOrGoalSummary
  );
  const systemInstruction = buildHealthCoachSystemInstruction();
  const started = Date.now();
  let response: any;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const callPromise = ai.models.generateContent({
        model: modelName,
        contents: [{ text: promptText }],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: healthBaselineAnalyzeSchema as any,
          temperature: 0.1,
        },
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Health Coach request timeout after 45s")),
          45000
        )
      );

      response = await Promise.race([callPromise, timeoutPromise]);
      break;
    } catch (err: any) {
      if (attempt === 3) throw err;
      console.warn(
        `[callCoachAgent] Attempt ${attempt} failed (${err?.message || err}), retrying in 2s...`
      );
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const raw = response.text || "{}";
  const output = JSON.parse(raw) as HealthCoachOutput;
  return { output, raw, ms: Date.now() - started };
}
