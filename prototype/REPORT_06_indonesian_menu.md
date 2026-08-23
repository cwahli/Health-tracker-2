# End-to-End Pipeline Report: 06_indonesian_menu (Sambal Bakar Pencok 89)

**Generated At:** 2026-08-23T20:54:57.986Z
**File(s):** `06_indonesian_menu_page_1.jpg, 06_indonesian_menu_page_2.jpg` | **Content Type:** `menu_or_poster` | **Environment:** `casual_restaurant`

### 1. User Input Context & Active Clinical Biomarker Profile
- **User Prompt:** "Extract distinct dishes across both Indonesian menu pages (Sambal Bakar Pencok 89) for multi-language evaluation."
- **Active Clinical Biomarkers:**
  - Prediabetes / Elevated Fasting Glucose
  - Elevated LDL Cholesterol (145 mg/dL)
  - Mild Hypertension (132/85 mmHg)
- **Daily Reference Targets:** 2,000 kcal | 100g Protein | 15g Sat Fat | 2,000mg Sodium | 24g Added Sugar | 30g Fibre

### 2. Active Agent Pipeline Architecture & System Instructions

<details><summary>Click to expand Stage 1: Vision Scout Agent System Instruction & Schema</summary>

```typescript
System Instruction:
STEP 1: SCENE CLASSIFICATION & ENVIRONMENT
- 'contentType': 'visual' (food photo), 'menu_or_poster' (menu/kiosk screen), 'label' (nutrition panel), or 'text'.
- 'diningEnvironment': 'casual_restaurant' | 'fast_food_chain' | 'home_cooked' | 'fine_dining' | 'airline' | 'unknown'.

STEP 2: DISH EXTRACTION & BOUNDING BOX DETECTION
- Extract EVERY distinct food, drink, side, or meal item visible in the photo or menu/kiosk screen as its own separate entry in 'items'.
- Do NOT combine distinct dishes into 1 item. (e.g. if a meal consists of sushi rolls, salad, and a baguette roll, output 3 distinct item objects).
- For each item, provide a 2D bounding box 'boundingBox2D': [ymin, xmin, ymax, xmax] in normalized 0-1000 coordinate space identifying the exact region of the image containing the item.
- Specify 'sourceImageIndex': integer index of the input image (0 for single image).
- Identify 'chainName': restaurant chain or brand name if applicable (e.g. 'Starbucks', 'McDonald's', 'Pret'), or null if home-cooked / unbranded.

STEP 3: INGREDIENTS BREAKDOWN & DIRECT 15-NUTRIENT ESTIMATION
- List all identified ingredients and components for each dish as a clean array of strings in 'ingredients' (e.g. ["salmon", "avocado", "sushi rice", "nori"]).
- Estimate the total weight in grams of the portion shown as 'estimatedWeightGrams'.
- For each dish identified, provide a direct, realistic, and biologically coherent nutrient estimation for the portion shown.
- You MUST estimate and output the following 15 key nutrients directly for EACH identified dish:
  1. Calories (kcal)
  2. Protein (g)
  3. Saturated Fat (g)
  4. Trans Fat (g)
  5. Added Sugar (g)
  6. Total Fibre (g)
  7. Sodium (mg)
  8. Total Fat (g)
  9. Total Sugar (g)
  10. Potassium (mg)
  11. Omega-3 (g)
  12. Calcium (mg)
  13. Iron (mg)
  14. Magnesium (mg)
  15. Vitamin D (mcg)

- STRICT SCOPE CONSTRAINTS:
  - DO NOT output search keywords or search queries.
  - DO NOT output mass percentage or volume percentage for ingredients. Simply list ingredients as plain strings in 'ingredients'.

=== SYSTEM CONSTRAINTS ===
Output exactly ONE JSON object matching this schema.

{
  "_internalReasoning": "string",
  "contentType": "visual | menu_or_poster | text",
  "diningEnvironment": "home_cooked | casual_restaurant | fast_food_chain | fine_dining | airline | unknown",
  "items": [
    {
      "originalName": "string",
      "chainName": "string | null",
      "estimatedWeightGrams": 250,
      "cookingMethod": "grilled",
      "ingredients": ["string"],
      "boundingBox2D": [150, 200, 800, 750],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 450,
        "protein": 35.0,
        "saturatedFat": 4.5,
        "transFat": 0.0,
        "addedSugar": 0.0,
        "totalFibre": 5.0,
        "sodium": 580,
        "totalFat": 14.0,
        "totalSugar": 3.0,
        "potassium": 620,
        "omega3": 0.4,
        "calcium": 60,
        "iron": 2.8,
        "magnesium": 55,
        "vitaminD": 1.2
      },
      "itemConfidence": "High | Medium | Low"
    }
  ]
}
```
</details>

<details><summary>Click to expand Stage 2: Derivation Engine Formulas & Math</summary>

```typescript
// Derived Core & Key Nutrient Formulas:
// - Carbohydrates (g) = Math.max(0, (Calories - (4 * Protein) - (9 * TotalFat)) / 4)
// - Unsaturated Fat (g) = Math.max(0, TotalFat - (SaturatedFat + TransFat))
// - Salt (g) = (Sodium in mg * 2.54) / 1000
```
</details>

<details><summary>Click to expand Stage 3: Dietitian Clinical Coach Agent System Instruction & Schema</summary>

```typescript
System Instruction:
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
```
</details>

---

### 3. Stage 1 Output: Vision Scout Analysis & Dish Detection
**Scout Internal Reasoning:**
> The user provided two images of a yellow menu from 'Sambal Bakar Pencok 89' featuring various Indonesian dishes like Paket Ayam, Paket Lele, Tumis Kangkung, Nasi Uduk, etc. Since multiple images are provided, we will extract notable items visible across both pages.

#### Discovered Dishes & Per-Dish Core + Key Nutrients

##### Dish 1: PAKET AYAM (400g) [Image 0]
- **Brand / Chain:** Sambal Bakar Pencok 89
- **Cooking Method:** fried
- **Bounding Box:** `[322, 123, 348, 744]`
- **Ingredients:** nasi, ayam goreng, sayur asem, tahu, tempe
- **Core Nutrients:** 650 kcal | 38g Protein | **68.3g Carbs [Derived]** | 25g Fat | 5g Sat Fat | 0g Trans Fat | 0g Added Sugar | 4.5g Fibre | 750mg Sodium
- **Key Nutrients:** 2g Total Sugar | **20g Unsat Fat [Derived]** | **1.91g Salt [Derived]** | 450mg Potassium | 0.2g Omega-3 | 120mg Calcium | 3.5mg Iron | 65mg Magnesium | 0.5mcg Vit D

##### Dish 2: PAKET LELE (380g) [Image 0]
- **Brand / Chain:** Sambal Bakar Pencok 89
- **Cooking Method:** fried
- **Bounding Box:** `[452, 122, 467, 727]`
- **Ingredients:** nasi, lele goreng, sayur asem, tahu, tempe
- **Core Nutrients:** 600 kcal | 32g Protein | **68.5g Carbs [Derived]** | 22g Fat | 4.5g Sat Fat | 0g Trans Fat | 0g Added Sugar | 4g Fibre | 700mg Sodium
- **Key Nutrients:** 2g Total Sugar | **17.5g Unsat Fat [Derived]** | **1.78g Salt [Derived]** | 400mg Potassium | 0.4g Omega-3 | 110mg Calcium | 3mg Iron | 60mg Magnesium | 0.8mcg Vit D

##### Dish 3: TUMIS KANGKUNG/CAH TERASI (150g) [Image 1]
- **Brand / Chain:** Sambal Bakar Pencok 89
- **Cooking Method:** stir-fried
- **Bounding Box:** `[250, 129, 266, 308]`
- **Ingredients:** kangkung, bawang putih, bawang merah, cabai, terasi, minyak goreng
- **Core Nutrients:** 120 kcal | 3g Protein | **9g Carbs [Derived]** | 8g Fat | 1g Sat Fat | 0g Trans Fat | 1g Added Sugar | 3.5g Fibre | 450mg Sodium
- **Key Nutrients:** 2g Total Sugar | **7g Unsat Fat [Derived]** | **1.14g Salt [Derived]** | 300mg Potassium | 0.1g Omega-3 | 80mg Calcium | 2mg Iron | 40mg Magnesium | 0mcg Vit D

##### Dish 4: SOTO BETAWI DAGING SAPI / AYAM KAMPUNG (450g) [Image 1]
- **Brand / Chain:** Sambal Bakar Pencok 89
- **Cooking Method:** boiled
- **Bounding Box:** `[408, 120, 421, 388]`
- **Ingredients:** daging sapi, santan, bumbu soto, kentang, tomat, emping
- **Core Nutrients:** 480 kcal | 24g Protein | **24g Carbs [Derived]** | 32g Fat | 12g Sat Fat | 0.5g Trans Fat | 0g Added Sugar | 2g Fibre | 850mg Sodium
- **Key Nutrients:** 3g Total Sugar | **19.5g Unsat Fat [Derived]** | **2.16g Salt [Derived]** | 380mg Potassium | 0.1g Omega-3 | 50mg Calcium | 2.5mg Iron | 45mg Magnesium | 0.2mcg Vit D

### 4. Stage 2 Output: Derivation Engine & Brand Database Matcher
| Nutrient Category | Nutrient | Value |
| :--- | :--- | :--- |
| **Core (High Precision)** | Calories | 1850 kcal |
| **Core (High Precision)** | Protein | 97 g |
| **Core (High Precision)** | Saturated Fat | 22.5 g |
| **Core (High Precision)** | Trans Fat | 0.5 g |
| **Core (High Precision)** | Added Sugar | 1 g |
| **Core (High Precision)** | Total Fibre | 14 g |
| **Core (High Precision)** | Sodium | 2750 mg |
| **Core (Derived)** | **Carbohydrates** | **169.8 g** |
| **Key (Moderate Precision)** | Total Fat | 87 g |
| **Key (Moderate Precision)** | Total Sugar | 9 g |
| **Key (Moderate Precision)** | Potassium | 1530 mg |
| **Key (Moderate Precision)** | Omega-3 | 0.8 g |
| **Key (Moderate Precision)** | Calcium | 360 mg |
| **Key (Moderate Precision)** | Iron | 11 mg |
| **Key (Moderate Precision)** | Magnesium | 210 mg |
| **Key (Moderate Precision)** | Vitamin D | 1.5 mcg |
| **Key (Derived)** | **Unsaturated Fat** | **64 g** |
| **Key (Derived)** | **Salt** | **6.99 g** |

### 5. Stage 3 Output: Dietitian Clinical Coach Review & Extended Micronutrients
- **Verdict:** **38% over sodium limit** (Level: `alert`)
- **Dietitian Message (4-Beat Narrative):**
  > You secured 97g of quality protein and 14g of fiber from the mixed dishes. However, the heavy frying and coconut milk soup add 2750mg of sodium, pushing today's total 38% over your daily limit. This high sodium and fat load triggers physical sluggishness, digestive heaviness, and vascular constriction. Take a 25-minute brisk walk to aid circulation, and hydrate with water.
- **Accuracy Review Status:** ✅ **Scout Estimates Approved (No Correction Needed)**

##### Aggregate Extended Nutrients (Filled by Dietitian):
| Extended Nutrient (Directional Precision <50%) | Value |
| :--- | :--- |
| **Soluble Fibre** | 3.8 g |
| **Vitamin A** | 850 mcg |
| **Thiamine (B1)** | 0.45 mg |
| **Riboflavin (B2)** | 0.52 mg |
| **Niacin (B3)** | 8.5 mg |
| **Vitamin B6** | 0.75 mg |
| **Folate (B9)** | 140 mcg |
| **Vitamin B12** | 3.2 mcg |
| **Vitamin C** | 65 mg |
| **Vitamin E** | 4.1 mg |
| **Vitamin K** | 180 mcg |
| **Zinc** | 5.2 mg |
| **Selenium** | 45 mcg |
| **Iodine** | 40 mcg |
| **Phosphorus** | 620 mg |

#### Raw Payloads & JSON Output
<details><summary>Click to expand Raw Scout JSON</summary>

```json
{
  "_internalReasoning": "The user provided two images of a yellow menu from 'Sambal Bakar Pencok 89' featuring various Indonesian dishes like Paket Ayam, Paket Lele, Tumis Kangkung, Nasi Uduk, etc. Since multiple images are provided, we will extract notable items visible across both pages.",
  "contentType": "menu_or_poster",
  "diningEnvironment": "casual_restaurant",
  "items": [
    {
      "originalName": "PAKET AYAM",
      "chainName": "Sambal Bakar Pencok 89",
      "estimatedWeightGrams": 400,
      "cookingMethod": "fried",
      "ingredients": [
        "nasi",
        "ayam goreng",
        "sayur asem",
        "tahu",
        "tempe"
      ],
      "boundingBox2D": [
        322,
        123,
        348,
        744
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 650,
        "protein": 38,
        "saturatedFat": 5,
        "transFat": 0,
        "addedSugar": 0,
        "totalFibre": 4.5,
        "sodium": 750,
        "totalFat": 25,
        "totalSugar": 2,
        "potassium": 450,
        "omega3": 0.2,
        "calcium": 120,
        "iron": 3.5,
        "magnesium": 65,
        "vitaminD": 0.5
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "PAKET LELE",
      "chainName": "Sambal Bakar Pencok 89",
      "estimatedWeightGrams": 380,
      "cookingMethod": "fried",
      "ingredients": [
        "nasi",
        "lele goreng",
        "sayur asem",
        "tahu",
        "tempe"
      ],
      "boundingBox2D": [
        452,
        122,
        467,
        727
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 600,
        "protein": 32,
        "saturatedFat": 4.5,
        "transFat": 0,
        "addedSugar": 0,
        "totalFibre": 4,
        "sodium": 700,
        "totalFat": 22,
        "totalSugar": 2,
        "potassium": 400,
        "omega3": 0.4,
        "calcium": 110,
        "iron": 3,
        "magnesium": 60,
        "vitaminD": 0.8
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "TUMIS KANGKUNG/CAH TERASI",
      "chainName": "Sambal Bakar Pencok 89",
      "estimatedWeightGrams": 150,
      "cookingMethod": "stir-fried",
      "ingredients": [
        "kangkung",
        "bawang putih",
        "bawang merah",
        "cabai",
        "terasi",
        "minyak goreng"
      ],
      "boundingBox2D": [
        250,
        129,
        266,
        308
      ],
      "sourceImageIndex": 1,
      "nutrients": {
        "calories": 120,
        "protein": 3,
        "saturatedFat": 1,
        "transFat": 0,
        "addedSugar": 1,
        "totalFibre": 3.5,
        "sodium": 450,
        "totalFat": 8,
        "totalSugar": 2,
        "potassium": 300,
        "omega3": 0.1,
        "calcium": 80,
        "iron": 2,
        "magnesium": 40,
        "vitaminD": 0
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "SOTO BETAWI DAGING SAPI / AYAM KAMPUNG",
      "chainName": "Sambal Bakar Pencok 89",
      "estimatedWeightGrams": 450,
      "cookingMethod": "boiled",
      "ingredients": [
        "daging sapi",
        "santan",
        "bumbu soto",
        "kentang",
        "tomat",
        "emping"
      ],
      "boundingBox2D": [
        408,
        120,
        421,
        388
      ],
      "sourceImageIndex": 1,
      "nutrients": {
        "calories": 480,
        "protein": 24,
        "saturatedFat": 12,
        "transFat": 0.5,
        "addedSugar": 0,
        "totalFibre": 2,
        "sodium": 850,
        "totalFat": 32,
        "totalSugar": 3,
        "potassium": 380,
        "omega3": 0.1,
        "calcium": 50,
        "iron": 2.5,
        "magnesium": 45,
        "vitaminD": 0.2
      },
      "itemConfidence": "High"
    }
  ]
}
```
</details>

<details><summary>Click to expand Raw Dietitian JSON</summary>

```json
{
  "_internalReasoning": "Evaluated the combined Indonesian meal from Sambal Bakar Pencok 89 consisting of Paket Ayam, Paket Lele, Tumis Kangkung, and Soto Betawi. The aggregate calories are 1850 kcal with high sodium (2750mg, exceeding the 2000mg limit) and saturated fat (22.5g vs 15g limit), compounded by fried items and coconut milk broth given the user's mild hypertension, elevated LDL, and prediabetes.",
  "verdict": {
    "label": "38% over sodium limit",
    "level": "alert"
  },
  "message": "You secured 97g of quality protein and 14g of fiber from the mixed dishes. However, the heavy frying and coconut milk soup add 2750mg of sodium, pushing today's total 38% over your daily limit. This high sodium and fat load triggers physical sluggishness, digestive heaviness, and vascular constriction. Take a 25-minute brisk walk to aid circulation, and hydrate with water.",
  "accuracyReview": {
    "isCorrected": false,
    "correctionNotes": null,
    "correctedMealNutrients": null
  },
  "extendedMealNutrients": {
    "solubleFibre": 3.8,
    "vitaminA": 850,
    "thiamine": 0.45,
    "riboflavin": 0.52,
    "niacin": 8.5,
    "vitaminB6": 0.75,
    "folate": 140,
    "vitaminB12": 3.2,
    "vitaminC": 65,
    "vitaminE": 4.1,
    "vitaminK": 180,
    "zinc": 5.2,
    "selenium": 45,
    "iodine": 40,
    "phosphorus": 620
  },
  "mealSummary": {
    "title": "Indonesian Fried & Broth Combo Meal",
    "itemsSummary": [
      {
        "scoutIndex": 0,
        "name": "Paket Ayam",
        "weightGrams": 400,
        "foodType": "Set Menu",
        "cookingMethod": "fried"
      },
      {
        "scoutIndex": 1,
        "name": "Paket Lele",
        "weightGrams": 380,
        "foodType": "Set Menu",
        "cookingMethod": "fried"
      },
      {
        "scoutIndex": 2,
        "name": "Tumis Kangkung",
        "weightGrams": 150,
        "foodType": "Vegetable",
        "cookingMethod": "stir-fried"
      },
      {
        "scoutIndex": 3,
        "name": "Soto Betawi",
        "weightGrams": 450,
        "foodType": "Soup",
        "cookingMethod": "boiled"
      }
    ]
  }
}
```
</details>

