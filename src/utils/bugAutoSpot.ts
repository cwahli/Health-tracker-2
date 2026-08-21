/**
 * Q-6.4 auto-spot — cheap remaining suggestions at snap.
 * Pre-checked hits; the user unchecks to drop. Does not auto-file.
 * Does not treat "Scouted only" as remaining. Ledger SILENT_REPAIR is parked.
 * Tape log also yields CURATOR_SKIP, SIBLING_ID_COLLISION, FALLBACK_SKEW, COMPONENT_DROP.
 */
import { detectLedgerImbalances } from './goldenLedger';
import {
  extractFoodItems,
  evaluateJourneyBoard,
  normalizeScoutItems,
  parseResolutionDiagnostics,
  type GoldenJourneyRow,
  type JourneyPhase,
} from './goldenJourney';

export type AutoSpotSurface = 'food' | 'home' | 'health' | 'other';

export type AutoSpotCode =
  | 'MICROS_ZERO'
  | 'BRAND_LEAK'
  | 'BRAND_MISSING'
  | 'STAPLE_COMPOSITE'
  | 'PORTION_PACK'
  | 'JOURNEY_FALLBACK'
  | 'JOURNEY_MISMATCH'
  | 'JOURNEY_NO_MATCH'
  | 'LEDGER_SILENT_REPAIR'
  | 'CURATOR_SKIP'
  | 'SIBLING_ID_COLLISION'
  | 'FALLBACK_SKEW'
  | 'COMPONENT_DROP'
  | 'RESURRECTION'
  | 'DUPLICATE_TILE'
  | 'EMPTY_BMI_REINIT'
  | 'DUP_KEYS'
  | 'SAME_DATE'
  | 'MISSING_UNIT'
  | 'SOURCE_COLLAPSE'
  | 'WRONG_DOOR';

export type AutoSpotHit = {
  id: string;
  code: AutoSpotCode;
  surface: AutoSpotSurface;
  text: string;
  item?: string;
  class?: string;
  parked?: boolean;
};

export type AutoSpotResult = {
  remaining: AutoSpotHit[];
  parked: AutoSpotHit[];
};

export type AutoSpotFoodInput = {
  foodLog?: any;
  scout?: any;
  logText?: string;
  query?: string;
  journey?: GoldenJourneyRow[];
};

export type AutoSpotHomeInput = {
  tiles?: Array<string | { key?: string; id?: string; value?: unknown }>;
  profile?: {
    bmiAutoLogged?: boolean;
    bmi?: number | null;
    deletedCustomBiomarkerKeys?: Record<string, number>;
    deletedBiomarkerLogIds?: Record<string, number>;
  };
};

export type AutoSpotHealthInput = {
  history?: Array<{
    id?: string;
    date?: string | null;
    keys?: string[];
    values?: Record<string, unknown>;
    unit?: string | null;
    units?: Record<string, string | null | undefined>;
    sourceReportId?: string | null;
  }>;
  valuesSample?: Array<{ key?: string; value?: unknown; unit?: string | null; date?: string | null }>;
  jobText?: string;
};

const MICRO_KEYS = [
  'potassium',
  'magnesium',
  'calcium',
  'iron',
  'zinc',
  'selenium',
  'iodine',
  'phosphorus',
  'vitaminD',
  'vitaminB12',
  'folate',
  'vitaminC',
  'vitaminE',
  'vitaminK',
  'vitaminA',
  'vitaminB6',
  'thiamine',
  'riboflavin',
  'niacin',
] as const;

function isDoughStaple(name: string): boolean {
  const n = String(name || '').trim().toLowerCase();
  if (!n || n.split(/\s+/).length > 4) return false;
  if (/\b(chicken|beef|pork|tomato|cheese|ham|salad|fruit|berry)\b/.test(n)) return false;
  return /\b(flour|water|salt|yeast|oil|sugar)\b/.test(n);
}
const GENERIC_STAPLE_RE =
  /\b(fruit|fruits|plum|plums|apple|apples|banana|bananas|berr(?:y|ies)|grape|grapes|orange|oranges|pear|pears|milk|egg|eggs|lemon|lime|water)\b/i;
const CHAIN_RE =
  /\b(sainsbury'?s?|tesco|asda|morrisons|waitrose|co-?op|aldi|lidl|mcdonald'?s?|kfc|nando'?s?|subway|pret|starbucks|costa|greggs|marks?\s*(?:&\s*)?spencer|m&s|whole\s*foods|trader\s*joe'?s?|honi\s*poke)\b/i;
const JOURNEY_SPOT: Partial<Record<JourneyPhase, AutoSpotCode>> = {
  fallback: 'JOURNEY_FALLBACK',
  mismatch: 'JOURNEY_MISMATCH',
  no_match: 'JOURNEY_NO_MATCH',
};
const OFFICIAL_SRC = /label|brand|official|^off$|brand_menu/;
const NON_FOOD_VISUAL = /^(dairy|mustard|gluten|soya|soy|sulphur|sulfur(?:\s+dioxide)?|allergens?|contains)$/i;
/** kcal/100g bands for category-fallback skew. Query-scoped, not one FDC. */
const FALLBACK_DENSITY: Array<{ re: RegExp; min?: number; max?: number; label: string }> = [
  { re: /\b(gherkin|pickle|pickled|cornichon|relish)\b/i, max: 45, label: 'pickle' },
  { re: /\b(cucumber)\b/i, max: 30, label: 'cucumber' },
  { re: /\b(avocado|guacamole)\b/i, min: 100, max: 250, label: 'avocado' },
  { re: /\b(lettuce|salad leaves|spinach|rocket|arugula|kale|mixed greens)\b/i, max: 50, label: 'leafy greens' },
  { re: /\b(strawberr|blueberr|raspberr|blackberr|berry|berries)\b/i, max: 90, label: 'berry' },
  { re: /\b(onion|shallot)\b/i, max: 60, label: 'onion' },
];

function slug(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
}

function itemName(item: any): string {
  return String(item?.originalName || item?.name || item?.query || item?.title || item?.keyword || '').trim();
}

function nutrientsOf(item: any): Record<string, unknown> {
  const n = item?.nutrients || item?.averageNutrients || {};
  const out: Record<string, unknown> = { ...(typeof n === 'object' && n ? n : {}) };
  for (const k of MICRO_KEYS) {
    if (out[k] == null && item?.[k] != null) out[k] = item[k];
  }
  return out;
}

function componentsOf(item: any): any[] {
  const raw = item?.components || item?.subcomponents || item?.subComponents || item?.subComps || [];
  return Array.isArray(raw) ? raw : [];
}

function brandOf(item: any): string {
  return String(item?.chainName || item?.brand || item?.brandName || item?.chain_name || '').trim();
}

function dbSourceOf(item: any): string {
  return String(item?.dbSource || item?.source || '').toLowerCase();
}

function isLabelBrandOrComposite(item: any): boolean {
  const src = dbSourceOf(item);
  if (OFFICIAL_SRC.test(src) || src === 'composite') return true;
  if (brandOf(item)) return true;
  const comps = componentsOf(item);
  return comps.length > 1 || !!item?.hasComponents;
}

function zeroMicroCount(item: any): number {
  const n = nutrientsOf(item);
  let zeros = 0;
  for (const k of MICRO_KEYS) {
    const v = n[k];
    if (v == null || v === '') continue;
    if (Number(v) === 0) zeros += 1;
  }
  return zeros;
}

function hit(
  code: AutoSpotCode,
  surface: AutoSpotSurface,
  text: string,
  extra?: Partial<AutoSpotHit>
): AutoSpotHit {
  const item = extra?.item;
  return {
    id: `${code}:${slug(item || text)}`,
    code,
    surface,
    text,
    ...extra,
  };
}

function foodStem(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(fresh|raw|cooked|frozen|organic|mixed)\b/g, ' ')
    .replace(/berries\b/g, 'berry')
    .replace(/([^aeiou])ies\b/g, '$1y')
    .replace(/oes\b/g, 'o')
    .replace(/s\b/g, '')
    .replace(/[^a-z]+/g, '')
    .trim();
}

function namesDistinct(a: string, b: string): boolean {
  const sa = foodStem(a);
  const sb = foodStem(b);
  if (!sa || !sb) return false;
  if (sa === sb) return false;
  if (sa.includes(sb) || sb.includes(sa)) return false;
  return true;
}

function namesCover(hay: string, needle: string): boolean {
  const a = String(hay || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const b = String(needle || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const sa = foodStem(a);
  const sb = foodStem(b);
  if (sa && sb && (sa === sb || sa.includes(sb) || sb.includes(sa))) return true;
  const ta = a.split(/\s+/).filter((t) => t.length > 2);
  const tb = b.split(/\s+/).filter((t) => t.length > 2);
  if (!tb.length) return false;
  return tb.every((t) => ta.some((x) => x.includes(t) || t.includes(x) || foodStem(x) === foodStem(t)));
}

function usdaIdOf(node: any): string | null {
  const raw = node?.fdcId ?? node?.dbId ?? node?.canonicalId ?? node?.canonicalMatch ?? node?.id;
  const s = String(raw ?? '')
    .replace(/^"+|"+$/g, '')
    .trim();
  if (!/^\d{5,8}$/.test(s)) return null;
  return s;
}

function parseCuratorSkips(logText: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\[CuratorAction\] No pick_existing action found for "([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(logText || '')))) {
    const q = m[1].trim();
    const key = q.toLowerCase();
    if (!q || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

function parseFallbackCreates(logText: string): Array<{ query: string; calories: number }> {
  const out: Array<{ query: string; calories: number }> = [];
  const re =
    /\[Food Resolver Fallback\] Created category fallback for gap "([^"]+)":\s*(\{[\s\S]*?\})/g;
  let m: RegExpExecArray | null;
  const log = String(logText || '');
  while ((m = re.exec(log))) {
    let calories = NaN;
    try {
      const parsed = JSON.parse(m[2]);
      calories = Number(parsed?.calories);
    } catch {
      const cm = m[2].match(/"calories"\s*:\s*([\d.]+)/);
      calories = cm ? Number(cm[1]) : NaN;
    }
    if (!Number.isFinite(calories)) continue;
    out.push({ query: m[1].trim(), calories });
  }
  return out;
}

function densityBand(query: string): { min?: number; max?: number; label: string } | null {
  const q = String(query || '');
  for (const row of FALLBACK_DENSITY) {
    if (row.re.test(q)) return row;
  }
  return null;
}

function visualNamesOf(item: any): string[] {
  const vis = item?.visualIngredients;
  const fromVis = Array.isArray(vis)
    ? vis.map((v) => (typeof v === 'string' ? v : itemName(v))).filter(Boolean)
    : [];
  return fromVis.filter((n) => n && !NON_FOOD_VISUAL.test(n.trim()));
}

export function mergeAutoSpotHits(primary: AutoSpotHit[], extra: AutoSpotHit[]): AutoSpotHit[] {
  const seen = new Set<string>();
  const out: AutoSpotHit[] = [];
  for (const h of [...(primary || []), ...(extra || [])]) {
    if (!h?.id || seen.has(h.id)) continue;
    seen.add(h.id);
    out.push(h);
  }
  return out;
}

function foodQuery(input: AutoSpotFoodInput): string {
  const meal = input.foodLog || {};
  const scout = normalizeScoutItems(input.scout);
  const fromScout = scout.map(itemName).filter(Boolean).join(' ');
  return String(input.query || meal.name || meal.query || fromScout || '').trim();
}

export function autoSpotFood(input: AutoSpotFoodInput): AutoSpotResult {
  const remaining: AutoSpotHit[] = [];
  const parked: AutoSpotHit[] = [];
  const seen = new Set<string>();
  const push = (h: AutoSpotHit) => {
    if (seen.has(h.id)) return;
    seen.add(h.id);
    (h.parked ? parked : remaining).push(h);
  };

  const items = extractFoodItems(input.foodLog);
  const scout = normalizeScoutItems(input.scout);
  const query = foodQuery(input);

  for (const item of items) {
    const name = itemName(item) || 'item';
    if (isLabelBrandOrComposite(item)) {
      const zeros = zeroMicroCount(item);
      if (zeros >= 8) {
        push(
          hit('MICROS_ZERO', 'food', `${name}: ${zeros} micro keys at 0`, {
            item: name,
            class: 'FALSE_FRIEND',
          })
        );
      }
    }

    const comps = componentsOf(item);
    if (comps.length > 0 && (item.hasComponents || comps.length >= 2)) {
      const names = comps.map(itemName).filter(Boolean);
      if (names.length && names.every((n) => isDoughStaple(n))) {
        push(
          hit('STAPLE_COMPOSITE', 'food', `${name}: staple dough (flour/water/salt/yeast/oil) tagged composite`, {
            item: name,
            class: 'FALSE_FRIEND',
          })
        );
      }
    }

    const walk = [item, ...comps];
    for (const node of walk) {
      const n = itemName(node);
      if (!n || !brandOf(node) || !GENERIC_STAPLE_RE.test(n)) continue;
      push(
        hit('BRAND_LEAK', 'food', `${n}: generic staple inherited brand “${brandOf(node)}”`, {
          item: n,
          class: 'FALSE_FRIEND',
        })
      );
    }

    const packN = Number(
      item.servingsPerPack ?? item.detectedUnits ?? item.unitsInPack ?? item.portionClarify?.detectedUnits
    );
    const eaten = Number(item.quantity ?? item.count ?? item.units ?? 0);
    const scoutN = scout.filter((s) => {
      const sn = itemName(s).toLowerCase();
      const iname = name.toLowerCase();
      return sn && iname && (sn.includes(iname) || iname.includes(sn));
    }).length;
    const visualCount = eaten > 0 ? eaten : scoutN || (scout.length === 1 ? 1 : 0);
    if (Number.isFinite(packN) && packN >= 4 && visualCount > 0 && packN >= visualCount * 3) {
      push(
        hit('PORTION_PACK', 'food', `${name}: pack ${packN} vs ${visualCount} in photo/scout`, {
          item: name,
          class: 'OPENING_WRONG',
        })
      );
    }
  }

  const chain = query.match(CHAIN_RE)?.[0];
  if (chain) {
    const branded = [...items, ...scout];
    const missing = branded.filter((it) => {
      if (!it) return false;
      if (brandOf(it)) return false;
      if (OFFICIAL_SRC.test(dbSourceOf(it))) return false;
      const n = itemName(it);
      if (!n || GENERIC_STAPLE_RE.test(n)) return false;
      return true;
    });
    if (missing.length) {
      const name = itemName(missing[0]);
      push(
        hit('BRAND_MISSING', 'food', `${name || query}: query has “${chain}” but item has no brand / official source`, {
          item: name,
          class: 'FALSE_FRIEND',
        })
      );
    }
  }

  const curatorSkips = parseCuratorSkips(input.logText || '');
  if (curatorSkips.length) {
    const sample = curatorSkips.slice(0, 4).join(', ');
    const more = curatorSkips.length > 4 ? ` +${curatorSkips.length - 4} more` : '';
    push(
      hit(
        'CURATOR_SKIP',
        'food',
        `Curator skipped pick_existing for ${curatorSkips.length} quer${curatorSkips.length === 1 ? 'y' : 'ies'} (${sample}${more})`,
        { item: curatorSkips[0], class: 'OPENING_WRONG' }
      )
    );
  }

  const byDishId = new Map<string, Array<{ name: string; id: string }>>();
  const addBind = (dish: string, name: string, id: string | null) => {
    if (!id || !name) return;
    const key = dish || '_meal';
    const list = byDishId.get(key) || [];
    list.push({ name, id });
    byDishId.set(key, list);
  };
  for (const d of parseResolutionDiagnostics(input.logText || '')) {
    const id = usdaIdOf({ canonicalMatch: d.canonical, id: d.matchId });
    addBind(d.dish, d.query, id);
  }
  for (const item of items) {
    const parent = itemName(item) || 'item';
    for (const node of componentsOf(item)) {
      addBind(parent, itemName(node) || String(node.searchQuery || ''), usdaIdOf(node));
    }
  }
  for (const [dish, binds] of byDishId) {
    const byId = new Map<string, string[]>();
    for (const b of binds) {
      const names = byId.get(b.id) || [];
      if (!names.some((n) => !namesDistinct(n, b.name))) names.push(b.name);
      byId.set(b.id, names);
    }
    for (const [id, names] of byId) {
      const distinct = names.filter((n, i) => names.slice(0, i).every((p) => namesDistinct(p, n)));
      if (distinct.length < 2) continue;
      push(
        hit(
          'SIBLING_ID_COLLISION',
          'food',
          `${dish}: ${distinct.slice(0, 4).join(', ')} share canonical id ${id}`,
          { item: dish, class: 'FALSE_FRIEND' }
        )
      );
    }
  }

  const diagnostics = parseResolutionDiagnostics(input.logText || '');
  const fallbackCreates = parseFallbackCreates(input.logText || '');
  for (const fb of fallbackCreates) {
    const band = densityBand(fb.query);
    if (!band) continue;
    const over = band.max != null && fb.calories > band.max;
    const under = band.min != null && fb.calories < band.min;
    if (!over && !under) continue;
    const later = diagnostics.some((d) => {
      if (!namesCover(d.query, fb.query) && !namesCover(fb.query, d.query)) return false;
      const src = String(d.source || '').toLowerCase();
      if (!d.canonical) return false;
      if (!src || src === 'null' || src === 'category_fallback' || src === 'estimated') return false;
      return true;
    });
    if (later) continue;
    const dir = over ? `${fb.calories} kcal/100g > ${band.max} ${band.label}` : `${fb.calories} kcal/100g < ${band.min} ${band.label}`;
    push(
      hit('FALLBACK_SKEW', 'food', `${fb.query}: category fallback ${dir}`, {
        item: fb.query,
        class: 'FALSE_FRIEND',
      })
    );
  }

  for (const s of scout) {
    const vis = visualNamesOf(s);
    if (!vis.length) continue;
    const dishName = itemName(s);
    const scoutComps = componentsOf(s);
    const scoutCover = scoutComps.map((c) => itemName(c) || String(c.searchQuery || c.keyword || '')).filter(Boolean);
    const receiptItem = items.find((it) => namesCover(itemName(it), dishName) || namesCover(dishName, itemName(it)));
    const receiptCover = receiptItem
      ? componentsOf(receiptItem).map((c) => itemName(c) || String(c.searchQuery || '')).filter(Boolean)
      : [];
    const dropped: string[] = [];
    for (const v of vis) {
      const inScout = scoutCover.some((c) => namesCover(c, v) || namesCover(v, c));
      const inReceipt = receiptCover.some((c) => namesCover(c, v) || namesCover(v, c));
      if (inScout || inReceipt) continue;
      dropped.push(v);
    }
    if (!dropped.length) continue;
    push(
      hit(
        'COMPONENT_DROP',
        'food',
        `${dishName || 'dish'}: visual “${dropped.slice(0, 3).join(', ')}” missing from components`,
        { item: dishName, class: 'DISH_DROP' }
      )
    );
  }

  const journey =
    input.journey ||
    evaluateJourneyBoard({
      logText: input.logText,
      foodLog: input.foodLog,
      scout: input.scout,
    }).journey;
  for (const row of journey || []) {
    if (row.phase === 'scouted') continue;
    const code = JOURNEY_SPOT[row.phase];
    if (!code) continue;
    push(
      hit(code, 'food', `${row.dish || row.query}: ${row.phase.replace('_', ' ')}`, {
        item: row.query || row.dish,
        class: row.phase === 'mismatch' ? 'FALSE_FRIEND' : 'OPENING_WRONG',
      })
    );
  }

  const imbalances = detectLedgerImbalances({
    logText: input.logText,
    foodLog: input.foodLog,
    scout: input.scout,
  });
  for (const imb of imbalances) {
    if (imb.classHint !== 'SILENT_REPAIR') continue;
    push(
      hit('LEDGER_SILENT_REPAIR', 'food', imb.label, {
        item: imb.id,
        class: 'SILENT_REPAIR',
        parked: true,
      })
    );
  }

  return { remaining, parked };
}

function tileKey(t: string | { key?: string; id?: string; value?: unknown }): string {
  if (typeof t === 'string') return t.trim().toLowerCase();
  return String(t?.key || t?.id || '').trim().toLowerCase();
}

function tileValue(t: string | { key?: string; id?: string; value?: unknown }): unknown {
  return typeof t === 'string' ? undefined : t?.value;
}

function tombstoneMap(v: unknown): Record<string, number> {
  if (!v) return {};
  if (Array.isArray(v)) {
    const out: Record<string, number> = {};
    for (const id of v) if (id) out[String(id)] = 1;
    return out;
  }
  if (typeof v === 'object') return v as Record<string, number>;
  return {};
}

export function autoSpotHome(input: AutoSpotHomeInput): AutoSpotResult {
  const remaining: AutoSpotHit[] = [];
  const tiles = input.tiles || [];
  const keys = tiles.map(tileKey).filter(Boolean);
  const deletedKeys = tombstoneMap(input.profile?.deletedCustomBiomarkerKeys);
  const deletedLogs = tombstoneMap(input.profile?.deletedBiomarkerLogIds);

  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) dups.add(k);
    seen.add(k);
  }
  for (const k of dups) {
    remaining.push(hit('DUPLICATE_TILE', 'home', `Duplicate Home tile “${k}”`, { item: k, class: 'APPLY_MISS' }));
  }

  for (const k of keys) {
    const tomb = deletedKeys[k] || deletedKeys[k.replace(/^custom_/, '')];
    if (!tomb) continue;
    remaining.push(
      hit('RESURRECTION', 'home', `Tile “${k}” present but tombstoned`, { item: k, class: 'APPLY_MISS' })
    );
  }
  for (const logId of Object.keys(deletedLogs)) {
    if (!keys.some((k) => logId.toLowerCase().includes(k))) continue;
    remaining.push(
      hit('RESURRECTION', 'home', `Tile still shown for tombstoned log ${logId}`, {
        item: logId,
        class: 'APPLY_MISS',
      })
    );
  }

  if (input.profile?.bmiAutoLogged) {
    const bmiTile = tiles.find((t) => tileKey(t) === 'bmi');
    const bmiVal = bmiTile != null ? tileValue(bmiTile) : input.profile.bmi;
    const n = bmiVal == null || bmiVal === '' ? NaN : Number(bmiVal);
    if (bmiTile != null && Number.isFinite(n) && n > 0 && !deletedKeys.bmi) {
      remaining.push(
        hit('EMPTY_BMI_REINIT', 'home', 'BMI tile re-initialized after bmiAutoLogged suppression', {
          item: 'bmi',
          class: 'APPLY_MISS',
        })
      );
    }
  }

  return { remaining, parked: [] };
}

export function autoSpotHealth(input: AutoSpotHealthInput): AutoSpotResult {
  const remaining: AutoSpotHit[] = [];
  const history = input.history || [];
  const byDateKey = new Map<string, number>();
  const bySource = new Map<string, typeof history>();

  for (const row of history) {
    const date = String(row.date || '').slice(0, 10);
    const keys = row.keys && row.keys.length ? row.keys : Object.keys(row.values || {});
    const uniq = new Set<string>();
    for (const k of keys) {
      const key = String(k || '').toLowerCase();
      if (!key) continue;
      if (uniq.has(key)) {
        remaining.push(hit('DUP_KEYS', 'health', `Duplicate key “${key}” on ${date || 'one log'}`, { item: key }));
      }
      uniq.add(key);
      if (date) {
        const dk = `${date}::${key}`;
        byDateKey.set(dk, (byDateKey.get(dk) || 0) + 1);
      }
    }
    const units = row.units || {};
    for (const k of uniq) {
      const v = row.values?.[k];
      const u = units[k] ?? row.unit;
      if (v != null && v !== '' && (u == null || String(u).trim() === '')) {
        remaining.push(hit('MISSING_UNIT', 'health', `${k} has a value but no unit`, { item: k }));
      }
    }
    const sid = String(row.sourceReportId || '').trim();
    if (sid) {
      const list = bySource.get(sid) || [];
      list.push(row);
      bySource.set(sid, list);
    }
  }

  for (const [dk, n] of byDateKey) {
    if (n < 2) continue;
    const [date, key] = dk.split('::');
    const rows = history.filter((r) => String(r.date || '').slice(0, 10) === date);
    const noSource = rows.filter((r) => !String(r.sourceReportId || '').trim());
    if (noSource.length >= 2) {
      remaining.push(
        hit('SAME_DATE', 'health', `Same-date “${key}” rows on ${date} without sourceReportId`, { item: key })
      );
    }
  }

  for (const [sid, rows] of bySource) {
    if (rows.length < 2) continue;
    remaining.push(
      hit('SOURCE_COLLAPSE', 'health', `${rows.length} logs share sourceReportId ${sid.slice(0, 24)}`, {
        item: sid,
      })
    );
  }

  for (const s of input.valuesSample || []) {
    if (s.value != null && s.value !== '' && (s.unit == null || String(s.unit).trim() === '')) {
      remaining.push(hit('MISSING_UNIT', 'health', `${s.key || 'value'} has a value but no unit`, { item: s.key }));
    }
  }

  const blob = String(input.jobText || '');
  if (/\b(kcal|food log|itemsBreakdown|scoutItems)\b/i.test(blob)) {
    remaining.push(
      hit('WRONG_DOOR', 'health', 'Food text on a medical/biomarker job', { class: 'WRONG_DOOR' })
    );
  }

  return { remaining, parked: [] };
}

export function autoSpotForSurface(
  surface: AutoSpotSurface,
  input: AutoSpotFoodInput & AutoSpotHomeInput & AutoSpotHealthInput
): AutoSpotResult {
  if (surface === 'food') return autoSpotFood(input);
  if (surface === 'home') return autoSpotHome(input);
  if (surface === 'health') return autoSpotHealth(input);
  return { remaining: [], parked: [] };
}
