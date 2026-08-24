import dotenv from "dotenv";
dotenv.config();
import { GoogleGenAI, Type } from "@google/genai";
import { buildModeAReviewInstruction } from "../agents/dietitianInstructions.js";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    console.error("Missing GEMINI_API_KEY in environment!");
    process.exit(1);
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 150000,
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  const systemInstruction = buildModeAReviewInstruction({
    biomarkersNeedingImprovement: [],
    remainingAllowance: null,
    foodLogs: [],
    userProfile: { timezone: "UTC" }
  });

  const userPrompt = `Analyze this current food request.

USER DIETARY PROFILE & DEMOGRAPHICS:
- Age: 28 years old
- Gender: Male
- Weight: 70 kg
- Height: 175 cm
- Ethnicity: Chinese

CURRENT TIME CONTEXT: 2026-08-24 08:44:46
CRITICAL INSTRUCTION: You MUST use "2026-08-24" in the "date" field of "foodData" unless the user explicitly provides a different date in the chat.

=== VISUAL FOOD SCOUT IDENTIFIED ITEMS ===
- Index: 0 | Scout Item: "savory noodles with wonton" | Weight: 300g | Observed/Local Context: "MIE SUIT"
- Index: 1 | Scout Item: "steamed chicken dumplings" | Weight: 150g | Observed/Local Context: "SIOMAY"
- Index: 2 | Scout Item: "sweet fruit and jelly iced drink" | Weight: 250g | Observed/Local Context: "ES PETAK UMPET"
Content Type: menu_or_poster (3 items identified)
Visual Scout Confidence Rating: High (>90%)
Identified Cooking Method & Preparation/Seasonings: 
diningEnvironment: fast_food_chain

=== BACKEND PRE-CALCULATED ITEM NUTRIENTS ===
=== BACKEND PRE-CALCULATED ITEM NUTRIENTS (Absolute Truth) ===
- "MIE SUIT" (300g):
  Calories: 450 kcal
  Protein: 14g
  Fat: 18g (Saturated: 5g)
  Carbs: 58g (Sugar: 3g, Added Sugar: 1g)
  Sodium: 820mg

- "SIOMAY" (150g):
  Calories: 280 kcal
  Protein: 16g
  Fat: 10g (Saturated: 3g)
  Carbs: 30g (Sugar: 1g, Added Sugar: 0g)
  Sodium: 520mg

- "ES PETAK UMPET" (250g):
  Calories: 210 kcal
  Protein: 1g
  Fat: 3g (Saturated: 2g)
  Carbs: 46g (Sugar: 38g, Added Sugar: 32g)
  Sodium: 45mg

Current User Input: "Analyze this meal photo."

[SERVER BASELINE ESTIMATE — audit each nutrient against culinary reality; accept or provide clinical corrections in correctedNutrients]
mealId=oipl3hl
mealName=MIE SUIT
macroTotals={"calories":940,"protein":31,"totalFat":31,"saturatedFat":10,"transFat":0,"unsaturatedFat":21,"omega3":0.2,"carbohydrates":134,"sugar":42,"addedSugar":33,"totalFibre":5,"solubleFibre":0,"sodium":1385,"potassium":450,"magnesium":90,"calcium":125,"iron":3.9,"zinc":0,"selenium":0,"iodine":0,"phosphorus":0,"vitaminD":0,"vitaminB12":0,"folate":0,"vitaminC":0,"vitaminE":0,"vitaminK":0,"vitaminA":0,"vitaminB6":0,"thiamine":0,"riboflavin":0,"niacin":0}
itemsSummary=[{"name":"MIE SUIT","weightGrams":300,"calories":450,"protein":14,"carbs":58},{"name":"SIOMAY","weightGrams":150,"calories":280,"protein":16,"carbs":30},{"name":"ES PETAK UMPET","weightGrams":250,"calories":210,"protein":1,"carbs":46}]
`;

  const foodAnalyzeSchema = {
    type: Type.OBJECT,
    properties: {
      _internalReasoning: { type: Type.STRING },
      verdict: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          level: { type: Type.STRING }
        },
        required: ["label", "level"]
      },
      message: { type: Type.STRING },
      foodData: {
        type: Type.OBJECT,
        properties: {
          date: { type: Type.STRING },
          name: { type: Type.STRING },
          itemsBreakdown: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                scoutIndex: { type: Type.INTEGER },
                canonicalDbName: { type: Type.STRING },
                weightGrams: { type: Type.INTEGER },
                foodType: { type: Type.STRING, nullable: true },
                cookingMethod: { type: Type.STRING, nullable: true },
                correctedNutrients: {
                  type: Type.OBJECT,
                  properties: {
                    calories: { type: Type.NUMBER, nullable: true },
                    protein: { type: Type.NUMBER, nullable: true },
                    totalFat: { type: Type.NUMBER, nullable: true },
                    saturatedFat: { type: Type.NUMBER, nullable: true },
                    sodium: { type: Type.NUMBER, nullable: true },
                    addedSugar: { type: Type.NUMBER, nullable: true },
                    totalFibre: { type: Type.NUMBER, nullable: true },
                  },
                  nullable: true
                },
                clinicalCorrectionNote: { type: Type.STRING, nullable: true }
              },
              required: ["scoutIndex", "canonicalDbName", "weightGrams"]
            }
          }
        },
        required: ["date", "name", "itemsBreakdown"]
      }
    },
    required: ["_internalReasoning", "verdict", "message", "foodData"]
  };

  console.log("=== SCENARIO A: Original Diagnostic Payload (Scout 150g) ===");
  const resA = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: userPrompt,
    config: {
      systemInstruction: systemInstruction,
      responseMimeType: "application/json",
      responseSchema: foodAnalyzeSchema as any,
      temperature: 0.1
    }
  });
  console.log(resA.text);

  console.log("\n=== SCENARIO B: User mentions 3 small siomay dumplings (Regional Norms ~30-35g/pc) ===");
  const promptB = userPrompt.replace(
    'Current User Input: "Analyze this meal photo."',
    'Current User Input: "Analyze this meal photo. The siomay is 3 small pieces."'
  ).replace(
    '- Index: 1 | Scout Item: "steamed chicken dumplings" | Weight: 150g | Observed/Local Context: "SIOMAY"',
    '- Index: 1 | Scout Item: "steamed chicken dumplings (3 pieces)" | Weight: 150g | Observed/Local Context: "SIOMAY"'
  );

  const resB = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: promptB,
    config: {
      systemInstruction: systemInstruction,
      responseMimeType: "application/json",
      responseSchema: foodAnalyzeSchema as any,
      temperature: 0.1
    }
  });
  console.log(resB.text);
}

main().catch(err => {
  console.error("Error during real API test:", err);
  process.exit(1);
});
