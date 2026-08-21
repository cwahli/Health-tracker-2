/**
 * Automatic tape review vs human visual checks.
 * Agent drains failing auto checks. Human to do only when auto is green or blocked.
 *
 * Catalog restage (no LLM) can flip identity/resolve. Math / scale / micros /
 * label-merge stay red until one skipScout pipeline on the same card.
 */
import type { BugWorkItem, PinnedTapeCheck } from './bugWorkItem';
import { autoSpotFood } from './bugAutoSpot';
import { replayScoutAgainstCatalog } from './goldenReplay';
import { journeyToOutcomes } from './goldenScoreboard';
import { tapeBoardIsHydrated } from './bugTapeReplay';
import type { GoldenInvariant, GoldenJourneyRow } from './goldenJourney';

export type CheckLane = 'catalog' | 'pipeline' | 'human';

const HUMAN_LINE_RE =
  /screenshot|a11y|contrast|wcag|layout|on.?screen|visual ui|\btypo\b|copy contrast|font size|wrong color|can't tap/i;

export function isHumanCheckLine(text: string): boolean {
  return HUMAN_LINE_RE.test(String(text || ''));
}

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function overlap(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 12 && nb.includes(na)) return true;
  if (nb.length >= 12 && na.includes(nb)) return true;
  return false;
}

export function isAutoInvariant(inv: { group?: string; pass?: boolean; status?: string }): boolean {
  const g = String(inv?.group || '');
  if (/transport|shape/i.test(g) && /quota|stall|timeout/i.test(String((inv as any).label || ''))) return true;
  return /identity|resolve|math|dietitian|truth/i.test(g) || !g;
}

export function uniqueTapeCheckRows(
  board: any
): Array<{ id: string; label: string; pass: boolean; status?: string }> {
  const out: Array<{ id: string; label: string; pass: boolean; status?: string }> = [];
  const push = (id: string, label: string, pass: boolean, status?: string) => {
    const t = String(label || '').trim();
    if (!t) return;
    const blob = `${id} ${t}`;
    if (/scouted only/i.test(blob) || /^j_/i.test(String(id || ''))) return;
    if (out.some((r) => overlap(r.label, t))) return;
    out.push({ id: String(id || t), label: t, pass, status });
  };

  for (const inv of board?.invariants || []) {
    if (!isAutoInvariant(inv) && inv?.pass !== true && inv?.status !== 'pass') continue;
    const pass = inv?.pass === true || inv?.status === 'pass';
    push(inv.id || inv.label, inv.label || inv.id, pass, inv.status);
  }

  const hasFallbackInv = out.some((r) => /category fallback used/i.test(r.label) && !r.pass);
  const hasIdentInv = out.some((r) => /components identified/i.test(r.label) && !r.pass);
  const hasTrial = out.some((r) => /trial balance/i.test(r.label) && !r.pass);
  const hasScale = out.some((r) => /must not scale/i.test(r.label) && !r.pass);
  const compact = out.filter((r) => {
    if (hasTrial && /scout opening kcal vs saved table/i.test(r.label) && !/trial balance/i.test(r.label)) return false;
    if (hasScale && /reconcile scaled item kcal/i.test(r.label)) return false;
    return true;
  });
  out.length = 0;
  out.push(...compact);

  for (const h of board?.autoSpot || []) {
    if (h?.parked) continue;
    const text = String(h.text || '').trim();
    if (!text) continue;
    const code = String(h.code || '');
    if (hasFallbackInv && code === 'JOURNEY_FALLBACK') continue;
    if (hasIdentInv && code === 'JOURNEY_MISMATCH') continue;
    if (hasTrial && /scout opening kcal vs saved table/i.test(text) && !/trial balance/i.test(text)) continue;
    if (hasScale && /reconcile scaled item kcal/i.test(text)) continue;
    push(h.id || text, text, false, 'fail');
  }
  return out;
}

export function failingAutoWorkLines(board: any): string[] {
  const rows = Array.isArray(board?.checks) && board.checks.length
    ? board.checks
    : uniqueTapeCheckRows(board);
  return rows
    .filter((r: PinnedTapeCheck) => !r.pass && !isHumanCheckLine(r.label))
    .map((r: PinnedTapeCheck) => r.label);
}

function isHollowCheckLabel(label: string): boolean {
  return /trial balance incomplete/i.test(String(label || ''));
}

/** Same roster every Replay. Hydrated tape flips pass/fail; hollow tape cannot shrink the list. */
export function retainTapeChecks(
  pinned: PinnedTapeCheck[] | undefined,
  live: PinnedTapeCheck[],
  opts: { hydrated: boolean }
): PinnedTapeCheck[] {
  const liveRows = (live || []).filter((r) => r?.label && !isHollowCheckLabel(r.label));
  if (!opts.hydrated) {
    return pinned?.length ? pinned : [];
  }
  if (!pinned?.length) return liveRows;

  const out: PinnedTapeCheck[] = [];
  for (const p of pinned) {
    const hit =
      liveRows.find((l) => l.id && p.id && l.id === p.id) ||
      liveRows.find((l) => overlap(l.label, p.label));
    if (hit) {
      out.push({
        ...p,
        pass: !!hit.pass,
        label: hit.label || p.label,
        status: hit.status,
        group: hit.group || p.group,
      });
    } else {
      out.push({ ...p, pass: true, status: 'pass' });
    }
  }
  for (const l of liveRows) {
    if (out.some((o) => (o.id && l.id && o.id === l.id) || overlap(o.label, l.label))) continue;
    out.push(l);
  }
  return out;
}

export function overlayAutoRemaining(item: BugWorkItem, board: any): BugWorkItem {
  const hydrated = tapeBoardIsHydrated(board);
  if (!hydrated && !(item.checks || []).length) return item;
  const live = uniqueTapeCheckRows(board);
  const checks = retainTapeChecks(item.checks, live, { hydrated });
  const displayBoard = { ...board, checks };
  const auto = failingAutoWorkLines(displayBoard);
  const human = (item.remaining || []).filter((r) => isHumanCheckLine(r) && !auto.some((a) => overlap(a, r)));
  const remaining = checks.length ? [...auto, ...human] : auto.length ? [...auto, ...human] : item.remaining;
  const done = checks.length
    ? checks.filter((c) => c.pass && !isHumanCheckLine(c.label)).map((c) => c.label)
    : (item.done || []).filter((d) => !auto.some((a) => overlap(a, d)));
  const autoOpen = remaining.filter((r) => !isHumanCheckLine(r)).length;
  return {
    ...item,
    checks,
    remaining,
    done,
    queue: autoOpen ? 'in_progress' : item.queue === 'blocked' ? 'blocked' : item.queue,
  };
}

export function reviewGate(item: BugWorkItem): 'agent' | 'human' | 'stuck' | 'done' {
  if (item.queue === 'done') return 'done';
  if (item.queue === 'blocked') return 'stuck';
  const autoOpen = (item.remaining || []).filter((r) => !isHumanCheckLine(r));
  if (autoOpen.length) return 'agent';
  return 'human';
}

export function checkLane(
  text: string,
  meta?: { group?: string; id?: string; code?: string }
): CheckLane {
  if (isHumanCheckLine(text)) return 'human';
  const blob = `${meta?.id || ''} ${meta?.code || ''} ${meta?.group || ''} ${text}`;
  if (
    /label_merge|id_label_merge|was merged into|trial balance|action=scale|must not scale|reconcile scaled|micro keys|MICROS_ZERO|CURATOR_SKIP|COMPONENT_DROP|LEDGER_|dietitian|atwater|receipt invariant|weight_anchor|FALLBACK_SKEW/i.test(
      blob
    )
  ) {
    return 'pipeline';
  }
  if (/math|dietitian|truth|transport/i.test(String(meta?.group || ''))) return 'pipeline';
  if (/identity|resolve/i.test(String(meta?.group || ''))) return 'catalog';
  if (
    /SIBLING_ID_COLLISION|JOURNEY_|fallback|mismatch|no_match|identified|resolved|canonical id|category fallback/i.test(
      blob
    )
  ) {
    return 'catalog';
  }
  return 'pipeline';
}

function identityInvariantsFromCatalog(
  oldInv: GoldenInvariant[],
  journey: GoldenJourneyRow[]
): GoldenInvariant[] {
  const unexplained = journey.filter(
    (j) => j.phase === 'scouted' || j.phase === 'no_match' || j.phase === 'fallback'
  );
  const unresolved = journey.filter((j) => !j.identityPass);
  const fallbacks = [...new Set(journey.filter((j) => j.phase === 'fallback').map((j) => j.query).filter(Boolean))];
  const out: GoldenInvariant[] = [];
  const present = oldInv.find((i) => i.id === 'id_scout_items_present');
  if (present) out.push(present);
  if (!journey.length) return out;
  out.push({
    id: 'id_every_component_resolved',
    group: 'resolve',
    label: 'Every scout component was resolved (diagnostic, catalog, or printed label)',
    expected: 'identity per component — fallback does not count',
    actual: unexplained.length
      ? `unresolved: ${unexplained.map((j) => `${j.query} (${j.phase})`).join(', ')}`
      : 'all components diagnosed',
    pass: unexplained.length === 0,
  });
  out.push({
    id: 'id_all_components_identified',
    group: 'resolve',
    label: 'All scout components identified (catalog or printed/brand)',
    expected: 'every component catalog/label_truth',
    actual: unresolved.length
      ? unresolved.map((j) => `${j.query} → ${j.phase}`).join('; ')
      : `${journey.length} identified`,
    pass: unresolved.length === 0,
  });
  if (fallbacks.length) {
    out.push({
      id: 'res_no_category_fallback',
      group: 'resolve',
      label:
        fallbacks.length === 1
          ? `Category fallback used for "${fallbacks[0]}"`
          : `Category fallback used for: ${fallbacks.join(', ')}`,
      expected: 'absent',
      actual: fallbacks.join(', '),
      pass: false,
      signature: 'category fallback',
    });
  }
  return out;
}

function collisionsFromJourney(journey: GoldenJourneyRow[]): Array<{ text: string }> {
  const byDish = new Map<string, Map<string, string[]>>();
  for (const row of journey) {
    if (!row.matchId || !row.identityPass) continue;
    const dish = row.dish || '_meal';
    const ids = byDish.get(dish) || new Map();
    const names = ids.get(row.matchId) || [];
    if (!names.some((n) => norm(n) === norm(row.query))) names.push(row.query);
    ids.set(row.matchId, names);
    byDish.set(dish, ids);
  }
  const out: Array<{ text: string }> = [];
  for (const [dish, ids] of byDish) {
    for (const [id, names] of ids) {
      if (names.length < 2) continue;
      out.push({ text: `${dish}: ${names.slice(0, 4).join(', ')} share canonical id ${id}` });
    }
  }
  return out;
}

/** Frozen scout × current dictionary. Identity/resolve may go green; math stays from the old tape. */
export function restageBoardFromCatalog(oldBoard: any, catalogJourney?: GoldenJourneyRow[]): any {
  const journey = catalogJourney || replayScoutAgainstCatalog(oldBoard?.scout);
  const oldInv: GoldenInvariant[] = Array.isArray(oldBoard?.invariants) ? oldBoard.invariants : [];
  const identity = identityInvariantsFromCatalog(oldInv, journey);
  const sticky = oldInv.filter((i) => checkLane(String(i.label || i.id), i) === 'pipeline');
  const byId = new Map<string, GoldenInvariant>();
  for (const i of [...identity, ...sticky]) {
    if (i?.id && !byId.has(i.id)) byId.set(i.id, i);
  }
  const invariants = [...byId.values()];
  const oldSpots = Array.isArray(oldBoard?.autoSpot) ? oldBoard.autoSpot : [];
  const pipelineSpots = oldSpots.filter(
    (h: any) => checkLane(String(h.text || ''), { id: h.code, code: h.code }) === 'pipeline'
  );
  const catalogSpots = autoSpotFood({
    scout: oldBoard?.scout,
    journey,
    foodLog: null,
    logText: '',
  }).remaining;
  const collisionSpots = collisionsFromJourney(journey);
  const autoSpot: any[] = [];
  const pushSpot = (h: any) => {
    const text = String(h.text || '').trim();
    if (!text) return;
    if (autoSpot.some((x) => overlap(String(x.text || ''), text))) return;
    autoSpot.push(h);
  };
  catalogSpots.forEach(pushSpot);
  collisionSpots.forEach((h) => pushSpot({ ...h, code: 'SIBLING_ID_COLLISION', parked: false }));
  pipelineSpots.forEach(pushSpot);
  return {
    ...oldBoard,
    journey,
    invariants,
    autoSpot,
    replayMode: 'catalog',
    outcomes: journeyToOutcomes(journey, invariants),
  };
}

export function planReanalyzeStages(board: any): { catalog: true; pipeline: boolean } {
  const auto = failingAutoWorkLines(board).filter((t) => !isHumanCheckLine(t));
  return { catalog: true, pipeline: auto.length > 0 };
}
