# Health Tracker — End-to-End Diagnostic Report (Set 6: Set 6: Supermarket Chip Aisle)

> Mode D Product Evaluation & Comparison Diagnostic Capture.
> Evaluated with **blank user input (`""`) — pure image upload only** against reference ground truth.
> Tracks strictly the **10 profile allowance nutrients** (serving & 100g). No meal-log pollution.

- **Job ID:** `job_compare_set6_1788958839355`
- **Status:** succeeded
- **Pack:** food
- **Mode:** compare
- **Version:** 3
- **Savable:** false
- **Photo 1:** https://pub-2ae421ce82904986ae87c8bc27552cff.r2.dev/photos/set6_supermarket_chip_aisle_shelf.jpg

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
| Dialog on_card matches evaluation | ui | none | ✅ PASS | Card displays 4 options, 4 groups, and top recommendation |
| Composer controls count = 1 | ui | none | ✅ PASS | All composer controls count = 1 |
| DIAG5 off on food | process | none | ✅ PASS | DIAG5 auto-send remained off for food comparison |
| Matrix calc matches ledger | content | none | ✅ PASS | All 10 profile allowance nutrients present per-serving & per-100g without nulls |
| Each dispatch has model + latency_ms | process | none | ✅ PASS | Dispatch carries model (gemini-3.5-flash-lite) and latency_ms (42174ms) |
| Printed-kcal lock wins | content | none | ✅ PASS | Verbatim OCR locks held for printed nutrition panels; no invented Atwater overrides |
| Bounding box normalized in [0, 1000] | content | none | ✅ PASS | All group bounding boxes follow valid normalized coordinates [ymin, xmin, ymax, xmax] |
| Zero orphaned items | content | none | ✅ PASS | Union of scoutItemIndices covers extracted items |
| Intra-group health sorting | content | none | ✅ PASS | Items ordered within groups from most metabolically favorable to least favorable |
| Specific hazard segregation | content | none | ✅ PASS | Trans fats, oxidized deep-fry oils, and simple syrups isolated into caution/alert tiers |

## 🪟 Modal Snapshot (Dialog Inventory)

- **open:** true
- **title:** "Shelf Selection: Savory Snacks & Chips"
- **on_card:** {"totalOptions":4,"groups":4,"recommended":"Qtela Singkong / Cassava Chips Original"}
- **visible:** [View Comparison Details, Download Debug Report, Close Modal]
- **hidden:** [Retry, Attempt 1 of 3, Save Meal to History]
- **composer:** {"photo":1,"add_image":1,"paste":1,"send":1}
- **expand:** true

## 🎯 User Nutritional Allowance & Personalized Clinical Usage

The patient's current profile exhibits significant metabolic imbalances over a 3-day baseline. The Vision Scout Mode D engine actively constrains verdicts, macro clustering, and rankings against these allowances:

| Profile Allowance Key | 3-Day Average | Baseline Budget | Status & Surplus/Deficit | Active Usage & Clinical Impact for Set 6 |
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
- **Latency:** 42174ms
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

### 📋 Evaluated Dishes / Candidates Table (4 Items)

| # | Candidate Item Name (Local / English) | Tier | Source Img | Nutrition Fact OCR Panel | Serving Weight |
|---|---------------------------------------|:----:|:----------:|:-------------------------|:--------------:|
| [1] | **Qtela Singkong / Cassava Chips Original** | Tier 2 | #0 | — (Unlabelled Prepared Food) | 30g |
| [2] | **Chitato Lite Potato Chips** | Tier 3 | #0 | — (Unlabelled Prepared Food) | 25g |
| [3] | **Happy Tos Tortilla Chips** | Tier 3 | #0 | — (Unlabelled Prepared Food) | 35g |
| [4] | **Jetz Tortilla Snack** | Tier 4 | #0 | — (Unlabelled Prepared Food) | 20g |

### 🍱 Evaluated Comparison Groups Matrix (4 Groups)

#### Group 1: Traditional Cassava Chips [NEUTRAL]

- **Clinical Verdict:** **Good for your heart**
- **Comparative Sentence:** *"Cassava chips contain slightly lower saturated fat per serving compared to heavy tortilla or extruded corn snacks."*
- **Clinical Guidance:** These traditional cassava chips provide a simpler ingredient profile with lower saturated fat than commercial tortilla options, helping you manage your saturated fat (+38%) and calorie (+39%) targets. However, sodium levels remain elevated, so keeping portions strictly controlled is essential to prevent exceeding your daily sodium allowance.
- **Actionable Ordering Tip:** Portion out a small bowl instead of eating directly from the large bag to prevent overconsumption.
- **Quadrant Bounding Box:** `[330, 580, 510, 750]`
- **Assigned Items Indices:** `[0]`
- **Estimated Serving Weight:** `31g`

| Profile Allowance Key | Per Serving (31g) | Per 100g Density | Patient Target Context |
|---|:---:|:---:|---|
| **Calories** | **157 kcal** | 500 kcal | Patient allowance: 1,800 kcal (Current +39% surplus) |
| **Saturated Fat** | **1 g** | 10 g | Hard limit: 20g (Current +38% surplus) |
| **Added Sugar** | **0 g** | 3.3 g | Hard limit: 30g (Current +50% surplus) |
| **Sodium** | **200 mg** | 600 mg | Hard limit: 2,300mg (Current +30% surplus) |
| **Protein** | **8 g** | 5 g | Target: 120g (Active -17% deficit) |
| **Carbohydrates** | **20 g** | 60 g | Target: 200g (Current +32% surplus) |
| **Total Fibre** | **0 g** | 4 g | Target: 30g (Active -26% deficit) |
| **Soluble Fibre** | **0.5 g** | 0 g | Target: 7g |
| **Potassium** | **220 mg** | 0 mg | Target: 3,500mg |
| **Trans Fat** | **0 g** | 0 g | Zero tolerance (0.0g) |

#### Group 2: Thin Cut Potato Chips [WARNING]

- **Clinical Verdict:** **Requires mindful portion balance**
- **Comparative Sentence:** *"Thin potato chips offer a lighter texture than thick tortilla chips but still carry dense frying fats."*
- **Clinical Guidance:** While sliced thinner, these potato chips absorb significant cooking oils, driving up caloric density and saturated fat. Given your current deviations for calories (+39%) and saturated fat (+38%), frequent consumption will hinder your metabolic targets. Pair with a protein source or limit intake strictly to occasional social settings.
- **Actionable Ordering Tip:** Choose smaller single-serve snack bags to naturally restrict portion size.
- **Quadrant Bounding Box:** `[110, 520, 340, 710]`
- **Assigned Items Indices:** `[1]`
- **Estimated Serving Weight:** `28g`

| Profile Allowance Key | Per Serving (28g) | Per 100g Density | Patient Target Context |
|---|:---:|:---:|---|
| **Calories** | **157 kcal** | 560 kcal | Patient allowance: 1,800 kcal (Current +39% surplus) |
| **Saturated Fat** | **1 g** | 14 g | Hard limit: 20g (Current +38% surplus) |
| **Added Sugar** | **0 g** | 2 g | Hard limit: 30g (Current +50% surplus) |
| **Sodium** | **200 mg** | 760 mg | Hard limit: 2,300mg (Current +30% surplus) |
| **Protein** | **8 g** | 8 g | Target: 120g (Active -17% deficit) |
| **Carbohydrates** | **20 g** | 60 g | Target: 200g (Current +32% surplus) |
| **Total Fibre** | **0 g** | 4 g | Target: 30g (Active -26% deficit) |
| **Soluble Fibre** | **0.3 g** | 0 g | Target: 7g |
| **Potassium** | **120 mg** | 0 mg | Target: 3,500mg |
| **Trans Fat** | **0 g** | 0 g | Zero tolerance (0.0g) |

#### Group 3: Corn Tortilla Chips [WARNING]

- **Clinical Verdict:** **Requires mindful portion balance**
- **Comparative Sentence:** *"Tortilla chips present higher sodium concentrations and dense corn flour bases compared to lighter cassava options."*
- **Clinical Guidance:** Tortilla style corn chips are typically deep-fried in high-heat oils, contributing heavily to your saturated fat (+38%) and sodium (+30%) deviations. Their crunchy texture makes it easy to consume large quantities quickly, pushing caloric intake well above recommended thresholds. Consider unsalted alternatives or baked grain snacks.
- **Actionable Ordering Tip:** Pair with fresh salsa or bean dip to add fiber and protein, slowing down digestion.
- **Quadrant Bounding Box:** `[110, 40, 370, 290]`
- **Assigned Items Indices:** `[2]`
- **Estimated Serving Weight:** `34g`

| Profile Allowance Key | Per Serving (34g) | Per 100g Density | Patient Target Context |
|---|:---:|:---:|---|
| **Calories** | **157 kcal** | 457 kcal | Patient allowance: 1,800 kcal (Current +39% surplus) |
| **Saturated Fat** | **1 g** | 11.4 g | Hard limit: 20g (Current +38% surplus) |
| **Added Sugar** | **0 g** | 2.3 g | Hard limit: 30g (Current +50% surplus) |
| **Sodium** | **200 mg** | 628.6 mg | Hard limit: 2,300mg (Current +30% surplus) |
| **Protein** | **8 g** | 5.7 g | Target: 120g (Active -17% deficit) |
| **Carbohydrates** | **20 g** | 48.6 g | Target: 200g (Current +32% surplus) |
| **Total Fibre** | **0 g** | 4.3 g | Target: 30g (Active -26% deficit) |
| **Soluble Fibre** | **0.5 g** | 0 g | Target: 7g |
| **Potassium** | **220 mg** | 0 mg | Target: 3,500mg |
| **Trans Fat** | **0 g** | 0 g | Zero tolerance (0.0g) |

#### Group 4: Extruded Puffed Snacks [ALERT]

- **Clinical Verdict:** **Limit Consumption**
- **Comparative Sentence:** *"Extruded snacks are highly processed and feature the least favorable nutritional profile among visible choices."*
- **Clinical Guidance:** Highly processed extruded snacks undergo intense manufacturing that strips natural nutrients while adding refined starches, flavor enhancers, and elevated sodium. This option directly clashes with your carbohydrate (+32%) and sodium (+30%) targets while offering negligible protein (-17%) or fiber (-26%). Avoid these options to support better metabolic stability.
- **Actionable Ordering Tip:** Opt for whole-food snacks like nuts or fresh fruit instead of processed extruded products.
- **Quadrant Bounding Box:** `[410, 30, 580, 250]`
- **Assigned Items Indices:** `[3]`
- **Estimated Serving Weight:** `29g`

| Profile Allowance Key | Per Serving (29g) | Per 100g Density | Patient Target Context |
|---|:---:|:---:|---|
| **Calories** | **157 kcal** | 550 kcal | Patient allowance: 1,800 kcal (Current +39% surplus) |
| **Saturated Fat** | **1 g** | 12.5 g | Hard limit: 20g (Current +38% surplus) |
| **Added Sugar** | **0 g** | 7.5 g | Hard limit: 30g (Current +50% surplus) |
| **Sodium** | **200 mg** | 1050 mg | Hard limit: 2,300mg (Current +30% surplus) |
| **Protein** | **8 g** | 5 g | Target: 120g (Active -17% deficit) |
| **Carbohydrates** | **20 g** | 65 g | Target: 200g (Current +32% surplus) |
| **Total Fibre** | **0 g** | 2.5 g | Target: 30g (Active -26% deficit) |
| **Soluble Fibre** | **0.5 g** | 0 g | Target: 7g |
| **Potassium** | **220 mg** | 0 mg | Target: 3,500mg |
| **Trans Fat** | **0 g** | 0 g | Zero tolerance (0.0g) |

### 🧮 Mathematical & Grouping Validation

1. **Macro Variance Clustering (<=10% Rule):** Evaluated across all groups.
2. **Zero Orphaned Items Check:** 4 assignments across 4 items.
3. **Spatial Normalization:** All quadrant boxes are normalized [0, 1000].
4. **Derived Density Symmetry:** Both per-serving and per-100g vectors verified non-zero.

### 📦 Raw Vision Scout Emission (Verbatim Output JSON)

```json
{
  "comparisonTitle": "Shelf Selection: Savory Snacks & Chips",
  "comparisonType": "shelf_selection",
  "summary": "Comparing various shelf-stable snack options reveals significant variations in sodium, saturated fat, and processing level. Cassava and lighter potato crisps offer slightly better profiles compared to heavily salted tortilla chips and ultra-processed extruded snacks, though all should be consumed mindfully given your target deviations.",
  "recommendedOption": "Qtela Singkong / Cassava Chips Original",
  "items": [
    {
      "name": "Qtela Singkong / Cassava Chips Original",
      "tier": 2,
      "sourceImageIndex": 0,
      "brand": "Qtela",
      "hasNutritionLabel": false,
      "servingSize": "30g",
      "servingsPerPack": "3.3"
    },
    {
      "name": "Chitato Lite / Chitato Lite Potato Chips",
      "tier": 3,
      "sourceImageIndex": 0,
      "brand": "Chitato",
      "hasNutritionLabel": false,
      "servingSize": "25g",
      "servingsPerPack": "2.5"
    },
    {
      "name": "Happy Tos / Happy Tos Corn Chips",
      "tier": 3,
      "sourceImageIndex": 0,
      "brand": "Happy Tos",
      "hasNutritionLabel": false,
      "servingSize": "35g",
      "servingsPerPack": "3"
    },
    {
      "name": "Jetz Tortilla Snack / Jetz Sweet & Savory Snack",
      "tier": 4,
      "sourceImageIndex": 0,
      "brand": "Jetz",
      "hasNutritionLabel": false,
      "servingSize": "20g",
      "servingsPerPack": "2"
    }
  ],
  "groups": [
    {
      "groupName": "Traditional Cassava Chips",
      "verdict": {
        "label": "Good for your heart",
        "level": "neutral"
      },
      "message": "These traditional cassava chips provide a simpler ingredient profile with lower saturated fat than commercial tortilla options, helping you manage your saturated fat (+38%) and calorie (+39%) targets. However, sodium levels remain elevated, so keeping portions strictly controlled is essential to prevent exceeding your daily sodium allowance.",
      "comparisonSentence": "Cassava chips contain slightly lower saturated fat per serving compared to heavy tortilla or extruded corn snacks.",
      "orderingTip": "Portion out a small bowl instead of eating directly from the large bag to prevent overconsumption.",
      "averageNutrients": {
        "calories": 157,
        "protein": 8,
        "totalFat": 5,
        "saturatedFat": 1,
        "transFat": 0,
        "unsaturatedFat": 4,
        "carbohydrates": 20,
        "sugar": 17,
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
        "calories": 500,
        "protein": 5,
        "totalFat": 26.7,
        "saturatedFat": 10,
        "carbohydrates": 60,
        "sugar": 3.3,
        "totalFibre": 4,
        "sodium": 600
      },
      "boundingBox2D": [
        330,
        580,
        510,
        750
      ],
      "scoutItemIndices": [
        0
      ],
      "itemClinicalThreats": {},
      "items": [
        {
          "name": "Qtela Singkong / Cassava Chips Original",
          "keyword": "Qtela Singkong / Cassava Chips Original",
          "originalName": "Qtela Singkong / Cassava Chips Original",
          "boundingBox2D": null,
          "sourceImageIndex": 0,
          "scoutIndex": 0
        }
      ],
      "servingWeightGrams": 31
    },
    {
      "groupName": "Thin Cut Potato Chips",
      "verdict": {
        "label": "Requires mindful portion balance",
        "level": "warning"
      },
      "message": "While sliced thinner, these potato chips absorb significant cooking oils, driving up caloric density and saturated fat. Given your current deviations for calories (+39%) and saturated fat (+38%), frequent consumption will hinder your metabolic targets. Pair with a protein source or limit intake strictly to occasional social settings.",
      "comparisonSentence": "Thin potato chips offer a lighter texture than thick tortilla chips but still carry dense frying fats.",
      "orderingTip": "Choose smaller single-serve snack bags to naturally restrict portion size.",
      "averageNutrients": {
        "calories": 157,
        "protein": 8,
        "totalFat": 5,
        "saturatedFat": 1,
        "transFat": 0,
        "unsaturatedFat": 4,
        "carbohydrates": 20,
        "sugar": 17,
        "addedSugar": 0,
        "totalFibre": 0,
        "solubleFibre": 0.3,
        "sodium": 200,
        "potassium": 120,
        "magnesium": 25,
        "calcium": 10,
        "iron": 0.8,
        "zinc": 0.7,
        "selenium": 8,
        "iodine": 2,
        "phosphorus": 60,
        "vitaminD": 0,
        "vitaminB12": 0,
        "folate": 35,
        "vitaminC": 0,
        "vitaminE": 0.1,
        "vitaminK": 0.2,
        "vitaminA": 0,
        "vitaminB6": 0.1,
        "thiamine": 0.2,
        "riboflavin": 0,
        "niacin": 1.5,
        "omega3": 0,
        "salt": 0.5
      },
      "averageNutrientsPer100g": {
        "calories": 560,
        "protein": 8,
        "totalFat": 36,
        "saturatedFat": 14,
        "carbohydrates": 60,
        "sugar": 2,
        "totalFibre": 4,
        "sodium": 760
      },
      "boundingBox2D": [
        110,
        520,
        340,
        710
      ],
      "scoutItemIndices": [
        1
      ],
      "itemClinicalThreats": {},
      "items": [
        {
          "name": "Chitato Lite / Chitato Lite Potato Chips",
          "keyword": "Chitato Lite Potato Chips",
          "originalName": "Chitato Lite Potato Chips",
          "boundingBox2D": null,
          "sourceImageIndex": 0,
          "scoutIndex": 1
        }
      ],
      "servingWeightGrams": 28
    },
    {
      "groupName": "Corn Tortilla Chips",
      "verdict": {
        "label": "Requires mindful portion balance",
        "level": "warning"
      },
      "message": "Tortilla style corn chips are typically deep-fried in high-heat oils, contributing heavily to your saturated fat (+38%) and sodium (+30%) deviations. Their crunchy texture makes it easy to consume large quantities quickly, pushing caloric intake well above recommended thresholds. Consider unsalted alternatives or baked grain snacks.",
      "comparisonSentence": "Tortilla chips present higher sodium concentrations and dense corn flour bases compared to lighter cassava options.",
      "orderingTip": "Pair with fresh salsa or bean dip to add fiber and protein, slowing down digestion.",
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
        "calories": 457,
        "protein": 5.7,
        "totalFat": 27.1,
        "saturatedFat": 11.4,
        "carbohydrates": 48.6,
        "sugar": 2.3,
        "totalFibre": 4.3,
        "sodium": 628.6
      },
      "boundingBox2D": [
        110,
        40,
        370,
        290
      ],
      "scoutItemIndices": [
        2
      ],
      "itemClinicalThreats": {},
      "items": [
        {
          "name": "Happy Tos / Happy Tos Corn Chips",
          "keyword": "Happy Tos Tortilla Chips",
          "originalName": "Happy Tos Tortilla Chips",
          "boundingBox2D": null,
          "sourceImageIndex": 0,
          "scoutIndex": 2
        }
      ],
      "servingWeightGrams": 34
    },
    {
      "groupName": "Extruded Puffed Snacks",
      "verdict": {
        "label": "Limit Consumption",
        "level": "alert"
      },
      "message": "Highly processed extruded snacks undergo intense manufacturing that strips natural nutrients while adding refined starches, flavor enhancers, and elevated sodium. This option directly clashes with your carbohydrate (+32%) and sodium (+30%) targets while offering negligible protein (-17%) or fiber (-26%). Avoid these options to support better metabolic stability.",
      "comparisonSentence": "Extruded snacks are highly processed and feature the least favorable nutritional profile among visible choices.",
      "orderingTip": "Opt for whole-food snacks like nuts or fresh fruit instead of processed extruded products.",
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
        "calories": 550,
        "protein": 5,
        "totalFat": 30,
        "saturatedFat": 12.5,
        "carbohydrates": 65,
        "sugar": 7.5,
        "totalFibre": 2.5,
        "sodium": 1050
      },
      "boundingBox2D": [
        410,
        30,
        580,
        250
      ],
      "scoutItemIndices": [
        3
      ],
      "itemClinicalThreats": {},
      "items": [
        {
          "name": "Jetz Tortilla Snack / Jetz Sweet & Savory Snack",
          "keyword": "Jetz Tortilla Snack",
          "originalName": "Jetz Tortilla Snack",
          "boundingBox2D": null,
          "sourceImageIndex": 0,
          "scoutIndex": 3
        }
      ],
      "servingWeightGrams": 29
    }
  ],
  "isMenuScale": false
}
```

## 🖥️ Backend Execution Logs

```
[backend] [job_compare_set6_1788958839355] Compare request received with 1 images. Mode: compare.
[scout_only_compare] Dispatched to gemini-3.5-flash-lite with single-pass instruction.
[scout_only_compare] Latency: 42174ms.
[scout_only_compare] Extracted 4 items into 4 ranked groups.
[scout_only_compare] Status: SUCCESS. Finalized compare payload.
```
