/**
 * Golden case scoreboard — parser + types.
 * Safe in browser and Node. No I/O.
 *
 * A = expected meal lines (user-set destination)
 * B = log events / never-match (declared + promoted tensions)
 */

export type GoldenOutcomeKind = 'identity' | 'never' | 'number' | 'shape' | 'log_event' | 'custom';
export type GoldenOutcomeSource = 'parser' | 'tension' | 'user' | 'template';

export type GoldenOutcome = {
  id: string;
  kind: GoldenOutcomeKind;
  label: string;
  expected: string | number | null;
  actual?: string | number | null;
  pass?: boolean | null;
  source: GoldenOutcomeSource;
  enabled: boolean;
  signature?: string;
  query?: string;
};

export type GoldenMealLine = {
  name: string;
  weightGrams: number | null;
  calories: number | null;
  protein: number | null;
  carbohydrates: number | null;
  totalFat: number | null;
  sodium: number | null;
  scored: boolean;
};

export type GoldenAttempt = {
  n: number;
  at: string;
  actor: 'human' | 'studio' | 'system';
  tried: string;
  learned: string;
  next: string;
  createdNewIssue?: string;
  replaySummary?: string;
};

export type GoldenScoreboard = {
  observedMeal: GoldenMealLine[];
  expectedMeal: GoldenMealLine[];
  outcomes: GoldenOutcome[];
  tensions: Array<{ id: string; left: string; right: string; note: string }>;
};

const FORBIDDEN: Array<{ id: string; re: RegExp; label: string; signature: string }> = [
  { id: 'never_powerade', re: /POWERADE/i, label: 'Must not bind Powerade', signature: 'POWERADE' },
  { id: 'never_popsicle', re: /Popsicle/i, label: 'Must not bind Popsicle (e.g. sugar)', signature: 'Popsicle' },
  { id: 'never_taro_leaves', re: /Taro,?\s*leaves/i, label: 'Must not bind taro leaves', signature: 'Taro, leaves' },
  { id: 'never_onion_powder', re: /onion powder/i, label: 'Must not bind onion powder for fresh onion', signature: 'onion powder' },
  { id: 'never_wrap_as_falafel', re: /vegetarian falafel wrap ingredients/i, label: 'Falafel must not be the wrap row', signature: 'vegetarian falafel wrap ingredients' },
  { id: 'never_coop_granola', re: /Co-op Blueberry Granola Yogurt Pot/i, label: 'Generic granola must not be Co-op pot', signature: 'Co-op Blueberry Granola Yogurt Pot' },
  { id: 'never_yogurt_beverage', re: /Blocked beverage candidate.*yogurt/i, label: 'Yogurt must not be treated as a beverage', signature: 'Blocked beverage candidate' },
  { id: 'log_category_fallback', re: /\[Food Resolver Fallback\] Created category fallback/i, label: 'No category fallback for a gap food', signature: '[Food Resolver Fallback] Created category fallback' },
  { id: 'log_curator_schema', re: /Failed to execute curator/i, label: 'Curator schema must parse', signature: 'Failed to execute curator' },
  { id: 'log_receipt_repair', re: /ReceiptInvariant.*REPAIRED/i, label: 'No receipt soft-repair', signature: 'ReceiptInvariant' },
  { id: 'log_scout_scale', re: /\[Reconcile\].*action=scale/i, label: 'Must not scale foundation toward scout kcal', signature: 'action=scale' },
];

export function extractMealLines(food: any): GoldenMealLine[] {
  if (!food) return [];
  const items = food.itemsBreakdown || food.items || [];
  if (!Array.isArray(items)) return [];
  return items.slice(0, 40).map((it: any) => {
    const n = it.nutrients || {};
    return {
      name: String(it.canonicalDbName || it.name || it.originalName || 'item'),
      weightGrams: numOrNull(it.weightGrams ?? it.weight),
      calories: numOrNull(n.calories ?? it.calories),
      protein: numOrNull(n.protein ?? it.protein),
      carbohydrates: numOrNull(n.carbohydrates ?? it.carbs ?? it.carbohydrates),
      totalFat: numOrNull(n.totalFat ?? it.totalFat ?? it.fat),
      sodium: numOrNull(n.sodium ?? it.sodium),
      scored: true,
    };
  });
}

function numOrNull(v: any): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
}

export function parseKnownFails(logText: string): GoldenOutcome[] {
  const log = String(logText || '');
  const out: GoldenOutcome[] = [];
  for (const f of FORBIDDEN) {
    if (f.re.test(log)) {
      out.push({
        id: f.id,
        kind: f.id.startsWith('log_') ? 'log_event' : 'never',
        label: f.label,
        expected: `absent:${f.signature}`,
        actual: f.signature,
        pass: false,
        source: 'parser',
        enabled: true,
        signature: f.signature,
      });
    }
  }
  return out;
}

export function parseTensions(logText: string): Array<{ id: string; left: string; right: string; note: string }> {
  const log = String(logText || '');
  const tensions: Array<{ id: string; left: string; right: string; note: string }> = [];
  const rec = [...log.matchAll(/\[Reconcile\] item="([^"]+)" action=(\w+) foundation=([\d.]+) budget=([\d.]+) final=([\d.]+) factor=([\d.]+)/g)];
  rec.forEach((m, i) => {
    if (m[2] === 'scale' || Math.abs(parseFloat(m[6]) - 1) > 0.02) {
      tensions.push({
        id: `tension_scale_${i}`,
        left: `${m[1]} foundation ${m[3]}`,
        right: `budget ${m[4]} → final ${m[5]} (×${m[6]})`,
        note: 'Foundation was scaled toward a budget. Totals may look right by luck.',
      });
    }
  });
  const recInv = [...log.matchAll(/\[ReceiptInvariant\] FAIL item="([^"]+)" rowSum=([\d.]+) itemCal=([\d.]+)/g)];
  recInv.forEach((m, i) => {
    tensions.push({
      id: `tension_receipt_${i}`,
      left: `${m[1]} rowSum ${m[2]}`,
      right: `itemCal ${m[3]}`,
      note: 'Line sum does not match item calories.',
    });
  });
  const hit = [...log.matchAll(/HIT_UNIQUE for "([^"]+)"\s*->\s*([^\n]+)/g)];
  hit.forEach((m, i) => {
    tensions.push({
      id: `tension_hit_${i}`,
      left: `query "${m[1]}"`,
      right: String(m[2]).trim().slice(0, 120),
      note: 'Unique search hit — confirm this is the intended food.',
    });
  });
  return tensions.slice(0, 20);
}

export function buildScoreboard(input: {
  logText?: string;
  foodLog?: any;
  extraIssues?: string[];
}): GoldenScoreboard {
  const observedMeal = extractMealLines(input.foodLog);
  const outcomes = parseKnownFails(input.logText || '');
  const tensions = parseTensions(input.logText || '');
  (input.extraIssues || []).forEach((text, i) => {
    const t = String(text || '').trim();
    if (!t) return;
    outcomes.push({
      id: `user_${i}_${t.slice(0, 24).replace(/\W+/g, '_')}`,
      kind: 'custom',
      label: t,
      expected: t,
      actual: null,
      pass: false,
      source: 'user',
      enabled: true,
    });
  });
  return {
    observedMeal,
    expectedMeal: observedMeal.map((l) => ({ ...l, scored: false })),
    outcomes,
    tensions,
  };
}

export function evaluateLogOutcomes(outcomes: GoldenOutcome[], logText: string): GoldenOutcome[] {
  const log = String(logText || '');
  return outcomes.map((o) => {
    if (!o.enabled) return { ...o, pass: null };
    if (o.kind === 'log_event' || o.kind === 'never') {
      const sig = o.signature || String(o.actual || '');
      const present = sig ? log.toLowerCase().includes(sig.toLowerCase()) : false;
      return { ...o, pass: !present, actual: present ? sig : null };
    }
    return o;
  });
}

export function evaluateMealLines(
  expected: GoldenMealLine[],
  actual: GoldenMealLine[],
  relTol = 0.01
): { pass: boolean; misses: string[] } {
  const misses: string[] = [];
  const scored = expected.filter((l) => l.scored && l.calories != null);
  if (scored.length === 0) return { pass: true, misses };
  for (const exp of scored) {
    const act = actual.find((a) => namesClose(exp.name, a.name));
    if (!act) {
      misses.push(`missing item "${exp.name}"`);
      continue;
    }
    for (const key of ['calories', 'protein', 'carbohydrates', 'totalFat', 'sodium'] as const) {
      if (exp[key] == null) continue;
      if (act[key] == null || !near(act[key]!, exp[key]!, relTol, 1)) {
        misses.push(`${exp.name} ${key}: expected ${exp[key]}, got ${act[key] ?? 'null'}`);
      }
    }
    if (exp.weightGrams != null && act.weightGrams != null && !near(act.weightGrams, exp.weightGrams, 0.05, 5)) {
      misses.push(`${exp.name} grams: expected ${exp.weightGrams}, got ${act.weightGrams}`);
    }
  }
  return { pass: misses.length === 0, misses };
}

function namesClose(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const nb = b.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

function near(actual: number, expected: number, rel: number, abs: number): boolean {
  return Math.abs(actual - expected) <= Math.max(abs, Math.abs(expected) * rel);
}

export function scoreboardSummary(outcomes: GoldenOutcome[], mealMisses: string[]): {
  passCount: number;
  failCount: number;
  pendingCount: number;
  allGreen: boolean;
} {
  const enabled = outcomes.filter((o) => o.enabled);
  const passCount = enabled.filter((o) => o.pass === true).length + (mealMisses.length === 0 ? 1 : 0);
  const failCount = enabled.filter((o) => o.pass === false).length + (mealMisses.length > 0 ? 1 : 0);
  const pendingCount = enabled.filter((o) => o.pass == null).length;
  const mealOk = mealMisses.length === 0;
  const allGreen = mealOk && enabled.length > 0 && enabled.every((o) => o.pass === true);
  return { passCount, failCount, pendingCount, allGreen };
}
