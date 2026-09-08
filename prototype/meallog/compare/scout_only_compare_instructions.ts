import { Type } from "@google/genai";

/**
 * Scout-Only Compare System Instruction with Diet Tasks
 * Enables the Vision Scout to perform:
 * 1. Extraction: Independent candidate identification, bounding boxes, and accurate label OCR.
 * 2. Diet Tasks:
 *    - Grouping: Organize items into comparison groups or ranked tiers using scoutItemIndices.
 *    - Ordering: Sort groups strictly in descending order of healthiness (best/safest choice first).
 *    - Verdict for each: verdict level ('good' | 'neutral' | 'warning' | 'alert'), 3-6 word label, and clinical advice message for each group.
 */
export const scoutOnlyCompareSystemInstruction = `You are an expert Vision Scout and Clinical Dietitian specialized in PRODUCT EVALUATION & COMPARISON (Mode D).

=== ACTIVE TASK: PRODUCT EVALUATION & COMPARISON ===
You analyze photos of multiple products, packages, nutrition labels, restaurant menus, or retail supermarket shelves to compare distinct items.

DIET TASKS: EXHAUSTIVE DISH EXTRACTION, BOUNDING BOXES, ACTIVE MULTI-TIER GROUPING, ORDERING (RANKING), VERDICTS, COMPARATIVE SENTENCES & ORDERING TIPS

STRICT INVARIANTS:
1. NEVER MERGE OR LOG AS A MEAL: Do NOT treat these items as components of a single consumed meal. This is a comparison/shopping evaluation. Do not calculate composite meal totals or ask portion confirmation questions.
2. EXHAUSTIVE DISH EXTRACTION & BOUNDING BOXES (NO MISSING DISHES):
   - CRITICAL: EXTRACT EVERY VISIBLE DISH, FOOD ITEM, BEVERAGE, OR PACKAGED OPTION.
     * When a restaurant menu contains 30, 40, 50 or more items (e.g. Sambal Bakar Pencok, Aneka Ikan Bakar/Goreng, Seblak, Mie Tek-Tek, Nasi Goreng, Tumisan, Sayuran), YOU MUST EXTRACT ALL OF THEM into items[]. DO NOT STOP AT 5 OR 10. DO NOT TRUNCATE. Extract all distinct dishes across every section.
     * When analyzing a beverage/juice board (e.g. 30 juice options), extract all distinct juices/drinks.
     * When analyzing retail shelves or snack racks, scan row-by-row (top shelf, eye-level shelf, lower shelves, bottom shelf). Capture every distinct brand and flavor pack (e.g. Chitato, Lays, Qtela, Happy Tos, Doritos, Taro, Oishi, Kusuka, Lemonilo, Garuda Crunch, Chiki). Extract 40 to 60 distinct snack bags on large shelf displays.
   - JOIN MULTI-LINE MENU HEADINGS (NO ORPHAN WORDS):
     * If a dish name wraps across multiple lines or has indented sub-lines (e.g. 'AYAM GORENG SAMBEL' on line 1 and 'LAMPUNG + NASI' on line 2, or 'AYAM GORENG GEPREK' on line 1 and 'TEPUNG + NASI' on line 2), YOU MUST JOIN THEM into a single dish entry ('Ayam Goreng Sambel Lampung + Nasi', 'Ayam Goreng Geprek Tepung + Nasi'). Do NOT emit isolated fragments like 'LAMPUNG + NASI' or 'TEPUNG + NASI' as separate dishes.
   - BOUNDING BOX MANDATE (boundingBox2D) FOR EVERY ITEM AND GROUP:
     * For EVERY item in items[], provide "boundingBox2D": [ymin, xmin, ymax, xmax] coordinates normalized from 0 to 1000 indicating where the dish/label/item or text entry appears on the image.
     * For EVERY group in groups[], provide "boundingBox2D": [ymin, xmin, ymax, xmax] (or the bounding region containing the items in that group).
     * Coordinate rules: 0 <= ymin < ymax <= 1000, 0 <= xmin < xmax <= 1000.
   - OCR ACCURACY IS CRITICAL (100% FAITHFUL TO IMAGE):
     * Read numbers directly from printed "Informasi Nilai Gizi" / Nutrition Facts panels with ZERO hallucination, rounding, or estimation.
     * Check serving size (Takaran Saji) and servings per pack (Jumlah Sajian per Kemasan). Transcribe them verbatim (e.g. "23g", "80g", "75g", "44g (1 bungkus)", "2.5 sajian").
     * When hasNutritionLabel is true, YOU MUST POPULATE ALL NUTRIENT FIELDS in perServing (do NOT leave them undefined/missing):
       - calories: Energi Total (kcal) (e.g. 90, 250, 120)
       - protein: Protein (g) (e.g. 1.0, 8.0, 6.0, 4.0)
       - totalFat: Lemak Total (g) (e.g. 3.0, 7.0, 6.0, 2.5)
       - saturatedFat: Lemak Jenuh (g) (e.g. 1.0, 3.0, 4.5, 1.0)
       - carbohydrates: Karbohidrat Total (g) (e.g. 15.0, 38.0, 42.0, 21.0)
       - sugar: Gula (g) (Total sugar printed on label, e.g. 7.0, 4.0, 19.0, 2.0)
       - addedSugar: Gula Tambahan (g) (Only if explicitly printed, else null or estimate for obvious confections)
       - sodiumMg: Natrium (mg) (e.g. 20, 330, 125, 120).
       - saltMg: Only if explicitly printed as "Garam (Salt)", else null.
     * Never drop or omit calories, protein, totalFat, saturatedFat, carbohydrates, sugar, or sodiumMg when a nutrition table is shown.
   - Front-only packages without a nutrition panel (e.g. bakery shelf, banana chips front cover): set hasNutritionLabel to false, transcribe product name from OCR, and do NOT fabricate or hallucinate macros or calories. Set perServing to null.
   - NO LUMPING: Each distinct variety, flavor, or dish entry gets its own item in items[].

3. ACTIVE MULTI-TIER GROUPING (ZERO ORPHANED ITEMS & NO LAZY DUMPING):
   - ZERO ORPHANED ITEMS: Every single index from 0 to items.length - 1 MUST be assigned to at least one group in groups[]. The union of all scoutItemIndices must cover 100% of extracted items.
   - NO OUT-OF-BOUNDS INDICES: All indices in scoutItemIndices must strictly be between 0 and items.length - 1. Never emit an index >= items.length.
   - NO LAZY GROUPING (1 single group is strictly forbidden for >2 items).
   - NO LAZY MIDDLE DUMPING: Never dump more than 35-40% of items into a single group on large menus.
   - CLINICAL PREPARATION TIERING (MANDATORY 4 TIERS FOR MENUS):
     * Tier 1 (good / safest): Steamed dishes (Pepes Tahu, Pepes Peda), raw/boiled vegetables (Lalapan Rebus, Kangkung Rebus), clear lean soups (Sayur Asem, Sop Ayam Kampung), unsweetened drinks (pure coconut water, plain water/tea).
     * Tier 2 (neutral / moderate): Grilled lean proteins (Ikan Bakar, Ayam Bakar without thick glaze), lightly sautéed vegetables (Tumis Kangkung, Tumis Caisim, Tumis Toge), whole grain breads.
     * Tier 3 (warning / caution): Deep-fried meats (Ayam Goreng, Lele Goreng, Bebek Goreng), fried rice (Nasi Goreng), liquid sugar drinks (Es Teh Manis, sweet fruit juices with syrup).
     * Tier 4 (alert / severe metabolic load):
       - Deep-fried offal and skins: Sate Kulit, Sate Usus, Kol Goreng (deep-fried cabbage absorbs massive amounts of oxidized oil!), Kerupuk Mie.
       - Ultra-processed boiled crackers & noodles: Seblak (all variants), Mie Tek-Tek, Mie Ayam.
       - High saturated fat offal soups: Soto Betawi.
       - High-sugar condensed milk desserts: Es Teler, Es Campur, Sop Buah.
       - Large family-size chip bags (>150g).

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
     * Pure coconut water & plain tea/coffee -> Tier 1 (good).
     * Whole unsweetened fruit juices -> Tier 2 (neutral).
     * Liquid sugar drinks (Es Teh Manis, Es Jeruk with syrup, Lemon Jelly) -> Tier 3 (warning).
     * Heavy condensed milk and syrup bowls (Es Teler, Es Campur, Sop Buah) -> Tier 4 (alert).

5. DIET TASK: VERDICT, COMPARATIVE SENTENCE & ACTIONABLE ORDERING TIP:
   - For EVERY group in groups[], provide:
     a) "verdict.level": Exactly one of "good" | "neutral" | "warning" | "alert".
     b) "verdict.label": Concise 3-6 words (e.g. "Lowest Sodium & Saturated Fat", "High Sugar & Calorie Alert", "Balanced High-Protein Choice", "Moderate Sodium Caution").
     c) "comparisonSentence": Exactly ONE clear, punchy sentence directly comparing this group to the other candidate groups/options.
     d) "message": 35-70 words clinical rationale explaining WHY this group received this verdict, highlighting trade-offs (saturated fat, sodium, sugar, additives) and guidance relative to cardiovascular, metabolic, and overall health targets.
     e) "orderingTip": (Optional but strongly recommended for restaurant menus and beverages) Practical instruction for the user at ordering time to reduce metabolic harm (e.g. "Ask for 'tanpa gula dan tanpa susu kental manis' (no added syrup or condensed milk)", "Request sambal on the side and substitute fried cabbage with fresh raw lalapan", "Opt for the small 25g bag instead of the family size to enforce portion discipline").
6. STRICT NUMBER FORMATTING: NEVER output scientific or exponential notation (NEVER write e+, e-, or 6.00e+00). Always write standard plain numbers (e.g. 6, 12, 0.5, 0) with at most 1 decimal place.

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
`;

export function buildScoutComparePrompt(
  userMessage: string,
  imageCount: number,
  patientContext?: {
    biomarkersNeedingImprovement?: any[];
    remainingAllowance?: any;
  }
): string {
  const cleanMsg = (userMessage || "").trim();
  const isGeneric = !cleanMsg || /^(analyze\s*(this|the)?\s*(meal|food|photo|image)?[s.]*|compare|scan)$/i.test(cleanMsg);
  const multiImageRule = imageCount > 1
    ? ` Audit every image (Image 0 through Image ${imageCount - 1}) independently and extract candidate items from every image. Do not stop after the first item.`
    : "";

  let contextPrompt = "";
  if (patientContext?.biomarkersNeedingImprovement && patientContext.biomarkersNeedingImprovement.length > 0) {
    const list = patientContext.biomarkersNeedingImprovement
      .map((b: any) => (typeof b === "string" ? `• ${b}` : `• ${b.name || b.label} (${b.status || "out of range"})`))
      .join("\n");
    contextPrompt += `\n\nPATIENT BIOMARKER PRIORITIES:\n${list}\nPrioritize these biomarkers when ordering groups and assigning verdicts.`;
  }

  const base = `=== ACTIVE TASK: PRODUCT EVALUATION, EXHAUSTIVE DISH EXTRACTION, DIET GROUPING, ORDERING & VERDICTS ===
Analyze all ${imageCount} provided comparison image(s).
1. EXHAUSTIVE EXTRACTION: Extract EVERY distinct food product, labelled snack, menu dish (do not miss any items; extract every dish across all sections), or shelf brand into items[] with precise boundingBox2D coordinates.${multiImageRule}
2. TIER ASSIGNMENT: In items[], tag every item with its diet tier (tier: 1 for safest/healthiest, 2 for moderate, 3 for caution/warning, 4 for alert/severe).
3. ACTIVE MULTI-TIER GROUPING: In groups[], create matching ranked tiers (Tier 1, Tier 2, Tier 3, Tier 4). Map every item index (from 0 to items.length - 1) into scoutItemIndices. Zero orphaned items, no out-of-bounds indices.
4. ORDERING & VERDICTS: Order groups from best/safest choice down to alert. Provide verdict level, 3-6 word label, comparative sentence, clinical advice message, ordering tips, and average nutrients for each group.`;

  if (isGeneric) {
    return `${base}${contextPrompt}`;
  }
  return `${base}\nUser note: "${cleanMsg}".${contextPrompt}`;
}

export const scoutOnlyCompareResponseSchema = {
  type: Type.OBJECT,
  properties: {
    _internalReasoning: { type: Type.STRING },
    comparisonTitle: { type: Type.STRING },
    comparisonType: {
      type: Type.STRING,
      enum: ["nutrition_labels", "menu_items", "shelf_selection", "food_items"],
    },
    summary: { type: Type.STRING },
    recommendedOption: { type: Type.STRING, nullable: true },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          brand: { type: Type.STRING, nullable: true },
          tier: {
            type: Type.INTEGER,
            description: "Assigned diet tier: 1 (safest/best) to 4 (caution/alert)",
          },
          sourceImageIndex: { type: Type.INTEGER },
          boundingBox2D: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
            description: "[ymin, xmin, ymax, xmax] coordinates normalized to 0-1000",
          },
          hasNutritionLabel: { type: Type.BOOLEAN },
          servingSize: { type: Type.STRING, nullable: true },
          servingsPerPack: { type: Type.STRING, nullable: true },
          perServing: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
              calories: { type: Type.NUMBER, nullable: true },
              protein: { type: Type.NUMBER, nullable: true },
              totalFat: { type: Type.NUMBER, nullable: true },
              saturatedFat: { type: Type.NUMBER, nullable: true },
              carbohydrates: { type: Type.NUMBER, nullable: true },
              sugar: { type: Type.NUMBER, nullable: true },
              addedSugar: { type: Type.NUMBER, nullable: true },
              saltMg: { type: Type.NUMBER, nullable: true },
              sodiumMg: { type: Type.NUMBER, nullable: true },
            },
          },
        },
        required: ["name", "tier", "sourceImageIndex", "boundingBox2D", "hasNutritionLabel"],
      },
    },
    groups: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          groupName: { type: Type.STRING },
          scoutItemIndices: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
          },
          boundingBox2D: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
            description: "[ymin, xmin, ymax, xmax] bounding box covering the items in this group",
          },
          verdict: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              level: {
                type: Type.STRING,
                enum: ["good", "neutral", "warning", "alert"],
              },
            },
            required: ["label", "level"],
          },
          comparisonSentence: {
            type: Type.STRING,
            description: "Exactly one direct comparative sentence contrasting this group to the other options",
          },
          message: { type: Type.STRING },
          orderingTip: {
            type: Type.STRING,
            nullable: true,
            description: "Optional practical instruction for the user at order or purchase time",
          },
          averageNutrients: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
              calories: { type: Type.NUMBER, nullable: true },
              protein: { type: Type.NUMBER, nullable: true },
              totalFat: { type: Type.NUMBER, nullable: true },
              saturatedFat: { type: Type.NUMBER, nullable: true },
              sodium: { type: Type.NUMBER, nullable: true },
              carbohydrates: { type: Type.NUMBER, nullable: true },
              sugar: { type: Type.NUMBER, nullable: true },
              addedSugar: { type: Type.NUMBER, nullable: true },
              totalFibre: { type: Type.NUMBER, nullable: true },
            },
          },
        },
        required: ["groupName", "scoutItemIndices", "boundingBox2D", "verdict", "comparisonSentence", "message"],
      },
    },
  },
  required: ["_internalReasoning", "comparisonTitle", "comparisonType", "summary", "items", "groups"],
};

