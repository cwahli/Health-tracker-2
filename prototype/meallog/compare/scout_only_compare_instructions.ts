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
export const scoutOnlyCompareSystemInstruction = `You are a Clinical Dietitian & Vision Scout evaluating competing food options (Mode D).

INVARIANTS:
1. NON-ADDITIVE: Items are mutually exclusive choices; never sum meal totals or log as a consumed plate.
2. EXHAUSTIVE OCR: Read all columns & pages top-to-bottom across ALL images without stopping. Format non-English names as "Local Name / English Translation" (for branded snacks, keep brand and append English culinary description).
3. CONDENSED ITEMS: Emit only { name, tier, sourceImageIndex } unless a printed nutrition panel is present (then transcribe verbatim).
4. <=10% MACRO CLUSTERING: Group items together only if macros differ by <=10%. You MUST assign every item into groups[] (zero unassigned items). Never emit empty groups[].
5. REGIONAL BOUNDING BOXES: Emit quadrant [ymin, xmin, ymax, xmax] (0-1000) on groups[] framing item regions (avoid [0,0,1000,1000]).
6. 10 ALLOWANCE NUTRIENTS: Supply realistic averageNutrients (serving) and averageNutrientsPer100g across all 10 allowance keys (4P + 9F + 4C ≈ kcal).
7. CLINICAL RANKING: Rank groups descending (good -> neutral -> warning -> alert) and sort scoutItemIndices healthiest-to-least favorable. Evaluate per-100g density to prevent portion-size illusions. Isolate trans fats, oxidized fry oils, and heavy syrups into Tier 4 alerts.
8. PER-GROUP VERDICTS: Provide a 3-6 word verdict label, 1 comparative sentence, 35-70 word clinical advice tailored to patient targets, and a practical ordering tip.
9. NUMBERS: Plain decimal numbers only (no scientific notation, max 1 decimal).`;

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
  const multiImageRule = imageCount > 1 ? ` across all ${imageCount} images` : " across provided images";

  let context = "";
  if (patientContext?.biomarkersNeedingImprovement?.length) {
    const list = patientContext.biomarkersNeedingImprovement
      .map((b: any) => (typeof b === "string" ? b : `${b.name || b.label} (${b.status || "out of range"})`))
      .join(", ");
    context += `\nPatient Priorities: ${list}.`;
  }

  if (patientContext?.remainingAllowance) {
    const ra = patientContext.remainingAllowance;
    const targets = Object.entries(ra)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => `${k} (${typeof v === 'number' && v > 0 ? `+${v}%` : typeof v === 'number' && v < 0 ? `${v}%` : v})`)
      .join(", ");
    if (targets) context += `\nTarget Deviations: ${targets}.`;
  }

  const action = isGeneric
    ? `Compare and rank all visible options${multiImageRule}. Exhaustively extract all legible dishes/products top-to-bottom across every column and section into items[].`
    : `User request: "${cleanMsg}"${multiImageRule ? ` (${imageCount} images)` : ""}. Exhaustively extract all legible dishes/products top-to-bottom across every column and section into items[].`;

  return `${action}${context}`;
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
          name: {
            type: Type.STRING,
            description: "Format non-English names as 'Local Name / English Translation'.",
          },
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
          per100g: {
            type: Type.OBJECT,
            nullable: true,
            description: "Normalized nutrient metrics per 100g standard reference, eliminating serving size distortions.",
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
          servingWeightGrams: {
            type: Type.NUMBER,
            nullable: true,
            description: "Typical average single serving weight in grams for this group (e.g. 250 for soup bowl, 45 for bread slice, 300 for beverage glass)",
          },
          averageNutrients: {
            type: Type.OBJECT,
            description: "Typical average nutrients per single serving for this group. MANDATORY non-null for all groups including unlabelled bakery/prepared dishes.",
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
          averageNutrientsPer100g: {
            type: Type.OBJECT,
            nullable: true,
            description: "Standardized normalized nutrients per 100g reference for this group to eliminate serving-size distortions.",
            properties: {
              calories: { type: Type.NUMBER, description: "Calories per 100g (kcal)" },
              protein: { type: Type.NUMBER, description: "Protein per 100g (g)" },
              totalFat: { type: Type.NUMBER, description: "Total fat per 100g (g)" },
              saturatedFat: { type: Type.NUMBER, description: "Saturated fat per 100g (g)" },
              carbohydrates: { type: Type.NUMBER, description: "Carbohydrates per 100g (g)" },
              sugar: { type: Type.NUMBER, description: "Sugar per 100g (g)" },
              totalFibre: { type: Type.NUMBER, description: "Total fibre per 100g (g)" },
              sodium: { type: Type.NUMBER, description: "Sodium per 100g (mg)" },
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

