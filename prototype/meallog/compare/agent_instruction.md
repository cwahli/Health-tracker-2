# Mode D (Product Evaluation & Comparison) — Agent Instruction & Contract

> 🔒 **PROTECTED SPECIFICATION** — Edits to this document require explicit human confirmation before modifying (AGENTS.md §3).
> Canonical agent instruction, dynamic prompt specification, schema, and reference output for Mode D Product Evaluation & Comparison (`Meal_03_compare`).

---

## 1. System Instruction (Complete Dispatch Body)

```markdown
=== NUTRITIONAL TARGET STATUS ===
3 days avg: Sat fat (27.7g - 38% over), Calorie (2500kcal - 39% over), Sodium (3000mg - 30% over), Protein (100g - 17% under), Carbohydrates (263.3g - 32% over), Total Fibre (22.3g - 26% under), Potassium (2100mg), Soluble Fibre (3.5g), Added Sugar (45g - 50% over), Trans Fat (0.1g)

You are a Clinical Dietitian & Vision Scout evaluating competing food options (Mode D).

TASK: EXHAUSTIVE DISH OCR, <=10% MACRO CLUSTERING, UNLISTED HAZARD/BENEFIT ISOLATION, AND TARGET-DRIVEN RANKING.

CLINICAL INVARIANTS:
1. EVALUATION ONLY (NON-ADDITIVE):
   - Items are mutually exclusive candidate choices. Never sum meal totals or log as a consumed plate. Do not calculate composite meal totals or prompt for portion confirmations.

2. EXHAUSTIVE EXTRACTION (NO SAMPLING):
   - Read all columns, sections, and pages top-to-bottom across ALL images without stopping.
   - Do NOT provide a representative sample, truncate, or cap at 3-5 exemplars. Capture EVERY single legible dish/product into groups (dense restaurant menus contain 30 to 100+ total dishes).

3. <=10% MACRO VARIANCE CLUSTERING:
   - Group items together ONLY if estimated macronutrients differ by <=10%.
   - Split broad categories into separate groups if preparation methods cause >10% macro variance (e.g., water-poached broths vs open-flame grilled vs batter-fried vs carb staples).

4. UNLISTED HARMS & BENEFITS ISOLATION:
   - Beyond raw macros, actively evaluate physiological hazards and cardioprotective benefits:
     * UNLISTED HARMS: Isolate oxidized deep-frying oils, lipid peroxides, trans fats, and ultra-processed gelatinized starches (e.g., Seblak) into Tier 3 (Warning) or Tier 4 (Alert).
     * BENEFITS: Elevate whole foods offering cardioprotective marine Omega-3s (EPA/DHA in whole sea fish) and antioxidant polyphenols (sour fruit broths) into Tier 1 (Good) or Tier 2 (Neutral).

5. TARGET-DRIVEN CLINICAL RANKING & COMBINED GUIDANCE:
   - Rank groups strictly descending: Best choice addressing the patient's active surpluses and deficits at the top ('good'), least suitable at the bottom ('alert').
   - Tailor all verdicts, comparative sentences, and clinical messages directly to the patient's target deviations.
   - Combine clinical guidance and an actionable ordering tip into a single cohesive message.
```

---

## 2. Dynamic Input Prompt

The user prompt conveys the evaluation intent across the uploaded images:

```
Exhaustively extract and rank ALL visible food options across provided images into distinct nutritional groups (no sampling, extract every legible dish).
Ensure groups have <=10% macro variance and isolate unlisted harms and benefits.
All rankings, comparison sentences, and combined clinical messages (with ordering tips) must directly address the patient's target deviations.
```

---

## 3. Required Output JSON Schema (with Embedded Field Guidance)

```json
{
  "type": "object",
  "properties": {
    "_internalReasoning": {
      "type": "string",
      "description": "Clinical evaluation trace. First list all detected visual sections and category headers on the menu/shelf (anchoring full scan), followed by <=10% macro clustering rationale, unlisted harm/benefit segregation, and patient target alignment."
    },
    "comparisonTitle": {
      "type": "string",
      "description": "Descriptive title of the evaluated menu, shelf, or products (e.g., 'Indonesian Street Food & Seafood Menu Health Evaluation')."
    },
    "comparisonType": {
      "type": "string",
      "enum": ["nutrition_labels", "menu_items", "shelf_selection", "food_items"]
    },
    "summary": {
      "type": "string",
      "description": "High-level clinical summary synthesizing the landscape of choices against the patient's specific metabolic surpluses and deficits."
    },
    "recommendedOption": {
      "type": "string",
      "description": "Top recommended dish or product formatted as 'Local Name / English Translation'."
    },
    "groups": {
      "type": "array",
      "description": "Distinct nutritional clusters with <=10% macro variance, ordered strictly from healthiest/safest to least favorable.",
      "items": {
        "type": "object",
        "properties": {
          "groupName": {
            "type": "string",
            "description": "Tier and descriptive cluster name (e.g., 'Tier 1 - Safest Choice: Tangy Poached Broths (Garang Asem)')."
          },
          "sourceImageIndex": {
            "type": "integer",
            "description": "0-based index of the photo containing this group's items/region (default 0)."
          },
          "verdict": {
            "type": "object",
            "properties": {
              "label": {
                "type": "string",
                "description": "3-6 word concise clinical verdict label (e.g., 'Lowest Fat & Clean Protein')."
              },
              "level": {
                "type": "string",
                "enum": ["good", "neutral", "warning", "alert"],
                "description": "Clinical safety level: 'good' (Tier 1), 'neutral' (Tier 2), 'warning' (Tier 3), 'alert' (Tier 4)."
              }
            },
            "required": ["label", "level"]
          },
          "comparisonSentence": {
            "type": "string",
            "description": "Exactly ONE comparative sentence contrasting how this group moves the user's specific targets compared to alternatives."
          },
          "message": {
            "type": "string",
            "description": "35-70 words combining clinical guidance on why this group ranks here relative to the user's active surpluses/deficits, concluding with an actionable ordering tip to minimize harm (e.g., choose plain variant, sauce on side, skip sweet glaze)."
          },
          "boundingBox2D": {
            "type": "array",
            "items": { "type": "integer" },
            "description": "[ymin, xmin, ymax, xmax] normalized (0 to 1000) framing this group's visual region on the photo."
          },
          "servingWeightGrams": {
            "type": "number",
            "description": "Typical single-serving weight in grams (e.g., 350 for soup/stew, 300 for plated meal, 250 for beverage, 70 for bread/pastry)."
          },
          "averageNutrientsPer100g": {
            "type": "object",
            "description": "Estimated nutrients per 100g reference. Track strictly the 10 patient allowance keys. Do NOT emit meal-logging trace minerals (no selenium, iodine, phosphorus, zinc, vitamin B12).",
            "properties": {
              "calories": { "type": "number" },
              "protein": { "type": "number" },
              "totalFat": { "type": "number" },
              "saturatedFat": { "type": "number" },
              "carbohydrates": { "type": "number" },
              "sugar": { "type": "number" },
              "addedSugar": { "type": "number" },
              "totalFibre": { "type": "number" },
              "sodium": { "type": "number" },
              "transFat": { "type": "number" }
            },
            "required": ["calories", "protein", "totalFat", "saturatedFat", "carbohydrates", "sugar", "totalFibre", "sodium"]
          },
          "items": {
            "type": "array",
            "description": "EXHAUSTIVE list of ALL visible dishes in this category across all columns, rows, and pages. Do NOT sample or truncate at 3-5 items; transcribe every legible item (dense menus have 15-30+ items per group). Format non-English names as 'Local Name / English Translation'.",
            "items": { "type": "string" }
          }
        },
        "required": ["groupName", "sourceImageIndex", "verdict", "comparisonSentence", "message", "boundingBox2D", "servingWeightGrams", "averageNutrientsPer100g", "items"]
      }
    }
  },
  "required": ["_internalReasoning", "comparisonTitle", "comparisonType", "summary", "recommendedOption", "groups"]
}
```

---

## 4. Reference Example Output (Set 5: Indonesian Street Food Banner Menu)

```json
{
  "_internalReasoning": "Evaluated all 57 dishes on the Indonesian banner menu. Clustered dishes into 4 distinct groups with <=10% macro variance, actively isolating unlisted benefits (marine EPA/DHA, broth polyphenols) and unlisted harms (oxidized deep-fry oils, ultra-processed gelatinized tapioca). Ranked directly against the patient's +38% saturated fat, +39% calorie, +30% sodium, and -17% protein targets.",
  "comparisonTitle": "Indonesian Street Food & Seafood Menu Health Evaluation",
  "comparisonType": "menu_items",
  "summary": "This menu presents stark contrasts in cardiovascular safety and lipid quality. For a patient managing +38% saturated fat and +39% calorie surpluses alongside a -17% protein deficit, water-poached Garang Asem broths and open-flame grilled marine fish represent superior choices by providing clean protein and natural cardioprotective omega-3s without cooking oil absorption. Conversely, batter-fried dishes introduce oxidized lipids and trans fats, while seblak and fried noodles combine excessive sodium with refined, pro-inflammatory starches.",
  "recommendedOption": "IKAN NILA GARANG ASEM + NASI / Tilapia in Spicy Sour Broth with Rice",

  "groups": [
    {
      "groupName": "Tier 1 - Safest Choice: Tangy Poached Broths (Garang Asem)",
      "verdict": {
        "label": "Lowest Fat & Clean Protein",
        "level": "good"
      },
      "comparisonSentence": "Unlike batter-fried seafood and oily fried rice, Garang Asem stews eliminate cooking oil absorption entirely, helping correct your +38% saturated fat surplus while providing lean protein for your -17% protein deficit.",
      "message": "Simmered in an aromatic broth with green tomatoes and bilimbi fruit, Garang Asem delivers clean protein with under 1g saturated fat per 100g. It provides unlisted antioxidant polyphenols without the lipid peroxides found in commercial fryers. Enjoying this broth directly mitigates your calorie and saturated fat overages. Practical ordering tip: Request the broth prepared with less salt to protect your +30% sodium surplus, and consume with half of the provided white rice.",
      "boundingBox2D": [330, 80, 580, 560],
      "servingWeightGrams": 350,
      "averageNutrientsPer100g": {
        "calories": 115,
        "protein": 10.5,
        "totalFat": 2.2,
        "saturatedFat": 0.5,
        "carbohydrates": 13.0,
        "sugar": 1.2,
        "addedSugar": 0.2,
        "totalFibre": 0.8,
        "sodium": 165,
        "transFat": 0.0
      },
      "items": [
        "IKAN NILA GARANG ASEM + NASI / Tilapia in Spicy Sour Broth with Rice",
        "AYAM GARANG ASEM + NASI / Chicken in Spicy Sour Broth with Rice",
        "TONGKOL GARANG ASEM + NASI / Mackerel Tuna in Spicy Sour Broth with Rice",
        "GURAME GARANG ASEM + NASI / Giant Gourami in Spicy Sour Broth with Rice"
      ]
    },
    {
      "groupName": "Tier 2 - Balanced Choice: Open-Flame Grilled Fish & Chicken",
      "verdict": {
        "label": "Lean Protein (Moderate Glaze)",
        "level": "neutral"
      },
      "comparisonSentence": "These open-flame grilled fish and chicken selections deliver high-density complete protein to close your -17% protein deficit with far less saturated fat than the deep-fried entrees.",
      "message": "Open-flame grilling allows surface fats to render off and avoids the oxidized oils of deep fryers. Whole marine fish like Bawal and Baronang supply unlisted cardioprotective Omega-3 fatty acids (EPA/DHA) that improve lipid profiles. However, be vigilant of sweet soy marinades (kecap manis) that exacerbate your +50% added sugar surplus. Practical ordering tip: Ask for the fish grilled with minimal sweet soy glaze and request chili sambal on the side to strictly control sugar and sodium additions.",
      "boundingBox2D": [130, 45, 850, 575],
      "servingWeightGrams": 300,
      "averageNutrientsPer100g": {
        "calories": 160,
        "protein": 12.0,
        "totalFat": 4.0,
        "saturatedFat": 1.0,
        "carbohydrates": 15.0,
        "sugar": 1.5,
        "addedSugar": 0.5,
        "totalFibre": 0.7,
        "sodium": 185,
        "transFat": 0.0
      },
      "items": [
        "NILA BAKAR / GR + NASI / Grilled or Fried Tilapia with Rice",
        "BAWAL BAKAR / GR + NASI / Grilled or Fried Pomfret with Rice",
        "BARONANG BAKAR / GR + NASI / Grilled or Fried Rabbitfish with Rice",
        "BANDENG BAKAR / GR + NASI / Grilled or Fried Milkfish with Rice",
        "TONGKOL BAKAR / GR + NASI / Grilled or Fried Mackerel Tuna with Rice",
        "CUE BAKAR / GR + NASI / Grilled or Fried Cue Fish with Rice",
        "IKAN QUE BAKAR / GR + NASI / Grilled or Fried Que Fish with Rice",
        "GURAME BAKAR / GORENG + NASI / Grilled or Fried Giant Gourami with Rice",
        "AYAM BAKAR + NASI / Grilled Chicken with Rice",
        "AYAM BAKAR SAMBEL / Grilled Chicken with Sambal",
        "AYAM BAKAR SAMBEL IJO + NASI / Grilled Chicken with Green Chili Sambal and Rice",
        "LAMPUNG + NASI / Lampung Style Chicken with Rice"
      ]
    },
    {
      "groupName": "Tier 3 - Caloric & Lipid Caution: Battered Sweet-Sour & Fried Dishes",
      "verdict": {
        "label": "Requires mindful portion balance",
        "level": "warning"
      },
      "comparisonSentence": "Compared to grilled fish, these battered and deep-fried dishes absorb significant cooking oil, worsening your +38% saturated fat and +39% calorie overages.",
      "message": "Flour batter acts as a sponge for degraded deep-frying palm oils, introducing unlisted lipid peroxides and trace trans fats that accelerate vascular inflammation. The sweet-and-sour sauces add high concentrations of refined sugar, worsening your +50% added sugar surplus. Practical ordering tip: If ordering, ask for sweet-sour sauce in a separate container and peel away thick fried batter coatings before eating.",
      "boundingBox2D": [145, 48, 920, 580],
      "servingWeightGrams": 300,
      "averageNutrientsPer100g": {
        "calories": 210,
        "protein": 10.5,
        "totalFat": 7.5,
        "saturatedFat": 2.5,
        "carbohydrates": 22.0,
        "sugar": 3.0,
        "addedSugar": 2.5,
        "totalFibre": 0.8,
        "sodium": 310,
        "transFat": 0.1
      },
      "items": [
        "GURAME ASAM MANIS + NASI / Giant Gourami in Sweet and Sour Sauce with Rice",
        "GURAME VILET ASAM MANIS + NASI / Giant Gourami Fillet in Sweet and Sour Sauce with Rice",
        "IKAN BAWAL ASEM MANIS + NASI / Pomfret in Sweet and Sour Sauce with Rice",
        "CUMI SAOS ASAM MANIS / Squid in Sweet and Sour Sauce",
        "ASAM MANIS + NASI / Sweet and Sour Fish with Rice",
        "AYAM ASAM MANIS + NASI / Chicken in Sweet and Sour Sauce with Rice",
        "CUMI GORENG TEPUNG + NASI / Crispy Battered Fried Squid with Rice",
        "CUMI GORENG TEPUNG / Crispy Battered Fried Squid",
        "AYAM GORENG GEPREK TEPUNG + NASI / Crispy Smashed Fried Chicken with Rice",
        "AYAM GORENG SAMBEL / Fried Chicken with Sambal",
        "AYAM GORENG SAMBEL IJO + NASI / Fried Chicken with Green Chili Sambal and Rice",
        "AYAM GORENG SAMBEL JUDES / Fried Chicken with Fierce Spicy Sambal",
        "AYAM MERCON + NASI / Firecracker Spicy Chicken with Rice",
        "TONGKOL SUIR PETE + NASI / Shredded Tuna with Stink Beans and Rice",
        "TONGKOL SUIR JENGKOL + NASI / Shredded Tuna with Jengkol Beans and Rice",
        "SEAFOOD TUMPAH / Spilled Mixed Seafood Platter"
      ]
    },
    {
      "groupName": "Tier 4 - Severe Hazard: Wok-Fried Rice, Noodles & Ultra-Processed Seblak",
      "verdict": {
        "label": "Excessive Sodium & Refined Carbs",
        "level": "alert"
      },
      "comparisonSentence": "These fried carb staples and seblak dishes deliver severe sodium concentrations (>400mg/100g) and heavy glycemic loads that directly aggravate your +30% sodium and +32% carb excesses.",
      "message": "Wok-fried rice and noodles absorb heavy seasoning pastes and cooking oils. Seblak represents an ultra-processed hazard: boiled tapioca crackers soaked in chili oil with synthetic flavor enhancers, delivering over 1500mg sodium in a single bowl while offering virtually zero dietary fiber (-26% deficit) or quality protein. Practical ordering tip: Avoid these selections completely to prevent acute blood pressure spikes and excessive caloric intake.",
      "boundingBox2D": [140, 610, 990, 995],
      "servingWeightGrams": 350,
      "averageNutrientsPer100g": {
        "calories": 185,
        "protein": 6.5,
        "totalFat": 6.0,
        "saturatedFat": 2.2,
        "carbohydrates": 24.0,
        "sugar": 1.5,
        "addedSugar": 0.8,
        "totalFibre": 0.6,
        "sodium": 420,
        "transFat": 0.1
      },
      "items": [
        "NASI GORENG SEAFOOD / Seafood Fried Rice",
        "NASI GORENG SPESIAL / Special Fried Rice",
        "NASI GORENG PETE / Fried Rice with Stink Beans",
        "NASI GORENG JENGKOL / Fried Rice with Jengkol Beans",
        "NASI GORENG SOSIS / Fried Rice with Sausage",
        "NASI GORENG BAKSO / Fried Rice with Meatballs",
        "NASI GORENG KORNET / Fried Rice with Corned Beef",
        "NASI GORENG TELOR DADAR / Fried Rice with Omelette",
        "NASI GORENG AYAM / Chicken Fried Rice",
        "SEBLAK COBEK VIRAL / Viral Stone Mortar Seblak Spicy Crackers",
        "SEBLAK SEAFOOD / Seafood Seblak Spicy Crackers",
        "SEBLAK CEKER / Chicken Feet Seblak Spicy Crackers",
        "CEKER MERCON / Firecracker Spicy Chicken Feet",
        "MIE TEK - TEK KUAH / Broth Mie Tek-Tek Noodles",
        "MIE TEK - TEK SOSIS / Mie Tek-Tek Noodles with Sausage",
        "MIE TEK - TEK BAKSO / Mie Tek-Tek Noodles with Meatballs",
        "MIE TEK - TEK KORNET / Mie Tek-Tek Noodles with Corned Beef",
        "MIE TEK - TEK SEAFOOD / Seafood Mie Tek-Tek Noodles",
        "MIE TEK - TEK SPECIAL / Special Mie Tek-Tek Noodles",
        "MIE TEK - TEK AYAM / Chicken Mie Tek-Tek Noodles",
        "KWETIAU GORENG BAKSO SOSIS / Fried Flat Rice Noodles with Meatballs and Sausage",
        "KWETIAU GORENG SEAFOOD / Seafood Fried Flat Rice Noodles",
        "KWETIAU KUAH SOSIS BAKSO / Flat Rice Noodle Soup with Sausage and Meatballs",
        "KWETIAU SPECIAL / Special Flat Rice Noodles",
        "KWETIAU AYAM / Chicken Flat Rice Noodles"
      ]
    }
  ]
}
```
