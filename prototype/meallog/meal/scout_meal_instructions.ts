import { Type } from "@google/genai";

export const scoutMealSystemInstruction = `System Instruction:
- HIERARCHY: Group distinct physical plated items, separate cooking pots/bowls, drinks, or companion sides into separate 'dishes', and constituent ingredients into 'foods'. Never merge ingredients from separate pots/bowls into a single dish.
- GROCERY & SCALE STICKERS: Treat each supermarket scale sticker as an atomic unit: pair printed item text with printed weight (e.g. 'Berat 0.252' -> 252g). Output text in 'packageLabelText'. Never transpose weights between different packages.
- LOCAL NAMES: Preserve verbatim printed names from stickers/menus in the local language (e.g. 'Ikan Cendro', 'Cumi Bangka').
- WEIGHTS & PACKAGES: For each food, output 'weightGrams' and 'packGrams' (total printed weight if visible, else null). Transcribe nutrition labels into 'rawNutritionLabel'.
- BRANDS & FATS: Set 'chainName' for known brands. Include cooking oils/fats in 'dishNutrients.totalFat' based on 'cookingMethod'.
- VERDICT & NARRATIVE: Provide an overall 'mealName', a clinical 3-6 word 'verdict' with severity 'level' (good | warning | alert | neutral), and a constructive 35-70 word 'message' in second person ("You got...") covering key assets, contextual impact, and actionable next step/movement.
- 15 SUMMARY NUTRIENTS: Estimate meal totals for: solubleFibre (g), vitaminA (mcg), thiamine (mg), riboflavin (mg), niacin (mg), vitaminB6 (mg), folate (mcg), vitaminB12 (mcg), vitaminC (mg), vitaminE (mg), vitaminK (mcg), zinc (mg), selenium (mcg), iodine (mcg), phosphorus (mg).

=== REQUIRED OUTPUT JSON SCHEMA ===
Output exactly ONE JSON object matching the defined schema.`;

export const scoutMealResponseSchema = {
  type: Type.OBJECT,
  properties: {
    _internalReasoning: { type: Type.STRING },
    contentType: { type: Type.STRING, enum: ["visual", "menu_or_poster", "label", "text"] },
    diningEnvironment: {
      type: Type.STRING,
      enum: ["casual_restaurant", "fast_food_chain", "home_cooked", "fine_dining", "airline", "unknown"],
    },
    mealName: { type: Type.STRING },
    dishes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          dishName: { type: Type.STRING },
          chainName: { type: Type.STRING, nullable: true },
          estimatedWeightGrams: { type: Type.NUMBER },
          cookingMethod: {
            type: Type.STRING,
            enum: ["raw", "baked", "grilled", "boiled", "steamed", "deep_fried", "pan_fried", "stir_fried"],
          },
          sourceImageIndex: { type: Type.INTEGER },
          boundingBox2D: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
          },
          isStandaloneCondimentPacket: { type: Type.BOOLEAN, nullable: true },
          foods: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                foodName: { type: Type.STRING },
                packageLabelText: { type: Type.STRING, nullable: true },
                weightGrams: { type: Type.NUMBER },
                packGrams: { type: Type.NUMBER, nullable: true },
                sourceImageIndex: { type: Type.INTEGER, nullable: true },
                rawNutritionLabel: {
                  type: Type.OBJECT,
                  nullable: true,
                  properties: {
                    servingSize: { type: Type.STRING },
                    calories: { type: Type.STRING },
                    protein: { type: Type.STRING },
                    totalFat: { type: Type.STRING },
                    saturatedFat: { type: Type.STRING },
                    transFat: { type: Type.STRING },
                    totalCarbohydrate: { type: Type.STRING },
                    sugar: { type: Type.STRING },
                    addedSugar: { type: Type.STRING },
                    sodium: { type: Type.STRING },
                    salt: { type: Type.STRING },
                    potassium: { type: Type.STRING },
                    totalFibre: { type: Type.STRING },
                  },
                  required: ["servingSize", "calories"],
                },
                nutrients: {
                  type: Type.OBJECT,
                  properties: {
                    protein: { type: Type.NUMBER },
                    saturatedFat: { type: Type.NUMBER },
                    addedSugar: { type: Type.NUMBER },
                    totalFibre: { type: Type.NUMBER },
                    sodium: { type: Type.NUMBER },
                    carbohydrates: { type: Type.NUMBER },
                  },
                  required: [
                    "protein",
                    "saturatedFat",
                    "addedSugar",
                    "totalFibre",
                    "sodium",
                    "carbohydrates",
                  ],
                },
              },
              required: ["foodName", "weightGrams", "nutrients"],
            },
          },
          dishNutrients: {
            type: Type.OBJECT,
            properties: {
              saturatedFat: { type: Type.NUMBER },
              totalFat: { type: Type.NUMBER },
              totalSugar: { type: Type.NUMBER },
              potassium: { type: Type.NUMBER },
              omega3: { type: Type.NUMBER },
              calcium: { type: Type.NUMBER },
              iron: { type: Type.NUMBER },
              magnesium: { type: Type.NUMBER },
              vitaminD: { type: Type.NUMBER },
            },
            required: [
              "saturatedFat",
              "totalFat",
              "totalSugar",
              "potassium",
              "omega3",
              "calcium",
              "iron",
              "magnesium",
              "vitaminD",
            ],
          },
        },
        required: [
          "dishName",
          "estimatedWeightGrams",
          "cookingMethod",
          "sourceImageIndex",
          "boundingBox2D",
          "foods",
          "dishNutrients",
        ],
      },
    },
    verdict: {
      type: Type.OBJECT,
      properties: {
        label: { type: Type.STRING },
        level: { type: Type.STRING, enum: ["good", "warning", "alert", "neutral"] },
      },
      required: ["label", "level"],
    },
    message: { type: Type.STRING },
    summaryNutrients: {
      type: Type.OBJECT,
      properties: {
        solubleFibre: { type: Type.NUMBER, description: "Soluble Fibre in grams (g)" },
        vitaminA: { type: Type.NUMBER, description: "Vitamin A in micrograms (mcg)" },
        thiamine: { type: Type.NUMBER, description: "Thiamine (B1) in milligrams (mg)" },
        riboflavin: { type: Type.NUMBER, description: "Riboflavin (B2) in milligrams (mg)" },
        niacin: { type: Type.NUMBER, description: "Niacin (B3) in milligrams (mg)" },
        vitaminB6: { type: Type.NUMBER, description: "Vitamin B6 in milligrams (mg)" },
        folate: { type: Type.NUMBER, description: "Folate (B9) in micrograms (mcg)" },
        vitaminB12: { type: Type.NUMBER, description: "Vitamin B12 in micrograms (mcg)" },
        vitaminC: { type: Type.NUMBER, description: "Vitamin C in milligrams (mg)" },
        vitaminE: { type: Type.NUMBER, description: "Vitamin E in milligrams (mg)" },
        vitaminK: { type: Type.NUMBER, description: "Vitamin K in micrograms (mcg)" },
        zinc: { type: Type.NUMBER, description: "Zinc in milligrams (mg)" },
        selenium: { type: Type.NUMBER, description: "Selenium in micrograms (mcg)" },
        iodine: { type: Type.NUMBER, description: "Iodine in micrograms (mcg)" },
        phosphorus: { type: Type.NUMBER, description: "Phosphorus in milligrams (mg)" },
      },
      required: [
        "solubleFibre",
        "vitaminA",
        "thiamine",
        "riboflavin",
        "niacin",
        "vitaminB6",
        "folate",
        "vitaminB12",
        "vitaminC",
        "vitaminE",
        "vitaminK",
        "zinc",
        "selenium",
        "iodine",
        "phosphorus",
      ],
    },
  },
  required: [
    "_internalReasoning",
    "contentType",
    "diningEnvironment",
    "mealName",
    "dishes",
    "verdict",
    "message",
    "summaryNutrients",
  ],
};
