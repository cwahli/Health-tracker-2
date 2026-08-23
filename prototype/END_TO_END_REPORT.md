# Prototype Master End-to-End Nutrition Pipeline Report

**Generated At:** 2026-08-23T20:54:09.934Z
**Tested Cases Count:** 6 test groups (7 image files total)
**Pipeline Architecture:** Stage 1 (Vision Scout) → Stage 2 (Derivation Engine & Brand Matcher) → Stage 3 (Dietitian Agent)

---

## Pipeline Architecture & System Instructions

### 1. Vision Scout Agent System Instruction & Schema
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

### 2. Derivation Engine Logic (Pure TypeScript Formulas)
```typescript
// Derived Nutrient Formulas:
// - Carbohydrates (g) = Math.max(0, (Calories - (4 * Protein) - (9 * TotalFat)) / 4)
// - Unsaturated Fat (g) = Math.max(0, TotalFat - (SaturatedFat + TransFat))
// - Salt (g) = (Sodium in mg * 2.54) / 1000
```

### 3. Dietitian Agent System Instruction & Schema
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

---

## Summary of Test Execution Across All 6 Prototype Cases

### Case 1: `01_yolk_panini_wrap.jpg`

**Generated At:** 2026-08-23T20:54:17.486Z
**File(s):** `01_yolk_panini_wrap.jpg` | **Content Type:** `visual` | **Environment:** `fast_food_chain`

### 1. User Input Context & Active Clinical Biomarker Profile
- **User Prompt:** "I had it from Yolk"
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
> The image shows a meal from Yolk, consisting of a chicken sandwich or wrap cut in half wrapped in foil, a side of roasted broccoli and cabbage, and a side of roasted baby potatoes. There are also small sauce containers on the left.

#### Discovered Dishes & Per-Dish Core + Key Nutrients

##### Dish 1: Chicken Wrap / Sandwich (320g) [Image 0]
- **Brand / Chain:** Yolk (Official Brand DB)
- **Cooking Method:** grilled
- **Bounding Box:** `[79, 290, 482, 888]`
- **Ingredients:** bread, chicken breast, cheese, sauce, vegetables
- **Core Nutrients:** 680 kcal | 45g Protein | **62g Carbs [Derived]** | 28g Fat | 9g Sat Fat | 0g Trans Fat | 2g Added Sugar | 4g Fibre | 1180mg Sodium
- **Key Nutrients:** 4g Total Sugar | **19g Unsat Fat [Derived]** | **3g Salt [Derived]** | 450mg Potassium | 0.2g Omega-3 | 120mg Calcium | 3.2mg Iron | 45mg Magnesium | 0.5mcg Vit D

##### Dish 2: Roasted Broccoli and Cabbage (180g) [Image 0]
- **Brand / Chain:** Yolk
- **Cooking Method:** roasted
- **Bounding Box:** `[393, 0, 955, 420]`
- **Ingredients:** broccoli, cabbage, olive oil, seasonings
- **Core Nutrients:** 110 kcal | 5g Protein | **6.8g Carbs [Derived]** | 7g Fat | 1g Sat Fat | 0g Trans Fat | 0g Added Sugar | 6g Fibre | 220mg Sodium
- **Key Nutrients:** 4g Total Sugar | **6g Unsat Fat [Derived]** | **0.56g Salt [Derived]** | 510mg Potassium | 0.1g Omega-3 | 90mg Calcium | 1.5mg Iron | 35mg Magnesium | 0mcg Vit D

##### Dish 3: Roasted Baby Potatoes (200g) [Image 0]
- **Brand / Chain:** Yolk
- **Cooking Method:** roasted
- **Bounding Box:** `[375, 563, 912, 981]`
- **Ingredients:** baby potatoes, olive oil, salt, herbs
- **Core Nutrients:** 240 kcal | 4g Protein | **35.8g Carbs [Derived]** | 9g Fat | 0.8g Sat Fat | 0g Trans Fat | 0g Added Sugar | 3.5g Fibre | 300mg Sodium
- **Key Nutrients:** 1.5g Total Sugar | **8.2g Unsat Fat [Derived]** | **0.76g Salt [Derived]** | 750mg Potassium | 0g Omega-3 | 25mg Calcium | 2mg Iron | 50mg Magnesium | 0mcg Vit D

### 4. Stage 2 Output: Derivation Engine & Brand Database Matcher
> ⚠️ **Brand Database Replacement Notice:**
> - [BRAND DATABASE MATCH APPLIED]: Dish "Chicken Wrap / Sandwich" matched to official Yolk Brand Database entry. Initial Scout visual estimate (520 kcal) was REPLACED with official Yolk verified brand data (680 kcal, 45g Protein, 28g Total Fat, 9g Saturated Fat, 1180mg Sodium). Please review the total meal analysis in light of this brand replacement, highlight the change in your narrative, and update extended micronutrients as needed.

| Nutrient Category | Nutrient | Value |
| :--- | :--- | :--- |
| **Core (High Precision)** | Calories | 1030 kcal |
| **Core (High Precision)** | Protein | 54 g |
| **Core (High Precision)** | Saturated Fat | 10.8 g |
| **Core (High Precision)** | Trans Fat | 0 g |
| **Core (High Precision)** | Added Sugar | 2 g |
| **Core (High Precision)** | Total Fibre | 13.5 g |
| **Core (High Precision)** | Sodium | 1700 mg |
| **Core (Derived)** | **Carbohydrates** | **104.6 g** |
| **Key (Moderate Precision)** | Total Fat | 44 g |
| **Key (Moderate Precision)** | Total Sugar | 9.5 g |
| **Key (Moderate Precision)** | Potassium | 1710 mg |
| **Key (Moderate Precision)** | Omega-3 | 0.3 g |
| **Key (Moderate Precision)** | Calcium | 235 mg |
| **Key (Moderate Precision)** | Iron | 6.7 mg |
| **Key (Moderate Precision)** | Magnesium | 130 mg |
| **Key (Moderate Precision)** | Vitamin D | 0.5 mcg |
| **Key (Derived)** | **Unsaturated Fat** | **33.2 g** |
| **Key (Derived)** | **Salt** | **4.32 g** |

### 5. Stage 3 Output: Dietitian Clinical Coach Review & Extended Micronutrients
- **Verdict:** **1700mg sodium nears daily limit** (Level: `warning`)
- **Dietitian Message (4-Beat Narrative):**
  > You delivered 54g of muscle-building protein and 13.5g of fiber from the grilled chicken and roasted greens. However, the Yolk chicken wrap brings 1180mg of sodium, pushing your meal total to 1700mg—85% of your daily limit. This high sodium load causes transient vascular constriction and fluid retention. Drink extra water and take a 20-minute walk to support healthy circulation.
- **Accuracy Review Status:** ✅ **Scout Estimates Approved (No Correction Needed)**

##### Aggregate Extended Nutrients (Filled by Dietitian):
| Extended Nutrient (Directional Precision <50%) | Value |
| :--- | :--- |
| **Soluble Fibre** | 3.8 g |
| **Vitamin A** | 850 mcg |
| **Thiamine (B1)** | 0.45 mg |
| **Riboflavin (B2)** | 0.38 mg |
| **Niacin (B3)** | 9.2 mg |
| **Vitamin B6** | 0.85 mg |
| **Folate (B9)** | 145 mcg |
| **Vitamin B12** | 0.4 mcg |
| **Vitamin C** | 95 mg |
| **Vitamin E** | 4.1 mg |
| **Vitamin K** | 180 mcg |
| **Zinc** | 3.2 mg |
| **Selenium** | 35 mcg |
| **Iodine** | 25 mcg |
| **Phosphorus** | 520 mg |

#### Raw Payloads & JSON Output
<details><summary>Click to expand Raw Scout JSON</summary>

```json
{
  "_internalReasoning": "The image shows a meal from Yolk, consisting of a chicken sandwich or wrap cut in half wrapped in foil, a side of roasted broccoli and cabbage, and a side of roasted baby potatoes. There are also small sauce containers on the left.",
  "contentType": "visual",
  "diningEnvironment": "fast_food_chain",
  "items": [
    {
      "originalName": "Chicken Wrap / Sandwich",
      "chainName": "Yolk",
      "estimatedWeightGrams": 320,
      "cookingMethod": "grilled",
      "ingredients": [
        "bread",
        "chicken breast",
        "cheese",
        "sauce",
        "vegetables"
      ],
      "boundingBox2D": [
        [
          79,
          290,
          482,
          888
        ]
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 520,
        "protein": 38,
        "saturatedFat": 5,
        "transFat": 0,
        "addedSugar": 2,
        "totalFibre": 4,
        "sodium": 850,
        "totalFat": 18,
        "totalSugar": 4,
        "potassium": 450,
        "omega3": 0.2,
        "calcium": 120,
        "iron": 3.2,
        "magnesium": 45,
        "vitaminD": 0.5
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Roasted Broccoli and Cabbage",
      "chainName": "Yolk",
      "estimatedWeightGrams": 180,
      "cookingMethod": "roasted",
      "ingredients": [
        "broccoli",
        "cabbage",
        "olive oil",
        "seasonings"
      ],
      "boundingBox2D": [
        [
          393,
          0,
          955,
          420
        ]
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 110,
        "protein": 5,
        "saturatedFat": 1,
        "transFat": 0,
        "addedSugar": 0,
        "totalFibre": 6,
        "sodium": 220,
        "totalFat": 7,
        "totalSugar": 4,
        "potassium": 510,
        "omega3": 0.1,
        "calcium": 90,
        "iron": 1.5,
        "magnesium": 35,
        "vitaminD": 0
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Roasted Baby Potatoes",
      "chainName": "Yolk",
      "estimatedWeightGrams": 200,
      "cookingMethod": "roasted",
      "ingredients": [
        "baby potatoes",
        "olive oil",
        "salt",
        "herbs"
      ],
      "boundingBox2D": [
        [
          375,
          563,
          912,
          981
        ]
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 240,
        "protein": 4,
        "saturatedFat": 0.8,
        "transFat": 0,
        "addedSugar": 0,
        "totalFibre": 3.5,
        "sodium": 300,
        "totalFat": 9,
        "totalSugar": 1.5,
        "potassium": 750,
        "omega3": 0,
        "calcium": 25,
        "iron": 2,
        "magnesium": 50,
        "vitaminD": 0
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
  "_internalReasoning": "Evaluated the scanned meal featuring a Yolk brand chicken wrap, roasted broccoli and cabbage, and roasted baby potatoes. Brand database match applied for the wrap. The meal provides 54g of protein and 13.5g of fiber, but sodium reaches 1700mg (85% of limit) largely due to the wrap (1180mg). With mild hypertension and elevated LDL, the high sodium is the primary risk factor. Extended micronutrients estimated based on chicken, vegetables, and potatoes.",
  "verdict": {
    "label": "1700mg sodium nears daily limit",
    "level": "warning"
  },
  "message": "You delivered 54g of muscle-building protein and 13.5g of fiber from the grilled chicken and roasted greens. However, the Yolk chicken wrap brings 1180mg of sodium, pushing your meal total to 1700mg—85% of your daily limit. This high sodium load causes transient vascular constriction and fluid retention. Drink extra water and take a 20-minute walk to support healthy circulation.",
  "accuracyReview": {
    "isCorrected": false,
    "correctionNotes": "Brand data successfully applied for the Yolk chicken wrap; derived totals are physiologically sound and no further corrections needed.",
    "correctedMealNutrients": null
  },
  "extendedMealNutrients": {
    "solubleFibre": 3.8,
    "vitaminA": 850,
    "thiamine": 0.45,
    "riboflavin": 0.38,
    "niacin": 9.2,
    "vitaminB6": 0.85,
    "folate": 145,
    "vitaminB12": 0.4,
    "vitaminC": 95,
    "vitaminE": 4.1,
    "vitaminK": 180,
    "zinc": 3.2,
    "selenium": 35,
    "iodine": 25,
    "phosphorus": 520
  },
  "mealSummary": {
    "title": "Yolk Grilled Chicken Wrap with Roasted Vegetables & Potatoes",
    "itemsSummary": [
      {
        "scoutIndex": 0,
        "name": "Chicken Wrap / Sandwich",
        "weightGrams": 320,
        "foodType": "Entree",
        "cookingMethod": "grilled"
      },
      {
        "scoutIndex": 1,
        "name": "Roasted Broccoli and Cabbage",
        "weightGrams": 180,
        "foodType": "Vegetable Side",
        "cookingMethod": "roasted"
      },
      {
        "scoutIndex": 2,
        "name": "Roasted Baby Potatoes",
        "weightGrams": 200,
        "foodType": "Carbohydrate Side",
        "cookingMethod": "roasted"
      }
    ]
  }
}
```
</details>

---

### Case 2: `02_lidl_chicken_muffin.jpg`

**Generated At:** 2026-08-23T20:54:24.322Z
**File(s):** `02_lidl_chicken_muffin.jpg` | **Content Type:** `visual` | **Environment:** `unknown`

### 1. User Input Context & Active Clinical Biomarker Profile
- **User Prompt:** "Scanning product package & muffin for afternoon snack."
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
> The image shows two distinct items: a chocolate muffin on the left inside a paper/plastic bag, and a packaged food item (chicken bites) with visible nutrition information on the right. I will extract both items separately.

#### Discovered Dishes & Per-Dish Core + Key Nutrients

##### Dish 1: Chocolate Muffin (110g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** baked
- **Bounding Box:** `[311, 51, 719, 549]`
- **Ingredients:** flour, sugar, cocoa powder, butter, eggs, milk, chocolate chips, baking powder
- **Core Nutrients:** 420 kcal | 5.5g Protein | **54.5g Carbs [Derived]** | 20g Fat | 8g Sat Fat | 0.2g Trans Fat | 28g Added Sugar | 2.5g Fibre | 280mg Sodium
- **Key Nutrients:** 32g Total Sugar | **11.8g Unsat Fat [Derived]** | **0.71g Salt [Derived]** | 210mg Potassium | 0.05g Omega-3 | 60mg Calcium | 2.1mg Iron | 45mg Magnesium | 0.4mcg Vit D

##### Dish 2: Minced Chicken Bites (85g) [Image 0]
- **Brand / Chain:** Lidl
- **Cooking Method:** fried
- **Bounding Box:** `[117, 535, 878, 1000]`
- **Ingredients:** Minced Chicken Breast, Rapeseed Oil, Water, Salt, Dextrose, Yeast Extract, Spices, Maltodextrin, Sugar, Wheat Flour, Calcium Carbonate, Iron, Niacin, Thiamin, Maize Starch, Rice Flour, Barley Malt Extract, Tapioca Starch, Garlic, Onion, Spice Extracts, Lemon Extract
- **Core Nutrients:** 154 kcal | 16.2g Protein | **3.2g Carbs [Derived]** | 8.5g Fat | 1g Sat Fat | 0g Trans Fat | 0.5g Added Sugar | 0.4g Fibre | 408mg Sodium
- **Key Nutrients:** 2.9g Total Sugar | **7.5g Unsat Fat [Derived]** | **1.04g Salt [Derived]** | 220mg Potassium | 0.1g Omega-3 | 25mg Calcium | 1.2mg Iron | 20mg Magnesium | 0.1mcg Vit D

### 4. Stage 2 Output: Derivation Engine & Brand Database Matcher
| Nutrient Category | Nutrient | Value |
| :--- | :--- | :--- |
| **Core (High Precision)** | Calories | 574 kcal |
| **Core (High Precision)** | Protein | 21.7 g |
| **Core (High Precision)** | Saturated Fat | 9 g |
| **Core (High Precision)** | Trans Fat | 0.2 g |
| **Core (High Precision)** | Added Sugar | 28.5 g |
| **Core (High Precision)** | Total Fibre | 2.9 g |
| **Core (High Precision)** | Sodium | 688 mg |
| **Core (Derived)** | **Carbohydrates** | **57.7 g** |
| **Key (Moderate Precision)** | Total Fat | 28.5 g |
| **Key (Moderate Precision)** | Total Sugar | 34.9 g |
| **Key (Moderate Precision)** | Potassium | 430 mg |
| **Key (Moderate Precision)** | Omega-3 | 0.15 g |
| **Key (Moderate Precision)** | Calcium | 85 mg |
| **Key (Moderate Precision)** | Iron | 3.3 mg |
| **Key (Moderate Precision)** | Magnesium | 65 mg |
| **Key (Moderate Precision)** | Vitamin D | 0.5 mcg |
| **Key (Derived)** | **Unsaturated Fat** | **19.3 g** |
| **Key (Derived)** | **Salt** | **1.75 g** |

### 5. Stage 3 Output: Dietitian Clinical Coach Review & Extended Micronutrients
- **Verdict:** **118% over added sugar limit** (Level: `warning`)
- **Dietitian Message (4-Beat Narrative):**
  > You secured 21.7g of quality protein from the chicken bites. However, the chocolate muffin delivers 28.5g of added sugar, pushing today's total 118% over your daily limit. This high sugar load causes a sharp blood sugar spike, vascular stiffness, and sudden afternoon fatigue. Take a 20-minute post-meal walk to enhance glucose disposal, and load your next meal with leafy greens.
- **Accuracy Review Status:** ✅ **Scout Estimates Approved (No Correction Needed)**

##### Aggregate Extended Nutrients (Filled by Dietitian):
| Extended Nutrient (Directional Precision <50%) | Value |
| :--- | :--- |
| **Soluble Fibre** | 1.2 g |
| **Vitamin A** | 120 mcg |
| **Thiamine (B1)** | 0.22 mg |
| **Riboflavin (B2)** | 0.31 mg |
| **Niacin (B3)** | 3.4 mg |
| **Vitamin B6** | 0.28 mg |
| **Folate (B9)** | 45 mcg |
| **Vitamin B12** | 0.8 mcg |
| **Vitamin C** | 2.1 mg |
| **Vitamin E** | 1.5 mg |
| **Vitamin K** | 18 mcg |
| **Zinc** | 1.6 mg |
| **Selenium** | 16.5 mcg |
| **Iodine** | 20 mcg |
| **Phosphorus** | 210 mg |

#### Raw Payloads & JSON Output
<details><summary>Click to expand Raw Scout JSON</summary>

```json
{
  "_internalReasoning": "The image shows two distinct items: a chocolate muffin on the left inside a paper/plastic bag, and a packaged food item (chicken bites) with visible nutrition information on the right. I will extract both items separately.",
  "contentType": "visual",
  "diningEnvironment": "unknown",
  "items": [
    {
      "originalName": "Chocolate Muffin",
      "chainName": null,
      "estimatedWeightGrams": 110,
      "cookingMethod": "baked",
      "ingredients": [
        "flour",
        "sugar",
        "cocoa powder",
        "butter",
        "eggs",
        "milk",
        "chocolate chips",
        "baking powder"
      ],
      "boundingBox2D": [
        [
          311,
          51,
          719,
          549
        ]
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 420,
        "protein": 5.5,
        "saturatedFat": 8,
        "transFat": 0.2,
        "addedSugar": 28,
        "totalFibre": 2.5,
        "sodium": 280,
        "totalFat": 20,
        "totalSugar": 32,
        "potassium": 210,
        "omega3": 0.05,
        "calcium": 60,
        "iron": 2.1,
        "magnesium": 45,
        "vitaminD": 0.4
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Minced Chicken Bites",
      "chainName": "Lidl",
      "estimatedWeightGrams": 85,
      "cookingMethod": "fried",
      "ingredients": [
        "Minced Chicken Breast",
        "Rapeseed Oil",
        "Water",
        "Salt",
        "Dextrose",
        "Yeast Extract",
        "Spices",
        "Maltodextrin",
        "Sugar",
        "Wheat Flour",
        "Calcium Carbonate",
        "Iron",
        "Niacin",
        "Thiamin",
        "Maize Starch",
        "Rice Flour",
        "Barley Malt Extract",
        "Tapioca Starch",
        "Garlic",
        "Onion",
        "Spice Extracts",
        "Lemon Extract"
      ],
      "boundingBox2D": [
        [
          117,
          535,
          878,
          1000
        ]
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 154,
        "protein": 16.2,
        "saturatedFat": 1,
        "transFat": 0,
        "addedSugar": 0.5,
        "totalFibre": 0.4,
        "sodium": 408,
        "totalFat": 8.5,
        "totalSugar": 2.9,
        "potassium": 220,
        "omega3": 0.1,
        "calcium": 25,
        "iron": 1.2,
        "magnesium": 20,
        "vitaminD": 0.1
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
  "_internalReasoning": "Evaluated scanned meal containing a chocolate muffin and Lidl minced chicken bites for an afternoon snack. The meal contains 574 calories, 28.5g added sugar (exceeding the 24g daily limit), and 688mg sodium. Patient has prediabetes, elevated LDL, and mild hypertension. Focused beat structure on added sugar overage, blood sugar/vascular impact, and corrective movement/fiber steps.",
  "verdict": {
    "label": "118% over added sugar limit",
    "level": "warning"
  },
  "message": "You secured 21.7g of quality protein from the chicken bites. However, the chocolate muffin delivers 28.5g of added sugar, pushing today's total 118% over your daily limit. This high sugar load causes a sharp blood sugar spike, vascular stiffness, and sudden afternoon fatigue. Take a 20-minute post-meal walk to enhance glucose disposal, and load your next meal with leafy greens.",
  "accuracyReview": {
    "isCorrected": false,
    "correctionNotes": null,
    "correctedMealNutrients": null
  },
  "extendedMealNutrients": {
    "solubleFibre": 1.2,
    "vitaminA": 120,
    "thiamine": 0.22,
    "riboflavin": 0.31,
    "niacin": 3.4,
    "vitaminB6": 0.28,
    "folate": 45,
    "vitaminB12": 0.8,
    "vitaminC": 2.1,
    "vitaminE": 1.5,
    "vitaminK": 18,
    "zinc": 1.6,
    "selenium": 16.5,
    "iodine": 20,
    "phosphorus": 210
  },
  "mealSummary": {
    "title": "Chocolate Muffin and Minced Chicken Bites",
    "itemsSummary": [
      {
        "scoutIndex": 0,
        "name": "Chocolate Muffin",
        "weightGrams": 110,
        "foodType": "Bakery",
        "cookingMethod": "baked"
      },
      {
        "scoutIndex": 1,
        "name": "Minced Chicken Bites",
        "weightGrams": 85,
        "foodType": "Poultry",
        "cookingMethod": "fried"
      }
    ]
  }
}
```
</details>

---

### Case 3: `03_sushi_shrimp_salad.jpg`

**Generated At:** 2026-08-23T20:54:31.491Z
**File(s):** `03_sushi_shrimp_salad.jpg` | **Content Type:** `visual` | **Environment:** `casual_restaurant`

### 1. User Input Context & Active Clinical Biomarker Profile
- **User Prompt:** "I ate this for lunch and went for a short 15 minute walk afterwards."
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
> The image shows three distinct food items: a plastic container of sushi rolls on the left, a plastic container of shrimp pasta salad with dressing on the right, and a long baguette roll at the bottom. Each is extracted separately with its own bounding box, estimated weight, and comprehensive 15-nutrient profile.

#### Discovered Dishes & Per-Dish Core + Key Nutrients

##### Dish 1: Sushi Rolls (160g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** raw/assembled
- **Bounding Box:** `[125, 0, 664, 264]`
- **Ingredients:** sushi rice, salmon, avocado, nori
- **Core Nutrients:** 240 kcal | 8.5g Protein | **35.8g Carbs [Derived]** | 7g Fat | 1.2g Sat Fat | 0g Trans Fat | 2g Added Sugar | 2.5g Fibre | 350mg Sodium
- **Key Nutrients:** 2.5g Total Sugar | **5.8g Unsat Fat [Derived]** | **0.89g Salt [Derived]** | 310mg Potassium | 0.6g Omega-3 | 20mg Calcium | 1.1mg Iron | 35mg Magnesium | 4.5mcg Vit D

##### Dish 2: Shrimp Pasta Salad (320g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** boiled/assembled
- **Bounding Box:** `[170, 363, 756, 994]`
- **Ingredients:** shrimp, penne pasta, lettuce, carrots, creamy dressing
- **Core Nutrients:** 480 kcal | 26g Protein | **44.5g Carbs [Derived]** | 22g Fat | 5g Sat Fat | 0.1g Trans Fat | 3g Added Sugar | 3.5g Fibre | 720mg Sodium
- **Key Nutrients:** 5g Total Sugar | **16.9g Unsat Fat [Derived]** | **1.83g Salt [Derived]** | 380mg Potassium | 0.4g Omega-3 | 80mg Calcium | 2.2mg Iron | 45mg Magnesium | 0.5mcg Vit D

##### Dish 3: Baguette Roll (150g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** baked
- **Bounding Box:** `[738, 100, 998, 1000]`
- **Ingredients:** wheat flour, water, yeast, salt
- **Core Nutrients:** 390 kcal | 13.5g Protein | **80.6g Carbs [Derived]** | 1.5g Fat | 0.3g Sat Fat | 0g Trans Fat | 0.5g Added Sugar | 3g Fibre | 680mg Sodium
- **Key Nutrients:** 1g Total Sugar | **1.2g Unsat Fat [Derived]** | **1.73g Salt [Derived]** | 190mg Potassium | 0g Omega-3 | 25mg Calcium | 3.2mg Iron | 40mg Magnesium | 0mcg Vit D

### 4. Stage 2 Output: Derivation Engine & Brand Database Matcher
| Nutrient Category | Nutrient | Value |
| :--- | :--- | :--- |
| **Core (High Precision)** | Calories | 1110 kcal |
| **Core (High Precision)** | Protein | 48 g |
| **Core (High Precision)** | Saturated Fat | 6.5 g |
| **Core (High Precision)** | Trans Fat | 0.1 g |
| **Core (High Precision)** | Added Sugar | 5.5 g |
| **Core (High Precision)** | Total Fibre | 9 g |
| **Core (High Precision)** | Sodium | 1750 mg |
| **Core (Derived)** | **Carbohydrates** | **160.9 g** |
| **Key (Moderate Precision)** | Total Fat | 30.5 g |
| **Key (Moderate Precision)** | Total Sugar | 8.5 g |
| **Key (Moderate Precision)** | Potassium | 880 mg |
| **Key (Moderate Precision)** | Omega-3 | 1 g |
| **Key (Moderate Precision)** | Calcium | 125 mg |
| **Key (Moderate Precision)** | Iron | 6.5 mg |
| **Key (Moderate Precision)** | Magnesium | 120 mg |
| **Key (Moderate Precision)** | Vitamin D | 5 mcg |
| **Key (Derived)** | **Unsaturated Fat** | **23.9 g** |
| **Key (Derived)** | **Salt** | **4.45 g** |

### 5. Stage 3 Output: Dietitian Clinical Coach Review & Extended Micronutrients
- **Verdict:** **High carb and sodium load** (Level: `warning`)
- **Dietitian Message (4-Beat Narrative):**
  > You provided 48g of quality protein and healthy omega-3s from the salmon and shrimp. However, the refined flour and 160g of carbohydrates push blood glucose upward quickly, while the 1750mg of sodium strains vascular tension. This heavy starch and salt load induces sudden fatigue, thirst, and mild blood pressure elevation. Make your next meal rich in leafy greens and lean protein.
- **Accuracy Review Status:** ✅ **Scout Estimates Approved (No Correction Needed)**

##### Aggregate Extended Nutrients (Filled by Dietitian):
| Extended Nutrient (Directional Precision <50%) | Value |
| :--- | :--- |
| **Soluble Fibre** | 3.2 g |
| **Vitamin A** | 220 mcg |
| **Thiamine (B1)** | 0.45 mg |
| **Riboflavin (B2)** | 0.38 mg |
| **Niacin (B3)** | 4.2 mg |
| **Vitamin B6** | 0.4 mg |
| **Folate (B9)** | 110 mcg |
| **Vitamin B12** | 1.8 mcg |
| **Vitamin C** | 18 mg |
| **Vitamin E** | 2.1 mg |
| **Vitamin K** | 45 mcg |
| **Zinc** | 2.8 mg |
| **Selenium** | 35 mcg |
| **Iodine** | 42 mcg |
| **Phosphorus** | 390 mg |

#### Raw Payloads & JSON Output
<details><summary>Click to expand Raw Scout JSON</summary>

```json
{
  "_internalReasoning": "The image shows three distinct food items: a plastic container of sushi rolls on the left, a plastic container of shrimp pasta salad with dressing on the right, and a long baguette roll at the bottom. Each is extracted separately with its own bounding box, estimated weight, and comprehensive 15-nutrient profile.",
  "contentType": "visual",
  "diningEnvironment": "casual_restaurant",
  "items": [
    {
      "originalName": "Sushi Rolls",
      "chainName": null,
      "estimatedWeightGrams": 160,
      "cookingMethod": "raw/assembled",
      "ingredients": [
        "sushi rice",
        "salmon",
        "avocado",
        "nori"
      ],
      "boundingBox2D": [
        125,
        0,
        664,
        264
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 240,
        "protein": 8.5,
        "saturatedFat": 1.2,
        "transFat": 0,
        "addedSugar": 2,
        "totalFibre": 2.5,
        "sodium": 350,
        "totalFat": 7,
        "totalSugar": 2.5,
        "potassium": 310,
        "omega3": 0.6,
        "calcium": 20,
        "iron": 1.1,
        "magnesium": 35,
        "vitaminD": 4.5
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Shrimp Pasta Salad",
      "chainName": null,
      "estimatedWeightGrams": 320,
      "cookingMethod": "boiled/assembled",
      "ingredients": [
        "shrimp",
        "penne pasta",
        "lettuce",
        "carrots",
        "creamy dressing"
      ],
      "boundingBox2D": [
        170,
        363,
        756,
        994
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 480,
        "protein": 26,
        "saturatedFat": 5,
        "transFat": 0.1,
        "addedSugar": 3,
        "totalFibre": 3.5,
        "sodium": 720,
        "totalFat": 22,
        "totalSugar": 5,
        "potassium": 380,
        "omega3": 0.4,
        "calcium": 80,
        "iron": 2.2,
        "magnesium": 45,
        "vitaminD": 0.5
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Baguette Roll",
      "chainName": null,
      "estimatedWeightGrams": 150,
      "cookingMethod": "baked",
      "ingredients": [
        "wheat flour",
        "water",
        "yeast",
        "salt"
      ],
      "boundingBox2D": [
        738,
        100,
        998,
        1000
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 390,
        "protein": 13.5,
        "saturatedFat": 0.3,
        "transFat": 0,
        "addedSugar": 0.5,
        "totalFibre": 3,
        "sodium": 680,
        "totalFat": 1.5,
        "totalSugar": 1,
        "potassium": 190,
        "omega3": 0,
        "calcium": 25,
        "iron": 3.2,
        "magnesium": 40,
        "vitaminD": 0
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
  "_internalReasoning": "Evaluated the meal consisting of sushi rolls, shrimp pasta salad, and a baguette roll. Total calories 1110, sodium 1750mg (approaching the daily limit of 2000mg), carbs 160.9g. Given the prediabetes biomarker warning, the high simple carbohydrate and refined flour load will cause a sharp postprandial glucose spike despite the short walk. Sodium is also quite high for one meal, risking blood pressure elevation for the mild hypertension profile.",
  "verdict": {
    "label": "High carb and sodium load",
    "level": "warning"
  },
  "message": "You provided 48g of quality protein and healthy omega-3s from the salmon and shrimp. However, the refined flour and 160g of carbohydrates push blood glucose upward quickly, while the 1750mg of sodium strains vascular tension. This heavy starch and salt load induces sudden fatigue, thirst, and mild blood pressure elevation. Make your next meal rich in leafy greens and lean protein.",
  "accuracyReview": {
    "isCorrected": false,
    "correctionNotes": null,
    "correctedMealNutrients": null
  },
  "extendedMealNutrients": {
    "solubleFibre": 3.2,
    "vitaminA": 220,
    "thiamine": 0.45,
    "riboflavin": 0.38,
    "niacin": 4.2,
    "vitaminB6": 0.4,
    "folate": 110,
    "vitaminB12": 1.8,
    "vitaminC": 18,
    "vitaminE": 2.1,
    "vitaminK": 45,
    "zinc": 2.8,
    "selenium": 35,
    "iodine": 42,
    "phosphorus": 390
  },
  "mealSummary": {
    "title": "Sushi, Shrimp Pasta Salad, and Baguette",
    "itemsSummary": [
      {
        "scoutIndex": 0,
        "name": "Sushi Rolls",
        "weightGrams": 160,
        "foodType": "Seafood/Grain",
        "cookingMethod": "raw/assembled"
      },
      {
        "scoutIndex": 1,
        "name": "Shrimp Pasta Salad",
        "weightGrams": 320,
        "foodType": "Pasta/Seafood",
        "cookingMethod": "boiled/assembled"
      },
      {
        "scoutIndex": 2,
        "name": "Baguette Roll",
        "weightGrams": 150,
        "foodType": "Bakery",
        "cookingMethod": "baked"
      }
    ]
  }
}
```
</details>

---

### Case 4: `04_seaside_fish_chips.jpg`

**Generated At:** 2026-08-23T20:54:40.510Z
**File(s):** `04_seaside_fish_chips.jpg` | **Content Type:** `visual` | **Environment:** `casual_restaurant`

### 1. User Input Context & Active Clinical Biomarker Profile
- **User Prompt:** "Ate this meal at a seaside pub."
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
> The meal consists of five distinct items: a fruit cup (upper left), two croissants (upper center), a crispy chicken wrap (lower left), a chicken bacon avocado salad with eggs (lower center), and a macaroni and cheese dish (lower right). I will extract all 5 items with bounding boxes, ingredients, and realistic nutritional estimates.

#### Discovered Dishes & Per-Dish Core + Key Nutrients

##### Dish 1: Fruit Cup (250g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** raw
- **Bounding Box:** `[53, 85, 417, 323]`
- **Ingredients:** strawberries, blueberries, raspberries, melon, pineapple
- **Core Nutrients:** 110 kcal | 1.5g Protein | **24.9g Carbs [Derived]** | 0.5g Fat | 0.1g Sat Fat | 0g Trans Fat | 0g Added Sugar | 4.5g Fibre | 3mg Sodium
- **Key Nutrients:** 22g Total Sugar | **0.4g Unsat Fat [Derived]** | **0.01g Salt [Derived]** | 310mg Potassium | 0.1g Omega-3 | 35mg Calcium | 0.6mg Iron | 30mg Magnesium | 0mcg Vit D

##### Dish 2: Croissants (120g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** baked
- **Bounding Box:** `[83, 381, 362, 683]`
- **Ingredients:** flour, butter, milk, yeast, sugar, salt
- **Core Nutrients:** 460 kcal | 8g Protein | **48.5g Carbs [Derived]** | 26g Fat | 14g Sat Fat | 0.5g Trans Fat | 6g Added Sugar | 2g Fibre | 380mg Sodium
- **Key Nutrients:** 7g Total Sugar | **11.5g Unsat Fat [Derived]** | **0.97g Salt [Derived]** | 110mg Potassium | 0.1g Omega-3 | 30mg Calcium | 1.8mg Iron | 18mg Magnesium | 0.4mcg Vit D

##### Dish 3: Crispy chicken wrap (220g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** wrapped
- **Bounding Box:** `[363, 0, 996, 208]`
- **Ingredients:** tortilla wrap, crispy chicken, lettuce, crispy onion, gherkin, spicy mayonnaise
- **Core Nutrients:** 520 kcal | 22g Protein | **54g Carbs [Derived]** | 24g Fat | 4.5g Sat Fat | 0.1g Trans Fat | 3g Added Sugar | 3.5g Fibre | 820mg Sodium
- **Key Nutrients:** 4g Total Sugar | **19.4g Unsat Fat [Derived]** | **2.08g Salt [Derived]** | 280mg Potassium | 0.2g Omega-3 | 60mg Calcium | 2.5mg Iron | 35mg Magnesium | 0.3mcg Vit D

##### Dish 4: Chicken Bacon Avocado Salad (380g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** assembled
- **Bounding Box:** `[409, 169, 1000, 665]`
- **Ingredients:** mixed salad greens, grilled chicken breast, bacon, avocado, feta cheese, cherry tomatoes, boiled eggs, red onion
- **Core Nutrients:** 580 kcal | 42g Protein | **17.5g Carbs [Derived]** | 38g Fat | 9g Sat Fat | 0.1g Trans Fat | 0g Added Sugar | 8g Fibre | 950mg Sodium
- **Key Nutrients:** 5g Total Sugar | **28.9g Unsat Fat [Derived]** | **2.41g Salt [Derived]** | 920mg Potassium | 0.4g Omega-3 | 220mg Calcium | 3.8mg Iron | 75mg Magnesium | 1.5mcg Vit D

##### Dish 5: Macaroni and Cheese (300g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** boiled and baked
- **Bounding Box:** `[428, 638, 985, 990]`
- **Ingredients:** macaroni pasta, cheese sauce, cheddar cheese cubes
- **Core Nutrients:** 550 kcal | 20g Protein | **54.5g Carbs [Derived]** | 28g Fat | 12g Sat Fat | 0.5g Trans Fat | 1g Added Sugar | 2g Fibre | 720mg Sodium
- **Key Nutrients:** 3g Total Sugar | **15.5g Unsat Fat [Derived]** | **1.83g Salt [Derived]** | 180mg Potassium | 0.1g Omega-3 | 450mg Calcium | 2mg Iron | 40mg Magnesium | 0.5mcg Vit D

### 4. Stage 2 Output: Derivation Engine & Brand Database Matcher
| Nutrient Category | Nutrient | Value |
| :--- | :--- | :--- |
| **Core (High Precision)** | Calories | 2220 kcal |
| **Core (High Precision)** | Protein | 93.5 g |
| **Core (High Precision)** | Saturated Fat | 39.6 g |
| **Core (High Precision)** | Trans Fat | 1.2 g |
| **Core (High Precision)** | Added Sugar | 10 g |
| **Core (High Precision)** | Total Fibre | 20 g |
| **Core (High Precision)** | Sodium | 2873 mg |
| **Core (Derived)** | **Carbohydrates** | **199.4 g** |
| **Key (Moderate Precision)** | Total Fat | 116.5 g |
| **Key (Moderate Precision)** | Total Sugar | 41 g |
| **Key (Moderate Precision)** | Potassium | 1800 mg |
| **Key (Moderate Precision)** | Omega-3 | 0.9 g |
| **Key (Moderate Precision)** | Calcium | 795 mg |
| **Key (Moderate Precision)** | Iron | 10.7 mg |
| **Key (Moderate Precision)** | Magnesium | 198 mg |
| **Key (Moderate Precision)** | Vitamin D | 2.7 mcg |
| **Key (Derived)** | **Unsaturated Fat** | **75.7 g** |
| **Key (Derived)** | **Salt** | **7.3 g** |

### 5. Stage 3 Output: Dietitian Clinical Coach Review & Extended Micronutrients
- **Verdict:** **260% over saturated fat limit** (Level: `alert`)
- **Dietitian Message (4-Beat Narrative):**
  > You secured 93.5g of quality protein and 20g of fiber from the lean chicken and fresh fruit. However, the buttery croissants and mac and cheese pack 39.6g of saturated fat, pushing your limit 260% over. This heavy lipid load causes acute vascular stiffness and profound sluggishness. Take a 20-minute brisk walk to aid glucose uptake, and hydrate with water.
- **Accuracy Review Status:** ✅ **Scout Estimates Approved (No Correction Needed)**

##### Aggregate Extended Nutrients (Filled by Dietitian):
| Extended Nutrient (Directional Precision <50%) | Value |
| :--- | :--- |
| **Soluble Fibre** | 6.5 g |
| **Vitamin A** | 650 mcg |
| **Thiamine (B1)** | 0.55 mg |
| **Riboflavin (B2)** | 0.82 mg |
| **Niacin (B3)** | 12.5 mg |
| **Vitamin B6** | 0.95 mg |
| **Folate (B9)** | 140 mcg |
| **Vitamin B12** | 2.1 mcg |
| **Vitamin C** | 55 mg |
| **Vitamin E** | 4.5 mg |
| **Vitamin K** | 95 mcg |
| **Zinc** | 5.2 mg |
| **Selenium** | 45 mcg |
| **Iodine** | 55 mcg |
| **Phosphorus** | 920 mg |

#### Raw Payloads & JSON Output
<details><summary>Click to expand Raw Scout JSON</summary>

```json
{
  "_internalReasoning": "The meal consists of five distinct items: a fruit cup (upper left), two croissants (upper center), a crispy chicken wrap (lower left), a chicken bacon avocado salad with eggs (lower center), and a macaroni and cheese dish (lower right). I will extract all 5 items with bounding boxes, ingredients, and realistic nutritional estimates.",
  "contentType": "visual",
  "diningEnvironment": "casual_restaurant",
  "items": [
    {
      "originalName": "Fruit Cup",
      "chainName": null,
      "estimatedWeightGrams": 250,
      "cookingMethod": "raw",
      "ingredients": [
        "strawberries",
        "blueberries",
        "raspberries",
        "melon",
        "pineapple"
      ],
      "boundingBox2D": [
        53,
        85,
        417,
        323
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 110,
        "protein": 1.5,
        "saturatedFat": 0.1,
        "transFat": 0,
        "addedSugar": 0,
        "totalFibre": 4.5,
        "sodium": 3,
        "totalFat": 0.5,
        "totalSugar": 22,
        "potassium": 310,
        "omega3": 0.1,
        "calcium": 35,
        "iron": 0.6,
        "magnesium": 30,
        "vitaminD": 0
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Croissants",
      "chainName": null,
      "estimatedWeightGrams": 120,
      "cookingMethod": "baked",
      "ingredients": [
        "flour",
        "butter",
        "milk",
        "yeast",
        "sugar",
        "salt"
      ],
      "boundingBox2D": [
        83,
        381,
        362,
        683
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 460,
        "protein": 8,
        "saturatedFat": 14,
        "transFat": 0.5,
        "addedSugar": 6,
        "totalFibre": 2,
        "sodium": 380,
        "totalFat": 26,
        "totalSugar": 7,
        "potassium": 110,
        "omega3": 0.1,
        "calcium": 30,
        "iron": 1.8,
        "magnesium": 18,
        "vitaminD": 0.4
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Crispy chicken wrap",
      "chainName": null,
      "estimatedWeightGrams": 220,
      "cookingMethod": "wrapped",
      "ingredients": [
        "tortilla wrap",
        "crispy chicken",
        "lettuce",
        "crispy onion",
        "gherkin",
        "spicy mayonnaise"
      ],
      "boundingBox2D": [
        363,
        0,
        996,
        208
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 520,
        "protein": 22,
        "saturatedFat": 4.5,
        "transFat": 0.1,
        "addedSugar": 3,
        "totalFibre": 3.5,
        "sodium": 820,
        "totalFat": 24,
        "totalSugar": 4,
        "potassium": 280,
        "omega3": 0.2,
        "calcium": 60,
        "iron": 2.5,
        "magnesium": 35,
        "vitaminD": 0.3
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Chicken Bacon Avocado Salad",
      "chainName": null,
      "estimatedWeightGrams": 380,
      "cookingMethod": "assembled",
      "ingredients": [
        "mixed salad greens",
        "grilled chicken breast",
        "bacon",
        "avocado",
        "feta cheese",
        "cherry tomatoes",
        "boiled eggs",
        "red onion"
      ],
      "boundingBox2D": [
        409,
        169,
        1000,
        665
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 580,
        "protein": 42,
        "saturatedFat": 9,
        "transFat": 0.1,
        "addedSugar": 0,
        "totalFibre": 8,
        "sodium": 950,
        "totalFat": 38,
        "totalSugar": 5,
        "potassium": 920,
        "omega3": 0.4,
        "calcium": 220,
        "iron": 3.8,
        "magnesium": 75,
        "vitaminD": 1.5
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Macaroni and Cheese",
      "chainName": null,
      "estimatedWeightGrams": 300,
      "cookingMethod": "boiled and baked",
      "ingredients": [
        "macaroni pasta",
        "cheese sauce",
        "cheddar cheese cubes"
      ],
      "boundingBox2D": [
        428,
        638,
        985,
        990
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 550,
        "protein": 20,
        "saturatedFat": 12,
        "transFat": 0.5,
        "addedSugar": 1,
        "totalFibre": 2,
        "sodium": 720,
        "totalFat": 28,
        "totalSugar": 3,
        "potassium": 180,
        "omega3": 0.1,
        "calcium": 450,
        "iron": 2,
        "magnesium": 40,
        "vitaminD": 0.5
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
  "_internalReasoning": "The user consumed a large, highly dense pub meal totaling 2220 calories, 39.6g of saturated fat, and 2873mg of sodium. Given their prediabetes, elevated LDL, and mild hypertension, this meal significantly exceeds safe targets (e.g. 140%+ of daily saturated fat and sodium limits). The narrative is constructed in four precise beats addressing protein/fiber assets, sodium/sat fat overages, physical impacts (sluggishness, blood pressure spikes), and a corrective walk/fiber habit. Extended micronutrients are realistically estimated for an aggregate pub meal of ~1270g.",
  "verdict": {
    "label": "260% over saturated fat limit",
    "level": "alert"
  },
  "message": "You secured 93.5g of quality protein and 20g of fiber from the lean chicken and fresh fruit. However, the buttery croissants and mac and cheese pack 39.6g of saturated fat, pushing your limit 260% over. This heavy lipid load causes acute vascular stiffness and profound sluggishness. Take a 20-minute brisk walk to aid glucose uptake, and hydrate with water.",
  "accuracyReview": {
    "isCorrected": false,
    "correctionNotes": null,
    "correctedMealNutrients": null
  },
  "extendedMealNutrients": {
    "solubleFibre": 6.5,
    "vitaminA": 650,
    "thiamine": 0.55,
    "riboflavin": 0.82,
    "niacin": 12.5,
    "vitaminB6": 0.95,
    "folate": 140,
    "vitaminB12": 2.1,
    "vitaminC": 55,
    "vitaminE": 4.5,
    "vitaminK": 95,
    "zinc": 5.2,
    "selenium": 45,
    "iodine": 55,
    "phosphorus": 920
  },
  "mealSummary": {
    "title": "Pub Feast Spread",
    "itemsSummary": [
      {
        "scoutIndex": 0,
        "name": "Fruit Cup",
        "weightGrams": 250,
        "foodType": "Fruit",
        "cookingMethod": "raw"
      },
      {
        "scoutIndex": 1,
        "name": "Croissants",
        "weightGrams": 120,
        "foodType": "Bakery",
        "cookingMethod": "baked"
      },
      {
        "scoutIndex": 2,
        "name": "Crispy chicken wrap",
        "weightGrams": 220,
        "foodType": "Fast Food",
        "cookingMethod": "wrapped"
      },
      {
        "scoutIndex": 3,
        "name": "Chicken Bacon Avocado Salad",
        "weightGrams": 380,
        "foodType": "Salad",
        "cookingMethod": "assembled"
      },
      {
        "scoutIndex": 4,
        "name": "Macaroni and Cheese",
        "weightGrams": 300,
        "foodType": "Pasta",
        "cookingMethod": "boiled and baked"
      }
    ]
  }
}
```
</details>

---

### Case 5: `05_cafe_waffles_coffee.jpg`

**Generated At:** 2026-08-23T20:54:49.449Z
**File(s):** `05_cafe_waffles_coffee.jpg` | **Content Type:** `visual` | **Environment:** `airline`

### 1. User Input Context & Active Clinical Biomarker Profile
- **User Prompt:** "Weekend brunch at cafe."
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
> The image shows an airline breakfast meal tray containing a croissant, strawberry jam, butter, a molded dessert or fruit panna cotta/mousse, rice congee/porridge with vegetables and meat, and a cup of beverage/yogurt/milk tea.

#### Discovered Dishes & Per-Dish Core + Key Nutrients

##### Dish 1: Croissant (55g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** baked
- **Bounding Box:** `[521, 14, 1000, 275]`
- **Ingredients:** wheat flour, butter, water, yeast, sugar, salt
- **Core Nutrients:** 231 kcal | 4.5g Protein | **26.3g Carbs [Derived]** | 12g Fat | 8.1g Sat Fat | 0.2g Trans Fat | 3g Added Sugar | 1.3g Fibre | 200mg Sodium
- **Key Nutrients:** 3.5g Total Sugar | **3.7g Unsat Fat [Derived]** | **0.51g Salt [Derived]** | 65mg Potassium | 0.05g Omega-3 | 15mg Calcium | 0.8mg Iron | 10mg Magnesium | 0.2mcg Vit D

##### Dish 2: Strawberry Jam and Butter (24g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** packaged
- **Bounding Box:** `[78, 26, 308, 304]`
- **Ingredients:** strawberries, sugar, pectin, citric acid, butter, salt
- **Core Nutrients:** 95 kcal | 0.1g Protein | **9g Carbs [Derived]** | 6.5g Fat | 4g Sat Fat | 0.1g Trans Fat | 8.5g Added Sugar | 0.3g Fibre | 45mg Sodium
- **Key Nutrients:** 9g Total Sugar | **2.4g Unsat Fat [Derived]** | **0.11g Salt [Derived]** | 15mg Potassium | 0.02g Omega-3 | 5mg Calcium | 0.1mg Iron | 2mg Magnesium | 0.1mcg Vit D

##### Dish 3: Fruit Mousse / Dessert (120g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** chilled
- **Bounding Box:** `[1, 342, 354, 606]`
- **Ingredients:** cream, sugar, fruit puree, gelatin, food coloring
- **Core Nutrients:** 280 kcal | 3g Protein | **33.3g Carbs [Derived]** | 15g Fat | 10.5g Sat Fat | 0.3g Trans Fat | 22g Added Sugar | 0.5g Fibre | 55mg Sodium
- **Key Nutrients:** 24g Total Sugar | **4.2g Unsat Fat [Derived]** | **0.14g Salt [Derived]** | 110mg Potassium | 0.04g Omega-3 | 45mg Calcium | 0.2mg Iron | 8mg Magnesium | 0.3mcg Vit D

##### Dish 4: Congee (Rice Porridge with Chicken and Vegetables) (300g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** boiled
- **Bounding Box:** `[541, 289, 1000, 979]`
- **Ingredients:** rice, water, chicken, scallions, ginger, salt, white pepper
- **Core Nutrients:** 180 kcal | 8.5g Protein | **30.9g Carbs [Derived]** | 2.5g Fat | 0.5g Sat Fat | 0g Trans Fat | 0g Added Sugar | 1.5g Fibre | 420mg Sodium
- **Key Nutrients:** 0.8g Total Sugar | **2g Unsat Fat [Derived]** | **1.07g Salt [Derived]** | 140mg Potassium | 0.02g Omega-3 | 20mg Calcium | 1mg Iron | 22mg Magnesium | 0mcg Vit D

##### Dish 5: Milk Tea / Yogurt Drink (200g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** blended
- **Bounding Box:** `[30, 638, 485, 923]`
- **Ingredients:** milk, black tea extract, sugar
- **Core Nutrients:** 120 kcal | 4g Protein | **15.9g Carbs [Derived]** | 4.5g Fat | 3g Sat Fat | 0.1g Trans Fat | 10g Added Sugar | 0g Fibre | 70mg Sodium
- **Key Nutrients:** 12g Total Sugar | **1.4g Unsat Fat [Derived]** | **0.18g Salt [Derived]** | 160mg Potassium | 0.03g Omega-3 | 140mg Calcium | 0.1mg Iron | 15mg Magnesium | 1mcg Vit D

### 4. Stage 2 Output: Derivation Engine & Brand Database Matcher
| Nutrient Category | Nutrient | Value |
| :--- | :--- | :--- |
| **Core (High Precision)** | Calories | 906 kcal |
| **Core (High Precision)** | Protein | 20.1 g |
| **Core (High Precision)** | Saturated Fat | 26.1 g |
| **Core (High Precision)** | Trans Fat | 0.7 g |
| **Core (High Precision)** | Added Sugar | 43.5 g |
| **Core (High Precision)** | Total Fibre | 3.6 g |
| **Core (High Precision)** | Sodium | 790 mg |
| **Core (Derived)** | **Carbohydrates** | **115.4 g** |
| **Key (Moderate Precision)** | Total Fat | 40.5 g |
| **Key (Moderate Precision)** | Total Sugar | 49.3 g |
| **Key (Moderate Precision)** | Potassium | 490 mg |
| **Key (Moderate Precision)** | Omega-3 | 0.16 g |
| **Key (Moderate Precision)** | Calcium | 225 mg |
| **Key (Moderate Precision)** | Iron | 2.2 mg |
| **Key (Moderate Precision)** | Magnesium | 57 mg |
| **Key (Moderate Precision)** | Vitamin D | 1.6 mcg |
| **Key (Derived)** | **Unsaturated Fat** | **13.7 g** |
| **Key (Derived)** | **Salt** | **2.01 g** |

### 5. Stage 3 Output: Dietitian Clinical Coach Review & Extended Micronutrients
- **Verdict:** **174% over sat fat limit** (Level: `alert`)
- **Dietitian Message (4-Beat Narrative):**
  > You received 20g of protein and hydration from the warm chicken congee. However, the pastry, butter, and mousse add 26g of saturated fat and 43g of added sugar, pushing your saturated fat limit to 174%. This dense sugar-and-fat load triggers an immediate blood sugar spike, vascular stiffness, and sudden energy crashes. Take a 25-minute brisk walk to utilize excess glucose, and prioritize a high-fiber, plant-based dinner.
- **Accuracy Review Status:** ✅ **Scout Estimates Approved (No Correction Needed)**

##### Aggregate Extended Nutrients (Filled by Dietitian):
| Extended Nutrient (Directional Precision <50%) | Value |
| :--- | :--- |
| **Soluble Fibre** | 1.2 g |
| **Vitamin A** | 320 mcg |
| **Thiamine (B1)** | 0.22 mg |
| **Riboflavin (B2)** | 0.38 mg |
| **Niacin (B3)** | 2.4 mg |
| **Vitamin B6** | 0.28 mg |
| **Folate (B9)** | 45 mcg |
| **Vitamin B12** | 0.9 mcg |
| **Vitamin C** | 8.5 mg |
| **Vitamin E** | 2.1 mg |
| **Vitamin K** | 15 mcg |
| **Zinc** | 1.8 mg |
| **Selenium** | 14 mcg |
| **Iodine** | 25 mcg |
| **Phosphorus** | 210 mg |

#### Raw Payloads & JSON Output
<details><summary>Click to expand Raw Scout JSON</summary>

```json
{
  "_internalReasoning": "The image shows an airline breakfast meal tray containing a croissant, strawberry jam, butter, a molded dessert or fruit panna cotta/mousse, rice congee/porridge with vegetables and meat, and a cup of beverage/yogurt/milk tea.",
  "contentType": "visual",
  "diningEnvironment": "airline",
  "items": [
    {
      "originalName": "Croissant",
      "chainName": null,
      "estimatedWeightGrams": 55,
      "cookingMethod": "baked",
      "ingredients": [
        "wheat flour",
        "butter",
        "water",
        "yeast",
        "sugar",
        "salt"
      ],
      "boundingBox2D": [
        521,
        14,
        1000,
        275
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 231,
        "protein": 4.5,
        "saturatedFat": 8.1,
        "transFat": 0.2,
        "addedSugar": 3,
        "totalFibre": 1.3,
        "sodium": 200,
        "totalFat": 12,
        "totalSugar": 3.5,
        "potassium": 65,
        "omega3": 0.05,
        "calcium": 15,
        "iron": 0.8,
        "magnesium": 10,
        "vitaminD": 0.2
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Strawberry Jam and Butter",
      "chainName": null,
      "estimatedWeightGrams": 24,
      "cookingMethod": "packaged",
      "ingredients": [
        "strawberries",
        "sugar",
        "pectin",
        "citric acid",
        "butter",
        "salt"
      ],
      "boundingBox2D": [
        78,
        26,
        308,
        304
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 95,
        "protein": 0.1,
        "saturatedFat": 4,
        "transFat": 0.1,
        "addedSugar": 8.5,
        "totalFibre": 0.3,
        "sodium": 45,
        "totalFat": 6.5,
        "totalSugar": 9,
        "potassium": 15,
        "omega3": 0.02,
        "calcium": 5,
        "iron": 0.1,
        "magnesium": 2,
        "vitaminD": 0.1
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Fruit Mousse / Dessert",
      "chainName": null,
      "estimatedWeightGrams": 120,
      "cookingMethod": "chilled",
      "ingredients": [
        "cream",
        "sugar",
        "fruit puree",
        "gelatin",
        "food coloring"
      ],
      "boundingBox2D": [
        1,
        342,
        354,
        606
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 280,
        "protein": 3,
        "saturatedFat": 10.5,
        "transFat": 0.3,
        "addedSugar": 22,
        "totalFibre": 0.5,
        "sodium": 55,
        "totalFat": 15,
        "totalSugar": 24,
        "potassium": 110,
        "omega3": 0.04,
        "calcium": 45,
        "iron": 0.2,
        "magnesium": 8,
        "vitaminD": 0.3
      },
      "itemConfidence": "Medium"
    },
    {
      "originalName": "Congee (Rice Porridge with Chicken and Vegetables)",
      "chainName": null,
      "estimatedWeightGrams": 300,
      "cookingMethod": "boiled",
      "ingredients": [
        "rice",
        "water",
        "chicken",
        "scallions",
        "ginger",
        "salt",
        "white pepper"
      ],
      "boundingBox2D": [
        541,
        289,
        1000,
        979
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 180,
        "protein": 8.5,
        "saturatedFat": 0.5,
        "transFat": 0,
        "addedSugar": 0,
        "totalFibre": 1.5,
        "sodium": 420,
        "totalFat": 2.5,
        "totalSugar": 0.8,
        "potassium": 140,
        "omega3": 0.02,
        "calcium": 20,
        "iron": 1,
        "magnesium": 22,
        "vitaminD": 0
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Milk Tea / Yogurt Drink",
      "chainName": null,
      "estimatedWeightGrams": 200,
      "cookingMethod": "blended",
      "ingredients": [
        "milk",
        "black tea extract",
        "sugar"
      ],
      "boundingBox2D": [
        30,
        638,
        485,
        923
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 120,
        "protein": 4,
        "saturatedFat": 3,
        "transFat": 0.1,
        "addedSugar": 10,
        "totalFibre": 0,
        "sodium": 70,
        "totalFat": 4.5,
        "totalSugar": 12,
        "potassium": 160,
        "omega3": 0.03,
        "calcium": 140,
        "iron": 0.1,
        "magnesium": 15,
        "vitaminD": 1
      },
      "itemConfidence": "Medium"
    }
  ]
}
```
</details>

<details><summary>Click to expand Raw Dietitian JSON</summary>

```json
{
  "_internalReasoning": "Evaluated the weekend brunch meal. High saturated fat (26.1g vs 15g limit) and added sugars (43.5g vs 24g limit) from croissant, butter, jam, mousse, and milk tea. Protein is moderate (20.1g) from the congee. Given prediabetes, elevated LDL, and mild hypertension, this heavy sugar and sat-fat combination will spike postprandial glucose and lipid levels. Formulated clinical message and micro-nutrient estimates.",
  "verdict": {
    "label": "174% over sat fat limit",
    "level": "alert"
  },
  "message": "You received 20g of protein and hydration from the warm chicken congee. However, the pastry, butter, and mousse add 26g of saturated fat and 43g of added sugar, pushing your saturated fat limit to 174%. This dense sugar-and-fat load triggers an immediate blood sugar spike, vascular stiffness, and sudden energy crashes. Take a 25-minute brisk walk to utilize excess glucose, and prioritize a high-fiber, plant-based dinner.",
  "accuracyReview": {
    "isCorrected": false,
    "correctionNotes": null,
    "correctedMealNutrients": null
  },
  "extendedMealNutrients": {
    "solubleFibre": 1.2,
    "vitaminA": 320,
    "thiamine": 0.22,
    "riboflavin": 0.38,
    "niacin": 2.4,
    "vitaminB6": 0.28,
    "folate": 45,
    "vitaminB12": 0.9,
    "vitaminC": 8.5,
    "vitaminE": 2.1,
    "vitaminK": 15,
    "zinc": 1.8,
    "selenium": 14,
    "iodine": 25,
    "phosphorus": 210
  },
  "mealSummary": {
    "title": "Weekend Café Brunch",
    "itemsSummary": [
      {
        "scoutIndex": 0,
        "name": "Croissant",
        "weightGrams": 55,
        "foodType": "bakery",
        "cookingMethod": "baked"
      },
      {
        "scoutIndex": 1,
        "name": "Strawberry Jam and Butter",
        "weightGrams": 24,
        "foodType": "spread",
        "cookingMethod": "packaged"
      },
      {
        "scoutIndex": 2,
        "name": "Fruit Mousse / Dessert",
        "weightGrams": 120,
        "foodType": "dessert",
        "cookingMethod": "chilled"
      },
      {
        "scoutIndex": 3,
        "name": "Congee with Chicken",
        "weightGrams": 300,
        "foodType": "porridge",
        "cookingMethod": "boiled"
      },
      {
        "scoutIndex": 4,
        "name": "Milk Tea",
        "weightGrams": 200,
        "foodType": "beverage",
        "cookingMethod": "blended"
      }
    ]
  }
}
```
</details>

---

### Case 6: `06_indonesian_menu (Sambal Bakar Pencok 89)`

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

---

