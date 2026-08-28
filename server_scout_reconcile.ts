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

const CONTAINER_FORM_TOKENS = new Set([
  'sandwich', 'sandwiches', 'burger', 'burgers', 'wrap', 'wraps', 'salad', 'salads',
  'bowl', 'bowls', 'sub', 'subs', 'roll', 'rolls', 'bar', 'bars', 'cookie', 'cookies',
  'biscuit', 'biscuits', 'soup', 'soups', 'pizza', 'pizzas', 'pot', 'pots', 'plate',
  'box', 'meal', 'dish', 'side', 'shake', 'platter', 'pasta', 'pie'
]);

const DISCRIMINATOR_CANONICAL: Record<string, string> = {
  chicken: 'chicken',
  poultry: 'chicken',
  turkey: 'turkey',
  duck: 'duck',
  bebek: 'duck',
  pato: 'duck',
  canard: 'duck',
  beef: 'beef',
  steak: 'beef',
  veal: 'beef',
  sapi: 'beef',
  lembu: 'beef',
  daging: 'beef',
  carne: 'beef',
  pork: 'pork',
  bacon: 'bacon',
  ham: 'ham',
  sausage: 'sausage',
  babi: 'pork',
  cerdo: 'pork',
  porc: 'pork',
  lamb: 'lamb',
  mutton: 'lamb',
  kambing: 'lamb',
  salmon: 'salmon',
  tuna: 'tuna',
  cod: 'cod',
  haddock: 'cod',
  trout: 'trout',
  cendro: 'cendro',
  fish: 'fish',
  ikan: 'fish',
  pescado: 'fish',
  poisson: 'fish',
  prawn: 'shrimp',
  prawns: 'shrimp',
  shrimp: 'shrimp',
  udang: 'shrimp',
  camaron: 'shrimp',
  crab: 'crab',
  kepiting: 'crab',
  cangrejo: 'crab',
  lobster: 'lobster',
  squid: 'squid',
  cumi: 'squid',
  cumicumi: 'squid',
  sotong: 'squid',
  calamari: 'squid',
  octopus: 'octopus',
  gurita: 'octopus',
  tofu: 'tofu',
  tahu: 'tofu',
  tempeh: 'tempeh',
  tempe: 'tempeh',
  mushroom: 'mushroom',
  mushrooms: 'mushroom',
  jamur: 'mushroom',
  enoki: 'mushroom',
  falafel: 'falafel',
  halloumi: 'halloumi',
  paneer: 'paneer',
  egg: 'egg',
  eggs: 'egg',
  telur: 'egg',
  telor: 'egg',
  huevo: 'huevo',
  huevos: 'huevo',
  oeuf: 'oeuf',
  ayam: 'chicken',
  pollo: 'chicken',
  vegan: 'vegan',
  veggie: 'vegetarian',
  vegetarian: 'vegetarian',
  chimi: 'chimi',
  chimichurri: 'chimi'
};

export function namesReferToSameFood(a: unknown, b: unknown): boolean {
  const na = normalizeFoodName(a);
  const nb = normalizeFoodName(b);
  if (!na || !nb) return false;

  const NEGATION_MODIFIERS = new Set(['unsweetened', 'sugarfree', 'decaf', 'unsalted', 'fatfree', 'skim', 'diet', 'plain']);
  
  if (na === nb) return true;

  // 0. Modifier conflict check (e.g. unsweetened vs sweetened, diet vs regular)
  // If one name has a negation modifier and the other doesn't, they are different foods.
  const ta = new Set(na.split(' ').filter((t) => t.length >= 3));
  const tb = new Set(nb.split(' ').filter((t) => t.length >= 3));
  
  for (const m of NEGATION_MODIFIERS) {
    const aHas = na.includes(m);
    const bHas = nb.includes(m);
    if (aHas !== bHas) {
      return false;
    }
  }
  if (ta.size === 0 || tb.size === 0) return false;

  // 1. Protein / core ingredient discriminator conflict check
  const discA = new Set<string>();
  ta.forEach((t) => {
    if (DISCRIMINATOR_CANONICAL[t]) discA.add(DISCRIMINATOR_CANONICAL[t]);
  });
  const discB = new Set<string>();
  tb.forEach((t) => {
    if (DISCRIMINATOR_CANONICAL[t]) discB.add(DISCRIMINATOR_CANONICAL[t]);
  });

  if (discA.size > 0 && discB.size > 0) {
    let hasSharedDisc = false;
    discA.forEach((d) => {
      if (discB.has(d)) hasSharedDisc = true;
    });
    if (!hasSharedDisc) {
      // Disjoint core protein/ingredient discriminators — cannot be the same food
      return false;
    }
    // If they share all discriminators on either side (e.g. 'egg' & 'chicken' matches 'telur' & 'ayam')
    const allAShared = Array.from(discA).every(d => discB.has(d));
    const allBShared = Array.from(discB).every(d => discA.has(d));
    if (allAShared || allBShared) {
      return true;
    }
  }

  // 2. Exact substring match (only if very similar in length to avoid "butter" matching "peanut butter")
  if (na.length >= 6 && nb.length >= 6 && (na.includes(nb) || nb.includes(na))) {
    // Only allow substring match if lengths are relatively close (e.g., within 5 characters) or it's a very long string
    if (Math.abs(na.length - nb.length) <= 5) {
      return true;
    }
  }

  // 3. Token overlap check
  const commonTokens: string[] = [];
  ta.forEach((t) => {
    if (tb.has(t)) commonTokens.push(t);
  });

  if (commonTokens.length === 0) return false;

  // If ALL overlapping tokens are purely generic container/form words (e.g. only 'sandwich' or only 'wrap'),
  // and neither name is a single generic word, do NOT match.
  const allCommonAreContainers = commonTokens.every((t) => CONTAINER_FORM_TOKENS.has(t));
  if (allCommonAreContainers) {
    if (ta.size >= 2 && tb.size >= 2) {
      // e.g. "Steak Sandwich" vs "Cheese Sandwich" -> both size >= 2 and only overlap on "sandwich"
      return false;
    }
  }

  // If there are 2 or more non-conflicting overlapping tokens, it's a match
  if (commonTokens.length >= 2) {
    return true;
  }

  // For 1 overlapping token: only match if that token is a specific distinguishing food name
  // (e.g. croissant, cinnamon, cereal) and NOT a generic container word
  const singleToken = commonTokens[0];
  const DANGEROUS_SINGLE_TOKENS = new Set([
    'butter', 'cheese', 'chicken', 'milk', 'oil', 'water', 'sauce', 'cream', 
    'sugar', 'syrup', 'salt', 'pepper', 'garlic', 'onion', 'egg', 'eggs', 
    'bread', 'rice', 'noodle', 'noodles', 'pasta', 'meat', 'beef', 'pork',
    'bean', 'beans', 'potato', 'potatoes', 'apple', 'apples', 'chocolate', 'vanilla',
    'strawberry', 'peanut', 'almond', 'walnut', 'pecan', 'mac', 'macaroni', 'whip', 'whipped'
  ]);

  if (!CONTAINER_FORM_TOKENS.has(singleToken) && !DANGEROUS_SINGLE_TOKENS.has(singleToken)) {
    if (
      singleToken === 'croissant' ||
      singleToken === 'cinnamon' ||
      singleToken === 'cereal' ||
      singleToken === 'granola' ||
      singleToken === 'oatmeal' ||
      singleToken === 'porridge' ||
      ta.size === 1 ||
      tb.size === 1
    ) {
      return true;
    }
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
  if (namesReferToSameFood(itemName, s.dishName)) return true;

  if (Array.isArray(s.components)) {
    for (const c of s.components) {
      const cName = typeof c === 'string' ? c : (c.name || c.foodName || c.keyword || c.searchQuery);
      if (cName && namesReferToSameFood(itemName, cName)) return true;
    }
  }
  if (Array.isArray(s.foods)) {
    for (const f of s.foods) {
      const fName = typeof f === 'string' ? f : (f.foodName || f.name);
      if (fName && namesReferToSameFood(itemName, fName)) return true;
    }
  }
  if (Array.isArray(s.componentsDetailList)) {
    for (const c of s.componentsDetailList) {
      const cName = c.name || c.canonicalDbName || c.foodName;
      if (cName && namesReferToSameFood(itemName, cName)) return true;
    }
  }
  if (Array.isArray(s.visualIngredients)) {
    for (const v of s.visualIngredients) {
      if (v && namesReferToSameFood(itemName, v)) return true;
    }
  }
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
      return byIndex;
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
  if (!sItem) return false;
  return (breakdown || []).some((it) => {
    if (it.scoutIndex !== undefined && sItem.scoutIndex !== undefined && Number(it.scoutIndex) === Number(sItem.scoutIndex)) {
      return true;
    }
    return scoutItemMatchesBreakdownName(sItem, breakdownItemName(it));
  });
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
