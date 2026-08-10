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

/**
 * Multi-serve grocery packs with a per-100g panel (e.g. Co-op beef topside 100g e / 4 slices).
 * Single-serve pots (yogurt ~215g) with clear container size are NOT ambiguous.
 */
export function detectPortionAmbiguity(item: any, scoutIndex: number): PortionClarifyItem | null {
  const raw = item?.rawNutritionLabel;
  if (!hasPrintedCalories(raw) || !hasEnoughLabelFields(raw)) return null;

  const name = String(item.originalName || item.keyword || item.name || 'Item').trim();
  const nameL = name.toLowerCase();
  const ing = String(item.ingredientsList || item.ingredients || '').toLowerCase();
  const blob = `${nameL} ${ing}`;
  const w = Math.round(Number(item.estimatedWeightGrams) || 0);
  const ssG = parseServingGramsFromLabel(raw.servingSize) ?? 100;

  // Clear single-serve container (pot/cup/bottle) with large estimated weight — trust scout
  if (/\b(yogurt|yoghurt|pot|parfait|smoothie|drink|bottle|can of)\b/i.test(nameL) && w >= 150) {
    return null;
  }
  if (/\b(pot|cup|tub)\b/i.test(nameL) && w >= 180 && Math.abs(w - 215) < 40) {
    return null; // classic UK yogurt pot
  }

  const servingsRaw = raw.servingsPerContainer ?? raw.servings ?? raw.numberOfServings;
  const servings =
    servingsRaw != null && String(servingsRaw).trim() !== ''
      ? Math.round(Number(String(servingsRaw).match(/[\d.]+/)?.[0] || 0))
      : null;

  const looksMultiServePack =
    (servings != null && servings >= 2) ||
    /\b(slice|sliced|topside|rashers|servings?|per slice|4 servings|pack of)\b/i.test(blob) ||
    (ssG === 100 &&
      w > 0 &&
      w < 100 &&
      /\b(beef|chicken|ham|turkey|cheese|salmon|bacon|meat|fish)\b/i.test(nameL));

  if (!(ssG === 100 && looksMultiServePack)) {
    return null;
  }

  const unit =
    servings != null && servings >= 2 && servings <= 12
      ? Math.max(5, Math.round(100 / servings))
      : 25;
  const maxN =
    servings != null && servings >= 2 && servings <= 12 ? servings : Math.max(2, Math.round(100 / unit));

  const options: PortionOption[] = [];
  const seen = new Set<number>();
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

  // Always offer whole 100g panel pack when unit math didn't land on 100
  if (!seen.has(100)) {
    options.push({ id: 'pack_100', label: 'Whole pack / 100g (panel)', weightGrams: 100 });
    seen.add(100);
  }

  if (w > 0 && !seen.has(w)) {
    options.unshift({
      id: `photo_${w}`,
      label: `Photo estimate (${w}g)`,
      weightGrams: w,
    });
  }

  if (options.length < 2) return null;

  return {
    scoutIndex,
    name,
    estimatedWeightGrams: w || unit,
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
