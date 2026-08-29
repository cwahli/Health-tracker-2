import { z } from "zod";
import { GoogleGenAI } from "@google/genai";
import { CoreKeyNutrients } from "./derivation_engine";

export const ExtendedNutrientsSchema = z.object({
  solubleFibre: z.number().nonnegative(),
  vitaminA: z.number().nonnegative(),
  thiamine: z.number().nonnegative(),
  riboflavin: z.number().nonnegative(),
  niacin: z.number().nonnegative(),
  vitaminB6: z.number().nonnegative(),
  folate: z.number().nonnegative(),
  vitaminB12: z.number().nonnegative(),
  vitaminC: z.number().nonnegative(),
  vitaminE: z.number().nonnegative(),
  vitaminK: z.number().nonnegative(),
  zinc: z.number().nonnegative(),
  selenium: z.number().nonnegative(),
  iodine: z.number().nonnegative(),
  phosphorus: z.number().nonnegative(),
});

export const CorrectedNutrientsSchema = z.object({
  calories: z.number().optional(),
  protein: z.number().optional(),
  totalFat: z.number().optional(),
  saturatedFat: z.number().optional(),
  transFat: z.number().optional(),
  addedSugar: z.number().optional(),
  totalSugar: z.number().optional(),
  totalFibre: z.number().optional(),
  sodium: z.number().optional(),
  potassium: z.number().optional(),
  omega3: z.number().optional(),
  calcium: z.number().optional(),
  iron: z.number().optional(),
  magnesium: z.number().optional(),
  vitaminD: z.number().optional(),
}).partial();

export const DietitianOutputSchema = z.object({
  _internalReasoning: z.string(),
  verdict: z.object({
    label: z.string(),
    level: z.enum(["good", "warning", "alert", "neutral"]),
  }),
  message: z.string(),
  accuracyReview: z.object({
    isCorrected: z.boolean(),
    correctionNotes: z.string().nullable().optional(),
    correctedMealNutrients: CorrectedNutrientsSchema.nullable().optional(),
  }),
  extendedMealNutrients: ExtendedNutrientsSchema,
  mealSummary: z.object({
    title: z.string(),
    itemsSummary: z.array(
      z.object({
        scoutIndex: z.number(),
        name: z.string(),
        weightGrams: z.number(),
        foodType: z.string(),
        cookingMethod: z.string(),
      })
    ),
  }),
});

export type DietitianOutput = z.infer<typeof DietitianOutputSchema>;

export const dietitianSystemInstruction = `System Instruction:
You are an expert personalized AI Dietitian Coach operating within a clinical nutrition application.
Your goal is to evaluate scanned meal payloads, conduct an accuracy review of estimated meal nutrients, fill in extended micronutrients for the aggregate meal, and provide warm, highly actionable clinical advice grounded in user biomarkers.

=== GENERAL CLINICAL DIRECTIVES ===
1. VERDICT LABEL GUIDELINES (3-6 WORDS MAX):
   - Positive / Neutral: Core physical health outcome (e.g., "Good for heart and lean muscle").
   - Overage / Risk: Punchy, metric-backed impact label (e.g., "140% over sat fat limit").
   - BANNED: Vague descriptive sentences like "Elevates saturated fat and sodium limits". Keep it punchy and metric-backed.

2. MESSAGE NARRATIVE GUIDELINES (35-70 WORDS IN 4 BEATS):
   - Beat 1 (Primary Asset & Metric): Praise key nutrient asset with concrete metric (e.g. "You got 38g of quality protein and healthy omega-3s from the salmon.").
   - Beat 2 (Impact/Overage & Metric): Highlight overage/impact with concrete metric (e.g. "However, the cheesy pasta adds 18g of saturated fat, pushing today's total 140% over your daily limit.").
   - Beat 3 (Symptom-Based Physical Effect): Translate clinical terms into immediate physical sensations (e.g. "This heavy fat load causes physical sluggishness, digestive heaviness, and vascular stiffness.").
   - Beat 4 (Actionable Next Steps): Recommend direct habit or movement (e.g. "Take a 20-minute post-meal walk to boost circulation, and make your next meal rich in soluble fiber.").

3. SUGAR FRAMING:
   - Always distinguish Total Sugar (naturally occurring in fruit/dairy) from Added Sugar (24g/day limit). Never penalize whole fruit or plain dairy for natural sugar.

=== ACCURACY REVIEW & NUTRITIONAL CORRECTION ===
- You are provided with the Scout's identified dishes and the derivation engine's aggregated Core & Key nutrients for the total meal.
- If 'brandMatchWarnings' are present in the payload context, an official brand database match replaced the Scout's initial visual estimate with verified brand nutrition values (e.g. Yolk brand menu data).
- Perform a physiological sanity check on the aggregate totals:
  - Check caloric density relative to total weight and cooking oils.
  - Check sodium levels for cured/processed foods, dressings, or sauces.
  - Check saturated fat ratios for deep-fried, heavy dairy, or fatty meat dishes.
- If 'brandMatchWarnings' exist or if you identify a visual misestimate, acknowledge the brand data change / correction in 'correctionNotes', set 'accuracyReview.isCorrected' to true if further adjustments are needed, and ensure 'extendedMealNutrients' reflect the updated brand values.
- If the Scout's aggregate numbers are sound and no further corrections are needed, set 'accuracyReview.isCorrected' to false and 'accuracyReview.correctedMealNutrients' to null.

=== EXTENDED NUTRIENTS ESTIMATION (AGGREGATE MEAL LEVEL) ===
- Directly estimate the 15 Extended Nutrients for the AGGREGATE MEAL as a single complete set in 'extendedMealNutrients':
  1. Soluble Fibre (g)
  2. Vitamin A (mcg)
  3. Thiamine / B1 (mg)
  4. Riboflavin / B2 (mg)
  5. Niacin / B3 (mg)
  6. Vitamin B6 (mg)
  7. Folate / B9 (mcg)
  8. Vitamin B12 (mcg)
  9. Vitamin C (mg)
  10. Vitamin E (mg)
  11. Vitamin K (mcg)
  12. Zinc (mg)
  13. Selenium (mcg)
  14. Iodine (mcg)
  15. Phosphorus (mg)

=== OUTPUT JSON SCHEMA ===
Output exactly ONE JSON object matching this schema. Never wrap in markdown blocks.

{
  "_internalReasoning": "string",
  "verdict": {
    "label": "string",
    "level": "good | warning | alert | neutral"
  },
  "message": "string",
  "accuracyReview": {
    "isCorrected": false,
    "correctionNotes": "string | null",
    "correctedMealNutrients": null
  },
  "extendedMealNutrients": {
    "solubleFibre": 2.5,
    "vitaminA": 450,
    "thiamine": 0.35,
    "riboflavin": 0.42,
    "niacin": 5.8,
    "vitaminB6": 0.65,
    "folate": 85,
    "vitaminB12": 2.4,
    "vitaminC": 45,
    "vitaminE": 3.2,
    "vitaminK": 65,
    "zinc": 3.8,
    "selenium": 28.5,
    "iodine": 35,
    "phosphorus": 480
  },
  "mealSummary": {
    "title": "string",
    "itemsSummary": [
      {
        "scoutIndex": 0,
        "name": "string",
        "weightGrams": 200,
        "foodType": "string",
        "cookingMethod": "string"
      }
    ]
  }
}
`;

export async function runDietitianAgent(params: {
  scoutDishes: any[];
  aggregatedCoreKeyNutrients: CoreKeyNutrients;
  userBiomarkers?: string[];
  dailyTargets?: Record<string, number>;
  userPrompt?: string;
  brandMatchWarnings?: string[];
  apiKey?: string;
  modelName?: string;
}): Promise<DietitianOutput> {
  const apiKey = params.apiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const ai = new GoogleGenAI({ apiKey });
  const modelName = params.modelName || "gemini-3.5-flash-lite";

  const biomarkersStr = params.userBiomarkers?.length
    ? params.userBiomarkers.map((b) => `• ${b}`).join("\n")
    : "• Prediabetes / Elevated Fasting Glucose\n• Borderline High LDL Cholesterol";

  const targetsStr = params.dailyTargets
    ? JSON.stringify(params.dailyTargets, null, 2)
    : JSON.stringify(
        {
          calories: 2000,
          protein: 100,
          saturatedFat: 15,
          sodium: 2000,
          addedSugar: 24,
          totalFibre: 30,
        },
        null,
        2
      );

  const payloadContext = {
    scoutDishes: params.scoutDishes,
    aggregatedCoreKeyNutrients: params.aggregatedCoreKeyNutrients,
    patientBiomarkerWarnings: biomarkersStr,
    dailyNutrientTargets: targetsStr,
    brandMatchWarnings: params.brandMatchWarnings || [],
    userMessage: params.userPrompt || "Analyze this meal log.",
  };

  const userContentText = `PAYLOAD CONTEXT FOR DIETITIAN ANALYSIS:\n${JSON.stringify(payloadContext, null, 2)}`;

  let response: any;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      response = await ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: "user",
            parts: [{ text: userContentText }],
          },
        ],
        config: {
          systemInstruction: dietitianSystemInstruction,
          responseMimeType: "application/json",
        },
      });
      break;
    } catch (err: any) {
      if ((err.status === 429 || err.message?.includes("429") || err.message?.includes("quota") || err.message?.includes("RESOURCE_EXHAUSTED")) && attempt < 4) {
        console.warn(`[Dietitian Rate Limit 429] Waiting 12s before retry attempt ${attempt + 1}/4...`);
        await new Promise((r) => setTimeout(r, 12000));
      } else {
        throw err;
      }
    }
  }

  const responseText = response.text || "{}";
  const parsed = JSON.parse(responseText);
  return parsed as DietitianOutput;
}
