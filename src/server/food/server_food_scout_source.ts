/**
 * F-8.10 shard 9 — scout item sourcing, extracted verbatim from
 * runFoodAnalyze. Decides where visionScoutItems come from when no fresh
 * vision dispatch runs: active-meal inherit, compare mapper, or prior-run
 * (skipScout / portionChoices / history fallback) resolution.
 */

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
export function resolvePriorScoutItems(args: PriorScoutArgs): any[] {
  const { body, history, activeMeal } = args;
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
