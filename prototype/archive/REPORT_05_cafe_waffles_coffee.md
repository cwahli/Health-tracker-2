# End-to-End Pipeline Report: 05_cafe_waffles_coffee.jpg

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

