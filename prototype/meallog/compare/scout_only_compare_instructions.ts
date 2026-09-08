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
   - STRICT OVERALL ITEM RANKING: Items in items[] MUST be ordered primarily from best/healthiest tier down to least favorable tier, and within each tier from best to least favorable.

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

4. DIET TASK: ORDERING & RANKING (GROUPS AND SUB-ITEMS SORTED BEST TO LEAST FAVORABLE):
   - STRICT GROUP RANKING: The groups in groups[] MUST be sorted in strict descending order of overall health ranking: BEST / SAFEST CHOICE FIRST ('good'), down to least suitable at the bottom ('alert').
     * Ranking order: 'good' -> 'neutral' -> 'warning' -> 'alert'.
   - STRICT SUB-ITEM RANKING INSIDE GROUPS:
     * Inside every group, "scoutItemIndices" MUST be sorted strictly from best to least favorable (most healthful to least healthful candidate item).
     * The first item index listed in scoutItemIndices must be the healthiest, safest choice in that group; subsequent indices follow in descending order of nutritional quality.
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
     d) "message": 35-70 words clinical rationale explaining WHY this group received this verdict. You MUST be two-sided: highlight BOTH positive benefits (e.g., closing protein/fiber deficits, healthy energy) AND negative trade-offs (e.g., saturated fat, sodium, sugar excesses). Actively praise and encourage nutrient-dense choices that help meet the user's targets, while penalizing those that exacerbate risks.
     e) "orderingTip": (Optional but strongly recommended for restaurant menus and beverages) Practical instruction for the user at ordering time to maximize nutritional value or reduce metabolic harm (e.g. "Ask for without added sugar/syrup", "Add an extra side of grilled chicken to boost protein", "Opt for the small single-portion bag").
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
      "message": "string (35-70 words clinical rationale highlighting both positive nutrient benefits and negative trade-offs)",
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
  
  let targetNutrientNames: string[] = [];
  if (patientContext?.remainingAllowance) {
    const ra = patientContext.remainingAllowance;
    const targetsList = [];
    if (ra.saturatedFat !== undefined) { targetsList.push(`Sat fat (${ra.saturatedFat})`); targetNutrientNames.push("Saturated Fat"); }
    if (ra.calories !== undefined) { targetsList.push(`Calorie (${ra.calories})`); targetNutrientNames.push("Calories"); }
    if (ra.sodium !== undefined) { targetsList.push(`Sodium (${ra.sodium})`); targetNutrientNames.push("Sodium"); }
    if (ra.protein !== undefined) { targetsList.push(`Protein (${ra.protein})`); targetNutrientNames.push("Protein"); }
    if (ra.carbohydrates !== undefined) { targetsList.push(`Carbohydrates (${ra.carbohydrates})`); targetNutrientNames.push("Carbohydrates"); }
    if (ra.totalFibre !== undefined) { targetsList.push(`Total Fibre (${ra.totalFibre})`); targetNutrientNames.push("Total Fibre"); }
    if (ra.potassium !== undefined) { targetsList.push(`Potassium (${ra.potassium})`); targetNutrientNames.push("Potassium"); }
    if (ra.solubleFibre !== undefined) { targetsList.push(`Soluble Fibre (${ra.solubleFibre})`); targetNutrientNames.push("Soluble Fibre"); }
    if (ra.addedSugar !== undefined) { targetsList.push(`Added Sugar (${ra.addedSugar})`); targetNutrientNames.push("Added Sugar"); }
    if (ra.transFat !== undefined) { targetsList.push(`Trans Fat (${ra.transFat})`); targetNutrientNames.push("Trans Fat"); }

    if (targetsList.length > 0) {
      contextPrompt += `\n\n=== NUTRITIONAL TARGET STATUS ===\n3 days avg: ${targetsList.join(", ")}\n\nYou MUST take this dynamic user profile data into consideration for your grouping, evaluation, ranking, and clinical messaging. Adjust the ORDERING (Ranking), verdicts, and clinical guidance strictly based on how these items impact the user's specific nutritional deviations. For instance, if a user is severely over their Added Sugar or Saturated Fat limit, items high in those nutrients must be severely penalized in ranking and grouped as an 'alert', even if they might otherwise be considered moderate.`;
    }
  }

  let varianceRuleText = "their macro-nutrients (Calories, Fat, Carbs) differ by more than 10%";
  let averageNutrientsInstruction = "realistic average nutrients for each group.";
  if (targetNutrientNames.length > 0) {
    varianceRuleText = `their values for ANY of your targeted metrics (${targetNutrientNames.join(", ")}) differ by more than 10%`;
    averageNutrientsInstruction = `the ENTIRE SET of nutrient values present in the NUTRITIONAL TARGET STATUS (${targetNutrientNames.join(", ")}) for each group in the averageNutrients object. Do not leave these targets empty.`;
  }

  const base = `=== ACTIVE TASK: PRODUCT EVALUATION, EXHAUSTIVE DISH EXTRACTION, CONDENSED ITEMS, DIET GROUPING & VERDICTS ===
Analyze all ${imageCount} provided comparison image(s).
1. EXHAUSTIVE EXTRACTION (NO SAMPLING, CONDENSED FORMAT):
   - Extract EVERY distinct food product, labelled snack, or menu dish visible into items[].${multiImageRule} Do NOT merely sample 5-10 dishes. On menus or shelves with many options, perform a thorough, multi-column OCR scan and transcribe as many distinct dishes/products as legible across both pages/columns.
   - CONDENSED ITEM FORMAT: Keep each item object minimal with only "name", "tier", and "sourceImageIndex" (no boundingBox2D on items, and omit empty/null boilerplate keys). This saves massive vision processing power and output tokens, enabling fast extraction of 50-100+ items.
2. GROUP BOUNDING BOXES:
   - Provide "boundingBox2D": [ymin, xmin, ymax, xmax] ONLY on each group in groups[], demarcating the region of the image containing those items.
3. TIER ASSIGNMENT & SUB-ITEM ORDERING:
   - In items[], tag every item with its diet tier (tier: 1 for safest/healthiest, 2 for moderate, 3 for caution/warning, 4 for alert/severe).
   - Sort items in items[] from best/healthiest choice down to least favorable.
   - Inside each group in groups[], sort "scoutItemIndices" strictly from best/healthiest choice to least favorable sub-item.
4. ACTIVE NUTRITIONAL CLUSTERING (MAX 10% VARIANCE & HIDDEN HARMS): In groups[], create ranked clusters. You MUST NOT group dishes if ${varianceRuleText}. BEYOND MACROS: Isolate items with critical hidden harms (e.g., Trans Fats, heavy synthetic additives, extreme oxidized oil) into their own 'alert' group, even if base macros match cleaner foods. Split broad categories (e.g., split "Fried Foods" into "Fried Lean Proteins", "Fried Carbs", "Fried Sides"). You may create 5-10 groups to maintain tight variance. Map every item index into scoutItemIndices. Zero orphaned items.
5. ORDERING & VERDICTS: Order groups from best/safest choice down to alert. Provide verdict level, 3-6 word label, comparative sentence, clinical advice message, ordering tips, and ${averageNutrientsInstruction}`;

  if (isGeneric) {
    const genericDirective = `\nDEFAULT COMPARISON MANDATE (No specific user filter provided): Extract, evaluate, and compare ALL legible dishes, beverages, products, and items visible across the entire image/menu/shelf without omission. Group and rank all candidate items strictly from best/healthiest to least favorable.`;
    return `${base}${genericDirective}${contextPrompt}`;
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
      description: "Condensed list of all distinct extracted dishes/products. For menus/shelves, only name, tier, and sourceImageIndex are needed.",
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
          hasNutritionLabel: { type: Type.BOOLEAN, nullable: true },
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
              totalFibre: { type: Type.NUMBER, nullable: true },
              saltMg: { type: Type.NUMBER, nullable: true },
              sodiumMg: { type: Type.NUMBER, nullable: true },
            },
          },
        },
        required: ["name", "tier", "sourceImageIndex"],
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
            description: "List of item indices belonging to this group, strictly sorted in descending order from best/healthiest choice to least favorable sub-item.",
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
            properties: {
              calories: { type: Type.NUMBER, description: "Typical average calories in kcal" },
              protein: { type: Type.NUMBER, description: "Typical average protein in grams" },
              totalFat: { type: Type.NUMBER, description: "Typical average total fat in grams" },
              saturatedFat: { type: Type.NUMBER, description: "Typical average saturated fat in grams" },
              carbohydrates: { type: Type.NUMBER, description: "Typical average carbohydrates in grams" },
              sugar: { type: Type.NUMBER, description: "Typical average sugar in grams" },
              totalFibre: { type: Type.NUMBER, description: "Typical average total fibre in grams" },
              sodium: { type: Type.NUMBER, description: "Typical average sodium in mg" },
              potassium: { type: Type.NUMBER, nullable: true, description: "Typical average potassium in mg" },
              solubleFibre: { type: Type.NUMBER, nullable: true, description: "Typical average soluble fibre in grams" },
              addedSugar: { type: Type.NUMBER, nullable: true, description: "Typical average added sugar in grams" },
              transFat: { type: Type.NUMBER, nullable: true, description: "Typical average trans fat in grams" },
            },
            required: ["calories", "protein", "totalFat", "saturatedFat", "carbohydrates", "sugar", "totalFibre", "sodium"],
          },
        },
        required: ["groupName", "scoutItemIndices", "boundingBox2D", "verdict", "comparisonSentence", "message", "averageNutrients"],
      },
    },
  },
  required: ["_internalReasoning", "comparisonTitle", "comparisonType", "summary", "items", "groups"],
};

