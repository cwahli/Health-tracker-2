/**
 * Q-6.4 auto-spot — cheap remaining suggestions at snap.
 * Pre-checked hits; the user unchecks to drop. Does not auto-file.
 * Does not treat "Scouted only" as remaining. Ledger SILENT_REPAIR is parked.
 */
import { detectLedgerImbalances } from './goldenLedger';
import {
  extractFoodItems,
  evaluateJourneyBoard,
  normalizeScoutItems,
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
