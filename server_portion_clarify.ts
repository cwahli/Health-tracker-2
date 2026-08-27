import { isDishEstimateEnabled } from "./server_food_flags";

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
  if (item.packGrams != null && Number(item.packGrams) > 0) {
    return Math.round(Number(item.packGrams));
  }
  if (item.packageWeightGrams != null && Number(item.packageWeightGrams) > 0) {
    return Math.round(Number(item.packageWeightGrams));
  }
  if (item.netWeightGrams != null && Number(item.netWeightGrams) > 0) {
    return Math.round(Number(item.netWeightGrams));
  }
  if (item.packWeight != null && Number(item.packWeight) > 0) {
    return Math.round(Number(item.packWeight));
  }
  if (Array.isArray(item.components) && item.components.length === 1 && item.components[0].packGrams != null && Number(item.components[0].packGrams) > 0) {
    return Math.round(Number(item.components[0].packGrams));
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
  if (/\b(cone|ice\s*cream|soft\s*serve|sundae)\b/i.test(text)) return 'portion';
  if (/\b(pancakes?|crepes?|waffles?)\b/i.test(text)) return 'pancake';
  if (/\b(croissants?|pastries?|danishes?|viennoiseries?)\b/i.test(text)) return 'croissant';
  if (/\b(crumpets?|muffins?|scones?)\b/i.test(text)) return 'piece';
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
  const w = Math.round(Number(item.estimatedWeightGrams ?? item.weightGrams) || 0);
  const raw = item?.rawNutritionLabel;
  const rawServing = String(raw?.servingSize || raw?.serving || '').trim();
  const ssG = parseServingGramsFromLabel(rawServing) ?? (raw ? 100 : null);

  // 1. Detect explicit pack weight from fields, components, OCR, or label
  let packGrams = detectPackNetWeightGrams(item);

  // Universal Unit Count Match: matches any digit preceding common packaging / unit words
  const unitCountMatch = blob.match(/\b(\d+)\s*(?:pack|pk|slices?|bagels?|rolls?|thins?|buns?|wraps?|tortillas?|pancakes?|muffins?|crumpets?|waffles?|pieces?|pcs?|bars?|bakes?|sachets?|pouches?|biscuits?|cookies?|patties?|fillets?|sausages?|cutlets?|meatballs?|servings?|units?)\b/i);
  let detectedUnits = unitCountMatch ? parseInt(unitCountMatch[1], 10) : 0;

  // Extract leading digit from item name (e.g. "2 butter croissants" → 2, "4 chicken strips" → 4).
  if (!detectedUnits) {
    const nameLeadingDigit = nameL.match(/^(\d+)\s+\w/);
    if (nameLeadingDigit) {
      const n = parseInt(nameLeadingDigit[1], 10);
      if (n >= 2 && n <= 24) detectedUnits = n;
    }
  }

  // Clear single-serve container or visual dessert (ice cream cone, soft serve, sundae, pot/cup/bottle) — trust scout
  if (/\b(ice\s*cream|soft\s*serve|sundae|cone|waffle\s*cone|popsicle|gelato|sorbet|parfait|smoothie)\b/i.test(nameL) && !detectedUnits) {
    return null;
  }

  const unitNoun = extractFoodUnitNoun(name, blob, rawServing);
  const isDiscreteUnitFood = unitNoun !== 'portion' && unitNoun !== 'serving';

  // Multi-serve package / container / servings check
  const servingsRaw = raw?.servingsPerContainer ?? raw?.servings ?? raw?.numberOfServings;
  const servings =
    servingsRaw != null && String(servingsRaw).trim() !== ''
      ? Math.round(Number(String(servingsRaw).match(/[\d.]+/)?.[0] || 0))
      : null;

  // If packGrams wasn't directly found, derive it if item is a multipack or has servings count
  if (!packGrams || packGrams <= 0) {
    const isVisual = item.source === 'visual' || item.contentType === 'visual' || item.contentType === 'visual_food' || !item.rawNutritionLabel;
    if (isVisual && (!detectedUnits || detectedUnits < 2)) {
      return null;
    }
    if (detectedUnits >= 2 && w > 0) {
      packGrams = detectedUnits * w;
    } else if (servings != null && servings >= 2 && w > 0) {
      packGrams = Math.round(servings * w);
    } else if (isDiscreteUnitFood && !isVisual && w > 0) {
      detectedUnits = 4;
      packGrams = 4 * w;
    }
  }

  // CORE LAW: Portion clarify ONLY appears when there is a difference between packGrams and weightGrams!
  if (!packGrams || packGrams <= 0 || Math.abs(packGrams - w) <= 1) {
    return null;
  }

  // If discrete unit food (e.g. croissants, bars, biscuits, patties)
  if (detectedUnits >= 2 || isDiscreteUnitFood) {
    const isIndividualUnit = /\b(bar|biscuit|cookie|bagel|thin|wrap|slice|patty|fillet|sausage|pancake|muffin|crumpet|roll|bun|croissant)\b/i.test(unitNoun);
    let singleUnitGrams: number;
    if (isIndividualUnit && w > 0 && w <= 95) {
      singleUnitGrams = w;
    } else if (unitCountMatch && w > 0 && w <= 95) {
      singleUnitGrams = w;
    } else {
      singleUnitGrams = Math.max(5, Math.round(packGrams / (detectedUnits || 4)));
    }

    const options: PortionOption[] = [];
    const pluralNoun = unitNoun.endsWith('s') ? unitNoun : `${unitNoun}s`;
    const packLabel = unitCountMatch ? `Whole pack of ${detectedUnits} (${packGrams}g)` : `Whole pack (${packGrams}g)`;

    options.push({ id: `unit_1_${singleUnitGrams}`, label: `1 ${unitNoun} (${singleUnitGrams}g)`, weightGrams: singleUnitGrams });
    if (detectedUnits >= 2) {
      options.push({ id: `unit_2_${singleUnitGrams * 2}`, label: `2 ${pluralNoun} (${singleUnitGrams * 2}g)`, weightGrams: singleUnitGrams * 2 });
    }
    if (detectedUnits >= 3 && detectedUnits !== 4) {
      options.push({ id: `unit_3_${singleUnitGrams * 3}`, label: `3 ${pluralNoun} (${singleUnitGrams * 3}g)`, weightGrams: singleUnitGrams * 3 });
    }
    if (!options.some((o) => o.weightGrams === packGrams)) {
      options.push({ id: `pack_${packGrams}`, label: packLabel, weightGrams: packGrams });
    }
    if ((ssG === 100 || !ssG) && !options.some((o) => o.weightGrams === 100)) {
      options.push({ id: 'panel_100', label: '100g (nutrition panel basis)', weightGrams: 100 });
    }

    return {
      scoutIndex,
      name,
      estimatedWeightGrams: w > 0 ? w : singleUnitGrams,
      labelServingGrams: ssG || 100,
      options,
      reason: `Multi-serve pack (${detectedUnits} units) — confirm how much you ate`,
    };
  }

  // General multi-serve grocery / container item
  const options: PortionOption[] = [];
  const seen = new Set<number>();

  // 1. Portion in dish / photo estimate
  if (w > 0) {
    options.push({
      id: `photo_${w}`,
      label: `Portion in dish (${w}g)`,
      weightGrams: w,
    });
    seen.add(w);
  }

  // 2. Whole pack
  if (!seen.has(packGrams)) {
    options.push({
      id: `pack_${packGrams}`,
      label: `Whole pack (${packGrams}g)`,
      weightGrams: packGrams,
    });
    seen.add(packGrams);
  }

  // 3. Portion fractions based on actual pack size or servings
  if (servings != null && servings >= 2 && servings <= 12) {
    const sliceGrams = Math.max(5, Math.round(packGrams / servings));
    for (let n = 1; n < servings; n++) {
      const grams = sliceGrams * n;
      if (!seen.has(grams) && grams > 0 && grams !== packGrams) {
        seen.add(grams);
        const label = n === 1 ? `1 slice / portion (${grams}g)` : `${n} slices / portions (${grams}g)`;
        options.push({ id: `n${n}_${grams}`, label, weightGrams: grams });
      }
    }
  } else if (packGrams >= 100) {
    const half = Math.round(packGrams / 2);
    if (half >= 15 && !seen.has(half) && half !== packGrams) {
      seen.add(half);
      options.push({ id: `half_${half}`, label: `Half pack (${half}g)`, weightGrams: half });
    }
    const quarter = Math.round(packGrams / 4);
    if (quarter >= 15 && !seen.has(quarter) && quarter !== packGrams) {
      seen.add(quarter);
      options.push({ id: `quarter_${quarter}`, label: `1/4 pack (${quarter}g)`, weightGrams: quarter });
    }
  }

  // 4. Always offer 100g if label is per-100g
  if (ssG === 100 && !seen.has(100)) {
    seen.add(100);
    options.push({
      id: 'panel_100',
      label: '100g (nutrition panel basis)',
      weightGrams: 100,
    });
  }

  if (options.length < 2) return null;

  return {
    scoutIndex,
    name,
    estimatedWeightGrams: w,
    labelServingGrams: ssG,
    options,
    reason: `Package weight (${packGrams}g) differs from estimated portion (${w}g) — confirm how much you ate`,
  };
}

export function buildPortionClarifyPayload(scoutItems: any[]): PortionClarifyPayload | null {
  if (!Array.isArray(scoutItems) || scoutItems.length === 0) return null;
  const items: PortionClarifyItem[] = [];
  scoutItems.forEach((it, idx) => {
    const si = it.scoutIndex != null ? Number(it.scoutIndex) : idx;
    const found = detectPortionAmbiguity(it, si);
    if (found) {
      items.push(found);
    }

    // Check composite sub-components
    const subComps: any[] = (Array.isArray(it.compositeSiblings) && it.compositeSiblings.length > 0)
      ? it.compositeSiblings
      : ((Array.isArray(it.components) && it.components.length > 0)
        ? it.components
        : []);

    if (subComps.length > 1) {
      subComps.forEach((comp: any, cIdx: number) => {
        if (!comp) return;
        const compIndex = 10000 + (si * 100) + cIdx;
        const compFound = detectPortionAmbiguity(comp, compIndex);
        if (compFound) {
          items.push(compFound);
        }
      });
    }
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

    let updatedItem = { ...it };

    if (w != null && Number(w) > 0) {
      const weightGrams = Math.round(Number(w));
      const prevW = Math.round(Number(it.estimatedWeightGrams) || 0) || weightGrams;
      updatedItem = {
        ...updatedItem,
        estimatedWeightGrams: weightGrams,
        nutrientBasisWeight: it.nutrientBasisWeight || prevW,
        portionChoiceApplied: weightGrams,
      };
      if (!isDishEstimateEnabled()) {
        const estCal = Number(it.estimatedCalories);
        if (estCal > 0 && prevW > 0) {
          updatedItem.estimatedCalories = Math.round(estCal * (weightGrams / prevW));
        }
      }
    }

    // Also apply choices to composite sub-components if present
    const subComps: any[] = (Array.isArray(it.compositeSiblings) && it.compositeSiblings.length > 0)
      ? it.compositeSiblings
      : ((Array.isArray(it.components) && it.components.length > 0)
        ? it.components
        : []);

    if (subComps.length > 1) {
      let subCompsChanged = false;
      const updatedSubComps = subComps.map((comp: any, cIdx: number) => {
        if (!comp) return comp;
        const compIndex = 10000 + (si * 100) + cIdx;
        const compW =
          choices[String(compIndex)] ??
          choices[compIndex as any] ??
          choices[`${si}-${cIdx + 1}`] ??
          null;
        if (compW != null && Number(compW) > 0) {
          subCompsChanged = true;
          const cWeightGrams = Math.round(Number(compW));
          return {
            ...comp,
            weightGrams: cWeightGrams,
            estimatedWeightGrams: cWeightGrams,
            portionChoiceApplied: cWeightGrams,
          };
        }
        return comp;
      });

      if (subCompsChanged) {
        if (Array.isArray(it.compositeSiblings) && it.compositeSiblings.length > 0) {
          updatedItem.compositeSiblings = updatedSubComps;
        }
        if (Array.isArray(it.components) && it.components.length > 0) {
          updatedItem.components = updatedSubComps;
        }
        if (Array.isArray(it.componentsDetailList) && it.componentsDetailList.length > 0) {
          updatedItem.componentsDetailList = updatedSubComps;
        }
        // If subcomponent weights changed, update parent composite dish total weight
        const totalCompWeight = updatedSubComps.reduce((sum: number, c: any) => sum + (Number(c.weightGrams ?? c.estimatedWeightGrams) || 0), 0);
        if (totalCompWeight > 0) {
          updatedItem.estimatedWeightGrams = totalCompWeight;
          updatedItem.weightGrams = totalCompWeight;
        }
      }
    }

    return updatedItem;
  });
}
