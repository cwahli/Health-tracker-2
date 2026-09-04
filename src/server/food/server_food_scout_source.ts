/**
 * F-8.10 shard 9 — scout item sourcing, extracted verbatim from
 * runFoodAnalyze. Decides where visionScoutItems come from when no fresh
 * vision dispatch runs: active-meal inherit, compare mapper, or prior-run
 * (skipScout / portionChoices / history fallback) resolution.
 */

import { getFallbackCategoryProfile } from '../../../server_food_catalog.js';
import { isPackagedBindItem, inferChainNameFromPackageLabel } from '../../../server_brand_match.js';

export interface ScoutInheritArgs {
  isModifySession: boolean;
  visionScoutItems: any[];
  activeMeal: any;
  onLog: (msg: string) => void;
}

/** Inherits finalize-shaped items from the active meal as scout items for edits. */
export function inheritActiveMealScoutItems(args: ScoutInheritArgs): {
  items: any[];
  ran: boolean;
} {
  const { isModifySession, visionScoutItems, activeMeal, onLog } = args;
  if (isModifySession && visionScoutItems.length === 0 && activeMeal) {
    const activeList = Array.isArray(activeMeal.itemsBreakdown) && activeMeal.itemsBreakdown.length > 0
      ? activeMeal.itemsBreakdown
      : (Array.isArray(activeMeal.items) ? activeMeal.items : []);
    if (activeList.length > 0) {
      const items = activeList.map((it: any, idx: number) => {
        const sIdx = it.scoutIndex !== undefined && it.scoutIndex !== null ? it.scoutIndex : idx;
        it.scoutIndex = sIdx; // Mutate the original activeMeal item to ensure it matches by scoutIndex during consolidation
        return {
          itemId: it.itemId || it.id || undefined,
          scoutIndex: sIdx,
          originalName: it.originalName || it.canonicalDbName || it.name || "Food Item",
          keyword: it.keyword || it.canonicalDbName || it.originalName || it.name,
          estimatedWeightGrams: Number(it.weightGrams) || 100,
          nutrientBasisWeight: Number(it.weightGrams) || 100,
          nutrients: it.nutrients || it.truthNutrients || null,
          lockedNutrientKeys: it.lockedNutrientKeys || [],
          _alreadyFinalized: Boolean(it.nutrients && (it.lockedNutrientKeys?.length || it.dbSource === 'label' || it.dbSource === 'usda_direct_hint')),
          cookingMethod: it.cookingMethod || 'raw',
          ingredients: it.ingredients || (it.ingredientsList ? String(it.ingredientsList).split(',').map((s: string) => s.trim()) : []),
          visualIngredients: it.visualIngredients || [],
          rawNutritionLabel: it.rawNutritionLabel || null,
          chainName: it.chainName || null,
          dbSource: it.dbSource || 'estimated',
          dbId: it.dbId || null,
          boundingBox2D: it.boundingBox2D || null,
          sourceImageIndex: it.sourceImageIndex ?? 0,
          componentsDetailList: it.componentsDetailList || [],
          components: it.components || [],
          hasComponents: it.hasComponents || false,
        };
      });
      onLog(`[Edit Continuity] Inherited ${items.length} items from activeMeal into visionScoutItems for edit.`);
      return { items, ran: true };
    }
  }
  return { items: visionScoutItems, ran: false };
}

/** Maps compare-mode item names to scout-shaped rows. */
export function mapCompareItemsToScoutItems(compareItems: any): any[] {
  return (compareItems || []).map((name: string, index: number) => ({
    scoutIndex: index,
    keyword: name,
    originalName: name,
    estimatedWeightGrams: 100,
    source: "compare_request"
  }));
}

export interface PriorScoutArgs {
  body: any;
  history: any;
  activeMeal: any;
}

/** Resolves prior-run scout items across activeScoutItems / scoutItems / meal / history. */
export function resolvePriorScoutItems(args: PriorScoutArgs): any[] {  const { body, history, activeMeal } = args;
  let priorScout = (Array.isArray(body.activeScoutItems) && body.activeScoutItems.length > 0)
    ? body.activeScoutItems
    : ((Array.isArray(body.scoutItems) && body.scoutItems.length > 0)
      ? body.scoutItems
      : (Array.isArray(activeMeal?.scoutItems) && activeMeal.scoutItems.length > 0 ? activeMeal.scoutItems : []));
  if (priorScout.length === 0 && Array.isArray(history) && history.length > 0) {
    // Fallback: search history messages for scoutItems or portionClarify items
    const clarifyMsg = [...history].reverse().find((m: any) =>
      (m.data?.scoutItems && m.data.scoutItems.length > 0) ||
      (m.data?.portionClarify?.scoutItems && m.data.portionClarify.scoutItems.length > 0) ||
      (m.data?.portionClarify?.items && m.data.portionClarify.items.length > 0) ||
      (m.data?.agentResult?.scoutItems && m.data.agentResult.scoutItems.length > 0)
    );
    if (clarifyMsg?.data) {
      priorScout = clarifyMsg.data.scoutItems ||
        clarifyMsg.data.portionClarify?.scoutItems ||
        clarifyMsg.data.portionClarify?.items ||
        clarifyMsg.data.agentResult?.scoutItems || [];
    }
  }
  return priorScout;
}

/**
 * F-8.10 shard 10 — scout-prep seams. Mutates the passed arrays in place,
 * exactly as the inline blocks did.
 */

export interface BracketPreExtractArgs {
  bracketItems: any[];
  visionScoutItems: any[];
  queriesToSearch: string[];
  onLog: (msg: string) => void;
}

/** Purges OCR/label duplicates of bracket items and stamps fallback nutrients. */
export function applyBracketPreExtract(args: BracketPreExtractArgs): void {
  const { bracketItems, visionScoutItems, queriesToSearch, onLog } = args;
  bracketItems.forEach((bItem: any) => {
    const bName = (bItem.originalName || '').toLowerCase().trim();
    // Remove any scout items that match this bracket item (clean purge of OCR/label reference photos)
    for (let idx = visionScoutItems.length - 1; idx >= 0; idx--) {
      const it = visionScoutItems[idx];
      const itName = (it.originalName || it.keyword || '').toLowerCase().trim();
      if (!itName) continue;
      const match = itName === bName || itName.includes(bName) || bName.includes(itName);
      if (match) {
        onLog(`[Bracket Pre-Extracted] Dropping Scout item "${it.originalName || it.keyword}" in favor of pre-extracted bracket item "${bItem.originalName}" (${bItem.estimatedWeightGrams}g).`);
        visionScoutItems.splice(idx, 1);
      }
    }
    // Add clean bracket pre-extracted item with standard nutrient breakdown
    const baseNuts = getFallbackCategoryProfile(bItem.originalName || bItem.keyword || '');
    const factor = (bItem.estimatedWeightGrams || 100) / 100;
    const bNuts = {
      calories: Math.round((baseNuts.calories || 389) * factor),
      protein: Math.round((baseNuts.protein || 12.43) * factor * 10) / 10,
      carbohydrates: Math.round((baseNuts.carbohydrates || 67.0) * factor * 10) / 10,
      totalFat: Math.round((baseNuts.totalFat || 6.86) * factor * 10) / 10,
      saturatedFat: Math.round((baseNuts.saturatedFat || 0.57) * factor * 10) / 10,
      transFat: 0,
      totalFibre: Math.round((baseNuts.totalFibre || 10.43) * factor * 10) / 10,
      sodium: Math.round((baseNuts.sodium || 4.29) * factor),
      addedSugar: 0,
      sugar: Math.round((baseNuts.sugar || 1.0) * factor * 10) / 10,
      potassium: Math.round((baseNuts.potassium || 421) * factor),
      calcium: Math.round((baseNuts.calcium || 54) * factor),
      iron: Math.round((baseNuts.iron || 4.7) * factor * 10) / 10,
      magnesium: Math.round((baseNuts.magnesium || 177) * factor),
      vitaminD: 0,
      omega3: 0.1
    };
    bItem.scoutIndex = visionScoutItems.length;
    bItem.source = 'bracket_pre_extracted';
    bItem.isBracketPreExtracted = true;
    bItem.nutrients = bNuts;
    bItem.truthNutrients = { ...bNuts };
    bItem.nutrientBasisWeight = bItem.estimatedWeightGrams;
    bItem.components = [{
      name: bItem.originalName,
      searchQuery: bItem.originalName,
      weightGrams: bItem.estimatedWeightGrams,
      estimatedWeightGrams: bItem.estimatedWeightGrams,
      nutrients: bNuts,
      calories: bNuts.calories,
      protein: bNuts.protein,
      carbohydrates: bNuts.carbohydrates,
      carbs: bNuts.carbohydrates,
      totalFat: bNuts.totalFat,
      fat: bNuts.totalFat,
      saturatedFat: bNuts.saturatedFat,
      sodium: bNuts.sodium,
      dbSource: 'estimated',
      dbId: null,
    }];
    bItem.componentsDetailList = bItem.components;
    bItem.compositeSiblings = bItem.components;
    bItem.ingredients = [bItem.originalName];
    bItem.visualIngredients = [bItem.originalName];
    visionScoutItems.push(bItem);
    const q = bItem.originalName || bItem.keyword;
    if (q && !queriesToSearch.includes(q)) {
      queriesToSearch.push(q);
    }
  });
}

export interface ExplicitTagsArgs {
  visionScoutItems: any[];
  explicitFoodTags: any[];
  onLog: (msg: string) => void;
}

/** Injects catalog tags directly into vision items (unique offset scoutIndex). */
export function injectExplicitFoodTags(args: ExplicitTagsArgs): void {
  const { visionScoutItems, explicitFoodTags, onLog } = args;
  explicitFoodTags.forEach((tag: any, idx: number) => {
    const existing = visionScoutItems.find((vi: any) => vi.dbId === tag.dbId || vi.keyword === tag.name);
    if (!existing) {
      visionScoutItems.push({
        scoutIndex: 1000 + idx, // unique offset
        keyword: tag.name,
        originalName: tag.name,
        estimatedWeightGrams: tag.weightGrams,
        source: 'catalog_tag',
        dbId: tag.dbId,
        dbSource: 'internal_catalog',
      });
    }
  });
  onLog(`[Explicit Food Tags] Injected ${explicitFoodTags.length} catalog tags directly into vision items.`);
}

/** Infers chainName from package labels on packaged-bind items. */
export function inferPackagedBindChains(args: { packagedBindItems: any[]; onLog: (msg: string) => void }): void {
  const { packagedBindItems, onLog } = args;
  for (const it of packagedBindItems) {
    if (!it.chainName && it.packageLabelText) {
      const brandGuess = inferChainNameFromPackageLabel(it.packageLabelText);
      if (brandGuess) {
        it.chainName = brandGuess;
        onLog(`[PackagedBind] Inferred chainName "${brandGuess}" from packageLabelText for "${it.originalName || it.keyword}".`);
      }
    }
  }
}

/** Maps text-search queries to scout-shaped rows with cooking-method sniffing. */
export function mapTextQueriesToScoutItems(extractedQueries: string[]): any[] {
  return extractedQueries.map((q, idx) => ({
    scoutIndex: idx,
    keyword: q,
    originalName: q,
    estimatedWeightGrams: 100,
    source: "text_query",
    cookingMethod: /\b(fried|deep_fried|pan_fried|roasted|grilled|baked|boiled|steamed)\b/i.exec(q)?.[0] || "raw",
    visualIngredients: []
  }));
}
