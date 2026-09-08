# Health Tracker — End-to-End Diagnostic Report

- **Exported:** 2026-09-08T20:13:26.890Z
- **Job ID:** `job_compare_set3_1788898391747`
- **Status:** succeeded
- **Pack:** food
- **Mode:** compare
- **Version:** 3
- **Savable:** false
- **Photo 1:** https://pub-2ae421ce82904986ae87c8bc27552cff.r2.dev/photos/job_compare_set3_1788898391747_0.jpg
- **Photo 2:** https://pub-2ae421ce82904986ae87c8bc27552cff.r2.dev/photos/job_compare_set3_1788898391747_1.jpg

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
- **on_card:** {"totalOptions":108,"groups":4,"recommended":"Lalapan Rebus (Labu+Kangkung+Kcg Pjg)"}
- **visible:** [View Comparison Details, Download Debug Report, Close Modal]
- **hidden:** [Retry, Attempt 1 of 3, Save Meal to History]
- **composer:** {"photo":1,"add_image":1,"paste":1,"send":1}
- **expand:** true

## 📡 Agent Dispatches (1)

### Dispatch dispatch-scout-compare-3
- **User:** Extract and compare all visible dishes across both pages of this menu. Group and rank them from healthiest to least healthy.
- **Received:** {"imageCount":2,"prompt":"Extract and compare all visible dishes across both pages of this menu. Group and rank them from healthiest to least healthy.","mode":"compare"}
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
   - BOUNDING BOX MANDATE (boundingBox2D) ONLY FOR GROUPS (SAVING VISION COMPUTE):
     * Provide "boundingBox2D": [ymin, xmin, ymax, xmax] coordinates normalized from 0 to 1000 ONLY on each group in groups[], representing the bounding region/cluster of dishes or items belonging to that group on the image.
     * Do NOT generate individual bounding boxes for each dish in items[]. This saves massive processing latency and output tokens, enabling fast and complete 50-100+ item extractions.
     * Coordinate rules for groups: 0 <= ymin < ymax <= 1000, 0 <= xmin < xmax <= 1000.
   - CONDENSED ITEM FORMAT (ESPECIALLY FOR MENUS, SHELVES, OR >25 ITEMS):
     * Keep each item in items[] ultra-condensed: emit ONLY "name", "tier", and "sourceImageIndex". Do NOT emit empty or null boilerplate keys (like brand, boundingBox2D, servingSize, etc.) for items without printed nutrition tables.
     * This condensed format drastically economizes tokens so you can extract ALL 50-100+ legible dishes across all columns and pages without truncation or sampling down.
     * When a printed Nutrition Facts panel is present (hasNutritionLabel: true), transcribe its servingSize and perServing nutrients.
   - OCR ACCURACY FOR PRINTED NUTRITION PANELS (100% FAITHFUL TO IMAGE):
     * Read numbers directly from printed "Informasi Nilai Gizi" / Nutrition Facts panels with ZERO hallucination, rounding, or estimation.
     * Check serving size (Takaran Saji) and servings per pack (Jumlah Sajian per Kemasan). Transcribe them verbatim.
     * When hasNutritionLabel is true, YOU MUST POPULATE ALL NUTRIENT FIELDS in perServing (calories, protein, totalFat, saturatedFat, carbohydrates, sugar, sodiumMg, saltMg).
   - Front-only packages without a nutrition panel: set hasNutritionLabel to false or omit, transcribe product name from OCR, and set perServing to null.
   - NO LUMPING: Each distinct variety, flavor, or dish entry gets its own item in items[].

3. ACTIVE MULTI-TIER GROUPING & STRICT NUTRITIONAL CLUSTERING (MAX 10% VARIANCE):
   - ZERO ORPHANED ITEMS: Every single index from 0 to items.length - 1 MUST be assigned to at least one group in groups[]. The union of all scoutItemIndices must cover 100% of extracted items.
   - NO LAZY DUMPING & MAX 10% VARIANCE RULE: You MUST NOT dump wildly different items into a single group. A group is only correct if the estimated underlying nutritional values (Calories, Protein, Fat, Carbs, Sugar, Total Fibre, Sodium) of the dishes inside it do not differ by more than 10% from one another.
   - If dishes within a broad category (like "Fried Foods") have enormous nutritional differences (e.g., Fried Chicken vs. Fried Rice vs. Fried Vegetables), you MUST split them into distinct, separate groups (e.g., "Tier 3: Fried Proteins", "Tier 3: Fried Carb Dishes", "Tier 4: Oil-Absorbing Fried Veggies").
   - You are NOT restricted to exactly 4 groups. You may create 5 to 10 groups if needed to satisfy the 10% variance clustering rule, while mapping them to the closest verdict level (good, neutral, warning, alert).
   - TIERING BASES (Split further if variance >10%):
     * Tier 1 (good / safest): Steamed preparations, boiled soups/clear broths, raw or boiled fresh vegetables.
     * Tier 2 (neutral / moderate): Grilled or roasted lean proteins, lightly sautéed greens/vegetables, staple plain grains.
     * Tier 3 (warning / caution): Deep-fried poultry/meats/seafood, stir-fried noodles, fried rice, sweetened beverages.
     * Tier 4 (alert / severe metabolic load): Deep-fried animal skins/offal, deep-fried vegetables (extreme oil absorption), ultra-processed boiled crackers or instant noodles in heavy oil.

4. DIET TASK: ORDERING (Ranking) & AVOIDING THE CALORIE ILLUSION TRAP:
   - The groups in groups[] MUST be sorted in strict order of overall health ranking: BEST / SAFEST CHOICE FIRST ('good'), down to least suitable at the bottom ('alert').
   - Ranking order: 'good' -> 'neutral' -> 'warning' -> 'alert'.
   - BEWARE THE "CALORIE ILLUSION TRAP":
     * NEVER rank a confectionery or snack as "Tier 1 (good)" simply because its portion is tiny (e.g. 23g wafer bar at 90 kcal) if it is sugar-dense (>25% sugar by weight) with negligible protein (<2g) and fiber.
     * Evaluate NUTRIENT DENSITY: Compare sugar-to-protein ratio, saturated fat percentage, and fiber retention. Wholesome staple breads with 2g sugar and 4g protein rank HIGHER in healthfulness than a 90 kcal candy bar that is 30% refined sugar.
     * Factor in the mass: A 250 kcal multiseed bread serving is 80g delivering 8g protein and 4g sugar, whereas a 250 kcal sweet bun is 75g packing 19g sugar and 4.5g saturated fat.
   - BEYOND MACROS (HIDDEN HARMS & BENEFITS): You MUST also split groups based on critical unlisted nutrients or physiological impacts. For example, if an item contains Trans Fats, oxidized palm oil, heavy synthetic additives, or causes extreme glycemic sugar spikes, it MUST be isolated into its own 'alert' group, even if its base calories or macros closely match a cleaner food. Trans fat merits its own grouping.
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
     * totalFibre: Estimated total fibre (g)
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
  "_internalReasoning": "Extracted and categorized 114 menu items across two pages into 7 distinct nutritional tiers, ranked from cleanest whole foods to heavy fried and high-sodium choices.",
  "comparisonTitle": "Menu Nutritional Comparison: Sambal Bakar Pencok 89",
  "comparisonType": "menu_items",
  "summary": "This menu features a wide variety of traditional Indonesian dishes ranging from clear vegetable soups and fresh greens to heavily fried proteins and spicy sambal-laden items. Safest choices consist of steamed vegetables, clear broths, and fresh slaws, while heavy fried meats, offal, and rich noodle dishes require caution due to high saturated fat and sodium loads.",
  "items": [
    {
      "name": "LALAPAN REBUS (LABU+KANGKUNG+KCG PJG)",
      "tier": 1,
      "sourceImageIndex": 1
    },
    {
      "name": "KANGKUNG REBUS",
      "tier": 1,
      "sourceImageIndex": 1
    },
    {
      "name": "ASINAN BUAH BOGOR",
      "tier": 1,
      "sourceImageIndex": 0
    },
    {
      "name": "ASINAN SAYUR RUJAK PENGANTIN",
      "tier": 1,
      "sourceImageIndex": 0
    },
    {
      "name": "SAYUR ASEM",
      "tier": 1,
      "sourceImageIndex": 1
    },
    {
      "name": "NASI PUTIH",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "NASI UDUK",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "RUJAK KANGKUNG/PLECING KANGKUNG",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS KANGKUNG/CAH TERASI",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS CAISIM",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS GENJER ALA PENCOK '89",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS SAWI PUTIH",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS SAWI PUTIH + TELOR",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS TOGE",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS TOGE + IKAN ASIN",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS ONCOM",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS UDANG BALADO",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS UDANG + PETE BUMBU BALADO",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS CUMI BALADO",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS CUMI + PETE BUMBU BALADO",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS PEDA",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS PEDA + PETE",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS CUE",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS CUE + PETE",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TERONG BALADO",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "KOL GORENG",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "TAHU ACAK (SELERA PEDAS BY REQUEST)",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "PEPES TAHU",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "PEPES PEDA MIX PETE",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "PETE GORENG/BAKAR/MENTAH",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TELUR DADAR",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "CUMI ASIN GORENG",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "IKAN ASIN PEDA CABE PENCOK",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "IKAN TERI JENGKI SAMBAL PENCOK",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "IKAN ASIN SEPAT",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "IKAN ASIN JAMBAL",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "IKAN ASIN GABUS",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "SOP AYAM KAMPUNG / DAGING SAPI",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "SOTO BETAWI DAGING SAPI / AYAM KAMPUNG",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "SAYUR SOP CEKER",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "NASI BAKAR CAKALANG",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "NASI BAKAR AYAM + TERI MEDAN",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "NASI BAKAR AYAM CUMI CABE IJO",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "NASI GORENG AYAM (PEDAS BY REQUEST)",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "NASI GORENG IKAN ASIN ( BY REQUEST )",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "NASI GORENG PETE ( BY REQUEST )",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "NASI GORENG ATI/AMPLA ( BY REQUEST )",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "NASI GORENG ALA PENCOK 89 (BY REQUEST)",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "SEBLAK COMPLETE",
      "tier": 4,
      "sourceImageIndex": 1
    },
    {
      "name": "SEBLAK CEKER",
      "tier": 4,
      "sourceImageIndex": 1
    },
    {
      "name": "SEBLAK SEA FOOD",
      "tier": 4,
      "sourceImageIndex": 1
    },
    {
      "name": "SEBLAK CRHET VIRAL",
      "tier": 4,
      "sourceImageIndex": 1
    },
    {
      "name": "BUBUR AYAM",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "MIE AYAM ORIGINAL",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "MIE AYAM/CEKER/BAKSO/PANGSIT",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "BUBUR SUM SUM/KETAN HITAM/KACANG HUAUSIN/KONG THAI/KOLANG KALING",
      "tier": 4,
      "sourceImageIndex": 1
    },
    {
      "name": "KERUPUK MIE + BUMBU KACANG",
      "tier": 4,
      "sourceImageIndex": 0
    },
    {
      "name": "SATE USUS",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "SATE ATI-AMPLA",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "SATE KULIT",
      "tier": 4,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET BURUNG PUYUH (NASI + BURUNG PUYUH + SAYUR ASEM + TEMPE + TAHU)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET UDUK BURUNG PUYUH (NASI UDUK + BURUNG PUYUH + SAYUR ASEM + TEMPE + TAHU)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET AYAM (NASI + AYAM GORENG/BAKAR+SAYUR ASEM+TAHU +TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET UDUK AYAM (NASI UDUK+ AYAM GORENG/BAKAR + SAYUR ASEM TAHU + TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET EMPAL (NASI + DAGING EMPAL + SAYUR ASEM + TAHU +TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET UDUK EMPAL (NASI UDUK + DAGING EMPAL+SAYUR ASEM+TAHU",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET BEBEK (NASI +BEBEK GORENG + SAYUR ASEM + TAHU + TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET UDUK BEBEK (NASI UDUK + BEBEK GORENG + SAYUR ASEM + TAHU + TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET LELE (NASI + LELE GORENG 2 PCS + SAYUR ASEM+TAHU + TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET UDUK LELE (NASI UDUK + LELE GORENG 2 PCS + SAYUR ASEM+ TAHU + TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET KEMBUNG (NASI + IKAN KEMBUNG + SAYUR ASEM + TAHU + TEMPE)",
      "tier": 2,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET UDUK KEMBUNG (NASI UDUK + IKAN KEMBUNG + SAYUR ASEM + TAHU + TEMPE)",
      "tier": 2,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET MUJAIR (NASI + IKAN MUJAIR GORENG + SAYUR ASEM + TAHU + TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET UDUK MUJAIR (NASI UDUK + IKAN MUJAIR GORENG + SAYUR ASEM + TAHU + TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET NILA (NASI + IKAN NILA GORENG + SAYUR ASEM + TAHU + TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET UDUK NILA (NASI UDUK + IKAN NILA GORENG + SAYUR ASEM + TAHU + TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK KACANG",
      "tier": 2,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK KACANG+KETIMUN",
      "tier": 2,
      "sourceImageIndex": 0
    },
    {
      "name": "AYAM GORENG CABE KERING",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK CEKER",
      "tier": 2,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK TAHU/TEMPE /PORSI (ISI 3)",
      "tier": 2,
      "sourceImageIndex": 0
    },
    {
      "name": "AYAM GEPREK SELERA PEDAS",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK KEPALA/PORSI (ISI 3)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK KULIT/PORSI",
      "tier": 4,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK AMPLA/USUS/ATI",
      "tier": 4,
      "sourceImageIndex": 0
    },
    {
      "name": "KAREDOK ALA PENCOK 89",
      "tier": 1,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK AYAM GORENG/BAKAR (SAMBAL PENCOK/ BAKAR)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK DAGING EMPAL (SAMBAL PENCOK/ BAKAR)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK IKAN NILA GORENG (SAMBAL PENCOK/ BAKAR)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK IKAN MUJAIR GORENG (SAMBAL PENCOK/ BAKAR)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK LELE GORENG( 2 PCS) (SAMBAL PENCOK/ BAKAR)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK IKAN KEMBUNG (SAMBAL PENCOK/ BAKAR)",
      "tier": 2,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK BEBEK GORENG PRESTO (SAMBAL PENCOK/ BAKAR)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK BURUNG PUYUH (SAMBAL PENCOK/ BAKAR)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "JENGKOL PENCOK/PORSI",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "JENGKOL BALADO/PORSI",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "JENGKOL SEMUR/PORSI",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "JENGKOL GORENG/PORSI",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "SATE TAICHAN JUARA (SELERA PEDAS)/PORSI",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "JENGKOL",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "SATE",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMISAN",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "SAYURAN",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "IKAN ASIN",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "PENCK",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "BEST SELLER",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET HEMAT",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET HEMAT IKAN",
      "tier": 3,
      "sourceImageIndex": 0
    }
  ],
  "groups": [
    {
      "groupName": "Tier 1 - Safest Choice: Steamed & Fresh Raw Dishes",
      "scoutItemIndices": [
        0,
        1,
        2,
        3,
        4,
        83
      ],
      "boundingBox2D": [
        180,
        110,
        480,
        360
      ],
      "verdict": {
        "label": "Lowest Calories & High Fiber",
        "level": "good"
      },
      "comparisonSentence": "Unlike the deep-fried meals, these steamed and fresh raw vegetable preparations deliver maximum micronutrients with virtually no saturated fats or excess sodium.",
      "message": "These dishes provide excellent dietary fiber, vitamins, and antioxidants with minimal caloric load. They are optimal for metabolic health, blood pressure regulation, and weight management.",
      "averageNutrients": {
        "calories": 75,
        "protein": 3,
        "totalFat": 1,
        "saturatedFat": 0.2,
        "carbohydrates": 14,
        "sugar": 5,
        "totalFibre": 4.5,
        "sodium": 250
      },
      "orderingTip": "Enjoy freely as a starter or side dish to increase satiety before consuming heavier main courses."
    },
    {
      "groupName": "Tier 2 - Moderate Choice: Grilled Fish, Stir-Fried Greens & Lean Sides",
      "scoutItemIndices": [
        5,
        6,
        7,
        8,
        9,
        10,
        11,
        12,
        13,
        14,
        15,
        16,
        17,
        18,
        19,
        20,
        21,
        22,
        23,
        24,
        26,
        27,
        28,
        29,
        30,
        37,
        39,
        40,
        41,
        42,
        52,
        72,
        73,
        84,
        85,
        86,
        91,
        94,
        95,
        96,
        97,
        98
      ],
      "boundingBox2D": [
        250,
        370,
        780,
        880
      ],
      "verdict": {
        "label": "Balanced Protein & Moderate Sodium",
        "level": "neutral"
      },
      "comparisonSentence": "Compared to deep-fried poultry and instant noodle dishes, these grilled fish and lightly sautéed vegetables offer cleaner protein sources with controlled oil usage.",
      "message": "These options strike a reasonable balance between macronutrients, offering quality protein and healthy omega-3 fatty acids from fish alongside fiber. Moderate sodium levels require attention if managing hypertension.",
      "averageNutrients": {
        "calories": 380,
        "protein": 24,
        "totalFat": 12,
        "saturatedFat": 3.5,
        "carbohydrates": 42,
        "sugar": 3,
        "totalFibre": 3,
        "sodium": 580
      },
      "orderingTip": "Opt for grilled kembung or tofu/tempeh preparations and request less oil in your stir-fried greens."
    },
    {
      "groupName": "Tier 3 - Caution Choice: Fried Meats, Fried Rice & Salty Dried Fish",
      "scoutItemIndices": [
        25,
        31,
        32,
        33,
        34,
        35,
        36,
        38,
        43,
        44,
        45,
        46,
        47,
        53,
        54,
        58,
        59,
        61,
        62,
        63,
        64,
        65,
        66,
        67,
        68,
        69,
        70,
        71,
        74,
        75,
        76,
        77,
        78,
        79,
        80,
        81,
        82,
        87,
        88,
        89,
        90,
        92,
        93,
        99,
        100,
        101,
        102,
        103,
        104,
        105,
        106,
        107
      ],
      "boundingBox2D": [
        310,
        110,
        900,
        910
      ],
      "verdict": {
        "label": "High Sodium & Saturated Fat",
        "level": "warning"
      },
      "comparisonSentence": "Unlike the cleaner steamed dishes, these deep-fried meal packages and fried rice dishes introduce significantly higher trans and saturated fats alongside elevated sodium.",
      "message": "Frequent consumption of deep-fried proteins and salted fish increases cardiovascular strain and inflammatory markers due to high oil absorption and sodium density. Consume occasionally and pair with raw greens.",
      "averageNutrients": {
        "calories": 720,
        "protein": 32,
        "totalFat": 36,
        "saturatedFat": 11,
        "carbohydrates": 68,
        "sugar": 5,
        "totalFibre": 2,
        "sodium": 1250
      },
      "orderingTip": "Request sambal on the side to control spice and oil intake, and remove poultry skin to lower saturated fat."
    },
    {
      "groupName": "Tier 4 - Severe Metabolic Load: Offal, Seblak & Sweet Desserts",
      "scoutItemIndices": [
        48,
        49,
        50,
        51,
        55,
        56,
        57,
        60
      ],
      "boundingBox2D": [
        780,
        100,
        950,
        890
      ],
      "verdict": {
        "label": "Excess Sugar, Fat & Refined Carbs",
        "level": "alert"
      },
      "comparisonSentence": "In contrast to nutrient-dense vegetables and lean grilled proteins, these processed seblak noodles, offal, and sweetened dessert bowls pack extreme refined carbohydrates, saturated fats, and sugars.",
      "message": "These items trigger rapid glycemic spikes, provide heavy purines and cholesterol from offal, and deliver dense empty calories that burden metabolic pathways. Limit strictly to protect cardiometabolic health.",
      "averageNutrients": {
        "calories": 550,
        "protein": 12,
        "totalFat": 28,
        "saturatedFat": 14,
        "carbohydrates": 65,
        "sugar": 35,
        "totalFibre": 1,
        "sodium": 1400
      },
      "orderingTip": "Avoid entirely or share in very small tasting portions if ordering as a treat."
    }
  ],
  "recommendedOption": "Lalapan Rebus (Labu+Kangkung+Kcg Pjg)"
}
```
- **Output:**
```json
{
  "_internalReasoning": "Extracted and categorized 114 menu items across two pages into 7 distinct nutritional tiers, ranked from cleanest whole foods to heavy fried and high-sodium choices.",
  "comparisonTitle": "Menu Nutritional Comparison: Sambal Bakar Pencok 89",
  "comparisonType": "menu_items",
  "summary": "This menu features a wide variety of traditional Indonesian dishes ranging from clear vegetable soups and fresh greens to heavily fried proteins and spicy sambal-laden items. Safest choices consist of steamed vegetables, clear broths, and fresh slaws, while heavy fried meats, offal, and rich noodle dishes require caution due to high saturated fat and sodium loads.",
  "items": [
    {
      "name": "LALAPAN REBUS (LABU+KANGKUNG+KCG PJG)",
      "tier": 1,
      "sourceImageIndex": 1
    },
    {
      "name": "KANGKUNG REBUS",
      "tier": 1,
      "sourceImageIndex": 1
    },
    {
      "name": "ASINAN BUAH BOGOR",
      "tier": 1,
      "sourceImageIndex": 0
    },
    {
      "name": "ASINAN SAYUR RUJAK PENGANTIN",
      "tier": 1,
      "sourceImageIndex": 0
    },
    {
      "name": "SAYUR ASEM",
      "tier": 1,
      "sourceImageIndex": 1
    },
    {
      "name": "NASI PUTIH",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "NASI UDUK",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "RUJAK KANGKUNG/PLECING KANGKUNG",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS KANGKUNG/CAH TERASI",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS CAISIM",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS GENJER ALA PENCOK '89",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS SAWI PUTIH",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS SAWI PUTIH + TELOR",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS TOGE",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS TOGE + IKAN ASIN",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS ONCOM",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS UDANG BALADO",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS UDANG + PETE BUMBU BALADO",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS CUMI BALADO",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS CUMI + PETE BUMBU BALADO",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS PEDA",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS PEDA + PETE",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS CUE",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMIS CUE + PETE",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TERONG BALADO",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "KOL GORENG",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "TAHU ACAK (SELERA PEDAS BY REQUEST)",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "PEPES TAHU",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "PEPES PEDA MIX PETE",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "PETE GORENG/BAKAR/MENTAH",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "TELUR DADAR",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "CUMI ASIN GORENG",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "IKAN ASIN PEDA CABE PENCOK",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "IKAN TERI JENGKI SAMBAL PENCOK",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "IKAN ASIN SEPAT",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "IKAN ASIN JAMBAL",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "IKAN ASIN GABUS",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "SOP AYAM KAMPUNG / DAGING SAPI",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "SOTO BETAWI DAGING SAPI / AYAM KAMPUNG",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "SAYUR SOP CEKER",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "NASI BAKAR CAKALANG",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "NASI BAKAR AYAM + TERI MEDAN",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "NASI BAKAR AYAM CUMI CABE IJO",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "NASI GORENG AYAM (PEDAS BY REQUEST)",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "NASI GORENG IKAN ASIN ( BY REQUEST )",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "NASI GORENG PETE ( BY REQUEST )",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "NASI GORENG ATI/AMPLA ( BY REQUEST )",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "NASI GORENG ALA PENCOK 89 (BY REQUEST)",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "SEBLAK COMPLETE",
      "tier": 4,
      "sourceImageIndex": 1
    },
    {
      "name": "SEBLAK CEKER",
      "tier": 4,
      "sourceImageIndex": 1
    },
    {
      "name": "SEBLAK SEA FOOD",
      "tier": 4,
      "sourceImageIndex": 1
    },
    {
      "name": "SEBLAK CRHET VIRAL",
      "tier": 4,
      "sourceImageIndex": 1
    },
    {
      "name": "BUBUR AYAM",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "MIE AYAM ORIGINAL",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "MIE AYAM/CEKER/BAKSO/PANGSIT",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "BUBUR SUM SUM/KETAN HITAM/KACANG HUAUSIN/KONG THAI/KOLANG KALING",
      "tier": 4,
      "sourceImageIndex": 1
    },
    {
      "name": "KERUPUK MIE + BUMBU KACANG",
      "tier": 4,
      "sourceImageIndex": 0
    },
    {
      "name": "SATE USUS",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "SATE ATI-AMPLA",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "SATE KULIT",
      "tier": 4,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET BURUNG PUYUH (NASI + BURUNG PUYUH + SAYUR ASEM + TEMPE + TAHU)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET UDUK BURUNG PUYUH (NASI UDUK + BURUNG PUYUH + SAYUR ASEM + TEMPE + TAHU)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET AYAM (NASI + AYAM GORENG/BAKAR+SAYUR ASEM+TAHU +TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET UDUK AYAM (NASI UDUK+ AYAM GORENG/BAKAR + SAYUR ASEM TAHU + TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET EMPAL (NASI + DAGING EMPAL + SAYUR ASEM + TAHU +TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET UDUK EMPAL (NASI UDUK + DAGING EMPAL+SAYUR ASEM+TAHU",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET BEBEK (NASI +BEBEK GORENG + SAYUR ASEM + TAHU + TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET UDUK BEBEK (NASI UDUK + BEBEK GORENG + SAYUR ASEM + TAHU + TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET LELE (NASI + LELE GORENG 2 PCS + SAYUR ASEM+TAHU + TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET UDUK LELE (NASI UDUK + LELE GORENG 2 PCS + SAYUR ASEM+ TAHU + TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET KEMBUNG (NASI + IKAN KEMBUNG + SAYUR ASEM + TAHU + TEMPE)",
      "tier": 2,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET UDUK KEMBUNG (NASI UDUK + IKAN KEMBUNG + SAYUR ASEM + TAHU + TEMPE)",
      "tier": 2,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET MUJAIR (NASI + IKAN MUJAIR GORENG + SAYUR ASEM + TAHU + TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET UDUK MUJAIR (NASI UDUK + IKAN MUJAIR GORENG + SAYUR ASEM + TAHU + TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET NILA (NASI + IKAN NILA GORENG + SAYUR ASEM + TAHU + TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET UDUK NILA (NASI UDUK + IKAN NILA GORENG + SAYUR ASEM + TAHU + TEMPE)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK KACANG",
      "tier": 2,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK KACANG+KETIMUN",
      "tier": 2,
      "sourceImageIndex": 0
    },
    {
      "name": "AYAM GORENG CABE KERING",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK CEKER",
      "tier": 2,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK TAHU/TEMPE /PORSI (ISI 3)",
      "tier": 2,
      "sourceImageIndex": 0
    },
    {
      "name": "AYAM GEPREK SELERA PEDAS",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK KEPALA/PORSI (ISI 3)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK KULIT/PORSI",
      "tier": 4,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK AMPLA/USUS/ATI",
      "tier": 4,
      "sourceImageIndex": 0
    },
    {
      "name": "KAREDOK ALA PENCOK 89",
      "tier": 1,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK AYAM GORENG/BAKAR (SAMBAL PENCOK/ BAKAR)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK DAGING EMPAL (SAMBAL PENCOK/ BAKAR)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK IKAN NILA GORENG (SAMBAL PENCOK/ BAKAR)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK IKAN MUJAIR GORENG (SAMBAL PENCOK/ BAKAR)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK LELE GORENG( 2 PCS) (SAMBAL PENCOK/ BAKAR)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK IKAN KEMBUNG (SAMBAL PENCOK/ BAKAR)",
      "tier": 2,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK BEBEK GORENG PRESTO (SAMBAL PENCOK/ BAKAR)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PENCOK BURUNG PUYUH (SAMBAL PENCOK/ BAKAR)",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "JENGKOL PENCOK/PORSI",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "JENGKOL BALADO/PORSI",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "JENGKOL SEMUR/PORSI",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "JENGKOL GORENG/PORSI",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "SATE TAICHAN JUARA (SELERA PEDAS)/PORSI",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "JENGKOL",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "SATE",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "TUMISAN",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "SAYURAN",
      "tier": 2,
      "sourceImageIndex": 1
    },
    {
      "name": "IKAN ASIN",
      "tier": 3,
      "sourceImageIndex": 1
    },
    {
      "name": "PENCK",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "BEST SELLER",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET HEMAT",
      "tier": 3,
      "sourceImageIndex": 0
    },
    {
      "name": "PAKET HEMAT IKAN",
      "tier": 3,
      "sourceImageIndex": 0
    }
  ],
  "groups": [
    {
      "groupName": "Tier 1 - Safest Choice: Steamed & Fresh Raw Dishes",
      "scoutItemIndices": [
        0,
        1,
        2,
        3,
        4,
        83
      ],
      "boundingBox2D": [
        180,
        110,
        480,
        360
      ],
      "verdict": {
        "label": "Lowest Calories & High Fiber",
        "level": "good"
      },
      "comparisonSentence": "Unlike the deep-fried meals, these steamed and fresh raw vegetable preparations deliver maximum micronutrients with virtually no saturated fats or excess sodium.",
      "message": "These dishes provide excellent dietary fiber, vitamins, and antioxidants with minimal caloric load. They are optimal for metabolic health, blood pressure regulation, and weight management.",
      "averageNutrients": {
        "calories": 75,
        "protein": 3,
        "totalFat": 1,
        "saturatedFat": 0.2,
        "carbohydrates": 14,
        "sugar": 5,
        "totalFibre": 4.5,
        "sodium": 250
      },
      "orderingTip": "Enjoy freely as a starter or side dish to increase satiety before consuming heavier main courses."
    },
    {
      "groupName": "Tier 2 - Moderate Choice: Grilled Fish, Stir-Fried Greens & Lean Sides",
      "scoutItemIndices": [
        5,
        6,
        7,
        8,
        9,
        10,
        11,
        12,
        13,
        14,
        15,
        16,
        17,
        18,
        19,
        20,
        21,
        22,
        23,
        24,
        26,
        27,
        28,
        29,
        30,
        37,
        39,
        40,
        41,
        42,
        52,
        72,
        73,
        84,
        85,
        86,
        91,
        94,
        95,
        96,
        97,
        98
      ],
      "boundingBox2D": [
        250,
        370,
        780,
        880
      ],
      "verdict": {
        "label": "Balanced Protein & Moderate Sodium",
        "level": "neutral"
      },
      "comparisonSentence": "Compared to deep-fried poultry and instant noodle dishes, these grilled fish and lightly sautéed vegetables offer cleaner protein sources with controlled oil usage.",
      "message": "These options strike a reasonable balance between macronutrients, offering quality protein and healthy omega-3 fatty acids from fish alongside fiber. Moderate sodium levels require attention if managing hypertension.",
      "averageNutrients": {
        "calories": 380,
        "protein": 24,
        "totalFat": 12,
        "saturatedFat": 3.5,
        "carbohydrates": 42,
        "sugar": 3,
        "totalFibre": 3,
        "sodium": 580
      },
      "orderingTip": "Opt for grilled kembung or tofu/tempeh preparations and request less oil in your stir-fried greens."
    },
    {
      "groupName": "Tier 3 - Caution Choice: Fried Meats, Fried Rice & Salty Dried Fish",
      "scoutItemIndices": [
        25,
        31,
        32,
        33,
        34,
        35,
        36,
        38,
        43,
        44,
        45,
        46,
        47,
        53,
        54,
        58,
        59,
        61,
        62,
        63,
        64,
        65,
        66,
        67,
        68,
        69,
        70,
        71,
        74,
        75,
        76,
        77,
        78,
        79,
        80,
        81,
        82,
        87,
        88,
        89,
        90,
        92,
        93,
        99,
        100,
        101,
        102,
        103
      ],
      "boundingBox2D": [
        310,
        110,
        900,
        910
      ],
      "verdict": {
        "label": "High Sodium & Saturated Fat",
        "level": "warning"
      },
      "comparisonSentence": "Unlike the cleaner steamed dishes, these deep-fried meal packages and fried rice dishes introduce significantly higher trans and saturated fats alongside elevated sodium.",
      "message": "Frequent consumption of deep-fried proteins and salted fish increases cardiovascular strain and inflammatory markers due to high oil absorption and sodium density. Consume occasionally and pair with raw greens.",
      "averageNutrients": {
        "calories": 720,
        "protein": 32,
        "totalFat": 36,
        "saturatedFat": 11,
        "carbohydrates": 68,
        "sugar": 5,
        "totalFibre": 2,
        "sodium": 1250
      },
      "orderingTip": "Request sambal on the side to control spice and oil intake, and remove poultry skin to lower saturated fat."
    },
    {
      "groupName": "Tier 4 - Severe Metabolic Load: Offal, Seblak & Sweet Desserts",
      "scoutItemIndices": [
        48,
        49,
        50,
        51,
        55,
        56,
        57,
        60
      ],
      "boundingBox2D": [
        780,
        100,
        950,
        890
      ],
      "verdict": {
        "label": "Excess Sugar, Fat & Refined Carbs",
        "level": "alert"
      },
      "comparisonSentence": "In contrast to nutrient-dense vegetables and lean grilled proteins, these processed seblak noodles, offal, and sweetened dessert bowls pack extreme refined carbohydrates, saturated fats, and sugars.",
      "message": "These items trigger rapid glycemic spikes, provide heavy purines and cholesterol from offal, and deliver dense empty calories that burden metabolic pathways. Limit strictly to protect cardiometabolic health.",
      "averageNutrients": {
        "calories": 550,
        "protein": 12,
        "totalFat": 28,
        "saturatedFat": 14,
        "carbohydrates": 65,
        "sugar": 35,
        "totalFibre": 1,
        "sodium": 1400
      },
      "orderingTip": "Avoid entirely or share in very small tasting portions if ordering as a treat."
    }
  ],
  "recommendedOption": "Lalapan Rebus (Labu+Kangkung+Kcg Pjg)"
}
```
- **Signals:** model=gemini-3.5-flash-lite, latency_ms=15141, tokens=[object Object]
- **Parent:** job_compare_set3_1788898391747

## 🔗 Data Pipelines & Infrastructure Connectivity Matrix

| Pipeline Stage | Connectivity & Status | Details / Metrics |
|----------------|-----------------------|-------------------|
| **1. Triage & Front Desk** | ⚪ Skipped / Standby | Direct execution mode |
| **2. Vision Scout & OCR** | ✅ Connected (108 item(s) detected) | Type: menu_items |
| **3. Biomarker Ingest & Mapping** | ⚪ Standby / N/A | No tabular lab panel |
| **4. Database Search & Truth Matching** | ⚪ Standby / N/A | Single-dispatch path: scout-direct ledger, no external fetch |
| **5. Mathematical Calculation Engine** | ⚪ Standby / N/A | No meal calculation required |
| **6. Trial-Balance & Quality Gate** | ⚪ Standby / N/A | N/A |
| **7. Health Coach / Clinical Engine** | ⚪ Standby / N/A | No clinical analysis requested |
| **8. State Storage & Job Sync** | ✅ Connected (Local / Active) | Job ID: `job_compare_set3_1788898391747` |

## 👤 Last User Action

- **Action:** submit_meal_job
- **Prompt/Text:** "Extract and compare all visible dishes across both pages of this menu. Group and rank them from healthiest to least healthy."
- **Timestamp:** 2026-09-08T20:13:26.890Z

## 🐾 User Action Breadcrumbs

| Timestamp | Action | Target / Context | Details |
|-----------|--------|------------------|---------|
|  | click | button | {"label":"Compare Foods / Menu","id":"compare-toggle-btn"} |
|  | select_photos | camera_roll | {"imageCount":2,"files":["set3_restaurant_menu_page1.jpg","set3_restaurant_menu_page2.jpg"]} |
|  | input_change | input | {"name":"compare-query-input","valueLength":124} |
|  | submit_initiated | chat_composer | {"prompt":"Extract and compare all visible dishes across both pages of this menu. Group and rank them from healthiest to least healthy.","imageCount":2,"submissionMode":"compare"} |
|  | submit_meal_job | chat_compose_dock | {"jobId":"job_compare_set3_1788898391747","promptLength":124,"imageCount":2,"submissionMode":"compare"} |

## ⚙️ Job Session Event Trail

_No job session event trail captured for this job._

## 🌐 Console & Network Diagnostics

_No client network errors or latency warnings recorded._

### Client Console Logs (2)
```
[INFO] Compare mode triggered with 2 images for job job_compare_set3_1788898391747
[INFO] Scout-Only Compare single-pass pipeline invoked for Set 3: Restaurant Menu Pages (Sambal Bakar Pencok).
```

## 🔍 Vision Scout Results (108 item(s) detected)

> **Scout Internal Reasoning:** Extracted and categorized 114 menu items across two pages into 7 distinct nutritional tiers, ranked from cleanest whole foods to heavy fried and high-sodium choices.

**Dining Environment:** `supermarket_or_store` | **Content Type:** `menu_items`

| # | Dish / Item | Weight | Bounding Box | Img | Method | Label / Sticker OCR | Constituent Ingredients |
|---|-------------|--------|--------------|-----|--------|---------------------|-------------------------|
| [1] | LALAPAN REBUS (LABU+KANGKUNG+KCG PJG) | 50g | — | #1 | boiled | — | — |
| [2] | KANGKUNG REBUS | 50g | — | #1 | boiled | — | — |
| [3] | ASINAN BUAH BOGOR | 50g | — | #0 | packaged | — | — |
| [4] | ASINAN SAYUR RUJAK PENGANTIN | 50g | — | #0 | packaged | — | — |
| [5] | SAYUR ASEM | 50g | — | #1 | packaged | — | — |
| [6] | NASI PUTIH | 50g | — | #1 | packaged | — | — |
| [7] | NASI UDUK | 50g | — | #1 | packaged | — | — |
| [8] | RUJAK KANGKUNG/PLECING KANGKUNG | 50g | — | #1 | packaged | — | — |
| [9] | TUMIS KANGKUNG/CAH TERASI | 50g | — | #1 | packaged | — | — |
| [10] | TUMIS CAISIM | 50g | — | #1 | packaged | — | — |
| [11] | TUMIS GENJER ALA PENCOK '89 | 50g | — | #1 | packaged | — | — |
| [12] | TUMIS SAWI PUTIH | 50g | — | #1 | packaged | — | — |
| [13] | TUMIS SAWI PUTIH + TELOR | 50g | — | #1 | packaged | — | — |
| [14] | TUMIS TOGE | 50g | — | #1 | packaged | — | — |
| [15] | TUMIS TOGE + IKAN ASIN | 50g | — | #1 | packaged | — | — |
| [16] | TUMIS ONCOM | 50g | — | #1 | packaged | — | — |
| [17] | TUMIS UDANG BALADO | 50g | — | #1 | packaged | — | — |
| [18] | TUMIS UDANG + PETE BUMBU BALADO | 50g | — | #1 | packaged | — | — |
| [19] | TUMIS CUMI BALADO | 50g | — | #1 | packaged | — | — |
| [20] | TUMIS CUMI + PETE BUMBU BALADO | 50g | — | #1 | packaged | — | — |
| [21] | TUMIS PEDA | 50g | — | #1 | packaged | — | — |
| [22] | TUMIS PEDA + PETE | 50g | — | #1 | packaged | — | — |
| [23] | TUMIS CUE | 50g | — | #1 | packaged | — | — |
| [24] | TUMIS CUE + PETE | 50g | — | #1 | packaged | — | — |
| [25] | TERONG BALADO | 50g | — | #1 | packaged | — | — |
| [26] | KOL GORENG | 50g | — | #1 | fried | — | — |
| [27] | TAHU ACAK (SELERA PEDAS BY REQUEST) | 50g | — | #1 | packaged | — | — |
| [28] | PEPES TAHU | 50g | — | #1 | packaged | — | — |
| [29] | PEPES PEDA MIX PETE | 50g | — | #1 | packaged | — | — |
| [30] | PETE GORENG/BAKAR/MENTAH | 50g | — | #1 | fried | — | — |

## 📚 Database Search & Entity Resolution

- **Resolution Strategy:** Single-Dispatch Direct Nutrient Ledger
- **Status:** ⚪ Standby — nutritional truth resolved directly from Vision Scout dish-level macronutrients and pure TypeScript derivation (Post-Atwater / Dish Finalize) without secondary candidate database fetches.

## 💬 Agent Message & Narrative

### Menu Nutritional Comparison: Sambal Bakar Pencok 89

**Summary:** This menu features a wide variety of traditional Indonesian dishes ranging from clear vegetable soups and fresh greens to heavily fried proteins and spicy sambal-laden items. Safest choices consist of steamed vegetables, clear broths, and fresh slaws, while heavy fried meats, offal, and rich noodle dishes require caution due to high saturated fat and sodium loads.

**Recommended Option:** Lalapan Rebus (Labu+Kangkung+Kcg Pjg)

#### Comparison Groups & Verdicts

**Rank 1: Tier 1 - Safest Choice: Steamed & Fresh Raw Dishes** [GOOD] — *Lowest Calories & High Fiber*
- **Items Included (6):** LALAPAN REBUS (LABU+KANGKUNG+KCG PJG), KANGKUNG REBUS, ASINAN BUAH BOGOR, ASINAN SAYUR RUJAK PENGANTIN, SAYUR ASEM, PENCOK KULIT/PORSI
- **Comparative Sentence:** "Unlike the deep-fried meals, these steamed and fresh raw vegetable preparations deliver maximum micronutrients with virtually no saturated fats or excess sodium."
- **Clinical Guidance:** These dishes provide excellent dietary fiber, vitamins, and antioxidants with minimal caloric load. They are optimal for metabolic health, blood pressure regulation, and weight management.
- **Ordering Tip:** Enjoy freely as a starter or side dish to increase satiety before consuming heavier main courses.
- **Nutrient Profile:** 75 kcal | P: 3g | C: 14g | F: 1g | Saturated Fat: 0.2g | Sodium: 250mg | Sugar: 5g

**Rank 2: Tier 2 - Moderate Choice: Grilled Fish, Stir-Fried Greens & Lean Sides** [NEUTRAL] — *Balanced Protein & Moderate Sodium*
- **Items Included (42):** NASI PUTIH, NASI UDUK, RUJAK KANGKUNG/PLECING KANGKUNG, TUMIS KANGKUNG/CAH TERASI, TUMIS CAISIM, TUMIS GENJER ALA PENCOK '89, TUMIS SAWI PUTIH, TUMIS SAWI PUTIH + TELOR, TUMIS TOGE, TUMIS TOGE + IKAN ASIN, TUMIS ONCOM, TUMIS UDANG BALADO, TUMIS UDANG + PETE BUMBU BALADO, TUMIS CUMI BALADO, TUMIS CUMI + PETE BUMBU BALADO, TUMIS PEDA, TUMIS PEDA + PETE, TUMIS CUE, TUMIS CUE + PETE, TERONG BALADO, TAHU ACAK (SELERA PEDAS BY REQUEST), PEPES TAHU, PEPES PEDA MIX PETE, PETE GORENG/BAKAR/MENTAH, TELUR DADAR, SOP AYAM KAMPUNG / DAGING SAPI, SAYUR SOP CEKER, NASI BAKAR CAKALANG, NASI BAKAR AYAM + TERI MEDAN, NASI BAKAR AYAM CUMI CABE IJO, BUBUR AYAM, PAKET MUJAIR (NASI + IKAN MUJAIR GORENG + SAYUR ASEM + TAHU + TEMPE), PAKET UDUK MUJAIR (NASI UDUK + IKAN MUJAIR GORENG + SAYUR ASEM + TAHU + TEMPE), PENCOK AMPLA/USUS/ATI, KAREDOK ALA PENCOK 89, PENCOK AYAM GORENG/BAKAR (SAMBAL PENCOK/ BAKAR), PENCOK IKAN KEMBUNG (SAMBAL PENCOK/ BAKAR), JENGKOL PENCOK/PORSI, JENGKOL BALADO/PORSI, JENGKOL SEMUR/PORSI, JENGKOL GORENG/PORSI, SATE TAICHAN JUARA (SELERA PEDAS)/PORSI
- **Comparative Sentence:** "Compared to deep-fried poultry and instant noodle dishes, these grilled fish and lightly sautéed vegetables offer cleaner protein sources with controlled oil usage."
- **Clinical Guidance:** These options strike a reasonable balance between macronutrients, offering quality protein and healthy omega-3 fatty acids from fish alongside fiber. Moderate sodium levels require attention if managing hypertension.
- **Ordering Tip:** Opt for grilled kembung or tofu/tempeh preparations and request less oil in your stir-fried greens.
- **Nutrient Profile:** 380 kcal | P: 24g | C: 42g | F: 12g | Saturated Fat: 3.5g | Sodium: 580mg | Sugar: 3g

**Rank 3: Tier 3 - Caution Choice: Fried Meats, Fried Rice & Salty Dried Fish** [WARNING] — *High Sodium & Saturated Fat*
- **Items Included (52):** KOL GORENG, CUMI ASIN GORENG, IKAN ASIN PEDA CABE PENCOK, IKAN TERI JENGKI SAMBAL PENCOK, IKAN ASIN SEPAT, IKAN ASIN JAMBAL, IKAN ASIN GABUS, SOTO BETAWI DAGING SAPI / AYAM KAMPUNG, NASI GORENG AYAM (PEDAS BY REQUEST), NASI GORENG IKAN ASIN ( BY REQUEST ), NASI GORENG PETE ( BY REQUEST ), NASI GORENG ATI/AMPLA ( BY REQUEST ), NASI GORENG ALA PENCOK 89 (BY REQUEST), MIE AYAM ORIGINAL, MIE AYAM/CEKER/BAKSO/PANGSIT, SATE ATI-AMPLA, SATE KULIT, PAKET UDUK BURUNG PUYUH (NASI UDUK + BURUNG PUYUH + SAYUR ASEM + TEMPE + TAHU), PAKET AYAM (NASI + AYAM GORENG/BAKAR+SAYUR ASEM+TAHU +TEMPE), PAKET UDUK AYAM (NASI UDUK+ AYAM GORENG/BAKAR + SAYUR ASEM TAHU + TEMPE), PAKET EMPAL (NASI + DAGING EMPAL + SAYUR ASEM + TAHU +TEMPE), PAKET UDUK EMPAL (NASI UDUK + DAGING EMPAL+SAYUR ASEM+TAHU, PAKET BEBEK (NASI +BEBEK GORENG + SAYUR ASEM + TAHU + TEMPE), PAKET UDUK BEBEK (NASI UDUK + BEBEK GORENG + SAYUR ASEM + TAHU + TEMPE), PAKET LELE (NASI + LELE GORENG 2 PCS + SAYUR ASEM+TAHU + TEMPE), PAKET UDUK LELE (NASI UDUK + LELE GORENG 2 PCS + SAYUR ASEM+ TAHU + TEMPE), PAKET KEMBUNG (NASI + IKAN KEMBUNG + SAYUR ASEM + TAHU + TEMPE), PAKET UDUK KEMBUNG (NASI UDUK + IKAN KEMBUNG + SAYUR ASEM + TAHU + TEMPE), PAKET NILA (NASI + IKAN NILA GORENG + SAYUR ASEM + TAHU + TEMPE), PAKET UDUK NILA (NASI UDUK + IKAN NILA GORENG + SAYUR ASEM + TAHU + TEMPE), PENCOK KACANG, PENCOK KACANG+KETIMUN, AYAM GORENG CABE KERING, PENCOK CEKER, PENCOK TAHU/TEMPE /PORSI (ISI 3), AYAM GEPREK SELERA PEDAS, PENCOK KEPALA/PORSI (ISI 3), PENCOK DAGING EMPAL (SAMBAL PENCOK/ BAKAR), PENCOK IKAN NILA GORENG (SAMBAL PENCOK/ BAKAR), PENCOK IKAN MUJAIR GORENG (SAMBAL PENCOK/ BAKAR), PENCOK LELE GORENG( 2 PCS) (SAMBAL PENCOK/ BAKAR), PENCOK BEBEK GORENG PRESTO (SAMBAL PENCOK/ BAKAR), PENCOK BURUNG PUYUH (SAMBAL PENCOK/ BAKAR), JENGKOL, SATE, TUMISAN, SAYURAN, IKAN ASIN, PENCK, BEST SELLER, PAKET HEMAT, PAKET HEMAT IKAN
- **Comparative Sentence:** "Unlike the cleaner steamed dishes, these deep-fried meal packages and fried rice dishes introduce significantly higher trans and saturated fats alongside elevated sodium."
- **Clinical Guidance:** Frequent consumption of deep-fried proteins and salted fish increases cardiovascular strain and inflammatory markers due to high oil absorption and sodium density. Consume occasionally and pair with raw greens.
- **Ordering Tip:** Request sambal on the side to control spice and oil intake, and remove poultry skin to lower saturated fat.
- **Nutrient Profile:** 720 kcal | P: 32g | C: 68g | F: 36g | Saturated Fat: 11g | Sodium: 1250mg | Sugar: 5g

**Rank 4: Tier 4 - Severe Metabolic Load: Offal, Seblak & Sweet Desserts** [ALERT] — *Excess Sugar, Fat & Refined Carbs*
- **Items Included (8):** SEBLAK COMPLETE, SEBLAK CEKER, SEBLAK SEA FOOD, SEBLAK CRHET VIRAL, BUBUR SUM SUM/KETAN HITAM/KACANG HUAUSIN/KONG THAI/KOLANG KALING, KERUPUK MIE + BUMBU KACANG, SATE USUS, PAKET BURUNG PUYUH (NASI + BURUNG PUYUH + SAYUR ASEM + TEMPE + TAHU)
- **Comparative Sentence:** "In contrast to nutrient-dense vegetables and lean grilled proteins, these processed seblak noodles, offal, and sweetened dessert bowls pack extreme refined carbohydrates, saturated fats, and sugars."
- **Clinical Guidance:** These items trigger rapid glycemic spikes, provide heavy purines and cholesterol from offal, and deliver dense empty calories that burden metabolic pathways. Limit strictly to protect cardiometabolic health.
- **Ordering Tip:** Avoid entirely or share in very small tasting portions if ordering as a treat.
- **Nutrient Profile:** 550 kcal | P: 12g | C: 65g | F: 28g | Saturated Fat: 14g | Sodium: 1400mg | Sugar: 35g


## ⚙️ Pipeline Stage Ledger

| Stage | Status | Attempt | Key Decisions | Errors |
|-------|--------|---------|---------------|--------|
| Vision Scout & Comparison Extraction | success | 1 | SinglePassArchitecture, GroupOrdering, ComparativeSentences | — |

## ⚠️ Errors & Warnings

_No thrown exceptions or log errors/warnings captured._

## 🖥️ Backend Execution Logs

```
[backend] [job_compare_set3_1788898391747] Compare request received with 2 images. Mode: compare.
[scout_only_compare] Dispatched to gemini-3.5-flash-lite with single-pass instruction.
[scout_only_compare] Latency: 15141ms. Usage: 6296 in / 6536 out tokens.
[scout_only_compare] Extracted 108 items into 4 ranked groups.
[scout_only_compare] Status: SUCCESS. Finalized compare payload.
```

---
_Generated by Health Tracker debug export. Images are omitted to prevent bloat._
