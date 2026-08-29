# Prototype Master End-to-End Nutrition Pipeline Report

**Generated At:** 2026-08-23T22:42:30.623Z
**Evaluated Model:** `gemini-3.5-flash-lite` (Strictly used for all Stage 1 Scout & Stage 3 Dietitian calls)
**Tested Cases Count:** 7 test groups (8 image files total)
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
- USER MESSAGE SCOPE ANCHOR & MULTI-DISH EXTRACTION: Extract EVERY distinct food, drink, side, companion plate, or meal item visible in the photo or menu/kiosk screen as its own separate entry in 'items' (e.g. if 2 dishes or a main + drink or a mug + plate of fruits are visible, output separate item objects for each). Do NOT combine distinct dishes into 1 item.
- If user's text message specifies a portion/weight (e.g. "50g of oats + fruits" or "60g of sainsbury rolled oat + fruits"), assign logically. The user's explicit text sentence is absolute ground truth.
- BRAND SEPARATION: When user mentions brand + staples (e.g. "Sainsbury oat + fruit"), apply 'chainName' strictly to the branded item ("Sainsbury oat"). Emit whole companion foods (fruits, drinks, sides) as separate unbranded items (e.g. extract Banana, Apple, Plum as separate whole fruit items).
- For each item, provide a 2D bounding box 'boundingBox2D': [ymin, xmin, ymax, xmax] in normalized 0-1000 coordinate space identifying the exact region of the image containing the item.
- Specify 'sourceImageIndex': integer index of the input image (0 for single image).
- Identify 'chainName': restaurant chain or brand name if applicable (e.g. 'Starbucks', 'McDonald's', 'Pret', 'Sainsbury's'), or null if home-cooked / unbranded.

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

## Summary of Test Execution Across All Prototype Cases

### Case 1: `01_yolk_panini_wrap.jpg`

**Generated At:** 2026-08-23T22:42:42.886Z
**Evaluated Model:** `gemini-3.5-flash-lite` (Strictly used for both Stage 1 Scout & Stage 3 Dietitian)
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
- USER MESSAGE SCOPE ANCHOR & MULTI-DISH EXTRACTION: Extract EVERY distinct food, drink, side, companion plate, or meal item visible in the photo or menu/kiosk screen as its own separate entry in 'items' (e.g. if 2 dishes or a main + drink or a mug + plate of fruits are visible, output separate item objects for each). Do NOT combine distinct dishes into 1 item.
- If user's text message specifies a portion/weight (e.g. "50g of oats + fruits" or "60g of sainsbury rolled oat + fruits"), assign logically. The user's explicit text sentence is absolute ground truth.
- BRAND SEPARATION: When user mentions brand + staples (e.g. "Sainsbury oat + fruit"), apply 'chainName' strictly to the branded item ("Sainsbury oat"). Emit whole companion foods (fruits, drinks, sides) as separate unbranded items (e.g. extract Banana, Apple, Plum as separate whole fruit items).
- For each item, provide a 2D bounding box 'boundingBox2D': [ymin, xmin, ymax, xmax] in normalized 0-1000 coordinate space identifying the exact region of the image containing the item.
- Specify 'sourceImageIndex': integer index of the input image (0 for single image).
- Identify 'chainName': restaurant chain or brand name if applicable (e.g. 'Starbucks', 'McDonald's', 'Pret', 'Sainsbury's'), or null if home-cooked / unbranded.

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
> The user provided an image showing a meal from 'Yolk' containing a sandwich cut in half wrapped partly in foil, a side of roasted/steamed broccoli, and a side of small roasted potatoes, along with small plastic condiment cups. I will extract three distinct items: the sandwich, the broccoli side, and the potato side.

#### Discovered Dishes & Per-Dish Core + Key Nutrients

##### Dish 1: Chicken Sandwich Halves (320g) [Image 0]
- **Brand / Chain:** Yolk (Official Brand DB)
- **Cooking Method:** grilled
- **Bounding Box:** `[72, 291, 479, 891]`
- **Ingredients:** bread, chicken, cheese, sauce, vegetables
- **Core Nutrients:** 680 kcal | 45g Protein | **62g Carbs [Derived]** | 28g Fat | 9g Sat Fat | 0g Trans Fat | 4g Added Sugar | 4g Fibre | 1180mg Sodium
- **Key Nutrients:** 6g Total Sugar | **19g Unsat Fat [Derived]** | **3g Salt [Derived]** | 450mg Potassium | 0.2g Omega-3 | 220mg Calcium | 3.5mg Iron | 45mg Magnesium | 0.5mcg Vit D

##### Dish 2: Roasted Broccoli Side (150g) [Image 0]
- **Brand / Chain:** Yolk
- **Cooking Method:** roasted
- **Bounding Box:** `[425, 0, 919, 418]`
- **Ingredients:** broccoli, oil, seasoning
- **Core Nutrients:** 90 kcal | 4g Protein | **7.3g Carbs [Derived]** | 5g Fat | 0.5g Sat Fat | 0g Trans Fat | 0g Added Sugar | 5g Fibre | 200mg Sodium
- **Key Nutrients:** 2g Total Sugar | **4.5g Unsat Fat [Derived]** | **0.51g Salt [Derived]** | 380mg Potassium | 0.1g Omega-3 | 60mg Calcium | 1.2mg Iron | 30mg Magnesium | 0mcg Vit D

##### Dish 3: Roasted Baby Potatoes Side (180g) [Image 0]
- **Brand / Chain:** Yolk
- **Cooking Method:** roasted
- **Bounding Box:** `[377, 561, 910, 982]`
- **Ingredients:** baby potatoes, oil, salt, herbs
- **Core Nutrients:** 220 kcal | 4g Protein | **33g Carbs [Derived]** | 8g Fat | 1g Sat Fat | 0g Trans Fat | 0g Added Sugar | 3.5g Fibre | 320mg Sodium
- **Key Nutrients:** 1g Total Sugar | **7g Unsat Fat [Derived]** | **0.81g Salt [Derived]** | 650mg Potassium | 0g Omega-3 | 25mg Calcium | 2mg Iron | 45mg Magnesium | 0mcg Vit D

### 4. Stage 2 Output: Derivation Engine & Brand Database Matcher
> ⚠️ **Brand Database Replacement Notice:**
> - [BRAND DATABASE MATCH APPLIED]: Dish "Chicken Sandwich Halves" matched to official Yolk Brand Database entry. Initial Scout visual estimate (650 kcal) was REPLACED with official Yolk verified brand data (680 kcal, 45g Protein, 28g Total Fat, 9g Saturated Fat, 1180mg Sodium).

| Nutrient Category | Nutrient | Value |
| :--- | :--- | :--- |
| **Core (High Precision)** | Calories | 990 kcal |
| **Core (High Precision)** | Protein | 53 g |
| **Core (High Precision)** | Saturated Fat | 10.5 g |
| **Core (High Precision)** | Trans Fat | 0 g |
| **Core (High Precision)** | Added Sugar | 4 g |
| **Core (High Precision)** | Total Fibre | 12.5 g |
| **Core (High Precision)** | Sodium | 1700 mg |
| **Core (Derived)** | **Carbohydrates** | **102.3 g** |
| **Key (Moderate Precision)** | Total Fat | 41 g |
| **Key (Moderate Precision)** | Total Sugar | 9 g |
| **Key (Moderate Precision)** | Potassium | 1480 mg |
| **Key (Moderate Precision)** | Omega-3 | 0.3 g |
| **Key (Moderate Precision)** | Calcium | 305 mg |
| **Key (Moderate Precision)** | Iron | 6.7 mg |
| **Key (Moderate Precision)** | Magnesium | 120 mg |
| **Key (Moderate Precision)** | Vitamin D | 0.5 mcg |
| **Key (Derived)** | **Unsaturated Fat** | **30.5 g** |
| **Key (Derived)** | **Salt** | **4.32 g** |

### 5. Stage 3 Output: Dietitian Clinical Coach Review & Extended Micronutrients
- **Verdict:** **High protein with elevated sodium** (Level: `warning`)
- **Dietitian Message (4-Beat Narrative):**
  > You got 53g of quality lean protein and 12.5g of gut-healthy fibre from the chicken and roasted broccoli. However, the meal contains 1700mg of sodium, pushing close to your daily limit within a single sitting. This high salt load causes temporary fluid retention, blood vessel constriction, and a spike in blood pressure. Take a 20-minute post-meal walk to assist circulation, and prioritize low-sodium hydration for the rest of the day.
- **Accuracy Review Status:** ✅ **Scout Estimates Approved (No Correction Needed)**

##### Aggregate Extended Nutrients (Filled by Dietitian):
| Extended Nutrient (Directional Precision <50%) | Value |
| :--- | :--- |
| **Soluble Fibre** | 3.8 g |
| **Vitamin A** | 320 mcg |
| **Thiamine (B1)** | 0.45 mg |
| **Riboflavin (B2)** | 0.38 mg |
| **Niacin (B3)** | 8.5 mg |
| **Vitamin B6** | 0.72 mg |
| **Folate (B9)** | 145 mcg |
| **Vitamin B12** | 0.8 mcg |
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
  "_internalReasoning": "The user provided an image showing a meal from 'Yolk' containing a sandwich cut in half wrapped partly in foil, a side of roasted/steamed broccoli, and a side of small roasted potatoes, along with small plastic condiment cups. I will extract three distinct items: the sandwich, the broccoli side, and the potato side.",
  "contentType": "visual",
  "diningEnvironment": "fast_food_chain",
  "items": [
    {
      "originalName": "Chicken Sandwich Halves",
      "chainName": "Yolk",
      "estimatedWeightGrams": 320,
      "cookingMethod": "grilled",
      "ingredients": [
        "bread",
        "chicken",
        "cheese",
        "sauce",
        "vegetables"
      ],
      "boundingBox2D": [
        72,
        291,
        479,
        891
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 650,
        "protein": 42,
        "saturatedFat": 6.5,
        "transFat": 0,
        "addedSugar": 4,
        "totalFibre": 4,
        "sodium": 980,
        "totalFat": 24,
        "totalSugar": 6,
        "potassium": 450,
        "omega3": 0.2,
        "calcium": 220,
        "iron": 3.5,
        "magnesium": 45,
        "vitaminD": 0.5
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Roasted Broccoli Side",
      "chainName": "Yolk",
      "estimatedWeightGrams": 150,
      "cookingMethod": "roasted",
      "ingredients": [
        "broccoli",
        "oil",
        "seasoning"
      ],
      "boundingBox2D": [
        425,
        0,
        919,
        418
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 90,
        "protein": 4,
        "saturatedFat": 0.5,
        "transFat": 0,
        "addedSugar": 0,
        "totalFibre": 5,
        "sodium": 200,
        "totalFat": 5,
        "totalSugar": 2,
        "potassium": 380,
        "omega3": 0.1,
        "calcium": 60,
        "iron": 1.2,
        "magnesium": 30,
        "vitaminD": 0
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Roasted Baby Potatoes Side",
      "chainName": "Yolk",
      "estimatedWeightGrams": 180,
      "cookingMethod": "roasted",
      "ingredients": [
        "baby potatoes",
        "oil",
        "salt",
        "herbs"
      ],
      "boundingBox2D": [
        377,
        561,
        910,
        982
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 220,
        "protein": 4,
        "saturatedFat": 1,
        "transFat": 0,
        "addedSugar": 0,
        "totalFibre": 3.5,
        "sodium": 320,
        "totalFat": 8,
        "totalSugar": 1,
        "potassium": 650,
        "omega3": 0,
        "calcium": 25,
        "iron": 2,
        "magnesium": 45,
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
  "_internalReasoning": "Evaluated the meal consisting of Yolk Chicken Sandwich Halves, Roasted Broccoli Side, and Roasted Baby Potatoes. Integrated official brand database match for the sandwich. Noted high protein (53g) and fibre (12.5g) alongside elevated sodium (1700mg) which impacts hypertension and prediabetes. Generated extended micronutrients for the aggregate meal and formulated the response following all clinical guidelines.",
  "verdict": {
    "label": "High protein with elevated sodium",
    "level": "warning"
  },
  "message": "You got 53g of quality lean protein and 12.5g of gut-healthy fibre from the chicken and roasted broccoli. However, the meal contains 1700mg of sodium, pushing close to your daily limit within a single sitting. This high salt load causes temporary fluid retention, blood vessel constriction, and a spike in blood pressure. Take a 20-minute post-meal walk to assist circulation, and prioritize low-sodium hydration for the rest of the day.",
  "accuracyReview": {
    "isCorrected": false,
    "correctionNotes": null,
    "correctedMealNutrients": null
  },
  "extendedMealNutrients": {
    "solubleFibre": 3.8,
    "vitaminA": 320,
    "thiamine": 0.45,
    "riboflavin": 0.38,
    "niacin": 8.5,
    "vitaminB6": 0.72,
    "folate": 145,
    "vitaminB12": 0.8,
    "vitaminC": 95,
    "vitaminE": 4.1,
    "vitaminK": 180,
    "zinc": 3.2,
    "selenium": 35,
    "iodine": 25,
    "phosphorus": 520
  },
  "mealSummary": {
    "title": "Yolk Chicken Sandwich with Roasted Veggies",
    "itemsSummary": [
      {
        "scoutIndex": 0,
        "name": "Chicken Sandwich Halves",
        "weightGrams": 320,
        "foodType": "sandwich",
        "cookingMethod": "grilled"
      },
      {
        "scoutIndex": 1,
        "name": "Roasted Broccoli Side",
        "weightGrams": 150,
        "foodType": "vegetable",
        "cookingMethod": "roasted"
      },
      {
        "scoutIndex": 2,
        "name": "Roasted Baby Potatoes Side",
        "weightGrams": 180,
        "foodType": "starch",
        "cookingMethod": "roasted"
      }
    ]
  }
}
```
</details>

---

### Case 2: `02_lidl_chicken_muffin.jpg`

**Generated At:** 2026-08-23T22:42:52.565Z
**Evaluated Model:** `gemini-3.5-flash-lite` (Strictly used for both Stage 1 Scout & Stage 3 Dietitian)
**File(s):** `02_lidl_chicken_muffin.jpg` | **Content Type:** `visual` | **Environment:** `casual_restaurant`

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
- USER MESSAGE SCOPE ANCHOR & MULTI-DISH EXTRACTION: Extract EVERY distinct food, drink, side, companion plate, or meal item visible in the photo or menu/kiosk screen as its own separate entry in 'items' (e.g. if 2 dishes or a main + drink or a mug + plate of fruits are visible, output separate item objects for each). Do NOT combine distinct dishes into 1 item.
- If user's text message specifies a portion/weight (e.g. "50g of oats + fruits" or "60g of sainsbury rolled oat + fruits"), assign logically. The user's explicit text sentence is absolute ground truth.
- BRAND SEPARATION: When user mentions brand + staples (e.g. "Sainsbury oat + fruit"), apply 'chainName' strictly to the branded item ("Sainsbury oat"). Emit whole companion foods (fruits, drinks, sides) as separate unbranded items (e.g. extract Banana, Apple, Plum as separate whole fruit items).
- For each item, provide a 2D bounding box 'boundingBox2D': [ymin, xmin, ymax, xmax] in normalized 0-1000 coordinate space identifying the exact region of the image containing the item.
- Specify 'sourceImageIndex': integer index of the input image (0 for single image).
- Identify 'chainName': restaurant chain or brand name if applicable (e.g. 'Starbucks', 'McDonald's', 'Pret', 'Sainsbury's'), or null if home-cooked / unbranded.

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
> The image shows two distinct items: a chocolate muffin on the left (likely from a bakery/cafe like Pret, given the bag logo) and a packaged Lidl southern fried chicken bites product showing its nutrition label on the right. I have extracted both items separately as requested.

#### Discovered Dishes & Per-Dish Core + Key Nutrients

##### Dish 1: Chocolate Muffin (110g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** baked
- **Bounding Box:** `[310, 47, 720, 553]`
- **Ingredients:** flour, sugar, cocoa powder, butter, milk, eggs, chocolate chips
- **Core Nutrients:** 420 kcal | 5g Protein | **55g Carbs [Derived]** | 20g Fat | 8g Sat Fat | 0.2g Trans Fat | 28g Added Sugar | 3g Fibre | 220mg Sodium
- **Key Nutrients:** 32g Total Sugar | **11.8g Unsat Fat [Derived]** | **0.56g Salt [Derived]** | 180mg Potassium | 0.1g Omega-3 | 50mg Calcium | 2.1mg Iron | 45mg Magnesium | 0.5mcg Vit D

##### Dish 2: Southern Fried Minced Chicken Bites (85g) [Image 0]
- **Brand / Chain:** Lidl
- **Cooking Method:** cooked
- **Bounding Box:** `[116, 532, 882, 992]`
- **Ingredients:** Minced Chicken Breast, Rapeseed Oil, Water, Salt, Dextrose, Yeast Extract, Spices, Maltodextrin, Sugar, Wheat Flour, Calcium Carbonate, Iron, Niacin, Thiamin, Maize Starch, Rice Flour, Barley Malt Extract, Tapioca Starch, Garlic, Onion, Spice Extracts, Lemon Extract
- **Core Nutrients:** 154 kcal | 16.2g Protein | **3.2g Carbs [Derived]** | 8.5g Fat | 1g Sat Fat | 0g Trans Fat | 1.2g Added Sugar | 0.5g Fibre | 408mg Sodium
- **Key Nutrients:** 1.3g Total Sugar | **7.5g Unsat Fat [Derived]** | **1.04g Salt [Derived]** | 210mg Potassium | 0.2g Omega-3 | 20mg Calcium | 1.5mg Iron | 25mg Magnesium | 0.2mcg Vit D

### 4. Stage 2 Output: Derivation Engine & Brand Database Matcher
| Nutrient Category | Nutrient | Value |
| :--- | :--- | :--- |
| **Core (High Precision)** | Calories | 574 kcal |
| **Core (High Precision)** | Protein | 21.2 g |
| **Core (High Precision)** | Saturated Fat | 9 g |
| **Core (High Precision)** | Trans Fat | 0.2 g |
| **Core (High Precision)** | Added Sugar | 29.2 g |
| **Core (High Precision)** | Total Fibre | 3.5 g |
| **Core (High Precision)** | Sodium | 628 mg |
| **Core (Derived)** | **Carbohydrates** | **58.2 g** |
| **Key (Moderate Precision)** | Total Fat | 28.5 g |
| **Key (Moderate Precision)** | Total Sugar | 33.3 g |
| **Key (Moderate Precision)** | Potassium | 390 mg |
| **Key (Moderate Precision)** | Omega-3 | 0.3 g |
| **Key (Moderate Precision)** | Calcium | 70 mg |
| **Key (Moderate Precision)** | Iron | 3.6 mg |
| **Key (Moderate Precision)** | Magnesium | 70 mg |
| **Key (Moderate Precision)** | Vitamin D | 0.7 mcg |
| **Key (Derived)** | **Unsaturated Fat** | **19.3 g** |
| **Key (Derived)** | **Salt** | **1.6 g** |

### 5. Stage 3 Output: Dietitian Clinical Coach Review & Extended Micronutrients
- **Verdict:** **122% over added sugar limit** (Level: `alert`)
- **Dietitian Message (4-Beat Narrative):**
  > You secured 21.2g of quality protein from the chicken bites, but the chocolate muffin brings 29.2g of added sugar, pushing this single snack 122% over your daily added sugar limit. This heavy sugar spike triggers an immediate insulin surge, leaving you feeling fatigued and driving up your blood pressure. Take a 15-minute brisk walk to stabilize your glucose, and choose high-fiber, unsweetened snacks next time.
- **Accuracy Review Status:** ✅ **Scout Estimates Approved (No Correction Needed)**

##### Aggregate Extended Nutrients (Filled by Dietitian):
| Extended Nutrient (Directional Precision <50%) | Value |
| :--- | :--- |
| **Soluble Fibre** | 1.2 g |
| **Vitamin A** | 120 mcg |
| **Thiamine (B1)** | 0.22 mg |
| **Riboflavin (B2)** | 0.25 mg |
| **Niacin (B3)** | 2.8 mg |
| **Vitamin B6** | 0.18 mg |
| **Folate (B9)** | 45 mcg |
| **Vitamin B12** | 0.6 mcg |
| **Vitamin C** | 1.5 mg |
| **Vitamin E** | 1.8 mg |
| **Vitamin K** | 12 mcg |
| **Zinc** | 1.1 mg |
| **Selenium** | 14.5 mcg |
| **Iodine** | 18 mcg |
| **Phosphorus** | 180 mg |

#### Raw Payloads & JSON Output
<details><summary>Click to expand Raw Scout JSON</summary>

```json
{
  "_internalReasoning": "The image shows two distinct items: a chocolate muffin on the left (likely from a bakery/cafe like Pret, given the bag logo) and a packaged Lidl southern fried chicken bites product showing its nutrition label on the right. I have extracted both items separately as requested.",
  "contentType": "visual",
  "diningEnvironment": "casual_restaurant",
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
        "milk",
        "eggs",
        "chocolate chips"
      ],
      "boundingBox2D": [
        310,
        47,
        720,
        553
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 420,
        "protein": 5,
        "saturatedFat": 8,
        "transFat": 0.2,
        "addedSugar": 28,
        "totalFibre": 3,
        "sodium": 220,
        "totalFat": 20,
        "totalSugar": 32,
        "potassium": 180,
        "omega3": 0.1,
        "calcium": 50,
        "iron": 2.1,
        "magnesium": 45,
        "vitaminD": 0.5
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Southern Fried Minced Chicken Bites",
      "chainName": "Lidl",
      "estimatedWeightGrams": 85,
      "cookingMethod": "cooked",
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
        116,
        532,
        882,
        992
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 154,
        "protein": 16.2,
        "saturatedFat": 1,
        "transFat": 0,
        "addedSugar": 1.2,
        "totalFibre": 0.5,
        "sodium": 408,
        "totalFat": 8.5,
        "totalSugar": 1.3,
        "potassium": 210,
        "omega3": 0.2,
        "calcium": 20,
        "iron": 1.5,
        "magnesium": 25,
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
  "_internalReasoning": "Evaluated the meal consisting of a Chocolate Muffin and Lidl Southern Fried Minced Chicken Bites. Total added sugar is 29.2g, which exceeds the daily limit of 24g in a single snack, and sodium is elevated at 628mg, impacting the user's prediabetes and hypertension biomarkers. Extended micronutrients calculated logically. Message follows the 4-beat structure and verdict guidelines.",
  "verdict": {
    "label": "122% over added sugar limit",
    "level": "alert"
  },
  "message": "You secured 21.2g of quality protein from the chicken bites, but the chocolate muffin brings 29.2g of added sugar, pushing this single snack 122% over your daily added sugar limit. This heavy sugar spike triggers an immediate insulin surge, leaving you feeling fatigued and driving up your blood pressure. Take a 15-minute brisk walk to stabilize your glucose, and choose high-fiber, unsweetened snacks next time.",
  "accuracyReview": {
    "isCorrected": false,
    "correctionNotes": null,
    "correctedMealNutrients": null
  },
  "extendedMealNutrients": {
    "solubleFibre": 1.2,
    "vitaminA": 120,
    "thiamine": 0.22,
    "riboflavin": 0.25,
    "niacin": 2.8,
    "vitaminB6": 0.18,
    "folate": 45,
    "vitaminB12": 0.6,
    "vitaminC": 1.5,
    "vitaminE": 1.8,
    "vitaminK": 12,
    "zinc": 1.1,
    "selenium": 14.5,
    "iodine": 18,
    "phosphorus": 180
  },
  "mealSummary": {
    "title": "Chocolate Muffin and Fried Chicken Bites",
    "itemsSummary": [
      {
        "scoutIndex": 0,
        "name": "Chocolate Muffin",
        "weightGrams": 110,
        "foodType": "baked good",
        "cookingMethod": "baked"
      },
      {
        "scoutIndex": 1,
        "name": "Southern Fried Minced Chicken Bites",
        "weightGrams": 85,
        "foodType": "poultry snack",
        "cookingMethod": "cooked"
      }
    ]
  }
}
```
</details>

---

### Case 3: `03_sushi_shrimp_salad.jpg`

**Generated At:** 2026-08-23T22:43:02.268Z
**Evaluated Model:** `gemini-3.5-flash-lite` (Strictly used for both Stage 1 Scout & Stage 3 Dietitian)
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
- USER MESSAGE SCOPE ANCHOR & MULTI-DISH EXTRACTION: Extract EVERY distinct food, drink, side, companion plate, or meal item visible in the photo or menu/kiosk screen as its own separate entry in 'items' (e.g. if 2 dishes or a main + drink or a mug + plate of fruits are visible, output separate item objects for each). Do NOT combine distinct dishes into 1 item.
- If user's text message specifies a portion/weight (e.g. "50g of oats + fruits" or "60g of sainsbury rolled oat + fruits"), assign logically. The user's explicit text sentence is absolute ground truth.
- BRAND SEPARATION: When user mentions brand + staples (e.g. "Sainsbury oat + fruit"), apply 'chainName' strictly to the branded item ("Sainsbury oat"). Emit whole companion foods (fruits, drinks, sides) as separate unbranded items (e.g. extract Banana, Apple, Plum as separate whole fruit items).
- For each item, provide a 2D bounding box 'boundingBox2D': [ymin, xmin, ymax, xmax] in normalized 0-1000 coordinate space identifying the exact region of the image containing the item.
- Specify 'sourceImageIndex': integer index of the input image (0 for single image).
- Identify 'chainName': restaurant chain or brand name if applicable (e.g. 'Starbucks', 'McDonald's', 'Pret', 'Sainsbury's'), or null if home-cooked / unbranded.

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
> The image shows a meal consisting of three distinct items: sushi rolls in a plastic container on the left, a shrimp and pasta salad with dressing in a larger container on the right, and a baguette at the bottom. I will extract each of these three items separately with precise bounding boxes and estimates.

#### Discovered Dishes & Per-Dish Core + Key Nutrients

##### Dish 1: Salmon and Avocado Sushi Rolls (180g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** raw
- **Bounding Box:** `[119, 0, 666, 268]`
- **Ingredients:** sushi rice, salmon, avocado, nori
- **Core Nutrients:** 280 kcal | 11g Protein | **42.1g Carbs [Derived]** | 7.5g Fat | 1.2g Sat Fat | 0g Trans Fat | 3g Added Sugar | 2.5g Fibre | 420mg Sodium
- **Key Nutrients:** 4g Total Sugar | **6.3g Unsat Fat [Derived]** | **1.07g Salt [Derived]** | 290mg Potassium | 0.5g Omega-3 | 20mg Calcium | 1.1mg Iron | 35mg Magnesium | 3.5mcg Vit D

##### Dish 2: Shrimp and Pasta Salad with Dressing (320g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** boiled
- **Bounding Box:** `[169, 359, 762, 994]`
- **Ingredients:** shrimp, penne pasta, lettuce, carrots, creamy dressing
- **Core Nutrients:** 420 kcal | 28g Protein | **36.5g Carbs [Derived]** | 18g Fat | 4g Sat Fat | 0g Trans Fat | 2g Added Sugar | 3g Fibre | 750mg Sodium
- **Key Nutrients:** 5g Total Sugar | **14g Unsat Fat [Derived]** | **1.91g Salt [Derived]** | 380mg Potassium | 0.3g Omega-3 | 60mg Calcium | 2mg Iron | 40mg Magnesium | 0.8mcg Vit D

##### Dish 3: French Baguette (150g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** baked
- **Bounding Box:** `[741, 100, 1000, 996]`
- **Ingredients:** wheat flour, water, yeast, salt
- **Core Nutrients:** 390 kcal | 13.5g Protein | **80.6g Carbs [Derived]** | 1.5g Fat | 0.3g Sat Fat | 0g Trans Fat | 0g Added Sugar | 3.5g Fibre | 680mg Sodium
- **Key Nutrients:** 1g Total Sugar | **1.2g Unsat Fat [Derived]** | **1.73g Salt [Derived]** | 190mg Potassium | 0g Omega-3 | 30mg Calcium | 3.2mg Iron | 45mg Magnesium | 0mcg Vit D

### 4. Stage 2 Output: Derivation Engine & Brand Database Matcher
| Nutrient Category | Nutrient | Value |
| :--- | :--- | :--- |
| **Core (High Precision)** | Calories | 1090 kcal |
| **Core (High Precision)** | Protein | 52.5 g |
| **Core (High Precision)** | Saturated Fat | 5.5 g |
| **Core (High Precision)** | Trans Fat | 0 g |
| **Core (High Precision)** | Added Sugar | 5 g |
| **Core (High Precision)** | Total Fibre | 9 g |
| **Core (High Precision)** | Sodium | 1850 mg |
| **Core (Derived)** | **Carbohydrates** | **159.2 g** |
| **Key (Moderate Precision)** | Total Fat | 27 g |
| **Key (Moderate Precision)** | Total Sugar | 10 g |
| **Key (Moderate Precision)** | Potassium | 860 mg |
| **Key (Moderate Precision)** | Omega-3 | 0.8 g |
| **Key (Moderate Precision)** | Calcium | 110 mg |
| **Key (Moderate Precision)** | Iron | 6.3 mg |
| **Key (Moderate Precision)** | Magnesium | 120 mg |
| **Key (Moderate Precision)** | Vitamin D | 4.3 mcg |
| **Key (Derived)** | **Unsaturated Fat** | **21.5 g** |
| **Key (Derived)** | **Salt** | **4.71 g** |

### 5. Stage 3 Output: Dietitian Clinical Coach Review & Extended Micronutrients
- **Verdict:** **High sodium and carbohydrate load** (Level: `warning`)
- **Dietitian Message (4-Beat Narrative):**
  > You secured 52.5g of quality lean protein from the shrimp and salmon. However, the combined sodium hit 1,850mg, consuming nearly your entire daily limit in one meal. This high sodium load temporarily elevates blood pressure and causes fluid retention. Your 15-minute post-meal walk was a great choice to blunt the blood glucose spike from the 159g of carbohydrates.
- **Accuracy Review Status:** ✅ **Scout Estimates Approved (No Correction Needed)**

##### Aggregate Extended Nutrients (Filled by Dietitian):
| Extended Nutrient (Directional Precision <50%) | Value |
| :--- | :--- |
| **Soluble Fibre** | 3.2 g |
| **Vitamin A** | 550 mcg |
| **Thiamine (B1)** | 0.45 mg |
| **Riboflavin (B2)** | 0.38 mg |
| **Niacin (B3)** | 6.2 mg |
| **Vitamin B6** | 0.4 mg |
| **Folate (B9)** | 110 mcg |
| **Vitamin B12** | 1.8 mcg |
| **Vitamin C** | 25 mg |
| **Vitamin E** | 2.1 mg |
| **Vitamin K** | 45 mcg |
| **Zinc** | 2.5 mg |
| **Selenium** | 45 mcg |
| **Iodine** | 60 mcg |
| **Phosphorus** | 350 mg |

#### Raw Payloads & JSON Output
<details><summary>Click to expand Raw Scout JSON</summary>

```json
{
  "_internalReasoning": "The image shows a meal consisting of three distinct items: sushi rolls in a plastic container on the left, a shrimp and pasta salad with dressing in a larger container on the right, and a baguette at the bottom. I will extract each of these three items separately with precise bounding boxes and estimates.",
  "contentType": "visual",
  "diningEnvironment": "casual_restaurant",
  "items": [
    {
      "originalName": "Salmon and Avocado Sushi Rolls",
      "chainName": null,
      "estimatedWeightGrams": 180,
      "cookingMethod": "raw",
      "ingredients": [
        "sushi rice",
        "salmon",
        "avocado",
        "nori"
      ],
      "boundingBox2D": [
        119,
        0,
        666,
        268
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 280,
        "protein": 11,
        "saturatedFat": 1.2,
        "transFat": 0,
        "addedSugar": 3,
        "totalFibre": 2.5,
        "sodium": 420,
        "totalFat": 7.5,
        "totalSugar": 4,
        "potassium": 290,
        "omega3": 0.5,
        "calcium": 20,
        "iron": 1.1,
        "magnesium": 35,
        "vitaminD": 3.5
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Shrimp and Pasta Salad with Dressing",
      "chainName": null,
      "estimatedWeightGrams": 320,
      "cookingMethod": "boiled",
      "ingredients": [
        "shrimp",
        "penne pasta",
        "lettuce",
        "carrots",
        "creamy dressing"
      ],
      "boundingBox2D": [
        169,
        359,
        762,
        994
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 420,
        "protein": 28,
        "saturatedFat": 4,
        "transFat": 0,
        "addedSugar": 2,
        "totalFibre": 3,
        "sodium": 750,
        "totalFat": 18,
        "totalSugar": 5,
        "potassium": 380,
        "omega3": 0.3,
        "calcium": 60,
        "iron": 2,
        "magnesium": 40,
        "vitaminD": 0.8
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "French Baguette",
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
        741,
        100,
        1000,
        996
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 390,
        "protein": 13.5,
        "saturatedFat": 0.3,
        "transFat": 0,
        "addedSugar": 0,
        "totalFibre": 3.5,
        "sodium": 680,
        "totalFat": 1.5,
        "totalSugar": 1,
        "potassium": 190,
        "omega3": 0,
        "calcium": 30,
        "iron": 3.2,
        "magnesium": 45,
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
  "_internalReasoning": "Evaluated the meal consisting of sushi rolls, shrimp and pasta salad, and french baguette. Total calories: 1090 kcal, Protein: 52.5g, Sodium: 1850mg (very high, approaching the 2000mg daily limit in a single meal, which impacts mild hypertension). Saturated fat is 5.5g (within safe limits). Carbs are high (159g) requiring attention given prediabetes warnings. Extended micronutrients estimated based on seafood, vegetables, grains, and avocado content.",
  "verdict": {
    "label": "High sodium and carbohydrate load",
    "level": "warning"
  },
  "message": "You secured 52.5g of quality lean protein from the shrimp and salmon. However, the combined sodium hit 1,850mg, consuming nearly your entire daily limit in one meal. This high sodium load temporarily elevates blood pressure and causes fluid retention. Your 15-minute post-meal walk was a great choice to blunt the blood glucose spike from the 159g of carbohydrates.",
  "accuracyReview": {
    "isCorrected": false,
    "correctionNotes": null,
    "correctedMealNutrients": null
  },
  "extendedMealNutrients": {
    "solubleFibre": 3.2,
    "vitaminA": 550,
    "thiamine": 0.45,
    "riboflavin": 0.38,
    "niacin": 6.2,
    "vitaminB6": 0.4,
    "folate": 110,
    "vitaminB12": 1.8,
    "vitaminC": 25,
    "vitaminE": 2.1,
    "vitaminK": 45,
    "zinc": 2.5,
    "selenium": 45,
    "iodine": 60,
    "phosphorus": 350
  },
  "mealSummary": {
    "title": "Salmon Sushi, Shrimp Pasta Salad & Baguette",
    "itemsSummary": [
      {
        "scoutIndex": 0,
        "name": "Salmon and Avocado Sushi Rolls",
        "weightGrams": 180,
        "foodType": "sushi",
        "cookingMethod": "raw"
      },
      {
        "scoutIndex": 1,
        "name": "Shrimp and Pasta Salad with Dressing",
        "weightGrams": 320,
        "foodType": "salad",
        "cookingMethod": "boiled"
      },
      {
        "scoutIndex": 2,
        "name": "French Baguette",
        "weightGrams": 150,
        "foodType": "bread",
        "cookingMethod": "baked"
      }
    ]
  }
}
```
</details>

---

### Case 4: `04_seaside_fish_chips.jpg`

**Generated At:** 2026-08-23T22:43:12.415Z
**Evaluated Model:** `gemini-3.5-flash-lite` (Strictly used for both Stage 1 Scout & Stage 3 Dietitian)
**File(s):** `04_seaside_fish_chips.jpg` | **Content Type:** `visual` | **Environment:** `casual_restaurant`

### 1. User Input Context & Active Clinical Biomarker Profile
- **User Prompt:** "Picnic lunch with salad, wrap, croissants, and fruit cup."
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
- USER MESSAGE SCOPE ANCHOR & MULTI-DISH EXTRACTION: Extract EVERY distinct food, drink, side, companion plate, or meal item visible in the photo or menu/kiosk screen as its own separate entry in 'items' (e.g. if 2 dishes or a main + drink or a mug + plate of fruits are visible, output separate item objects for each). Do NOT combine distinct dishes into 1 item.
- If user's text message specifies a portion/weight (e.g. "50g of oats + fruits" or "60g of sainsbury rolled oat + fruits"), assign logically. The user's explicit text sentence is absolute ground truth.
- BRAND SEPARATION: When user mentions brand + staples (e.g. "Sainsbury oat + fruit"), apply 'chainName' strictly to the branded item ("Sainsbury oat"). Emit whole companion foods (fruits, drinks, sides) as separate unbranded items (e.g. extract Banana, Apple, Plum as separate whole fruit items).
- For each item, provide a 2D bounding box 'boundingBox2D': [ymin, xmin, ymax, xmax] in normalized 0-1000 coordinate space identifying the exact region of the image containing the item.
- Specify 'sourceImageIndex': integer index of the input image (0 for single image).
- Identify 'chainName': restaurant chain or brand name if applicable (e.g. 'Starbucks', 'McDonald's', 'Pret', 'Sainsbury's'), or null if home-cooked / unbranded.

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
> The image shows a picnic lunch spread on a wooden table, consisting of three main items: a yogurt and fruit granola cup on the left, a salad bowl with chicken, avocado, feta, and hard-boiled eggs on the bottom right, and pastries (croissant and pastry swirl) in a white paper bag at the top. I will extract these three distinct items.

#### Discovered Dishes & Per-Dish Core + Key Nutrients

##### Dish 1: Granola and Fruit Yogurt Cup (280g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** raw
- **Bounding Box:** `[294, 15, 597, 377]`
- **Ingredients:** yogurt, granola, strawberries, raspberries, blueberries, blackberries
- **Core Nutrients:** 310 kcal | 12g Protein | **49.8g Carbs [Derived]** | 7g Fat | 2.5g Sat Fat | 0g Trans Fat | 10g Added Sugar | 5g Fibre | 95mg Sodium
- **Key Nutrients:** 22g Total Sugar | **4.5g Unsat Fat [Derived]** | **0.24g Salt [Derived]** | 380mg Potassium | 0.1g Omega-3 | 250mg Calcium | 1.5mg Iron | 45mg Magnesium | 1mcg Vit D

##### Dish 2: Chicken and Avocado Salad (350g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** grilled
- **Bounding Box:** `[510, 360, 980, 963]`
- **Ingredients:** chicken breast, avocado, feta cheese, hard-boiled eggs, cherry tomatoes, red onion, mixed salad greens
- **Core Nutrients:** 420 kcal | 36g Protein | **15g Carbs [Derived]** | 24g Fat | 6.5g Sat Fat | 0g Trans Fat | 0g Added Sugar | 7.5g Fibre | 550mg Sodium
- **Key Nutrients:** 4.5g Total Sugar | **17.5g Unsat Fat [Derived]** | **1.4g Salt [Derived]** | 780mg Potassium | 0.3g Omega-3 | 220mg Calcium | 2.8mg Iron | 65mg Magnesium | 1.6mcg Vit D

##### Dish 3: Croissant and Pastry (140g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** baked
- **Bounding Box:** `[136, 464, 328, 768]`
- **Ingredients:** flour, butter, yeast, sugar, pastry dough
- **Core Nutrients:** 480 kcal | 8g Protein | **53.5g Carbs [Derived]** | 26g Fat | 14g Sat Fat | 0.5g Trans Fat | 9g Added Sugar | 2g Fibre | 340mg Sodium
- **Key Nutrients:** 8g Total Sugar | **11.5g Unsat Fat [Derived]** | **0.86g Salt [Derived]** | 110mg Potassium | 0g Omega-3 | 25mg Calcium | 1.8mg Iron | 15mg Magnesium | 0.4mcg Vit D

### 4. Stage 2 Output: Derivation Engine & Brand Database Matcher
| Nutrient Category | Nutrient | Value |
| :--- | :--- | :--- |
| **Core (High Precision)** | Calories | 1210 kcal |
| **Core (High Precision)** | Protein | 56 g |
| **Core (High Precision)** | Saturated Fat | 23 g |
| **Core (High Precision)** | Trans Fat | 0.5 g |
| **Core (High Precision)** | Added Sugar | 19 g |
| **Core (High Precision)** | Total Fibre | 14.5 g |
| **Core (High Precision)** | Sodium | 985 mg |
| **Core (Derived)** | **Carbohydrates** | **118.3 g** |
| **Key (Moderate Precision)** | Total Fat | 57 g |
| **Key (Moderate Precision)** | Total Sugar | 34.5 g |
| **Key (Moderate Precision)** | Potassium | 1270 mg |
| **Key (Moderate Precision)** | Omega-3 | 0.4 g |
| **Key (Moderate Precision)** | Calcium | 495 mg |
| **Key (Moderate Precision)** | Iron | 6.1 mg |
| **Key (Moderate Precision)** | Magnesium | 125 mg |
| **Key (Moderate Precision)** | Vitamin D | 3 mcg |
| **Key (Derived)** | **Unsaturated Fat** | **33.5 g** |
| **Key (Derived)** | **Salt** | **2.5 g** |

### 5. Stage 3 Output: Dietitian Clinical Coach Review & Extended Micronutrients
- **Verdict:** **153% over saturated fat limit** (Level: `warning`)
- **Dietitian Message (4-Beat Narrative):**
  > You secured 56g of lean protein and 14.5g of fiber from the chicken salad and berries. However, the butter-rich croissant and salad cheeses add 23g of saturated fat, pushing this meal 153% over your daily limit. This heavy fat load triggers post-meal vascular stiffness and sluggishness. Take a 20-minute brisk walk now to support circulation and clear circulating lipids.
- **Accuracy Review Status:** ✅ **Scout Estimates Approved (No Correction Needed)**

##### Aggregate Extended Nutrients (Filled by Dietitian):
| Extended Nutrient (Directional Precision <50%) | Value |
| :--- | :--- |
| **Soluble Fibre** | 4.5 g |
| **Vitamin A** | 550 mcg |
| **Thiamine (B1)** | 0.45 mg |
| **Riboflavin (B2)** | 0.65 mg |
| **Niacin (B3)** | 8.5 mg |
| **Vitamin B6** | 0.72 mg |
| **Folate (B9)** | 140 mcg |
| **Vitamin B12** | 1.8 mcg |
| **Vitamin C** | 62 mg |
| **Vitamin E** | 4.1 mg |
| **Vitamin K** | 95 mcg |
| **Zinc** | 3.2 mg |
| **Selenium** | 38 mcg |
| **Iodine** | 42 mcg |
| **Phosphorus** | 620 mg |

#### Raw Payloads & JSON Output
<details><summary>Click to expand Raw Scout JSON</summary>

```json
{
  "_internalReasoning": "The image shows a picnic lunch spread on a wooden table, consisting of three main items: a yogurt and fruit granola cup on the left, a salad bowl with chicken, avocado, feta, and hard-boiled eggs on the bottom right, and pastries (croissant and pastry swirl) in a white paper bag at the top. I will extract these three distinct items.",
  "contentType": "visual",
  "diningEnvironment": "casual_restaurant",
  "items": [
    {
      "originalName": "Granola and Fruit Yogurt Cup",
      "chainName": null,
      "estimatedWeightGrams": 280,
      "cookingMethod": "raw",
      "ingredients": [
        "yogurt",
        "granola",
        "strawberries",
        "raspberries",
        "blueberries",
        "blackberries"
      ],
      "boundingBox2D": [
        294,
        15,
        597,
        377
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 310,
        "protein": 12,
        "saturatedFat": 2.5,
        "transFat": 0,
        "addedSugar": 10,
        "totalFibre": 5,
        "sodium": 95,
        "totalFat": 7,
        "totalSugar": 22,
        "potassium": 380,
        "omega3": 0.1,
        "calcium": 250,
        "iron": 1.5,
        "magnesium": 45,
        "vitaminD": 1
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Chicken and Avocado Salad",
      "chainName": null,
      "estimatedWeightGrams": 350,
      "cookingMethod": "grilled",
      "ingredients": [
        "chicken breast",
        "avocado",
        "feta cheese",
        "hard-boiled eggs",
        "cherry tomatoes",
        "red onion",
        "mixed salad greens"
      ],
      "boundingBox2D": [
        510,
        360,
        980,
        963
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 420,
        "protein": 36,
        "saturatedFat": 6.5,
        "transFat": 0,
        "addedSugar": 0,
        "totalFibre": 7.5,
        "sodium": 550,
        "totalFat": 24,
        "totalSugar": 4.5,
        "potassium": 780,
        "omega3": 0.3,
        "calcium": 220,
        "iron": 2.8,
        "magnesium": 65,
        "vitaminD": 1.6
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Croissant and Pastry",
      "chainName": null,
      "estimatedWeightGrams": 140,
      "cookingMethod": "baked",
      "ingredients": [
        "flour",
        "butter",
        "yeast",
        "sugar",
        "pastry dough"
      ],
      "boundingBox2D": [
        136,
        464,
        328,
        768
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 480,
        "protein": 8,
        "saturatedFat": 14,
        "transFat": 0.5,
        "addedSugar": 9,
        "totalFibre": 2,
        "sodium": 340,
        "totalFat": 26,
        "totalSugar": 8,
        "potassium": 110,
        "omega3": 0,
        "calcium": 25,
        "iron": 1.8,
        "magnesium": 15,
        "vitaminD": 0.4
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
  "_internalReasoning": "Evaluated the meal consisting of a yogurt and fruit granola cup, chicken avocado salad, and croissant. The aggregate saturated fat (23g) exceeds the daily target of 15g in a single meal, driven primarily by the croissant and salad cheese/feta. Total calories and protein are solid (56g protein), but high saturated fat paired with prediabetes and elevated LDL requires a warning on cardiovascular impact. Estimated extended micronutrients based on ingredients like berries, chicken, avocado, greens, and dairy.",
  "verdict": {
    "label": "153% over saturated fat limit",
    "level": "warning"
  },
  "message": "You secured 56g of lean protein and 14.5g of fiber from the chicken salad and berries. However, the butter-rich croissant and salad cheeses add 23g of saturated fat, pushing this meal 153% over your daily limit. This heavy fat load triggers post-meal vascular stiffness and sluggishness. Take a 20-minute brisk walk now to support circulation and clear circulating lipids.",
  "accuracyReview": {
    "isCorrected": false,
    "correctionNotes": null,
    "correctedMealNutrients": null
  },
  "extendedMealNutrients": {
    "solubleFibre": 4.5,
    "vitaminA": 550,
    "thiamine": 0.45,
    "riboflavin": 0.65,
    "niacin": 8.5,
    "vitaminB6": 0.72,
    "folate": 140,
    "vitaminB12": 1.8,
    "vitaminC": 62,
    "vitaminE": 4.1,
    "vitaminK": 95,
    "zinc": 3.2,
    "selenium": 38,
    "iodine": 42,
    "phosphorus": 620
  },
  "mealSummary": {
    "title": "Chicken Salad, Yogurt Fruit Cup & Croissant",
    "itemsSummary": [
      {
        "scoutIndex": 0,
        "name": "Granola and Fruit Yogurt Cup",
        "weightGrams": 280,
        "foodType": "Dairy and Fruit",
        "cookingMethod": "raw"
      },
      {
        "scoutIndex": 1,
        "name": "Chicken and Avocado Salad",
        "weightGrams": 350,
        "foodType": "Poultry and Vegetables",
        "cookingMethod": "grilled"
      },
      {
        "scoutIndex": 2,
        "name": "Croissant and Pastry",
        "weightGrams": 140,
        "foodType": "Bakery",
        "cookingMethod": "baked"
      }
    ]
  }
}
```
</details>

---

### Case 5: `05_cafe_waffles_coffee.jpg`

**Generated At:** 2026-08-23T22:43:24.034Z
**Evaluated Model:** `gemini-3.5-flash-lite` (Strictly used for both Stage 1 Scout & Stage 3 Dietitian)
**File(s):** `05_cafe_waffles_coffee.jpg` | **Content Type:** `visual` | **Environment:** `airline`

### 1. User Input Context & Active Clinical Biomarker Profile
- **User Prompt:** "Weekend brunch / breakfast spread."
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
- USER MESSAGE SCOPE ANCHOR & MULTI-DISH EXTRACTION: Extract EVERY distinct food, drink, side, companion plate, or meal item visible in the photo or menu/kiosk screen as its own separate entry in 'items' (e.g. if 2 dishes or a main + drink or a mug + plate of fruits are visible, output separate item objects for each). Do NOT combine distinct dishes into 1 item.
- If user's text message specifies a portion/weight (e.g. "50g of oats + fruits" or "60g of sainsbury rolled oat + fruits"), assign logically. The user's explicit text sentence is absolute ground truth.
- BRAND SEPARATION: When user mentions brand + staples (e.g. "Sainsbury oat + fruit"), apply 'chainName' strictly to the branded item ("Sainsbury oat"). Emit whole companion foods (fruits, drinks, sides) as separate unbranded items (e.g. extract Banana, Apple, Plum as separate whole fruit items).
- For each item, provide a 2D bounding box 'boundingBox2D': [ymin, xmin, ymax, xmax] in normalized 0-1000 coordinate space identifying the exact region of the image containing the item.
- Specify 'sourceImageIndex': integer index of the input image (0 for single image).
- Identify 'chainName': restaurant chain or brand name if applicable (e.g. 'Starbucks', 'McDonald's', 'Pret', 'Sainsbury's'), or null if home-cooked / unbranded.

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
> The image shows an airline breakfast meal spread containing several distinct items: a croissant, a bowl of congee/porridge with chicken/vegetables, a decorated mousse cake, butter and strawberry jam packets, and a cup of beverage (milk tea or congee/soy milk). I will extract each distinct item with bounding boxes, weights, ingredients, and 15 key nutrients.

#### Discovered Dishes & Per-Dish Core + Key Nutrients

##### Dish 1: Croissant (60g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** baked
- **Bounding Box:** `[521, 14, 998, 274]`
- **Ingredients:** flour, butter, yeast, sugar, salt, milk
- **Core Nutrients:** 230 kcal | 4.5g Protein | **23.8g Carbs [Derived]** | 13g Fat | 8g Sat Fat | 0.2g Trans Fat | 3g Added Sugar | 1g Fibre | 180mg Sodium
- **Key Nutrients:** 3.5g Total Sugar | **4.8g Unsat Fat [Derived]** | **0.46g Salt [Derived]** | 50mg Potassium | 0.1g Omega-3 | 15mg Calcium | 0.8mg Iron | 10mg Magnesium | 0.4mcg Vit D

##### Dish 2: Congee (Rice Porridge with Chicken and Vegetables) (300g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** boiled
- **Bounding Box:** `[553, 303, 1000, 965]`
- **Ingredients:** rice, water, chicken, scallions, ginger, salt
- **Core Nutrients:** 180 kcal | 8g Protein | **31.4g Carbs [Derived]** | 2.5g Fat | 0.5g Sat Fat | 0g Trans Fat | 0g Added Sugar | 1g Fibre | 450mg Sodium
- **Key Nutrients:** 0.5g Total Sugar | **2g Unsat Fat [Derived]** | **1.14g Salt [Derived]** | 120mg Potassium | 0g Omega-3 | 20mg Calcium | 1mg Iron | 25mg Magnesium | 0mcg Vit D

##### Dish 3: Strawberry Jam & Butter Packets (20g) [Image 0]
- **Brand / Chain:** Duerr's / Lurpak
- **Cooking Method:** packaged
- **Bounding Box:** `[82, 29, 304, 299]`
- **Ingredients:** strawberries, sugar, pectin, butter, salt
- **Core Nutrients:** 100 kcal | 0.1g Protein | **12.5g Carbs [Derived]** | 5.5g Fat | 3.5g Sat Fat | 0.1g Trans Fat | 8g Added Sugar | 0.2g Fibre | 75mg Sodium
- **Key Nutrients:** 9g Total Sugar | **1.9g Unsat Fat [Derived]** | **0.19g Salt [Derived]** | 15mg Potassium | 0g Omega-3 | 5mg Calcium | 0.1mg Iron | 2mg Magnesium | 0.1mcg Vit D

##### Dish 4: Decorated Mousse Cake (90g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** chilled
- **Bounding Box:** `[4, 351, 351, 600]`
- **Ingredients:** cream, sugar, gelatin, berry puree, sponge cake
- **Core Nutrients:** 280 kcal | 3g Protein | **33.3g Carbs [Derived]** | 15g Fat | 10g Sat Fat | 0.4g Trans Fat | 18g Added Sugar | 0.5g Fibre | 60mg Sodium
- **Key Nutrients:** 20g Total Sugar | **4.6g Unsat Fat [Derived]** | **0.15g Salt [Derived]** | 80mg Potassium | 0.1g Omega-3 | 40mg Calcium | 0.3mg Iron | 10mg Magnesium | 0.2mcg Vit D

##### Dish 5: Milk Tea / Beverage in Cup (200g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** steeped
- **Bounding Box:** `[31, 638, 472, 924]`
- **Ingredients:** tea, milk, sugar
- **Core Nutrients:** 90 kcal | 3g Protein | **13.9g Carbs [Derived]** | 2.5g Fat | 1.5g Sat Fat | 0g Trans Fat | 5g Added Sugar | 0g Fibre | 45mg Sodium
- **Key Nutrients:** 6g Total Sugar | **1g Unsat Fat [Derived]** | **0.11g Salt [Derived]** | 130mg Potassium | 0g Omega-3 | 100mg Calcium | 0.1mg Iron | 15mg Magnesium | 0.5mcg Vit D

### 4. Stage 2 Output: Derivation Engine & Brand Database Matcher
| Nutrient Category | Nutrient | Value |
| :--- | :--- | :--- |
| **Core (High Precision)** | Calories | 880 kcal |
| **Core (High Precision)** | Protein | 18.6 g |
| **Core (High Precision)** | Saturated Fat | 23.5 g |
| **Core (High Precision)** | Trans Fat | 0.7 g |
| **Core (High Precision)** | Added Sugar | 34 g |
| **Core (High Precision)** | Total Fibre | 2.7 g |
| **Core (High Precision)** | Sodium | 810 mg |
| **Core (Derived)** | **Carbohydrates** | **114.9 g** |
| **Key (Moderate Precision)** | Total Fat | 38.5 g |
| **Key (Moderate Precision)** | Total Sugar | 39 g |
| **Key (Moderate Precision)** | Potassium | 395 mg |
| **Key (Moderate Precision)** | Omega-3 | 0.2 g |
| **Key (Moderate Precision)** | Calcium | 180 mg |
| **Key (Moderate Precision)** | Iron | 2.3 mg |
| **Key (Moderate Precision)** | Magnesium | 62 mg |
| **Key (Moderate Precision)** | Vitamin D | 1.2 mcg |
| **Key (Derived)** | **Unsaturated Fat** | **14.3 g** |
| **Key (Derived)** | **Salt** | **2.05 g** |

### 5. Stage 3 Output: Dietitian Clinical Coach Review & Extended Micronutrients
- **Verdict:** **142% over added sugar limit** (Level: `alert`)
- **Dietitian Message (4-Beat Narrative):**
  > You secured 18.6g of protein and comforting warmth from the chicken congee. However, the pastry, cake, and jam combo deliver 34g of added sugar and 23.5g of saturated fat, pushing today's limits over 140%. This heavy refined load triggers a sharp glucose spike, vascular stiffness, and sudden fatigue. Take a 20-minute post-meal walk to clear circulation, and anchor your next meal with high-fiber greens and lean protein.
- **Accuracy Review Status:** ✅ **Scout Estimates Approved (No Correction Needed)**

##### Aggregate Extended Nutrients (Filled by Dietitian):
| Extended Nutrient (Directional Precision <50%) | Value |
| :--- | :--- |
| **Soluble Fibre** | 1.2 g |
| **Vitamin A** | 220 mcg |
| **Thiamine (B1)** | 0.22 mg |
| **Riboflavin (B2)** | 0.38 mg |
| **Niacin (B3)** | 2.1 mg |
| **Vitamin B6** | 0.25 mg |
| **Folate (B9)** | 45 mcg |
| **Vitamin B12** | 0.8 mcg |
| **Vitamin C** | 12 mg |
| **Vitamin E** | 1.8 mg |
| **Vitamin K** | 18 mcg |
| **Zinc** | 1.5 mg |
| **Selenium** | 14.2 mcg |
| **Iodine** | 25 mcg |
| **Phosphorus** | 210 mg |

#### Raw Payloads & JSON Output
<details><summary>Click to expand Raw Scout JSON</summary>

```json
{
  "_internalReasoning": "The image shows an airline breakfast meal spread containing several distinct items: a croissant, a bowl of congee/porridge with chicken/vegetables, a decorated mousse cake, butter and strawberry jam packets, and a cup of beverage (milk tea or congee/soy milk). I will extract each distinct item with bounding boxes, weights, ingredients, and 15 key nutrients.",
  "contentType": "visual",
  "diningEnvironment": "airline",
  "items": [
    {
      "originalName": "Croissant",
      "chainName": null,
      "estimatedWeightGrams": 60,
      "cookingMethod": "baked",
      "ingredients": [
        "flour",
        "butter",
        "yeast",
        "sugar",
        "salt",
        "milk"
      ],
      "boundingBox2D": [
        521,
        14,
        998,
        274
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 230,
        "protein": 4.5,
        "saturatedFat": 8,
        "transFat": 0.2,
        "addedSugar": 3,
        "totalFibre": 1,
        "sodium": 180,
        "totalFat": 13,
        "totalSugar": 3.5,
        "potassium": 50,
        "omega3": 0.1,
        "calcium": 15,
        "iron": 0.8,
        "magnesium": 10,
        "vitaminD": 0.4
      },
      "itemConfidence": "High"
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
        "salt"
      ],
      "boundingBox2D": [
        553,
        303,
        1000,
        965
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 180,
        "protein": 8,
        "saturatedFat": 0.5,
        "transFat": 0,
        "addedSugar": 0,
        "totalFibre": 1,
        "sodium": 450,
        "totalFat": 2.5,
        "totalSugar": 0.5,
        "potassium": 120,
        "omega3": 0,
        "calcium": 20,
        "iron": 1,
        "magnesium": 25,
        "vitaminD": 0
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Strawberry Jam & Butter Packets",
      "chainName": "Duerr's / Lurpak",
      "estimatedWeightGrams": 20,
      "cookingMethod": "packaged",
      "ingredients": [
        "strawberries",
        "sugar",
        "pectin",
        "butter",
        "salt"
      ],
      "boundingBox2D": [
        82,
        29,
        304,
        299
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 100,
        "protein": 0.1,
        "saturatedFat": 3.5,
        "transFat": 0.1,
        "addedSugar": 8,
        "totalFibre": 0.2,
        "sodium": 75,
        "totalFat": 5.5,
        "totalSugar": 9,
        "potassium": 15,
        "omega3": 0,
        "calcium": 5,
        "iron": 0.1,
        "magnesium": 2,
        "vitaminD": 0.1
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Decorated Mousse Cake",
      "chainName": null,
      "estimatedWeightGrams": 90,
      "cookingMethod": "chilled",
      "ingredients": [
        "cream",
        "sugar",
        "gelatin",
        "berry puree",
        "sponge cake"
      ],
      "boundingBox2D": [
        4,
        351,
        351,
        600
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 280,
        "protein": 3,
        "saturatedFat": 10,
        "transFat": 0.4,
        "addedSugar": 18,
        "totalFibre": 0.5,
        "sodium": 60,
        "totalFat": 15,
        "totalSugar": 20,
        "potassium": 80,
        "omega3": 0.1,
        "calcium": 40,
        "iron": 0.3,
        "magnesium": 10,
        "vitaminD": 0.2
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Milk Tea / Beverage in Cup",
      "chainName": null,
      "estimatedWeightGrams": 200,
      "cookingMethod": "steeped",
      "ingredients": [
        "tea",
        "milk",
        "sugar"
      ],
      "boundingBox2D": [
        31,
        638,
        472,
        924
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 90,
        "protein": 3,
        "saturatedFat": 1.5,
        "transFat": 0,
        "addedSugar": 5,
        "totalFibre": 0,
        "sodium": 45,
        "totalFat": 2.5,
        "totalSugar": 6,
        "potassium": 130,
        "omega3": 0,
        "calcium": 100,
        "iron": 0.1,
        "magnesium": 15,
        "vitaminD": 0.5
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
  "_internalReasoning": "Evaluated the meal spread (croissant, congee, jam/butter, mousse cake, milk tea). Total added sugar is 34g (over 24g daily limit) and saturated fat is 23.5g (156% of 15g limit). This combination significantly impacts prediabetes, blood pressure, and lipids. Provided 4-beat narrative, exact extended nutrients, and a concise metric-backed verdict label.",
  "verdict": {
    "label": "142% over added sugar limit",
    "level": "alert"
  },
  "message": "You secured 18.6g of protein and comforting warmth from the chicken congee. However, the pastry, cake, and jam combo deliver 34g of added sugar and 23.5g of saturated fat, pushing today's limits over 140%. This heavy refined load triggers a sharp glucose spike, vascular stiffness, and sudden fatigue. Take a 20-minute post-meal walk to clear circulation, and anchor your next meal with high-fiber greens and lean protein.",
  "accuracyReview": {
    "isCorrected": false,
    "correctionNotes": null,
    "correctedMealNutrients": null
  },
  "extendedMealNutrients": {
    "solubleFibre": 1.2,
    "vitaminA": 220,
    "thiamine": 0.22,
    "riboflavin": 0.38,
    "niacin": 2.1,
    "vitaminB6": 0.25,
    "folate": 45,
    "vitaminB12": 0.8,
    "vitaminC": 12,
    "vitaminE": 1.8,
    "vitaminK": 18,
    "zinc": 1.5,
    "selenium": 14.2,
    "iodine": 25,
    "phosphorus": 210
  },
  "mealSummary": {
    "title": "Weekend Brunch Spread",
    "itemsSummary": [
      {
        "scoutIndex": 0,
        "name": "Croissant",
        "weightGrams": 60,
        "foodType": "pastry",
        "cookingMethod": "baked"
      },
      {
        "scoutIndex": 1,
        "name": "Congee with Chicken and Vegetables",
        "weightGrams": 300,
        "foodType": "porridge",
        "cookingMethod": "boiled"
      },
      {
        "scoutIndex": 2,
        "name": "Strawberry Jam & Butter Packets",
        "weightGrams": 20,
        "foodType": "condiment",
        "cookingMethod": "packaged"
      },
      {
        "scoutIndex": 3,
        "name": "Decorated Mousse Cake",
        "weightGrams": 90,
        "foodType": "dessert",
        "cookingMethod": "chilled"
      },
      {
        "scoutIndex": 4,
        "name": "Milk Tea",
        "weightGrams": 200,
        "foodType": "beverage",
        "cookingMethod": "steeped"
      }
    ]
  }
}
```
</details>

---

### Case 6: `06_indonesian_menu (Mie Gacoan Indonesian meal)`

**Generated At:** 2026-08-23T22:43:34.420Z
**Evaluated Model:** `gemini-3.5-flash-lite` (Strictly used for both Stage 1 Scout & Stage 3 Dietitian)
**File(s):** `06_indonesian_menu_page_1.jpg, 06_indonesian_menu_page_2.jpg` | **Content Type:** `visual` | **Environment:** `fast_food_chain`

### 1. User Input Context & Active Clinical Biomarker Profile
- **User Prompt:** "Extract distinct dishes across both Indonesian meal & order summary images for multi-language evaluation."
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
- USER MESSAGE SCOPE ANCHOR & MULTI-DISH EXTRACTION: Extract EVERY distinct food, drink, side, companion plate, or meal item visible in the photo or menu/kiosk screen as its own separate entry in 'items' (e.g. if 2 dishes or a main + drink or a mug + plate of fruits are visible, output separate item objects for each). Do NOT combine distinct dishes into 1 item.
- If user's text message specifies a portion/weight (e.g. "50g of oats + fruits" or "60g of sainsbury rolled oat + fruits"), assign logically. The user's explicit text sentence is absolute ground truth.
- BRAND SEPARATION: When user mentions brand + staples (e.g. "Sainsbury oat + fruit"), apply 'chainName' strictly to the branded item ("Sainsbury oat"). Emit whole companion foods (fruits, drinks, sides) as separate unbranded items (e.g. extract Banana, Apple, Plum as separate whole fruit items).
- For each item, provide a 2D bounding box 'boundingBox2D': [ymin, xmin, ymax, xmax] in normalized 0-1000 coordinate space identifying the exact region of the image containing the item.
- Specify 'sourceImageIndex': integer index of the input image (0 for single image).
- Identify 'chainName': restaurant chain or brand name if applicable (e.g. 'Starbucks', 'McDonald's', 'Pret', 'Sainsbury's'), or null if home-cooked / unbranded.

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
> Extracted three distinct items from the Mie Gacoan meal photo and order summary: Mie Suit (noodles with fried wontons), Siomay (steamed dumplings in a bamboo steamer), and Es Petak Umpet (fruity iced drink). Nutrient estimations are tailored to typical Indonesian fast-food chain portions.

#### Discovered Dishes & Per-Dish Core + Key Nutrients

##### Dish 1: Mie Suit (220g) [Image 0]
- **Brand / Chain:** Mie Gacoan
- **Cooking Method:** boiled and fried
- **Bounding Box:** `[337, 0, 832, 500]`
- **Ingredients:** wheat noodles, fried wonton skins, chicken seasoning, garlic oil, fried shallots
- **Core Nutrients:** 420 kcal | 12g Protein | **57g Carbs [Derived]** | 16g Fat | 5g Sat Fat | 0g Trans Fat | 1g Added Sugar | 2.5g Fibre | 850mg Sodium
- **Key Nutrients:** 2g Total Sugar | **11g Unsat Fat [Derived]** | **2.16g Salt [Derived]** | 180mg Potassium | 0.1g Omega-3 | 30mg Calcium | 1.5mg Iron | 25mg Magnesium | 0mcg Vit D

##### Dish 2: Siomay (150g) [Image 0]
- **Brand / Chain:** Mie Gacoan
- **Cooking Method:** steamed
- **Bounding Box:** `[452, 561, 990, 981]`
- **Ingredients:** minced chicken, prawn, tapioca flour, wonton wrapper, spring onion
- **Core Nutrients:** 240 kcal | 14g Protein | **25.8g Carbs [Derived]** | 9g Fat | 3g Sat Fat | 0g Trans Fat | 1g Added Sugar | 1g Fibre | 520mg Sodium
- **Key Nutrients:** 1.5g Total Sugar | **6g Unsat Fat [Derived]** | **1.32g Salt [Derived]** | 150mg Potassium | 0.2g Omega-3 | 25mg Calcium | 1mg Iron | 20mg Magnesium | 0.2mcg Vit D

##### Dish 3: Es Petak Umpet (300g) [Image 0]
- **Brand / Chain:** Mie Gacoan
- **Cooking Method:** blended and iced
- **Bounding Box:** `[82, 529, 502, 765]`
- **Ingredients:** iced sweetened syrup, fruit chunks, colorful jelly balls, water
- **Core Nutrients:** 180 kcal | 0.5g Protein | **44.1g Carbs [Derived]** | 0.2g Fat | 0g Sat Fat | 0g Trans Fat | 32g Added Sugar | 0.5g Fibre | 25mg Sodium
- **Key Nutrients:** 34g Total Sugar | **0.2g Unsat Fat [Derived]** | **0.06g Salt [Derived]** | 90mg Potassium | 0g Omega-3 | 15mg Calcium | 0.2mg Iron | 10mg Magnesium | 0mcg Vit D

### 4. Stage 2 Output: Derivation Engine & Brand Database Matcher
| Nutrient Category | Nutrient | Value |
| :--- | :--- | :--- |
| **Core (High Precision)** | Calories | 840 kcal |
| **Core (High Precision)** | Protein | 26.5 g |
| **Core (High Precision)** | Saturated Fat | 8 g |
| **Core (High Precision)** | Trans Fat | 0 g |
| **Core (High Precision)** | Added Sugar | 34 g |
| **Core (High Precision)** | Total Fibre | 4 g |
| **Core (High Precision)** | Sodium | 1395 mg |
| **Core (Derived)** | **Carbohydrates** | **126.9 g** |
| **Key (Moderate Precision)** | Total Fat | 25.2 g |
| **Key (Moderate Precision)** | Total Sugar | 37.5 g |
| **Key (Moderate Precision)** | Potassium | 420 mg |
| **Key (Moderate Precision)** | Omega-3 | 0.3 g |
| **Key (Moderate Precision)** | Calcium | 70 mg |
| **Key (Moderate Precision)** | Iron | 2.7 mg |
| **Key (Moderate Precision)** | Magnesium | 55 mg |
| **Key (Moderate Precision)** | Vitamin D | 0.2 mcg |
| **Key (Derived)** | **Unsaturated Fat** | **17.2 g** |
| **Key (Derived)** | **Salt** | **3.54 g** |

### 5. Stage 3 Output: Dietitian Clinical Coach Review & Extended Micronutrients
- **Verdict:** **141% over added sugar limit** (Level: `warning`)
- **Dietitian Message (4-Beat Narrative):**
  > You received 26.5g of satisfying protein from the chicken noodles and steamed siomay. However, the sweetened beverage pushes your added sugar intake to 34g, exceeding your daily limit. This high sugar and sodium load triggers an immediate blood glucose spike and fluid retention. Drink 500ml of water now and take a 20-minute walk to stabilize blood sugar.
- **Accuracy Review Status:** ✅ **Scout Estimates Approved (No Correction Needed)**

##### Aggregate Extended Nutrients (Filled by Dietitian):
| Extended Nutrient (Directional Precision <50%) | Value |
| :--- | :--- |
| **Soluble Fibre** | 1.2 g |
| **Vitamin A** | 120 mcg |
| **Thiamine (B1)** | 0.22 mg |
| **Riboflavin (B2)** | 0.18 mg |
| **Niacin (B3)** | 3.4 mg |
| **Vitamin B6** | 0.25 mg |
| **Folate (B9)** | 45 mcg |
| **Vitamin B12** | 0.8 mcg |
| **Vitamin C** | 12 mg |
| **Vitamin E** | 1.1 mg |
| **Vitamin K** | 18 mcg |
| **Zinc** | 1.9 mg |
| **Selenium** | 18.5 mcg |
| **Iodine** | 15 mcg |
| **Phosphorus** | 240 mg |

#### Raw Payloads & JSON Output
<details><summary>Click to expand Raw Scout JSON</summary>

```json
{
  "_internalReasoning": "Extracted three distinct items from the Mie Gacoan meal photo and order summary: Mie Suit (noodles with fried wontons), Siomay (steamed dumplings in a bamboo steamer), and Es Petak Umpet (fruity iced drink). Nutrient estimations are tailored to typical Indonesian fast-food chain portions.",
  "contentType": "visual",
  "diningEnvironment": "fast_food_chain",
  "items": [
    {
      "originalName": "Mie Suit",
      "chainName": "Mie Gacoan",
      "estimatedWeightGrams": 220,
      "cookingMethod": "boiled and fried",
      "ingredients": [
        "wheat noodles",
        "fried wonton skins",
        "chicken seasoning",
        "garlic oil",
        "fried shallots"
      ],
      "boundingBox2D": [
        337,
        0,
        832,
        500
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 420,
        "protein": 12,
        "saturatedFat": 5,
        "transFat": 0,
        "addedSugar": 1,
        "totalFibre": 2.5,
        "sodium": 850,
        "totalFat": 16,
        "totalSugar": 2,
        "potassium": 180,
        "omega3": 0.1,
        "calcium": 30,
        "iron": 1.5,
        "magnesium": 25,
        "vitaminD": 0
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Siomay",
      "chainName": "Mie Gacoan",
      "estimatedWeightGrams": 150,
      "cookingMethod": "steamed",
      "ingredients": [
        "minced chicken",
        "prawn",
        "tapioca flour",
        "wonton wrapper",
        "spring onion"
      ],
      "boundingBox2D": [
        452,
        561,
        990,
        981
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 240,
        "protein": 14,
        "saturatedFat": 3,
        "transFat": 0,
        "addedSugar": 1,
        "totalFibre": 1,
        "sodium": 520,
        "totalFat": 9,
        "totalSugar": 1.5,
        "potassium": 150,
        "omega3": 0.2,
        "calcium": 25,
        "iron": 1,
        "magnesium": 20,
        "vitaminD": 0.2
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Es Petak Umpet",
      "chainName": "Mie Gacoan",
      "estimatedWeightGrams": 300,
      "cookingMethod": "blended and iced",
      "ingredients": [
        "iced sweetened syrup",
        "fruit chunks",
        "colorful jelly balls",
        "water"
      ],
      "boundingBox2D": [
        82,
        529,
        502,
        765
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 180,
        "protein": 0.5,
        "saturatedFat": 0,
        "transFat": 0,
        "addedSugar": 32,
        "totalFibre": 0.5,
        "sodium": 25,
        "totalFat": 0.2,
        "totalSugar": 34,
        "potassium": 90,
        "omega3": 0,
        "calcium": 15,
        "iron": 0.2,
        "magnesium": 10,
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
  "_internalReasoning": "Evaluated the meal consisting of Mie Suit, Siomay, and Es Petak Umpet from Mie Gacoan. Total calories are 840 kcal with 26.5g protein. However, added sugar (34g) exceeds the 24g daily limit, and sodium (1395mg) is very high, presenting risks for the user's prediabetes and hypertension.",
  "verdict": {
    "label": "141% over added sugar limit",
    "level": "warning"
  },
  "message": "You received 26.5g of satisfying protein from the chicken noodles and steamed siomay. However, the sweetened beverage pushes your added sugar intake to 34g, exceeding your daily limit. This high sugar and sodium load triggers an immediate blood glucose spike and fluid retention. Drink 500ml of water now and take a 20-minute walk to stabilize blood sugar.",
  "accuracyReview": {
    "isCorrected": false,
    "correctionNotes": null,
    "correctedMealNutrients": null
  },
  "extendedMealNutrients": {
    "solubleFibre": 1.2,
    "vitaminA": 120,
    "thiamine": 0.22,
    "riboflavin": 0.18,
    "niacin": 3.4,
    "vitaminB6": 0.25,
    "folate": 45,
    "vitaminB12": 0.8,
    "vitaminC": 12,
    "vitaminE": 1.1,
    "vitaminK": 18,
    "zinc": 1.9,
    "selenium": 18.5,
    "iodine": 15,
    "phosphorus": 240
  },
  "mealSummary": {
    "title": "Mie Gacoan Meal Set",
    "itemsSummary": [
      {
        "scoutIndex": 0,
        "name": "Mie Suit",
        "weightGrams": 220,
        "foodType": "Noodles",
        "cookingMethod": "boiled and fried"
      },
      {
        "scoutIndex": 1,
        "name": "Siomay",
        "weightGrams": 150,
        "foodType": "Dumpling",
        "cookingMethod": "steamed"
      },
      {
        "scoutIndex": 2,
        "name": "Es Petak Umpet",
        "weightGrams": 300,
        "foodType": "Beverage",
        "cookingMethod": "blended and iced"
      }
    ]
  }
}
```
</details>

---

### Case 7: `07_sainsbury_oat_fruits.jpg (Sainsbury Rolled Oats + Fresh Fruits)`

**Generated At:** 2026-08-23T22:43:46.942Z
**Evaluated Model:** `gemini-3.5-flash-lite` (Strictly used for both Stage 1 Scout & Stage 3 Dietitian)
**File(s):** `07_sainsbury_oat_fruits.jpg` | **Content Type:** `visual` | **Environment:** `home_cooked`

### 1. User Input Context & Active Clinical Biomarker Profile
- **User Prompt:** "I had 60g of sainsbury rolled oat + fruits"
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
- USER MESSAGE SCOPE ANCHOR & MULTI-DISH EXTRACTION: Extract EVERY distinct food, drink, side, companion plate, or meal item visible in the photo or menu/kiosk screen as its own separate entry in 'items' (e.g. if 2 dishes or a main + drink or a mug + plate of fruits are visible, output separate item objects for each). Do NOT combine distinct dishes into 1 item.
- If user's text message specifies a portion/weight (e.g. "50g of oats + fruits" or "60g of sainsbury rolled oat + fruits"), assign logically. The user's explicit text sentence is absolute ground truth.
- BRAND SEPARATION: When user mentions brand + staples (e.g. "Sainsbury oat + fruit"), apply 'chainName' strictly to the branded item ("Sainsbury oat"). Emit whole companion foods (fruits, drinks, sides) as separate unbranded items (e.g. extract Banana, Apple, Plum as separate whole fruit items).
- For each item, provide a 2D bounding box 'boundingBox2D': [ymin, xmin, ymax, xmax] in normalized 0-1000 coordinate space identifying the exact region of the image containing the item.
- Specify 'sourceImageIndex': integer index of the input image (0 for single image).
- Identify 'chainName': restaurant chain or brand name if applicable (e.g. 'Starbucks', 'McDonald's', 'Pret', 'Sainsbury's'), or null if home-cooked / unbranded.

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
> The user provided an image showing a bowl/cup of oatmeal with berries and grapes, plus a separate plate with whole fruits (banana, apple, plum). The user's text states 'I had 60g of sainsbury rolled oat + fruits'. According to instructions, brand 'Sainsbury's' applies strictly to the branded oat item. The companion foods (fruits in the mug and the entire fruit plate) are extracted as separate unbranded items. We extract the Sainsbury's oats with its toppings in the cup as one item, and the whole fruits on the plate as separate items or companion fruits as instructed.

#### Discovered Dishes & Per-Dish Core + Key Nutrients

##### Dish 1: Sainsbury's rolled oats with raspberries and grapes (180g) [Image 0]
- **Brand / Chain:** Sainsbury's (Official Brand DB)
- **Cooking Method:** boiled
- **Bounding Box:** `[454, 0, 995, 574]`
- **Ingredients:** Sainsbury's rolled oats, water or milk, raspberries, red grapes
- **Core Nutrients:** 312.5 kcal | 9.9g Protein | **52g Carbs [Derived]** | 7.2g Fat | 2.7g Sat Fat | 0g Trans Fat | 0g Added Sugar | 7g Fibre | 44mg Sodium
- **Key Nutrients:** 11.9g Total Sugar | **4.5g Unsat Fat [Derived]** | **0.11g Salt [Derived]** | 320mg Potassium | 0.1g Omega-3 | 40mg Calcium | 2.5mg Iron | 100mg Magnesium | 0mcg Vit D

##### Dish 2: Banana (118g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** raw
- **Bounding Box:** `[78, 336, 447, 959]`
- **Ingredients:** banana
- **Core Nutrients:** 105 kcal | 1.3g Protein | **24.3g Carbs [Derived]** | 0.3g Fat | 0.1g Sat Fat | 0g Trans Fat | 0g Added Sugar | 3g Fibre | 1mg Sodium
- **Key Nutrients:** 14.4g Total Sugar | **0.2g Unsat Fat [Derived]** | **0g Salt [Derived]** | 422mg Potassium | 0g Omega-3 | 6mg Calcium | 0.3mg Iron | 32mg Magnesium | 0mcg Vit D

##### Dish 3: Apple (182g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** raw
- **Bounding Box:** `[270, 442, 513, 831]`
- **Ingredients:** apple
- **Core Nutrients:** 95 kcal | 0.5g Protein | **22.6g Carbs [Derived]** | 0.3g Fat | 0g Sat Fat | 0g Trans Fat | 0g Added Sugar | 4.4g Fibre | 2mg Sodium
- **Key Nutrients:** 19g Total Sugar | **0.3g Unsat Fat [Derived]** | **0.01g Salt [Derived]** | 195mg Potassium | 0g Omega-3 | 11mg Calcium | 0.2mg Iron | 9mg Magnesium | 0mcg Vit D

##### Dish 4: Plum (66g) [Image 0]
- **Brand / Chain:** Unbranded
- **Cooking Method:** raw
- **Bounding Box:** `[121, 372, 297, 592]`
- **Ingredients:** plum
- **Core Nutrients:** 30 kcal | 0.5g Protein | **6.6g Carbs [Derived]** | 0.2g Fat | 0g Sat Fat | 0g Trans Fat | 0g Added Sugar | 0.9g Fibre | 0mg Sodium
- **Key Nutrients:** 6.6g Total Sugar | **0.2g Unsat Fat [Derived]** | **0g Salt [Derived]** | 104mg Potassium | 0g Omega-3 | 4mg Calcium | 0.1mg Iron | 5mg Magnesium | 0mcg Vit D

### 4. Stage 2 Output: Derivation Engine & Brand Database Matcher
> ⚠️ **Brand Database Replacement Notice:**
> - [BRAND DATABASE MATCH APPLIED]: Dish "Sainsbury's rolled oats with raspberries and grapes" matched to official Sainsbury's Scottish Whole Rolled Oats Brand Database entry. 60g verified oats (217.5 kcal, 6.6g P, 3.9g F) + mug preparations locked to 312.5 kcal, 9.9g Protein, 7.2g Total Fat, 7g Fibre, 44mg Sodium.

| Nutrient Category | Nutrient | Value |
| :--- | :--- | :--- |
| **Core (High Precision)** | Calories | 543 kcal |
| **Core (High Precision)** | Protein | 12.2 g |
| **Core (High Precision)** | Saturated Fat | 2.8 g |
| **Core (High Precision)** | Trans Fat | 0 g |
| **Core (High Precision)** | Added Sugar | 0 g |
| **Core (High Precision)** | Total Fibre | 15.3 g |
| **Core (High Precision)** | Sodium | 47 mg |
| **Core (Derived)** | **Carbohydrates** | **105.5 g** |
| **Key (Moderate Precision)** | Total Fat | 8 g |
| **Key (Moderate Precision)** | Total Sugar | 51.9 g |
| **Key (Moderate Precision)** | Potassium | 1041 mg |
| **Key (Moderate Precision)** | Omega-3 | 0.1 g |
| **Key (Moderate Precision)** | Calcium | 61 mg |
| **Key (Moderate Precision)** | Iron | 3.1 mg |
| **Key (Moderate Precision)** | Magnesium | 146 mg |
| **Key (Moderate Precision)** | Vitamin D | 0 mcg |
| **Key (Derived)** | **Unsaturated Fat** | **5.2 g** |
| **Key (Derived)** | **Salt** | **0.12 g** |

### 5. Stage 3 Output: Dietitian Clinical Coach Review & Extended Micronutrients
- **Verdict:** **Exceptional fibre for heart health** (Level: `good`)
- **Dietitian Message (4-Beat Narrative):**
  > You secured 15.3g of quality dietary fibre and 1,041mg of heart-healthy potassium from the oats and fresh fruits. Even though the carbohydrate load is 105.5g, the robust fibre matrix prevents a sharp glucose spike for your prediabetes. This nutrient density promotes steady, sustained energy without cardiovascular strain. Enjoy a light 15-minute walk to optimize insulin sensitivity and glucose clearance.
- **Accuracy Review Status:** ✅ **Scout Estimates Approved (No Correction Needed)**

##### Aggregate Extended Nutrients (Filled by Dietitian):
| Extended Nutrient (Directional Precision <50%) | Value |
| :--- | :--- |
| **Soluble Fibre** | 5.2 g |
| **Vitamin A** | 95 mcg |
| **Thiamine (B1)** | 0.32 mg |
| **Riboflavin (B2)** | 0.18 mg |
| **Niacin (B3)** | 1.4 mg |
| **Vitamin B6** | 0.55 mg |
| **Folate (B9)** | 58 mcg |
| **Vitamin B12** | 0 mcg |
| **Vitamin C** | 32.5 mg |
| **Vitamin E** | 0.8 mg |
| **Vitamin K** | 12.4 mcg |
| **Zinc** | 1.8 mg |
| **Selenium** | 14.2 mcg |
| **Iodine** | 5 mcg |
| **Phosphorus** | 240 mg |

#### Raw Payloads & JSON Output
<details><summary>Click to expand Raw Scout JSON</summary>

```json
{
  "_internalReasoning": "The user provided an image showing a bowl/cup of oatmeal with berries and grapes, plus a separate plate with whole fruits (banana, apple, plum). The user's text states 'I had 60g of sainsbury rolled oat + fruits'. According to instructions, brand 'Sainsbury's' applies strictly to the branded oat item. The companion foods (fruits in the mug and the entire fruit plate) are extracted as separate unbranded items. We extract the Sainsbury's oats with its toppings in the cup as one item, and the whole fruits on the plate as separate items or companion fruits as instructed.",
  "contentType": "visual",
  "diningEnvironment": "home_cooked",
  "items": [
    {
      "originalName": "Sainsbury's rolled oats with raspberries and grapes",
      "chainName": "Sainsbury's",
      "estimatedWeightGrams": 180,
      "cookingMethod": "boiled",
      "ingredients": [
        "Sainsbury's rolled oats",
        "water or milk",
        "raspberries",
        "red grapes"
      ],
      "boundingBox2D": [
        454,
        0,
        995,
        574
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 260,
        "protein": 8,
        "saturatedFat": 0.4,
        "transFat": 0,
        "addedSugar": 0,
        "totalFibre": 7.5,
        "sodium": 5,
        "totalFat": 3.5,
        "totalSugar": 6,
        "potassium": 320,
        "omega3": 0.1,
        "calcium": 40,
        "iron": 2.5,
        "magnesium": 100,
        "vitaminD": 0
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Banana",
      "chainName": null,
      "estimatedWeightGrams": 118,
      "cookingMethod": "raw",
      "ingredients": [
        "banana"
      ],
      "boundingBox2D": [
        78,
        336,
        447,
        959
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 105,
        "protein": 1.3,
        "saturatedFat": 0.1,
        "transFat": 0,
        "addedSugar": 0,
        "totalFibre": 3,
        "sodium": 1,
        "totalFat": 0.3,
        "totalSugar": 14.4,
        "potassium": 422,
        "omega3": 0,
        "calcium": 6,
        "iron": 0.3,
        "magnesium": 32,
        "vitaminD": 0
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Apple",
      "chainName": null,
      "estimatedWeightGrams": 182,
      "cookingMethod": "raw",
      "ingredients": [
        "apple"
      ],
      "boundingBox2D": [
        270,
        442,
        513,
        831
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 95,
        "protein": 0.5,
        "saturatedFat": 0,
        "transFat": 0,
        "addedSugar": 0,
        "totalFibre": 4.4,
        "sodium": 2,
        "totalFat": 0.3,
        "totalSugar": 19,
        "potassium": 195,
        "omega3": 0,
        "calcium": 11,
        "iron": 0.2,
        "magnesium": 9,
        "vitaminD": 0
      },
      "itemConfidence": "High"
    },
    {
      "originalName": "Plum",
      "chainName": null,
      "estimatedWeightGrams": 66,
      "cookingMethod": "raw",
      "ingredients": [
        "plum"
      ],
      "boundingBox2D": [
        121,
        372,
        297,
        592
      ],
      "sourceImageIndex": 0,
      "nutrients": {
        "calories": 30,
        "protein": 0.5,
        "saturatedFat": 0,
        "transFat": 0,
        "addedSugar": 0,
        "totalFibre": 0.9,
        "sodium": 0,
        "totalFat": 0.2,
        "totalSugar": 6.6,
        "potassium": 104,
        "omega3": 0,
        "calcium": 4,
        "iron": 0.1,
        "magnesium": 5,
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
  "_internalReasoning": "Evaluated the meal consisting of official Sainsbury's rolled oats with raspberries, grapes, a banana, apple, and plum. Total calories are 543 with a remarkable 15.3g of total fibre and zero added sugars (all sugar is natural whole-fruit and oat-derived). Despite high total carbohydrate content (105.5g), the massive soluble and insoluble fibre load slows glucose absorption significantly, making it safe for prediabetes. Potassium is very high (1041 mg) supporting hypertension management. Brand match data was incorporated directly.",
  "verdict": {
    "label": "Exceptional fibre for heart health",
    "level": "good"
  },
  "message": "You secured 15.3g of quality dietary fibre and 1,041mg of heart-healthy potassium from the oats and fresh fruits. Even though the carbohydrate load is 105.5g, the robust fibre matrix prevents a sharp glucose spike for your prediabetes. This nutrient density promotes steady, sustained energy without cardiovascular strain. Enjoy a light 15-minute walk to optimize insulin sensitivity and glucose clearance.",
  "accuracyReview": {
    "isCorrected": false,
    "correctionNotes": null,
    "correctedMealNutrients": null
  },
  "extendedMealNutrients": {
    "solubleFibre": 5.2,
    "vitaminA": 95,
    "thiamine": 0.32,
    "riboflavin": 0.18,
    "niacin": 1.4,
    "vitaminB6": 0.55,
    "folate": 58,
    "vitaminB12": 0,
    "vitaminC": 32.5,
    "vitaminE": 0.8,
    "vitaminK": 12.4,
    "zinc": 1.8,
    "selenium": 14.2,
    "iodine": 5,
    "phosphorus": 240
  },
  "mealSummary": {
    "title": "Sainsbury's Rolled Oats with Mixed Fresh Fruits",
    "itemsSummary": [
      {
        "scoutIndex": 0,
        "name": "Sainsbury's rolled oats with raspberries and grapes",
        "weightGrams": 180,
        "foodType": "cereal and fruit",
        "cookingMethod": "boiled"
      },
      {
        "scoutIndex": 1,
        "name": "Banana",
        "weightGrams": 118,
        "foodType": "fresh fruit",
        "cookingMethod": "raw"
      },
      {
        "scoutIndex": 2,
        "name": "Apple",
        "weightGrams": 182,
        "foodType": "fresh fruit",
        "cookingMethod": "raw"
      },
      {
        "scoutIndex": 3,
        "name": "Plum",
        "weightGrams": 66,
        "foodType": "fresh fruit",
        "cookingMethod": "raw"
      }
    ]
  }
}
```
</details>

---

