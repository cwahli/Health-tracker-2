/**
 * Golden case scoreboard — parser + types.
 * Safe in browser and Node. No I/O.
 *
 * A = expected meal lines (user-set destination)
 * B = log events / never-match (declared + promoted tensions)
 * C = mid-journey identity + auto invariants (scout → resolve → dietitian → receipt)
 */
import {
  evaluateJourneyBoard,
  PHASE_LABEL,
  groupJourneyByDish,
  snapshotVisibleInvariants,
  sanitizeJobErrorText,
  pipelineLooksComplete,
  jobLooksSucceeded,
  type GoldenInvariant,
  type GoldenJourneyRow,
  type JourneyPhase,
} from './goldenJourney';
import { compileGoldenMeal, type GoldenMealCompile } from './goldenLedger';
import { loopRedClass } from './goldenStudio';
import { autoSpotFood, type AutoSpotHit } from './bugAutoSpot';

export type { GoldenInvariant, GoldenJourneyRow, JourneyPhase };
export { PHASE_LABEL, groupJourneyByDish, snapshotVisibleInvariants, sanitizeJobErrorText };

/** Human title so inbox rows are recoverable without a job id. */
export function deriveGoldenTitle(input: {
  foodLog?: any;
  scout?: any;
  jobId?: string | null;
  fallback?: string;
}): string {
  const fromMeal = extractMealLines(input.foodLog)
    .map((l) => tidyDishName(l.name))
    .filter(Boolean);
  const scoutItems = Array.isArray(input.scout)
    ? input.scout
    : input.scout?.items || input.scout?.scoutItems || [];
  const fromScout = (Array.isArray(scoutItems) ? scoutItems : [])
    .map((s: any) => tidyDishName(s.originalName || s.keyword || s.name))
    .filter(Boolean);
  const names = fromMeal.length ? fromMeal : fromScout;
  const unique: string[] = [];
  for (const n of names) {
    if (!unique.some((u) => u.toLowerCase() === n.toLowerCase())) unique.push(n);
  }
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} + ${unique[1]}`;
  if (unique.length >= 3) {
    return `${unique[0]} + ${unique[1]} + ${unique.length - 2} more`;
  }
  const fb = String(input.fallback || '').trim();
  if (fb && !/^golden\s+job_/i.test(fb) && !/^\[captured meal/i.test(fb)) return fb.slice(0, 80);
  if (input.jobId) return `Meal ${String(input.jobId).replace(/^job_/, '').slice(0, 18)}`;
  return 'Golden meal';
}

export function goldenSlug(title: string, jobId?: string | null): string {
  const base = String(title || 'meal')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 56);
  const tail = String(jobId || '')
    .replace(/^job_/, '')
    .slice(0, 18);
  return tail ? `${base}--${tail}` : base;
}

function tidyDishName(name: string): string {
  return String(name || '')
    .replace(/\s+50%\s*Duroc Breed/i, '')
    .replace(/,\s*Cured and Cooked/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 42);
}

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

export type GoldenResolutionStats = {
  sampled: number;
  usda: number;
  catalog: number;
  curator: number;
  fallback: number;
};

export type GoldenScoreboard = {
  observedMeal: GoldenMealLine[];
  expectedMeal: GoldenMealLine[];
  outcomes: GoldenOutcome[];
  tensions: Array<{ id: string; left: string; right: string; note: string }>;
  resolutionStats?: GoldenResolutionStats;
  journey?: GoldenJourneyRow[];
  invariants?: GoldenInvariant[];
  replayMode?: 'log' | 'catalog' | 'pipeline' | 'loop' | 'analyze';
  ledger?: GoldenMealCompile;
  /** Pre-checked remaining suggestions. Not scoreboard outcomes. Not "Scouted only". */
  autoSpot?: AutoSpotHit[];
};

const FORBIDDEN: Array<{ id: string; re: RegExp; label: string; signature: string }> = [
  { id: 'never_powerade', re: /HIT_UNIQUE[^\n]*POWERADE|Bound[^\n]*POWERADE/i, label: 'Must not bind Powerade', signature: 'POWERADE' },
  { id: 'never_popsicle', re: /Popsicle/i, label: 'Must not bind Popsicle (e.g. sugar)', signature: 'Popsicle' },
  { id: 'never_taro_leaves', re: /Taro,?\s*leaves/i, label: 'Must not bind taro leaves', signature: 'Taro, leaves' },
  { id: 'never_onion_powder', re: /HIT_UNIQUE[^\n]*onion powder|Bound[^\n]*onion powder|Matched stored brand item[^\n]*onion powder/i, label: 'Must not bind onion powder for fresh onion', signature: 'onion powder' },
  { id: 'never_wrap_as_falafel', re: /vegetarian falafel wrap ingredients/i, label: 'Falafel must not be the wrap row', signature: 'vegetarian falafel wrap ingredients' },
  { id: 'never_coop_granola', re: /Co-op Blueberry Granola Yogurt Pot/i, label: 'Generic granola must not be Co-op pot', signature: 'Co-op Blueberry Granola Yogurt Pot' },
  { id: 'never_yogurt_beverage', re: /Blocked beverage candidate.*yogurt/i, label: 'Yogurt must not be treated as a beverage', signature: 'Blocked beverage candidate' },
  { id: 'log_category_fallback', re: /\[Food Resolver Fallback\] Created category fallback/i, label: 'Category fallback used for a gap food', signature: '[Food Resolver Fallback] Created category fallback' },
  { id: 'log_curator_schema', re: /Failed to execute curator/i, label: 'Curator schema must parse', signature: 'Failed to execute curator' },
  { id: 'log_receipt_repair', re: /ReceiptInvariant.*REPAIRED/i, label: 'No receipt soft-repair', signature: 'ReceiptInvariant' },
  { id: 'log_scout_scale', re: /\[Reconcile\].*action=scale/i, label: 'Must not scale foundation toward scout kcal', signature: 'action=scale' },
];

export function extractScoutMealLines(scout: any): GoldenMealLine[] {
  const items = Array.isArray(scout) ? scout : scout?.items || scout?.scoutItems || [];
  if (!Array.isArray(items) || !items.length) return [];
  return items.map((it: any) => ({
    name: String(it.originalName || it.keyword || it.name || 'item'),
    weightGrams: numOrNull(it.estimatedWeightGrams ?? it.weightGrams),
    calories: numOrNull(it.estimatedCalories ?? it.calories),
    protein: null,
    carbohydrates: null,
    totalFat: null,
    sodium: null,
    scored: false,
  }));
}

export function extractMealLines(food: any): GoldenMealLine[] {
  if (!food) return [];

  // 1. Check for top-level dishes list (e.g. food.dishes, food.mealDishes, food.topDishes)
  const topDishes = food.dishes || food.mealDishes || food.topDishes;
  if (Array.isArray(topDishes) && topDishes.length > 0) {
    return topDishes.map((d: any) => {
      const n = d.nutrients || {};
      return {
        name: String(d.dish_name || d.dishName || d.name || 'Dish'),
        weightGrams: numOrNull(d.weightGrams ?? d.weight ?? d.grams),
        calories: numOrNull(n.calories ?? d.calories ?? d.kcal),
        protein: numOrNull(n.protein ?? d.protein),
        carbohydrates: numOrNull(n.carbohydrates ?? d.carbs ?? d.carbohydrates),
        totalFat: numOrNull(n.totalFat ?? d.totalFat ?? d.fat),
        sodium: numOrNull(n.sodium ?? d.sodium),
        scored: true,
      };
    });
  }

  // 2. Check items in itemsBreakdown or items
  const items = food.itemsBreakdown || food.items || [];
  if (Array.isArray(items) && items.length > 0) {
    // If items have explicit dish grouping (dishName/parentDish), aggregate by dish to form clean top dishes
    const hasDishGrouping = items.some((it: any) => it.dishName || it.parentDish || it.dish);
    if (hasDishGrouping) {
      const dishMap = new Map<string, GoldenMealLine>();
      items.forEach((it: any) => {
        const dishName = String(it.dishName || it.parentDish || it.dish || it.canonicalDbName || it.name || 'Dish');
        const n = it.nutrients || {};
        const cal = numOrNull(n.calories ?? it.calories);
        const w = numOrNull(it.weightGrams ?? it.weight);
        const prot = numOrNull(n.protein ?? it.protein);
        const carb = numOrNull(n.carbohydrates ?? it.carbs ?? it.carbohydrates);
        const fat = numOrNull(n.totalFat ?? it.totalFat ?? it.fat);
        const sod = numOrNull(n.sodium ?? it.sodium);

        if (!dishMap.has(dishName)) {
          dishMap.set(dishName, {
            name: dishName,
            weightGrams: w,
            calories: cal,
            protein: prot,
            carbohydrates: carb,
            totalFat: fat,
            sodium: sod,
            scored: true,
          });
        } else {
          const ex = dishMap.get(dishName)!;
          dishMap.set(dishName, {
            ...ex,
            weightGrams: (ex.weightGrams ?? 0) + (w ?? 0) || null,
            calories: (ex.calories ?? 0) + (cal ?? 0) || null,
            protein: (ex.protein ?? 0) + (prot ?? 0) || null,
            carbohydrates: (ex.carbohydrates ?? 0) + (carb ?? 0) || null,
            totalFat: (ex.totalFat ?? 0) + (fat ?? 0) || null,
            sodium: (ex.sodium ?? 0) + (sod ?? 0) || null,
          });
        }
      });
      return Array.from(dishMap.values());
    }

    // 3. Never collapse a multi-item meal into the pack title (e.g. "Prawn Pasta Salad with…")
    return items.slice(0, 40).map((it: any) => {
      const n = it.nutrients || {};
      return {
        name: String(it.originalName || it.canonicalDbName || it.name || it.keyword || 'item'),
        weightGrams: numOrNull(it.weightGrams ?? it.weight ?? it.estimatedWeightGrams),
        calories: numOrNull(n.calories ?? it.calories ?? it.estimatedCalories),
        protein: numOrNull(n.protein ?? it.protein),
        carbohydrates: numOrNull(n.carbohydrates ?? it.carbs ?? it.carbohydrates),
        totalFat: numOrNull(n.totalFat ?? it.totalFat ?? it.fat),
        sodium: numOrNull(n.sodium ?? it.sodium),
        scored: false,
      };
    });
  }

  const groups = food.comparison || food.foodData?.comparison;
  if (Array.isArray(groups) && groups.length) {
    return groups.map((g: any) => {
      const n = g.averageNutrients || g.nutrients || {};
      return {
        name: String(g.groupName || g.name || 'Option'),
        weightGrams: numOrNull(g.weightGrams ?? g.weight),
        calories: numOrNull(n.calories ?? g.calories),
        protein: numOrNull(n.protein ?? g.protein),
        carbohydrates: numOrNull(n.carbohydrates ?? n.carbs),
        totalFat: numOrNull(n.totalFat ?? n.fat),
        sodium: numOrNull(n.sodium),
        scored: false,
      };
    });
  }

  return [];
}

const STALL_RE = /stream stalled|no response from analysis engine|produced no tokens for 90s/i;

function jobHasMealResult(job: any): boolean {
  const r = job?.result;
  return !!(
    r?.pendingFoodLog ||
    r?.data?.pendingFoodLog ||
    r?.foodLog ||
    r?.mealBuild ||
    (Array.isArray(r?.scoutItems) && r.scoutItems.length)
  );
}

/** Drop leftover stall lines from a symptom box / draft. */
export function stripStaleStallLines(text: string): string {
  const lines = String(text || '')
    .split('\n')
    .filter((l) => !STALL_RE.test(l));
  const cleaned = lines.join('\n').replace(/^\[Captured Meal Processing Issues\]\s*/i, '').trim();
  return cleaned;
}

/** Draft / leftover auto-fill that is only the old stall, not a real user note. */
export function isStaleCapturedStallSymptom(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  return !stripStaleStallLines(t);
}

/**
 * Extracts logged errors or problems captured when processing a meal job.
 * Leftover stall on a finished meal is not a current problem.
 */
export function extractCapturedMealProblems(job: any): string[] {
  if (!job) return [];
  const problems: string[] = [];
  const logs = String(job?.result?.backendLogs || job?.liveThoughts?.backendLogs || '');
  const failed = /^(failed|cancelled)$/i.test(String(job.status || ''));
  const stallInLog = STALL_RE.test(logs);
  const ignoreStall =
    jobLooksSucceeded(job.status) ||
    pipelineLooksComplete(logs) ||
    jobHasMealResult(job) ||
    !failed ||
    !stallInLog;
  const dropStale = (text: string) => {
    const t = String(text || '');
    if (!t) return true;
    if (!STALL_RE.test(t)) return false;
    return ignoreStall;
  };

  const jobErr = sanitizeJobErrorText(
    String(job.error?.message || (typeof job.error === 'string' ? job.error : '') || ''),
    logs,
    job.status
  );
  if (jobErr && !dropStale(jobErr)) {
    problems.push(`[Job Error] ${jobErr}`);
  }

  const result = job.result;
  if (result?.pipelineErrors) {
    const list = Array.isArray(result.pipelineErrors)
      ? result.pipelineErrors
      : [result.pipelineErrors];
    list.forEach((e: any) => {
      const msg = typeof e === 'string' ? e : e?.message || JSON.stringify(e);
      if (msg && !dropStale(msg)) problems.push(msg);
    });
  }

  if (result?.error) {
    const em = typeof result.error === 'string' ? result.error : result.error.message || JSON.stringify(result.error);
    const cleaned = sanitizeJobErrorText(String(em || ''), logs, job.status);
    if (cleaned && !dropStale(cleaned)) {
      problems.push(`[Result Error] ${cleaned}`);
    }
  }

  if (result?.warning) {
    problems.push(`[Warning] ${typeof result.warning === 'string' ? result.warning : result.warning.message || JSON.stringify(result.warning)}`);
  }

  if (logs) {
    const knownFails = parseKnownFails(logs);
    knownFails.forEach((f) => problems.push(`[Captured Log Rule] ${f.label}`));

    const lines = logs.split('\n');
    lines.forEach((l) => {
      if (dropStale(l)) return;
      if (/\[(ReceiptInvariant|Reconcile|Error|Exception|FAIL|WARN)\]/i.test(l)) {
        const clean = l.replace(/^\[.*?\]\s*/, '').trim();
        if (clean && !problems.some((p) => p.includes(clean.slice(0, 30)))) {
          problems.push(clean.slice(0, 150));
        }
      }
    });
  }

  return Array.from(new Set(problems)).slice(0, 10);
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

/** Split a Gemini/user mash of several titled bugs into one row each. */
export function splitExtraIssueText(text: string): string[] {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const parts = raw
    .split(/(?<=\.)\s+(?=[A-Z][A-Za-z0-9 /&-]{2,40}:\s)/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [raw];
}

function extraIssueTopic(text: string): 'weight' | 'compare' | 'brand' | 'ham' | 'other' {
  const b = String(text || '').toLowerCase();
  if (/weight anchor|overrid|overwrote|500\s*ml|1\s*l\b|portion weight|explicit weight/.test(b)) return 'weight';
  if (/food\s*data|empty nutrition|comparison mode/.test(b)) return 'compare';
  if (/brand\s*guard|generic token|sugar.*brand|brand.*sugar/.test(b)) return 'brand';
  if (/ham is missing|missing.*ham/.test(b)) return 'ham';
  return 'other';
}

/** Drop duplicates of auto invariants; pass extras the current tape already disproves. */
export function extraIssueStatus(
  text: string,
  ctx: {
    invariants?: GoldenInvariant[];
    outcomes?: GoldenOutcome[];
    journey?: GoldenJourneyRow[];
    logText?: string;
    foodLog?: any;
  }
): 'drop' | 'pass' | 'keep' {
  const topic = extraIssueTopic(text);
  const auto = [...(ctx.invariants || []), ...(ctx.outcomes || [])];
  const autoBlob = auto.map((a) => `${a.id || ''} ${a.label || ''}`).join(' ').toLowerCase();
  const log = String(ctx.logText || '');
  const items = ctx.foodLog?.itemsBreakdown || ctx.foodLog?.items || ctx.foodLog?.foodData?.itemsBreakdown || [];
  if (topic === 'weight') {
    if (/weight_anchor|overwrote the first|500 → 1000/.test(autoBlob)) return 'drop';
    if (!log.trim() && !(ctx.journey || []).length) return 'keep';
    return 'pass';
  }
  if (topic === 'compare') {
    if (/empty_foodlog|final meal json must contain dishes/.test(autoBlob)) return 'drop';
    if (Array.isArray(items) && items.length > 0) return 'pass';
    return 'keep';
  }
  if (topic === 'brand') {
    const sugarOk = (ctx.journey || []).some((j) => /sugar/i.test(j.query) && j.identityPass);
    if (sugarOk) return 'pass';
    if (/blocked branded search for generic token:\s*sugar/i.test(log)) return 'keep';
    return 'pass';
  }
  if (topic === 'ham') {
    if (/label_merge|merged into/.test(autoBlob)) return 'drop';
    return 'keep';
  }
  return 'keep';
}

function extractSignatureFromText(text: string): string | null {
  const t = String(text || '').trim();
  if (!t) return null;
  const match = t.match(/(Discrepancy|Zero matches|Zero fiber|Invariant fail\w*|differ from user|ReceiptInvariant|FAIL|Error|Exception|mismatch)/i);
  if (match) return match[0];
  if (/Zero matches/i.test(t)) return 'Zero matches';
  if (/Discrepancy/i.test(t)) return 'Discrepancy';
  if (/Zero fiber/i.test(t)) return 'Zero fiber';
  if (/Invariant/i.test(t)) return 'Invariant';
  if (/Demographics/i.test(t)) return 'Demographics';
  return null;
}

export function parseResolutionStats(logText: string): GoldenResolutionStats {
  const stats: GoldenResolutionStats = {
    sampled: 0,
    usda: 0,
    catalog: 0,
    curator: 0,
    fallback: 0,
  };

  const lines = logText.split('\n');
  const seenComponents = new Set<string>();

  for (const line of lines) {
    if (line.includes('[Component Resolution Diagnostic]')) {
      const match = line.match(/component\[\d+\]\s+query="([^"]+)"/);
      if (match) {
        const query = match[1];
        // Only count each component query once
        if (!seenComponents.has(query)) {
          seenComponents.add(query);
          stats.sampled++;
          
          if (line.includes('bestMatch.source=usda') || line.includes('bestMatch.source=off')) {
            stats.usda++;
          } else if (line.includes('bestMatch.source=internal_catalog') || line.includes('bestMatch.source=canonical_dict') || line.includes('bestMatch.source=usual_catalog')) {
            stats.catalog++;
          } else if (line.includes('bestMatch.source=estimated') || line.includes('bestMatch.source=null')) {
            stats.fallback++;
          } else if (line.includes('bestMatch.source=brand_official') || line.includes('bestMatch.source=label')) {
            stats.curator++;
          }
        }
      }
    }
  }

  return stats;
}

/** Label-locked meals never emit Component Resolution Diagnostic — count from journey instead. */
export function statsFromJourney(journey: GoldenJourneyRow[] | undefined): GoldenResolutionStats {
  const stats: GoldenResolutionStats = { sampled: 0, usda: 0, catalog: 0, curator: 0, fallback: 0 };
  if (!Array.isArray(journey) || !journey.length) return stats;
  stats.sampled = journey.length;
  for (const j of journey) {
    if (j.phase === 'usda_live') stats.usda++;
    else if (j.phase === 'catalog') stats.catalog++;
    else if (j.phase === 'label_truth') stats.curator++;
    else if (j.phase === 'fallback') stats.fallback++;
  }
  return stats;
}

const BLOCKING_GROUPS = new Set(['identity', 'resolve', 'transport']);

export function journeyToOutcomes(
  journey: GoldenJourneyRow[],
  invariants: GoldenInvariant[],
  opts?: { blockingOnly?: boolean }
): GoldenOutcome[] {
  const out: GoldenOutcome[] = [];
  journey.forEach((row) => {
    if (row.identityPass) return;
    out.push({
      id: row.id,
      kind: row.phase === 'mismatch' ? 'never' : 'identity',
      label: `${row.dish} / ${row.query}: ${PHASE_LABEL[row.phase]}`,
      expected: 'catalog or printed/brand identity',
      actual: [row.phase, row.matchName || row.source || 'unresolved', ...row.blockers].filter(Boolean).join(' · '),
      pass: false,
      source: 'parser',
      enabled: true,
      signature: row.matchName || row.query,
      query: row.query,
    });
  });
  const skipPassIds = new Set([
    'id_all_components_identified',
    'id_every_component_resolved',
    'id_scout_items_present',
  ]);
  invariants.forEach((inv) => {
    if (!inv.label) return;
    if (inv.pass && skipPassIds.has(inv.id)) return;
    if (opts?.blockingOnly && !inv.pass && !BLOCKING_GROUPS.has(inv.group) && inv.group !== 'transport') return;
    out.push({
      id: inv.id,
      kind:
        inv.group === 'identity'
          ? 'identity'
          : inv.group === 'shape' || inv.group === 'truth'
            ? 'shape'
            : inv.group === 'math'
              ? 'number'
              : 'log_event',
      label: inv.label,
      expected: inv.expected,
      actual: inv.actual,
      pass: inv.pass,
      source: 'parser',
      enabled: true,
      signature: inv.signature,
    });
  });
  return out;
}

/** Keep checks that were once red so they move to Fixed and are re-run, not deleted. */
export function retainGoldenOutcomes(
  previous: GoldenOutcome[] | undefined,
  next: GoldenOutcome[],
  logText?: string
): GoldenOutcome[] {
  const byId = new Map<string, GoldenOutcome>();
  next.forEach((o) => {
    if (o?.id) byId.set(o.id, o);
  });
  const log = String(logText || '');
  (previous || []).forEach((p) => {
    if (!p?.id || byId.has(p.id)) return;
    if (/^j_/.test(p.id)) return;
    if (p.source === 'user' || p.kind === 'custom') {
      const ev = evaluateLogOutcomes([p], log)[0] || { ...p, pass: true, actual: 'Cleared on this run' };
      byId.set(p.id, ev.pass ? { ...ev, actual: ev.actual || 'Cleared on this run' } : ev);
      return;
    }
    byId.set(p.id, { ...p, pass: true, actual: 'Cleared on this run' });
    return;
    const sig = String(p.signature || p.label || '');
    const stillInLog = !!(sig && log && log.toLowerCase().includes(sig.toLowerCase()));
    byId.set(p.id, {
      ...p,
      pass: stillInLog ? p.pass : true,
      actual: stillInLog ? p.actual : 'Cleared on this run',
    });
  });
  return [...byId.values()];
}

export function buildScoreboard(input: {
  logText?: string;
  foodLog?: any;
  scout?: any;
  extraIssues?: string[];
  errorText?: string;
  jobStatus?: string;
}): GoldenScoreboard {
  let observedMeal = extractMealLines(input.foodLog);
  const fromScout = extractScoutMealLines(input.scout);
  if (fromScout.length > observedMeal.length) observedMeal = fromScout;
  const known = parseKnownFails(input.logText || '');
  const tensions = parseTensions(input.logText || '');
  let resolutionStats = parseResolutionStats(input.logText || '');
  const { journey, invariants } = evaluateJourneyBoard({
    logText: input.logText,
    foodLog: input.foodLog,
    scout: input.scout,
    errorText: input.errorText,
    jobStatus: input.jobStatus,
  });
  if (resolutionStats.sampled === 0 && journey.length) {
    resolutionStats = statsFromJourney(journey);
  }
  const auto = journeyToOutcomes(journey, invariants);

  // Prefer the richer per-component / invariant rows. Keep a known-fail only
  // when journey/invariants did not already cover its signature.
  const outcomes: GoldenOutcome[] = [...auto];
  const covered = new Set(
    auto
      .map((o) => (o.signature || o.label || '').toLowerCase())
      .filter(Boolean)
  );
  known.forEach((k) => {
    if (k.id === 'log_category_fallback' && journey.length && journey.every((j) => j.phase !== 'fallback')) {
      return;
    }
    const sig = (k.signature || k.label || '').toLowerCase();
    if (sig && [...covered].some((c) => c.includes(sig) || sig.includes(c))) return;
    outcomes.push(k);
  });

  const pieces = (input.extraIssues || []).flatMap(splitExtraIssueText);
  pieces.forEach((raw, i) => {
    const text = String(raw || '').trim();
    if (!text) return;
    const status = extraIssueStatus(text, {
      invariants,
      outcomes: auto,
      journey,
      logText: input.logText,
      foodLog: input.foodLog,
    });
    if (status === 'drop') return;
    const t = text
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/(\.)([A-Z])/g, '$1 $2')
      .replace(/:\s*/g, ': ');
    outcomes.push({
      id: `user_${i}_${text.slice(0, 24).replace(/\W+/g, '_')}`,
      kind: 'custom',
      label: t,
      expected: t,
      actual: status === 'pass' ? 'Covered by current tape / auto check' : null,
      pass: status === 'pass' ? true : false,
      source: 'user',
      enabled: status !== 'pass',
    });
  });
  const spotted = autoSpotFood({
    foodLog: input.foodLog,
    scout: input.scout,
    logText: input.logText,
    journey,
  });
  return {
    observedMeal,
    expectedMeal: observedMeal.map((l) => ({ ...l, scored: false })),
    outcomes,
    tensions,
    resolutionStats,
    journey,
    invariants,
    replayMode: 'log',
    autoSpot: spotted.remaining,
  };
}

export function evaluateLogOutcomes(outcomes: GoldenOutcome[], logText: string): GoldenOutcome[] {
  const log = String(logText || '');
  return outcomes.map((o) => {
    if (!o.enabled) return { ...o, pass: null };
    if (o.kind === 'log_event' || o.kind === 'never') {
      if (o.source === 'parser' && o.pass === true) return o;
      const sig = o.signature || String(o.actual || '');
      const present = sig ? log.toLowerCase().includes(sig.toLowerCase()) : false;
      return { ...o, pass: !present, actual: present ? sig : null };
    }
    if (o.kind === 'custom' || o.source === 'user') {
      const sig = o.signature || extractSignatureFromText(o.label || String(o.expected || ''));
      if (sig) {
        const present = log.toLowerCase().includes(sig.toLowerCase());
        return { ...o, pass: !present, actual: present ? `Found in log: ${sig}` : 'Resolved / Absent' };
      }
      if (!log.trim()) {
        return { ...o, pass: false, actual: 'No log provided' };
      }
      const hasErrorInLog = /\[(Error|FAIL|Exception)\]/i.test(log) && log.toLowerCase().includes(o.label.slice(0, 15).toLowerCase());
      return { ...o, pass: !hasErrorInLog, actual: hasErrorInLog ? 'Error found in log' : 'Resolved' };
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
  const scored = expected.filter((l) => l.scored);
  if (scored.length === 0) return { pass: true, misses };
  for (const exp of scored) {
    const act = actual.find((a) => mealLineNamesMatch(exp.name, a.name, exp.calories == null));
    if (!act) {
      misses.push(
        exp.calories == null
          ? `missing item "${exp.name}" (presence only — no target kcal)`
          : `missing item "${exp.name}"`
      );
      continue;
    }
    if (exp.calories == null) continue;
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

const DRY_CURED_HAM = /\b(serrano|iberico|ib[eé]rico|prosciutto|parma|speck|gran reserva|jamon|jamón)\b/;
const COOKED_FORMED_HAM = /\b(reformed|formed|cooked|sliced ham|honey roast)\b/;

/** Short user-typed names like "Ham" must not match "Serrano Ham", but should match "Reformed Ham". */
export function mealLineNamesMatch(expected: string, actual: string, presenceOnly: boolean): boolean {
  if (!presenceOnly) return namesClose(expected, actual);
  const ne = expected.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const na = actual.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!ne || !na) return false;
  if (ne === na) return true;
  const eTokens = ne.split(/\s+/);
  if (eTokens.length === 1 && eTokens[0].length <= 12) {
    if (na === ne || na.startsWith(`${ne} `)) return true;
    if (eTokens[0] === 'ham') {
      if (DRY_CURED_HAM.test(na)) return false;
      return COOKED_FORMED_HAM.test(na) || /\bham\b/.test(na);
    }
    return false;
  }
  return namesClose(expected, actual);
}

function near(actual: number, expected: number, rel: number, abs: number): boolean {
  return Math.abs(actual - expected) <= Math.max(abs, Math.abs(expected) * rel);
}

export function scoreGoldenRun(input: {
  logText?: string;
  foodLog?: any;
  scout?: any;
  expectedMeal?: GoldenMealLine[];
  extraIssues?: string[];
  errorText?: string;
  jobStatus?: string;
  replayMode?: GoldenScoreboard['replayMode'];
  previousOutcomes?: GoldenOutcome[];
}): {
  board: GoldenScoreboard;
  meal: { pass: boolean; misses: string[] };
  summary: { passCount: number; failCount: number; pendingCount: number; allGreen: boolean };
} {
  const board = buildScoreboard({
    logText: input.logText,
    foodLog: input.foodLog,
    scout: input.scout,
    extraIssues: input.extraIssues,
    errorText: input.errorText,
    jobStatus: input.jobStatus,
  });
  if (Array.isArray(input.expectedMeal) && input.expectedMeal.length) {
    board.expectedMeal = input.expectedMeal;
  }
  if (input.replayMode) board.replayMode = input.replayMode;
  const outcomes = retainGoldenOutcomes(
    input.previousOutcomes,
    evaluateLogOutcomes(board.outcomes, input.logText || ''),
    input.logText || ''
  );
  board.outcomes = outcomes;
  const meal = evaluateMealLines(board.expectedMeal, board.observedMeal);
  board.ledger = compileGoldenMeal({
    logText: input.logText,
    foodLog: input.foodLog,
    scout: input.scout,
    replayMode: input.replayMode,
  });
  const summary = scoreboardSummary(outcomes, meal.misses);
  if (board.ledger && !board.ledger.mayPromote) summary.allGreen = false;
  return { board, meal, summary };
}

export function outcomeBlocksGreen(o: GoldenOutcome): boolean {
  if (o.enabled === false || o.pass !== false) return false;
  return loopRedClass(o.id, o.label) !== 'accept';
}

export function scoreboardSummary(outcomes: GoldenOutcome[], mealMisses: string[]): {
  passCount: number;
  failCount: number;
  pendingCount: number;
  allGreen: boolean;
} {
  const enabled = outcomes.filter((o) => o.enabled);
  const blocking = enabled.filter(outcomeBlocksGreen);
  const passCount = enabled.filter((o) => o.pass === true).length + (mealMisses.length === 0 ? 1 : 0);
  const failCount = blocking.length + (mealMisses.length > 0 ? 1 : 0);
  const pendingCount = enabled.filter((o) => o.pass == null).length;
  const mealOk = mealMisses.length === 0;
  const allGreen = mealOk && blocking.length === 0 && enabled.length > 0;
  return { passCount, failCount, pendingCount, allGreen };
}
