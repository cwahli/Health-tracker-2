/**
 * Meal trial balance — detector, not a solver.
 *
 * Scout opening → foundation → reconcile → receipt → dietitian payload →
 * saved table → narrative. Adjacent books must agree.
 *
 * A backend or dietitian *correction* is an imbalance signal (which class
 * broke identity/math). It must not clear green.
 */

export type LedgerBookId =
  | 'scout_est'
  | 'foundation'
  | 'reconcile'
  | 'dietitian_payload'
  | 'saved_table'
  | 'narrative';

export type LedgerBook = {
  id: LedgerBookId;
  label: string;
  kcal: number | null;
};

export type LedgerImbalance = {
  id: string;
  left: LedgerBookId;
  right: LedgerBookId;
  leftKcal: number | null;
  rightKcal: number | null;
  /** Who mutated the books. */
  signal: 'backend' | 'dietitian' | 'identity';
  classHint: 'DISH_DROP' | 'SILENT_REPAIR' | 'OPENING_WRONG';
  label: string;
};

const TOL = 8;

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
}

function sum(xs: Array<number | null | undefined>): number | null {
  const vals = xs.filter((x): x is number => x != null && Number.isFinite(x));
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) * 10) / 10;
}

function drifted(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) > Math.max(TOL, Math.max(a, b) * 0.03);
}

export function extractLedgerBooks(input: { logText?: string; foodLog?: any; scout?: any }): LedgerBook[] {
  const log = String(input.logText || '');
  const food = input.foodLog || {};
  const items = food.itemsBreakdown || food.items || food.foodData?.itemsBreakdown || [];

  const scoutItems = Array.isArray(input.scout)
    ? input.scout
    : input.scout?.items || input.scout?.scoutItems || [];
  const scoutEst = sum(
    (scoutItems || []).map((s: any) => num(s.estimatedCalories ?? s.calories))
  );

  const foundations = [...log.matchAll(/\[Foundation\] item="[^"]+" kcal=([\d.]+)/g)].map((m) => num(m[1]));
  const reconciles = [...log.matchAll(/\[Reconcile\] item="[^"]+"[^\n]*final=([\d.]+)/g)].map((m) => num(m[1]));

  const payload = log.match(/macroTotals=\{[^}]*"calories":\s*([\d.]+)/);
  const narrative = log.match(/pushes this meal to ([\d,]+)\s*calories/i)
    || log.match(/Total calories are ([\d,]+)\s*kcal/i);

  const savedItems = Array.isArray(items)
    ? sum(items.map((it: any) => num(it.calories ?? it.nutrients?.calories)))
    : null;
  const savedTop = num(food.calories ?? food.nutrients?.calories);

  return [
    { id: 'scout_est', label: 'Scout estimated kcal (opening)', kcal: scoutEst },
    { id: 'foundation', label: 'Backend foundation sum', kcal: sum(foundations) },
    { id: 'reconcile', label: 'Post-reconcile item finals', kcal: sum(reconciles) },
    { id: 'dietitian_payload', label: 'Dietitian prompt macroTotals', kcal: payload ? num(payload[1]) : null },
    { id: 'saved_table', label: 'Saved / UI table', kcal: savedItems ?? savedTop },
    { id: 'narrative', label: 'Dietitian narrative kcal', kcal: narrative ? num(String(narrative[1]).replace(/,/g, '')) : null },
  ];
}

export function detectLedgerImbalances(input: {
  logText?: string;
  foodLog?: any;
  scout?: any;
}): LedgerImbalance[] {
  const log = String(input.logText || '');
  const books = extractLedgerBooks(input);
  const byId = Object.fromEntries(books.map((b) => [b.id, b])) as Record<LedgerBookId, LedgerBook>;
  const out: LedgerImbalance[] = [];

  const pair = (
    left: LedgerBookId,
    right: LedgerBookId,
    signal: LedgerImbalance['signal'],
    classHint: LedgerImbalance['classHint'],
    label: string
  ) => {
    const L = byId[left];
    const R = byId[right];
    if (!drifted(L?.kcal ?? null, R?.kcal ?? null)) return;
    out.push({
      id: `ledger_${left}_vs_${right}`,
      left,
      right,
      leftKcal: L.kcal,
      rightKcal: R.kcal,
      signal,
      classHint,
      label: `${label} (${L.kcal} → ${R.kcal})`,
    });
  };

  pair('foundation', 'reconcile', 'backend', 'SILENT_REPAIR', 'Backend scaled foundation toward a budget');
  pair('reconcile', 'dietitian_payload', 'backend', 'SILENT_REPAIR', 'Pre-dietitian books already drifted');
  pair('dietitian_payload', 'saved_table', 'identity', 'DISH_DROP', 'Saved table ≠ dietitian payload (phantom inject / post-dietitian rewrite)');
  pair('dietitian_payload', 'narrative', 'dietitian', 'SILENT_REPAIR', 'Dietitian wrote a different kcal than its payload');
  pair('saved_table', 'narrative', 'dietitian', 'DISH_DROP', 'Narrative vs table (2621 vs 4106 class)');

  const mutation = (
    re: RegExp,
    signal: LedgerImbalance['signal'],
    classHint: LedgerImbalance['classHint'],
    label: string,
    id: string
  ) => {
    if (!re.test(log)) return;
    out.push({
      id,
      left: 'foundation',
      right: 'saved_table',
      leftKcal: byId.foundation?.kcal ?? null,
      rightKcal: byId.saved_table?.kcal ?? null,
      signal,
      classHint,
      label,
    });
  };

  mutation(/ReceiptInvariant.*REPAIRED/i, 'backend', 'SILENT_REPAIR', 'Backend receipt REPAIRED (books forced to balance)', 'ledger_receipt_repaired');
  mutation(/\[Reconcile\].*action=scale/i, 'backend', 'SILENT_REPAIR', 'Backend reconcile scaled item kcal', 'ledger_reconcile_scale');
  mutation(/\[LedgerInvariant\] applied/i, 'backend', 'SILENT_REPAIR', 'Backend LedgerInvariant mutated row-sum', 'ledger_density_override');
  mutation(/\[Dietitian Reality Check\].*(?:Adjusted|Rescaled|Capped)/i, 'dietitian', 'SILENT_REPAIR', 'Dietitian Reality Check rewrote nutrients', 'ledger_dietitian_rewrite');
  mutation(/\[Atwater Check\].*rescale/i, 'backend', 'SILENT_REPAIR', 'Atwater rescaled a composed item', 'ledger_atwater');
  mutation(/estimated_override/i, 'dietitian', 'SILENT_REPAIR', 'Dietitian estimated_override', 'ledger_dietitian_override');

  const seen = new Set<string>();
  return out.filter((i) => {
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
}

export type GoldenMealCompile = {
  books: LedgerBook[];
  imbalances: LedgerImbalance[];
  mayPromote: boolean;
  primaryClass: LedgerImbalance['classHint'] | null;
  compiler: 'green' | 'unbalanced';
};

/** Compiler: imbalance stays red. Catalog paint cannot promote. */
export function compileGoldenMeal(input: {
  logText?: string;
  foodLog?: any;
  scout?: any;
  replayMode?: string;
}): GoldenMealCompile {
  const books = extractLedgerBooks(input);
  const imbalances = detectLedgerImbalances(input);
  if (input.replayMode === 'catalog') {
    return {
      books,
      imbalances,
      mayPromote: false,
      primaryClass: imbalances[0]?.classHint || null,
      compiler: 'unbalanced',
    };
  }
  return {
    books,
    imbalances,
    mayPromote: imbalances.length === 0,
    primaryClass: imbalances[0]?.classHint || null,
    compiler: imbalances.length === 0 ? 'green' : 'unbalanced',
  };
}

export function formatLedgerBrief(compile: GoldenMealCompile): string {
  const bookLines = compile.books
    .map((b) => `- ${b.label}: ${b.kcal == null ? '—' : `${b.kcal} kcal`}`)
    .join('\n');
  const imb = compile.imbalances.length
    ? compile.imbalances.map((i) => `- [${i.classHint} / ${i.signal}] ${i.label}`).join('\n')
    : '- (books agree)';
  return [
    '## Meal trial balance (compiler)',
    `compiler: ${compile.compiler}${compile.primaryClass ? ` · workClass: ${compile.primaryClass}` : ''}`,
    `mayPromote: ${compile.mayPromote ? 'yes' : 'NO — do not claim fixed_meal'}`,
    '',
    '### Books',
    bookLines,
    '',
    '### Imbalances (backend/dietitian corrections stay red)',
    imb,
  ].join('\n');
}

export function ledgerImbalancesToInvariants(
  imbalances: LedgerImbalance[]
): Array<{
  id: string;
  group: 'math' | 'dietitian';
  label: string;
  expected: string;
  actual: string;
  pass: boolean;
  signature?: string;
}> {
  return imbalances.map((i) => ({
    id: i.id,
    group: i.signal === 'dietitian' ? 'dietitian' : 'math',
    label: i.label,
    expected: 'books agree; no silent correction',
    actual: `${i.left}=${i.leftKcal ?? '—'} ${i.right}=${i.rightKcal ?? '—'} (${i.signal})`,
    pass: false,
    signature: i.id,
  }));
}
