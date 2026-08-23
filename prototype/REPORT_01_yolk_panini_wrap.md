# End-to-End Pipeline Report: 01_yolk_panini_wrap.jpg

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

