/**
 * Domain-specific bug evidence packs (Initiative K1).
 * Food + Biomarker — pure helpers for capture + all-agent triage.
 */

import { pickSnapshotJob } from './goldenFixture';

export function isFoodJobKind(kind?: string | null): boolean {
  const k = String(kind || '').toLowerCase();
  return k === 'food' || k.startsWith('food_');
}

export function isBioJobKind(kind?: string | null): boolean {
  const k = String(kind || '').toLowerCase();
  return k.includes('medical') || k.includes('biomarker');
}

export type SnapSurface = 'food' | 'home' | 'health' | 'other';

const HOME_TILE_RE = /^(bmi|weight|height|body_mass)$/i;

/** Which pack this snap is allowed to attach. Overlay: foodcart / food tab wins. */
export function snapSurface(category?: string, activeTab?: string): SnapSurface {
  const cat = String(category || '').toLowerCase();
  const tab = String(activeTab || '').toLowerCase();
  if (cat === 'foodcart' || tab === 'food') return 'food';
  if (cat === 'home' || tab === 'home') return 'home';
  if (
    cat === 'biomarker' ||
    cat === 'health' ||
    ['health', 'medical', 'insights', 'trends', 'dictionary'].includes(tab)
  ) {
    return 'health';
  }
  return 'other';
}

export function jobFitsSnap(opts: { category?: string; activeTab?: string; jobKind?: string | null }): boolean {
  const surface = snapSurface(opts.category, opts.activeTab);
  const kind = opts.jobKind;
  if (surface === 'food') return !kind || isFoodJobKind(kind);
  if (surface === 'health') return isBioJobKind(kind);
  if (surface === 'home') return false;
  return true;
}

export type BugDomain = 'food' | 'biomarker' | 'generic';

export type DomainPack = {
  domain: BugDomain;
  capturedAt: string;
  summaryLine: string;
  food?: FoodDomainPack;
  biomarker?: BiomarkerDomainPack;
  generic?: { note?: string; keys?: string[] };
};

export type FoodDomainPack = {
  mode?: string | null;
  jobId?: string | null;
  status?: string | null;
  progressPercent?: number | null;
  mealName?: string | null;
  weightGrams?: number | null;
  quantity?: string | null;
  nutrients?: Record<string, number | string | null | undefined> | null;
  labelLocks?: any;
  items?: Array<{
    name?: string;
    weightGrams?: number | null;
    calories?: number | null;
    source?: string | null;
  }>;
  receipt?: Array<{ item?: string; source?: string; notes?: string }>;
  scoutItems?: Array<{ name?: string; weightGrams?: number | null; portionChoice?: any }>;
  portionClarify?: any;
  refine?: { scaleOnly?: boolean; skipDietitian?: boolean; flags?: string[] };
  photoUrl?: string | null;
  debugUrl?: string | null;
  pipelineErrors?: any[];
  pipelineWarnings?: any[];
};

export type BiomarkerHistoryRow = {
  id?: string;
  date?: string | null;
  sync_state?: string | null;
  updated_at?: number | null;
  keys: string[];
  values?: Record<string, any>;
};

export type BiomarkerDomainPack = {
  jobId?: string | null;
  kind?: string | null;
  agentLabel?: string | null;
  status?: string | null;
  unitPreference?: string | null;
  keys?: string[];
  valuesSample?: Array<{
    key?: string;
    value?: any;
    unit?: string | null;
    date?: string | null;
  }>;
  sanitizeHints?: string[];
  lastAgentMessage?: string | null;
  pipelineErrors?: any[];
  tombstones?: {
    deletedBiomarkerLogIds?: Record<string, number>;
    deletedCustomBiomarkerKeys?: Record<string, number>;
    deletedNotUsedBiomarkerKeys?: Record<string, number>;
  };
  historySample?: BiomarkerHistoryRow[];
  historyCount?: number;
};

function coreNutrients(n: any): Record<string, any> | null {
  if (!n || typeof n !== 'object') return null;
  const keys = [
    'calories',
    'protein',
    'totalFat',
    'saturatedFat',
    'carbohydrates',
    'addedSugar',
    'sugar',
    'sodium',
    'totalFibre',
    'fiber',
  ];
  const out: Record<string, any> = {};
  for (const k of keys) {
    if (n[k] != null && n[k] !== '') out[k] = n[k];
  }
  return Object.keys(out).length ? out : null;
}

/** Accept Record<id, ts> or string[] of ids. Drop 0/1/2 index artifacts. */
export function capTombstoneMap(m: any, n = 50): Record<string, number> | undefined {
  if (!m || typeof m !== 'object') return undefined;
  const out: Record<string, number> = {};
  const add = (id: any, ts: any) => {
    const k = String(id ?? '').trim();
    if (!k || k === 'undefined' || k === 'null') return;
    if (/^\d+$/.test(k)) return;
    const num = typeof ts === 'number' ? ts : Number(ts);
    out[k] = Number.isFinite(num) && num > 0 ? num : Date.now();
  };
  if (Array.isArray(m)) {
    for (const item of m.slice(0, n * 2)) {
      if (typeof item === 'string') add(item, Date.now());
      else if (item && typeof item === 'object') add((item as any).id || (item as any).key, (item as any).ts ?? (item as any).updated_at ?? (item as any).deleted_at);
    }
  } else {
    for (const [k, v] of Object.entries(m)) {
      const cleanK = String(k ?? '').trim();
      if (/^\d+$/.test(cleanK)) {
        if (typeof v === 'string') add(v, Date.now());
      } else {
        add(cleanK, v);
      }
    }
  }
  const keys = Object.keys(out).slice(0, n);
  if (!keys.length) return undefined;
  return Object.fromEntries(keys.map((k) => [k, out[k]]));
}

function pickHttps(url: any): string | null {
  if (typeof url === 'string' && /^https?:\/\//i.test(url) && url.length < 500) return url;
  return null;
}

/** Build food domain pack from job and/or modal/result payload. */
export function buildFoodDomainPack(input: {
  job?: any;
  payload?: any;
  activeTab?: string;
}): FoodDomainPack {
  const job = input.job || {};
  const p = input.payload || {};
  const result = job.result || p.result || p;
  const food =
    result.pendingFoodLog ||
    result.data?.pendingFoodLog ||
    p.pendingFoodLog ||
    p.answer?.pendingFoodLog ||
    p.foodLog ||
    (p.nutrients ? p : null) ||
    {};

  const mode =
    result.mode ||
    job.mode ||
    job.inputSnapshot?.mode ||
    p.mode ||
    job.inputSnapshot?.userSelectedMode ||
    null;

  const itemsSrc = Array.isArray(food.itemsBreakdown)
    ? food.itemsBreakdown
    : Array.isArray(result.scoutItems)
      ? result.scoutItems
      : Array.isArray(p.scoutItems)
        ? p.scoutItems
        : [];

  const receiptSrc = food.receiptTable || result.receiptTable || p.receiptTable || [];
  const scoutSrc = result.scoutItems || p.scoutItems || [];

  const refineFlags: string[] = [];
  const logs = String(result.backendLogs || p.backendLogs || p.debugLogText || '');
  if (/scale-only|skip-dietitian|skipScout/i.test(logs)) {
    if (/scale-only/i.test(logs)) refineFlags.push('scale-only');
    if (/skip-dietitian/i.test(logs)) refineFlags.push('skip-dietitian');
    if (/skipScout/i.test(logs)) refineFlags.push('skipScout');
  }

  return {
    mode: mode != null ? String(mode) : null,
    jobId: job.id || result.jobId || p.jobId || p.id || null,
    status: job.status || result.status || p.status || null,
    progressPercent: job.progressPercent ?? null,
    mealName: food.name || food.title || p.dish_query || null,
    weightGrams: food.weightGrams ?? food.weight ?? null,
    quantity: food.quantity != null ? String(food.quantity) : null,
    nutrients: coreNutrients(food.nutrients || p.nutrients),
    labelLocks: food.labelLocks || food.truthLocks || result.labelLocks || null,
    items: itemsSrc.slice(0, 25).map((it: any) => ({
      name: it.originalName || it.canonicalDbName || it.name || it.keyword || undefined,
      weightGrams: it.weightGrams ?? it.estimatedWeightGrams ?? null,
      calories: it.nutrients?.calories ?? it.calories ?? null,
      source: it.source || it.truthSource || it.matchSource || null,
    })),
    receipt: (Array.isArray(receiptSrc) ? receiptSrc : []).slice(0, 40).map((r: any) => ({
      item: r.item || r.name || r.food,
      source: r.source || r.truthSource || r.basis,
      notes: String(r.notes || r.detail || '').slice(0, 80),
    })),
    scoutItems: (Array.isArray(scoutSrc) ? scoutSrc : []).slice(0, 20).map((it: any) => ({
      name: it.originalName || it.keyword || it.name,
      weightGrams: it.estimatedWeightGrams ?? it.weightGrams ?? null,
      portionChoice: it.portionChoiceApplied ?? it.portionChoice ?? null,
    })),
    portionClarify:
      result.portionClarify ||
      p.portionClarify ||
      (job.status === 'awaiting_user' ? { awaiting_user: true } : null),
    refine: {
      scaleOnly: refineFlags.includes('scale-only'),
      skipDietitian: refineFlags.includes('skip-dietitian'),
      flags: refineFlags,
    },
    photoUrl: pickHttps(result.photoUrl || job.photoUrl || p.photoUrl),
    debugUrl: pickHttps(result.debugUrl || p.debugUrl),
    pipelineErrors: Array.isArray(result.pipelineErrors)
      ? result.pipelineErrors.slice(0, 15)
      : Array.isArray(p.pipelineErrors)
        ? p.pipelineErrors.slice(0, 15)
        : undefined,
    pipelineWarnings: Array.isArray(result.pipelineWarnings)
      ? result.pipelineWarnings.slice(0, 10)
      : undefined,
  };
}

/** Build biomarker/medical domain pack. */
export function buildBiomarkerDomainPack(input: {
  job?: any;
  payload?: any;
  biomarkerHistory?: any[];
  biomarkers?: any;
  profile?: any;
  /** Home: tiles + tombstones for bmi/weight/height only — not full history. */
  thinHome?: boolean;
}): BiomarkerDomainPack {
  const job = input.job || {};
  const p = input.payload || {};
  const result = job.result || p.result || p;
  const msg = result.message || result.text || p.message || '';

  const keys = new Set<string>();
  const valuesSample: BiomarkerDomainPack['valuesSample'] = [];

  const pushEntry = (key: string, value: any, unit?: string | null, date?: string | null) => {
    if (!key) return;
    keys.add(key);
    if (valuesSample!.length < 40) {
      valuesSample!.push({
        key,
        value: value != null && String(value).length < 80 ? value : String(value ?? '').slice(0, 80),
        unit: unit ?? null,
        date: date ?? null,
      });
    }
  };

  // From agent result structured fields
  const list =
    result.biomarkers ||
    result.updatedBiomarkers ||
    result.biomarkerUpdates ||
    p.biomarkers ||
    p.updatedBiomarkers ||
    null;

  if (Array.isArray(list)) {
    for (const b of list.slice(0, 40)) {
      pushEntry(
        b.key || b.id || b.name || b.biomarkerKey,
        b.value ?? b.val ?? b.reading,
        b.unit || b.units,
        b.date || b.measuredAt
      );
    }
  } else if (list && typeof list === 'object') {
    for (const [k, v] of Object.entries(list).slice(0, 40)) {
      if (v && typeof v === 'object') {
        pushEntry(k, (v as any).value ?? (v as any).val, (v as any).unit, (v as any).date);
      } else {
        pushEntry(k, v);
      }
    }
  }

  const historyRaw = Array.isArray(input.biomarkerHistory) ? input.biomarkerHistory : [];
  const history = input.thinHome
    ? historyRaw.filter((row) => {
        const bm = row?.biomarkers && typeof row.biomarkers === 'object' ? row.biomarkers : {};
        return Object.keys(bm).some((k) => HOME_TILE_RE.test(k)) || HOME_TILE_RE.test(String(row?.key || ''));
      })
    : historyRaw;
  const ranked = [...history].sort((a, b) => {
    const abm = a?.biomarkers && typeof a.biomarkers === 'object' ? a.biomarkers : {};
    const bbm = b?.biomarkers && typeof b.biomarkers === 'object' ? b.biomarkers : {};
    const ap = Object.keys(abm).some((k) => /bmi|body_mass/i.test(k)) ? 1 : 0;
    const bp = Object.keys(bbm).some((k) => /bmi|body_mass/i.test(k)) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return String(b?.date || '').localeCompare(String(a?.date || ''));
  });
  const historySample: BiomarkerHistoryRow[] = [];
  for (const row of ranked.slice(0, 25)) {
    const bm =
      row?.biomarkers && typeof row.biomarkers === 'object' && !Array.isArray(row.biomarkers)
        ? row.biomarkers
        : null;
    const rowKeys = bm
      ? Object.keys(bm).slice(0, 40)
      : [row?.key || row?.biomarkerKey || row?.name].filter(Boolean).map(String);
    if (bm) {
      for (const k of rowKeys) {
        if (keys.size < 40) pushEntry(k, bm[k], null, row.date || row.measuredAt || null);
      }
    } else {
      const k = row?.key || row?.biomarkerKey || row?.name;
      if (k && keys.size < 40) pushEntry(k, row.value ?? row.val, row.unit, row.date || row.measuredAt);
    }
    if (historySample.length < 25 && (row?.id || rowKeys.length)) {
      const values: Record<string, any> = {};
      if (bm) {
        const priority = rowKeys.filter((k) => /bmi|weight|height|body_mass/i.test(k));
        const rest = rowKeys.filter((k) => !priority.includes(k));
        for (const k of [...priority, ...rest].slice(0, 14)) {
          const v = bm[k];
          values[k] = v != null && String(v).length < 40 ? v : String(v ?? '').slice(0, 40);
        }
      }
      historySample.push({
        id: row?.id ? String(row.id) : undefined,
        date: row?.date || row?.measuredAt || null,
        sync_state: row?.sync_state || null,
        updated_at: typeof row?.updated_at === 'number' ? row.updated_at : null,
        keys: rowKeys,
        values: Object.keys(values).length ? values : undefined,
      });
    }
  }

  const tombstones = {
    deletedBiomarkerLogIds: capTombstoneMap(input.profile?.deletedBiomarkerLogIds),
    deletedCustomBiomarkerKeys: capTombstoneMap(input.profile?.deletedCustomBiomarkerKeys),
    deletedNotUsedBiomarkerKeys: capTombstoneMap(input.profile?.deletedNotUsedBiomarkerKeys),
  };
  const hasTombstones = !!(
    tombstones.deletedBiomarkerLogIds ||
    tombstones.deletedCustomBiomarkerKeys ||
    tombstones.deletedNotUsedBiomarkerKeys
  );

  const sanitizeHints: string[] = [];
  if (p.sanitizeProposal || result.sanitizeProposal) {
    sanitizeHints.push('sanitize_proposal_present');
  }
  const crazy = valuesSample.filter((v) => {
    const n = Number(v?.value);
    return Number.isFinite(n) && (n > 1e6 || n < -1e3);
  });
  if (crazy.length) sanitizeHints.push(`extreme_values:${crazy.map((c) => c.key).join(',')}`);

  let outKeys = Array.from(keys).slice(0, 40);
  let outValues = valuesSample;
  let outTombs = tombstones;
  let outHistory = historySample;
  if (input.thinHome) {
    outKeys = outKeys.filter((k) => HOME_TILE_RE.test(k));
    outValues = (valuesSample || []).filter((v) => HOME_TILE_RE.test(String(v?.key || '')));
    const custom = Object.fromEntries(
      Object.entries(tombstones.deletedCustomBiomarkerKeys || {}).filter(([k]) => HOME_TILE_RE.test(k))
    );
    const keepLogIds = new Set(outHistory.map((r) => r.id).filter(Boolean) as string[]);
    const logs = Object.fromEntries(
      Object.entries(tombstones.deletedBiomarkerLogIds || {}).filter(([id]) => keepLogIds.has(id) || /bmi|weight|height/i.test(id))
    );
    outTombs = {
      deletedBiomarkerLogIds: Object.keys(logs).length ? logs : undefined,
      deletedCustomBiomarkerKeys: Object.keys(custom).length ? custom : undefined,
      deletedNotUsedBiomarkerKeys: undefined,
    };
    outHistory = outHistory.slice(0, 8).map((row) => ({
      ...row,
      keys: (row.keys || []).filter((k) => HOME_TILE_RE.test(k)),
      values: row.values
        ? Object.fromEntries(Object.entries(row.values).filter(([k]) => HOME_TILE_RE.test(k)))
        : undefined,
    }));
  }
  const thinTombsOn = !!(outTombs.deletedBiomarkerLogIds || outTombs.deletedCustomBiomarkerKeys || outTombs.deletedNotUsedBiomarkerKeys);

  return {
    jobId: input.thinHome ? null : job.id && !/^food/i.test(String(job.kind || '')) ? job.id : null,
    kind:
      input.thinHome
        ? 'home'
        : job.kind && !/^food/i.test(String(job.kind))
          ? job.kind
          : history.length
            ? 'home'
            : 'medical',
    agentLabel:
      result.agentLabel ||
      p.agentLabel ||
      (Array.isArray(result.apiCalls) ? result.apiCalls[0]?.label : null) ||
      null,
    status: job.status || result.status || null,
    unitPreference: input.profile?.unitPreference || p.unitPreference || null,
    keys: outKeys,
    valuesSample: outValues,
    sanitizeHints: sanitizeHints.length ? sanitizeHints : undefined,
    lastAgentMessage: msg ? String(msg).slice(0, 1200) : null,
    pipelineErrors: Array.isArray(result.pipelineErrors)
      ? result.pipelineErrors.slice(0, 15)
      : Array.isArray(p.pipelineErrors)
        ? p.pipelineErrors.slice(0, 15)
        : undefined,
    tombstones: (input.thinHome ? thinTombsOn : hasTombstones) ? outTombs : undefined,
    historySample: outHistory.length ? outHistory : undefined,
    historyCount: input.thinHome ? outHistory.length : history.length,
  };
}

export function foodSummaryLine(pack: FoodDomainPack): string {
  const n = pack.nutrients || {};
  const cal = n.calories != null ? `${n.calories} kcal` : '— kcal';
  return `food mode=${pack.mode || '?'} job=${pack.jobId || '—'} “${pack.mealName || 'meal'}” ${cal} status=${pack.status || '?'}`;
}

export function biomarkerSummaryLine(pack: BiomarkerDomainPack): string {
  const keys = (pack.keys || []).slice(0, 6).join(', ') || '—';
  const logs = pack.historyCount != null ? ` logs=${pack.historyCount}` : '';
  const tombs = pack.tombstones?.deletedBiomarkerLogIds
    ? ` tombstones=${Object.keys(pack.tombstones.deletedBiomarkerLogIds).length}`
    : '';
  return `biomarker agent=${pack.agentLabel || pack.kind || '?'} keys=${keys}${logs}${tombs} status=${pack.status || '?'}`;
}

/**
 * Resolve which domain pack to attach from category + active jobs + payload.
 */
export function resolveDomainPack(input: {
  category?: string;
  activeTab?: string;
  jobs?: any[];
  payload?: any;
  jobId?: string | null;
  biomarkerHistory?: any[];
  biomarkers?: any;
  profile?: any;
}): DomainPack {
  const cat = String(input.category || '').toLowerCase();
  const tab = String(input.activeTab || '').toLowerCase();
  const jobs = Array.isArray(input.jobs) ? input.jobs : [];
  const payload = input.payload || {};

  const surface = snapSurface(cat, tab);
  const rawTarget = input.jobId || payload.jobId || payload.id || null;
  const targetFits = rawTarget && jobFitsSnap({ category: cat, activeTab: tab, jobKind: payload.kind || payload.jobKind });
  const targetJobId = targetFits ? rawTarget : null;

  const live = (j: any) =>
    j &&
    (j.status === 'running' || j.status === 'succeeded' || j.status === 'awaiting_user' || j.status === 'failed');
  const isFoodJob = (j: any) => live(j) && isFoodJobKind(j.kind);
  const isMedJob = (j: any) => live(j) && isBioJobKind(j.kind);

  const activeFood = surface === 'food' ? pickSnapshotJob(jobs.filter(isFoodJob), targetJobId) : null;
  const activeMed = surface === 'health' ? pickSnapshotJob(jobs.filter(isMedJob), targetJobId) : null;

  const capturedAt = new Date().toISOString();

  if (surface === 'food') {
    const food = buildFoodDomainPack({ job: activeFood, payload, activeTab: tab });
    return { domain: 'food', capturedAt, summaryLine: foodSummaryLine(food), food };
  }
  if (surface === 'home' || surface === 'health') {
    const biomarker = buildBiomarkerDomainPack({
      job: activeMed,
      payload,
      biomarkerHistory: input.biomarkerHistory,
      biomarkers: input.biomarkers,
      profile: input.profile,
      thinHome: surface === 'home',
    });
    return {
      domain: 'biomarker',
      capturedAt,
      summaryLine: biomarkerSummaryLine(biomarker),
      biomarker,
    };
  }

  return {
    domain: 'generic',
    capturedAt,
    summaryLine: `generic tab=${tab || '—'} cat=${cat || '—'}`,
    generic: { note: 'No food/biomarker job context', keys: Object.keys(payload).slice(0, 20) },
  };
}

/** Serialize domain pack for agent prompts (capped). */
export function domainPackForAgent(pack: DomainPack | null | undefined, maxChars = 10_000): string {
  if (!pack) return '';
  try {
    const s = JSON.stringify(pack, null, 2);
    if (s.length <= maxChars) return s;
    return s.slice(0, maxChars) + '\n…[domain_pack truncated]';
  } catch {
    return '';
  }
}

/** overview.md body for an instance (human + agent). */
export function buildOverviewMarkdown(input: {
  category: string;
  tagId?: string;
  reportId?: string;
  userSymptom?: string;
  env?: any;
  domainPack?: DomainPack | null;
  a11yOutline?: string;
  shotCount?: number;
  networkFailCount?: number;
  hasLogs?: boolean;
}): string {
  const lines: string[] = [];
  lines.push(`# Bug instance overview`);
  lines.push('');
  lines.push(`- **Category:** ${input.category}`);
  if (input.tagId) lines.push(`- **Tag:** \`${input.tagId}\``);
  if (input.reportId) lines.push(`- **Instance:** \`${input.reportId}\``);
  lines.push(`- **Captured:** ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`## Capture checklist`);
  lines.push('');
  lines.push(`- [x] **A11y tree** (default for all agents)`);
  lines.push(`- [${input.shotCount ? 'x' : ' '}] Screenshots (${input.shotCount || 0})`);
  lines.push(`- [${input.domainPack ? 'x' : ' '}] Domain pack (${input.domainPack?.domain || '—'})`);
  lines.push(`- [${input.hasLogs ? 'x' : ' '}] Logs`);
  lines.push(`- [${input.networkFailCount ? 'x' : ' '}] Network failures (${input.networkFailCount || 0})`);
  lines.push('');
  if (input.userSymptom) {
    lines.push(`## User symptom`);
    lines.push('');
    lines.push(input.userSymptom.slice(0, 2000));
    lines.push('');
  }
  if (input.domainPack?.summaryLine) {
    lines.push(`## Domain summary`);
    lines.push('');
    lines.push(input.domainPack.summaryLine);
    lines.push('');
  }
  const bio = input.domainPack?.biomarker;
  if (bio?.historySample?.length || bio?.tombstones) {
    lines.push(`## Biomarker debug (sync / tombstones)`);
    lines.push('');
    lines.push(`- History logs sampled: ${bio.historySample?.length || 0} of ${bio.historyCount ?? '?'}`);
    const dLogs = Object.keys(bio.tombstones?.deletedBiomarkerLogIds || {});
    const dKeys = Object.keys(bio.tombstones?.deletedCustomBiomarkerKeys || {});
    lines.push(`- Tombstoned log ids: ${dLogs.length ? dLogs.slice(0, 12).join(', ') : 'none'}`);
    lines.push(`- Tombstoned custom keys: ${dKeys.length ? dKeys.slice(0, 12).join(', ') : 'none'}`);
    for (const row of (bio.historySample || []).slice(0, 8)) {
      const vals = row.values
        ? Object.entries(row.values)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ')
        : row.keys.join(', ');
      lines.push(`- log \`${row.id || '?'}\` ${row.date || ''} state=${row.sync_state || '—'} ${vals}`);
    }
    lines.push('');
  }
  if (input.env) {
    lines.push(`## Environment`);
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(input.env, null, 2).slice(0, 2000));
    lines.push('```');
    lines.push('');
  }
  if (input.a11yOutline) {
    lines.push(`## A11y outline (primary structure)`);
    lines.push('');
    lines.push('```');
    lines.push(input.a11yOutline.slice(0, 6000));
    lines.push('```');
    lines.push('');
  }
  lines.push(`## Agent policy`);
  lines.push('');
  lines.push(`- **All agents** (Flash-lite, Flash, Grok, Claude, Qwen): prefer **a11y + domain pack + summary**.`);
  lines.push(`- Do **not** load raw DOM or full archives unless blocked.`);
  lines.push('');
  return lines.join('\n');
}
