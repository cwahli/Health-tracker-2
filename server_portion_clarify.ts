/**
 * B1 — Portion ambiguity detection for dual-column / multi-serve UK packs.
 * Pure helpers: no I/O. Scout may read per-100g truth but must not guess consumed grams.
 */

export type PortionOption = {
  id: string;
  label: string;
  weightGrams: number;
};

export type PortionClarifyItem = {
  scoutIndex: number;
  name: string;
  estimatedWeightGrams: number;
  labelServingGrams: number | null;
  options: PortionOption[];
  reason: string;
};

export type PortionClarifyPayload = {
  promptMessage: string;
  items: PortionClarifyItem[];
  scoutItems?: any[];
};

export function parseServingGramsFromLabel(servingSize: any): number | null {
  if (servingSize == null || servingSize === '') return null;
  const s = String(servingSize).trim();
  const m = s.match(/(\d+(?:\.\d+)?)\s*(?:g|ml)\b/i);
  if (!m) {
    if (/100/.test(s) && /g/i.test(s)) return 100;
    return null;
  }
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function hasPrintedCalories(raw: any): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const c = raw.calories ?? raw.energy ?? raw.kcal;
  if (c == null || c === '') return false;
  const m = String(c).match(/-?\d+(?:\.\d+)?/);
  return !!(m && parseFloat(m[0]) > 0);
}

function hasEnoughLabelFields(raw: any): boolean {
  if (!raw || typeof raw !== 'object') return false;
  let filled = 0;
  for (const [k, v] of Object.entries(raw)) {
    const ck = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (ck === 'servingsize' || ck === 'weight' || ck === 'servingspercontainer') continue;
    if (v === undefined || v === null || v === '' || v === '-' || v === '--') continue;
    filled++;
  }
  return filled >= 4;
}

export function detectPackNetWeightGrams(item: any): number | null {
  if (!item) return null;
  // 1. Explicit package weight fields
  if (item.packageWeightGrams != null && Number(item.packageWeightGrams) > 0) {
    return Math.round(Number(item.packageWeightGrams));
  }
  if (item.netWeightGrams != null && Number(item.netWeightGrams) > 0) {
    return Math.round(Number(item.netWeightGrams));
  }
  if (item.packWeight != null && Number(item.packWeight) > 0) {
    return Math.round(Number(item.packWeight));
  }

  const raw = item.rawNutritionLabel || {};
  const rawServing = String(raw.servingSize || raw.serving || '').trim();
  const rawServingGrams = parseServingGramsFromLabel(rawServing);
  if (rawServingGrams && rawServingGrams > 0 && rawServingGrams !== 100) {
    if (/\b(?:pack|pot|bag|tub|pouch|can|bottle|container)\b/i.test(rawServing)) {
      return Math.round(rawServingGrams);
    }
  }

  const name = String(item.originalName || item.keyword || item.name || '').trim();
  const ing = String(item.ingredientsList || item.ingredients || '').trim();
  const blob = `${name} ${ing} ${String(item.keyword || '')} ${JSON.stringify(raw)}`;

  // 2. Front of pack net weight OCR: e.g. "80g", "85g", "net weight 80g", "e 85g", "80 g e"
  const netMatch = blob.match(/\b(?:net\s*wt\.?|net\s*weight|pack\s*size|netto|weight|e\s*|\b)(\d{2,3})\s*(?:g|grams)\b(?:\s*e\b)?/i);
  if (netMatch) {
    const parsedG = parseInt(netMatch[1], 10);
    if (parsedG >= 25 && parsedG <= 500 && parsedG !== 100) {
      return parsedG;
    }
  }

  // 3. Front of pack printed protein deduction against per-100g label
  // e.g. "16.2g Protein" on front and 19.0g Protein per 100g on label -> 16.2 / 19.0 * 100 = 85.2g
  const frontProteinMatch = blob.match(/\b(\d+(?:\.\d+)?)\s*g\s*protein\b/i);
  const labelProtein = raw.protein ? parseFloat(String(raw.protein).replace(/[^0-9.]/g, '')) : null;
  if (frontProteinMatch && labelProtein && labelProtein > 5 && rawServingGrams === 100) {
    const frontProtein = parseFloat(frontProteinMatch[1]);
    if (frontProtein > 0 && Math.abs(frontProtein - labelProtein) > 0.5) {
      const derived = Math.round((frontProtein / labelProtein) * 100);
      if (derived >= 25 && derived <= 500) {
        return derived;
      }
    }
  }

  // 4. Scout estimatedWeightGrams
  const estW = Math.round(Number(item.estimatedWeightGrams) || 0);
  if (estW > 0 && estW <= 500) {
    return estW;
  }

  return null;
}

/**
 * Extract natural unit noun from food title, ingredient list, or serving description.
 * Works across all categories: bakery, meats, snacks, dairy, seafood, ready meals, etc.
 */
export function extractFoodUnitNoun(name: string, blob: string, servingSizeStr?: string | null): string {
  const text = `${name} ${blob} ${servingSizeStr || ''}`.toLowerCase();

  // 1. Direct unit matches from serving string or name
  if (/\b(bagel\s*thins?|thins?)\b/i.test(text)) return 'bagel thin';
  if (/\b(bagels?)\b/i.test(text)) return 'bagel';
  if (/\b(bars?|cereal\s*bar|snack\s*bar|protein\s*bar)\b/i.test(text)) return 'bar';
  if (/\b(biscuits?|cookies?|crackers?)\b/i.test(text)) return 'biscuit';
  if (/\b(slices?)\b/i.test(text)) return 'slice';
  if (/\b(patties?|patty|burgers?)\b/i.test(text)) return 'patty';
  if (/\b(fillets?|filets?)\b/i.test(text)) return 'fillet';
  if (/\b(sausages?|bangers?|frankfurters?|hot\s*dogs?)\b/i.test(text)) return 'sausage';
  if (/\b(wraps?|tortillas?|fajitas?)\b/i.test(text)) return 'wrap';
  if (/\b(rolls?|bread\s*rolls?|buns?|baps?|barm\s*cakes?)\b/i.test(text)) return 'roll';
  if (/\b(pancakes?|crepes?|waffles?)\b/i.test(text)) return 'pancake';
  if (/\b(crumpets?|muffins?|scones?|croissants?|pastries?)\b/i.test(text)) return 'piece';
  if (/\b(meatballs?|falafels?|nuggets?|bites?|strips?|wings?|tenders?|dumplings?|gyozas?|samosas?)\b/i.test(text)) return 'piece';
  if (/\b(pouches?|sachets?|packets?)\b/i.test(text)) return 'pouch';
  if (/\b(pots?|tubs?|cups?|tins?|cans?|jars?|bottles?)\b/i.test(text)) return 'serving';

  return 'portion';
}

/**
 * Multi-serve grocery packs, multipacks, or items with ambiguous unit counts.
 * Single-serve pots (yogurt ~215g) with clear container size are NOT ambiguous.
 */
export function detectPortionAmbiguity(item: any, scoutIndex: number): PortionClarifyItem | null {
  const name = String(item.originalName || item.keyword || item.name || 'Item').trim();
  const nameL = name.toLowerCase();
  const ing = String(item.ingredientsList || item.ingredients || '').toLowerCase();
  const blob = `${nameL} ${ing} ${String(item.keyword || '').toLowerCase()}`;
  const w = Math.round(Number(item.estimatedWeightGrams) || 0);
  const raw = item?.rawNutritionLabel;
  const rawServing = String(raw?.servingSize || raw?.serving || '').trim();
  const ssG = parseServingGramsFromLabel(rawServing) ?? (raw ? 100 : null);

  // Clear single-serve container (pot/cup/bottle) with large estimated weight — trust scout
  if (/\b(yogurt|yoghurt|parfait|smoothie|drink|bottle|can of)\b/i.test(nameL) && w >= 150) {
    return null;
  }
  if (/\b(pot|cup|tub)\b/i.test(nameL) && w >= 180 && Math.abs(w - 215) < 40) {
    return null; // classic UK yogurt pot
  }

  // Universal Unit Count Match: matches any digit preceding common packaging / unit words
  const unitCountMatch = blob.match(/\b(\d+)\s*(?:pack|pk|slices?|bagels?|rolls?|thins?|buns?|wraps?|tortillas?|pancakes?|muffins?|crumpets?|waffles?|pieces?|pcs?|bars?|bakes?|sachets?|pouches?|biscuits?|cookies?|patties?|fillets?|sausages?|cutlets?|meatballs?|servings?|units?)\b/i);
  let detectedUnits = unitCountMatch ? parseInt(unitCountMatch[1], 10) : 0;

  const unitNoun = extractFoodUnitNoun(name, blob, rawServing);
  const isDiscreteUnitFood = unitNoun !== 'portion' && unitNoun !== 'serving';

  // Check if item is a multi-unit or discrete food product
  if (detectedUnits >= 2 || isDiscreteUnitFood) {
    if (!detectedUnits || detectedUnits < 2 || detectedUnits > 24) {
      if (/\b(bagel|thin|wrap|patty|fillet|muffin|crumpet|roll|bun)\b/i.test(unitNoun)) detectedUnits = 4;
      else if (/\b(biscuit|cookie|piece|sausage)\b/i.test(unitNoun)) detectedUnits = 6;
      else detectedUnits = 4;
    }

    // Determine single unit weight
    const singleUnitGrams = (w > 0 && w <= 95)
      ? w
      : (w > 95 && w <= detectedUnits * 120
          ? Math.round(w / detectedUnits)
          : (ssG && ssG > 0 && ssG < 100 ? ssG : (detectedUnits >= 4 ? 45 : 30)));

    const totalPackGrams = singleUnitGrams * detectedUnits;
    const options: PortionOption[] = [];
    const pluralNoun = unitNoun.endsWith('s') ? unitNoun : `${unitNoun}s`;

    options.push({ id: `unit_1_${singleUnitGrams}`, label: `1 ${unitNoun} (${singleUnitGrams}g)`, weightGrams: singleUnitGrams });
    if (detectedUnits >= 2) {
      options.push({ id: `unit_2_${singleUnitGrams * 2}`, label: `2 ${pluralNoun} (${singleUnitGrams * 2}g)`, weightGrams: singleUnitGrams * 2 });
    }
    if (detectedUnits >= 3 && detectedUnits !== 4) {
      options.push({ id: `unit_3_${singleUnitGrams * 3}`, label: `3 ${pluralNoun} (${singleUnitGrams * 3}g)`, weightGrams: singleUnitGrams * 3 });
    }
    options.push({ id: `pack_${totalPackGrams}`, label: `Whole pack of ${detectedUnits} (${totalPackGrams}g)`, weightGrams: totalPackGrams });
    if (ssG === 100 || !ssG) {
      options.push({ id: 'panel_100', label: '100g (nutrition panel basis)', weightGrams: 100 });
    }

    return {
      scoutIndex,
      name,
      estimatedWeightGrams: singleUnitGrams,
      labelServingGrams: ssG || 100,
      options,
      reason: `Multi-serve pack (${detectedUnits} units) — confirm how much you ate`,
    };
  }

  if (!hasPrintedCalories(raw) || !hasEnoughLabelFields(raw)) return null;

  const servingsRaw = raw.servingsPerContainer ?? raw.servings ?? raw.numberOfServings;
  const servings =
    servingsRaw != null && String(servingsRaw).trim() !== ''
      ? Math.round(Number(String(servingsRaw).match(/[\d.]+/)?.[0] || 0))
      : null;

  const looksMultiServePack =
    (servings != null && servings >= 2) ||
    /\b(slice|sliced|topside|rashers|servings?|per slice|4 servings|pack of|tub|deli|pot|tray|bowl|bag)\b/i.test(blob) ||
    (ssG === 100 &&
      w > 0 &&
      w < 100 &&
      /\b(beef|chicken|ham|turkey|cheese|salmon|bacon|meat|fish|salad|bites|dip|spread|hummus)\b/i.test(nameL));

  if (!(ssG === 100 && looksMultiServePack)) {
    return null;
  }

  const detectedPackWeight = detectPackNetWeightGrams(item) || w || 100;
  const options: PortionOption[] = [];
  const seen = new Set<number>();

  // If we know the actual pack weight (e.g. 80g, 150g, 200g, 350g, 400g)
  if (detectedPackWeight > 0 && detectedPackWeight !== 100) {
    // 1. Offer the actual whole pack
    options.push({
      id: `pack_${detectedPackWeight}`,
      label: `Whole pack (${detectedPackWeight}g)`,
      weightGrams: detectedPackWeight,
    });
    seen.add(detectedPackWeight);

    // 2. Portion fractions based on actual pack size or servings
    if (servings != null && servings >= 2 && servings <= 12) {
      const sliceGrams = Math.max(5, Math.round(detectedPackWeight / servings));
      for (let n = 1; n < servings; n++) {
        const grams = sliceGrams * n;
        if (!seen.has(grams) && grams > 0) {
          seen.add(grams);
          const label = n === 1 ? `1 slice / portion (${grams}g)` : `${n} slices / portions (${grams}g)`;
          options.push({ id: `n${n}_${grams}`, label, weightGrams: grams });
        }
      }
    } else {
      const half = Math.round(detectedPackWeight / 2);
      if (half >= 15 && !seen.has(half)) {
        seen.add(half);
        options.push({ id: `half_${half}`, label: `Half pack (${half}g)`, weightGrams: half });
      }
      const quarter = Math.round(detectedPackWeight / 4);
      if (quarter >= 15 && !seen.has(quarter)) {
        seen.add(quarter);
        options.push({ id: `quarter_${quarter}`, label: `1/4 pack (${quarter}g)`, weightGrams: quarter });
      }
    }

    // 3. Always offer 100g as the panel reference (clearly labeled as panel basis)
    if (!seen.has(100)) {
      seen.add(100);
      options.push({
        id: 'panel_100',
        label: '100g (nutrition panel basis)',
        weightGrams: 100,
      });
    }
  } else {
    // Pack weight is 100g or unknown
    const unit =
      servings != null && servings >= 2 && servings <= 12
        ? Math.max(5, Math.round(100 / servings))
        : 25;
    const maxN =
      servings != null && servings >= 2 && servings <= 12 ? servings : Math.max(2, Math.round(100 / unit));

    for (let n = 1; n <= maxN; n++) {
      const grams = unit * n;
      if (grams > 500) break;
      if (seen.has(grams)) continue;
      seen.add(grams);
      let label: string;
      if (n === 1) label = `1 slice / portion (${grams}g)`;
      else if (n === maxN && grams === 100) label = `Whole pack (${grams}g)`;
      else if (n === maxN) label = `All servings (${grams}g)`;
      else label = `${n} slices / portions (${grams}g)`;
      options.push({ id: `n${n}_${grams}`, label, weightGrams: grams });
    }

    if (!seen.has(100)) {
      options.push({ id: 'pack_100', label: 'Whole pack / 100g (panel)', weightGrams: 100 });
      seen.add(100);
    }
  }

  if (w > 0 && !seen.has(w)) {
    options.push({
      id: `photo_${w}`,
      label: `Photo estimate (${w}g)`,
      weightGrams: w,
    });
    seen.add(w);
  }

  if (options.length < 2) return null;

  return {
    scoutIndex,
    name,
    estimatedWeightGrams: detectedPackWeight || w || 100,
    labelServingGrams: ssG,
    options,
    reason:
      'Multi-serve pack with per-100g nutrition label — confirm how much you ate before we calculate the meal',
  };
}

export function buildPortionClarifyPayload(scoutItems: any[]): PortionClarifyPayload | null {
  if (!Array.isArray(scoutItems) || scoutItems.length === 0) return null;
  const items: PortionClarifyItem[] = [];
  scoutItems.forEach((it, idx) => {
    const si = it.scoutIndex != null ? Number(it.scoutIndex) : idx;
    const found = detectPortionAmbiguity(it, si);
    if (found) items.push(found);
  });
  if (items.length === 0) return null;
  const names = items.map((i) => i.name).join('; ');
  return {
    promptMessage:
      items.length === 1
        ? `How much of “${items[0].name}” did you eat? (Label is per 100g — pick a portion so we don’t guess.)`
        : `Confirm portions for: ${names}`,
    items,
    scoutItems: scoutItems,
  };
}

/** choices: map scoutIndex (string or number key) → weightGrams */
export function applyPortionChoices(
  scoutItems: any[],
  choices: Record<string, number> | null | undefined
): any[] {
  if (!Array.isArray(scoutItems) || !choices || typeof choices !== 'object') {
    return scoutItems || [];
  }
  return scoutItems.map((it, idx) => {
    const si = it.scoutIndex != null ? Number(it.scoutIndex) : idx;
    const w =
      choices[String(si)] ??
      choices[si as any] ??
      choices[String(idx)] ??
      null;
    if (w == null || !(Number(w) > 0)) return it;
    const weightGrams = Math.round(Number(w));
    const prevW = Math.round(Number(it.estimatedWeightGrams) || 0) || weightGrams;
    const next: any = { ...it, estimatedWeightGrams: weightGrams };
    const estCal = Number(it.estimatedCalories);
    if (estCal > 0 && prevW > 0) {
      next.estimatedCalories = Math.round(estCal * (weightGrams / prevW));
    }
    next.portionChoiceApplied = weightGrams;
    return next;
  });
}
