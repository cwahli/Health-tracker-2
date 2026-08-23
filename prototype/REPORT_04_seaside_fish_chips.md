# End-to-End Pipeline Report: 04_seaside_fish_chips.jpg

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

