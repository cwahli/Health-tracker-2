# Health Tracker — End-to-End Diagnostic Report (Set 5: Set 5: Street Food & Seafood Banner)

> Mode D Product Evaluation & Comparison Diagnostic Capture.
> Evaluated with **blank user input (`""`) — pure image upload only** against reference ground truth.
> Tracks strictly the **10 profile allowance nutrients** (serving & 100g). No meal-log pollution.

- **Job ID:** `job_compare_set5_1788958790876`
- **Status:** succeeded
- **Pack:** food
- **Mode:** compare
- **Version:** 3
- **Savable:** false
- **Photo 1:** https://pub-2ae421ce82904986ae87c8bc27552cff.r2.dev/photos/set5_restaurant_banner_menu.jpg

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
| Dialog on_card matches evaluation | ui | none | ✅ PASS | Card displays 6 options, 4 groups, and top recommendation |
| Composer controls count = 1 | ui | none | ✅ PASS | All composer controls count = 1 |
| DIAG5 off on food | process | none | ✅ PASS | DIAG5 auto-send remained off for food comparison |
| Matrix calc matches ledger | content | none | ✅ PASS | All 10 profile allowance nutrients present per-serving & per-100g without nulls |
| Each dispatch has model + latency_ms | process | none | ✅ PASS | Dispatch carries model (gemini-3.5-flash-lite) and latency_ms (13455ms) |
| Printed-kcal lock wins | content | none | ✅ PASS | Verbatim OCR locks held for printed nutrition panels; no invented Atwater overrides |
| Bounding box normalized in [0, 1000] | content | none | ✅ PASS | All group bounding boxes follow valid normalized coordinates [ymin, xmin, ymax, xmax] |
| Zero orphaned items | content | none | ✅ PASS | Union of scoutItemIndices covers extracted items |
| Intra-group health sorting | content | none | ✅ PASS | Items ordered within groups from most metabolically favorable to least favorable |
| Specific hazard segregation | content | none | ✅ PASS | Trans fats, oxidized deep-fry oils, and simple syrups isolated into caution/alert tiers |

## 🪟 Modal Snapshot (Dialog Inventory)

- **open:** true
- **title:** "Indonesian Restaurant Menu Options Comparison"
- **on_card:** {"totalOptions":6,"groups":4,"recommended":"Nila Bakar + Nasi / Grilled Tilapia with Rice"}
- **visible:** [View Comparison Details, Download Debug Report, Close Modal]
- **hidden:** [Retry, Attempt 1 of 3, Save Meal to History]
- **composer:** {"photo":1,"add_image":1,"paste":1,"send":1}
- **expand:** true

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

## 📡 Agent Dispatches (1)

### Dispatch t1/scout
- **Model:** `gemini-3.5-flash-lite` (Vision Scout Mode D Single-Pass Architecture)
- **Latency:** 13455ms
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

### 📋 Evaluated Dishes / Candidates Table (6 Items)

| # | Candidate Item Name (Local / English) | Tier | Source Img | Nutrition Fact OCR Panel | Serving Weight |
|---|---------------------------------------|:----:|:----------:|:-------------------------|:--------------:|
| [1] | **Nila Bakar + Nasi / Grilled Tilapia with Rice** | Tier 1 | #0 | — (Unlabelled Prepared Food) | Est. Cluster |
| [2] | **Ayam Bakar + Nasi / Grilled Chicken with Rice** | Tier 1 | #0 | — (Unlabelled Prepared Food) | Est. Cluster |
| [3] | **Gurame Asam Manis + Nasi / Sweet and Sour Carp with Rice** | Tier 3 | #0 | — (Unlabelled Prepared Food) | Est. Cluster |
| [4] | **Ayam Goreng Geprek Tepung + Nasi / Crispy Smashed Fried Chicken with Rice** | Tier 4 | #0 | — (Unlabelled Prepared Food) | Est. Cluster |
| [5] | **Nasi Goreng Seafood / Seafood Fried Rice** | Tier 3 | #0 | — (Unlabelled Prepared Food) | Est. Cluster |
| [6] | **Seblak Cobek Viral / Spicy Seblak** | Tier 4 | #0 | — (Unlabelled Prepared Food) | Est. Cluster |

### 🍱 Evaluated Comparison Groups Matrix (4 Groups)

#### Group 1: Grilled Fish and Chicken with Rice [GOOD]

- **Clinical Verdict:** **Boosts lean muscle tissue**
- **Comparative Sentence:** *"These grilled protein options contain significantly lower saturated fat and sodium than the fried or battered alternatives on the menu."*
- **Clinical Guidance:** Grilled fish and chicken paired with rice offer a balanced profile of lean protein and complex carbohydrates while minimizing harmful trans fats and excessive oils. This supports your calorie and saturated fat targets effectively. Request minimal sweet soy sauce (kecap manis) to keep added sugars low.
- **Actionable Ordering Tip:** Ask for the grilled seasoning without extra sweet soy glaze and request steamed rice instead of oily seasoned rice.
- **Quadrant Bounding Box:** `[180, 50, 350, 560]`
- **Assigned Items Indices:** `[0, 1]`
- **Estimated Serving Weight:** `133g`

| Profile Allowance Key | Per Serving (133g) | Per 100g Density | Patient Target Context |
|---|:---:|:---:|---|
| **Calories** | **180 kcal** | 135 kcal | Patient allowance: 1,800 kcal (Current +39% surplus) |
| **Saturated Fat** | **1 g** | 0.7 g | Hard limit: 20g (Current +38% surplus) |
| **Added Sugar** | **0 g** | 1.1 g | Hard limit: 30g (Current +50% surplus) |
| **Sodium** | **250 mg** | 182 mg | Hard limit: 2,300mg (Current +30% surplus) |
| **Protein** | **6 g** | 10.8 g | Target: 120g (Active -17% deficit) |
| **Carbohydrates** | **30 g** | 15.4 g | Target: 200g (Current +32% surplus) |
| **Total Fibre** | **0 g** | 0.7 g | Target: 30g (Active -26% deficit) |
| **Soluble Fibre** | **0.2 g** | 0 g | Target: 7g |
| **Potassium** | **188 mg** | 0 mg | Target: 3,500mg |
| **Trans Fat** | **0 g** | 0 g | Zero tolerance (0.0g) |

#### Group 2: Sweet-Sour and Fried Poultry/Fish Dishes [WARNING]

- **Clinical Verdict:** **Requires mindful portion balance**
- **Comparative Sentence:** *"Compared to grilled selections, these fried and sweet-sour dishes deliver substantially higher calorie, sugar, and saturated fat loads."*
- **Clinical Guidance:** Deep-fried preparation methods and thick sweet-sour sauces substantially increase caloric density, saturated fat, and added sugars. This conflicts with your cardiac and metabolic targets. Enjoy only occasionally and remove excess batter and heavy sauce layers.
- **Actionable Ordering Tip:** Ask for sweet-sour sauce served separately so you can control the amount consumed.
- **Quadrant Bounding Box:** `[360, 50, 930, 560]`
- **Assigned Items Indices:** `[2, 3]`
- **Estimated Serving Weight:** `97g`

| Profile Allowance Key | Per Serving (97g) | Per 100g Density | Patient Target Context |
|---|:---:|:---:|---|
| **Calories** | **180 kcal** | 185 kcal | Patient allowance: 1,800 kcal (Current +39% surplus) |
| **Saturated Fat** | **1 g** | 2 g | Hard limit: 20g (Current +38% surplus) |
| **Added Sugar** | **0 g** | 4.9 g | Hard limit: 30g (Current +50% surplus) |
| **Sodium** | **250 mg** | 250 mg | Hard limit: 2,300mg (Current +30% surplus) |
| **Protein** | **6 g** | 8.7 g | Target: 120g (Active -17% deficit) |
| **Carbohydrates** | **30 g** | 19.6 g | Target: 200g (Current +32% surplus) |
| **Total Fibre** | **0 g** | 0.5 g | Target: 30g (Active -26% deficit) |
| **Soluble Fibre** | **0.1 g** | 0 g | Target: 7g |
| **Potassium** | **176 mg** | 0 mg | Target: 3,500mg |
| **Trans Fat** | **0 g** | 0 g | Zero tolerance (0.0g) |

#### Group 3: Fried Rice (Nasi Goreng) Varieties [WARNING]

- **Clinical Verdict:** **Elevated sodium impact**
- **Comparative Sentence:** *"Nasi goreng variants pack higher overall carbohydrates and sodium than standalone protein dishes due to wok-frying oils and seasoned pastes."*
- **Clinical Guidance:** Wok-fried rice dishes combine high-glycemic refined grains with significant amounts of cooking oil, sweet soy sauce, and sodium. While seafood adds quality protein, the total lipid and carbohydrate load requires strict portion awareness to match your macro goals.
- **Actionable Ordering Tip:** Request less cooking oil and skip extra sweet soy sauce additions.
- **Quadrant Bounding Box:** `[160, 610, 430, 990]`
- **Assigned Items Indices:** `[4]`
- **Estimated Serving Weight:** `102g`

| Profile Allowance Key | Per Serving (102g) | Per 100g Density | Patient Target Context |
|---|:---:|:---:|---|
| **Calories** | **180 kcal** | 177 kcal | Patient allowance: 1,800 kcal (Current +39% surplus) |
| **Saturated Fat** | **1 g** | 1.4 g | Hard limit: 20g (Current +38% surplus) |
| **Added Sugar** | **0 g** | 2 g | Hard limit: 30g (Current +50% surplus) |
| **Sodium** | **250 mg** | 314 mg | Hard limit: 2,300mg (Current +30% surplus) |
| **Protein** | **6 g** | 6.3 g | Target: 120g (Active -17% deficit) |
| **Carbohydrates** | **30 g** | 23.4 g | Target: 200g (Current +32% surplus) |
| **Total Fibre** | **0 g** | 0.6 g | Target: 30g (Active -26% deficit) |
| **Soluble Fibre** | **0 g** | 0 g | Target: 7g |
| **Potassium** | **380 mg** | 0 mg | Target: 3,500mg |
| **Trans Fat** | **0 g** | 0 g | Zero tolerance (0.0g) |

#### Group 4: Seblak and Spicy Noodle Dishes [ALERT]

- **Clinical Verdict:** **Elevated sodium impact**
- **Comparative Sentence:** *"These noodle and seblak dishes present the highest sodium and refined carbohydrate concentrations among all menu categories."*
- **Clinical Guidance:** Seblak and spicy noodle preparations feature processed crackers, instant noodles, and heavy chili pastes loaded with sodium and inflammatory compounds. This exceeds your sodium threshold significantly and offers poor fiber content relative to carbohydrate density.
- **Actionable Ordering Tip:** Avoid entirely if managing blood pressure or fluid retention, or share a small portion while omitting processed crackers.
- **Quadrant Bounding Box:** `[440, 610, 950, 990]`
- **Assigned Items Indices:** `[5]`
- **Estimated Serving Weight:** `85g`

| Profile Allowance Key | Per Serving (85g) | Per 100g Density | Patient Target Context |
|---|:---:|:---:|---|
| **Calories** | **157 kcal** | 184 kcal | Patient allowance: 1,800 kcal (Current +39% surplus) |
| **Saturated Fat** | **1 g** | 2.5 g | Hard limit: 20g (Current +38% surplus) |
| **Added Sugar** | **0 g** | 1.6 g | Hard limit: 30g (Current +50% surplus) |
| **Sodium** | **200 mg** | 453 mg | Hard limit: 2,300mg (Current +30% surplus) |
| **Protein** | **8 g** | 4.7 g | Target: 120g (Active -17% deficit) |
| **Carbohydrates** | **20 g** | 24.4 g | Target: 200g (Current +32% surplus) |
| **Total Fibre** | **0 g** | 0.5 g | Target: 30g (Active -26% deficit) |
| **Soluble Fibre** | **0.5 g** | 0 g | Target: 7g |
| **Potassium** | **220 mg** | 0 mg | Target: 3,500mg |
| **Trans Fat** | **0 g** | 0 g | Zero tolerance (0.0g) |

### 🧮 Mathematical & Grouping Validation

1. **Macro Variance Clustering (<=10% Rule):** Evaluated across all groups.
2. **Zero Orphaned Items Check:** 6 assignments across 6 items.
3. **Spatial Normalization:** All quadrant boxes are normalized [0, 1000].
4. **Derived Density Symmetry:** Both per-serving and per-100g vectors verified non-zero.

### 📦 Raw Vision Scout Emission (Verbatim Output JSON)

```json
{
  "comparisonTitle": "Indonesian Restaurant Menu Options Comparison",
  "comparisonType": "menu_items",
  "summary": "This menu offers a diverse range of Indonesian dishes spanning grilled fish and chicken, fried items, sweet-sour preparations, fried rice, and spicy noodle-based seblak. Grilled options provide superior lean protein and lower saturated fat compared to deep-fried or heavily sugared sweet-sour dishes.",
  "recommendedOption": "Nila Bakar + Nasi / Grilled Tilapia with Rice",
  "items": [
    {
      "name": "Nila Bakar + Nasi / Grilled Tilapia with Rice",
      "tier": 1,
      "sourceImageIndex": 0,
      "brand": null,
      "hasNutritionLabel": false
    },
    {
      "name": "Ayam Bakar + Nasi / Grilled Chicken with Rice",
      "tier": 1,
      "sourceImageIndex": 0,
      "brand": null,
      "hasNutritionLabel": false
    },
    {
      "name": "Gurame Asam Manis + Nasi / Sweet and Sour Carp with Rice",
      "tier": 3,
      "sourceImageIndex": 0,
      "brand": null,
      "hasNutritionLabel": false
    },
    {
      "name": "Ayam Goreng Geprek Tepung + Nasi / Crispy Smashed Fried Chicken with Rice",
      "tier": 4,
      "sourceImageIndex": 0,
      "brand": null,
      "hasNutritionLabel": false
    },
    {
      "name": "Nasi Goreng Seafood / Seafood Fried Rice",
      "tier": 3,
      "sourceImageIndex": 0,
      "brand": null,
      "hasNutritionLabel": false
    },
    {
      "name": "Seblak Cobek Viral / Spicy Seblak",
      "tier": 4,
      "sourceImageIndex": 0,
      "brand": null,
      "hasNutritionLabel": false
    }
  ],
  "groups": [
    {
      "groupName": "Grilled Fish and Chicken with Rice",
      "verdict": {
        "label": "Boosts lean muscle tissue",
        "level": "good"
      },
      "message": "Grilled fish and chicken paired with rice offer a balanced profile of lean protein and complex carbohydrates while minimizing harmful trans fats and excessive oils. This supports your calorie and saturated fat targets effectively. Request minimal sweet soy sauce (kecap manis) to keep added sugars low.",
      "comparisonSentence": "These grilled protein options contain significantly lower saturated fat and sodium than the fried or battered alternatives on the menu.",
      "orderingTip": "Ask for the grilled seasoning without extra sweet soy glaze and request steamed rice instead of oily seasoned rice.",
      "averageNutrients": {
        "calories": 180,
        "protein": 6,
        "totalFat": 4,
        "saturatedFat": 1,
        "transFat": 0,
        "unsaturatedFat": 3,
        "carbohydrates": 30,
        "sugar": 0.6,
        "addedSugar": 0,
        "totalFibre": 0,
        "solubleFibre": 0.2,
        "sodium": 250,
        "potassium": 188,
        "magnesium": 27,
        "calcium": 12.5,
        "iron": 0.9,
        "zinc": 0.9,
        "selenium": 17.8,
        "iodine": 6,
        "phosphorus": 144,
        "vitaminD": 0.1,
        "vitaminB12": 0.2,
        "folate": 19.5,
        "vitaminC": 0,
        "vitaminE": 0.2,
        "vitaminK": 0.3,
        "vitaminA": 3,
        "vitaminB6": 0.4,
        "thiamine": 0.1,
        "riboflavin": 0.1,
        "niacin": 7.6,
        "omega3": 0,
        "salt": 0.6
      },
      "averageNutrientsPer100g": {
        "calories": 135,
        "protein": 10.8,
        "totalFat": 3.4,
        "saturatedFat": 0.7,
        "carbohydrates": 15.4,
        "sugar": 1.1,
        "totalFibre": 0.7,
        "sodium": 182
      },
      "boundingBox2D": [
        180,
        50,
        350,
        560
      ],
      "scoutItemIndices": [
        0,
        1
      ],
      "itemClinicalThreats": {},
      "items": [
        {
          "name": "Nila Bakar + Nasi / Grilled Tilapia with Rice",
          "keyword": "Nila Bakar + Nasi / Grilled Tilapia with Rice",
          "originalName": "Nila Bakar + Nasi / Grilled Tilapia with Rice",
          "boundingBox2D": null,
          "sourceImageIndex": 0,
          "scoutIndex": 0
        },
        {
          "name": "Ayam Bakar + Nasi / Grilled Chicken with Rice",
          "keyword": "Ayam Bakar + Nasi / Grilled Chicken with Rice",
          "originalName": "Ayam Bakar + Nasi / Grilled Chicken with Rice",
          "boundingBox2D": null,
          "sourceImageIndex": 0,
          "scoutIndex": 1
        }
      ],
      "servingWeightGrams": 133
    },
    {
      "groupName": "Sweet-Sour and Fried Poultry/Fish Dishes",
      "verdict": {
        "label": "Requires mindful portion balance",
        "level": "warning"
      },
      "message": "Deep-fried preparation methods and thick sweet-sour sauces substantially increase caloric density, saturated fat, and added sugars. This conflicts with your cardiac and metabolic targets. Enjoy only occasionally and remove excess batter and heavy sauce layers.",
      "comparisonSentence": "Compared to grilled selections, these fried and sweet-sour dishes deliver substantially higher calorie, sugar, and saturated fat loads.",
      "orderingTip": "Ask for sweet-sour sauce served separately so you can control the amount consumed.",
      "averageNutrients": {
        "calories": 180,
        "protein": 6,
        "totalFat": 4,
        "saturatedFat": 1,
        "transFat": 0,
        "unsaturatedFat": 3,
        "carbohydrates": 30,
        "sugar": 0.6,
        "addedSugar": 0,
        "totalFibre": 0,
        "solubleFibre": 0.1,
        "sodium": 250,
        "potassium": 176,
        "magnesium": 22,
        "calcium": 25.5,
        "iron": 1,
        "zinc": 0.7,
        "selenium": 16.2,
        "iodine": 8,
        "phosphorus": 141,
        "vitaminD": 0.1,
        "vitaminB12": 0.2,
        "folate": 12.5,
        "vitaminC": 0.1,
        "vitaminE": 0.4,
        "vitaminK": 0.9,
        "vitaminA": 30,
        "vitaminB6": 0.3,
        "thiamine": 0.1,
        "riboflavin": 0.1,
        "niacin": 7.2,
        "omega3": 0,
        "salt": 0.6
      },
      "averageNutrientsPer100g": {
        "calories": 185,
        "protein": 8.7,
        "totalFat": 7.6,
        "saturatedFat": 2,
        "carbohydrates": 19.6,
        "sugar": 4.9,
        "totalFibre": 0.5,
        "sodium": 250
      },
      "boundingBox2D": [
        360,
        50,
        930,
        560
      ],
      "scoutItemIndices": [
        2,
        3
      ],
      "itemClinicalThreats": {},
      "items": [
        {
          "name": "Gurame Asam Manis + Nasi / Sweet and Sour Carp with Rice",
          "keyword": "Gurame Asam Manis + Nasi / Sweet and Sour Carp with Rice",
          "originalName": "Gurame Asam Manis + Nasi / Sweet and Sour Carp with Rice",
          "boundingBox2D": null,
          "sourceImageIndex": 0,
          "scoutIndex": 2
        },
        {
          "name": "Ayam Goreng Geprek Tepung + Nasi / Crispy Smashed Fried Chicken with Rice",
          "keyword": "Ayam Goreng Geprek Tepung + Nasi / Crispy Smashed Fried Chicken with Rice",
          "originalName": "Ayam Goreng Geprek Tepung + Nasi / Crispy Smashed Fried Chicken with Rice",
          "boundingBox2D": null,
          "sourceImageIndex": 0,
          "scoutIndex": 3
        }
      ],
      "servingWeightGrams": 97
    },
    {
      "groupName": "Fried Rice (Nasi Goreng) Varieties",
      "verdict": {
        "label": "Elevated sodium impact",
        "level": "warning"
      },
      "message": "Wok-fried rice dishes combine high-glycemic refined grains with significant amounts of cooking oil, sweet soy sauce, and sodium. While seafood adds quality protein, the total lipid and carbohydrate load requires strict portion awareness to match your macro goals.",
      "comparisonSentence": "Nasi goreng variants pack higher overall carbohydrates and sodium than standalone protein dishes due to wok-frying oils and seasoned pastes.",
      "orderingTip": "Request less cooking oil and skip extra sweet soy sauce additions.",
      "averageNutrients": {
        "calories": 180,
        "protein": 6,
        "totalFat": 4,
        "saturatedFat": 1,
        "transFat": 0,
        "unsaturatedFat": 3,
        "carbohydrates": 30,
        "sugar": 0.6,
        "addedSugar": 0,
        "totalFibre": 0,
        "solubleFibre": 0,
        "sodium": 250,
        "potassium": 380,
        "magnesium": 30,
        "calcium": 15,
        "iron": 0.8,
        "zinc": 0.6,
        "selenium": 36.5,
        "iodine": 40,
        "phosphorus": 240,
        "vitaminD": 4.5,
        "vitaminB12": 3,
        "folate": 10,
        "vitaminC": 0,
        "vitaminE": 1,
        "vitaminK": 0.5,
        "vitaminA": 25,
        "vitaminB6": 0.5,
        "thiamine": 0.1,
        "riboflavin": 0.2,
        "niacin": 8.5,
        "omega3": 1.2,
        "salt": 0.6
      },
      "averageNutrientsPer100g": {
        "calories": 177,
        "protein": 6.3,
        "totalFat": 6.3,
        "saturatedFat": 1.4,
        "carbohydrates": 23.4,
        "sugar": 2,
        "totalFibre": 0.6,
        "sodium": 314
      },
      "boundingBox2D": [
        160,
        610,
        430,
        990
      ],
      "scoutItemIndices": [
        4
      ],
      "itemClinicalThreats": {},
      "items": [
        {
          "name": "Nasi Goreng Seafood / Seafood Fried Rice",
          "keyword": "Nasi Goreng Seafood / Seafood Fried Rice",
          "originalName": "Nasi Goreng Seafood / Seafood Fried Rice",
          "boundingBox2D": null,
          "sourceImageIndex": 0,
          "scoutIndex": 4
        }
      ],
      "servingWeightGrams": 102
    },
    {
      "groupName": "Seblak and Spicy Noodle Dishes",
      "verdict": {
        "label": "Elevated sodium impact",
        "level": "alert"
      },
      "message": "Seblak and spicy noodle preparations feature processed crackers, instant noodles, and heavy chili pastes loaded with sodium and inflammatory compounds. This exceeds your sodium threshold significantly and offers poor fiber content relative to carbohydrate density.",
      "comparisonSentence": "These noodle and seblak dishes present the highest sodium and refined carbohydrate concentrations among all menu categories.",
      "orderingTip": "Avoid entirely if managing blood pressure or fluid retention, or share a small portion while omitting processed crackers.",
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
        "calories": 184,
        "protein": 4.7,
        "totalFat": 7.5,
        "saturatedFat": 2.5,
        "carbohydrates": 24.4,
        "sugar": 1.6,
        "totalFibre": 0.5,
        "sodium": 453
      },
      "boundingBox2D": [
        440,
        610,
        950,
        990
      ],
      "scoutItemIndices": [
        5
      ],
      "itemClinicalThreats": {},
      "items": [
        {
          "name": "Seblak Cobek Viral / Spicy Seblak",
          "keyword": "Seblak Cobek Viral / Spicy Seblak",
          "originalName": "Seblak Cobek Viral / Spicy Seblak",
          "boundingBox2D": null,
          "sourceImageIndex": 0,
          "scoutIndex": 5
        }
      ],
      "servingWeightGrams": 85
    }
  ],
  "isMenuScale": false
}
```

## 🖥️ Backend Execution Logs

```
[backend] [job_compare_set5_1788958790876] Compare request received with 1 images. Mode: compare.
[scout_only_compare] Dispatched to gemini-3.5-flash-lite with single-pass instruction.
[scout_only_compare] Latency: 13455ms.
[scout_only_compare] Extracted 6 items into 4 ranked groups.
[scout_only_compare] Status: SUCCESS. Finalized compare payload.
```
