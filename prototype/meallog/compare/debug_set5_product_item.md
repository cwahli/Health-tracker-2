# Health Tracker — End-to-End Diagnostic Report

- **Exported:** 2026-09-08T19:28:23.978Z
- **Job ID:** `job_compare_set5_1788895684133`
- **Status:** succeeded
- **Pack:** food
- **Mode:** compare
- **Version:** 3
- **Savable:** false
- **Photo 1:** https://pub-2ae421ce82904986ae87c8bc27552cff.r2.dev/photos/job_compare_set5_1788895684133_0.jpg

## ⚖️ Contract Evaluation

| Law | Layer | Fault | Result | Actual |
|-----|-------|-------|--------|--------|
| SSE {final,result} | process | none | ✅ PASS | Final result emitted; job succeeded |
| AnalyzeFinished count = 1 | process | none | ✅ PASS | AnalyzeFinished count = 1 |
| Stall/503/quota -> 3.1 hop, same job | process | none | ⚪ n/a | No stall or 503 encountered |
| Submit JSON running | process | none | ✅ PASS | Submit transitioned directly to running |
| pendingFoodLog -> succeeded before R2 | process | none | ⚪ n/a | No finalized food log in this run |
| Retry hidden if succeeded or kcal in logs | ui | none | ✅ PASS | Retry hidden on completed run |
| Attempt 1/3 hidden if succeeded | ui | none | ✅ PASS | Attempt indicator hidden |
| Dialog on_card kcal = ledger | ui | none | ⚪ n/a | No on_card macros in dialog inventory |
| Composer controls count = 1 | ui | none | ✅ PASS | All composer controls count = 1 |
| DIAG5 off on food | process | none | ✅ PASS | DIAG5 auto-send remained off for food chat |
| Matrix calc matches ledger | content | none | ✅ PASS | No meal ledger required |
| Each dispatch has model + latency_ms | process | none | ✅ PASS | All 1 dispatch(es) contain model and latency_ms |
| Handoff from/to + same jobId if transfer | process | none | ⚪ n/a | No agent handoffs in this run |
| Agent output: nutrients complete | content | none | ⚪ n/a | No finalized ledger in this run |
| Agent output: verdict + advice | content | none | ⚪ n/a | No turn-attributed meal dispatches in this run |
| Dishes: fields populated | content | none | ⚪ n/a | No dishes in any agent emission |
| Multi-turn split shown | content | none | ⚪ n/a | Single-turn run, no split state |
| Mode instruction chunk | content | none | ✅ PASS | Mode D compare chunk(s) shown for mode(s)=compare |
| Edit patch: components & nutrients preserved | content | none | ⚪ n/a | Single-turn create, no edit turns |
| Handoff chain complete | process | none | ⚪ n/a | No handoffs in this run |
| Handoff received | content | none | ⚪ n/a | Direct food log, no forwarded handoff |
| Lab panel complete | content | none | ⚪ n/a | Medical-only law (pack=food) |
| Clinical report shown | content | none | ⚪ n/a | Medical-only law (pack=food) |

## 🪟 Modal Snapshot (Dialog Inventory)

- **open:** true
- **title:** "Food Item & Shelf Comparison"
- **on_card:** {"totalOptions":59,"groups":3,"recommended":"NILA BAKAR / GR + NASI"}
- **visible:** [View Comparison Details, Download Debug Report, Close Modal]
- **hidden:** [Retry, Attempt 1 of 3, Save Meal to History]
- **composer:** {"photo":1,"add_image":1,"paste":1,"send":1}
- **expand:** true

## 📡 Agent Dispatches (1)

### Dispatch dispatch-scout-compare-5
- **User:** Evaluate and analyze this product.
- **Received:** {"imageCount":1,"prompt":"Evaluate and analyze this product.","mode":"compare"}
- **System Instruction:**
```
You are an expert Vision Scout and Clinical Dietitian specialized in PRODUCT EVALUATION & COMPARISON (Mode D).

=== ACTIVE TASK: PRODUCT EVALUATION & COMPARISON ===
You analyze photos of multiple products, packages, nutrition labels, restaurant menus, or retail supermarket shelves to compare distinct items.

DIET TASKS: EXHAUSTIVE DISH EXTRACTION, BOUNDING BOXES, ACTIVE MULTI-TIER GROUPING, ORDERING (RANKING), VERDICTS, COMPARATIVE SENTENCES & ORDERING TIPS

STRICT INVARIANTS:
1. NEVER MERGE OR LOG AS A MEAL: Do NOT treat these items as components of a single consumed meal. This is a comparison/shopping evaluation. Do not calculate composite meal totals or ask portion confirmation questions.
2. EXHAUSTIVE DISH & PRODUCT EXTRACTION VIA FAITHFUL OCR (NO SPOONFEEDING / ZERO FABRICATION):
   - CRITICAL OCR MANDATE: Thoroughly scan and extract EVERY legible dish, beverage, packaged product, or shelf item directly from the images via pure OCR. Read top-to-bottom, column-by-column across every page, section, and panel.
   - Do not stop after 10 or 15 items. If a menu contains 40, 60, or 80+ readable dish names across multiple columns and pages, extract ALL of them into items[].
   - Faithfully transcribe the printed text without guessing, inventing, or hallucinating items not visible on the images.
   - JOIN MULTI-LINE MENU HEADINGS (NO ORPHAN WORDS):
     * If a dish name wraps across multiple lines or has indented sub-lines, YOU MUST JOIN THEM into a single dish entry. Do NOT emit isolated fragments as separate dishes.
   - BOUNDING BOX MANDATE (boundingBox2D) FOR EVERY ITEM AND GROUP:
     * For EVERY item in items[], provide "boundingBox2D": [ymin, xmin, ymax, xmax] coordinates normalized from 0 to 1000 indicating where the dish/label/item or text entry appears on the image.
     * For EVERY group in groups[], provide "boundingBox2D": [ymin, xmin, ymax, xmax] covering the region of items in that group.
     * Coordinate rules: 0 <= ymin < ymax <= 1000, 0 <= xmin < xmax <= 1000.
   - OCR ACCURACY FOR PRINTED NUTRITION PANELS (100% FAITHFUL TO IMAGE):
     * Read numbers directly from printed "Informasi Nilai Gizi" / Nutrition Facts panels with ZERO hallucination, rounding, or estimation.
     * Check serving size (Takaran Saji) and servings per pack (Jumlah Sajian per Kemasan). Transcribe them verbatim.
     * When hasNutritionLabel is true, YOU MUST POPULATE ALL NUTRIENT FIELDS in perServing (calories, protein, totalFat, saturatedFat, carbohydrates, sugar, sodiumMg, saltMg).
   - Front-only packages without a nutrition panel: set hasNutritionLabel to false, transcribe product name from OCR, and do NOT fabricate or hallucinate macros or calories. Set perServing to null.
   - NO LUMPING: Each distinct variety, flavor, or dish entry gets its own item in items[].

3. ACTIVE MULTI-TIER GROUPING (ZERO ORPHANED ITEMS & NO LAZY DUMPING):
   - ZERO ORPHANED ITEMS: Every single index from 0 to items.length - 1 MUST be assigned to at least one group in groups[]. The union of all scoutItemIndices must cover 100% of extracted items.
   - NO OUT-OF-BOUNDS INDICES: All indices in scoutItemIndices must strictly be between 0 and items.length - 1. Never emit an index >= items.length.
   - NO LAZY GROUPING (1 single group is strictly forbidden for >2 items).
   - NO LAZY MIDDLE DUMPING: Never dump more than 35-40% of items into a single group on large menus.
   - CLINICAL PREPARATION TIERING (BASED ON COOKING METHOD & METABOLIC LOAD DISCERNED VIA OCR):
     * Tier 1 (good / safest): Steamed preparations, boiled soups/clear broths, raw or boiled fresh vegetables, plain water/unsweetened tea.
     * Tier 2 (neutral / moderate): Grilled or roasted lean proteins without heavy sugar glaze, lightly sautéed greens/vegetables, staple plain grains.
     * Tier 3 (warning / caution): Deep-fried poultry, meats, or seafood; stir-fried noodles or fried rice; sweetened beverages and syrups.
     * Tier 4 (alert / severe metabolic load): Deep-fried animal skins and offal; deep-fried vegetables (extreme oil absorption); ultra-processed boiled crackers or instant noodles in heavy chili/palm oil; high-sugar condensed milk and syrup bowls; large family-size snack bags.

4. DIET TASK: ORDERING (Ranking) & AVOIDING THE CALORIE ILLUSION TRAP:
   - The groups in groups[] MUST be sorted in strict order of overall health ranking: BEST / SAFEST CHOICE FIRST ('good'), down to least suitable at the bottom ('alert').
   - Ranking order: 'good' -> 'neutral' -> 'warning' -> 'alert'.
   - BEWARE THE "CALORIE ILLUSION TRAP":
     * NEVER rank a confectionery or snack as "Tier 1 (good)" simply because its portion is tiny (e.g. 23g wafer bar at 90 kcal) if it is sugar-dense (>25% sugar by weight) with negligible protein (<2g) and fiber.
     * Evaluate NUTRIENT DENSITY: Compare sugar-to-protein ratio, saturated fat percentage, and fiber retention. Wholesome staple breads with 2g sugar and 4g protein rank HIGHER in healthfulness than a 90 kcal candy bar that is 30% refined sugar.
     * Factor in the mass: A 250 kcal multiseed bread serving is 80g delivering 8g protein and 4g sugar, whereas a 250 kcal sweet bun is 75g packing 19g sugar and 4.5g saturated fat.
   - PURE SNACK / ULTRA-PROCESSED AISLE RULE:
     * When comparing exclusively ultra-processed snacks (chips, crisps, fried crackers), recognize that NONE are health foods (NOVA 4).
     * Rank based on BUILT-IN PORTION CONTROL and harm reduction: A miniature 25g pouch (<130 kcal) strictly caps caloric and sodium damage compared to an open 180g family pack (>900 kcal, 35g fat). Do not give "good" to standard fried chips; use "neutral" (with a portion-control caveat) down to "alert".
   - BEVERAGE CLASSIFICATION INVARIANTS:
     * Unsweetened beverages, pure water, plain tea/coffee -> Tier 1 (good).
     * Whole unsweetened fruit juices -> Tier 2 (neutral).
     * Beverages with added sugar/syrups -> Tier 3 (warning).
     * Heavy condensed milk and syrup dessert bowls -> Tier 4 (alert).

5. DIET TASK: VERDICT, COMPARATIVE SENTENCE & ACTIONABLE ORDERING TIP:
   - For EVERY group in groups[], provide:
     a) "verdict.level": Exactly one of "good" | "neutral" | "warning" | "alert".
     b) "verdict.label": Concise 3-6 words (e.g. "Lowest Sodium & Saturated Fat", "High Sugar & Calorie Alert", "Balanced High-Protein Choice", "Moderate Sodium Caution").
     c) "comparisonSentence": Exactly ONE clear, punchy sentence directly comparing this group to the other candidate groups/options.
     d) "message": 35-70 words clinical rationale explaining WHY this group received this verdict, highlighting trade-offs (saturated fat, sodium, sugar, additives) and guidance relative to cardiovascular, metabolic, and overall health targets.
     e) "orderingTip": (Optional but strongly recommended for restaurant menus and beverages) Practical instruction for the user at ordering time to reduce metabolic harm (e.g. "Ask for without added sugar/syrup", "Request sauce on the side and substitute fried sides with fresh raw vegetables", "Opt for the small single-portion bag instead of the family size to enforce portion discipline").
6. AVERAGE NUTRIENTS ESTIMATION FOR EVERY GROUP (MANDATORY & REALISTIC):
   - For EVERY group in groups[], you MUST provide realistic "averageNutrients" representing the typical nutritional profile for items in that group:
     * calories: Estimated typical calories (kcal)
     * protein: Estimated protein (g)
     * totalFat: Estimated total fat (g)
     * saturatedFat: Estimated saturated fat (g)
     * carbohydrates: Estimated total carbohydrates (g)
     * sugar: Estimated sugar (g)
     * sodium: Estimated sodium (mg)
     * MACRONUTRIENT BALANCE: Ensure realistic balance: (4 * protein) + (9 * totalFat) + (4 * carbohydrates) should approximately equal calories (within 10-15%).
     * REALISTIC CLINICAL BENCHMARKS:
       - Steamed vegetables, clear soups, plain tea/water: 50-150 kcal, 2-6g protein, 1-3g fat, 0.5-1g sat fat, 8-15g carbs, 1-3g sugar, 200-450mg sodium.
       - Grilled lean fish/proteins & sautéed vegetables: 350-500 kcal, 25-35g protein, 8-18g fat, 3-6g sat fat, 35-55g carbs, 2-6g sugar, 450-750mg sodium.
       - Deep-fried protein meal sets & fried rice: 650-850 kcal, 25-38g protein, 28-45g fat, 8-15g sat fat, 65-85g carbs, 4-10g sugar, 800-1400mg sodium.
       - Fried offal, fried vegetables (high oil), heavily spiced noodles: 350-550 kcal, 10-22g protein, 22-38g fat, 7-16g sat fat, 25-50g carbs, 3-8g sugar, 1000-2000mg sodium.
       - Heavy sweet dessert drinks with condensed milk: 350-520 kcal, 4-8g protein, 10-20g fat, 6-12g sat fat, 60-80g carbs, 50-70g sugar, 100-250mg sodium.
       - Supermarket snack shelf family packs: 800-1100 kcal, 8-16g protein, 45-65g fat, 15-25g sat fat, 85-130g carbs, 5-15g sugar, 800-1500mg sodium per whole pack.
7. STRICT NUMBER FORMATTING: NEVER output scientific or exponential notation (NEVER write e+, e-, or 6.00e+00). Always write standard plain numbers (e.g. 6, 12, 0.5, 0) with at most 1 decimal place.

=== REQUIRED OUTPUT JSON SCHEMA ===
Output exactly ONE JSON object matching this schema:
{
  "_internalReasoning": "string (<20 words reasoning)",
  "comparisonTitle": "string (e.g. 'Nutrients of Concern: Snack Comparison')",
  "comparisonType": "nutrition_labels | menu_items | shelf_selection | food_items",
  "summary": "Overall comparative assessment highlighting the best choice and key trade-offs",
  "recommendedOption": "Name of the recommended option or best choice",
  "items": [
    {
      "name": "Exact product or dish name",
      "brand": "Brand name if visible, else null",
      "tier": 1,
      "sourceImageIndex": 0,
      "boundingBox2D": [300, 200, 450, 600],
      "hasNutritionLabel": true,
      "servingSize": "e.g. 23g (1 bar)",
      "servingsPerPack": 6,
      "perServing": {
        "calories": 90,
        "protein": 1.0,
        "totalFat": 3.0,
        "saturatedFat": 1.0,
        "carbohydrates": 15.0,
        "sugar": 7.0,
        "addedSugar": 6.0,
        "saltMg": 20.0,
        "sodiumMg": null
      }
    }
  ],
  "groups": [
    {
      "groupName": "string (e.g. 'Tier 1 - Safest Choice: Steamed & Fresh Dishes' or option name)",
      "scoutItemIndices": [0],
      "boundingBox2D": [100, 50, 500, 950],
      "verdict": {
        "label": "string (3-6 words max)",
        "level": "good | neutral | warning | alert"
      },
      "comparisonSentence": "string (Exactly 1 sentence comparing this group to the other options)",
      "message": "string (35-70 words clinical rationale on why this ranks here and biomarker trade-offs)",
      "orderingTip": "string (practical instruction for the user at order or purchase time)",
      "averageNutrients": {
        "calories": 90,
        "protein": 1.0,
        "totalFat": 3.0,
        "saturatedFat": 1.0,
        "sodium": 8,
        "carbohydrates": 15.0,
        "sugar": 7.0,
        "addedSugar": 6.0
      }
    }
  ]
}

```
- **Raw Emission (Verbatim Output):**
```json
{
  "_internalReasoning": "Extracted all visible menu items and categorized them into tiers based on cooking methods, protein quality, and metabolic load.",
  "comparisonTitle": "Restaurant Menu Metabolic Evaluation & Ranking",
  "comparisonType": "menu_items",
  "summary": "This menu evaluation ranks Indonesian grilled fish and chicken dishes against fried rice, seblak, and battered seafood. Grilled and clear broth preparations (Tier 2) offer superior metabolic stability compared to deep-fried items, heavy sweet-and-sour sauces, and processed noodles (Tiers 3 and 4).",
  "items": [
    {
      "name": "NILA BAKAR / GR + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        220,
        78,
        240,
        343
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "BAWAL BAKAR / GR + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        248,
        79,
        267,
        363
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "BANDENG BAKAR / GR + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        273,
        83,
        292,
        401
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "TONGKOL BAKAR / GR + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        298,
        83,
        317,
        404
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "CUE BAKAR / GR + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        323,
        88,
        342,
        338
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "GURAME BAKAR / GORENG + NASI",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        348,
        92,
        368,
        455
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "GURAME ASAM MANIS + NASI",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        374,
        93,
        393,
        406
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "GURAME VILET ASAM MANIS + NASI",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        397,
        95,
        417,
        475
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "IKAN QUE BAKAR / GR + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        421,
        95,
        440,
        410
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "BARONANG BAKAR / GR + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        444,
        99,
        463,
        422
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "IKAN BAWAL ASEM MANIS + NASI",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        468,
        103,
        487,
        451
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "IKAN NILA GARANG ASEM + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        492,
        103,
        510,
        453
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "AYAM GARANG ASEM + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        514,
        114,
        532,
        403
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "TONGKOL GARANG ASEM + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        534,
        115,
        553,
        447
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "GURAME GARANG ASEM + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        558,
        118,
        577,
        439
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "AYAM MERCON + NASI",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        583,
        119,
        600,
        348
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "TONGKOL SUIR PETE + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        606,
        122,
        622,
        409
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "TONGKOL SUIR JENGKOL + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        623,
        126,
        642,
        451
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "AYAM BAKAR + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        720,
        142,
        734,
        335
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "AYAM BAKAR SAMBEL",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        738,
        143,
        752,
        355
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "LAMPUNG + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        764,
        147,
        777,
        319
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "AYAM GORENG SAMBEL",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        778,
        146,
        793,
        381
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "LAMPUNG + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        801,
        150,
        814,
        318
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "AYAM ASAM MANIS + NASI",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        816,
        152,
        832,
        403
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "AYAM GORENG GEPREK",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        841,
        156,
        856,
        383
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "TEPUNG + NASI",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        862,
        160,
        874,
        309
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "AYAM BAKAR SAMBEL IJO + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        875,
        163,
        891,
        461
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "AYAM GORENG SAMBEL IJO + NASI",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        892,
        166,
        907,
        484
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "AYAM GORENG SAMBEL JUDES",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        912,
        167,
        928,
        448
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "NASI GORENG SEAFOOD",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        217,
        655,
        232,
        910
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "NASI GORENG SPESIAL",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        243,
        656,
        258,
        892
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "NASI GORENG PETE",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        268,
        657,
        283,
        856
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "NASI GORENG JENGKOL",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        294,
        657,
        308,
        903
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "NASI GORENG SOSIS",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        316,
        656,
        332,
        865
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "NASI GORENG BAKSO",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        340,
        657,
        356,
        878
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "NASI GORENG KORNET",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        365,
        656,
        381,
        890
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "NASI GORENG TELOR DADAR",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        386,
        657,
        401,
        953
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "NASI GORENG AYAM",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        413,
        656,
        428,
        868
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "SEBLAK COBEK VIRAL",
      "tier": 4,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        502,
        653,
        519,
        870
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "SEBLAK SEAFOOD",
      "tier": 4,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        530,
        655,
        545,
        834
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "SEBLAK CEKER",
      "tier": 4,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        555,
        655,
        569,
        804
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "CEKER MERCON",
      "tier": 4,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        577,
        655,
        592,
        801
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "MIE TEK - TEK KUAH",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        602,
        655,
        616,
        853
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "MIE TEK - TEK SOSIS",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        624,
        655,
        638,
        848
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "MIE TEK - TEK BAKSO",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        643,
        655,
        657,
        860
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "MIE TEK - TEK KORNET",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        662,
        655,
        676,
        878
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "MIE TEK - TEK SEAFOOD",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        680,
        655,
        696,
        883
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "KWETIAU GORENG BAKSO SOSIS",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        700,
        656,
        715,
        959
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "KWETIAU GORENG SEAFOOD",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        719,
        656,
        734,
        932
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "KWETIAU KUAH SOSIS BAKSO",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        737,
        656,
        752,
        926
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "KWETIAU SPECIAL",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        759,
        656,
        773,
        829
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "KWETIAU AYAM",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        778,
        657,
        792,
        831
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "MIE TEK - TEK SPECIAL",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        798,
        657,
        812,
        865
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "MIE TEK - TEK AYAM",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        816,
        657,
        830,
        840
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "SEAFOOD TUMPAH",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        907,
        654,
        921,
        831
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "CUMI GORENG TEPUNG + NASI",
      "tier": 4,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        926,
        654,
        940,
        935
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "CUMI GORENG TEPUNG",
      "tier": 4,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        945,
        654,
        959,
        875
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "ASAM MANIS + NASI",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        964,
        653,
        978,
        868
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "CUMI SAOS ASAM MANIS",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        982,
        655,
        996,
        876
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    }
  ],
  "groups": [
    {
      "groupName": "Tier 2 - Grilled Fish & Clear Broths (Safest Choice)",
      "scoutItemIndices": [
        0,
        1,
        2,
        3,
        4,
        8,
        9,
        11,
        12,
        13,
        14,
        16,
        17,
        18,
        19,
        20,
        22,
        26,
        54
      ],
      "boundingBox2D": [
        200,
        70,
        930,
        480
      ],
      "verdict": {
        "label": "Best Choice: Grilled & Broths",
        "level": "good"
      },
      "comparisonSentence": "Grilled fish and clear broth dishes provide high lean protein and omega-3s with significantly lower trans-fats and sodium than fried noodles or seblak.",
      "message": "These grilled and simmered preparations offer lean fish and poultry proteins combined with wholesome cooking methods, avoiding heavy batter absorption. They support stable glycemic control and heart health better than fried or processed alternatives.",
      "averageNutrients": {
        "calories": 420,
        "protein": 30,
        "totalFat": 12,
        "saturatedFat": 3,
        "carbohydrates": 45,
        "sugar": 3,
        "sodium": 550
      },
      "orderingTip": "Opt for grilled fish or chicken without sweet soy glaze and request sambal on the side."
    },
    {
      "groupName": "Tier 3 - Fried Poultry, Fried Rice & Noodles (Moderate Caution)",
      "scoutItemIndices": [
        5,
        6,
        7,
        10,
        15,
        21,
        23,
        24,
        25,
        27,
        28,
        29,
        30,
        31,
        32,
        33,
        34,
        35,
        36,
        37,
        42,
        43,
        44,
        45,
        46,
        47,
        48,
        49,
        50,
        51,
        52,
        56,
        57
      ],
      "boundingBox2D": [
        200,
        480,
        999,
        999
      ],
      "verdict": {
        "label": "Moderate Caution: Fried & Noodles",
        "level": "warning"
      },
      "comparisonSentence": "Unlike grilled proteins, fried rice, battered items, and fried noodles introduce elevated saturated fats and refined carbohydrates.",
      "message": "Frequent consumption of deep-fried dishes and wok-fried noodles increases cardiovascular and metabolic strain due to high oil absorption, refined carbohydrates, and elevated sodium levels.",
      "averageNutrients": {
        "calories": 720,
        "protein": 24,
        "totalFat": 32,
        "saturatedFat": 9,
        "carbohydrates": 82,
        "sugar": 6,
        "sodium": 1150
      },
      "orderingTip": "Share portions or request less oil and salt when ordering fried rice or noodle dishes."
    },
    {
      "groupName": "Tier 4 - Seblak & Battered Seafood (Severe Metabolic Load)",
      "scoutItemIndices": [
        38,
        39,
        40,
        41,
        53,
        55,
        58
      ],
      "boundingBox2D": [
        500,
        640,
        970,
        990
      ],
      "verdict": {
        "label": "High Sodium & Oil Alert",
        "level": "alert"
      },
      "comparisonSentence": "Seblak and heavily battered deep-fried seafood carry extreme sodium, inflammatory oils, and refined starch loads compared to clean grilled options.",
      "message": "Seblak bowls and deep-fried battered squid combine heavy oil absorption with ultra-processed crackers, chili pastes, and high sodium additives, creating a severe metabolic load that spikes blood pressure and triglycerides.",
      "averageNutrients": {
        "calories": 680,
        "protein": 15,
        "totalFat": 38,
        "saturatedFat": 12,
        "carbohydrates": 65,
        "sugar": 8,
        "sodium": 1600
      },
      "orderingTip": "Avoid seblak and deep-fried battered dishes entirely if managing hypertension or metabolic syndrome."
    }
  ],
  "recommendedOption": "NILA BAKAR / GR + NASI"
}
```
- **Output:**
```json
{
  "_internalReasoning": "Extracted all visible menu items and categorized them into tiers based on cooking methods, protein quality, and metabolic load.",
  "comparisonTitle": "Restaurant Menu Metabolic Evaluation & Ranking",
  "comparisonType": "menu_items",
  "summary": "This menu evaluation ranks Indonesian grilled fish and chicken dishes against fried rice, seblak, and battered seafood. Grilled and clear broth preparations (Tier 2) offer superior metabolic stability compared to deep-fried items, heavy sweet-and-sour sauces, and processed noodles (Tiers 3 and 4).",
  "items": [
    {
      "name": "NILA BAKAR / GR + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        220,
        78,
        240,
        343
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "BAWAL BAKAR / GR + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        248,
        79,
        267,
        363
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "BANDENG BAKAR / GR + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        273,
        83,
        292,
        401
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "TONGKOL BAKAR / GR + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        298,
        83,
        317,
        404
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "CUE BAKAR / GR + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        323,
        88,
        342,
        338
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "GURAME BAKAR / GORENG + NASI",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        348,
        92,
        368,
        455
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "GURAME ASAM MANIS + NASI",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        374,
        93,
        393,
        406
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "GURAME VILET ASAM MANIS + NASI",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        397,
        95,
        417,
        475
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "IKAN QUE BAKAR / GR + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        421,
        95,
        440,
        410
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "BARONANG BAKAR / GR + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        444,
        99,
        463,
        422
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "IKAN BAWAL ASEM MANIS + NASI",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        468,
        103,
        487,
        451
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "IKAN NILA GARANG ASEM + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        492,
        103,
        510,
        453
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "AYAM GARANG ASEM + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        514,
        114,
        532,
        403
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "TONGKOL GARANG ASEM + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        534,
        115,
        553,
        447
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "GURAME GARANG ASEM + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        558,
        118,
        577,
        439
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "AYAM MERCON + NASI",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        583,
        119,
        600,
        348
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "TONGKOL SUIR PETE + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        606,
        122,
        622,
        409
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "TONGKOL SUIR JENGKOL + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        623,
        126,
        642,
        451
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "AYAM BAKAR + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        720,
        142,
        734,
        335
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "AYAM BAKAR SAMBEL",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        738,
        143,
        752,
        355
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "LAMPUNG + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        764,
        147,
        777,
        319
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "AYAM GORENG SAMBEL",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        778,
        146,
        793,
        381
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "LAMPUNG + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        801,
        150,
        814,
        318
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "AYAM ASAM MANIS + NASI",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        816,
        152,
        832,
        403
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "AYAM GORENG GEPREK",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        841,
        156,
        856,
        383
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "TEPUNG + NASI",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        862,
        160,
        874,
        309
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "AYAM BAKAR SAMBEL IJO + NASI",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        875,
        163,
        891,
        461
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "AYAM GORENG SAMBEL IJO + NASI",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        892,
        166,
        907,
        484
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "AYAM GORENG SAMBEL JUDES",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        912,
        167,
        928,
        448
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "NASI GORENG SEAFOOD",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        217,
        655,
        232,
        910
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "NASI GORENG SPESIAL",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        243,
        656,
        258,
        892
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "NASI GORENG PETE",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        268,
        657,
        283,
        856
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "NASI GORENG JENGKOL",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        294,
        657,
        308,
        903
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "NASI GORENG SOSIS",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        316,
        656,
        332,
        865
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "NASI GORENG BAKSO",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        340,
        657,
        356,
        878
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "NASI GORENG KORNET",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        365,
        656,
        381,
        890
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "NASI GORENG TELOR DADAR",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        386,
        657,
        401,
        953
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "NASI GORENG AYAM",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        413,
        656,
        428,
        868
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "SEBLAK COBEK VIRAL",
      "tier": 4,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        502,
        653,
        519,
        870
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "SEBLAK SEAFOOD",
      "tier": 4,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        530,
        655,
        545,
        834
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "SEBLAK CEKER",
      "tier": 4,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        555,
        655,
        569,
        804
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "CEKER MERCON",
      "tier": 4,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        577,
        655,
        592,
        801
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "MIE TEK - TEK KUAH",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        602,
        655,
        616,
        853
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "MIE TEK - TEK SOSIS",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        624,
        655,
        638,
        848
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "MIE TEK - TEK BAKSO",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        643,
        655,
        657,
        860
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "MIE TEK - TEK KORNET",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        662,
        655,
        676,
        878
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "MIE TEK - TEK SEAFOOD",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        680,
        655,
        696,
        883
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "KWETIAU GORENG BAKSO SOSIS",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        700,
        656,
        715,
        959
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "KWETIAU GORENG SEAFOOD",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        719,
        656,
        734,
        932
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "KWETIAU KUAH SOSIS BAKSO",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        737,
        656,
        752,
        926
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "KWETIAU SPECIAL",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        759,
        656,
        773,
        829
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "KWETIAU AYAM",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        778,
        657,
        792,
        831
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "MIE TEK - TEK SPECIAL",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        798,
        657,
        812,
        865
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "MIE TEK - TEK AYAM",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        816,
        657,
        830,
        840
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "SEAFOOD TUMPAH",
      "tier": 2,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        907,
        654,
        921,
        831
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "CUMI GORENG TEPUNG + NASI",
      "tier": 4,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        926,
        654,
        940,
        935
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "CUMI GORENG TEPUNG",
      "tier": 4,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        945,
        654,
        959,
        875
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "ASAM MANIS + NASI",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        964,
        653,
        978,
        868
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    },
    {
      "name": "CUMI SAOS ASAM MANIS",
      "tier": 3,
      "sourceImageIndex": 0,
      "boundingBox2D": [
        982,
        655,
        996,
        876
      ],
      "hasNutritionLabel": false,
      "brand": null,
      "perServing": null,
      "servingSize": null,
      "servingsPerPack": null
    }
  ],
  "groups": [
    {
      "groupName": "Tier 2 - Grilled Fish & Clear Broths (Safest Choice)",
      "scoutItemIndices": [
        0,
        1,
        2,
        3,
        4,
        8,
        9,
        11,
        12,
        13,
        14,
        16,
        17,
        18,
        19,
        20,
        22,
        26,
        54
      ],
      "boundingBox2D": [
        200,
        70,
        930,
        480
      ],
      "verdict": {
        "label": "Best Choice: Grilled & Broths",
        "level": "good"
      },
      "comparisonSentence": "Grilled fish and clear broth dishes provide high lean protein and omega-3s with significantly lower trans-fats and sodium than fried noodles or seblak.",
      "message": "These grilled and simmered preparations offer lean fish and poultry proteins combined with wholesome cooking methods, avoiding heavy batter absorption. They support stable glycemic control and heart health better than fried or processed alternatives.",
      "averageNutrients": {
        "calories": 420,
        "protein": 30,
        "totalFat": 12,
        "saturatedFat": 3,
        "carbohydrates": 45,
        "sugar": 3,
        "sodium": 550
      },
      "orderingTip": "Opt for grilled fish or chicken without sweet soy glaze and request sambal on the side."
    },
    {
      "groupName": "Tier 3 - Fried Poultry, Fried Rice & Noodles (Moderate Caution)",
      "scoutItemIndices": [
        5,
        6,
        7,
        10,
        15,
        21,
        23,
        24,
        25,
        27,
        28,
        29,
        30,
        31,
        32,
        33,
        34,
        35,
        36,
        37,
        42,
        43,
        44,
        45,
        46,
        47,
        48,
        49,
        50,
        51,
        52,
        56,
        57
      ],
      "boundingBox2D": [
        200,
        480,
        999,
        999
      ],
      "verdict": {
        "label": "Moderate Caution: Fried & Noodles",
        "level": "warning"
      },
      "comparisonSentence": "Unlike grilled proteins, fried rice, battered items, and fried noodles introduce elevated saturated fats and refined carbohydrates.",
      "message": "Frequent consumption of deep-fried dishes and wok-fried noodles increases cardiovascular and metabolic strain due to high oil absorption, refined carbohydrates, and elevated sodium levels.",
      "averageNutrients": {
        "calories": 720,
        "protein": 24,
        "totalFat": 32,
        "saturatedFat": 9,
        "carbohydrates": 82,
        "sugar": 6,
        "sodium": 1150
      },
      "orderingTip": "Share portions or request less oil and salt when ordering fried rice or noodle dishes."
    },
    {
      "groupName": "Tier 4 - Seblak & Battered Seafood (Severe Metabolic Load)",
      "scoutItemIndices": [
        38,
        39,
        40,
        41,
        53,
        55
      ],
      "boundingBox2D": [
        500,
        640,
        970,
        990
      ],
      "verdict": {
        "label": "High Sodium & Oil Alert",
        "level": "alert"
      },
      "comparisonSentence": "Seblak and heavily battered deep-fried seafood carry extreme sodium, inflammatory oils, and refined starch loads compared to clean grilled options.",
      "message": "Seblak bowls and deep-fried battered squid combine heavy oil absorption with ultra-processed crackers, chili pastes, and high sodium additives, creating a severe metabolic load that spikes blood pressure and triglycerides.",
      "averageNutrients": {
        "calories": 680,
        "protein": 15,
        "totalFat": 38,
        "saturatedFat": 12,
        "carbohydrates": 65,
        "sugar": 8,
        "sodium": 1600
      },
      "orderingTip": "Avoid seblak and deep-fried battered dishes entirely if managing hypertension or metabolic syndrome."
    }
  ],
  "recommendedOption": "NILA BAKAR / GR + NASI"
}
```
- **Signals:** model=gemini-3.5-flash-lite, latency_ms=19844, tokens=[object Object]
- **Parent:** job_compare_set5_1788895684133

## 🔗 Data Pipelines & Infrastructure Connectivity Matrix

| Pipeline Stage | Connectivity & Status | Details / Metrics |
|----------------|-----------------------|-------------------|
| **1. Triage & Front Desk** | ⚪ Skipped / Standby | Direct execution mode |
| **2. Vision Scout & OCR** | ✅ Connected (59 item(s) detected) | Type: product_item |
| **3. Biomarker Ingest & Mapping** | ⚪ Standby / N/A | No tabular lab panel |
| **4. Database Search & Truth Matching** | ⚪ Standby / N/A | Single-dispatch path: scout-direct ledger, no external fetch |
| **5. Mathematical Calculation Engine** | ⚪ Standby / N/A | No meal calculation required |
| **6. Trial-Balance & Quality Gate** | ⚪ Standby / N/A | N/A |
| **7. Health Coach / Clinical Engine** | ⚪ Standby / N/A | No clinical analysis requested |
| **8. State Storage & Job Sync** | ✅ Connected (Local / Active) | Job ID: `job_compare_set5_1788895684133` |

## 👤 Last User Action

- **Action:** submit_meal_job
- **Prompt/Text:** "Evaluate and analyze this product."
- **Timestamp:** 2026-09-08T19:28:23.978Z

## 🐾 User Action Breadcrumbs

| Timestamp | Action | Target / Context | Details |
|-----------|--------|------------------|---------|
|  | click | button | {"label":"Compare Foods / Menu","id":"compare-toggle-btn"} |
|  | select_photos | camera_roll | {"imageCount":1,"files":["set5_packaged_product_photo.jpg"]} |
|  | input_change | input | {"name":"compare-query-input","valueLength":34} |
|  | submit_initiated | chat_composer | {"prompt":"Evaluate and analyze this product.","imageCount":1,"submissionMode":"compare"} |
|  | submit_meal_job | chat_compose_dock | {"jobId":"job_compare_set5_1788895684133","promptLength":34,"imageCount":1,"submissionMode":"compare"} |

## ⚙️ Job Session Event Trail

_No job session event trail captured for this job._

## 🌐 Console & Network Diagnostics

_No client network errors or latency warnings recorded._

### Client Console Logs (2)
```
[INFO] Compare mode triggered with 1 images for job job_compare_set5_1788895684133
[INFO] Scout-Only Compare single-pass pipeline invoked for Set 5: Packaged Product Item.
```

## 🔍 Vision Scout Results (59 item(s) detected)

> **Scout Internal Reasoning:** Extracted all visible menu items and categorized them into tiers based on cooking methods, protein quality, and metabolic load.

**Dining Environment:** `supermarket_or_store` | **Content Type:** `product_item`

| # | Dish / Item | Weight | Bounding Box | Img | Method | Label / Sticker OCR | Constituent Ingredients |
|---|-------------|--------|--------------|-----|--------|---------------------|-------------------------|
| [1] | NILA BAKAR / GR + NASI | 50g | — | #0 | packaged | — | — |
| [2] | BAWAL BAKAR / GR + NASI | 50g | — | #0 | packaged | — | — |
| [3] | BANDENG BAKAR / GR + NASI | 50g | — | #0 | packaged | — | — |
| [4] | TONGKOL BAKAR / GR + NASI | 50g | — | #0 | packaged | — | — |
| [5] | CUE BAKAR / GR + NASI | 50g | — | #0 | packaged | — | — |
| [6] | GURAME BAKAR / GORENG + NASI | 50g | — | #0 | fried | — | — |
| [7] | GURAME ASAM MANIS + NASI | 50g | — | #0 | packaged | — | — |
| [8] | GURAME VILET ASAM MANIS + NASI | 50g | — | #0 | packaged | — | — |
| [9] | IKAN QUE BAKAR / GR + NASI | 50g | — | #0 | packaged | — | — |
| [10] | BARONANG BAKAR / GR + NASI | 50g | — | #0 | packaged | — | — |
| [11] | IKAN BAWAL ASEM MANIS + NASI | 50g | — | #0 | packaged | — | — |
| [12] | IKAN NILA GARANG ASEM + NASI | 50g | — | #0 | packaged | — | — |
| [13] | AYAM GARANG ASEM + NASI | 50g | — | #0 | packaged | — | — |
| [14] | TONGKOL GARANG ASEM + NASI | 50g | — | #0 | packaged | — | — |
| [15] | GURAME GARANG ASEM + NASI | 50g | — | #0 | packaged | — | — |
| [16] | AYAM MERCON + NASI | 50g | — | #0 | packaged | — | — |
| [17] | TONGKOL SUIR PETE + NASI | 50g | — | #0 | packaged | — | — |
| [18] | TONGKOL SUIR JENGKOL + NASI | 50g | — | #0 | packaged | — | — |
| [19] | AYAM BAKAR + NASI | 50g | — | #0 | packaged | — | — |
| [20] | AYAM BAKAR SAMBEL | 50g | — | #0 | packaged | — | — |
| [21] | LAMPUNG + NASI | 50g | — | #0 | packaged | — | — |
| [22] | AYAM GORENG SAMBEL | 50g | — | #0 | fried | — | — |
| [23] | LAMPUNG + NASI | 50g | — | #0 | packaged | — | — |
| [24] | AYAM ASAM MANIS + NASI | 50g | — | #0 | packaged | — | — |
| [25] | AYAM GORENG GEPREK | 50g | — | #0 | fried | — | — |
| [26] | TEPUNG + NASI | 50g | — | #0 | packaged | — | — |
| [27] | AYAM BAKAR SAMBEL IJO + NASI | 50g | — | #0 | packaged | — | — |
| [28] | AYAM GORENG SAMBEL IJO + NASI | 50g | — | #0 | fried | — | — |
| [29] | AYAM GORENG SAMBEL JUDES | 50g | — | #0 | fried | — | — |
| [30] | NASI GORENG SEAFOOD | 50g | — | #0 | fried | — | — |

## 📚 Database Search & Entity Resolution

- **Resolution Strategy:** Single-Dispatch Direct Nutrient Ledger
- **Status:** ⚪ Standby — nutritional truth resolved directly from Vision Scout dish-level macronutrients and pure TypeScript derivation (Post-Atwater / Dish Finalize) without secondary candidate database fetches.

## 💬 Agent Message & Narrative

### Restaurant Menu Metabolic Evaluation & Ranking

**Summary:** This menu evaluation ranks Indonesian grilled fish and chicken dishes against fried rice, seblak, and battered seafood. Grilled and clear broth preparations (Tier 2) offer superior metabolic stability compared to deep-fried items, heavy sweet-and-sour sauces, and processed noodles (Tiers 3 and 4).

**Recommended Option:** NILA BAKAR / GR + NASI

#### Comparison Groups & Verdicts

**Rank 1: Tier 2 - Grilled Fish & Clear Broths (Safest Choice)** [GOOD] — *Best Choice: Grilled & Broths*
- **Items Included (19):** NILA BAKAR / GR + NASI, BAWAL BAKAR / GR + NASI, BANDENG BAKAR / GR + NASI, TONGKOL BAKAR / GR + NASI, CUE BAKAR / GR + NASI, IKAN QUE BAKAR / GR + NASI, BARONANG BAKAR / GR + NASI, IKAN NILA GARANG ASEM + NASI, AYAM GARANG ASEM + NASI, TONGKOL GARANG ASEM + NASI, GURAME GARANG ASEM + NASI, TONGKOL SUIR PETE + NASI, TONGKOL SUIR JENGKOL + NASI, AYAM BAKAR + NASI, AYAM BAKAR SAMBEL, LAMPUNG + NASI, LAMPUNG + NASI, AYAM BAKAR SAMBEL IJO + NASI, SEAFOOD TUMPAH
- **Comparative Sentence:** "Grilled fish and clear broth dishes provide high lean protein and omega-3s with significantly lower trans-fats and sodium than fried noodles or seblak."
- **Clinical Guidance:** These grilled and simmered preparations offer lean fish and poultry proteins combined with wholesome cooking methods, avoiding heavy batter absorption. They support stable glycemic control and heart health better than fried or processed alternatives.
- **Ordering Tip:** Opt for grilled fish or chicken without sweet soy glaze and request sambal on the side.
- **Nutrient Profile:** 420 kcal | P: 30g | C: 45g | F: 12g | Saturated Fat: 3g | Sodium: 550mg | Sugar: 3g

**Rank 2: Tier 3 - Fried Poultry, Fried Rice & Noodles (Moderate Caution)** [WARNING] — *Moderate Caution: Fried & Noodles*
- **Items Included (33):** GURAME BAKAR / GORENG + NASI, GURAME ASAM MANIS + NASI, GURAME VILET ASAM MANIS + NASI, IKAN BAWAL ASEM MANIS + NASI, AYAM MERCON + NASI, AYAM GORENG SAMBEL, AYAM ASAM MANIS + NASI, AYAM GORENG GEPREK, TEPUNG + NASI, AYAM GORENG SAMBEL IJO + NASI, AYAM GORENG SAMBEL JUDES, NASI GORENG SEAFOOD, NASI GORENG SPESIAL, NASI GORENG PETE, NASI GORENG JENGKOL, NASI GORENG SOSIS, NASI GORENG BAKSO, NASI GORENG KORNET, NASI GORENG TELOR DADAR, NASI GORENG AYAM, MIE TEK - TEK KUAH, MIE TEK - TEK SOSIS, MIE TEK - TEK BAKSO, MIE TEK - TEK KORNET, MIE TEK - TEK SEAFOOD, KWETIAU GORENG BAKSO SOSIS, KWETIAU GORENG SEAFOOD, KWETIAU KUAH SOSIS BAKSO, KWETIAU SPECIAL, KWETIAU AYAM, MIE TEK - TEK SPECIAL, CUMI GORENG TEPUNG, ASAM MANIS + NASI
- **Comparative Sentence:** "Unlike grilled proteins, fried rice, battered items, and fried noodles introduce elevated saturated fats and refined carbohydrates."
- **Clinical Guidance:** Frequent consumption of deep-fried dishes and wok-fried noodles increases cardiovascular and metabolic strain due to high oil absorption, refined carbohydrates, and elevated sodium levels.
- **Ordering Tip:** Share portions or request less oil and salt when ordering fried rice or noodle dishes.
- **Nutrient Profile:** 720 kcal | P: 24g | C: 82g | F: 32g | Saturated Fat: 9g | Sodium: 1150mg | Sugar: 6g

**Rank 3: Tier 4 - Seblak & Battered Seafood (Severe Metabolic Load)** [ALERT] — *High Sodium & Oil Alert*
- **Items Included (7):** SEBLAK COBEK VIRAL, SEBLAK SEAFOOD, SEBLAK CEKER, CEKER MERCON, MIE TEK - TEK AYAM, CUMI GORENG TEPUNG + NASI, CUMI SAOS ASAM MANIS
- **Comparative Sentence:** "Seblak and heavily battered deep-fried seafood carry extreme sodium, inflammatory oils, and refined starch loads compared to clean grilled options."
- **Clinical Guidance:** Seblak bowls and deep-fried battered squid combine heavy oil absorption with ultra-processed crackers, chili pastes, and high sodium additives, creating a severe metabolic load that spikes blood pressure and triglycerides.
- **Ordering Tip:** Avoid seblak and deep-fried battered dishes entirely if managing hypertension or metabolic syndrome.
- **Nutrient Profile:** 680 kcal | P: 15g | C: 65g | F: 38g | Saturated Fat: 12g | Sodium: 1600mg | Sugar: 8g


## ⚙️ Pipeline Stage Ledger

| Stage | Status | Attempt | Key Decisions | Errors |
|-------|--------|---------|---------------|--------|
| Vision Scout & Comparison Extraction | success | 1 | SinglePassArchitecture, GroupOrdering, ComparativeSentences | — |

## ⚠️ Errors & Warnings

_No thrown exceptions or log errors/warnings captured._

## 🖥️ Backend Execution Logs

```
[backend] [job_compare_set5_1788895684133] Compare request received with 1 images. Mode: compare.
[scout_only_compare] Dispatched to gemini-3.5-flash-lite with single-pass instruction.
[scout_only_compare] Latency: 19844ms. Usage: 4608 in / 7572 out tokens.
[scout_only_compare] Extracted 59 items into 3 ranked groups.
[scout_only_compare] Status: SUCCESS. Finalized compare payload.
```

---
_Generated by Health Tracker debug export. Images are omitted to prevent bloat._
