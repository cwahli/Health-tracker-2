/**
 * Match dietitian / breakdown rows to Vision Scout entities by scoutIndex or name.
 * Never by array position — that is the 4106 kcal phantom-item bug.
 */

export function normalizeFoodName(s: unknown): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(\d+)\s*(x|pcs|pieces|pc)?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CONFLICTING_PROTEINS = new Set([
  'chicken', 'turkey', 'duck', 'poultry', 'ayam',
  'beef', 'steak', 'pork', 'bacon', 'ham', 'sausage', 'lamb', 'mutton', 'veal', 'daging', 'salami', 'pepperoni', 'prosciutto',
  'fish', 'salmon', 'tuna', 'cod', 'halibut', 'snapper', 'tilapia', 'mackerel', 'sardine', 'trout', 'ikan',
  'shrimp', 'prawn', 'crab', 'lobster', 'squid', 'octopus', 'clam', 'mussel', 'oyster', 'scallop', 'udang',
  'tofu', 'tempeh', 'falafel', 'paneer', 'seitan',
  'egg', 'telur', 'omelet', 'omelette'
]);

export function namesReferToSameFood(a: unknown, b: unknown): boolean {
  const na = normalizeFoodName(a);
  const nb = normalizeFoodName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const ta = new Set(na.split(' ').filter((t) => t.length >= 3));
  const tb = new Set(nb.split(' ').filter((t) => t.length >= 3));

  // Check conflicting main protein/food types (e.g. chicken vs steak/beef)
  const proteinsA = Array.from(ta).filter((t) => CONFLICTING_PROTEINS.has(t));
  const proteinsB = Array.from(tb).filter((t) => CONFLICTING_PROTEINS.has(t));
  if (proteinsA.length > 0 && proteinsB.length > 0) {
    const hasCommonProtein = proteinsA.some((p) => proteinsB.includes(p));
    if (!hasCommonProtein) {
      return false;
    }
  }

  if (na.length >= 6 && nb.length >= 6 && (na.includes(nb) || nb.includes(na))) return true;
  if (ta.size === 0 || tb.size === 0) return false;
  let overlap = 0;
  ta.forEach((t) => {
    if (tb.has(t)) overlap++;
  });
  
  // Specific single-token key food forms or common food category names
  // (generic container words like sandwich, burger, wrap, salad must not match on single-token overlap alone)
  if (
    overlap >= 2 ||
    (overlap === 1 && (
      (ta.has('croissant') && tb.has('croissant')) ||
      (ta.has('cinnamon') && tb.has('cinnamon')) ||
      (ta.has('cereal') && tb.has('cereal')) ||
      (ta.has('cookie') && tb.has('cookie'))
    ))
  ) {
    return true;
  }
  return false;
}

export function breakdownItemName(item: any): string {
  return item?.originalName || item?.canonicalDbName || item?.name || item?.keyword || '';
}

export function scoutItemName(item: any): string {
  return item?.originalName || item?.keyword || item?.name || '';
}

export function isStandaloneLabelName(s: string): boolean {
  const orig = String(s || '').toLowerCase();
  const foodKeywords = [
    'milk', 'burger', 'fries', 'chicken', 'fish', 'beef', 'pork', 'salad', 'wrap',
    'bread', 'juice', 'croissant', 'cinnamon', 'roll',
  ];
  if (foodKeywords.some((kw) => orig.includes(kw))) return false;
  return (
    orig.includes('nutrition fact') ||
    orig.includes('nutrition label') ||
    orig.includes('printed_packaging_label') ||
    orig === 'label'
  );
}

export function scoutItemMatchesBreakdownName(s: any, itemName: string): boolean {
  if (!s || !itemName) return false;
  if (namesReferToSameFood(itemName, s.originalName)) return true;
  if (namesReferToSameFood(itemName, s.keyword)) return true;
  if (namesReferToSameFood(itemName, s.name)) return true;
  if (namesReferToSameFood(itemName, s.canonicalDbName)) return true;
  return false;
}

/** Match one breakdown row to an unused scout item. Never uses array index. */
export function matchBreakdownItemToScout(
  item: any,
  scoutItems: any[],
  usedIndices: Set<any>
): any | null {
  if (!Array.isArray(scoutItems) || scoutItems.length === 0) return null;

  if (item?.scoutIndex !== undefined && item?.scoutIndex !== null) {
    const byIndex = scoutItems.find(
      (s) => s?.scoutIndex !== undefined && Number(s.scoutIndex) === Number(item.scoutIndex)
    );
    if (byIndex && !usedIndices.has(byIndex.scoutIndex)) {
      const itemName = breakdownItemName(item);
      if (!itemName || scoutItemMatchesBreakdownName(byIndex, itemName)) {
        return byIndex;
      }
      // Dietitian reused a sequential index that belongs to a different dish.
    }
  }

  const itemName = breakdownItemName(item);
  if (!itemName) return null;
  return (
    scoutItems.find((s) => {
      if (s?.scoutIndex !== undefined && usedIndices.has(s.scoutIndex)) return false;
      return scoutItemMatchesBreakdownName(s, itemName);
    }) || null
  );
}

export function breakdownAlreadyHasScoutName(breakdown: any[], sItem: any): boolean {
  return (breakdown || []).some((it) => scoutItemMatchesBreakdownName(sItem, breakdownItemName(it)));
}

export type ScoutReconcileResult = {
  items: any[];
  usedIndices: Set<any>;
  reinjected: any[];
};

/**
 * Attach scoutIndex + crop fields from scout. Re-inject a scout dish only when
 * its name is not already on the board (index gap ≠ omission).
 */
export function reconcileDietitianToScout(
  breakdown: any[],
  scoutItems: any[]
): ScoutReconcileResult {
  const items = Array.isArray(breakdown) ? breakdown.map((it) => ({ ...it })) : [];
  const scouts = Array.isArray(scoutItems) ? scoutItems : [];
  const usedIndices = new Set<any>();
  const reinjected: any[] = [];

  const next = items.map((item) => {
    const match = matchBreakdownItemToScout(item, scouts, usedIndices);
    if (!match) {
      return item;
    }
    if (match.scoutIndex !== undefined && match.scoutIndex !== null) {
      usedIndices.add(match.scoutIndex);
    }
    return {
      ...item,
      scoutIndex: match.scoutIndex,
      boundingBox2D: item.boundingBox2D || match.boundingBox2D || null,
      sourceImageIndex:
        typeof item.sourceImageIndex === 'number' ? item.sourceImageIndex : match.sourceImageIndex,
      originalName: item.originalName || match.originalName || item.canonicalDbName,
      keyword: item.keyword || match.keyword,
    };
  });

  scouts.forEach((sItem) => {
    const sIndex = sItem?.scoutIndex;
    if (sIndex === undefined || sIndex === null || usedIndices.has(sIndex)) return;
    if (isStandaloneLabelName(scoutItemName(sItem))) return;
    if (breakdownAlreadyHasScoutName(next, sItem)) return;
    usedIndices.add(sIndex);
    const row = {
      scoutIndex: sIndex,
      canonicalDbName: scoutItemName(sItem) || 'Food Item',
      originalName: scoutItemName(sItem) || 'Food Item',
      keyword: sItem.keyword || null,
      boundingBox2D: sItem.boundingBox2D || null,
      sourceImageIndex: sItem.sourceImageIndex,
      weightGrams: sItem.estimatedWeightGrams || 100,
    };
    next.push(row);
    reinjected.push(row);
  });

  return { items: next, usedIndices, reinjected };
}

/** Soft receipt: never scale component rows. Item calories follow the row sum. */
export function applySoftReceiptAlignment(
  itemCalories: number,
  rowSum: number
): { itemCalories: number; scaled: boolean; factor: number } {
  if (!(rowSum > 0) || !(itemCalories > 0)) {
    return { itemCalories, scaled: false, factor: 1 };
  }
  if (Math.abs(rowSum - itemCalories) <= 1.1) {
    return { itemCalories, scaled: false, factor: 1 };
  }
  return { itemCalories: Math.round(rowSum * 10) / 10, scaled: false, factor: rowSum / itemCalories };
}
