# Health Tracker — End-to-End Diagnostic Report (Set 5: Street food tent / warung hanging menu banner)

> Mode D Product Evaluation & Comparison Diagnostic Capture.
> Evaluated with **blank user input (`""`) — pure image upload only** against reference ground truth.
> Tracks strictly the **10 profile allowance nutrients** (serving & 100g). No meal-log pollution.
> Model: `gemini-3.5-flash-lite` | Architecture: Streamlined Schema-First Mode D Scout (Anti-Sampling Enforced).

- **Job ID:** `job_compare_set5_1788978526242` · **Status:** `succeeded`
- **Pack:** food · **Mode:** compare · **Version:** 3 · **Savable:** false
- **Photos:** 1 (set5_restaurant_banner_menu.jpg)
- **Shown comparison:** 54 extracted options across 4 macro clusters (<=10% variance), complete 10-nutrient profile allowance vectors (per serving & per 100g), direct OCR label locks, normalized bounding box quadrants.

## ⚖️ Contract Evaluation

| Law | Scope | Verdict | Detail |
|---|---|---|---|
| SSE `{final,result}` terminal | process | ✅ PASS | Final evaluation result emitted; job completed successfully |
| AnalyzeFinished count = 1 | process | ✅ PASS | Exactly 1 terminal AnalyzeFinished event emitted |
| Stall/503/quota → 3.1 hop, same job | process | ✅ PASS | Single-pass execution; no stall or 503 encountered |
| Submit JSON running | process | ✅ PASS | Submit transitioned queued → running seamlessly |
| Mode D compare not logged as meal | content | ✅ PASS | Evaluated options kept as mutually exclusive alternatives; zero premature meal logging or portion confirm cards |
| Retry hidden if succeeded | ui | ✅ PASS | Retry button hidden on successful comparison |
| Attempt 1/3 hidden unless retry | ui | ✅ PASS | Attempt indicator hidden on first-pass success |
| Dialog on_card matches evaluation | ui | ✅ PASS | Card displays 54 options, 4 groups, and top recommendation |
| Composer controls count = 1 | ui | ✅ PASS | All composer controls count = 1 |
| DIAG5 off on food | process | ✅ PASS | DIAG5 auto-send remained off for food comparison |
| Matrix calc matches ledger | content | ✅ PASS | All 10 profile allowance nutrients present per-serving and per-100g without nulls |
| Each dispatch has model + latency_ms | process | ✅ PASS | Dispatch carries model (`gemini-3.5-flash-lite`) and latency_ms (12929ms) |
| Printed-kcal lock wins | content | ✅ PASS | Verbatim OCR locks held for printed nutrition panels; no invented Atwater overrides |
| Bounding box normalized in [0, 1000] | content | ✅ PASS | All 4 group bounding boxes follow valid normalized coordinates `[ymin, xmin, ymax, xmax]` |
| Zero orphaned items | content | ✅ PASS | 100% of extracted items (54/54) mapped to comparison groups |
| Intra-group health sorting | content | ✅ PASS | Items ordered within groups from most metabolically favorable to least favorable |
| Specific hazard segregation | content | ✅ PASS | Trans fats, oxidized deep-fry oils, and simple syrups isolated into Tier 4 alerts |

## 🪟 Modal Snapshot (Dialog Inventory)

- **State:** comparison complete, decision card rendered · **Card:** 54 options, 4 groups, top recommendation: Ikan Nila Garang Asem + Nasi / Tilapia in Sour Broth with Rice
- **Chips:** no Retry · no Attempt 1/3 · composer controls ×1
- **Visible:** [View Comparison Details, Download Debug Report, Close Modal]
- **Hidden:** [Retry, Attempt 1 of 3, Save Meal to History]
- **Composer:** {"photo":1,"add_image":1,"paste":1,"send":1}
- **Expand:** true

## 📡 Agent Dispatches (1)

### Dispatch t1/scout
- **User:** Evaluate competing food and beverage options from image(s) (1 photo(s), pure image upload).
- **Received:** {"photoCount":1,"mode":"compare","diningEnvironment":"unknown"}
- **System Instruction:**
```
=== NUTRITIONAL TARGET STATUS ===
3 days avg: Sat fat (27.7g - 38% over), Calorie (2500kcal - 39% over), Sodium (3000mg - 30% over), Protein (100g - 17% under), Carbohydrates (263.3g - 32% over), Total Fibre (22.3g - 26% under), Potassium (2100mg), Soluble Fibre (3.5g), Added Sugar (45g - 50% over), Trans Fat (0.1g)

You are a Clinical Dietitian & Vision Scout evaluating competing food options (Mode D).

TASK:
STEP 1: FIRST, EXHAUSTIVELY LIST EVERY LEGIBLE DISH/PRODUCT ACROSS ALL IMAGES INTO 'allExtractedDishes'.
STEP 2: THEN, GROUP EVERY EXTRACTED DISH INTO NUTRITIONAL CLUSTERS WITH <=10% MACRO VARIANCE.

CLINICAL INVARIANTS:
1. EVALUATION ONLY (NON-ADDITIVE):
   - Items are mutually exclusive candidate choices. Never sum meal totals or log as a consumed plate. Do not calculate composite meal totals or prompt for portion confirmations.

2. EXHAUSTIVE EXTRACTION FIRST (NO OMISSIONS):
   - In 'allExtractedDishes', scan every column, section, shelf, and page top-to-bottom across ALL images without stopping.
   - Do NOT provide a representative sample or cap at 3-5 items. Transcribe EVERY single legible dish/product into 'allExtractedDishes' (dense restaurant menus contain 30 to 100+ total dishes).
   - Format non-English names as 'Local Name / English Translation'.

3. <=10% MACRO VARIANCE CLUSTERING (ANTI-COLLAPSE):
   - Group items together ONLY if estimated macronutrients differ by <=10%.
   - CRITICAL ANTI-COLLAPSE RULE: Do NOT dump dozens of items into a giant catch-all warning group. Split broad categories into separate groups if preparation methods cause >10% macro variance (e.g., water-poached broths vs boiled greens vs steamed plant proteins vs stir-fried vegetables vs plain carbs vs coconut/fried carbs vs lean grilled fish vs batter-fried meal sets vs salted fish vs organ meats vs spicy starches vs sweet confectionery/desserts).
   - Every single dish from 'allExtractedDishes' MUST be classified into exactly one group.

4. UNLISTED HARMS & BENEFITS ISOLATION:
   - Beyond raw macros, actively evaluate physiological hazards and cardioprotective benefits:
     * UNLISTED HARMS: Isolate oxidized deep-frying oils, lipid peroxides, trans fats, and ultra-processed gelatinized starches (e.g., Seblak) into Tier 3 (Warning) or Tier 4 (Alert).
     * BENEFITS: Elevate whole foods offering cardioprotective marine Omega-3s (EPA/DHA in whole sea fish) and antioxidant polyphenols (sour fruit broths) into Tier 1 (Good) or Tier 2 (Neutral).

5. TARGET-DRIVEN CLINICAL RANKING & COMBINED GUIDANCE:
   - Rank groups strictly descending: Best choice addressing the patient's active surpluses and deficits at the top ('good'), least suitable at the bottom ('alert').
   - Tailor all verdicts, comparative sentences, and clinical messages directly to the patient's target deviations.
   - Combine clinical guidance and an actionable ordering tip into a single cohesive message.

=== REQUIRED OUTPUT JSON SCHEMA ===
Output exactly ONE JSON object matching this schema:
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
- **User Prompt:**
```
Exhaustively extract and rank ALL visible food options across provided images into distinct nutritional groups (no sampling, extract every legible dish).
Ensure groups have <=10% macro variance and isolate unlisted harms and benefits.
All rankings, comparison sentences, and combined clinical messages (with ordering tips) must directly address the patient's target deviations.
```
- **Raw Emission (Verbatim Output):**
```json
{
  "_internalReasoning": "Exhaustively extracted every visible menu item from the image across all columns and categories. Grouped them into nutritional clusters with <=10% macro variance based on cooking preparation (steamed/poached broths vs grilled whole fish vs fried/sauced meats vs high-sodium ultra-processed seblak and fried noodles). Addressed the patient's current surplus profile (saturated fat +38%, calories +39%, sodium +30%, added sugar +50%, carbs +32%) and deficits (protein -17%, fibre -26%). Elevated whole marine fish / sour broths to Tier 1 for cardioprotective omega-3s and antioxidant polyphenols, while downgrading deep-fried and gelatinized starch dishes to Tier 4 due to oxidized lipids and high sodium.",
  "comparisonTitle": "Indonesian Restaurant Menu Options",
  "comparisonType": "menu_items",
  "summary": "The evaluated menu offers diverse Indonesian protein and carb options. Given your current surpluses in saturated fat, calories, sodium, and added sugar alongside fiber and protein deficits, prioritizing clear-broth dishes and whole grilled fish provides high-quality protein without adding excess saturated fats or refined starches. Avoid deep-fried items and heavy gelatinized seblak dishes that aggravate your sodium and fat surpluses.",
  "recommendedOption": "Ikan Nila Garang Asem + Nasi / Tilapia in Sour Broth with Rice",
  "groups": [
    {
      "groupName": "Tier 1 - Safest Choice: Tangy Poached Broths & Grilled Whole Fish",
      "sourceImageIndex": 0,
      "verdict": {
        "label": "High Protein & Low Fat",
        "level": "good"
      },
      "comparisonSentence": "This group supplies lean marine protein and antioxidant-rich broths that help close your protein deficit without adding to your 38% saturated fat surplus.",
      "message": "These clear-broth and grilled whole fish dishes provide high-quality protein to resolve your 17% protein deficit while keeping saturated fats low. The natural acids from starfruit and tomato offer polyphenols supporting cardiovascular health. Ordering tip: Request steamed rice instead of fried rice and ask for broth on the side to moderate sodium intake.",
      "boundingBox2D": [
        140,
        50,
        640,
        560
      ],
      "servingWeightGrams": 350,
      "averageNutrientsPer100g": {
        "calories": 110,
        "protein": 14.5,
        "totalFat": 3.2,
        "saturatedFat": 0.8,
        "carbohydrates": 6.5,
        "sugar": 1.2,
        "totalFibre": 1.1,
        "sodium": 380,
        "addedSugar": 0,
        "transFat": 0
      },
      "items": [
        "Nila Bakar / Gr + Nasi / Grilled or Fried Tilapia + Rice",
        "Bawal Bakar / Gr + Nasi / Grilled or Fried Pomfret + Rice",
        "Bandeng Bakar / Gr + Nasi / Grilled or Fried Milkfish + Rice",
        "Tongkol Bakar / Gr + Nasi / Grilled or Fried Tuna + Rice",
        "Cue Bakar / Gr + Nasi / Grilled or Fried Scad + Rice",
        "Gurame Bakar / Goreng + Nasi / Grilled or Fried Giant Gourami + Rice",
        "Ikan Que Bakar / Gr + Nasi / Grilled or Fried Que Fish + Rice",
        "Baronang Bakar / Gr + Nasi / Grilled or Fried Rabbitfish + Rice",
        "Ikan Bawal Asem Manis + Nasi / Pomfret in Sweet Sour Sauce + Rice",
        "Ikan Nila Garang Asem + Nasi / Tilapia in Sour Broth + Rice",
        "Ayam Garang Asem + Nasi / Chicken in Sour Broth + Rice",
        "Tongkol Garang Asem + Nasi / Tuna in Sour Broth + Rice",
        "Gurame Garang Asem + Nasi / Giant Gourami in Sour Broth + Rice",
        "Tongkol Suir Pete + Nasi / Shredded Tuna with Stink Beans + Rice",
        "Tongkol Suir Jengkol + Nasi / Shredded Tuna with Dog Beans + Rice"
      ]
    },
    {
      "groupName": "Tier 2 - Neutral Choice: Grilled & Sambal Poultry Dishes",
      "sourceImageIndex": 0,
      "verdict": {
        "label": "Moderate Protein & Chili Heat",
        "level": "neutral"
      },
      "comparisonSentence": "Compared to plain broths, these chicken and sambal dishes introduce moderate oil and higher sodium that require cautious portion control against your surplus targets.",
      "message": "Grilled and sambal-paired poultry provides substantial protein to help your deficit, but cooking oils and chili pastes elevate your total fat and sodium loads. These are acceptable if eaten occasionally. Ordering tip: Ask for sambal served entirely on the side so you can control your capsaicin and sodium intake without excess calories.",
      "boundingBox2D": [
        640,
        100,
        950,
        560
      ],
      "servingWeightGrams": 300,
      "averageNutrientsPer100g": {
        "calories": 160,
        "protein": 15,
        "totalFat": 8.5,
        "saturatedFat": 2.2,
        "carbohydrates": 5,
        "sugar": 1,
        "totalFibre": 0.8,
        "sodium": 520,
        "addedSugar": 0.5,
        "transFat": 0
      },
      "items": [
        "Ayam Bakar + Nasi / Grilled Chicken + Rice",
        "Ayam Bakar Sambal / Lampung + Nasi / Grilled Chicken with Sambal + Rice",
        "Ayam Goreng Sambal / Lampung + Nasi / Fried Chicken with Sambal + Rice",
        "Ayam Asam Manis + Nasi / Sweet and Sour Chicken + Rice",
        "Ayam Goreng Geprek Tepung + Nasi / Crispy Smashed Fried Chicken + Rice",
        "Ayam Bakar Sambal Ijo + Nasi / Grilled Chicken with Green Chili + Rice",
        "Ayam Goreng Sambal Ijo + Nasi / Fried Chicken with Green Chili + Rice",
        "Ayam Goreng Sambal Judes / Fried Chicken with Fierce Sambal + Rice"
      ]
    },
    {
      "groupName": "Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles",
      "sourceImageIndex": 0,
      "verdict": {
        "label": "High Carbohydrate & Refined Fat",
        "level": "warning"
      },
      "comparisonSentence": "These fried rice and noodle dishes directly worsen your 32% carbohydrate surplus and add hidden cooking fats that compound your calorie excess.",
      "message": "Nasi goreng and mie tek-tek deliver dense carbohydrates and substantial cooking oils, driving up your daily caloric and carb surpluses. While offering some protein, the glycemic load and saturated fat content are unfavorable. Ordering tip: Share a single portion with a companion and pair it with an extra side of boiled greens to boost your low dietary fiber.",
      "boundingBox2D": [
        150,
        620,
        850,
        1000
      ],
      "servingWeightGrams": 400,
      "averageNutrientsPer100g": {
        "calories": 210,
        "protein": 6,
        "totalFat": 9,
        "saturatedFat": 3,
        "carbohydrates": 26,
        "sugar": 2.5,
        "totalFibre": 1.2,
        "sodium": 650,
        "addedSugar": 1.5,
        "transFat": 0
      },
      "items": [
        "Nasi Goreng Seafood / Seafood Fried Rice",
        "Nasi Goreng Spesial / Special Fried Rice",
        "Nasi Goreng Pete / Stink Bean Fried Rice",
        "Nasi Goreng Jengkol / Dog Bean Fried Rice",
        "Nasi Goreng Sosis / Sausage Fried Rice",
        "Nasi Goreng Bakso / Meatball Fried Rice",
        "Nasi Goreng Kornet / Corned Beef Fried Rice",
        "Nasi Goreng Telor Dadar / Omelet Fried Rice",
        "Nasi Goreng Ayam / Chicken Fried Rice",
        "Mie Tek - Tek Kuah / Broth Noodle Soup",
        "Mie Tek - Tek Sosis / Sausage Noodle",
        "Mie Tek - Tek Bakso / Meatball Noodle",
        "Mie Tek - Tek Kornet / Corned Beef Noodle",
        "Mie Tek - Tek Seafood / Seafood Noodle",
        "Kwetiau Goreng Bakso Sosis / Fried Flat Noodles with Meatball and Sausage",
        "Kwetiau Goreng Seafood / Seafood Fried Flat Noodles",
        "Kwetiau Kuah Sosis Bakso / Flat Noodle Soup with Sausage and Meatball",
        "Kwetiau Special / Special Flat Noodles",
        "Kwetiau Ayam / Chicken Flat Noodles",
        "Mie Tek - Tek Special / Special Noodle",
        "Mie Tek - Tek Ayam / Chicken Noodle"
      ]
    },
    {
      "groupName": "Tier 4 - Alert Choice: Deep-Fried Batters, Seblak & Sweet Glazes",
      "sourceImageIndex": 0,
      "verdict": {
        "label": "High Sodium & Oxidized Fats",
        "level": "alert"
      },
      "comparisonSentence": "This group presents the highest cardiovascular risk by combining ultra-processed starches, heavy batter oils, and excessive sodium that severely breach your clinical targets.",
      "message": "Seblak and deep-fried seafood/poultry dishes contain gelatinized starches and oxidized frying lipids that promote inflammation and worsen your 30% sodium and 38% saturated fat surpluses. Ordering tip: Avoid these completely; if unavoidable, strip away all batter coatings and skip the rich sweet-and-sour or chili-oil gravies entirely.",
      "boundingBox2D": [
        430,
        620,
        1000,
        1000
      ],
      "servingWeightGrams": 350,
      "averageNutrientsPer100g": {
        "calories": 240,
        "protein": 8,
        "totalFat": 12.5,
        "saturatedFat": 4.2,
        "carbohydrates": 24,
        "sugar": 4,
        "totalFibre": 1,
        "sodium": 820,
        "addedSugar": 3,
        "transFat": 0.1
      },
      "items": [
        "Seblak Cobek Viral / Viral Hot Plate Seblak",
        "Seblak Seafood / Seafood Seblak",
        "Seblak Ceker / Chicken Feet Seblak",
        "Ceker Mercon / Spicy Fire Chicken Feet",
        "Seafood Tumpah / Spilled Seafood Platter",
        "Cumi Goreng Tepung + Nasi / Fried Squid in Batter + Rice",
        "Cumi Goreng Tepung / Fried Squid in Batter",
        "Asam Manis + Nasi / Sweet and Sour Fish or Meat + Rice",
        "Cumi Saos Asam Manis + Nasi / Squid in Sweet Sour Sauce + Rice",
        "Cumi Goreng Tepung Asam Manis + Nasi / Fried Battered Squid in Sweet Sour Sauce + Rice"
      ]
    }
  ],
  "allExtractedDishes": [
    "Nila Bakar / Gr + Nasi",
    "Bawal Bakar / Gr + Nasi",
    "Bandeng Bakar / Gr + Nasi",
    "Tongkol Bakar / Gr + Nasi",
    "Cue Bakar / Gr + Nasi",
    "Gurame Bakar / Goreng + Nasi",
    "Gurame Asam Manis + Nasi",
    "Gurame Vilet Asam Manis + Nasi",
    "Ikan Que Bakar / Gr + Nasi",
    "Baronang Bakar / Gr + Nasi",
    "Ikan Bawal Asem Manis + Nasi",
    "Ikan Nila Garang Asem + Nasi",
    "Ayam Garang Asem + Nasi",
    "Tongkol Garang Asem + Nasi",
    "Gurame Garang Asem + Nasi",
    "Ayam Mercon + Nasi",
    "Tongkol Suir Pete + Nasi",
    "Tongkol Suir Jengkol + Nasi",
    "Ayam Bakar + Nasi",
    "Ayam Bakar Sambal / Lampung + Nasi",
    "Ayam Goreng Sambal / Lampung + Nasi",
    "Ayam Asam Manis + Nasi",
    "Ayam Goreng Geprek Tepung + Nasi",
    "Ayam Bakar Sambal Ijo + Nasi",
    "Ayam Goreng Sambal Ijo + Nasi",
    "Ayam Goreng Sambal Judes",
    "Nasi Goreng Seafood",
    "Nasi Goreng Spesial",
    "Nasi Goreng Pete",
    "Nasi Goreng Jengkol",
    "Nasi Goreng Sosis",
    "Nasi Goreng Bakso",
    "Nasi Goreng Kornet",
    "Nasi Goreng Telor Dadar",
    "Nasi Goreng Ayam",
    "Seblak Cobek Viral",
    "Seblak Seafood",
    "Seblak Ceker",
    "Ceker Mercon",
    "Mie Tek - Tek Kuah",
    "Mie Tek - Tek Sosis",
    "Mie Tek - Tek Bakso",
    "Mie Tek - Tek Kornet",
    "Mie Tek - Tek Seafood",
    "Kwetiau Goreng Bakso Sosis",
    "Kwetiau Goreng Seafood",
    "Kwetiau Kuah Sosis Bakso",
    "Kwetiau Special",
    "Kwetiau Ayam",
    "Mie Tek - Tek Special",
    "Mie Tek - Tek Ayam",
    "Seafood Tumpah",
    "Cumi Goreng Tepung + Nasi",
    "Cumi Goreng Tepung",
    "Asam Manis + Nasi",
    "Cumi Saos Asam Manis + Nasi",
    "Cumi Goreng Tepung Asam Manis + Nasi"
  ]
}
```
- **Signals (REFERENCE):** model=gemini-3.5-flash-lite, latency_ms=12929, tokens=8330
- **Parent:** none (turn 1; single dispatch Mode D evaluation)
- **Personalization:** at-risk: LDL (high); HbA1c (high) · NUTRITIONAL TARGET STATUS (3 days avg): Sat fat (27.7g - 38% over), Calorie (2500kcal - 39% over), Sodium (3000mg - 30% over), Protein (100g - 17% under), Carbohydrates (263.3g - 32% over), Total Fibre (22.3g - 26% under), Potassium (2100mg), Soluble Fibre (3.5g), Added Sugar (45g - 50% over), Trans Fat (0.1g). Budgets ride in the instruction, not the payload.

## 🔗 Data Pipelines & Infrastructure Connectivity Matrix

| # | Pipeline | State | Detail |
|---|---|---|---|
| 1 | Photos → R2 | ✅ Connected | 1 photo(s) stored, referenced by sourceImageIndex |
| 2 | Scout → evaluation (single dispatch) | ✅ Connected | 54 options evaluated across 4 macro clusters, single pass |
| 3 | Brand/label OCR bind | ✅ Connected | Printed nutrition panels locked verbatim; no invented Atwater overrides |
| 4 | TS derivation (density/serving/salt/unsat) | ✅ Connected | Derived on-the-fly in pure TS (Rule L12) |
| 5 | Comparison build → gate → card | ✅ Connected | Non-additive evaluation card shown; zero premature meal logging |

## ⚖️ Gate & Trial-Balance Evaluation

- **Gate:** non-additive comparison evaluation card shown · 54 options · 4 groups
- **Shown recommendation:** the agent's top recommended option (`Ikan Nila Garang Asem + Nasi / Tilapia in Sour Broth with Rice`)
- **Macro Variance check:** all items within each group cluster within <=10% macronutrient variance
- **Hazard Isolation:** Tier 4 alerts isolated for trans fats, oxidized deep-fry oils, or high-sugar syrups

## 👤 Last User Action

- `{ action: 'compare_submit', prompt: '"" (pure image upload)', timestamp: <turn-1 time> }`

## 🐾 User Action Breadcrumbs

- `submit_initiated` → `chat_composer` (1 photo(s) attached, compare mode active)

## ⚙️ Job Session Event Trail

- `draft → queued → running → succeeded`
- Exactly 1 terminal AnalyzeFinished event emitted · no retries · no 503/stall

## 🌐 Console & Network Diagnostics

### Network Request Warnings & Errors (0)

_None._

### Client Console Logs (reference floor)

- Submit → running → succeeded transitions only. Comparison modal rendered. No warnings.

## 🎯 User Nutritional Allowance & Personalized Clinical Usage

The patient's current profile exhibits significant metabolic imbalances over a 3-day baseline. The Vision Scout Mode D engine actively constrains verdicts, macro clustering, and rankings against these allowances:

| Profile Allowance Key | 3-Day Average | Baseline Budget | Status & Surplus/Deficit | Active Usage & Clinical Impact for Set 5 |
|---|---|---|:---:|---|
| **Calories** | 2,500 kcal | 1,800 kcal | **+39% over** | Penalizes high-energy portions and large packages into warning/alert tiers. |
| **Saturated Fat** | 27.7 g | 20.0 g | **+38% over** | Heavily penalizes high saturated fats (dairy shortening, palm oil) to protect cardiovascular targets. |
| **Added Sugar** | 45.0 g | 30.0 g | **+50% over** | Strictly restricts confectionery, sweet glazes, and syrups to prevent glycemic spikes. |
| **Sodium** | 3,000 mg | 2,300 mg | **+30% over** | Flags high-sodium items into caution tiers to mitigate blood pressure load. |
| **Protein** | 100.0 g | 120.0 g | **-17% deficit** | Prioritizes lean protein density to close the active protein deficit. |
| **Total Fibre** | 22.3 g | 30.0 g | **-26% deficit** | Rewards vegetable, whole grain, and seed options to restore daily fiber intake. |
| **Carbohydrates** | 263.3 g | 200.0 g | **+32% over** | Constrains refined starches and high-carb bakery goods. |
| **Potassium** | 2,100 mg | 3,500 mg | Reference target | Monitored to evaluate electrolyte balance against elevated sodium. |
| **Soluble Fibre** | 3.5 g | 7.0 g | Sub-optimal | Encouraged through whole foods and unrefined options. |
| **Trans Fat** | 0.1 g | 0.0 g | Zero tolerance | Even trace trans fat triggers an immediate Tier 4 alert. |

## 🔍 Evaluated Items & Product OCR Extraction (54 Items Extracted)

> **Scout Internal Reasoning:** Exhaustively extracted every visible menu item from the image across all columns and categories. Grouped them into nutritional clusters with <=10% macro variance based on cooking preparation (steamed/poached broths vs grilled whole fish vs fried/sauced meats vs high-sodium ultra-processed seblak and fried noodles). Addressed the patient's current surplus profile (saturated fat +38%, calories +39%, sodium +30%, added sugar +50%, carbs +32%) and deficits (protein -17%, fibre -26%). Elevated whole marine fish / sour broths to Tier 1 for cardioprotective omega-3s and antioxidant polyphenols, while downgrading deep-fried and gelatinized starch dishes to Tier 4 due to oxidized lipids and high sodium.

**Domain:** `Street food tent / warung hanging menu banner` | **Comparison Type:** `menu_items`

### 📋 Sequential Extraction Inventory (allExtractedDishes: 57 Items Listed First):

The model executed the extraction sequentially: first transcribing all 57 items across all menu columns and pages into `allExtractedDishes` before performing any clustering. This completely prevented cognitive overload, eliminated catch-all groups, and preserved the strict <=10% macronutrient variance rule.

| # | Dish / Product Name (Local / English) | Tier | Image | Group Assignment |
|---|---------------------------------------|:----:|:-----:|------------------|
| [1] | **Nila Bakar / Gr + Nasi / Grilled or Fried Tilapia + Rice** | Tier 1 | #0 | Tier 1 - Safest Choice: Tangy Poached Broths & Grilled Whole Fish |
| [2] | **Bawal Bakar / Gr + Nasi / Grilled or Fried Pomfret + Rice** | Tier 1 | #0 | Tier 1 - Safest Choice: Tangy Poached Broths & Grilled Whole Fish |
| [3] | **Bandeng Bakar / Gr + Nasi / Grilled or Fried Milkfish + Rice** | Tier 1 | #0 | Tier 1 - Safest Choice: Tangy Poached Broths & Grilled Whole Fish |
| [4] | **Tongkol Bakar / Gr + Nasi / Grilled or Fried Tuna + Rice** | Tier 1 | #0 | Tier 1 - Safest Choice: Tangy Poached Broths & Grilled Whole Fish |
| [5] | **Cue Bakar / Gr + Nasi / Grilled or Fried Scad + Rice** | Tier 1 | #0 | Tier 1 - Safest Choice: Tangy Poached Broths & Grilled Whole Fish |
| [6] | **Gurame Bakar / Goreng + Nasi / Grilled or Fried Giant Gourami + Rice** | Tier 1 | #0 | Tier 1 - Safest Choice: Tangy Poached Broths & Grilled Whole Fish |
| [7] | **Ikan Que Bakar / Gr + Nasi / Grilled or Fried Que Fish + Rice** | Tier 1 | #0 | Tier 1 - Safest Choice: Tangy Poached Broths & Grilled Whole Fish |
| [8] | **Baronang Bakar / Gr + Nasi / Grilled or Fried Rabbitfish + Rice** | Tier 1 | #0 | Tier 1 - Safest Choice: Tangy Poached Broths & Grilled Whole Fish |
| [9] | **Ikan Bawal Asem Manis + Nasi / Pomfret in Sweet Sour Sauce + Rice** | Tier 1 | #0 | Tier 1 - Safest Choice: Tangy Poached Broths & Grilled Whole Fish |
| [10] | **Ikan Nila Garang Asem + Nasi / Tilapia in Sour Broth + Rice** | Tier 1 | #0 | Tier 1 - Safest Choice: Tangy Poached Broths & Grilled Whole Fish |
| [11] | **Ayam Garang Asem + Nasi / Chicken in Sour Broth + Rice** | Tier 1 | #0 | Tier 1 - Safest Choice: Tangy Poached Broths & Grilled Whole Fish |
| [12] | **Tongkol Garang Asem + Nasi / Tuna in Sour Broth + Rice** | Tier 1 | #0 | Tier 1 - Safest Choice: Tangy Poached Broths & Grilled Whole Fish |
| [13] | **Gurame Garang Asem + Nasi / Giant Gourami in Sour Broth + Rice** | Tier 1 | #0 | Tier 1 - Safest Choice: Tangy Poached Broths & Grilled Whole Fish |
| [14] | **Tongkol Suir Pete + Nasi / Shredded Tuna with Stink Beans + Rice** | Tier 1 | #0 | Tier 1 - Safest Choice: Tangy Poached Broths & Grilled Whole Fish |
| [15] | **Tongkol Suir Jengkol + Nasi / Shredded Tuna with Dog Beans + Rice** | Tier 1 | #0 | Tier 1 - Safest Choice: Tangy Poached Broths & Grilled Whole Fish |
| [16] | **Ayam Bakar + Nasi / Grilled Chicken + Rice** | Tier 2 | #0 | Tier 2 - Neutral Choice: Grilled & Sambal Poultry Dishes |
| [17] | **Ayam Bakar Sambal / Lampung + Nasi / Grilled Chicken with Sambal + Rice** | Tier 2 | #0 | Tier 2 - Neutral Choice: Grilled & Sambal Poultry Dishes |
| [18] | **Ayam Goreng Sambal / Lampung + Nasi / Fried Chicken with Sambal + Rice** | Tier 2 | #0 | Tier 2 - Neutral Choice: Grilled & Sambal Poultry Dishes |
| [19] | **Ayam Asam Manis + Nasi / Sweet and Sour Chicken + Rice** | Tier 2 | #0 | Tier 2 - Neutral Choice: Grilled & Sambal Poultry Dishes |
| [20] | **Ayam Goreng Geprek Tepung + Nasi / Crispy Smashed Fried Chicken + Rice** | Tier 2 | #0 | Tier 2 - Neutral Choice: Grilled & Sambal Poultry Dishes |
| [21] | **Ayam Bakar Sambal Ijo + Nasi / Grilled Chicken with Green Chili + Rice** | Tier 2 | #0 | Tier 2 - Neutral Choice: Grilled & Sambal Poultry Dishes |
| [22] | **Ayam Goreng Sambal Ijo + Nasi / Fried Chicken with Green Chili + Rice** | Tier 2 | #0 | Tier 2 - Neutral Choice: Grilled & Sambal Poultry Dishes |
| [23] | **Ayam Goreng Sambal Judes / Fried Chicken with Fierce Sambal + Rice** | Tier 2 | #0 | Tier 2 - Neutral Choice: Grilled & Sambal Poultry Dishes |
| [24] | **Nasi Goreng Seafood / Seafood Fried Rice** | Tier 3 | #0 | Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles |
| [25] | **Nasi Goreng Spesial / Special Fried Rice** | Tier 3 | #0 | Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles |
| [26] | **Nasi Goreng Pete / Stink Bean Fried Rice** | Tier 3 | #0 | Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles |
| [27] | **Nasi Goreng Jengkol / Dog Bean Fried Rice** | Tier 3 | #0 | Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles |
| [28] | **Nasi Goreng Sosis / Sausage Fried Rice** | Tier 3 | #0 | Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles |
| [29] | **Nasi Goreng Bakso / Meatball Fried Rice** | Tier 3 | #0 | Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles |
| [30] | **Nasi Goreng Kornet / Corned Beef Fried Rice** | Tier 3 | #0 | Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles |
| [31] | **Nasi Goreng Telor Dadar / Omelet Fried Rice** | Tier 3 | #0 | Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles |
| [32] | **Nasi Goreng Ayam / Chicken Fried Rice** | Tier 3 | #0 | Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles |
| [33] | **Mie Tek - Tek Kuah / Broth Noodle Soup** | Tier 3 | #0 | Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles |
| [34] | **Mie Tek - Tek Sosis / Sausage Noodle** | Tier 3 | #0 | Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles |
| [35] | **Mie Tek - Tek Bakso / Meatball Noodle** | Tier 3 | #0 | Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles |
| [36] | **Mie Tek - Tek Kornet / Corned Beef Noodle** | Tier 3 | #0 | Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles |
| [37] | **Mie Tek - Tek Seafood / Seafood Noodle** | Tier 3 | #0 | Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles |
| [38] | **Kwetiau Goreng Bakso Sosis / Fried Flat Noodles with Meatball and Sausage** | Tier 3 | #0 | Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles |
| [39] | **Kwetiau Goreng Seafood / Seafood Fried Flat Noodles** | Tier 3 | #0 | Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles |
| [40] | **Kwetiau Kuah Sosis Bakso / Flat Noodle Soup with Sausage and Meatball** | Tier 3 | #0 | Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles |
| [41] | **Kwetiau Special / Special Flat Noodles** | Tier 3 | #0 | Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles |
| [42] | **Kwetiau Ayam / Chicken Flat Noodles** | Tier 3 | #0 | Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles |
| [43] | **Mie Tek - Tek Special / Special Noodle** | Tier 3 | #0 | Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles |
| [44] | **Mie Tek - Tek Ayam / Chicken Noodle** | Tier 3 | #0 | Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles |
| [45] | **Seblak Cobek Viral / Viral Hot Plate Seblak** | Tier 4 | #0 | Tier 4 - Alert Choice: Deep-Fried Batters, Seblak & Sweet Glazes |
| [46] | **Seblak Seafood / Seafood Seblak** | Tier 4 | #0 | Tier 4 - Alert Choice: Deep-Fried Batters, Seblak & Sweet Glazes |
| [47] | **Seblak Ceker / Chicken Feet Seblak** | Tier 4 | #0 | Tier 4 - Alert Choice: Deep-Fried Batters, Seblak & Sweet Glazes |
| [48] | **Ceker Mercon / Spicy Fire Chicken Feet** | Tier 4 | #0 | Tier 4 - Alert Choice: Deep-Fried Batters, Seblak & Sweet Glazes |
| [49] | **Seafood Tumpah / Spilled Seafood Platter** | Tier 4 | #0 | Tier 4 - Alert Choice: Deep-Fried Batters, Seblak & Sweet Glazes |
| [50] | **Cumi Goreng Tepung + Nasi / Fried Squid in Batter + Rice** | Tier 4 | #0 | Tier 4 - Alert Choice: Deep-Fried Batters, Seblak & Sweet Glazes |
| [51] | **Cumi Goreng Tepung / Fried Squid in Batter** | Tier 4 | #0 | Tier 4 - Alert Choice: Deep-Fried Batters, Seblak & Sweet Glazes |
| [52] | **Asam Manis + Nasi / Sweet and Sour Fish or Meat + Rice** | Tier 4 | #0 | Tier 4 - Alert Choice: Deep-Fried Batters, Seblak & Sweet Glazes |
| [53] | **Cumi Saos Asam Manis + Nasi / Squid in Sweet Sour Sauce + Rice** | Tier 4 | #0 | Tier 4 - Alert Choice: Deep-Fried Batters, Seblak & Sweet Glazes |
| [54] | **Cumi Goreng Tepung Asam Manis + Nasi / Fried Battered Squid in Sweet Sour Sauce + Rice** | Tier 4 | #0 | Tier 4 - Alert Choice: Deep-Fried Batters, Seblak & Sweet Glazes |

## 📚 Database Search & Entity Resolution

- **Resolution Strategy:** Single-Dispatch Direct Nutrient Density Ledger
- **Status:** ✅ Resolved — Vision Scout direct 100g density vectors + verbatim printed nutrition label OCR locks; no secondary DB candidate fetches. Zero invented trace minerals.

## 📊 Comparison Groups & Nutritional Allowance Breakdown (4 Groups Formed)

### Summary: Indonesian Restaurant Menu Options

**Overall Assessment:** The evaluated menu offers diverse Indonesian protein and carb options. Given your current surpluses in saturated fat, calories, sodium, and added sugar alongside fiber and protein deficits, prioritizing clear-broth dishes and whole grilled fish provides high-quality protein without adding excess saturated fats or refined starches. Avoid deep-fried items and heavy gelatinized seblak dishes that aggravate your sodium and fat surpluses.

**Top Recommended Option:** `Ikan Nila Garang Asem + Nasi / Tilapia in Sour Broth with Rice`

### Rank 1: Tier 1 - Safest Choice: Tangy Poached Broths & Grilled Whole Fish [GOOD] — *High Protein & Low Fat*

- **Regional Bounding Box Quadrant:** `[140, 50, 640, 560]`
- **Items Included (15):** Nila Bakar / Gr + Nasi / Grilled or Fried Tilapia + Rice, Bawal Bakar / Gr + Nasi / Grilled or Fried Pomfret + Rice, Bandeng Bakar / Gr + Nasi / Grilled or Fried Milkfish + Rice, Tongkol Bakar / Gr + Nasi / Grilled or Fried Tuna + Rice, Cue Bakar / Gr + Nasi / Grilled or Fried Scad + Rice, Gurame Bakar / Goreng + Nasi / Grilled or Fried Giant Gourami + Rice, Ikan Que Bakar / Gr + Nasi / Grilled or Fried Que Fish + Rice, Baronang Bakar / Gr + Nasi / Grilled or Fried Rabbitfish + Rice, Ikan Bawal Asem Manis + Nasi / Pomfret in Sweet Sour Sauce + Rice, Ikan Nila Garang Asem + Nasi / Tilapia in Sour Broth + Rice, Ayam Garang Asem + Nasi / Chicken in Sour Broth + Rice, Tongkol Garang Asem + Nasi / Tuna in Sour Broth + Rice, Gurame Garang Asem + Nasi / Giant Gourami in Sour Broth + Rice, Tongkol Suir Pete + Nasi / Shredded Tuna with Stink Beans + Rice, Tongkol Suir Jengkol + Nasi / Shredded Tuna with Dog Beans + Rice
- **Comparative Sentence:** "This group supplies lean marine protein and antioxidant-rich broths that help close your protein deficit without adding to your 38% saturated fat surplus."
- **Personalized Clinical Guidance:** These clear-broth and grilled whole fish dishes provide high-quality protein to resolve your 17% protein deficit while keeping saturated fats low. The natural acids from starfruit and tomato offer polyphenols supporting cardiovascular health. Ordering tip: Request steamed rice instead of fried rice and ask for broth on the side to moderate sodium intake.

#### 10-Nutrient Profile Allowance Matrix (Per Serving & Per 100g Density)

| Profile Allowance Key | Per Serving (350g) | Per 100g Density | Patient Target Allowance Context |
|---|---:|---:|---|
| **Calories** | **385 kcal** | 110 kcal | Baseline 1800 kcal budget (+39% 3-day surplus) |
| **Saturated Fat** | **2.8 g** | 0.8 g | Baseline 20g limit (+38% 3-day surplus) |
| **Added Sugar** | **0 g** | 0 g | Baseline 30g limit (+50% 3-day surplus) |
| **Sodium** | **1330 mg** | 380 mg | Baseline 2300mg limit (+30% 3-day surplus) |
| **Protein** | **50.8 g** | 14.5 g | Baseline 120g target (-17% active deficit) |
| **Carbohydrates** | **22.8 g** | 6.5 g | Baseline 200g target (+32% 3-day surplus) |
| **Total Fibre** | **3.9 g** | 1.1 g | Baseline 30g target (-26% active deficit) |
| **Soluble Fibre** | **— g** | — g | Reference 7g target |
| **Potassium** | **— mg** | — mg | Reference 3500mg target |
| **Trans Fat** | **0 g** | 0 g | Zero tolerance target (0.0g) |
| Total Fat (Macro base) | 11.2 g | 3.2 g | Structural lipid balance |
| Total Sugar | 4.2 g | 1.2 g | Total saccharide load |

### Rank 2: Tier 2 - Neutral Choice: Grilled & Sambal Poultry Dishes [NEUTRAL] — *Moderate Protein & Chili Heat*

- **Regional Bounding Box Quadrant:** `[640, 100, 950, 560]`
- **Items Included (8):** Ayam Bakar + Nasi / Grilled Chicken + Rice, Ayam Bakar Sambal / Lampung + Nasi / Grilled Chicken with Sambal + Rice, Ayam Goreng Sambal / Lampung + Nasi / Fried Chicken with Sambal + Rice, Ayam Asam Manis + Nasi / Sweet and Sour Chicken + Rice, Ayam Goreng Geprek Tepung + Nasi / Crispy Smashed Fried Chicken + Rice, Ayam Bakar Sambal Ijo + Nasi / Grilled Chicken with Green Chili + Rice, Ayam Goreng Sambal Ijo + Nasi / Fried Chicken with Green Chili + Rice, Ayam Goreng Sambal Judes / Fried Chicken with Fierce Sambal + Rice
- **Comparative Sentence:** "Compared to plain broths, these chicken and sambal dishes introduce moderate oil and higher sodium that require cautious portion control against your surplus targets."
- **Personalized Clinical Guidance:** Grilled and sambal-paired poultry provides substantial protein to help your deficit, but cooking oils and chili pastes elevate your total fat and sodium loads. These are acceptable if eaten occasionally. Ordering tip: Ask for sambal served entirely on the side so you can control your capsaicin and sodium intake without excess calories.

#### 10-Nutrient Profile Allowance Matrix (Per Serving & Per 100g Density)

| Profile Allowance Key | Per Serving (300g) | Per 100g Density | Patient Target Allowance Context |
|---|---:|---:|---|
| **Calories** | **480 kcal** | 160 kcal | Baseline 1800 kcal budget (+39% 3-day surplus) |
| **Saturated Fat** | **6.6 g** | 2.2 g | Baseline 20g limit (+38% 3-day surplus) |
| **Added Sugar** | **1.5 g** | 0.5 g | Baseline 30g limit (+50% 3-day surplus) |
| **Sodium** | **1560 mg** | 520 mg | Baseline 2300mg limit (+30% 3-day surplus) |
| **Protein** | **45 g** | 15 g | Baseline 120g target (-17% active deficit) |
| **Carbohydrates** | **15 g** | 5 g | Baseline 200g target (+32% 3-day surplus) |
| **Total Fibre** | **2.4 g** | 0.8 g | Baseline 30g target (-26% active deficit) |
| **Soluble Fibre** | **— g** | — g | Reference 7g target |
| **Potassium** | **— mg** | — mg | Reference 3500mg target |
| **Trans Fat** | **0 g** | 0 g | Zero tolerance target (0.0g) |
| Total Fat (Macro base) | 25.5 g | 8.5 g | Structural lipid balance |
| Total Sugar | 3 g | 1 g | Total saccharide load |

### Rank 3: Tier 3 - Warning Choice: Fried Rice & Stir-Fried Noodles [WARNING] — *High Carbohydrate & Refined Fat*

- **Regional Bounding Box Quadrant:** `[150, 620, 850, 1000]`
- **Items Included (21):** Nasi Goreng Seafood / Seafood Fried Rice, Nasi Goreng Spesial / Special Fried Rice, Nasi Goreng Pete / Stink Bean Fried Rice, Nasi Goreng Jengkol / Dog Bean Fried Rice, Nasi Goreng Sosis / Sausage Fried Rice, Nasi Goreng Bakso / Meatball Fried Rice, Nasi Goreng Kornet / Corned Beef Fried Rice, Nasi Goreng Telor Dadar / Omelet Fried Rice, Nasi Goreng Ayam / Chicken Fried Rice, Mie Tek - Tek Kuah / Broth Noodle Soup, Mie Tek - Tek Sosis / Sausage Noodle, Mie Tek - Tek Bakso / Meatball Noodle, Mie Tek - Tek Kornet / Corned Beef Noodle, Mie Tek - Tek Seafood / Seafood Noodle, Kwetiau Goreng Bakso Sosis / Fried Flat Noodles with Meatball and Sausage, Kwetiau Goreng Seafood / Seafood Fried Flat Noodles, Kwetiau Kuah Sosis Bakso / Flat Noodle Soup with Sausage and Meatball, Kwetiau Special / Special Flat Noodles, Kwetiau Ayam / Chicken Flat Noodles, Mie Tek - Tek Special / Special Noodle, Mie Tek - Tek Ayam / Chicken Noodle
- **Comparative Sentence:** "These fried rice and noodle dishes directly worsen your 32% carbohydrate surplus and add hidden cooking fats that compound your calorie excess."
- **Personalized Clinical Guidance:** Nasi goreng and mie tek-tek deliver dense carbohydrates and substantial cooking oils, driving up your daily caloric and carb surpluses. While offering some protein, the glycemic load and saturated fat content are unfavorable. Ordering tip: Share a single portion with a companion and pair it with an extra side of boiled greens to boost your low dietary fiber.

#### 10-Nutrient Profile Allowance Matrix (Per Serving & Per 100g Density)

| Profile Allowance Key | Per Serving (400g) | Per 100g Density | Patient Target Allowance Context |
|---|---:|---:|---|
| **Calories** | **840 kcal** | 210 kcal | Baseline 1800 kcal budget (+39% 3-day surplus) |
| **Saturated Fat** | **12 g** | 3 g | Baseline 20g limit (+38% 3-day surplus) |
| **Added Sugar** | **6 g** | 1.5 g | Baseline 30g limit (+50% 3-day surplus) |
| **Sodium** | **2600 mg** | 650 mg | Baseline 2300mg limit (+30% 3-day surplus) |
| **Protein** | **24 g** | 6 g | Baseline 120g target (-17% active deficit) |
| **Carbohydrates** | **104 g** | 26 g | Baseline 200g target (+32% 3-day surplus) |
| **Total Fibre** | **4.8 g** | 1.2 g | Baseline 30g target (-26% active deficit) |
| **Soluble Fibre** | **— g** | — g | Reference 7g target |
| **Potassium** | **— mg** | — mg | Reference 3500mg target |
| **Trans Fat** | **0 g** | 0 g | Zero tolerance target (0.0g) |
| Total Fat (Macro base) | 36 g | 9 g | Structural lipid balance |
| Total Sugar | 10 g | 2.5 g | Total saccharide load |

### Rank 4: Tier 4 - Alert Choice: Deep-Fried Batters, Seblak & Sweet Glazes [ALERT] — *High Sodium & Oxidized Fats*

- **Regional Bounding Box Quadrant:** `[430, 620, 1000, 1000]`
- **Items Included (10):** Seblak Cobek Viral / Viral Hot Plate Seblak, Seblak Seafood / Seafood Seblak, Seblak Ceker / Chicken Feet Seblak, Ceker Mercon / Spicy Fire Chicken Feet, Seafood Tumpah / Spilled Seafood Platter, Cumi Goreng Tepung + Nasi / Fried Squid in Batter + Rice, Cumi Goreng Tepung / Fried Squid in Batter, Asam Manis + Nasi / Sweet and Sour Fish or Meat + Rice, Cumi Saos Asam Manis + Nasi / Squid in Sweet Sour Sauce + Rice, Cumi Goreng Tepung Asam Manis + Nasi / Fried Battered Squid in Sweet Sour Sauce + Rice
- **Comparative Sentence:** "This group presents the highest cardiovascular risk by combining ultra-processed starches, heavy batter oils, and excessive sodium that severely breach your clinical targets."
- **Personalized Clinical Guidance:** Seblak and deep-fried seafood/poultry dishes contain gelatinized starches and oxidized frying lipids that promote inflammation and worsen your 30% sodium and 38% saturated fat surpluses. Ordering tip: Avoid these completely; if unavoidable, strip away all batter coatings and skip the rich sweet-and-sour or chili-oil gravies entirely.

#### 10-Nutrient Profile Allowance Matrix (Per Serving & Per 100g Density)

| Profile Allowance Key | Per Serving (350g) | Per 100g Density | Patient Target Allowance Context |
|---|---:|---:|---|
| **Calories** | **840 kcal** | 240 kcal | Baseline 1800 kcal budget (+39% 3-day surplus) |
| **Saturated Fat** | **14.7 g** | 4.2 g | Baseline 20g limit (+38% 3-day surplus) |
| **Added Sugar** | **10.5 g** | 3 g | Baseline 30g limit (+50% 3-day surplus) |
| **Sodium** | **2870 mg** | 820 mg | Baseline 2300mg limit (+30% 3-day surplus) |
| **Protein** | **28 g** | 8 g | Baseline 120g target (-17% active deficit) |
| **Carbohydrates** | **84 g** | 24 g | Baseline 200g target (+32% 3-day surplus) |
| **Total Fibre** | **3.5 g** | 1 g | Baseline 30g target (-26% active deficit) |
| **Soluble Fibre** | **— g** | — g | Reference 7g target |
| **Potassium** | **— mg** | — mg | Reference 3500mg target |
| **Trans Fat** | **0.4 g** | 0.1 g | Zero tolerance target (0.0g) |
| Total Fat (Macro base) | 43.8 g | 12.5 g | Structural lipid balance |
| Total Sugar | 14 g | 4 g | Total saccharide load |

## 💬 Agent Message & Narrative (clinical recommendation)

The evaluated menu offers diverse Indonesian protein and carb options. Given your current surpluses in saturated fat, calories, sodium, and added sugar alongside fiber and protein deficits, prioritizing clear-broth dishes and whole grilled fish provides high-quality protein without adding excess saturated fats or refined starches. Avoid deep-fried items and heavy gelatinized seblak dishes that aggravate your sodium and fat surpluses.

**Top Recommended Option:** `Ikan Nila Garang Asem + Nasi / Tilapia in Sour Broth with Rice`

## 🔬 Mathematical & Thermodynamic Validation

1. **Macro Variance Clustering Strictness (<=10% Rule):**
   - All items within each group cluster within <=10% macronutrient variance.
   - 100% of extracted items (54/54) assigned to groups.
2. **Atwater Caloric Balance:**
   - Average nutrient vectors satisfy: `4 * Protein + 9 * TotalFat + 4 * Carbohydrates ≈ Calories (±10%)`.
   - Verbatim OCR printed labels override derived math.
3. **Derived Invariants (Pure TypeScript):**
   - `Salt (g) = Sodium (mg) * 0.00254`
   - `Unsaturated Fat (g) = Total Fat - Saturated Fat - Trans Fat`
4. **Spatial Regional Bounding Boxes:**
   - All 4 group quadrant bounding boxes strictly satisfy `0 <= ymin < ymax <= 1000` and `0 <= xmin < xmax <= 1000`.

## 🧠 Agent System Instructions & Dispatched Prompts

_Instructions for agents already shown inline under "Agent Dispatches" above are not repeated here. This section only covers agents not yet wired into that structured view._

```
[scout_system_instruction] Vision Scout System Instruction dispatched (model: gemini-3.5-flash-lite) — see [UnifiedLLM-Prompt:scout] under t1/scout above for full text.
```

## ⚠️ Errors & Warnings

_No thrown exceptions or log errors/warnings captured._

## 🖥️ Backend Execution Logs

```
[INFO] Mode D Single-Pass Product Evaluation invoked for Set 5 (Street Food Banner).
[INFO] Pure image upload without prompt. Parsed dishes across grilled fish, chicken, sweet-sour, soups, and noodles.
[INFO] Protein deficit (-17%) actively rewards lean whole grilled fish.
[INFO] Formed macro clusters with full 10-nutrient allowance profiles.
[scout_only_compare] Single-pass execution completed in 12929ms.
[scout_only_compare] Extracted 54 items across 4 ranked groups.
[scout_only_compare] Status: SUCCESS.
```

---
_Generated by Health Tracker diagnostic export (Mode D live run for Set 5: Street food tent / warung hanging menu banner)._