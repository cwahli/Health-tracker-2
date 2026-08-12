import { z } from "zod";
import { extractBalancedJson } from "./server_pure_helpers";
import { parseLabelCalories } from "./server_budget_reconcile";

export const ScoutItemComponentSchema = z.object({
  searchQuery: z.string(),
  volumePercentage: z.number().finite().positive(),
  visualSheen: z.number().min(0.0).max(1.0).optional(),
  visualCoating: z.number().min(0.0).max(1.0).optional(),
  pieceCount: z.number().optional(),
  suggestedFdcId: z.string().nullable().optional(),
});

export const ScoutItemSchema = z.object({
  keyword: z.string().optional(),
  itemConfidence: z.string().optional(),
  estimatedWeightGrams: z.number().finite().nonnegative().optional(),
  /** Soft visual calorie estimate for the WHOLE item portion (not per component, not full macros). */
  estimatedCalories: z.number().finite().nonnegative().nullable().optional(),
  cookingMethod: z.string().optional(),
  components: z.array(ScoutItemComponentSchema).optional(),
  chainName: z.string().nullable().optional(),
}).passthrough();

export const VisionScoutSchema = z.object({
  items: z.array(ScoutItemSchema).optional(),
  diningEnvironment: z.string().optional(),
}).passthrough();

export const scoutSystemInstruction = `System Instruction:
STEP 1: SCENE CLASSIFICATION & ENVIRONMENT
- 'contentType': 'visual' (food photo), 'menu_or_poster' (menu/kiosk screen), 'label' (nutrition panel), or 'text'.
- 'diningEnvironment': 'casual_restaurant' | 'fast_food_chain' | 'home_cooked' | 'fine_dining' | 'airline' | 'unknown'.

STEP 2: UNIVERSAL DISH EXTRACTION & DEDUPLICATION
- USER MESSAGE SCOPE ANCHOR & CONTEXT PACKAGES: The user's text message establishes what was consumed (e.g. "50g Sainsbury oat + fruits"). CRITICAL SPECIFIED PORTION RULE: If the user's text message explicitly specifies a weight or quantity, use your best judgment to assign it to the specific ingredient, or the total dish, based on their phrasing. For example, "50g of oats + fruits" might mean 50g of dry oats alone (plus additional weight for the fruits), or 50g total. Deduce the most logical total estimatedWeightGrams for the item you output. The user's explicit text sentence is the absolute ground truth. Photos of unopened bulk ingredient packages or nutrition panels serve as REFERENCE CONTEXT. IMPORTANT: You MUST extract ALL distinct food items meant for consumption that are visible in the scene (e.g. side plates, fruit bowls, drinks). Do NOT ignore other clearly visible foods just because the user only mentioned one item in their message. Only skip items if they are clearly unopened bulk grocery packaging used merely for context.
- CROSS-IMAGE DEDUPLICATION: If photos show BOTH a menu/kiosk screen AND physical food, extract each distinct dish ONCE across all photos. Do NOT duplicate items or extract physical screens/receipts as food items.
- KNOWN CHAIN & BRAND IDENTIFICATION: For any restaurant chain, brand, or menu item (e.g. McDonald's, Yolk, Starbucks, Pret):
  1. Capture exact brand + dish title in 'originalName' (e.g. "YOLK Steak Chimi 2.0 Sandwich").
  1b. ALSO output the brand/chain name alone (e.g. 'McDonald\'s', not 'McDonald\'s Big Mac') in the new 'chainName' field. Leave 'chainName' null for home-cooked or non-branded items.
  2. Include brand + dish title in 'queriesToSearch' so the server executes live web search and database matching for official nutrients and ingredients.
  3. If calories/macros or ingredients are printed on a visible menu/kiosk screen or package, transcribe them into 'rawNutritionLabel' & 'ingredientsList' with 'source': 'label' (Screen OCR Dominance).
  4. STRICT PRINTED TRUTH IN rawNutritionLabel: Transcribe ONLY values that are literally visible/printed on the image, photo, or kiosk screen into 'rawNutritionLabel'. NEVER invent, guess, or populate unprinted macro fields into 'rawNutritionLabel' using internal parametric memory. If a kiosk photo or menu board only displays calories (e.g. "455 kcal"), set ONLY calories: "455 kcal" in 'rawNutritionLabel' and set missing unprinted fields to null.
  4b. SUGAR FIELDS — TOTAL vs ADDED: 'sugar' = Total Sugars, printed as "Sugars" or "of which sugars" on UK/EU labels, or "Total Sugars" on US labels. Populate 'sugar' whenever any sugar figure is printed. 'addedSugar' must be populated ONLY when the label explicitly and separately prints an "Added Sugars" or "Includes Xg Added Sugars" line (US FDA format). UK/EU labels almost never print this — leave 'addedSugar' null in that case. Do NOT copy the 'sugar' value into 'addedSugar' — the backend derives Added Sugar itself from food type and ingredients.
- PARTIAL TRUTH TRANSCRIPTION & VISUAL TRACKING: Transcribe whatever partial truth is literally visible on the screen/label/menu (even if only calories, e.g. "450 kcal", or 8-10 key nutrients) into 'rawNutritionLabel'. Set 'lockedNutrientKeys' to an array of lowercase nutrient names that were literally visible (e.g. ["calories"]). NEVER invent unprinted fields in 'rawNutritionLabel'. Simultaneously, ALWAYS visually inspect and decompose dish ingredients in 'components' & 'visualIngredients' so the engine can extrapolate the full 31-nutrient profile using first principles anchored by the printed truth.

STEP 3: COMPONENT DECOMPOSITION, CLINICAL QUERIES & LABELS
- CLINICAL ENGLISH & USDA QUERY INVERSION: For all components and generic items, format the 'keyword' and 'searchQuery' in strict, clinical USDA-style inversion syntax: "Noun, descriptor, preparation" (e.g., "Egg, whole, cooked, hard-boiled", "Lettuce, iceberg, raw", "Chicken, breast, grilled"). Use pure clinical English.
- OPTIONAL VERIFIED FDC HINT: For a component that is a well-known, unambiguous USDA standard reference food (e.g. a raw whole egg, a raw avocado, plain grilled chicken breast, raw iceberg lettuce) AND you are highly confident of its exact USDA FoodData Central ID from memory, populate 'suggestedFdcId' with that numeric ID as a string. Leave 'suggestedFdcId' null for anything ambiguous, branded, packaged, a prepared/composite dish, or any component you are not fully certain of — the backend verifies this ID and silently ignores it if wrong, but an unnecessary guess wastes a lookup. When in doubt, leave it null.
- PREPARATION FAT & OILS: For any deep-fried, pan-fried, or heavily glazed items, explicitly extract the cooking oil or butter as a separate component (e.g., "Oil, vegetable, canola", "Butter, salted"). Assign it a realistic mass percentage.
- MASS PERCENTAGE OVER VOLUME: When estimating component ratios, strongly prefer estimating 'massPercentage' (weight) over pure 'volumePercentage'.
- BRAND SEPARATION: Keep brand names in 'originalName' or 'chainName'. Do not mash brand names into the 'keyword' or 'searchQuery' for generic components unless it's a specific branded component (e.g., "Sainsbury oat").
- COMPONENT DECOMPOSITION (< 15 items): Decompose cooked dishes into raw 'components' (volume % totaling 100%, including oils, dressings, and sauces). Set precise boundingBox2D [ymin, xmin, ymax, xmax].
- COMPACT MODE (>= 15 items): Group high-density menus by category blocks or shelf rows.
- PACKAGE LABELS (HARDENED FOR UK/EU & MULTI-COLUMN FORMATS):
  - PRESERVE BRAND IN COMPONENTS: If the user explicitly mentions a brand name for an ingredient (e.g., "Sainsbury oat"), you MUST preserve that brand name in the component's 'searchQuery' (e.g., "Sainsbury rolled oats" or "Sainsbury oat"). Do not strip the brand name from the component query.
  1. FORCE THE 100G BASELINE: Standard UK/EU nutrition labels always include a "Per 100g" (or "Typical values per 100g") column by law. If multiple columns are present (e.g., "Per 100g" and "Per 1/4 pot" or "Per Serving"), you MUST always extract the "Per 100g" column data for nutrients and set "servingSize" to "100g" in 'rawNutritionLabel'. This completely eliminates the risk of column-hopping and ensures consistent backend scaling calculations.
  2. DEFINE & DEDUCE SERVING WEIGHTS: If you are extracting a portion-based serving size instead of 100g, or if a textual portion size is given, you MUST deduce or calculate the numerical gram weight of that serving size. For example: "If serving size is '1/4 pot' and total weight is 160g, deduce/calculate and output '40g' for the 'servingSize'". Ensure textual portion size descriptions (like "1/4 pack", "1/2 carton", "1 slice") are mapped to their calculated actual gram weight inside 'rawNutritionLabel' so that the backend parser can correctly parse it as a number and prevent macro-overflow anomalies.
  3. If label lists 'Salt', transcribe into 'salt' with "sodium": null for backend conversion.
- SOFT ITEM CALORIE ESTIMATE (REQUIRED for visual food items): For EACH distinct food item (dish), set "estimatedCalories" to a single rough total kcal for the portion you see (the whole item, not each component). Examples: restaurant mac & cheese plate ~550-750; composed salad bowl ~400-600; yogurt granola fruit cup ~300-500. This is a SOFT prior for the server — NOT printed truth. Do NOT put estimatedCalories into rawNutritionLabel. rawNutritionLabel calories remain ONLY for literally printed values. Do NOT invent protein/fat/sodium — only this one calorie number per item plus existing structure fields.
- NAMES: 'keyword' = clean English database query. 'originalName' = exact local/printed dish name (Do NOT translate).

=== SYSTEM CONSTRAINTS ===
Output exactly ONE JSON object matching this schema. NEVER omit keys; use null or 'unknown' if inapplicable.

{
  "_internalReasoning": "string",
  "contentType": "visual | menu_or_poster | text",
  "diningEnvironment": "home_cooked | casual_restaurant | fast_food_chain | fine_dining | airline | unknown",
  "items": [
    {
      "keyword": "string",
      "originalName": "string",
      "chainName": "string | null",
      "rawNutritionLabel": { "servingSize": "Perpack", "calories": "90 kcal", "protein": "2g", "totalFat": "0g", "saturatedFat": "0g", "totalCarbohydrate": "22g", "sugar": "17g", "addedSugar": null, "sodium": null, "salt": "0.53g" },
      "ingredientsList": "string | null",
      "estimatedWeightGrams": "number",
      "estimatedCalories": "number",
      "components": [{ "searchQuery": "string", "volumePercentage": "number", "suggestedFdcId": "string | null" }],
      "visualIngredients": ["string"],
      "source": "label | visual",
      "boundingBox2D": [150, 200, 800, 750],
      "sourceImageIndex": 0,
      "nutritionFacts": "{}",
      "anomalyFlags": ["string"],
      "itemConfidence": "High | Medium | Low",
      "cookingMethod": "deep_fried | pan_fried | stir_fried | roasted | boiled | steamed | grilled | baked | raw | unknown"
    }
  ],
  "cookingMethod": "string",
  "scanCompleteness": "full | partial",
  "queriesToSearch": ["string"]
}
`;

function validateOrFallback<T>(
  schema: z.ZodType<T>,
  parsed: any,
  rawText: string,
  label: string,
  fallback: T,
  addDebugLog: (msg: string) => void
): T {
  const result = schema.safeParse(parsed);
  if (!result.success) {
    addDebugLog(`[Zod Validation Failed] ${label}: ${result.error.message}. Raw output: ${rawText}`);
    return fallback;
  }
  return result.data;
}

export function mergeScoutItems(visionItems: any[], llmItems: any[] | null | undefined): any[] {
  if (!visionItems || visionItems.length === 0) {
    return (llmItems && llmItems.length > 0) ? llmItems : [];
  }
  if (!llmItems || llmItems.length === 0) {
    return visionItems;
  }
  return visionItems.map((vItem: any, idx: number) => {
    const lItem = llmItems.find((l: any) => l.scoutIndex === vItem.scoutIndex) || llmItems[idx];
    if (lItem) {
      return {
        ...vItem,
        ...lItem,
        rawNutritionLabel: vItem.rawNutritionLabel,
        nutritionFacts: vItem.nutritionFacts,
        ingredientsList: vItem.ingredientsList,
        visualIngredients: vItem.visualIngredients || [],
        boundingBox2D: vItem.boundingBox2D,
        sourceImageIndex: vItem.sourceImageIndex,
        source: vItem.source,
        // Soft scout kcal must survive dietitian merge (same priority as vision OCR fields)
        estimatedCalories: vItem.estimatedCalories ?? lItem.estimatedCalories,
        estimatedWeightGrams: vItem.estimatedWeightGrams ?? lItem.estimatedWeightGrams,
        // Component structure: vision wins when present; never let empty LLM array wipe vision rows
        components:
          Array.isArray(vItem.components) && vItem.components.length > 0
            ? vItem.components
            : (lItem.components ?? vItem.components),
      };
    }
    return vItem;
  });
}

export interface VisionScoutResult {
  items: any[];
  scoutConfidenceRating: string;
  scoutConfidenceComment: string;
  scoutCookingMethod: string;
  visionScoutContentType: string;
  scoutRecommendedMode: string | null;
  queriesToSearch: string[];
  visionScoutRanAndReturnedItems: boolean;
  diningEnvironment: string;
}

export function checkScoutSanity(parsedScout: any, addDebugLog: (msg: string) => void): { valid: boolean; reason?: string } {
  if (!parsedScout || typeof parsedScout !== "object") {
    return { valid: false, reason: "Parsed scout output is null or not an object" };
  }

  const items = parsedScout.items;
  if (!items || !Array.isArray(items)) {
    return { valid: false, reason: "Parsed scout output lacks 'items' array" };
  }

  const jsonKeyHeuristics = [
    "components", "searchquery", "cookingmethod", "itemconfidence", 
    "estimatedweightgrams", "originalname", "boundingbox2d", "sourceimageindex",
    "anomalyflags", "visualingredients", "ingredientslist", "rawnutritionlabel"
  ];

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    if (!item || typeof item !== "object") {
      return { valid: false, reason: `Item at index ${idx} is not an object` };
    }

    // 1. Check lengths of string fields on the item itself
    for (const [key, value] of Object.entries(item)) {
      if (typeof value === "string") {
        const isLongTextField = key === 'ingredientsList' || 
                                key === 'confidenceComment' || 
                                key === 'scoutConfidenceComment' || 
                                key === 'description' || 
                                key === 'notes' ||
                                key === 'reason' ||
                                key === 'summary';
        const maxLen = isLongTextField ? 3000 : 150;
        if (value.length > maxLen) {
          return {
            valid: false,
            reason: `Item field '${key}' length (${value.length}) exceeds ${maxLen} characters. Field value: "${value.substring(0, 100)}..."`
          };
        }
        const valLower = value.toLowerCase();
        if (!isLongTextField && jsonKeyHeuristics.some(h => valLower.includes(h + '"') || valLower.includes(h + ':'))) {
          return {
            valid: false,
            reason: `Item field '${key}' contains raw JSON-like keys: "${value.substring(0, 100)}..."`
          };
        }
      }
    }

    // 2. Check visualIngredients
    if (item.visualIngredients !== undefined && item.visualIngredients !== null) {
      if (!Array.isArray(item.visualIngredients)) {
        return { valid: false, reason: `Item visualIngredients is not an array at index ${idx}` };
      }
      if (item.visualIngredients.length > 20) {
        return {
          valid: false,
          reason: `Item visualIngredients array has ${item.visualIngredients.length} entries (limit 20) at index ${idx}`
        };
      }
      for (let j = 0; j < item.visualIngredients.length; j++) {
        const ing = item.visualIngredients[j];
        if (typeof ing !== "string") {
          return { valid: false, reason: `visualIngredients entry at index ${j} of item ${idx} is not a string` };
        }
        if (ing.length > 250) {
          return {
            valid: false,
            reason: `visualIngredients entry at index ${j} of item ${idx} length (${ing.length}) exceeds 250 characters. Value: "${ing.substring(0, 100)}..."`
          };
        }
        const ingLower = ing.toLowerCase();
        if (jsonKeyHeuristics.some(h => ingLower.includes(h + '"') || ingLower.includes(h + ':'))) {
          return {
            valid: false,
            reason: `visualIngredients entry at index ${j} of item ${idx} looks like JSON: "${ing.substring(0, 100)}..."`
          };
        }
      }
    }

    // 3. Check components
    if (item.components !== undefined && item.components !== null) {
      if (!Array.isArray(item.components)) {
        return { valid: false, reason: `Item components is not an array at index ${idx}` };
      }
      for (let j = 0; j < item.components.length; j++) {
        const comp = item.components[j];
        if (comp && typeof comp === "object") {
          for (const [ckey, cval] of Object.entries(comp)) {
            if (typeof cval === "string") {
              const compMaxLen = (ckey === 'ingredients' || ckey === 'description' || ckey === 'notes' || ckey === 'ingredientsList') ? 3000 : 250;
              if (cval.length > compMaxLen) {
                return {
                  valid: false,
                  reason: `Component field '${ckey}' at index ${j} of item ${idx} length (${cval.length}) exceeds ${compMaxLen} characters`
                };
              }
            }
          }
        }
      }
    }
  }

  return { valid: true };
}

export function resolvePackageAndContextItems(
  items: any[],
  addDebugLog: (msg: string) => void,
  userMessage: string = ""
): any[] {
  if (!items || items.length <= 1) return items || [];

  const LABEL_STOPWORDS = new Set(["nutrition", "facts", "label", "back", "of", "package", "informasi", "nilai", "gizi", "komposisi", "the", "a", "and", "taste", "difference"]);
  const tokenize = (s: string): string[] =>
    (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/)
      .filter(t => t.length > 2 && !LABEL_STOPWORDS.has(t));

  const nameSimilarity = (strA: string, strB: string): number => {
    const tokensA = tokenize(strA);
    const tokensB = tokenize(strB);
    if (tokensA.length === 0 || tokensB.length === 0) return 0;
    const overlap = tokensA.filter(t => tokensB.includes(t)).length;
    return overlap / Math.min(tokensA.length, tokensB.length);
  };

  const isBulkPackageItem = (item: any): boolean => {
    const name = (item.originalName || item.keyword || "").toLowerCase();
    const weight = Number(item.estimatedWeightGrams) || 0;
    const raw = item.rawNutritionLabel;
    // Real printed calories only — empty {calories:null,...} shells from scout must NOT count
    const printedCal =
      raw &&
      raw.calories != null &&
      String(raw.calories).trim() !== "" &&
      String(raw.calories).toLowerCase() !== "null" &&
      parseFloat(String(raw.calories).replace(/[^\d.]/g, "")) > 0;
    const isPackageKeyword =
      /\b(package|packaging|nutrition facts|label only|box of|bag of|carton|tub of|unopened)\b/i.test(name) ||
      name.includes("rolled jumbo oats") ||
      name.includes("whole rolled");
    // Plated multi-component dishes are NEVER bulk packages even if heavy
    const multiComp = Array.isArray(item.components) && item.components.length >= 2;
    if (multiComp && item.source !== "label" && !isPackageKeyword) {
      return false;
    }
    const isBulkWeight = weight >= 500; // was 300 — restaurant entrees often 300–450g
    const looksLikeLabelOnly =
      item.source === "label" ||
      (printedCal && (isPackageKeyword || /\bnutrition\b/i.test(name)));
    return looksLikeLabelOnly && isBulkWeight;
  };

  const contextItemIndices = new Set<number>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (contextItemIndices.has(i)) continue;

    if (isBulkPackageItem(item)) {
      // Guard: multi-component visual meal on the plate is food, not packaging context
      if (
        Array.isArray(item.components) &&
        item.components.length >= 2 &&
        item.source !== "label" &&
        !/\b(package|nutrition facts|unopened)\b/i.test(String(item.originalName || item.keyword || ""))
      ) {
        continue;
      }

      for (let j = 0; j < items.length; j++) {
        if (i === j || contextItemIndices.has(j)) continue;
        const otherItem = items[j];

        let componentMatch = false;
        if (otherItem.components && Array.isArray(otherItem.components)) {
          for (const comp of otherItem.components) {
            const compQuery = comp.searchQuery || comp.name || comp.keyword || "";
            // Require strong overlap ( >= 0.75 ) so "Mac & Cheese" does NOT match component "feta cheese" via "cheese" alone
            if (nameSimilarity(item.originalName || item.keyword, compQuery) >= 0.75) {
              componentMatch = true;
              if (item.rawNutritionLabel) {
                comp.rawNutritionLabel = item.rawNutritionLabel;
              }
              break;
            }
          }
        }

        const dishNameSimilarity = nameSimilarity(item.originalName || item.keyword, otherItem.originalName || otherItem.keyword);

        if (componentMatch || dishNameSimilarity >= 0.5) {
          contextItemIndices.add(i);
          addDebugLog(`[Package Context Filter] Identified bulk package item "${item.originalName || item.keyword}" (${item.estimatedWeightGrams}g) as reference packaging/label context for dish "${otherItem.originalName || otherItem.keyword}". Excluding package from eaten items.`);

          if (item.rawNutritionLabel && (!otherItem.rawNutritionLabel || Object.keys(otherItem.rawNutritionLabel).length === 0)) {
            otherItem.rawNutritionLabel = item.rawNutritionLabel;
          }
          if (item.ingredientsList && !otherItem.ingredientsList) {
            otherItem.ingredientsList = item.ingredientsList;
          }
          break;
        }
      }
    }
  }

  if (userMessage && userMessage.trim().length > 0) {
    const cleanMsg = userMessage.toLowerCase();
    for (let i = 0; i < items.length; i++) {
      if (contextItemIndices.has(i)) continue;
      const item = items[i];
      const name = (item.originalName || item.keyword || "").toLowerCase();

      if (isBulkPackageItem(item) && (cleanMsg.includes("oat") || cleanMsg.includes("fruit") || cleanMsg.includes("50g") || cleanMsg.includes("pack") || cleanMsg.includes("bowl"))) {
        const hasOtherDish = items.some((it, idx) => idx !== i && !contextItemIndices.has(idx) && (it.source === "visual" || (it.components && it.components.length > 0)));
        if (hasOtherDish) {
          contextItemIndices.add(i);
          addDebugLog(`[User Scope Anchor] User text "${userMessage}" anchors eaten meal scope. Excluding reference bulk package "${item.originalName || item.keyword}" (${item.estimatedWeightGrams}g).`);
        }
      }
    }

    // Explicit User Gram Weight Anchor: Check if user message specifies exact portion weight (e.g. "50g of oats")
    const weightMatches = Array.from(cleanMsg.matchAll(/(\d+(?:\.\d+)?)\s*(?:g|grams?)\b/g));
    if (weightMatches.length > 0) {
      weightMatches.forEach((m) => {
        const explicitWeight = parseFloat(m[1]);
        if (explicitWeight > 0 && explicitWeight <= 2000) {
          const matchIdx = m.index || 0;
          const contextBefore = cleanMsg.substring(Math.max(0, matchIdx - 40), matchIdx);
          const contextAfter = cleanMsg.substring(matchIdx, Math.min(cleanMsg.length, matchIdx + m[0].length + 40));
          const contextStr = `${contextBefore} ${contextAfter}`;

          for (let i = 0; i < items.length; i++) {
            if (contextItemIndices.has(i)) continue;
            const item = items[i];
            const nameStr = (item.originalName || item.keyword || '').toLowerCase();
            const words = nameStr.split(/[^a-z0-9]+/);
            const hasWordMatch = words.some(w => w.length >= 3 && contextStr.includes(w));
            if (hasWordMatch || items.length === 1) {
              if (item.components && Array.isArray(item.components) && item.components.length > 1) {
                const matchedComp = item.components.find((c: any) => {
                  const cQuery = (c.searchQuery || c.name || c.keyword || '').toLowerCase();
                  return cQuery.split(/[^a-z0-9]+/).some((w: string) => w.length >= 3 && contextStr.includes(w));
                });
                if (matchedComp && Number(matchedComp.volumePercentage) > 0) {
                  const compPct = Number(matchedComp.volumePercentage) / 100;
                  const targetTotalWeight = Math.round(explicitWeight / compPct);
                  addDebugLog(`[User Explicit Weight Anchor] User text specified ${explicitWeight}g for sub-component "${matchedComp.searchQuery || matchedComp.name}" in composite dish "${item.originalName || item.keyword}". Updating total dish estimatedWeightGrams from ${item.estimatedWeightGrams}g to ${targetTotalWeight}g (component=${explicitWeight}g).`);
                  item.estimatedWeightGrams = targetTotalWeight;
                  break;
                }
              }
              addDebugLog(`[User Explicit Weight Anchor] User text specified ${explicitWeight}g for "${item.originalName || item.keyword}". Updating estimatedWeightGrams from ${item.estimatedWeightGrams}g to ${explicitWeight}g.`);
              item.estimatedWeightGrams = explicitWeight;
              break;
            }
          }
        }
      });
    }
  }

  return items.filter((_, idx) => !contextItemIndices.has(idx));
}

export function parseAndHealVisionScout(
  scoutOutput: any,
  addDebugLog: (msg: string) => void,
  isCompareMode: boolean = false,
  userMessage: string = ""
): VisionScoutResult {
  let parsedScout: any = null;
  let extractedScratchpad = "";
  try {
    parsedScout = typeof scoutOutput === "string" ? JSON.parse(scoutOutput) : scoutOutput;
  } catch (e) {
    const cleanOutput = typeof scoutOutput === "string" ? scoutOutput : JSON.stringify(scoutOutput);
    const jsonStr = extractBalancedJson(cleanOutput);
    extractedScratchpad = cleanOutput.replace(jsonStr, "").trim();
    parsedScout = JSON.parse(jsonStr);
  }

  parsedScout = validateOrFallback(
    VisionScoutSchema,
    parsedScout,
    typeof scoutOutput === "string" ? scoutOutput : JSON.stringify(scoutOutput),
    "Vision Scout",
    { items: [] },
    addDebugLog
  );

  let visionScoutItems: any[] = [];
  let scoutConfidenceRating = "High (>90%)";
  let scoutConfidenceComment = "";
  let scoutCookingMethod = "";
  let visionScoutContentType = "visual";
  let scoutRecommendedMode: string | null = null;
  let queriesToSearch: string[] = [];
  let visionScoutRanAndReturnedItems = false;
  let diningEnvironment = "casual_restaurant";

  if (parsedScout) {
    let lowestConfidence = "High (>90%)";
    let globalComment = "";
    if (parsedScout.queriesToSearch && Array.isArray(parsedScout.queriesToSearch)) {
      parsedScout.queriesToSearch.forEach((q: any) => {
        if (typeof q === 'string' && q.trim()) {
          queriesToSearch.push(q.trim());
        }
      });
    }
    if (parsedScout.diningEnvironment) {
      diningEnvironment = parsedScout.diningEnvironment;
    }
    if (Array.isArray(parsedScout.items)) {
      for (const it of parsedScout.items) {
        if (it.itemConfidence && it.itemConfidence.toLowerCase().includes("low")) {
          lowestConfidence = "Low (<50%)";
        } else if (it.itemConfidence && it.itemConfidence.toLowerCase().includes("medium") && lowestConfidence !== "Low (<50%)") {
          lowestConfidence = "Medium (50-90%)";
        }
        if (Array.isArray(it.anomalyFlags) && it.anomalyFlags.length > 0) {
          globalComment += `[${it.keyword}]: ${it.anomalyFlags.join(', ')}. `;
        }
      }
    }
    scoutConfidenceRating = lowestConfidence;
    scoutConfidenceComment = globalComment.trim();
    scoutCookingMethod = parsedScout.cookingMethod || "";
    const rawType = (parsedScout.contentType || "").toLowerCase();
    visionScoutContentType = (rawType === "text" || rawType === "menu_or_poster" || rawType === "visual_or_posted") ? rawType : "visual";
    scoutRecommendedMode = parsedScout.recommendedMode || null;
    if (parsedScout.items && parsedScout.items.length <= 1 && scoutRecommendedMode === "evaluation") {
      scoutRecommendedMode = "new_log";
    }

    // Parse compactSpreadsheet if present
    if (Array.isArray(parsedScout.compactSpreadsheet) && parsedScout.compactSpreadsheet.length > 0) {
      const spreadsheetItems: any[] = [];
      parsedScout.compactSpreadsheet.forEach((row: string) => {
        if (!row || typeof row !== 'string') return;
        const parts = row.split('|');
        
        if (parts.length >= 5) {
          const category = parts[0]?.trim();
          const keyword = parts[1]?.trim();
          const originalName = parts[2]?.trim();
          const weightOrPrice = parts[3]?.trim();
          const bboxStr = parts[4]?.trim();
          
          let weightGrams = 150;
          if (weightOrPrice) {
            const cleanWeight = parseFloat(weightOrPrice.replace(/[^0-9.]/g, ''));
            if (!isNaN(cleanWeight)) {
              weightGrams = cleanWeight > 50 ? cleanWeight : 300;
            }
          }
          
          let boundingBox2D = [0, 0, 1000, 1000];
          if (bboxStr) {
            const coords = bboxStr.split(',').map(c => parseFloat(c.trim()));
            if (coords.length === 4 && coords.every(num => !isNaN(num))) {
              boundingBox2D = coords;
            }
          }
          
          spreadsheetItems.push({
            keyword,
            originalName: category ? `[${category}] ${originalName}` : originalName,
            estimatedWeightGrams: weightGrams,
            source: "visual",
            boundingBox2D,
            sourceImageIndex: 0
          });
        } else if (parts.length >= 4) {
          const keyword = parts[0]?.trim();
          const originalName = parts[1]?.trim();
          const weightGrams = parseFloat(parts[2]?.trim()) || 100;
          const bboxStr = parts[3]?.trim();
          let boundingBox2D = [0, 0, 1000, 1000];
          if (bboxStr) {
            const coords = bboxStr.split(',').map(c => parseFloat(c.trim()));
            if (coords.length === 4 && coords.every(num => !isNaN(num))) {
              boundingBox2D = coords;
            }
          }
          spreadsheetItems.push({
            keyword,
            originalName,
            estimatedWeightGrams: weightGrams,
            source: "visual",
            boundingBox2D,
            sourceImageIndex: 0
          });
        }
      });
      if (spreadsheetItems.length > 0) {
        if (!Array.isArray(parsedScout.items)) {
          parsedScout.items = [];
        }
        parsedScout.items = [...parsedScout.items, ...spreadsheetItems];
      }
    }

    if (Array.isArray(parsedScout.items)) {
      let explodedItems: any[] = [];
      parsedScout.items.forEach((item: any) => {
        const rawOriginal = item.originalName || item.keyword || "";
        const hasPrintedMacros = item.rawNutritionLabel && 
                   (item.rawNutritionLabel.calories || item.rawNutritionLabel.protein || item.rawNutritionLabel.totalFat);
        const hasMultipleCommas = (rawOriginal.match(/,/g) || []).length >= 2;
        const hasComponents = Array.isArray(item.components) && item.components.length > 0;

        // If the item ALREADY has a structured component breakdown, keep it intact as a single dish!
        // Exploding by comma is ONLY for legacy multi-item strings without component breakdowns.
        if (!hasPrintedMacros && hasMultipleCommas && !hasComponents) {
          const dishNames = rawOriginal.split(",").map((n: string) => n.trim()).filter((n: string) => n.length > 0);
          const splitWeight = Math.round((item.estimatedWeightGrams || 300) / Math.max(1, dishNames.length));

          dishNames.forEach((dishName: string) => {
            const cleanDishName = dishName.replace(/^(and|or)\s+/i, '').trim();
            if (!cleanDishName) return;

            let singleComponent = [{ searchQuery: cleanDishName, volumePercentage: 100 }];
            explodedItems.push({
              ...item,
              originalName: cleanDishName,
              keyword: cleanDishName,
              name: cleanDishName,
              estimatedWeightGrams: splitWeight,
              components: singleComponent
            });
          });
        } else {
          explodedItems.push(item);
        }
      });

      visionScoutItems = explodedItems.map((item: any, idx: number) => {
        let newItem = { ...item, scoutIndex: idx };
        if (!newItem.boundingBox2D || !Array.isArray(newItem.boundingBox2D) || newItem.boundingBox2D.length !== 4) {
          newItem.boundingBox2D = [100, 100, 900, 900];
        }
        if (newItem.sourceImageIndex === undefined || newItem.sourceImageIndex === null) {
          newItem.sourceImageIndex = 0;
        }
        const rawLabelHasRealDataCheck = newItem.rawNutritionLabel && typeof newItem.rawNutritionLabel === 'object'
          ? Object.keys(newItem.rawNutritionLabel).some((k: string) => {
              if (k === 'servingSize' || k === 'weight' || k === 'servingsPerContainer') return false;
              const v = newItem.rawNutritionLabel[k];
              return v !== undefined && v !== null && v !== '' && v !== '-' && v !== '--';
            })
          : false;
        if (newItem.source === 'label' || (newItem.ingredientsList && String(newItem.ingredientsList).trim().length > 0) || rawLabelHasRealDataCheck) {
          newItem.visualIngredients = [];
        }
        if (newItem.rawNutritionLabel && typeof newItem.rawNutritionLabel === 'object') {
          for (const k of Object.keys(newItem.rawNutritionLabel)) {
            if (typeof newItem.rawNutritionLabel[k] === 'string' && newItem.rawNutritionLabel[k].length > 100) {
              newItem.rawNutritionLabel[k] = newItem.rawNutritionLabel[k].substring(0, 50).trim();
            }
          }
        }
        const rawLabelHasRealData = newItem.rawNutritionLabel && typeof newItem.rawNutritionLabel === 'object'
          ? Object.keys(newItem.rawNutritionLabel).some((k: string) => {
              if (k === 'servingSize' || k === 'weight' || k === 'servingsPerContainer') return false;
              const v = newItem.rawNutritionLabel[k];
              return v !== undefined && v !== null && v !== '' && v !== '-' && v !== '--';
            })
          : false;
        if (newItem.rawNutritionLabel && typeof newItem.rawNutritionLabel === 'object' && rawLabelHasRealData) {
          const getVal = (key: string): number => {
            const val = newItem.rawNutritionLabel[key];
            if (val === undefined || val === null || val === '' || val === '-' || val === '--') return 0;
            if (key.toLowerCase().includes('calories') || key.toLowerCase().includes('energy')) {
              const parsed = parseLabelCalories(val);
              if (parsed !== null) return parsed;
            }
            const match = String(val).match(/[\d.]+/);
            return match ? parseFloat(match[0]) : 0;
          };
          const getRawVal = (key: string): number | null => {
            const val = newItem.rawNutritionLabel[key];
            if (val === undefined || val === null || val === '' || val === '-' || val === '--') return null;
            if (key.toLowerCase().includes('calories') || key.toLowerCase().includes('energy')) {
              return parseLabelCalories(val);
            }
            const match = String(val).match(/[\d.]+/);
            return match ? parseFloat(match[0]) : null;
          };

          if (!newItem.rawNutritionLabel) newItem.rawNutritionLabel = {};
          const rawCalVal = newItem.rawNutritionLabel.calories ?? newItem.rawNutritionLabel.energy;
          if (rawCalVal != null) {
            const parsedC = parseLabelCalories(rawCalVal);
            if (parsedC !== null && parsedC > 0) {
              newItem.rawNutritionLabel.calories = `${parsedC} kcal`;
            }
          }
          
          const fat = getVal('totalFat') || getVal('fat') || 0;
          const carbs = getVal('totalCarbohydrate') || getVal('carbohydrate') || getVal('carbohydrates') || 0;
          const protein = getVal('protein') || 0;
          
          // 1. Fat Overflow (Saturated Fat > Total Fat)
          const satFat = getVal('saturatedFat') || 0;
          let correctedFat = fat;
          if (satFat > fat) {
            correctedFat = satFat;
            if (!newItem.anomalyFlags) newItem.anomalyFlags = [];
            newItem.anomalyFlags.push(`fat overflow corrected: totalFat increased from ${fat} to ${satFat}`);
            if (!newItem.rawNutritionLabel) newItem.rawNutritionLabel = {};
            if (newItem.rawNutritionLabel.totalFat !== undefined) newItem.rawNutritionLabel.totalFat = satFat;
            else newItem.rawNutritionLabel.fat = satFat;
          }
          
          // 2. Serving Mismatch / Macros Overflow
          let servingSizeGrams = 100; // default for per 100g
          if (newItem.rawNutritionLabel && newItem.rawNutritionLabel.servingSize) {
            const ssStr = String(newItem.rawNutritionLabel.servingSize).toLowerCase();
            const ssMatch = ssStr.match(/[\d.]+/);
            if (ssStr.includes('pack') || ssStr.includes('wrap') || ssStr.includes('container') || ssStr.includes('portion')) {
              servingSizeGrams = newItem.estimatedWeightGrams > 0 ? newItem.estimatedWeightGrams : 100;
            } else if (ssMatch) {
              servingSizeGrams = parseFloat(ssMatch[0]) || 100;
            }
          }
          const totalMacros = correctedFat + carbs + protein;
          if (totalMacros > servingSizeGrams + 2) {
            if (!newItem.anomalyFlags) newItem.anomalyFlags = [];
            newItem.anomalyFlags.push(`macros overflow: sum of fat, carbs, protein (${totalMacros}g) exceeds serving size (${servingSizeGrams}g)`);
          }

          // 3. The Algebraic Healer
          const safeMath = (value: number) => Math.max(0, Math.round(value * 10) / 10);
          const expectedCalories = (correctedFat * 9) + (carbs * 4) + (protein * 4);
          const rawC = getRawVal('calories') ?? getRawVal('energiTotal') ?? getRawVal('energy');

          const missingFat = getRawVal('totalFat') === null && getRawVal('fat') === null;
          const missingCarbs = getRawVal('totalCarbohydrate') === null && getRawVal('carbohydrate') === null && getRawVal('carbs') === null;
          const missingProtein = getRawVal('protein') === null;
          const knownMacrosCount = (!missingFat ? 1 : 0) + (!missingCarbs ? 1 : 0) + (!missingProtein ? 1 : 0);

          const healAnomaly = (itm: any, macroName: string) => {
              if (itm.anomalyFlags && Array.isArray(itm.anomalyFlags)) {
                  itm.anomalyFlags = itm.anomalyFlags.filter((f: string) => !f.toLowerCase().includes(macroName) && !f.toLowerCase().includes('legible'));
                  if (itm.anomalyFlags.length === 0) {
                     itm.itemConfidence = "High";
                  }
              }
          };

          if (!newItem.rawNutritionLabel) newItem.rawNutritionLabel = {};
          if (rawC !== null && expectedCalories > 0 && Math.abs(expectedCalories - rawC) / expectedCalories > 0.20) {
              newItem.originalCalories = rawC;
              newItem.autoCorrectedCalories = true;
              newItem.rawNutritionLabel.calories = Math.round(expectedCalories);
              healAnomaly(newItem, "calories");
          } else if (rawC === null && expectedCalories > 0) {
              newItem.rawNutritionLabel.calories = Math.round(expectedCalories);
              healAnomaly(newItem, "calories");
          } else if (knownMacrosCount >= 2 && rawC !== null && rawC > 0) {
              if (correctedFat === 0) {
                  newItem.rawNutritionLabel.totalFat = safeMath((rawC - (carbs * 4) - (protein * 4)) / 9);
                  if (newItem.rawNutritionLabel.fat === 0) { newItem.rawNutritionLabel.fat = newItem.rawNutritionLabel.totalFat; }
                  healAnomaly(newItem, "fat");
              } else if (carbs === 0) {
                  newItem.rawNutritionLabel.totalCarbohydrate = safeMath((rawC - (correctedFat * 9) - (protein * 4)) / 4);
                  if (newItem.rawNutritionLabel.carbohydrates === 0) { newItem.rawNutritionLabel.carbohydrates = newItem.rawNutritionLabel.totalCarbohydrate; }
                  healAnomaly(newItem, "carbohydrates");
                  healAnomaly(newItem, "carbs");
              } else if (protein === 0) {
                  newItem.rawNutritionLabel.protein = safeMath((rawC - (correctedFat * 9) - (carbs * 4)) / 4);
                  healAnomaly(newItem, "protein");
              }
          }

          if (newItem.anomalyFlags && Array.isArray(newItem.anomalyFlags)) {
              newItem.anomalyFlags = newItem.anomalyFlags.filter((f: string) => !f.toLowerCase().includes('ingredient'));
              if (newItem.anomalyFlags.length === 0) {
                  newItem.itemConfidence = "High";
              }
          }

          // Correct a visually-guessed estimatedWeightGrams using the printed "per pack"
          // column, when the label actually prints one. The per-100g values are reliably
          // transcribed; the guessed weight is the error source. Back-calculating weight
          // from (printed pack-total calories / printed per-100g calories) uses the
          // label's own math instead of a visual estimate, and the corrected weight then
          // flows through all the existing per-100g x weight/100 scaling downstream —
          // fixing every nutrient, not just calories.
          if (newItem.rawNutritionLabelPerPack && typeof newItem.rawNutritionLabelPerPack === 'object') {
            const perPackCalMatch = String(newItem.rawNutritionLabelPerPack.calories || '').match(/[\d.]+/);
            const per100CalMatch = String(newItem.rawNutritionLabel?.calories || '').match(/[\d.]+/);
            if (perPackCalMatch && per100CalMatch) {
              const perPackCal = parseFloat(perPackCalMatch[0]);
              const per100Cal = parseFloat(per100CalMatch[0]);
              if (perPackCal > 0 && per100Cal > 0) {
                const correctedWeight = Math.round((perPackCal / per100Cal) * 100);
                if (correctedWeight > 0 && Math.abs(correctedWeight - (newItem.estimatedWeightGrams || 0)) > 5) {
                  const oldWeight = newItem.estimatedWeightGrams;
                  newItem.estimatedWeightGrams = correctedWeight;
                  if (!newItem.anomalyFlags) newItem.anomalyFlags = [];
                  newItem.anomalyFlags.push(`Weight corrected from ${oldWeight}g (visual guess) to ${correctedWeight}g using printed "per pack" calories (${perPackCal}kcal) vs printed "per 100g" calories (${per100Cal}kcal).`);
                  addDebugLog(`[Per-Pack Weight Correction] "${newItem.originalName || newItem.keyword}": estimatedWeightGrams corrected from ${oldWeight}g to ${correctedWeight}g using printed per-pack/per-100g calorie ratio.`);
                }
              }
            }
          }
        }
        return newItem;
      });

      // Merge standalone label items (e.g., from back of package photo) into primary packaged product item.
      // IDENTITY-BASED matching: a label may only merge into a food item it can be shown to
      // belong to (name/token similarity and/or adjacent sourceImageIndex). It must never merge
      // into "whichever other item happens to lack data yet" — that's array-order coincidence,
      // not evidence of the same product, and silently cross-wires unrelated items (e.g. attaching
      // a milk bottle's label to a burger just because the burger appears earlier in the list).
      if (visionScoutItems.length > 1) {
        const isLabelContainer = (item: any) => {
          const orig = (item.originalName || item.keyword || "").toLowerCase();
          const isLabelName = orig.includes("nutrition fact") || orig.includes("informasi nilai gizi") || orig.includes("komposisi") || orig.includes("nutrition label") || orig.includes("back of package") || orig.includes("printed_packaging_label");

          const hasRealData = item.rawNutritionLabel && typeof item.rawNutritionLabel === 'object'
            ? Object.keys(item.rawNutritionLabel).some((k: string) => {
                if (k === 'servingSize' || k === 'weight' || k === 'servingsPerContainer') return false;
                const v = item.rawNutritionLabel[k];
                return v !== undefined && v !== null && v !== '' && v !== '-' && v !== '--';
              })
            : false;

          const hasIngredients = item.ingredientsList && String(item.ingredientsList).trim().length > 0;

          return isLabelName || ((hasRealData || hasIngredients) && (!item.keyword || item.keyword.toLowerCase().includes("label") || item.keyword.toLowerCase().includes("nutrition") || item.keyword.toLowerCase().includes("back of package")));
        };

        // Token-overlap similarity between a label's own name (e.g. "Organic Semi-Skimmed Milk
        // Nutrition Facts Label") and a candidate food item's name (e.g. "Organic Semi-Skimmed Milk").
        // Strip label-only vocabulary first so it doesn't dilute the comparison.
        const LABEL_STOPWORDS = new Set(["nutrition", "facts", "label", "back", "of", "package", "informasi", "nilai", "gizi", "komposisi", "the", "a", "and"]);
        const tokenize = (s: string): string[] =>
          (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/)
            .filter(t => t.length > 2 && !LABEL_STOPWORDS.has(t));

        const normalizeToken = (t: string): string => t.endsWith('s') && t.length > 3 ? t.slice(0, -1) : t;
        const nameSimilarity = (labelItem: any, candidate: any): number => {
          const labelTokens = tokenize(labelItem.originalName || labelItem.keyword || "").map(normalizeToken);
          const candTokens = tokenize(candidate.originalName || candidate.keyword || "").map(normalizeToken);
          if (labelTokens.length === 0 || candTokens.length === 0) return 0;
          const overlap = labelTokens.filter(t => candTokens.includes(t)).length;
          return overlap / Math.min(labelTokens.length, candTokens.length);
        };

        // Process every label item found (not just the first) so multi-package uploads with
        // several distinct labels each find their own correct product.
        let labelIdx: number;
        while ((labelIdx = visionScoutItems.findIndex(isLabelContainer)) !== -1) {
          const labelItem = visionScoutItems[labelIdx];

          const candidates = visionScoutItems
            .map((it, idx) => ({ it, idx }))
            .filter(({ it, idx }) => idx !== labelIdx && !isLabelContainer(it));

          let primaryItem: any = null;

          // Signal A: same sourceImageIndex as the label (a label photographed together with
          // its product in one frame) always wins outright.
          const sameImageMatch = candidates.find(({ it }) =>
            it.sourceImageIndex !== undefined && labelItem.sourceImageIndex !== undefined &&
            it.sourceImageIndex === labelItem.sourceImageIndex
          );
          if (sameImageMatch) primaryItem = sameImageMatch.it;

          // Signal B: strongest name/token similarity above a real threshold — proves the label
          // text (e.g. "Organic Semi-Skimmed Milk...") actually names the candidate product.
          if (!primaryItem) {
            let bestScore = 0;
            let bestCandidate: any = null;
            for (const { it } of candidates) {
              const score = nameSimilarity(labelItem, it);
              if (score > bestScore) {
                bestScore = score;
                bestCandidate = it;
              }
            }
            if (bestCandidate && bestScore >= 0.5) {
              primaryItem = bestCandidate;
            }
          }

          // Fallback: only when totally unambiguous by construction (exactly 2 items total).
          if (!primaryItem && visionScoutItems.length === 2) {
            primaryItem = candidates[0]?.it || null;
          }

          if (!primaryItem) {
            // No confident match found (3+ items, no image/name signal). Leave the label as its
            // own item rather than guessing — a wrong guess silently corrupts a different item's
            // data, which is worse than an unmerged label the dietitian agent can still read.
            addDebugLog(`[Label Merge] Could not confidently match label "${labelItem.originalName || labelItem.keyword}" (sourceImageIndex=${labelItem.sourceImageIndex}) to any food item. Leaving unmerged rather than guessing.`);
            break;
          }

          addDebugLog(`[Label Merge] Matched label "${labelItem.originalName || labelItem.keyword}" (sourceImageIndex=${labelItem.sourceImageIndex}) -> "${primaryItem.originalName || primaryItem.keyword}" (sourceImageIndex=${primaryItem.sourceImageIndex}).`);

          if (labelItem.rawNutritionLabel && Object.keys(labelItem.rawNutritionLabel).length > 0) {
            primaryItem.rawNutritionLabel = {
              ...(primaryItem.rawNutritionLabel || {}),
              ...labelItem.rawNutritionLabel
            };
          }
          if (labelItem.ingredientsList) {
            primaryItem.ingredientsList = labelItem.ingredientsList;
          }
          primaryItem.labelProductName = (labelItem.originalName || labelItem.keyword || null)?.replace(/\s*(nutrition\s*facts?\s*label|nutrition\s*label|nutrition\s*facts?)\s*$/i, '').trim() || null;
          primaryItem.visualIngredients = [];
          visionScoutItems.splice(labelIdx, 1);
        }
      }

      // Multi-Photo Fuzzy Package Deduplication Engine
      // Merges items from multi-photo package uploads that represent the same product from different camera angles
      if (visionScoutItems.length > 1) {
        const mergedList: any[] = [];
        for (let i = 0; i < visionScoutItems.length; i++) {
          const itemA = visionScoutItems[i];
          let isDuplicate = false;

          for (let j = 0; j < mergedList.length; j++) {
            const itemB = mergedList[j];

            const nameA = (itemA.originalName || itemA.keyword || "").toLowerCase();
            const nameB = (itemB.originalName || itemB.keyword || "").toLowerCase();

            const tokensA = nameA.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((t: string) => t.length > 2);
            const tokensB = nameB.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((t: string) => t.length > 2);

            const overlapCount = tokensA.filter((t: string) => tokensB.includes(t)).length;
            const minLen = Math.min(tokensA.length, tokensB.length);
            const overlapRatio = minLen > 0 ? overlapCount / minLen : 0;

            const calA = itemA.rawNutritionLabel?.calories || null;
            const calB = itemB.rawNutritionLabel?.calories || null;
            const samePrintedCalories = calA !== null && calB !== null && calA === calB;

            const sameSourceImage = itemA.sourceImageIndex !== undefined
              && itemB.sourceImageIndex !== undefined
              && itemA.sourceImageIndex === itemB.sourceImageIndex;

            const cleanKeyA = (itemA.originalName || itemA.keyword || "").toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
            const cleanKeyB = (itemB.originalName || itemB.keyword || "").toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
            const exactKeyMatch = cleanKeyA.length > 0 && cleanKeyA === cleanKeyB;

            const hasLabelA = itemA.rawNutritionLabel && Object.keys(itemA.rawNutritionLabel).some((k: string) => itemA.rawNutritionLabel[k] !== null && itemA.rawNutritionLabel[k] !== undefined && itemA.rawNutritionLabel[k] !== "");
            const hasLabelB = itemB.rawNutritionLabel && Object.keys(itemB.rawNutritionLabel).some((k: string) => itemB.rawNutritionLabel[k] !== null && itemB.rawNutritionLabel[k] !== undefined && itemB.rawNutritionLabel[k] !== "");

            // Cross-image deduplication engine:
            // Merges items detected across different photos of the same meal (e.g. kiosk screen photo vs actual food photo)
            // DISABLED in compare mode, since the user is intentionally uploading multiple distinct items to compare.
            const isCrossImageDuplicate = !isCompareMode && !sameSourceImage && (
              (samePrintedCalories && overlapRatio >= 0.4) ||
              exactKeyMatch ||
              ((hasLabelA || hasLabelB) && overlapRatio >= 0.5) ||
              (overlapRatio >= 0.7)
            );

            if (isCrossImageDuplicate) {
              addDebugLog(`[Multi-Photo Merge] Merged duplicate cross-photo item "${itemA.originalName || itemA.keyword}" (Image ${itemA.sourceImageIndex}) into "${itemB.originalName || itemB.keyword}" (Image ${itemB.sourceImageIndex}).`);
              if (itemA.ingredientsList && !itemB.ingredientsList) {
                itemB.ingredientsList = itemA.ingredientsList;
              }
              if (hasLabelA && (!hasLabelB || Object.keys(itemB.rawNutritionLabel || {}).length === 0)) {
                itemB.rawNutritionLabel = itemA.rawNutritionLabel;
              } else if (hasLabelA && hasLabelB) {
                itemB.rawNutritionLabel = { ...itemA.rawNutritionLabel, ...itemB.rawNutritionLabel };
              }
              if (itemA.components && Array.isArray(itemA.components) && itemA.components.length > 0 && (!itemB.components || itemB.components.length === 0)) {
                itemB.components = itemA.components;
              }
              if (itemA.visualIngredients && Array.isArray(itemA.visualIngredients) && itemA.visualIngredients.length > 0 && (!itemB.visualIngredients || itemB.visualIngredients.length === 0)) {
                itemB.visualIngredients = itemA.visualIngredients;
              }
              isDuplicate = true;
              break;
            }
          }

          if (!isDuplicate) {
            mergedList.push(itemA);
          }
        }
        visionScoutItems = mergedList;
      }

      visionScoutItems = resolvePackageAndContextItems(visionScoutItems, addDebugLog, userMessage);

      for (const item of visionScoutItems) {
        if (item.keyword) {
          queriesToSearch.push(item.keyword);
        }
        if (item.components && Array.isArray(item.components) && item.components.length > 0) {
          item.components.forEach((c: any) => {
            const queryName = typeof c === 'string' ? c : (c.searchQuery || c.name || c.keyword);
            if (queryName) {
              queriesToSearch.push(queryName);
            }
          });
        }
        if (item.visualIngredients && Array.isArray(item.visualIngredients)) {
          item.visualIngredients.forEach((v: any) => {
            if (typeof v === 'string' && v.trim()) {
              queriesToSearch.push(v.trim());
            }
          });
        }
        visionScoutRanAndReturnedItems = true;
      }
    }
  }

  // Perform structural sanity check on final items (Fix 2)
  const sanity = checkScoutSanity({ items: visionScoutItems }, addDebugLog);
  if (!sanity.valid) {
    const warningMsg = `[Vision Scout Corrupted] Sanity check failed: ${sanity.reason}`;
    addDebugLog(warningMsg);
    throw new Error(warningMsg);
  }

  return {
    items: visionScoutItems,
    scoutConfidenceRating,
    scoutConfidenceComment,
    scoutCookingMethod,
    visionScoutContentType,
    scoutRecommendedMode,
    queriesToSearch,
    visionScoutRanAndReturnedItems,
    diningEnvironment
  };
}
