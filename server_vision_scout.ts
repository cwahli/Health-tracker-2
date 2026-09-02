import { z } from "zod";
import { extractBalancedJson } from "./server_pure_helpers";
import { parseLabelCalories } from "./server_budget_reconcile";
import { isStandaloneCondimentPacket, reconcileContainerVolumeBudget } from "./server_dish_classify";
import { computeSolubleFibre } from "./server_derivation";
import { deduceSugarBreakdown } from "./server_sugar_engine";
export const ScoutNutrientsSchema = z.object({
  calories: z.number().nullable().optional(), protein: z.number().nullable().optional(),
  totalFat: z.number().nullable().optional(), saturatedFat: z.number().nullable().optional(),
  transFat: z.number().nullable().optional(), addedSugar: z.number().nullable().optional(),
  totalSugar: z.number().nullable().optional(), totalFibre: z.number().nullable().optional(),
  sodium: z.number().nullable().optional(), carbohydrates: z.number().nullable().optional(),
  potassium: z.number().nullable().optional(), omega3: z.number().nullable().optional(),
  calcium: z.number().nullable().optional(), iron: z.number().nullable().optional(),
  magnesium: z.number().nullable().optional(), vitaminD: z.number().nullable().optional(),
}).passthrough();
export const ScoutFoodSchema = z.object({
  foodName: z.string().nullable().optional(), genericEnglishName: z.string().nullable().optional(),
  packageLabelText: z.string().nullable().optional(),
  weightGrams: z.number().finite().nonnegative().nullable().optional(),
  packGrams: z.number().finite().nonnegative().nullable().optional(),
  sourceImageIndex: z.number().nullable().optional(),
  rawNutritionLabel: z.record(z.string(), z.any()).nullable().optional(),
  nutrients: z.object({
    protein: z.number().nullable().optional(), saturatedFat: z.number().nullable().optional(),
    addedSugar: z.number().nullable().optional(), totalFibre: z.number().nullable().optional(),
    sodium: z.number().nullable().optional(), carbohydrates: z.number().nullable().optional(),
  }).passthrough().nullable().optional(),
}).passthrough();
export const ScoutDishSchema = z.object({
  dishName: z.string().nullable().optional(), genericEnglishName: z.string().nullable().optional(),
  chainName: z.string().nullable().optional(), packageLabelText: z.string().nullable().optional(),
  estimatedWeightGrams: z.number().finite().nonnegative().nullable().optional(),
  packGrams: z.number().finite().nonnegative().nullable().optional(),
  cookingMethod: z.string().nullable().optional(), sourceImageIndex: z.number().nullable().optional(),
  boundingBox2D: z.array(z.number()).nullable().optional(),
  isStandaloneCondimentPacket: z.boolean().nullable().optional(),
  foods: z.array(ScoutFoodSchema).nullable().optional(),
  dishNutrients: z.object({
    saturatedFat: z.number().nullable().optional(), totalFat: z.number().nullable().optional(),
    totalSugar: z.number().nullable().optional(), potassium: z.number().nullable().optional(),
    omega3: z.number().nullable().optional(), calcium: z.number().nullable().optional(),
    iron: z.number().nullable().optional(), magnesium: z.number().nullable().optional(),
    vitaminD: z.number().nullable().optional(),
  }).passthrough().nullable().optional(),
}).passthrough();
export const ScoutItemComponentSchema = z.object({
  name: z.string().nullable().optional(), searchQuery: z.string().nullable().optional(),
  weightGrams: z.number().finite().nonnegative().nullable().optional(),
  packGrams: z.number().finite().nonnegative().nullable().optional(),
  volumePercentage: z.number().finite().positive().nullable().optional(),
  visualSheen: z.number().min(0.0).max(1.0).nullable().optional(),
  visualCoating: z.number().min(0.0).max(1.0).nullable().optional(),
  pieceCount: z.number().nullable().optional(), suggestedFdcId: z.string().nullable().optional(),
  rawNutritionLabel: z.record(z.string(), z.any()).nullable().optional(),
  nutrients: z.record(z.string(), z.any()).nullable().optional(),
  calories: z.number().nullable().optional(),
});
export const ScoutItemSchema = z.object({
  originalName: z.string().nullable().optional(), genericEnglishName: z.string().nullable().optional(),
  keyword: z.string().nullable().optional(), itemConfidence: z.string().nullable().optional(),
  weightGrams: z.number().finite().nonnegative().nullable().optional(),
  packGrams: z.number().finite().nonnegative().nullable().optional(),
  estimatedWeightGrams: z.number().finite().nonnegative().nullable().optional(),
  nutrientBasisWeight: z.number().finite().nonnegative().nullable().optional(),
  portionRatio: z.number().nullable().optional(), portionAccepted: z.boolean().nullable().optional(),
  portionDescription: z.string().nullable().optional(),
  /** Soft visual calorie estimate for the WHOLE item portion (legacy mirror of nutrients.calories). */
  estimatedCalories: z.number().finite().nonnegative().nullable().optional(),
  isStandaloneCondimentPacket: z.boolean().nullable().optional(),
  cookingMethod: z.string().nullable().optional(), ingredients: z.array(z.string()).nullable().optional(),
  chainName: z.string().nullable().optional(),
  rawNutritionLabel: z.record(z.string(), z.any()).nullable().optional(),
  nutrients: ScoutNutrientsSchema.nullable().optional(),
  components: z.array(ScoutItemComponentSchema).nullable().optional(),
  ingredientsList: z.string().nullable().optional(),
  lockedNutrientKeys: z.array(z.string()).nullable().optional(),
  boundingBox2D: z.array(z.number()).nullable().optional(),
  sourceImageIndex: z.number().nullable().optional(),
}).passthrough();
const LABEL_STOPWORDS = new Set([
  'nutrition', 'facts', 'label', 'back', 'of', 'package', 'informasi', 'nilai', 'gizi', 'komposisi', 'the', 'a', 'and',
]);
const GENERIC_FOOD_TOKENS = new Set([
  'ham', 'pork', 'chicken', 'beef', 'meat', 'cheese', 'milk', 'bread', 'rice', 'pasta', 'sauce', 'salad',
  'juice', 'water', 'oil', 'salt', 'sugar', 'egg', 'fruit', 'slice', 'sliced', 'cured', 'cooked',
]);
const HAM_DRY_CURED = new Set(['serrano', 'iberico', 'prosciutto', 'parma', 'jamon', 'reserva', 'gran']);
const HAM_COOKED_FORMED = new Set(['reformed', 'formed', 'cooked']);
function tokenizeScoutName(s: string): string[] {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !LABEL_STOPWORDS.has(t))
    .map((t) => (t.endsWith('s') && t.length > 3 ? t.slice(0, -1) : t));
}
/** Pure: should a standalone nutrition-label scout item fold into this food item? */
export function canMergeScoutLabelIntoFood(
  labelItem: { originalName?: string; keyword?: string },
  foodItem: { originalName?: string; keyword?: string }
): { ok: boolean; score: number; reason: string } {
  const labelTokens = tokenizeScoutName(labelItem.originalName || labelItem.keyword || '');
  const foodTokens = tokenizeScoutName(foodItem.originalName || foodItem.keyword || '');
  if (!labelTokens.length || !foodTokens.length) {
    return { ok: false, score: 0, reason: 'empty name' };
  }
  const overlap = labelTokens.filter((t) => foodTokens.includes(t));
  const score = overlap.length / Math.min(labelTokens.length, foodTokens.length);
  const distinctiveOverlap = overlap.filter((t) => !GENERIC_FOOD_TOKENS.has(t));
  const labelDry = labelTokens.some((t) => HAM_DRY_CURED.has(t));
  const foodDry = foodTokens.some((t) => HAM_DRY_CURED.has(t));
  const labelFormed = labelTokens.some((t) => HAM_COOKED_FORMED.has(t));
  const foodFormed = foodTokens.some((t) => HAM_COOKED_FORMED.has(t));
  if ((labelDry && foodFormed) || (labelFormed && foodDry)) {
    return { ok: false, score, reason: 'conflicting ham type (dry-cured vs reformed/cooked)' };
  }
  if (distinctiveOverlap.length >= 1 && score >= 0.5) {
    return { ok: true, score, reason: `distinctive overlap ${distinctiveOverlap.join(',')}` };
  }
  const foodExtraType = foodTokens.filter((t) => !GENERIC_FOOD_TOKENS.has(t) && !labelTokens.includes(t));
  if (distinctiveOverlap.length === 0 && foodExtraType.length > 0) {
    return { ok: false, score, reason: `only generic overlap; food has extra type (${foodExtraType.slice(0, 3).join(',')})` };
  }
  if (score >= 0.67 && distinctiveOverlap.length === 0 && foodExtraType.length === 0) {
    return { ok: true, score, reason: 'same generic product' };
  }
  return { ok: false, score, reason: 'name overlap too weak' };
}
export const VisionScoutSchema = z.object({
  dishes: z.array(ScoutDishSchema).nullable().optional(),
  items: z.array(ScoutItemSchema).nullable().optional(),
  contentType: z.string().nullable().optional(),
  diningEnvironment: z.string().nullable().optional(),
  verdict: z.object({
    label: z.string(),
    level: z.string(),
  }).nullable().optional(),
  clinicalAdvice: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
}).passthrough();
export const scoutSystemInstruction = `- HIERARCHY: Group distinct physical plated items, separate cooking pots/bowls, drinks, or companion sides into separate 'dishes', and constituent ingredients into 'foods'. DO NOT duplicate identical dishes shown across cooking prep, multi-angles, or sliced/whole views. DO NOT group separate packages into a single dish. Each barcode package MUST be its own distinct 'dish'.
- QUANTITY & MULTIPACKS: Output 'weightGrams' (consumed serving) and 'packGrams' (container total). For unopened grocery multi-packs (e.g. '5 x 65ml', 'pack of 6') without explicit user notes stating all N units were consumed, set 'weightGrams' to a single unit/serving size (e.g. 65g) and 'packGrams' to the container total (e.g. 325g).
- GROCERY/SCALE STICKERS: Treat supermarket stickers as atomic: pair printed text with printed weight (e.g. 'Berat 0.252' -> 252g). Output text in 'packageLabelText'. Never transpose weights between packages.
- LOCAL NAMES: Preserve the verbatim printed name from stickers, packaging, or menus in local language as foodName (e.g. 'Ikan Cendro', 'Cumi Bangka'). Do not genericise when specific local name is readable. ALWAYS provide the generic English translation of the ingredient in 'genericEnglishName' (e.g. 'needlefish', 'squid').
- INGESTION: Extract ALL visible food items/packages from ALL provided images into dishes[]. 'contentType' is post-extraction metadata and must not restrict extraction.
- DIRECT OCR: Transcribe nutrition labels into 'rawNutritionLabel' for packaged items with labels. Preserve exact 0 values when printed as 0g / 0mg.
- % AKG / % DV: If nutrition labels state % AKG (Angka Kecukupan Gizi) or % DV for micronutrients (e.g. Vitamin D 8% AKG, Kalsium 2% AKG), preserve the % in rawNutritionLabel.
- BRANDS & CONDIMENTS: Set 'chainName' for brands. Set 'isStandaloneCondimentPacket' for packets <=30g.
- COOKING FATS: Include cooking oils/fats in 'dishNutrients.totalFat' based on 'cookingMethod'.
- CLINICAL VERDICT & ADVICE: Provide a concise biological verdict ('label' with 3-6 words, 'level': 'good' | 'warning' | 'alert' | 'neutral') evaluating metabolic impact, macronutrient balance, and actionable clinical advice in 'clinicalAdvice'.

=== REQUIRED OUTPUT JSON SCHEMA ===
Output exactly ONE JSON object matching this schema:
{"_internalReasoning": "string (<15 words)", "contentType": "visual | menu_or_poster | label | text", "diningEnvironment": "home_cooked | casual_restaurant | fast_food_chain | fine_dining | airline | unknown", "verdict": {"label": "Supports Gut Health with Added Sugar", "level": "neutral"}, "clinicalAdvice": "Personalized clinical guidance regarding glycemic, protein, and micronutrient balance.", "dishes": [{"dishName": "Vegetable and Beef Hotpot", "genericEnglishName": "beef and vegetable stew", "chainName": null, "estimatedWeightGrams": 650, "packGrams": 650, "cookingMethod": "raw | baked | grilled | boiled | steamed | deep_fried | pan_fried | stir_fried", "boundingBox2D": [300, 200, 850, 900], "sourceImageIndex": 1, "isStandaloneCondimentPacket": false, "foods": [{"foodName": "Beef Blade", "genericEnglishName": "beef", "packageLabelText": "BEEF BLADE - Berat 0.110", "weightGrams": 110, "packGrams": 110, "sourceImageIndex": 0, "rawNutritionLabel": null, "nutrients": {"protein": 24.0, "saturatedFat": 2.5, "addedSugar": 0, "totalFibre": 0, "sodium": 65, "carbohydrates": 0}}], "dishNutrients": {"saturatedFat": 5.8, "totalFat": 18.2, "totalSugar": 5.0, "potassium": 1450, "omega3": 0.15, "calcium": 190, "iron": 5.5, "magnesium": 120, "vitaminD": 0}}]}
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
    addDebugLog(`[Zod Validation Failed] ${label}: ${result.error.message}. Attempting soft recovery...`);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
      parsed.items = parsed.items.map((item: any) => {
        if (!item || typeof item !== 'object') return item;
        if (item.ingredients === null) item.ingredients = undefined;
        if (item.components === null) item.components = undefined;
        if (item.lockedNutrientKeys === null) item.lockedNutrientKeys = undefined;
        if (item.boundingBox2D === null) item.boundingBox2D = undefined;
        return item;
      });
      const retryResult = schema.safeParse(parsed);
      if (retryResult.success) {
        addDebugLog(`[Zod Recovery Success] ${label}: Recovered parsed items after sanitizing null fields.`);
        return retryResult.data;
      }
    }
    addDebugLog(`[Zod Hard Fallback] ${label}: Unrecoverable validation error. Raw output: ${rawText}`);
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
        originalName: lItem.originalName ?? vItem.originalName,
        keyword: lItem.keyword ?? vItem.keyword,
        chainName: lItem.chainName ?? vItem.chainName,
        rawNutritionLabel: vItem.rawNutritionLabel,
        nutritionFacts: vItem.nutritionFacts,
        ingredientsList: vItem.ingredientsList,
        ingredients: vItem.ingredients ?? lItem.ingredients ?? [],
        visualIngredients: vItem.visualIngredients || vItem.ingredients || lItem.ingredients || [],
        boundingBox2D: vItem.boundingBox2D,
        sourceImageIndex: vItem.sourceImageIndex,
        source: vItem.source,
        nutrients: vItem.nutrients ?? lItem.nutrients,
        nutrientBasisWeight: vItem.nutrientBasisWeight ?? lItem.nutrientBasisWeight ?? vItem.estimatedWeightGrams,
        lockedNutrientKeys: vItem.lockedNutrientKeys ?? lItem.lockedNutrientKeys,
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
  internalReasoning?: string | null;
  rawDishes?: any[];
  rawScoutJson?: any;
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
    if (!item || typeof item !== "object") return { valid: false, reason: `Item at index ${idx} is not an object` };
    for (const [key, value] of Object.entries(item)) {
      if (typeof value === "string") {
        const isLongText = ['ingredientsList', 'confidenceComment', 'scoutConfidenceComment', 'description', 'notes', 'reason', 'summary', 'internalReasoning', '_internalReasoning', 'reasoning', 'rationale', 'comment', 'explanation', 'details'].includes(key);
        const maxLen = isLongText ? 3000 : 150;
        if (value.length > maxLen) return { valid: false, reason: `Item field '${key}' length (${value.length}) exceeds ${maxLen}` };
        const valLower = value.toLowerCase();
        if (!isLongText && jsonKeyHeuristics.some(h => valLower.includes(h + '"') || valLower.includes(h + ':'))) {
          return { valid: false, reason: `Item field '${key}' contains raw JSON-like keys` };
        }
      }
    }
    if (Array.isArray(item.visualIngredients)) {
      if (item.visualIngredients.length > 20) return { valid: false, reason: `Item visualIngredients exceeds limit (20)` };
      for (let j = 0; j < item.visualIngredients.length; j++) {
        const ing = item.visualIngredients[j];
        if (typeof ing !== "string") return { valid: false, reason: `visualIngredients entry is not a string` };
        if (ing.length > 250) return { valid: false, reason: `visualIngredients entry exceeds 250 characters` };
        const ingLower = ing.toLowerCase();
        if (jsonKeyHeuristics.some(h => ingLower.includes(h + '"') || ingLower.includes(h + ':'))) {
          return { valid: false, reason: `visualIngredients entry looks like JSON` };
        }
      }
    }
    if (Array.isArray(item.components)) {
      for (let j = 0; j < item.components.length; j++) {
        const comp = item.components[j];
        if (comp && typeof comp === "object") {
          for (const [ckey, cval] of Object.entries(comp)) {
            if (typeof cval === "string") {
              const compMaxLen = ['ingredients', 'description', 'notes', 'ingredientsList', 'internalReasoning', '_internalReasoning', 'reasoning', 'rationale', 'comment', 'explanation', 'details'].includes(ckey) ? 3000 : 300;
              if (cval.length > compMaxLen) return { valid: false, reason: `Component field '${ckey}' exceeds ${compMaxLen}` };
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
  userMessage: string = "",
  isCompareMode: boolean = false
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
  // In compare mode, distinct options must NEVER be eliminated as package context
  if (!isCompareMode) {
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
          // Items from separate source images are distinct uploaded items, unless explicitly titled as a label panel
          const isExplicitLabelPanel = /\b(nutrition facts|package label|label only|back of package|unopened box)\b/i.test(String(item.originalName || item.keyword || ""));
          if (typeof item.sourceImageIndex === "number" && typeof otherItem.sourceImageIndex === "number" && item.sourceImageIndex !== otherItem.sourceImageIndex && !isExplicitLabelPanel) {
            continue;
          }
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
          // Only eliminate item if it is explicitly a sub-component match OR explicitly an unparsed label panel
          if (componentMatch || (isExplicitLabelPanel && dishNameSimilarity >= 0.5)) {
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
  }
  if (userMessage && userMessage.trim().length > 0) {
    const cleanMsg = userMessage.toLowerCase();
    if (!isCompareMode) {
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
    }
    // Explicit User Gram & Volume Weight Anchor: Check if user message specifies portion weights/volumes (e.g. "Lassi is 1L the other is 500ml" or "50g of oats")
    const weightVolumeMatches = Array.from(cleanMsg.matchAll(/(\d+(?:\.\d+)?)\s*(g|grams?|ml|milliliters?|millilitres?|l|liters?|litres?)\b/gi));
    if (weightVolumeMatches.length > 0) {
      const ANCHOR_STOPWORDS = new Set([
        'with', 'and', 'for', 'from', 'the', 'plus', 'in', 'of', 'on', 'had', 'have', 'all', 'eat', 'ate',
        'some', 'only', 'pack', 'sliced', 'piece', 'pieces', 'bowl', 'plate', 'dish', 'cup', 'cups',
        'gram', 'grams', 'serving', 'servings', 'a', 'an', 'to', 'is', 'was', 'this', 'that', 'i', 'it'
      ]);
      const claimedItems = new Set<number>();
      weightVolumeMatches.forEach((m, matchIndex) => {
        const valNum = parseFloat(m[1]);
        const unitStr = (m[2] || 'g').toLowerCase();
        let explicitWeight = valNum;
        if (unitStr.startsWith('l') && !unitStr.startsWith('m')) {
          explicitWeight = valNum * 1000; // 1L -> 1000g
        }
        if (explicitWeight > 0 && explicitWeight <= 5000) {
          const matchIdx = m.index || 0;
          const matchEnd = matchIdx + m[0].length;
          // Extract immediate clause boundaries: stop at commas, pluses, semicolons, or sentence breaks
          const rawBefore = cleanMsg.substring(Math.max(0, matchIdx - 30), matchIdx);
          const rawAfter = cleanMsg.substring(matchEnd, Math.min(cleanMsg.length, matchEnd + 40));
          const clauseBefore = rawBefore.split(/[,;+.]/).pop() || '';
          const clauseAfter = (rawAfter.split(/[,;+.]/)[0] || '').replace(/\b(with|and|then)\b.*$/i, '');
          const immediatePhrase = `${clauseBefore} ${clauseAfter}`.toLowerCase();
          const phraseTokens = immediatePhrase
            .split(/[^a-z0-9]+/)
            .filter(w => w.length >= 3 && !ANCHOR_STOPWORDS.has(w));
          let bestItemIdx = -1;
          let bestScore = 0;
          let bestMatchedComp: any = null;
          // PASS 1: Score items based on content word overlap with the immediate modifier phrase
          for (let i = 0; i < items.length; i++) {
            if (contextItemIndices.has(i) || claimedItems.has(i)) continue;
            const item = items[i];
            const nameStr = (item.originalName || item.keyword || '').toLowerCase();
            const itemWords = nameStr
              .split(/[^a-z0-9]+/)
              .filter((w: string) => w.length >= 3 && !ANCHOR_STOPWORDS.has(w));
            let itemScore = 0;
            itemWords.forEach((w: string) => {
              if (phraseTokens.some(pt => pt === w || (w.length >= 4 && (pt.includes(w) || w.includes(pt))))) {
                itemScore += 2;
              }
            });
            let matchedCompForItem: any = null;
            if (item.components && Array.isArray(item.components)) {
              item.components.forEach((c: any) => {
                const cQuery = (c.searchQuery || c.name || c.keyword || '').toLowerCase();
                const cWords = cQuery
                  .split(/[^a-z0-9]+/)
                  .filter((w: string) => w.length >= 3 && !ANCHOR_STOPWORDS.has(w));
                let compScore = 0;
                cWords.forEach((w: string) => {
                  if (phraseTokens.some(pt => pt === w || (w.length >= 4 && (pt.includes(w) || w.includes(pt))))) {
                    compScore += 2;
                  }
                });
                if (compScore > 0 && compScore >= itemScore) {
                  itemScore = Math.max(itemScore, compScore + 1);
                  matchedCompForItem = c;
                }
              });
            }
            if (itemScore > bestScore) {
              bestScore = itemScore;
              bestItemIdx = i;
              bestMatchedComp = matchedCompForItem;
            }
          }
          if (bestItemIdx >= 0 && bestScore > 0) {
            const item = items[bestItemIdx];
            if (bestMatchedComp && Number(bestMatchedComp.volumePercentage) > 0 && item.components && item.components.length > 1) {
              const compPct = Number(bestMatchedComp.volumePercentage) / 100;
              const targetTotalWeight = Math.round(explicitWeight / compPct);
              if (addDebugLog) addDebugLog(`[User Explicit Weight Anchor] User text specified ${explicitWeight}g/ml for sub-component "${bestMatchedComp.searchQuery || bestMatchedComp.name}" in composite dish "${item.originalName || item.keyword}". Updating total dish estimatedWeightGrams from ${item.estimatedWeightGrams}g to ${targetTotalWeight}g (component=${explicitWeight}g).`);
              item.estimatedWeightGrams = targetTotalWeight;
            } else {
              if (addDebugLog) addDebugLog(`[User Explicit Weight Anchor] User text specified ${explicitWeight}g/ml for "${item.originalName || item.keyword}". Updating estimatedWeightGrams from ${item.estimatedWeightGrams}g to ${explicitWeight}g.`);
              item.estimatedWeightGrams = explicitWeight;
            }
            claimedItems.add(bestItemIdx);
          } else {
            // PASS 2: Positional matching ONLY if no word match occurred AND message has explicit positional markers (first, second, other, etc.) or there is only 1 item
            const hasPositionalMarker = /\b(first|second|other|plain|1st|2nd)\b/i.test(immediatePhrase);
            if (hasPositionalMarker || items.length === 1) {
              const targetIdx = items.length === 1 ? 0 : (
                (/\bfirst\b|\b1st\b/i.test(immediatePhrase) && !claimedItems.has(0)) ? 0 :
                (/\b(second|2nd|other)\b/i.test(immediatePhrase)) ? items.findIndex((_, idx) => !claimedItems.has(idx)) :
                matchIndex
              );
              if (targetIdx >= 0 && targetIdx < items.length && !claimedItems.has(targetIdx)) {
                const targetItem = items[targetIdx];
                if (addDebugLog) addDebugLog(`[User Explicit Weight Anchor Fallback] User text specified ${explicitWeight}g/ml for item index ${targetIdx} ("${targetItem.originalName || targetItem.keyword}"). Updating estimatedWeightGrams to ${explicitWeight}g.`);
                targetItem.estimatedWeightGrams = explicitWeight;
                claimedItems.add(targetIdx);
              }
            }
          }
        }
      });
    }
  }
  return items.filter((_, idx) => !contextItemIndices.has(idx));
}
export function clusterSpatialCompositeDishes(
  items: any[],
  addDebugLog?: (msg: string) => void,
  isCompareMode: boolean = false
): any[] {
  if (!items || items.length <= 1 || isCompareMode) return items || [];
  const getBBox = (it: any): [number, number, number, number] => {
    if (Array.isArray(it.boundingBox2D) && it.boundingBox2D.length === 4) {
      return [
        Number(it.boundingBox2D[0]) || 0,
        Number(it.boundingBox2D[1]) || 0,
        Number(it.boundingBox2D[2]) || 1000,
        Number(it.boundingBox2D[3]) || 1000
      ];
    }
    return [0, 0, 1000, 1000];
  };
  const getArea = (box: [number, number, number, number]): number => {
    const h = Math.max(0, box[2] - box[0]);
    const w = Math.max(0, box[3] - box[1]);
    return h * w;
  };
  const getOverlapRatio = (boxA: [number, number, number, number], boxB: [number, number, number, number]): { overlap: number; iou: number } => {
    const areaA = getArea(boxA);
    const areaB = getArea(boxB);
    if (areaA <= 0 || areaB <= 0) return { overlap: 0, iou: 0 };
    const interH = Math.max(0, Math.min(boxA[2], boxB[2]) - Math.max(boxA[0], boxB[0]));
    const interW = Math.max(0, Math.min(boxA[3], boxB[3]) - Math.max(boxA[1], boxB[1]));
    const interArea = interH * interW;
    const minArea = Math.min(areaA, areaB);
    const unionArea = areaA + areaB - interArea;
    return {
      overlap: minArea > 0 ? interArea / minArea : 0,
      iou: unionArea > 0 ? interArea / unionArea : 0
    };
  };
  const isDefaultBox = (b: [number, number, number, number]): boolean => {
    return (b[0] <= 10 && b[1] <= 10 && b[2] >= 990 && b[3] >= 990) ||
           (b[0] === 100 && b[1] === 100 && b[2] === 900 && b[3] === 900);
  };
  const hasDistinctNutrientLabel = (it: any): boolean => {
    const raw = it.rawNutritionLabel;
    if (!raw || typeof raw !== 'object') return false;
    const c = raw.calories ?? raw.energiTotal;
    return c != null && String(c).trim() !== '' && parseFloat(String(c).replace(/[^\d.]/g, '')) > 0;
  };
  const clusteredIndices = new Set<number>();
  const resultDishes: any[] = [];
  for (let i = 0; i < items.length; i++) {
    if (clusteredIndices.has(i)) continue;
    const primary = { ...items[i] };
    const boxA = getBBox(primary);
    const coLocatedIndices: number[] = [];
    for (let j = i + 1; j < items.length; j++) {
      if (clusteredIndices.has(j)) continue;
      const other = items[j];
      // Skip clustering if either item is from spreadsheet
      if (primary.source === 'spreadsheet' || other.source === 'spreadsheet' || primary.isSpreadsheet || other.isSpreadsheet) {
        continue;
      }
      // Same source image check
      const sameImg = (primary.sourceImageIndex ?? 0) === (other.sourceImageIndex ?? 0);
      if (!sameImg) continue;

      const nameA = String(primary.originalName || primary.keyword || '').toLowerCase();
      const nameB = String(other.originalName || other.keyword || '').toLowerCase();
      const cleanKeyA = nameA.replace(/[^a-z0-9\s]/g, '').trim();
      const cleanKeyB = nameB.replace(/[^a-z0-9\s]/g, '').trim();
      const isExactSameFood = cleanKeyA.length > 0 && cleanKeyA === cleanKeyB;

      // Consolidate identical duplicate item observations from the same image regardless of bounding box defaults
      if (isExactSameFood) {
        coLocatedIndices.push(j);
        continue;
      }

      if (isDefaultBox(boxA)) {
        continue;
      }
      // Avoid clustering two distinct packaged commercial items that both have distinct printed nutrition labels
      if (hasDistinctNutrientLabel(primary) && hasDistinctNutrientLabel(other)) {
        continue;
      }
      const boxB = getBBox(other);
      if (isDefaultBox(boxB)) continue;

      const { overlap, iou } = getOverlapRatio(boxA, boxB);
      // High spatial co-location inside the exact same container / bowl / plate
      const hasSeparateComponents = (primary.components?.length > 1 && other.components?.length > 1);
      if (!hasSeparateComponents && (overlap >= 0.70 || iou >= 0.55)) {
        coLocatedIndices.push(j);
      }
    }
    if (coLocatedIndices.length > 0) {
      // Aggregate into 1 composite dish
      const clusterGroup = [primary, ...coLocatedIndices.map(idx => items[idx])];
      coLocatedIndices.forEach(idx => clusteredIndices.add(idx));
      clusteredIndices.add(i);
      const totalWeight = clusterGroup.reduce((sum, it) => sum + (Math.max(10, Number(it.estimatedWeightGrams) || 100)), 0);
      // Build unified components breakdown
      const compositeComponents: any[] = [];
      clusterGroup.forEach(it => {
        const itWeight = Math.max(10, Number(it.estimatedWeightGrams) || 100);
        const itPct = Math.max(1, Math.round((itWeight / totalWeight) * 100));
        if (Array.isArray(it.components) && it.components.length > 0) {
          it.components.forEach((c: any) => {
            const cPct = Math.max(1, Math.round(((Number(c.volumePercentage) || 100) / 100) * itPct));
            const cWeight = Number(c.weightGrams ?? c.estimatedWeightGrams ?? Math.round(totalWeight * (cPct / 100)));
            const cName = String(c.name || c.searchQuery || c.keyword || it.originalName || it.keyword || 'Ingredient').trim();
            const cNuts = c.nutrients || {};
            const cProt = Number(c.protein ?? cNuts.protein ?? 0);
            const cFat = Number(c.totalFat ?? c.fat ?? cNuts.totalFat ?? cNuts.fat ?? cNuts.saturatedFat ?? 0);
            const cSat = Number(c.saturatedFat ?? cNuts.saturatedFat ?? 0);
            const cCarbs = Number(c.carbohydrates ?? c.carbs ?? cNuts.carbohydrates ?? 0);
            const cNa = Number(c.sodium ?? cNuts.sodium ?? 0);
            const rawCals = c.calories ?? cNuts.calories;
            const cCals = rawCals != null && Number.isFinite(Number(rawCals)) ? Number(rawCals) : undefined;
            compositeComponents.push({
              name: cName,
              searchQuery: c.searchQuery || cName,
              weightGrams: cWeight,
              estimatedWeightGrams: cWeight,
              volumePercentage: cPct,
              packGrams: c.packGrams ?? it.packGrams ?? null,
              suggestedFdcId: c.suggestedFdcId || null,
              rawNutritionLabel: c.rawNutritionLabel || it.rawNutritionLabel || undefined,
              nutrients: c.nutrients || undefined,
              ...(cCals != null ? { calories: cCals } : {}),
              protein: cProt,
              totalFat: cFat,
              fat: cFat,
              saturatedFat: cSat,
              carbohydrates: cCarbs,
              sodium: cNa,
              dbSource: c.dbSource || it.dbSource || 'estimated',
              dbId: c.dbId || it.dbId || null,
            });
          });
        } else {
          const cName = String(it.originalName || it.keyword || 'Ingredient').trim();
          const itNuts = it.nutrients || {};
          const itProt = Number(it.protein ?? itNuts.protein ?? 0);
          const itFat = Number(it.totalFat ?? it.fat ?? itNuts.totalFat ?? itNuts.fat ?? itNuts.saturatedFat ?? 0);
          const itSat = Number(it.saturatedFat ?? itNuts.saturatedFat ?? 0);
          const itCarbs = Number(it.carbohydrates ?? it.carbs ?? itNuts.carbohydrates ?? 0);
          const itNa = Number(it.sodium ?? itNuts.sodium ?? 0);
          const rawItCals = it.calories ?? itNuts.calories;
          const itCals = rawItCals != null && Number.isFinite(Number(rawItCals)) ? Number(rawItCals) : undefined;
          compositeComponents.push({
            name: cName,
            searchQuery: cName,
            weightGrams: itWeight,
            estimatedWeightGrams: itWeight,
            volumePercentage: itPct,
            packGrams: it.packGrams ?? null,
            suggestedFdcId: null,
            rawNutritionLabel: it.rawNutritionLabel || undefined,
            nutrients: it.nutrients || undefined,
            ...(itCals != null ? { calories: itCals } : {}),
            protein: itProt,
            totalFat: itFat,
            fat: itFat,
            saturatedFat: itSat,
            carbohydrates: itCarbs,
            sodium: itNa,
            dbSource: it.dbSource || 'estimated',
            dbId: it.dbId || null,
          });
        }
      });
      // Normalize component percentages to 100%
      const compSum = compositeComponents.reduce((acc, c) => acc + (c.volumePercentage || 0), 0);
      if (compSum > 0 && compSum !== 100) {
        const factor = 100 / compSum;
        compositeComponents.forEach(c => {
          c.volumePercentage = Math.max(1, Math.round((c.volumePercentage || 0) * factor));
        });
      }
      // Union bounding box
      const min0 = Math.min(...clusterGroup.map(it => getBBox(it)[0]));
      const min1 = Math.min(...clusterGroup.map(it => getBBox(it)[1]));
      const max2 = Math.max(...clusterGroup.map(it => getBBox(it)[2]));
      const max3 = Math.max(...clusterGroup.map(it => getBBox(it)[3]));
      // Composite clean dish title
      const allCompNames = compositeComponents.map(c => c.name).filter(Boolean);
      const distinctNames = Array.from(new Set(allCompNames));
      let compositeDishTitle = primary.originalName || primary.keyword || 'Composed Dish';
      if (distinctNames.length > 1) {
        const missingNames = distinctNames.filter(n => !compositeDishTitle.toLowerCase().includes(n.toLowerCase()));
        if (missingNames.length > 0) {
          compositeDishTitle = `${compositeDishTitle} with ${missingNames.join(', ')}`;
        }
      }
      // Merge nutrients if multiple items with nutrients are clustered
      if (clusterGroup.length > 1 && clusterGroup.some(it => it.nutrients && typeof it.nutrients === 'object')) {
        const mergedNutrients: Record<string, number> = {};
        for (const it of clusterGroup) {
          if (it.nutrients && typeof it.nutrients === 'object') {
            for (const [k, v] of Object.entries(it.nutrients)) {
              if (typeof v === 'number' && Number.isFinite(v)) {
                mergedNutrients[k] = (mergedNutrients[k] || 0) + v;
              }
            }
          }
        }
        primary.nutrients = mergedNutrients;
      }
      const compNamesList = compositeComponents.map(c => c.name);
      primary.originalName = compositeDishTitle;
      primary.keyword = compositeDishTitle;
      primary.name = compositeDishTitle;
      primary.estimatedWeightGrams = totalWeight;
      primary.nutrientBasisWeight = totalWeight;
      primary.boundingBox2D = [min0, min1, max2, max3];
      primary.components = compositeComponents;
      primary.componentsDetailList = compositeComponents;
      primary.compositeSiblings = compositeComponents;
      primary.hasComponents = compositeComponents.length > 1;
      primary.ingredients = compNamesList;
      primary.visualIngredients = compNamesList;
      primary.ingredientsList = compNamesList.join(', ');
      primary.isCompositeDish = true;
      primary.itemConfidence = 'High (>90%)';
      if (addDebugLog) {
        addDebugLog(
          `[Spatial Clustering] Clustered ${clusterGroup.length} co-located ingredients into composite dish "${compositeDishTitle}" (${totalWeight}g) with ${compositeComponents.length} components.`
        );
      }
      resultDishes.push(primary);
    } else {
      resultDishes.push(primary);
    }
  }
  return resultDishes;
}
export const CONDIMENT_DRESSING_REGEX = /\b(ranch(?:\s+dressing)?|caesar(?:\s+dressing)?|vinaigrette|mayonnaise|mayo|salad\s+dressing|dressing|tahini|aioli|pesto|honey\s+mustard|blue\s+cheese\s+dressing|thousand\s+island|french\s+dressing|italian\s+dressing|gravy|sour\s+cream|guacamole|hummus|olive\s+oil|vinaigre|sauce|gherkins?|pickles?|cornichons?)\b/i;
// Common raw salad/garnish vegetables that Vision Scout's own component decomposition
// tends to drop even when they're explicitly present in ingredientsList/visualIngredients
// (e.g. "red onion" listed on a Cobb salad label but missing from the modeled components).
// Kept separate from CONDIMENT_DRESSING_REGEX since these aren't condiments — grouping them
// under a differently-named constant keeps the two lists semantically honest.
export const GARNISH_VEGETABLE_REGEX = /\b(red\s+onion|white\s+onion|spring\s+onion|scallions?|shallots?|olives?|jalape[nñ]os?|banana\s+peppers?|croutons?|capers?|zucchini|courgettes?|carrots?|cucumbers?|bell\s*peppers?|peppers?|broccoli|peas?|corn|mushrooms?|edamame|cabbage|radish(?:es)?|tomatoes?|celery|green\s*beans?|bok\s*choy|pak\s*choi)\b/i;
export function reconcileIngredientsToComponents(item: any, addDebugLog?: (msg: string) => void): void {
  if (!item || !item.components || !Array.isArray(item.components) || item.components.length === 0) {
    return;
  }
  const candidateIngredients: string[] = [];
  if (item.ingredientsList && typeof item.ingredientsList === 'string') {
    item.ingredientsList.split(/[,;\n•]+/).forEach((part: string) => {
      const clean = part.replace(/[()\[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
      if (clean) candidateIngredients.push(clean);
    });
  }
  if (Array.isArray(item.visualIngredients)) {
    item.visualIngredients.forEach((v: any) => {
      if (typeof v === 'string' && v.trim()) candidateIngredients.push(v.trim());
    });
  }
  if (candidateIngredients.length === 0) return;
  const currentCompNames = item.components.map((c: any) => {
    return String(typeof c === 'string' ? c : (c.searchQuery || c.name || c.keyword || '')).toLowerCase();
  });
  const missingIngredients: string[] = [];
  for (const ing of candidateIngredients) {
    const match = ing.match(CONDIMENT_DRESSING_REGEX) || ing.match(GARNISH_VEGETABLE_REGEX);
    if (match) {
      const matchedName = match[0].toLowerCase();
      const alreadyPresent = currentCompNames.some((cName) => cName.includes(matchedName) || matchedName.includes(cName));
      if (!alreadyPresent && !missingIngredients.some(m => m.toLowerCase().includes(matchedName) || matchedName.includes(m.toLowerCase()))) {
        missingIngredients.push(ing);
      }
    }
  }
  if (missingIngredients.length > 0) {
    const allocatedPerItem = Math.min(8, Math.max(5, Math.floor(20 / missingIngredients.length)));
    for (const missing of missingIngredients) {
      const allocatedPct = allocatedPerItem;
      const currentPctSum = item.components.reduce((acc: number, c: any) => acc + (Number(c.volumePercentage) || 0), 0) || 100;
      const scaleFactor = (100 - allocatedPct) / currentPctSum;
      item.components.forEach((c: any) => {
        if (typeof c === 'object' && c !== null) {
          c.volumePercentage = Math.max(1, Math.round((Number(c.volumePercentage) || 0) * scaleFactor));
        }
      });
      const newComp = {
        searchQuery: missing.toLowerCase(),
        volumePercentage: allocatedPct,
        suggestedFdcId: null
      };
      item.components.push(newComp);
      if (addDebugLog) {
        addDebugLog(`[Label-to-Component Reconciliation] Injected detected ingredient "${missing}" at ${allocatedPct}% volume into components for "${item.originalName || item.keyword}".`);
      }
    }
  }
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

    // Extract bracketed items from userMessage to ensure reference images of bracket items don't leak into scout results
    const bracketMatches = Array.from((userMessage || '').matchAll(/\[+([^\]]+)\]+/g)).map(m => m[1].trim()).filter(Boolean);
    const bracketNames = bracketMatches.map(b => {
      const wm = b.match(/(?:^|\s+)(\d+(?:\.\d+)?)\s*(?:g|grams?|ml)?\s*$/i);
      return (wm ? b.slice(0, wm.index) : b).toLowerCase().trim();
    }).filter(Boolean);

    // Ingest hierarchical dishes if returned by Scout
    if (Array.isArray(parsedScout.dishes) && parsedScout.dishes.length > 0) {
      if (!parsedScout.items) parsedScout.items = [];
      parsedScout.dishes.forEach((d: any) => {
        const dName = String(d.dishName || '').toLowerCase().trim();
        const isBracketRefDish = bracketNames.some(b => b && (dName === b || dName.includes(b) || b.includes(dName)));
        if (isBracketRefDish) {
          addDebugLog(`[Vision Scout Dish Exclusion] Skipping dish "${d.dishName}" matching bracketed reference item.`);
          return;
        }

        const dishFoods = Array.isArray(d.foods) ? d.foods : [];
        let sumP = 0, sumC = 0, sumSatFat = 0, sumAddedSugar = 0, sumFibre = 0, sumNa = 0;
        const components: any[] = [];
        dishFoods.forEach((f: any) => {
          const fn = String(f.foodName || "Ingredient").trim();
          const fw = f.weightGrams ?? f.estimatedWeightGrams ?? 0;
          const fnuts = f.nutrients || {};
          const fp = Number(fnuts.protein) || 0;
          const fc = Number(fnuts.carbohydrates) || 0;
          const fsat = Number(fnuts.saturatedFat) || 0;
          const ffat = Number(fnuts.totalFat) || Number(fnuts.fat) || Math.round(fsat * 1.5 * 10) / 10;
          const fas = Number(fnuts.addedSugar) || 0;
          const ffib = Number(fnuts.totalFibre) || 0;
          const fna = Number(fnuts.sodium) || 0;
          const visualCal = fnuts.calories != null && Number.isFinite(Number(fnuts.calories)) ? Number(fnuts.calories) : undefined;
          sumP += fp;
          sumC += fc;
          sumSatFat += fsat;
          sumAddedSugar += fas;
          sumFibre += ffib;
          sumNa += fna;
          let searchQ = (f.genericEnglishName || fn).trim();
          if (!f.genericEnglishName) {
            let s = String(fn).toLowerCase();
            s = s.replace(/\bbaby pak choy\b/ig, 'bok choy');
            s = s.replace(/\bpak choy\b/ig, 'bok choy');
            s = s.replace(/\bmr\s*oat\s*(rolled\s*oats)?\b/ig, 'rolled oats');
            
            if (/tlr|telur/i.test(s)) searchQ = 'egg';
            else if (/ikan/i.test(s)) searchQ = 'fish';
            else if (/cumi/i.test(s)) searchQ = 'squid';
            else if (/ayam/i.test(s)) searchQ = 'chicken';
            else if (/sapi|daging/i.test(s)) searchQ = 'beef';
            else if (/babi/i.test(s)) searchQ = 'pork';
            else if (/udang/i.test(s)) searchQ = 'shrimp';
            else if (/bebek/i.test(s)) searchQ = 'duck';
            else if (/mr\s*oat/i.test(s)) searchQ = 'rolled oats';
            else searchQ = s;
          }
          
          components.push({
            name: fn,
            searchQuery: searchQ,
            weightGrams: fw,
            estimatedWeightGrams: fw,
            packGrams: f.packGrams ?? null,
            packageLabelText: f.packageLabelText ?? null,
            sourceImageIndex: f.sourceImageIndex ?? (d.sourceImageIndex ?? 0),
            rawNutritionLabel: f.rawNutritionLabel ?? null,
            nutrients: fnuts,
            ...(visualCal != null ? { calories: visualCal } : {}),
            protein: fp,
            totalFat: ffat,
            fat: ffat,
            saturatedFat: fsat,
            carbohydrates: fc,
            carbs: fc,
            sodium: fna,
            dbSource: (f.rawNutritionLabel && Object.keys(f.rawNutritionLabel).some(k => !['servingSize', 'weight', 'servingsPerContainer', 'confidence'].includes(k) && Number(f.rawNutritionLabel[k]) > 0)) ? 'brand_official' : 'estimated',
            dbId: null,
          });
        });
        const dNuts = d.dishNutrients || {};
        let totalFat = Number(dNuts.totalFat) || Math.round(sumSatFat * 1.5 * 10) / 10;
        let satFat = Math.max(sumSatFat, Number(dNuts.saturatedFat) || 0);
        if (totalFat < satFat) totalFat = satFat;

        // Reconcile dish-level fat back to ingredients (cooking oil / deep-frying absorption).
        // Do not Atwater here — finalizeDishLedger is the persisted kcal writer.
        const sumCompFat = components.reduce((acc, c) => acc + c.totalFat, 0);
        if (totalFat > sumCompFat && components.length > 0) {
          const diffFat = totalFat - sumCompFat;
          const totalWeight = components.reduce((acc, c) => acc + (c.weightGrams || 1), 0);
          components.forEach(c => {
            const weightShare = (c.weightGrams || 1) / totalWeight;
            const fatShare = diffFat * weightShare;
            c.totalFat = Math.round((c.totalFat + fatShare) * 10) / 10;
            c.fat = c.totalFat;
          });
        }

        const explicitTotalSugar = dNuts.totalSugar != null && !isNaN(Number(dNuts.totalSugar)) ? Number(dNuts.totalSugar) : null;
        const sugarResult = deduceSugarBreakdown({
          totalSugar: explicitTotalSugar,
          addedSugarPrinted: sumAddedSugar > 0 ? sumAddedSugar : null,
          carbohydrates: sumC,
          totalFibre: sumFibre,
          foodName: d.dishName || d.genericEnglishName,
          ingredientsList: components.map(c => c.name || c.genericEnglishName).filter(Boolean).join(', '),
        });

        const convertedNutrients: Record<string, number> = {
          protein: Math.round(sumP * 10) / 10, carbohydrates: Math.round(sumC * 10) / 10,
          totalFat: Math.round(totalFat * 10) / 10, saturatedFat: Math.round(satFat * 10) / 10, transFat: 0,
          sugar: sugarResult.sugar, addedSugar: sugarResult.addedSugar,
          totalFibre: Math.round(sumFibre * 10) / 10, sodium: Math.round(sumNa),
          potassium: Number(dNuts.potassium) || 0, omega3: Number(dNuts.omega3) || 0,
          calcium: Number(dNuts.calcium) || 0, iron: Number(dNuts.iron) || 0,
          magnesium: Number(dNuts.magnesium) || 0, vitaminD: Number(dNuts.vitaminD) || 0,
          zinc: Number(dNuts.zinc) || 0, selenium: Number(dNuts.selenium) || 0,
          iodine: Number(dNuts.iodine) || 0, phosphorus: Number(dNuts.phosphorus) || 0,
          vitaminA: Number(dNuts.vitaminA) || 0, vitaminC: Number(dNuts.vitaminC) || 0,
          vitaminE: Number(dNuts.vitaminE) || 0, vitaminK: Number(dNuts.vitaminK) || 0,
          vitaminB12: Number(dNuts.vitaminB12) || 0, folate: Number(dNuts.folate) || 0,
          vitaminB6: Number(dNuts.vitaminB6) || 0, thiamine: Number(dNuts.thiamine) || 0,
          riboflavin: Number(dNuts.riboflavin) || 0, niacin: Number(dNuts.niacin) || 0,
          solubleFibre: Number(dNuts.solubleFibre) || computeSolubleFibre(Number(sumFibre) || 0, d.dishName),
          unsaturatedFat: Number(dNuts.unsaturatedFat) || 0,
        };
        const visualDishCal = Number(dNuts.calories);
        if (Number.isFinite(visualDishCal) && visualDishCal > 0) {
          convertedNutrients.calories = visualDishCal;
        }
        let dishWeight = d.estimatedWeightGrams || (components.reduce((acc, c) => acc + (c.weightGrams || 0), 0) || 250);
        let dishRawLabel: any = null;
        if (components.length === 1 && components[0].weightGrams > 0) {
          const comp = components[0];
          const hasLabel = comp.rawNutritionLabel && typeof comp.rawNutritionLabel === 'object' && Object.keys(comp.rawNutritionLabel).some((k: string) => {
            if (k === 'servingSize' || k === 'weight' || k === 'servingsPerContainer') return false;
            const v = comp.rawNutritionLabel[k];
            return v !== undefined && v !== null && v !== '' && v !== '-' && v !== '--';
          });
          dishRawLabel = hasLabel ? comp.rawNutritionLabel : null;
          const isWaterCooked = /boiled|steamed|poached/i.test(d.cookingMethod || '');
          const isDryStaple = /oat|rice|pasta|noodle|grain|cereal|porridge|quinoa|lentil|bean/i.test(comp.name || d.dishName || '');
          if (comp.rawNutritionLabel || (isWaterCooked && isDryStaple && dishWeight > comp.weightGrams * 1.5)) {
            dishWeight = comp.weightGrams;
          }
        }
        const compNames = components.map(c => c.name).filter(Boolean);
        let dishTitle = d.dishName || (compNames.length > 0 ? compNames.join(', ') : "Dish");
        const compPackGrams = components.length === 1 ? (components[0].packGrams ?? null) : (d.packGrams ?? null);
        const compPackageLabel = components.length === 1 ? (components[0].packageLabelText ?? null) : (d.packageLabelText ?? null);
        const convertedItem: any = {
          keyword: dishTitle,
          originalName: dishTitle,
          name: dishTitle,
          genericEnglishName: d.genericEnglishName || null,
          chainName: d.chainName || null,
          packageLabelText: compPackageLabel,
          estimatedWeightGrams: dishWeight,
          nutrientBasisWeight: dishWeight,
          packGrams: compPackGrams,
          cookingMethod: d.cookingMethod || "cooked",
          sourceImageIndex: d.sourceImageIndex ?? 0,
          boundingBox2D: d.boundingBox2D || [0, 0, 1000, 1000],
          isStandaloneCondimentPacket: d.isStandaloneCondimentPacket || false,
          internalReasoning: parsedScout._internalReasoning || null,
          components: components.length > 0 ? components : undefined,
          componentsDetailList: components.length > 0 ? components : undefined,
          compositeSiblings: components.length > 0 ? components : undefined,
          hasComponents: components.length > 1,
          ingredients: compNames,
          visualIngredients: compNames,
          ingredientsList: compNames.length > 0 ? compNames.join(', ') : null,
          rawNutritionLabel: dishRawLabel,
          source: dishRawLabel ? "brand_official" : "estimated",
          dbSource: dishRawLabel ? "brand_official" : "estimated",
          nutrients: convertedNutrients,
          truthNutrients: convertedNutrients,
        };
        parsedScout.items.push(convertedItem);
      });
    }
    if (parsedScout.queriesToSearch && Array.isArray(parsedScout.queriesToSearch)) {
      const chainNames = (parsedScout.items || [])
        .map((it: any) => String(it?.chainName || '').toLowerCase().trim())
        .filter(Boolean);
      parsedScout.queriesToSearch.forEach((q: any) => {
        if (typeof q !== 'string' || !q.trim()) return;
        const ql = q.toLowerCase();
        if (chainNames.some((c: string) => ql.includes(c))) {
          queriesToSearch.push(q.trim());
        }
      });
    }
    if (parsedScout.diningEnvironment) {
      diningEnvironment = parsedScout.diningEnvironment;
    }
    if (Array.isArray(parsedScout.items)) {
      if (bracketNames.length > 0) {
        parsedScout.items = parsedScout.items.filter((it: any) => {
          const itName = String(it?.originalName || it?.keyword || it?.name || '').toLowerCase().trim();
          const isMatch = bracketNames.some(b => b && (itName === b || itName.includes(b) || b.includes(itName)));
          if (isMatch) {
            addDebugLog(`[Vision Scout Item Exclusion] Skipping scout item "${itName}" matching bracketed reference item.`);
            return false;
          }
          return true;
        });
      }
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
            isSpreadsheet: true,
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
            isSpreadsheet: true,
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
        const hasComponents = Array.isArray(item.components) && item.components.length > 0;
        const hasDirectNutrients = item.nutrients && (
          (item.nutrients.protein != null && item.nutrients.protein > 0) ||
          (item.nutrients.carbohydrates != null && item.nutrients.carbohydrates > 0) ||
          (item.nutrients.totalFat != null && item.nutrients.totalFat > 0)
        );
        // Check for multiple commas OUTSIDE of parentheses
        const outsideParens = rawOriginal.replace(/\([^)]*\)/g, '').trim();
        const hasMultipleCommas = (outsideParens.match(/,/g) || []).length >= 2;
        // If the item ALREADY has a structured component breakdown or direct nutrients, keep it intact as a single dish!
        // Exploding by comma is ONLY for legacy multi-item strings without component breakdowns or direct nutrients.
        if (!hasPrintedMacros && !hasDirectNutrients && hasMultipleCommas && !hasComponents) {
          const dishNames = outsideParens.split(",").map((n: string) => n.trim()).filter((n: string) => n.length > 0);
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
              nutrientBasisWeight: splitWeight,
              components: singleComponent
            });
          });
        } else {
          const countMatch = rawOriginal.match(/^(\d+)\s+(.+)$/);
          if (countMatch && !hasPrintedMacros) {
            const count = parseInt(countMatch[1], 10);
            const itemName = countMatch[2];
            if (count > 1 && count <= 10 && (itemName.toLowerCase().includes('croissant') || itemName.toLowerCase().includes('pastry') || itemName.toLowerCase().includes('swirl') || itemName.toLowerCase().includes('roll') || itemName.toLowerCase().includes('bun') || itemName.toLowerCase().includes('muffin'))) {
              const singleWeight = Math.round((item.estimatedWeightGrams || 100 * count) / count);
              const singleCals = item.estimatedCalories ? Math.round(item.estimatedCalories / count) : undefined;
              for (let i = 0; i < count; i++) {
                explodedItems.push({
                  ...item,
                  originalName: itemName,
                  keyword: itemName,
                  name: itemName,
                  estimatedWeightGrams: singleWeight,
                  estimatedCalories: singleCals
                });
              }
              addDebugLog(`[Scout Counting] Split "${rawOriginal}" into ${count} distinct "${itemName}" items.`);
              return;
            }
          }
          explodedItems.push(item);
        }
      });
      visionScoutItems = explodedItems.map((item: any, idx: number) => {
        let newItem = {
          ...item,
          scoutIndex: idx,
          nutrientBasisWeight: item.nutrientBasisWeight || item.estimatedWeightGrams,
        };
        // Volumetric Tuning for standalone high-density condiments (never parent dishes)
        if (newItem.isStandaloneCondimentPacket === true || (newItem.isStandaloneCondimentPacket !== false && isStandaloneCondimentPacket(newItem))) {
          if (newItem.estimatedWeightGrams > 50) {
            newItem.estimatedWeightGrams = 30;
            if (newItem.estimatedCalories) {
                newItem.estimatedCalories = Math.round(newItem.estimatedCalories * (30 / item.estimatedWeightGrams));
            }
            addDebugLog(`[Volumetric Tuning] Capped high-density condiment "${newItem.keyword || newItem.originalName}" to 30g.`);
          }
        }
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
          if (rawC !== null && expectedCalories > 0 && knownMacrosCount === 3 && Math.abs(expectedCalories - rawC) / expectedCalories > 0.20) {
              newItem.originalCalories = rawC;
              newItem.autoCorrectedCalories = true;
              newItem.rawNutritionLabel.calories = Math.round(expectedCalories);
              healAnomaly(newItem, "calories");
          } else if (rawC === null && expectedCalories > 0) {
              newItem.rawNutritionLabel.calories = Math.round(expectedCalories);
              healAnomaly(newItem, "calories");
          } else if (knownMacrosCount === 2 && rawC !== null && rawC > 0) {
              if (missingFat) {
                  newItem.rawNutritionLabel.totalFat = safeMath((rawC - (carbs * 4) - (protein * 4)) / 9);
                  if (newItem.rawNutritionLabel.fat === undefined) { newItem.rawNutritionLabel.fat = newItem.rawNutritionLabel.totalFat; }
                  healAnomaly(newItem, "fat");
              } else if (missingCarbs) {
                  newItem.rawNutritionLabel.totalCarbohydrate = safeMath((rawC - (correctedFat * 9) - (protein * 4)) / 4);
                  if (newItem.rawNutritionLabel.carbohydrates === undefined) { newItem.rawNutritionLabel.carbohydrates = newItem.rawNutritionLabel.totalCarbohydrate; }
                  healAnomaly(newItem, "carbohydrates");
                  healAnomaly(newItem, "carbs");
              } else if (missingProtein) {
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
              const decision = canMergeScoutLabelIntoFood(labelItem, it);
              if (decision.ok && decision.score > bestScore) {
                bestScore = decision.score;
                bestCandidate = it;
              }
            }
            if (bestCandidate) {
              primaryItem = bestCandidate;
            }
          }
          // Fallback: when unambiguous by construction (exactly 2 items total OR exactly 1 non-label food candidate).
          if (!primaryItem && (visionScoutItems.length === 2 || candidates.length === 1)) {
            primaryItem = candidates[0]?.it || null;
          }
          if (!primaryItem) {
            // No confident match found (3+ items, no image/name signal). Leave the label as its
            // own item rather than guessing — a wrong guess silently corrupts a different item's
            // data, which is worse than an unmerged label the dietitian agent can still read.
            addDebugLog(`[Label Merge] Could not confidently match label "${labelItem.originalName || labelItem.keyword}" (sourceImageIndex=${labelItem.sourceImageIndex}) to any food item. Leaving unmerged rather than guessing.`);
            break;
          }
          const cleanLabel = (labelItem.originalName || labelItem.keyword || "").toLowerCase().replace(/nutrition\s*facts?\s*label|nutrition\s*label/g, '').replace(/[^a-z0-9]/g, '');
          const cleanTarget = (primaryItem.originalName || primaryItem.keyword || "").toLowerCase().replace(/[^a-z0-9]/g, '');
          if (cleanLabel.length > 2 && (cleanLabel === cleanTarget || cleanTarget.includes(cleanLabel) || cleanLabel.includes(cleanTarget))) {
            addDebugLog(`[Scout Dedupe] deduplicated true-friend label "${labelItem.originalName || labelItem.keyword}" into "${primaryItem.originalName || primaryItem.keyword}" (Image ${primaryItem.sourceImageIndex}).`);
          } else {
            addDebugLog(`[Label Merge] Matched label "${labelItem.originalName || labelItem.keyword}" (sourceImageIndex=${labelItem.sourceImageIndex}) -> "${primaryItem.originalName || primaryItem.keyword}" (sourceImageIndex=${primaryItem.sourceImageIndex}).`);
          }
          const labelHasRealData = labelItem.rawNutritionLabel && typeof labelItem.rawNutritionLabel === 'object'
            ? Object.keys(labelItem.rawNutritionLabel).some((k: string) => {
                if (k === 'servingSize' || k === 'weight' || k === 'servingsPerContainer') return false;
                const v = labelItem.rawNutritionLabel[k];
                return v !== undefined && v !== null && v !== '' && v !== '-' && v !== '--';
              })
            : false;
          if (labelHasRealData) {
            primaryItem.rawNutritionLabel = {
              ...(primaryItem.rawNutritionLabel || {}),
              ...labelItem.rawNutritionLabel
            };
          } else if (labelItem.rawNutritionLabel) {
            addDebugLog(`[Label Merge] Label "${labelItem.originalName || labelItem.keyword}" was detected but all extracted nutrient values were empty/null. Skipping merge onto "${primaryItem.originalName || primaryItem.keyword}" rather than overwriting with empty data.`);
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
            const maxLen = Math.max(tokensA.length, tokensB.length);
            const overlapRatio = maxLen > 0 ? overlapCount / maxLen : 0;
            const calA = itemA.rawNutritionLabel?.calories || null;
            const calB = itemB.rawNutritionLabel?.calories || null;
            const parseCalNum = (c: any) => typeof c === 'number' ? c : (typeof c === 'string' ? parseFloat(c.replace(/[^0-9.]/g, '')) : null);
            const numCalA = parseCalNum(calA);
            const numCalB = parseCalNum(calB);
            const hasCalA = numCalA !== null && !isNaN(numCalA);
            const hasCalB = numCalB !== null && !isNaN(numCalB);
            const samePrintedCalories = hasCalA && hasCalB && Math.abs(numCalA - numCalB) < 2;
            const diffPrintedCalories = hasCalA && hasCalB && Math.abs(numCalA - numCalB) >= 2;
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
            // MUST NOT merge items if both have distinct nutrition labels with different calories, or different labels without exact key match.
            const hasConflictingLabels = diffPrintedCalories || (hasLabelA && hasLabelB && !samePrintedCalories && !exactKeyMatch);
            const isCrossImageDuplicate = !isCompareMode && !sameSourceImage && !hasConflictingLabels && (
              (samePrintedCalories && overlapRatio >= 0.4) ||
              exactKeyMatch ||
              (overlapRatio >= 0.75)
            );
            if (isCrossImageDuplicate) {
              addDebugLog(`[Multi-Photo Merge] Merged duplicate cross-photo item "${itemA.originalName || itemA.keyword}" (Image ${itemA.sourceImageIndex}) into "${itemB.originalName || itemB.keyword}" (Image ${itemB.sourceImageIndex}).`);
              if (itemA.ingredientsList && !itemB.ingredientsList) {
                itemB.ingredientsList = itemA.ingredientsList;
              }
              if (hasLabelA && (!hasLabelB || Object.keys(itemB.rawNutritionLabel || {}).length === 0)) {
                itemB.rawNutritionLabel = itemA.rawNutritionLabel;
              } else if (hasLabelA && hasLabelB) {
                const mergedLabel = { ...itemB.rawNutritionLabel };
                for (const key of Object.keys(itemA.rawNutritionLabel)) {
                  const valA = itemA.rawNutritionLabel[key];
                  const valB = mergedLabel[key];
                  if ((valB === null || valB === undefined || valB === "") && valA !== null && valA !== undefined && valA !== "") {
                    mergedLabel[key] = valA;
                  }
                }
                itemB.rawNutritionLabel = mergedLabel;
              }
              // If both items are visual dishes without printed nutrition labels, combine their weights and nutrients
              if (!hasLabelA && !hasLabelB) {
                const weightA = Number(itemA.estimatedWeightGrams) || 0;
                const weightB = Number(itemB.estimatedWeightGrams) || 0;
                if (weightA > 0) {
                  itemB.estimatedWeightGrams = weightB + weightA;
                  itemB.nutrientBasisWeight = itemB.estimatedWeightGrams;
                  if (itemA.nutrients && typeof itemA.nutrients === 'object' && itemB.nutrients && typeof itemB.nutrients === 'object') {
                    for (const [k, v] of Object.entries(itemA.nutrients)) {
                      if (typeof v === 'number' && Number.isFinite(v)) {
                        itemB.nutrients[k] = Math.round(((itemB.nutrients[k] || 0) + v) * 10) / 10;
                      }
                    }
                  }
                }
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
      visionScoutItems = resolvePackageAndContextItems(visionScoutItems, addDebugLog, userMessage, isCompareMode);
      visionScoutItems = clusterSpatialCompositeDishes(visionScoutItems, addDebugLog, isCompareMode);
      visionScoutItems = reconcileContainerVolumeBudget(visionScoutItems, addDebugLog);
      // Re-index finalized items so scoutIndex is contiguous (0, 1, 2, ...) after deduplicating labels
      visionScoutItems = visionScoutItems.map((item: any, idx: number) => ({
        ...item,
        scoutIndex: idx
      }));
      for (const item of visionScoutItems) {
        if (item.rawNutritionLabel && typeof item.rawNutritionLabel === 'object') {
          const hasRealData = Object.keys(item.rawNutritionLabel).some((k: string) => {
            if (k === 'servingSize' || k === 'weight' || k === 'servingsPerContainer') return false;
            const v = item.rawNutritionLabel[k];
            return v !== undefined && v !== null && v !== '' && v !== '-' && v !== '--';
          });
          if (!hasRealData) {
            item.rawNutritionLabel = null;
          }
        }
        if (!item.rawNutritionLabel && (item.source === 'brand_official' || item.dbSource === 'brand_official')) {
          item.source = 'estimated';
          item.dbSource = 'estimated';
        }
        // Enforce Label-to-Component reconciliation for dressings/sauces/condiments detected via OCR or vision
        reconcileIngredientsToComponents(item, addDebugLog);
        // Issue #6: Persistent Web Search Override on Generic Items.
        // Restrict queriesToSearch strictly to detected restaurant chains or packaged brand names (chainName !== null).
        if (item.chainName) {
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
    diningEnvironment,
    internalReasoning: parsedScout?._internalReasoning || null,
    rawDishes: parsedScout?.dishes || [],
    rawScoutJson: parsedScout || null,
  };
}
