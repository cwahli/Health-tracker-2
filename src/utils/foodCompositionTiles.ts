/**
 * F-8.6 — composition tiles are FoodItems, not flattened components.
 * Photo index is the item's sourceImageIndex; never round-robin across plates.
 */

function itemName(item: any): string {
  return String(item?.canonicalDbName || item?.name || item?.originalName || item?.keyword || '')
    .toLowerCase()
    .trim();
}

function scoutIndexAgrees(item: any, s: any): boolean {
  if (s?.scoutIndex === undefined || item?.scoutIndex === undefined || s?.scoutIndex === null || item?.scoutIndex === null) {
    return false;
  }
  return Number(s.scoutIndex) === Number(item.scoutIndex);
}

export function isComponentRow(item: any): boolean {
  if (!item) return true;
  if (item.role === 'component') return true;
  if (item.isFlattenedComponent) return true;
  return false;
}

/** Drop sauces/sides that belong under another FoodItem. */
export function compositionTileItems(items: any[] | null | undefined): any[] {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  return list.filter((it) => {
    if (isComponentRow(it)) return false;
    return true;
  });
}

/**
 * Use the crop's own photo. Missing/out-of-range index → 0.
 * Do not assign tile i to image i when every item shares index 0 / a null box.
 */
export function resolveTileImageIndex(item: any, imageCount: number): number {
  const rawIdx = typeof item?.sourceImageIndex === 'number' ? item.sourceImageIndex : 0;
  if (!(imageCount > 0)) return 0;
  if (rawIdx >= 0 && rawIdx < imageCount) return rawIdx;
  return 0;
}

export function mapDisplayedScoutItems(
  itemsBreakdown: any[] | null | undefined,
  activeScoutItems: any[] | null | undefined
): any[] {
  const scout = Array.isArray(activeScoutItems) ? activeScoutItems : [];
  if (!Array.isArray(itemsBreakdown) || itemsBreakdown.length === 0) {
    return compositionTileItems(scout);
  }

  const foodRows = compositionTileItems(itemsBreakdown);
  const usedScoutIndices = new Set<any>();

  return foodRows.map((item: any, i: number) => {
    let matchingScout = scout.find((s: any) => scoutIndexAgrees(item, s));
    if (!matchingScout) {
      matchingScout = scout.find((s: any) => {
        if (s.scoutIndex !== undefined && usedScoutIndices.has(s.scoutIndex)) return false;
        const sKey = (s.keyword || s.originalName || '').toLowerCase().trim();
        const sName = (s.originalName || s.keyword || '').toLowerCase().trim();
        const name = itemName(item);
        if (
          name.includes(sKey) ||
          sKey.includes(name) ||
          name.includes(sName) ||
          sName.includes(name) ||
          (name.split(/\s+/)[0] && name.split(/\s+/)[0] === sKey.split(/\s+/)[0])
        ) {
          return true;
        }
        const itemTokens = name.split(/[^a-z0-9]+/).filter((t: string) => t.length >= 3);
        const sTokens = `${sKey} ${sName}`.split(/[^a-z0-9]+/).filter((t: string) => t.length >= 3);
        return itemTokens.some((t: string) => sTokens.includes(t));
      });
    }
    if (!matchingScout && foodRows.length === scout.length) {
      const candidate = scout[i];
      if (candidate && !usedScoutIndices.has(candidate.scoutIndex)) {
        matchingScout = candidate;
      }
    }

    if (matchingScout && matchingScout.scoutIndex !== undefined) {
      usedScoutIndices.add(matchingScout.scoutIndex);
    }

    const updatedName = item.canonicalDbName || item.name || item.originalName || item.originalLocalName;
    const sourceImageIndex =
      typeof item.sourceImageIndex === 'number'
        ? item.sourceImageIndex
        : matchingScout && typeof matchingScout.sourceImageIndex === 'number'
          ? matchingScout.sourceImageIndex
          : null;

    return {
      scoutIndex: matchingScout ? matchingScout.scoutIndex : (item.scoutIndex !== undefined ? item.scoutIndex : i),
      keyword: updatedName || matchingScout?.keyword || 'item',
      originalName: updatedName || matchingScout?.originalName || 'item',
      chainName: matchingScout?.chainName || item.chainName || item.brand || matchingScout?.brand || null,
      brand: matchingScout?.brand || item.brand || item.chainName || matchingScout?.chainName || null,
      scoutOriginalName: matchingScout?.originalName || null,
      labelProductName: matchingScout?.labelProductName || item.labelProductName || null,
      estimatedWeightGrams: item.weightGrams || item.estimatedWeightGrams || matchingScout?.estimatedWeightGrams,
      weightGrams: item.weightGrams || item.estimatedWeightGrams,
      portionRatio: item.portionRatio || matchingScout?.portionRatio || 1.0,
      portionDescription: item.portionDescription || matchingScout?.portionDescription,
      packGrams: item.packGrams || matchingScout?.packGrams,
      boundingBox2D: item.boundingBox2D || (matchingScout ? matchingScout.boundingBox2D : null),
      sourceImageIndex,
      itemConfidence: matchingScout ? matchingScout.itemConfidence : 'High (>90%)',
      anomalyFlags: matchingScout ? matchingScout.anomalyFlags : [],
      cookingMethod: item.cookingMethod || (matchingScout ? matchingScout.cookingMethod : null),
      rawNutritionLabel: matchingScout?.rawNutritionLabel || item.rawNutritionLabel,
      ingredientsList: matchingScout?.ingredientsList || item.ingredientsList,
      visualIngredients: matchingScout?.visualIngredients || item.visualIngredients,
      nutritionFacts: item.nutritionFacts || item.nutrients || matchingScout?.nutritionFacts,
      nutrients: item.nutrients || item.nutritionFacts || matchingScout?.nutrients,
      syntheticBase100g: item.syntheticBase100g || matchingScout?.syntheticBase100g || null,
      baseNutrients100g: item.baseNutrients100g || matchingScout?.baseNutrients100g || null,
      isDishEstimate: Boolean(item.isDishEstimate || matchingScout?.isDishEstimate || item.dbSource === 'estimated'),
      source: matchingScout?.source || item.source,
      dbSource: item.dbSource || ((item.componentsDetailList?.length || item.components?.length) ? 'composite' : matchingScout?.dbSource) || null,
      dbId: item.dbId || matchingScout?.dbId || null,
      isRealTruth: item.dbSource !== 'composite' && (item.isRealTruth || item.dbSource === 'brand_official' || item.dbSource === 'label' || item.dbSource === 'label_partial'),
      labelNutrientsPerServing: item.labelNutrientsPerServing || item.syntheticBase100g || item.primaryBase100g || item.nutrients || matchingScout?.labelNutrientsPerServing || null,
      primaryBase100g: item.primaryBase100g || item.syntheticBase100g || item.labelNutrientsPerServing || null,
      primaryBaseMatchName: item.primaryBaseMatchName || item.canonicalDbName || null,
      componentsDetailList: (Array.isArray(item.componentsDetailList) && item.componentsDetailList.length > 0)
        ? item.componentsDetailList
        : ((Array.isArray(item.components) && item.components.length > 0) ? item.components : (item.componentsDetail || matchingScout?.componentsDetailList || matchingScout?.components || [])),
      components: (Array.isArray(item.components) && item.components.length > 0)
        ? item.components
        : ((Array.isArray(item.componentsDetailList) && item.componentsDetailList.length > 0) ? item.componentsDetailList : (item.componentsDetail || matchingScout?.components || matchingScout?.componentsDetailList || null)),
      compositeSiblings: item.compositeSiblings || matchingScout?.compositeSiblings || item.componentsDetailList || matchingScout?.componentsDetailList || null,
      nutrientSourceMap: item.nutrientSourceMap || matchingScout?.nutrientSourceMap || null,
      role: 'food',
      isFlattenedComponent: false,
    };
  });
}
