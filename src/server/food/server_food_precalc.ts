import { applyNutrientModifiers } from '../../../server_derivation.js';

/**
 * F-8.10 shard 12 — pre-finalize preparation, extracted verbatim from
 * runFoodAnalyze. Portion pause, brand lock, FDC hints, ledger mapping,
 * and modifier application. Async finalize/DB calls stay in the pipeline.
 */

export interface PortionPauseArgs {
  portionChoices?: unknown;
  skipPortionClarify?: unknown;
  isWeightModification: boolean;
  compareOnly: boolean;
  isExplicitModify: boolean;
  visionScoutRanAndReturnedItems: boolean;
}

/** Whether to pause for portion clarification before nutrient calculation. */
export function shouldPauseForPortionClarify(args: PortionPauseArgs): boolean {
  return Boolean(
    !args.portionChoices &&
    !args.skipPortionClarify &&
    !args.isWeightModification &&
    !args.compareOnly &&
    !args.isExplicitModify &&
    args.visionScoutRanAndReturnedItems
  );
}

export interface CarryCandidatesArgs {
  visionScoutItems: any[];
  databaseMatchesArray: any[];
  detectedChainKey?: string;
}

/** Meal-relevant DB candidates carried to turn 2 (capped at 60). */
export function filterPortionCarryCandidates(args: CarryCandidatesArgs): any[] {
  const { visionScoutItems, databaseMatchesArray, detectedChainKey } = args;
  const clarifyItemQueries = new Set((visionScoutItems || []).map((it: any) => String(it.originalName || it.keyword || '').toLowerCase()));
  return (databaseMatchesArray || []).filter((c: any) => {
    const cQuery = String(c.searchQuery || c.name || '').toLowerCase();
    return clarifyItemQueries.has(cQuery) ||
      (detectedChainKey && String(c.chainName || '').toLowerCase().includes(detectedChainKey)) ||
      c.source === 'brand_official' ||
      c.source === 'internal_catalog';
  }).slice(0, 60);
}

const GLOBAL_BRANDS = ["mcdonald", "burger king", "wendy", "kfc", "denny", "starbucks", "subway", "taco bell", "domino", "pizza hut", "chipotle", "panera", "dunkin", "sonic", "popeyes", "arby", "dairy queen", "panda express"];

/** Brand Environment Locking: dominant chain brand in the scene context. */
export function detectDominantBrand(args: { message?: string; visionScoutItems: any; onLog: (msg: string) => void }): string {
  const { message, visionScoutItems, onLog } = args;
  let dominantBrand = "";
  const allContextText = (message + " " + JSON.stringify(visionScoutItems)).toLowerCase();
  for (const b of GLOBAL_BRANDS) {
    if (allContextText.includes(b) || allContextText.includes(b.replace(/\s+/g, ""))) {
      dominantBrand = b;
      onLog(`[Environment Locking] Detected dominant brand "${b}" in scene context. Restricting matching hierarchy.`);
      break;
    }
  }
  return dominantBrand;
}

/** Collects scout suggestedFdcId hint tasks from components. */
export function collectFdcHintTasks(visionScoutItems: any): Array<{ key: string; fdcId: string; query: string }> {
  const hintFetchTasks: Array<{ key: string; fdcId: string; query: string }> = [];
  (visionScoutItems || []).forEach((item: any, itemIdx: number) => {
    (item.components || []).forEach((comp: any, cIdx: number) => {
      const hintId = comp.suggestedFdcId;
      if (hintId && String(hintId).trim()) {
        const q = comp.searchQuery || comp.name || comp.keyword || "";
        hintFetchTasks.push({ key: `${itemIdx}:${cIdx}`, fdcId: String(hintId).trim(), query: q });
      }
    });
  });
  return hintFetchTasks;
}

const HINT_STOPWORDS = new Set(['cheese', 'canned', 'sauce', 'sauces', 'salad', 'dressing', 'cream', 'sliced', 'chopped', 'mixed', 'fresh', 'cooked', 'raw', 'shredded', 'grated', 'diced', 'whole', 'baked', 'fried', 'roasted', 'steamed', 'boiled', 'grilled', 'style', 'flavored', 'flavoured', 'plain', 'organic', 'natural', 'sweet', 'spicy', 'crushed', 'minced', 'topping', 'toppings', 'spread', 'filling', 'blend', 'garnish', 'crumbs', 'chunks', 'pieces', 'with', 'and', 'leaf', 'leaves', 'seed', 'seeds', 'green']);

/** Relevance check for scout FDC hints (same stopword gate as the safety net). */
export function isFdcHintRelevant(query: string, description: string): boolean {
  const qTokens = String(query || '').toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter((t: string) => t.length > 3 && !HINT_STOPWORDS.has(t));
  const fNameLow = String(description || '').toLowerCase();
  return qTokens.length === 0 || qTokens.some((t: string) => fNameLow.includes(t));
}

export interface LedgerMapArgs {
  ledgers: any[];
  visionScoutItems: any[];
  onLog: (msg: string) => void;
}

/** Maps finalize ledgers to preCalculatedItems (logs per-ledger budget lines). */
export function mapLedgersToPrecalcItems(args: LedgerMapArgs): any[] {
  const { ledgers, visionScoutItems, onLog } = args;
  return ledgers.map((l) => {
    onLog(`[Budget] Finalized ledger for "${l.originalName}": ${l.nutrients.calories} kcal (${l.weightGrams}g, source=${l.dbSource})`);
    const vItem = visionScoutItems[l.scoutIndex] || {};
    const comps = l.componentsDetailList || l.components || vItem.componentsDetailList || vItem.components || vItem.compositeSiblings || [];
    return {
      scoutIndex: l.scoutIndex,
      originalName: l.originalName,
      keyword: l.keyword || l.originalName,
      foodType: l.dishClass,
      estimatedWeightGrams: l.weightGrams,
      portionMultiplier: 1.0,
      nutrients: l.nutrients,
      nutrients100g: {},
      lockedNutrientKeys: l.lockedNutrientKeys,
      rawNutritionLabel: (l.dbSource === 'label' ? l.nutrients : vItem.rawNutritionLabel) || null,
      labelNutrientsPerServing: l.brandLock ? l.brandLock.valuesAtBasis : (vItem.labelNutrientsPerServing || null),
      brandLock: l.brandLock,
      dbSource: l.dbSource,
      dbId: l.dbId,
      atwaterFlag: l.atwaterFlag,
      ingredients: l.ingredients,
      visualIngredients: l.visualIngredients,
      ingredientsList: l.ingredientsList || (l.ingredients.length > 0 ? l.ingredients.join(', ') : null),
      boundingBox2D: vItem.boundingBox2D || null,
      sourceImageIndex: vItem.sourceImageIndex ?? 0,
      components: comps.length > 0 ? comps : null,
      componentsDetailList: comps.length > 0 ? comps : [],
      compositeSiblings: comps.length > 0 ? comps : [],
      hasComponents: Boolean(l.hasComponents || comps.length > 1),
    };
  });
}

export interface MealModifiersArgs {
  preCalculatedItems: any[];
  message?: string;
  onLog: (msg: string) => void;
}

/** Applies the nutrient modifier matrix to precalc items (mutates in place, as inline). */
export function applyMealModifiers(args: MealModifiersArgs): void {
  const { preCalculatedItems, message, onLog } = args;
  preCalculatedItems.forEach((pItem: any) => {
    const subComponents: any[] = (pItem.componentsDetailList && pItem.componentsDetailList.length > 0)
      ? pItem.componentsDetailList
      : (pItem.components && pItem.components.length > 0 ? pItem.components : []);
    if (subComponents.length > 1) {
      // Composite dish: try the modifier against each individual sub-ingredient
      // (e.g. "the tea was unsweetened" must target the "Sweet Iced Tea" component,
      // never the whole parent dish name it happens to be embedded in).
      let anySubComponentChanged = false;
      subComponents.forEach((sub: any) => {
        const subNutrients = sub.nutrients || sub;
        const modRes = applyNutrientModifiers(subNutrients, {
          message,
          foodType: sub.foodType || null,
          name: sub.name || sub.searchQuery || sub.keyword || '',
        });
        if (modRes.lockedKeys.length > 0) {
          anySubComponentChanged = true;
          sub.nutrients = { ...(sub.nutrients || {}), ...modRes.updatedNutrients };
          // Row-builder for the nutrition table reads top-level fields, not nested
          // .nutrients — mirror the updated values onto the flattened component too.
          sub.calories = modRes.updatedNutrients.calories;
          sub.sugar = modRes.updatedNutrients.sugar;
          sub.addedSugar = modRes.updatedNutrients.addedSugar;
          sub.carbohydrates = modRes.updatedNutrients.carbohydrates;
          sub.carbs = modRes.updatedNutrients.carbohydrates;
          onLog(`[Nutrient Modifier Matrix] Applied modifiers to sub-component "${sub.name}" inside "${pItem.originalName}": locked keys [${modRes.lockedKeys.join(', ')}]`);
        }
      });
      if (anySubComponentChanged && pItem.nutrients) {
        // Re-sum parent dish totals from the (possibly modified) sub-components so
        // the dish-level total reflects the edited ingredient instead of staying frozen.
        const sumCal = subComponents.reduce((acc, c) => acc + (Number(c.calories) || 0), 0);
        const sumCarbs = subComponents.reduce((acc, c) => acc + (Number(c.carbohydrates ?? c.carbs) || 0), 0);
        const sumSugar = subComponents.reduce((acc, c) => acc + (Number(c.sugar ?? c.nutrients?.sugar) || 0), 0);
        const sumAddedSugar = subComponents.reduce((acc, c) => acc + (Number(c.addedSugar ?? c.nutrients?.addedSugar) || 0), 0);
        pItem.nutrients.calories = Math.round(sumCal);
        pItem.nutrients.carbohydrates = Math.round(sumCarbs * 10) / 10;
        pItem.nutrients.sugar = Math.round(sumSugar * 10) / 10;
        pItem.nutrients.addedSugar = Math.round(sumAddedSugar * 10) / 10;
        pItem.lockedNutrientKeys = Array.from(new Set([...(pItem.lockedNutrientKeys || []), 'calories', 'carbohydrates', 'sugar', 'addedSugar']));
        pItem.componentsDetailList = subComponents;
        pItem.components = subComponents;
        pItem.compositeSiblings = subComponents;
      }
    } else if (pItem.nutrients) {
      // Single-food item (no sub-components) — unchanged behavior from before.
      const modRes = applyNutrientModifiers(pItem.nutrients, {
        message,
        foodType: pItem.foodType,
        name: pItem.originalName || pItem.keyword,
      });
      pItem.nutrients = modRes.updatedNutrients;
      if (modRes.lockedKeys.length > 0) {
        pItem.lockedNutrientKeys = Array.from(new Set([...(pItem.lockedNutrientKeys || []), ...modRes.lockedKeys]));
        onLog(`[Nutrient Modifier Matrix] Applied modifiers to "${pItem.originalName}": locked keys [${modRes.lockedKeys.join(', ')}]`);
      }
    }
  });
}
