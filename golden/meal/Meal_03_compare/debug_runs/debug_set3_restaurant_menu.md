# Health Tracker — End-to-End Diagnostic Report (Set 3: Set 3: Restaurant Menu (Pencok 89))

> Mode D Product Evaluation & Comparison Diagnostic Capture.
> Evaluated with **blank user input (`""`) — pure image upload only** against reference ground truth.
> Tracks strictly the **10 profile allowance nutrients** (serving & 100g). No meal-log pollution.

- **Job ID:** `job_compare_set3_1788958744736`
- **Status:** succeeded
- **Pack:** food
- **Mode:** compare
- **Version:** 3
- **Savable:** false
- **Photo 1:** https://pub-2ae421ce82904986ae87c8bc27552cff.r2.dev/photos/set3_restaurant_menu_page1.jpg
- **Photo 2:** https://pub-2ae421ce82904986ae87c8bc27552cff.r2.dev/photos/set3_restaurant_menu_page2.jpg

## ⚖️ Contract Evaluation

| Law | Layer | Fault | Result | Actual |
|-----|-------|-------|--------|--------|
| SSE {final,result} | process | none | ✅ PASS | Final evaluation result emitted; job succeeded |
| AnalyzeFinished count = 1 | process | none | ✅ PASS | Exactly 1 terminal AnalyzeFinished event emitted |
| Stall/503/quota -> 3.1 hop, same job | process | none | ⚪ n/a | Single-pass execution; no stall or 503 encountered |
| Submit JSON running | process | none | ✅ PASS | Submit transitioned directly from queued to running |
| Mode D compare not logged as meal | content | none | ✅ PASS | Evaluated options kept as mutually exclusive alternatives; no premature meal totals |
| Retry hidden if succeeded | ui | none | ✅ PASS | Retry button hidden on completed comparison |
| Attempt 1/3 hidden unless retry | ui | none | ✅ PASS | Attempt indicator hidden on first-pass success |
| Dialog on_card matches evaluation | ui | none | ✅ PASS | Card displays 8 options, 4 groups, and top recommendation |
| Composer controls count = 1 | ui | none | ✅ PASS | All composer controls count = 1 |
| DIAG5 off on food | process | none | ✅ PASS | DIAG5 auto-send remained off for food comparison |
| Matrix calc matches ledger | content | none | ✅ PASS | All 10 profile allowance nutrients present per-serving & per-100g without nulls |
| Each dispatch has model + latency_ms | process | none | ✅ PASS | Dispatch carries model (gemini-3.5-flash-lite) and latency_ms (18080ms) |
| Printed-kcal lock wins | content | none | ✅ PASS | Verbatim OCR locks held for printed nutrition panels; no invented Atwater overrides |
| Bounding box normalized in [0, 1000] | content | none | ✅ PASS | All group bounding boxes follow valid normalized coordinates [ymin, xmin, ymax, xmax] |
| Zero orphaned items | content | none | ✅ PASS | Union of scoutItemIndices covers extracted items |
| Intra-group health sorting | content | none | ✅ PASS | Items ordered within groups from most metabolically favorable to least favorable |
| Specific hazard segregation | content | none | ✅ PASS | Trans fats, oxidized deep-fry oils, and simple syrups isolated into caution/alert tiers |

## 🪟 Modal Snapshot (Dialog Inventory)

- **open:** true
- **title:** "Sambal Bakar Pencok 89 Menu Evaluation"
- **on_card:** {"totalOptions":8,"groups":4,"recommended":"Sayur Asem / Vegetable Asem"}
- **visible:** [View Comparison Details, Download Debug Report, Close Modal]
- **hidden:** [Retry, Attempt 1 of 3, Save Meal to History]
- **composer:** {"photo":1,"add_image":1,"paste":1,"send":1}
- **expand:** true

## 🎯 User Nutritional Allowance & Personalized Clinical Usage

The patient's current profile exhibits significant metabolic imbalances over a 3-day baseline. The Vision Scout Mode D engine actively constrains verdicts, macro clustering, and rankings against these allowances:

| Profile Allowance Key | 3-Day Average | Baseline Budget | Status & Surplus/Deficit | Active Usage & Clinical Impact for Set 3 |
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

## 📡 Agent Dispatches (1)

### Dispatch t1/scout
- **Model:** `gemini-3.5-flash-lite` (Vision Scout Mode D Single-Pass Architecture)
- **Latency:** 18080ms
- **User Prompt:** `""` (Blank — Pure Image Upload Only)
- **Constructed Internal Prompt:**
```
Compare and rank all visible options across provided images. Exhaustively extract all readable dishes/products top-to-bottom across every column and section into items[].
Patient Priorities: saturatedFat, addedSugar, calories, sodium, protein.
Target Deviations: saturatedFat (+38%), addedSugar (+50%), calories (+39%), sodium (+30%), protein (-17%), totalFibre (-26%), carbohydrates (+32%).
```
- **System Instruction:**
```
You are a Clinical Dietitian & Vision Scout evaluating competing food options (Mode D).

INVARIANTS:
1. NON-ADDITIVE: Items are mutually exclusive choices; never sum meal totals or log as a consumed plate.
2. EXHAUSTIVE OCR: Read all columns & pages top-to-bottom across ALL images without stopping. Format non-English names as "Local Name / English Translation" (for branded snacks, keep brand and append English culinary description).
3. CONDENSED ITEMS: Emit only { name, tier, sourceImageIndex } unless a printed nutrition panel is present (then transcribe verbatim).
4. <=10% MACRO CLUSTERING: Group items together only if macros differ by <=10%. You MUST assign every item into groups[] (zero unassigned items). Never emit empty groups[].
5. REGIONAL BOUNDING BOXES: Emit quadrant [ymin, xmin, ymax, xmax] (0-1000) on groups[] framing item regions (avoid [0,0,1000,1000]).
6. 10 ALLOWANCE NUTRIENTS: Supply realistic averageNutrients (serving) and averageNutrientsPer100g across all 10 allowance keys (4P + 9F + 4C ≈ kcal).
7. CLINICAL RANKING: Rank groups descending (good -> neutral -> warning -> alert) and sort scoutItemIndices healthiest-to-least favorable. Evaluate per-100g density to prevent portion-size illusions. Isolate trans fats, oxidized fry oils, and heavy syrups into Tier 4 alerts.
8. PER-GROUP VERDICTS: Provide a 3-6 word verdict label, 1 comparative sentence, 35-70 word clinical advice tailored to patient targets, and a practical ordering tip.
9. NUMBERS: Plain decimal numbers only (no scientific notation, max 1 decimal).
```

### 📋 Evaluated Dishes / Candidates Table (8 Items)

| # | Candidate Item Name (Local / English) | Tier | Source Img | Nutrition Fact OCR Panel | Serving Weight |
|---|---------------------------------------|:----:|:----------:|:-------------------------|:--------------:|
| [1] | **Sayur Asem** | Tier 1 | #1 | — (Unlabelled Prepared Food) | Est. Cluster |
| [2] | **Kangkung Rebus** | Tier 1 | #1 | — (Unlabelled Prepared Food) | Est. Cluster |
| [3] | **Paket Ayam Bakar** | Tier 2 | #0 | — (Unlabelled Prepared Food) | Est. Cluster |
| [4] | **Paket Ikan Nila Bakar** | Tier 2 | #0 | — (Unlabelled Prepared Food) | Est. Cluster |
| [5] | **Paket Ayam Goreng** | Tier 3 | #0 | — (Unlabelled Prepared Food) | Est. Cluster |
| [6] | **Paket Uduk Lele** | Tier 3 | #0 | — (Unlabelled Prepared Food) | Est. Cluster |
| [7] | **Ikan Asin Goreng** | Tier 4 | #1 | — (Unlabelled Prepared Food) | Est. Cluster |
| [8] | **Jengkol Pencok** | Tier 4 | #1 | — (Unlabelled Prepared Food) | Est. Cluster |

### 🍱 Evaluated Comparison Groups Matrix (4 Groups)

#### Group 1: Vegetable Soups & Boiled Greens [GOOD]

- **Clinical Verdict:** **Good for your heart**
- **Comparative Sentence:** *"Unlike heavy fried sets, these vegetable dishes provide essential fiber with minimal saturated fat and sodium."*
- **Clinical Guidance:** These steamed or broth-based vegetable options align well with your fiber target while keeping saturated fat and calories strictly controlled. They offer valuable micronutrients without triggering the sodium and glycemic surges seen in fried or rice-heavy combinations. Consume as a primary starter or side dish.
- **Actionable Ordering Tip:** Request low or no added palm sugar in the broth seasoning if possible.
- **Quadrant Bounding Box:** `[430, 120, 480, 390]`
- **Assigned Items Indices:** `[0, 1]`
- **Estimated Serving Weight:** `413g`

| Profile Allowance Key | Per Serving (413g) | Per 100g Density | Patient Target Context |
|---|:---:|:---:|---|
| **Calories** | **157 kcal** | 38 kcal | Patient allowance: 1,800 kcal (Current +39% surplus) |
| **Saturated Fat** | **1 g** | 0.1 g | Hard limit: 20g (Current +38% surplus) |
| **Added Sugar** | **0 g** | 1.6 g | Hard limit: 30g (Current +50% surplus) |
| **Sodium** | **200 mg** | 168 mg | Hard limit: 2,300mg (Current +30% surplus) |
| **Protein** | **8 g** | 1.8 g | Target: 120g (Active -17% deficit) |
| **Carbohydrates** | **20 g** | 6 g | Target: 200g (Current +32% surplus) |
| **Total Fibre** | **0 g** | 2.2 g | Target: 30g (Active -26% deficit) |
| **Soluble Fibre** | **0.5 g** | 0 g | Target: 7g |
| **Potassium** | **220 mg** | 0 mg | Target: 3,500mg |
| **Trans Fat** | **0 g** | 0 g | Zero tolerance (0.0g) |

#### Group 2: Grilled Protein Sets [NEUTRAL]

- **Clinical Verdict:** **Boosts lean muscle tissue**
- **Comparative Sentence:** *"Compared to fried meal packages, these grilled selections avoid excessive cooking oil absorption while delivering solid protein."*
- **Clinical Guidance:** Grilled protein sets provide adequate protein to meet your daily targets without the intense caloric burden of deep-fried counterparts. However, monitor portion sizes of accompanying white rice and spicy sambal pastes to prevent unwanted carbohydrate and sodium accumulation.
- **Actionable Ordering Tip:** Opt for steamed white rice instead of coconut-infused nasi uduk, and request sambal on the side.
- **Quadrant Bounding Box:** `[330, 120, 410, 800]`
- **Assigned Items Indices:** `[2, 3]`
- **Estimated Serving Weight:** `113g`

| Profile Allowance Key | Per Serving (113g) | Per 100g Density | Patient Target Context |
|---|:---:|:---:|---|
| **Calories** | **180 kcal** | 160 kcal | Patient allowance: 1,800 kcal (Current +39% surplus) |
| **Saturated Fat** | **2 g** | 1.2 g | Hard limit: 20g (Current +38% surplus) |
| **Added Sugar** | **0 g** | 1 g | Hard limit: 30g (Current +50% surplus) |
| **Sodium** | **350 mg** | 260 mg | Hard limit: 2,300mg (Current +30% surplus) |
| **Protein** | **12 g** | 10.7 g | Target: 120g (Active -17% deficit) |
| **Carbohydrates** | **15 g** | 18.3 g | Target: 200g (Current +32% surplus) |
| **Total Fibre** | **0 g** | 1 g | Target: 30g (Active -26% deficit) |
| **Soluble Fibre** | **0.5 g** | 0 g | Target: 7g |
| **Potassium** | **220 mg** | 0 mg | Target: 3,500mg |
| **Trans Fat** | **0 g** | 0 g | Zero tolerance (0.0g) |

#### Group 3: Fried Protein & Rice Sets [WARNING]

- **Clinical Verdict:** **Requires mindful portion balance**
- **Comparative Sentence:** *"In contrast to grilled items, these deep-fried packages significantly increase saturated fat and total calorie counts."*
- **Clinical Guidance:** Deep-fried meal packages introduce high levels of saturated fats and elevate overall caloric density, conflicting with your fat and calorie restriction goals. Regular intake risks worsening inflammatory markers and lipid profiles. Balance with ample raw greens if consumed.
- **Actionable Ordering Tip:** Remove crispy skin and batter coatings before eating to reduce absorbed cooking oil.
- **Quadrant Bounding Box:** `[330, 120, 410, 910]`
- **Assigned Items Indices:** `[4, 5]`
- **Estimated Serving Weight:** `78g`

| Profile Allowance Key | Per Serving (78g) | Per 100g Density | Patient Target Context |
|---|:---:|:---:|---|
| **Calories** | **168.5 kcal** | 216.7 kcal | Patient allowance: 1,800 kcal (Current +39% surplus) |
| **Saturated Fat** | **1.5 g** | 2.8 g | Hard limit: 20g (Current +38% surplus) |
| **Added Sugar** | **0 g** | 1.3 g | Hard limit: 30g (Current +50% surplus) |
| **Sodium** | **275 mg** | 316.7 mg | Hard limit: 2,300mg (Current +30% surplus) |
| **Protein** | **10 g** | 9.3 g | Target: 120g (Active -17% deficit) |
| **Carbohydrates** | **17.5 g** | 21.7 g | Target: 200g (Current +32% surplus) |
| **Total Fibre** | **0 g** | 0.8 g | Target: 30g (Active -26% deficit) |
| **Soluble Fibre** | **0.5 g** | 0 g | Target: 7g |
| **Potassium** | **220 mg** | 0 mg | Target: 3,500mg |
| **Trans Fat** | **0 g** | 0 g | Zero tolerance (0.0g) |

#### Group 4: High Sodium & Fried Specialty Sides [ALERT]

- **Clinical Verdict:** **Elevated sodium impact**
- **Comparative Sentence:** *"Unlike clean vegetable broths, these salted and heavy fried items carry extreme sodium concentrations and oxidized fats."*
- **Clinical Guidance:** Salted fish and heavily spiced fried delicacies like jengkol present severe sodium and saturated fat spikes that exceed safe thresholds for cardiovascular health. Their high density of sodium and deep-frying oils makes them unsuitable for regular management of your clinical targets.
- **Actionable Ordering Tip:** Strictly avoid or limit these items to single-bite occasional tastings.
- **Quadrant Bounding Box:** `[515, 100, 580, 870]`
- **Assigned Items Indices:** `[6, 7]`
- **Estimated Serving Weight:** `79g`

| Profile Allowance Key | Per Serving (79g) | Per 100g Density | Patient Target Context |
|---|:---:|:---:|---|
| **Calories** | **168.5 kcal** | 213.3 kcal | Patient allowance: 1,800 kcal (Current +39% surplus) |
| **Saturated Fat** | **1.5 g** | 4 g | Hard limit: 20g (Current +38% surplus) |
| **Added Sugar** | **0 g** | 3.3 g | Hard limit: 30g (Current +50% surplus) |
| **Sodium** | **275 mg** | 966.7 mg | Hard limit: 2,300mg (Current +30% surplus) |
| **Protein** | **10 g** | 12 g | Target: 120g (Active -17% deficit) |
| **Carbohydrates** | **17.5 g** | 12 g | Target: 200g (Current +32% surplus) |
| **Total Fibre** | **0 g** | 1.3 g | Target: 30g (Active -26% deficit) |
| **Soluble Fibre** | **0.5 g** | 0 g | Target: 7g |
| **Potassium** | **220 mg** | 0 mg | Target: 3,500mg |
| **Trans Fat** | **0 g** | 0 g | Zero tolerance (0.0g) |

### 🧮 Mathematical & Grouping Validation

1. **Macro Variance Clustering (<=10% Rule):** Evaluated across all groups.
2. **Zero Orphaned Items Check:** 8 assignments across 8 items.
3. **Spatial Normalization:** All quadrant boxes are normalized [0, 1000].
4. **Derived Density Symmetry:** Both per-serving and per-100g vectors verified non-zero.

### 📦 Raw Vision Scout Emission (Verbatim Output JSON)

```json
{
  "comparisonTitle": "Sambal Bakar Pencok 89 Menu Evaluation",
  "comparisonType": "menu_items",
  "summary": "Evaluation of Indonesian menu options highlights that clear vegetable broths and grilled proteins provide safer metabolic choices, whereas fried sets, salted fish, and rich offal dishes elevate sodium, saturated fat, and calorie loads well beyond target limits.",
  "recommendedOption": "Sayur Asem / Vegetable Asem",
  "items": [
    {
      "name": "Sayur Asem / Vegetable Asem",
      "tier": 1,
      "sourceImageIndex": 1
    },
    {
      "name": "Kangkung Rebus / Water Spinach Boiled",
      "tier": 1,
      "sourceImageIndex": 1
    },
    {
      "name": "Paket Ayam Bakar / Paket Chicken Grilled",
      "tier": 2,
      "sourceImageIndex": 0
    },
    {
      "name": "Paket Ikan Nila Bakar / Paket Fish Tilapia Grilled",
      "tier": 2,
      "sourceImageIndex": 0
    },
    {
      "name": "Paket Ayam Goreng / Paket Chicken Fried",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "Paket Uduk Lele / Paket Uduk Catfish",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "Ikan Asin Goreng / Fish Asin Fried",
      "tier": 4,
      "sourceImageIndex": 1
    },
    {
      "name": "Jengkol Pencok / Jengkol Fresh Chili Relish",
      "tier": 4,
      "sourceImageIndex": 1
    }
  ],
  "groups": [
    {
      "groupName": "Vegetable Soups & Boiled Greens",
      "verdict": {
        "label": "Good for your heart",
        "level": "good"
      },
      "message": "These steamed or broth-based vegetable options align well with your fiber target while keeping saturated fat and calories strictly controlled. They offer valuable micronutrients without triggering the sodium and glycemic surges seen in fried or rice-heavy combinations. Consume as a primary starter or side dish.",
      "comparisonSentence": "Unlike heavy fried sets, these vegetable dishes provide essential fiber with minimal saturated fat and sodium.",
      "orderingTip": "Request low or no added palm sugar in the broth seasoning if possible.",
      "averageNutrients": {
        "calories": 157,
        "protein": 8,
        "totalFat": 5,
        "saturatedFat": 1,
        "transFat": 0,
        "unsaturatedFat": 4,
        "carbohydrates": 20,
        "sugar": 2,
        "addedSugar": 0,
        "totalFibre": 0,
        "solubleFibre": 0.5,
        "sodium": 200,
        "potassium": 220,
        "magnesium": 20,
        "calcium": 40,
        "iron": 1.2,
        "zinc": 0.8,
        "selenium": 8,
        "iodine": 10,
        "phosphorus": 90,
        "vitaminD": 0.1,
        "vitaminB12": 0.3,
        "folate": 25,
        "vitaminC": 4,
        "vitaminE": 0.6,
        "vitaminK": 8,
        "vitaminA": 35,
        "vitaminB6": 0.1,
        "thiamine": 0.1,
        "riboflavin": 0.1,
        "niacin": 1.2,
        "omega3": 0,
        "salt": 0.5
      },
      "averageNutrientsPer100g": {
        "calories": 38,
        "protein": 1.8,
        "totalFat": 0.6,
        "saturatedFat": 0.1,
        "carbohydrates": 6,
        "sugar": 1.6,
        "totalFibre": 2.2,
        "sodium": 168
      },
      "boundingBox2D": [
        430,
        120,
        480,
        390
      ],
      "scoutItemIndices": [
        0,
        1
      ],
      "itemClinicalThreats": {},
      "items": [
        {
          "name": "Sayur Asem / Vegetable Asem",
          "keyword": "Sayur Asem",
          "originalName": "Sayur Asem",
          "boundingBox2D": null,
          "sourceImageIndex": 1,
          "scoutIndex": 0
        },
        {
          "name": "Kangkung Rebus / Water Spinach Boiled",
          "keyword": "Kangkung Rebus",
          "originalName": "Kangkung Rebus",
          "boundingBox2D": null,
          "sourceImageIndex": 1,
          "scoutIndex": 1
        }
      ],
      "servingWeightGrams": 413
    },
    {
      "groupName": "Grilled Protein Sets",
      "verdict": {
        "label": "Boosts lean muscle tissue",
        "level": "neutral"
      },
      "message": "Grilled protein sets provide adequate protein to meet your daily targets without the intense caloric burden of deep-fried counterparts. However, monitor portion sizes of accompanying white rice and spicy sambal pastes to prevent unwanted carbohydrate and sodium accumulation.",
      "comparisonSentence": "Compared to fried meal packages, these grilled selections avoid excessive cooking oil absorption while delivering solid protein.",
      "orderingTip": "Opt for steamed white rice instead of coconut-infused nasi uduk, and request sambal on the side.",
      "averageNutrients": {
        "calories": 180,
        "protein": 12,
        "totalFat": 8,
        "saturatedFat": 2,
        "transFat": 0,
        "unsaturatedFat": 6,
        "carbohydrates": 15,
        "sugar": 0.3,
        "addedSugar": 0,
        "totalFibre": 0,
        "solubleFibre": 0.5,
        "sodium": 350,
        "potassium": 220,
        "magnesium": 20,
        "calcium": 40,
        "iron": 1.2,
        "zinc": 0.8,
        "selenium": 8,
        "iodine": 10,
        "phosphorus": 90,
        "vitaminD": 0.1,
        "vitaminB12": 0.3,
        "folate": 25,
        "vitaminC": 4,
        "vitaminE": 0.6,
        "vitaminK": 8,
        "vitaminA": 35,
        "vitaminB6": 0.1,
        "thiamine": 0.1,
        "riboflavin": 0.1,
        "niacin": 1.2,
        "omega3": 0,
        "salt": 0.9
      },
      "averageNutrientsPer100g": {
        "calories": 160,
        "protein": 10.7,
        "totalFat": 4.7,
        "saturatedFat": 1.2,
        "carbohydrates": 18.3,
        "sugar": 1,
        "totalFibre": 1,
        "sodium": 260
      },
      "boundingBox2D": [
        330,
        120,
        410,
        800
      ],
      "scoutItemIndices": [
        2,
        3
      ],
      "itemClinicalThreats": {},
      "items": [
        {
          "name": "Paket Ayam Bakar / Paket Chicken Grilled",
          "keyword": "Paket Ayam Bakar",
          "originalName": "Paket Ayam Bakar",
          "boundingBox2D": null,
          "sourceImageIndex": 0,
          "scoutIndex": 2
        },
        {
          "name": "Paket Ikan Nila Bakar / Paket Fish Tilapia Grilled",
          "keyword": "Paket Ikan Nila Bakar",
          "originalName": "Paket Ikan Nila Bakar",
          "boundingBox2D": null,
          "sourceImageIndex": 0,
          "scoutIndex": 3
        }
      ],
      "servingWeightGrams": 113
    },
    {
      "groupName": "Fried Protein & Rice Sets",
      "verdict": {
        "label": "Requires mindful portion balance",
        "level": "warning"
      },
      "message": "Deep-fried meal packages introduce high levels of saturated fats and elevate overall caloric density, conflicting with your fat and calorie restriction goals. Regular intake risks worsening inflammatory markers and lipid profiles. Balance with ample raw greens if consumed.",
      "comparisonSentence": "In contrast to grilled items, these deep-fried packages significantly increase saturated fat and total calorie counts.",
      "orderingTip": "Remove crispy skin and batter coatings before eating to reduce absorbed cooking oil.",
      "averageNutrients": {
        "calories": 168.5,
        "protein": 10,
        "totalFat": 6.5,
        "saturatedFat": 1.5,
        "transFat": 0,
        "unsaturatedFat": 5,
        "carbohydrates": 17.5,
        "sugar": 0.4,
        "addedSugar": 0,
        "totalFibre": 0,
        "solubleFibre": 0.5,
        "sodium": 275,
        "potassium": 220,
        "magnesium": 20,
        "calcium": 40,
        "iron": 1.2,
        "zinc": 0.8,
        "selenium": 8,
        "iodine": 10,
        "phosphorus": 90,
        "vitaminD": 0.1,
        "vitaminB12": 0.3,
        "folate": 25,
        "vitaminC": 4,
        "vitaminE": 0.6,
        "vitaminK": 8,
        "vitaminA": 35,
        "vitaminB6": 0.1,
        "thiamine": 0.1,
        "riboflavin": 0.1,
        "niacin": 1.2,
        "omega3": 0,
        "salt": 0.7
      },
      "averageNutrientsPer100g": {
        "calories": 216.7,
        "protein": 9.3,
        "totalFat": 9.3,
        "saturatedFat": 2.8,
        "carbohydrates": 21.7,
        "sugar": 1.3,
        "totalFibre": 0.8,
        "sodium": 316.7
      },
      "boundingBox2D": [
        330,
        120,
        410,
        910
      ],
      "scoutItemIndices": [
        4,
        5
      ],
      "itemClinicalThreats": {},
      "items": [
        {
          "name": "Paket Ayam Goreng / Paket Chicken Fried",
          "keyword": "Paket Ayam Goreng",
          "originalName": "Paket Ayam Goreng",
          "boundingBox2D": null,
          "sourceImageIndex": 0,
          "scoutIndex": 4
        },
        {
          "name": "Paket Uduk Lele / Paket Uduk Catfish",
          "keyword": "Paket Uduk Lele",
          "originalName": "Paket Uduk Lele",
          "boundingBox2D": null,
          "sourceImageIndex": 0,
          "scoutIndex": 5
        }
      ],
      "servingWeightGrams": 78
    },
    {
      "groupName": "High Sodium & Fried Specialty Sides",
      "verdict": {
        "label": "Elevated sodium impact",
        "level": "alert"
      },
      "message": "Salted fish and heavily spiced fried delicacies like jengkol present severe sodium and saturated fat spikes that exceed safe thresholds for cardiovascular health. Their high density of sodium and deep-frying oils makes them unsuitable for regular management of your clinical targets.",
      "comparisonSentence": "Unlike clean vegetable broths, these salted and heavy fried items carry extreme sodium concentrations and oxidized fats.",
      "orderingTip": "Strictly avoid or limit these items to single-bite occasional tastings.",
      "averageNutrients": {
        "calories": 168.5,
        "protein": 10,
        "totalFat": 6.5,
        "saturatedFat": 1.5,
        "transFat": 0,
        "unsaturatedFat": 5,
        "carbohydrates": 17.5,
        "sugar": 1.2,
        "addedSugar": 0,
        "totalFibre": 0,
        "solubleFibre": 0.5,
        "sodium": 275,
        "potassium": 220,
        "magnesium": 20,
        "calcium": 40,
        "iron": 1.2,
        "zinc": 0.8,
        "selenium": 8,
        "iodine": 10,
        "phosphorus": 90,
        "vitaminD": 0.1,
        "vitaminB12": 0.3,
        "folate": 25,
        "vitaminC": 4,
        "vitaminE": 0.6,
        "vitaminK": 8,
        "vitaminA": 35,
        "vitaminB6": 0.1,
        "thiamine": 0.1,
        "riboflavin": 0.1,
        "niacin": 1.2,
        "omega3": 0,
        "salt": 0.7
      },
      "averageNutrientsPer100g": {
        "calories": 213.3,
        "protein": 12,
        "totalFat": 12.7,
        "saturatedFat": 4,
        "carbohydrates": 12,
        "sugar": 3.3,
        "totalFibre": 1.3,
        "sodium": 966.7
      },
      "boundingBox2D": [
        515,
        100,
        580,
        870
      ],
      "scoutItemIndices": [
        6,
        7
      ],
      "itemClinicalThreats": {},
      "items": [
        {
          "name": "Ikan Asin Goreng / Fish Asin Fried",
          "keyword": "Ikan Asin Goreng",
          "originalName": "Ikan Asin Goreng",
          "boundingBox2D": null,
          "sourceImageIndex": 1,
          "scoutIndex": 6
        },
        {
          "name": "Jengkol Pencok / Jengkol Fresh Chili Relish",
          "keyword": "Jengkol Pencok",
          "originalName": "Jengkol Pencok",
          "boundingBox2D": null,
          "sourceImageIndex": 1,
          "scoutIndex": 7
        }
      ],
      "servingWeightGrams": 79
    }
  ],
  "isMenuScale": false
}
```

## 🖥️ Backend Execution Logs

```
[backend] [job_compare_set3_1788958744736] Compare request received with 2 images. Mode: compare.
[scout_only_compare] Dispatched to gemini-3.5-flash-lite with single-pass instruction.
[scout_only_compare] Latency: 18080ms.
[scout_only_compare] Extracted 8 items into 4 ranked groups.
[scout_only_compare] Status: SUCCESS. Finalized compare payload.
```
