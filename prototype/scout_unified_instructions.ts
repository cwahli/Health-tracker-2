import { Type } from "@google/genai";

export const unifiedScoutSystemInstruction = `System Instruction:
STEP 1: SCENE CLASSIFICATION & ENVIRONMENT
- 'contentType': 'visual' (food photo), 'menu_or_poster' (menu/kiosk screen), 'label' (nutrition panel), or 'text'.
- 'diningEnvironment': 'casual_restaurant' | 'fast_food_chain' | 'home_cooked' | 'fine_dining' | 'airline' | 'unknown'.

STEP 2: UNIVERSAL DISH EXTRACTION & DEDUPLICATION
- MULTI-DISH EXTRACTION: Extract EVERY distinct physical food, drink, side, or companion dish visible in the photo or menu as its own separate entry in 'items'. For open beverages/cups, estimate weight based on visible fill level (e.g. half-full ~100-120g vs full ~200-250g).
- USER CONSTRAINTS: The user's explicit text sentence is absolute ground truth. If the user specifies portion weight (e.g. "80g of oats"), calibrate the portion. If the user explicitly limits consumption (e.g. "I only ate the salad"), extract ONLY specified items.
- CROSS-IMAGE DEDUPLICATION: If photos show BOTH a menu screen and physical food, or raw grocery packages and the cooked dish prepared from them, extract each distinct dish ONCE.
- KNOWN BRANDS: For any restaurant chain or branded product (e.g. Yolk, Starbucks, Lidl, Sainsbury), output the brand name alone in 'chainName' and the exact dish title in 'originalName'. Leave 'chainName' null for unbranded or home-cooked foods.
- DIRECT LABEL ATTACHMENT & LITERAL OCR: If an image shows a package nutrition label or menu panel for a visible food dish, transcribe all printed facts directly into that food item's 'rawNutritionLabel' field as literal raw strings exactly as printed (e.g. "190 kcal", "8.8g", "Per 100g: 12g"). DO NOT perform unit conversions, math, or serving size scaling on OCR text — the backend pipeline will clean, parse, and normalize raw OCR strings. NEVER create a separate "Nutrition Facts Label" dish entry. Exactly 1 item per real food dish.
- DYNAMIC PRINTED OCR: Transcribe EVERY literally printed value from the image into 'rawNutritionLabel' using standard normalized keys. Leave any unprinted key as null.

STEP 3: 15 DISH NUTRIENTS ESTIMATION & ZERO-DUPLICATION RULE
- FIELD-BY-FIELD ZERO DUPLICATION:
  * For any nutrient literally visible/printed on the image: put the raw string in 'rawNutritionLabel' and set that exact key to null in 'nutrients' (never duplicate printed numbers).
  * For any nutrient NOT visible/printed on the image (or for unpackaged dishes where 'rawNutritionLabel' is null): provide a realistic numeric portion estimate in 'nutrients' across the 15 required keys (calories, protein, totalFat, saturatedFat, transFat, sugar, addedSugar, totalFibre, sodium, potassium, omega3, calcium, iron, magnesium, vitaminD).
- ZERO-MATH FOR SCOUT: DO NOT calculate carbohydrates, unsaturated fat, or salt conversions. The backend pipeline automatically derives carbs via Atwater ((Calories - 4P - 9F) / 4), salt via sodium conversion, and unsaturated fat from total fat.
- CONCISE REASONING: Keep '_internalReasoning' under 20 words (1 sentence max).
- CULINARY & REGIONAL CALIBRATION: Calibrate portion unit sizes, default ingredients, and cooking fat to specific cuisine norms (e.g. fried coatings absorb 25–35% fat by weight; stir-fry adds +5–10g oil; steamed/boiled is fat-neutral).
- INGREDIENTS: Plain string list in 'ingredients' (e.g. ["chicken", "breadcrumbs", "vegetable oil"]).
- COOKING METHOD: 'raw' | 'baked' | 'grilled' | 'boiled' | 'steamed' | 'deep_fried' | 'pan_fried' | 'stir_fried'.
- CONDIMENTS: Set 'isStandaloneCondimentPacket' to true ONLY if the item is a tiny standalone condiment packet or small sauce cup (e.g. ketchup packet). Set it to false for all main dishes, plates, bowls, salads, wraps, sandwiches, or mixed meals.

=== REQUIRED OUTPUT JSON SCHEMA ===
Output exactly ONE JSON object matching this schema.

{
  "_internalReasoning": "string (Concise description of detected dishes, dining setting, and label facts)",
  "contentType": "visual | menu_or_poster | text",
  "diningEnvironment": "home_cooked | casual_restaurant | fast_food_chain | fine_dining | airline | unknown",
  "items": [
    {
      "originalName": "string",
      "keyword": "string",
      "chainName": "string | null",
      "estimatedWeightGrams": 200,
      "cookingMethod": "baked | grilled | boiled | raw | deep_fried | pan_fried | steamed",
      "ingredients": ["string"],
      "sourceImageIndex": 0,
      "boundingBox2D": [150, 200, 800, 750],
      "isStandaloneCondimentPacket": false,
      "rawNutritionLabel": {
        "servingSize": "100g",
        "calories": "190 kcal",
        "protein": "8.8g",
        "totalFat": "6.4g",
        "saturatedFat": "1.2g",
        "transFat": null,
        "totalCarbohydrate": "22g",
        "sugar": "1.5g",
        "addedSugar": null,
        "sodium": null,
        "salt": "1.0g",
        "potassium": null,
        "totalFibre": "2.0g",
        "solubleFibre": null
      },
      "nutrients": {
        "calories": null,
        "protein": null,
        "totalFat": null,
        "saturatedFat": null,
        "transFat": null,
        "sugar": null,
        "addedSugar": null,
        "totalFibre": null,
        "sodium": 400,
        "potassium": 250,
        "omega3": 0.1,
        "calcium": 35,
        "iron": 1.4,
        "magnesium": 28,
        "vitaminD": 0
      }
    }
  ]
}
`;

export const unifiedScoutResponseSchema = {
  type: Type.OBJECT,
  properties: {
    _internalReasoning: { type: Type.STRING },
    contentType: { type: Type.STRING },
    diningEnvironment: { type: Type.STRING },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          originalName: { type: Type.STRING },
          keyword: { type: Type.STRING },
          chainName: { type: Type.STRING, nullable: true },
          estimatedWeightGrams: { type: Type.NUMBER },
          cookingMethod: { type: Type.STRING },
          ingredients: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          sourceImageIndex: { type: Type.INTEGER },
          boundingBox2D: {
            type: Type.ARRAY,
            items: { type: Type.NUMBER },
          },
          isStandaloneCondimentPacket: { type: Type.BOOLEAN, nullable: true },
          rawNutritionLabel: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
              servingSize: { type: Type.STRING, nullable: true },
              calories: { type: Type.STRING, nullable: true },
              protein: { type: Type.STRING, nullable: true },
              totalFat: { type: Type.STRING, nullable: true },
              saturatedFat: { type: Type.STRING, nullable: true },
              transFat: { type: Type.STRING, nullable: true },
              totalCarbohydrate: { type: Type.STRING, nullable: true },
              sugar: { type: Type.STRING, nullable: true },
              addedSugar: { type: Type.STRING, nullable: true },
              sodium: { type: Type.STRING, nullable: true },
              salt: { type: Type.STRING, nullable: true },
              potassium: { type: Type.STRING, nullable: true },
              totalFibre: { type: Type.STRING, nullable: true },
              solubleFibre: { type: Type.STRING, nullable: true },
            },
            required: [
              "servingSize",
              "calories",
              "protein",
              "totalFat",
              "saturatedFat",
              "transFat",
              "totalCarbohydrate",
              "sugar",
              "addedSugar",
              "sodium",
              "salt",
              "potassium",
              "totalFibre",
              "solubleFibre",
            ],
          },
          nutrients: {
            type: Type.OBJECT,
            properties: {
              calories: { type: Type.NUMBER, nullable: true },
              protein: { type: Type.NUMBER, nullable: true },
              totalFat: { type: Type.NUMBER, nullable: true },
              saturatedFat: { type: Type.NUMBER, nullable: true },
              transFat: { type: Type.NUMBER, nullable: true },
              sugar: { type: Type.NUMBER, nullable: true },
              addedSugar: { type: Type.NUMBER, nullable: true },
              totalFibre: { type: Type.NUMBER, nullable: true },
              sodium: { type: Type.NUMBER, nullable: true },
              potassium: { type: Type.NUMBER, nullable: true },
              omega3: { type: Type.NUMBER, nullable: true },
              calcium: { type: Type.NUMBER, nullable: true },
              iron: { type: Type.NUMBER, nullable: true },
              magnesium: { type: Type.NUMBER, nullable: true },
              vitaminD: { type: Type.NUMBER, nullable: true },
            },
            required: [
              "calories",
              "protein",
              "totalFat",
              "saturatedFat",
              "transFat",
              "sugar",
              "addedSugar",
              "totalFibre",
              "sodium",
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
          "originalName",
          "keyword",
          "estimatedWeightGrams",
          "cookingMethod",
          "ingredients",
          "sourceImageIndex",
          "nutrients",
        ],
      },
    },
  },
  required: ["_internalReasoning", "contentType", "diningEnvironment", "items"],
};
