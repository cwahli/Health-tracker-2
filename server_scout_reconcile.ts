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

export function namesReferToSameFood(a: unknown, b: unknown): boolean {
  const na = normalizeFoodName(a);
  const nb = normalizeFoodName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 6 && nb.length >= 6 && (na.includes(nb) || nb.includes(na))) return true;
  const ta = new Set(na.split(' ').filter((t) => t.length >= 4));
  const tb = new Set(nb.split(' ').filter((t) => t.length >= 4));
  if (ta.size === 0 || tb.size === 0) return false;
  let overlap = 0;
  ta.forEach((t) => {
    if (tb.has(t)) overlap++;
  });
  return overlap >= 2 || (overlap === 1 && (ta.has('croissant') || tb.has('croissant') || ta.has('cinnamon') || tb.has('cinnamon')));
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
      if (!itemName || namesReferToSameFood(itemName, scoutItemName(byIndex))) {
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
      return namesReferToSameFood(itemName, scoutItemName(s));
    }) || null
  );
}

export function breakdownAlreadyHasScoutName(breakdown: any[], sItem: any): boolean {
  const sName = scoutItemName(sItem);
  return (breakdown || []).some((it) => namesReferToSameFood(breakdownItemName(it), sName));
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
