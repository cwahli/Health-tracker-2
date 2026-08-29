import { Type } from "@google/genai";

export const hierarchicalScoutSystemInstruction = `System Instruction:
- HIERARCHY: Group distinct physical plated items, separate cooking pots/bowls, drinks, or companion sides into separate 'dishes', and constituent ingredients into 'foods'. Never merge ingredients from separate pots/bowls into a single dish.
- GROCERY & SCALE STICKERS: Treat each supermarket scale sticker as an atomic unit: pair the printed item text directly with its printed weight (e.g. 'Berat 0.252' -> 252g for that exact sticker). Output the printed sticker text in 'packageLabelText'. Never transpose weights between different packages or assign scale sticker weights to separate pre-packed bags.
- LOCAL NAMES: Preserve verbatim printed names from stickers/menus in the local language (e.g. 'Ikan Cendro', 'Cumi Bangka', 'Telur Ayam Negeri', 'Baby Pak Choy').
- WEIGHTS & PACKAGES: For each food, output 'weightGrams' and 'packGrams' (total printed weight if visible, else null). Transcribe nutrition labels into 'rawNutritionLabel'.
- BRANDS & FATS: Set 'chainName' for known brands. Include cooking oils/fats in 'dishNutrients.totalFat' based on 'cookingMethod'.
- USER PROMPT FOODS: If user text explicitly mentions additional foods consumed (e.g. '[Mr Oat Rolled Oats 70g]'), extract them as their own dish with stated portion.

=== REQUIRED OUTPUT JSON SCHEMA ===
Output exactly ONE JSON object matching this schema:
{
  "_internalReasoning": "string (<15 words)",
  "contentType": "visual | menu_or_poster | label | text",
  "diningEnvironment": "home_cooked | casual_restaurant | fast_food_chain | fine_dining | airline | unknown",
  "dishes": [
    {
      "dishName": "Vegetable and Beef Hotpot",
      "chainName": null,
      "estimatedWeightGrams": 650,
      "cookingMethod": "raw | baked | grilled | boiled | steamed | deep_fried | pan_fried | stir_fried",
      "boundingBox2D": [300, 200, 850, 900],
      "sourceImageIndex": 1,
      "isStandaloneCondimentPacket": false,
      "foods": [
        {
          "foodName": "Beef Blade",
          "packageLabelText": "BEEF BLADE - Berat 0.110",
          "weightGrams": 110,
          "packGrams": 110,
          "sourceImageIndex": 0,
          "rawNutritionLabel": null,
          "nutrients": { "protein": 24.0, "saturatedFat": 2.5, "addedSugar": 0, "totalFibre": 0, "sodium": 65, "carbohydrates": 0 }
        }
      ],
      "dishNutrients": { "saturatedFat": 5.8, "totalFat": 18.2, "totalSugar": 5.0, "potassium": 1450, "omega3": 0.15, "calcium": 190, "iron": 5.5, "magnesium": 120, "vitaminD": 0 }
    }
  ]
}`;

export const hierarchicalScoutResponseSchema = {
  type: Type.OBJECT,
  properties: {
    _internalReasoning: { type: Type.STRING },
    contentType: { type: Type.STRING, enum: ["visual", "menu_or_poster", "label", "text"] },
    diningEnvironment: {
      type: Type.STRING,
      enum: ["casual_restaurant", "fast_food_chain", "home_cooked", "fine_dining", "airline", "unknown"],
    },
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
          "boundingBox2D",
          "foods",
          "dishNutrients",
        ],
      },
    },
  },
  required: ["contentType", "diningEnvironment", "dishes"],
};
