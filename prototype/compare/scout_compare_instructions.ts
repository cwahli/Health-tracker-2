import { Type } from "@google/genai";

// ---------------------------------------------------------------------------
// ORIGINAL BASELINE INSTRUCTIONS (4 Enums, No Consolidation)
// ---------------------------------------------------------------------------
export const baselineScoutSystemInstruction = `System Instruction:
- HIERARCHY: Group distinct physical plated items, separate cooking pots/bowls, drinks, or companion sides into separate 'dishes', and constituent ingredients into 'foods'. Never merge ingredients from separate pots/bowls into a single dish.
- FULL GROCERY INGESTION: Inspect every sticker/barcode: multiple packages of same type (e.g. 2 meat trays: 110g+115g) and raw plate items (eggs) must all be included into foods[]. Never drop packages.
- WEIGHTS & PACKAGES: For each food, output 'weightGrams' (portion consumed in dish) and 'packGrams' (total printed weight of grocery pack/container if visible, else null).
- DIRECT OCR: Transcribe nutrition labels into 'rawNutritionLabel' including 'calories' (printed energy/kkal/kJ), servingSize, and macros.
- BRANDS & CONDIMENTS: Set 'chainName' for known brands (else null). Set 'isStandaloneCondimentPacket' to true only for tiny condiment packets <=30g.
- COOKING FATS: In 'dishNutrients.totalFat', include cooking oils, dressings, and broth fats based on the dish 'cookingMethod'.

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

export function buildBaselineScoutPrompt(message: string, imageCount: number): string {
  const cleanMsg = (message || '').trim();
  const isGeneric = !cleanMsg || /^(analyze\s*(this|the)?\s*(meal|food|photo|image)?[s.]*|log\s*meal|scan)$/i.test(cleanMsg);
  const multiImageRule = imageCount > 1 
    ? " CRITICAL MULTI-IMAGE REQUIREMENT: Extract ALL distinct food items seen across ALL images. Do not ignore any food item."
    : "";
  const baseInstruction = `Analyze the provided ${imageCount > 1 ? imageCount + ' meal images' : 'meal image'}. Inspect all visible prepared dishes, cooking pots, grocery packages, and barcode labels. Read any visible OCR text on cups, wrappers, or menus to identify fast-food brands or commercial chains, and use these to anchor the nutritional estimation (e.g. calories and fat for commercial deep-fried items) to standard commercial nutrition tables. Ingest all visible foods and packages completely into dishes and constituent foods.${multiImageRule}`;

  if (isGeneric) {
    return `${baseInstruction} Extract all physical dishes and constituent foods into the hierarchical schema with weightGrams, packGrams, and nutrients.`;
  }
  return `${baseInstruction} User note: "${cleanMsg}". Extract all physical dishes and constituent foods into the hierarchical schema with weightGrams, packGrams, and nutrients.`;
}

// ---------------------------------------------------------------------------
// CONSOLIDATED INSTRUCTIONS (No "mixed" option, Strict 4 Enums)
// ---------------------------------------------------------------------------
export const consolidatedScoutSystemInstruction = `System Instruction:
- HIERARCHY: Group distinct physical plated items, separate cooking pots/bowls, drinks, or companion sides into separate 'dishes', and constituent ingredients into 'foods'.
- FULL INGESTION & METADATA: Explore ALL provided images completely and extract ALL visible food items, bakery shelves, and packages into dishes[]. 'contentType' is a post-extraction metadata tag and MUST NOT restrict or filter what you extract across images.
- WEIGHTS & PACKAGES: Output 'weightGrams' (consumed) and 'packGrams' (container total).
- DIRECT OCR: Transcribe nutrition labels into 'rawNutritionLabel' for packaged items with labels.
- BRANDS & CONDIMENTS: Set 'chainName' for brands. Set 'isStandaloneCondimentPacket' for packets <=30g.
- COOKING FATS: Include cooking oils/fats in 'dishNutrients.totalFat' based on 'cookingMethod'.

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

export function buildConsolidatedScoutPrompt(message: string, imageCount: number): string {
  const cleanMsg = (message || '').trim();
  const isGeneric = !cleanMsg || /^(analyze\s*(this|the)?\s*(meal|food|photo|image)?[s.]*|log\s*meal|scan)$/i.test(cleanMsg);
  const multiImageRule = imageCount > 1 
    ? " Audit every image (Image 0, Image 1, Image 2) independently and extract dishes from every image. Do not stop after a label."
    : "";
  const baseInstruction = `Analyze all ${imageCount} provided images. Inspect all visible food displays, packages, and labels across every image.${multiImageRule}`;

  if (isGeneric) {
    return `${baseInstruction} Extract all physical dishes and constituent foods into the hierarchical schema with weightGrams, packGrams, sourceImageIndex, and nutrients.`;
  }
  return `${baseInstruction} User note: "${cleanMsg}". Extract all physical dishes and constituent foods into the hierarchical schema with weightGrams, packGrams, sourceImageIndex, and nutrients.`;
}

// Structured Schema without "mixed"
export const scoutSchemaStrict4Enums = {
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
                },
              },
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
          },
        },
      },
    },
  },
};
