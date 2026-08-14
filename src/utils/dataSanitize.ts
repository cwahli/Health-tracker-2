/**
 * Data sanitize planner — proposes fixes for sync/telemetry mess (approval UI).
 * Covers: unit-scale phantoms, history dups, junk custom metric keys, food log dups.
 */
import {
  isBiomarkerValueImprobable,
  normalizeHistoricalTelemetryErrors,
  parseNormalRangeBounds,
  biomarkerDefinitions,
} from './biomarkers';
import { toYYYYMMDD } from './dateUtils';
import { mergeFoodLogsDeduped, foodLogFingerprint } from './foodLogDedupe';
import { cleanupInventedBiomarkerCatalog } from './biomarkerLifecycle';

export { cleanupInventedBiomarkerCatalog };

export type SanitizeActionKind =
  | 'fix_value' // unit scale correction
  | 'drop_value' // impossible / phantom reading
  | 'drop_history_log' // empty after drops or pure duplicate log row
  | 'drop_custom_key' // junk custom biomarker def (metric_N, no real data)
  | 'merge_food'; // food log duplicate collapsed

export type SanitizeProposal = {
  id: string;
  kind: SanitizeActionKind;
  title: string;
  detail: string;
  /** Biomarker key if applicable */
  key?: string;
  logId?: string;
  date?: string;
  oldValue?: string | number;
  newValue?: string | number;
  /** For food merge: ids to remove after keeping keepId */
  foodIdsToRemove?: string[];
  keepFoodId?: string;
  selected?: boolean;
};

export type SanitizePlan = {
  proposals: SanitizeProposal[];
  summary: {
    valueFixes: number;
    valueDrops: number;
    historyDrops: number;
    customKeyDrops: number;
    foodMerges: number;
  };
};

function defName(key: string, profile: any): string {
  const custom = profile?.customBiomarkers?.[key];
  const def = biomarkerDefinitions.find((d: any) => d.key === key);
  return custom?.name || custom?.display_name || def?.name || key;
}

/**
 * Build a full sanitize plan for approval UI (does not mutate).
 */
export function buildDataSanitizePlan(opts: {
  biomarkerHistory?: any[];
  biomarkers?: Record<string, any>;
  profile?: any;
  foodLogs?: any[];
}): SanitizePlan {
  const profile = opts.profile || {};
  const history = Array.isArray(opts.biomarkerHistory) ? opts.biomarkerHistory : [];
  const proposals: SanitizeProposal[] = [];
  let pid = 0;
  const nextId = () => `san_${++pid}`;

  // --- Biomarker history: dry-run normalize to see before/after ---
  const beforeByLog = new Map<string, Record<string, any>>();
  history.forEach((log) => {
    if (log?.id) beforeByLog.set(log.id, { ...(log.biomarkers || {}) });
  });

  const { updatedHistory, fixedCount } = normalizeHistoricalTelemetryErrors(history, profile);

  updatedHistory.forEach((log: any) => {
    const before = beforeByLog.get(log.id) || {};
    const after = log.biomarkers || {};
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    allKeys.forEach((key) => {
      const oldV = before[key];
      const newV = after[key];
      if (oldV === newV) return;
      if (oldV != null && newV != null && oldV !== newV) {
        proposals.push({
          id: nextId(),
          kind: 'fix_value',
          title: `Fix ${defName(key, profile)}`,
          detail: `Unit/scale correction on ${log.date || 'history'}`,
          key,
          logId: log.id,
          date: log.date,
          oldValue: oldV,
          newValue: newV,
          selected: true,
        });
      } else if (oldV != null && (newV === undefined || newV === null)) {
        proposals.push({
          id: nextId(),
          kind: 'drop_value',
          title: `Remove phantom ${defName(key, profile)}`,
          detail: `Impossible value on ${log.date || 'history'} (never a valid lab reading)`,
          key,
          logId: log.id,
          date: log.date,
          oldValue: oldV,
          selected: true,
        });
      }
    });
  });

  // Also flag remaining improbable current-state values not caught if history empty
  Object.entries(opts.biomarkers || {}).forEach(([key, val]) => {
    const custom = profile?.customBiomarkers?.[key];
    const def = biomarkerDefinitions.find((d: any) => d.key === key);
    const range = custom?.normalRange || def?.normalRange;
    if (isBiomarkerValueImprobable(key, val as any, range)) {
      const already = proposals.some((p) => p.key === key && p.kind === 'drop_value' && p.oldValue === val);
      if (!already) {
        proposals.push({
          id: nextId(),
          kind: 'drop_value',
          title: `Clear current ${defName(key, profile)}`,
          detail: `Current tile value is improbable (${val} ${custom?.unit || def?.unit || ''})`,
          key,
          oldValue: val as any,
          selected: true,
        });
      }
    }
  });

  // Duplicate history rows: same day + identical biomarker key set after normalize
  const dayKeyMap = new Map<string, any[]>();
  updatedHistory.forEach((log: any) => {
    const day = toYYYYMMDD(log.date);
    const keys = Object.keys(log.biomarkers || {}).sort().join(',');
    const fp = `${day}|${keys}`;
    if (!dayKeyMap.has(fp)) dayKeyMap.set(fp, []);
    dayKeyMap.get(fp)!.push(log);
  });
  dayKeyMap.forEach((logs) => {
    if (logs.length < 2) return;
    // keep newest
    logs.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    logs.slice(1).forEach((dup) => {
      proposals.push({
        id: nextId(),
        kind: 'drop_history_log',
        title: `Remove duplicate lab log`,
        detail: `Duplicate entry on ${dup.date} (same markers as another log)`,
        logId: dup.id,
        date: dup.date,
        selected: true,
      });
    });
  });

  // Junk custom defs: metric_N / empty name / needsApproval with no history values
  const customs = profile.customBiomarkers || {};
  Object.entries(customs).forEach(([key, def]: [string, any]) => {
    const isJunkKey = /^metric[_\s-]?\d+$/i.test(key) || /^metric\s*\d+$/i.test(String(def?.name || ''));
    const hasHistory = history.some((h) => h?.biomarkers && h.biomarkers[key] != null && h.biomarkers[key] !== '');
    const hasCurrent = opts.biomarkers?.[key] != null && opts.biomarkers[key] !== '';
    if (isJunkKey && !hasHistory && !hasCurrent) {
      proposals.push({
        id: nextId(),
        kind: 'drop_custom_key',
        title: `Delete junk dictionary key “${def?.name || key}”`,
        detail: `Placeholder custom biomarker (${key}) with no lab values — sync noise`,
        key,
        selected: true,
      });
    } else if (def?.needsApproval === true && !hasHistory && !hasCurrent && !def?.unit) {
      proposals.push({
        id: nextId(),
        kind: 'drop_custom_key',
        title: `Delete empty pending “${def?.name || key}”`,
        detail: `Pending Approval entry never received a value`,
        key,
        selected: false, // default off — user may still want to fill these
      });
    }
  });

  // Food log duplicates
  const foods = Array.isArray(opts.foodLogs) ? opts.foodLogs : [];
  const deduped = mergeFoodLogsDeduped(foods, []);
  if (deduped.length < foods.length) {
    const keptIds = new Set(deduped.map((f) => f.id).filter(Boolean));
    const removed = foods.filter((f) => f.id && !keptIds.has(f.id));
    // Group removed by fingerprint of kept partner for readable cards
    const byFp = new Map<string, any[]>();
    removed.forEach((f) => {
      const fp = foodLogFingerprint(f);
      if (!byFp.has(fp)) byFp.set(fp, []);
      byFp.get(fp)!.push(f);
    });
    byFp.forEach((group, fp) => {
      const keeper = deduped.find((d) => foodLogFingerprint(d) === fp);
      proposals.push({
        id: nextId(),
        kind: 'merge_food',
        title: `Merge duplicate meal “${keeper?.name || group[0]?.name || 'meal'}”`,
        detail: `Remove ${group.length} duplicate food card(s) from sync retries (keep best photo)`,
        keepFoodId: keeper?.id,
        foodIdsToRemove: group.map((g) => g.id).filter(Boolean),
        date: keeper?.date || group[0]?.date,
        selected: true,
      });
    });
  }

  const summary = {
    valueFixes: proposals.filter((p) => p.kind === 'fix_value').length,
    valueDrops: proposals.filter((p) => p.kind === 'drop_value').length,
    historyDrops: proposals.filter((p) => p.kind === 'drop_history_log').length,
    customKeyDrops: proposals.filter((p) => p.kind === 'drop_custom_key').length,
    foodMerges: proposals.filter((p) => p.kind === 'merge_food').length,
  };

  // silence unused when fixedCount 0 but proposals from food only
  void fixedCount;
  void parseNormalRangeBounds;

  return { proposals, summary };
}

/**
 * Apply selected proposals. Returns new history, biomarkers, foodLogs, profile patches.
 */
export function applyDataSanitizePlan(
  plan: SanitizePlan,
  selectedIds: Set<string>,
  opts: {
    biomarkerHistory: any[];
    biomarkers: Record<string, any>;
    foodLogs: any[];
    profile: any;
  }
): {
  biomarkerHistory: any[];
  biomarkers: Record<string, any>;
  foodLogs: any[];
  profileUpdates: Partial<any>;
  applied: number;
} {
  const selected = plan.proposals.filter((p) => selectedIds.has(p.id));
  let history = (opts.biomarkerHistory || []).map((h) => ({
    ...h,
    biomarkers: { ...(h.biomarkers || {}) },
  }));
  let biomarkers = { ...(opts.biomarkers || {}) };
  let foodLogs = [...(opts.foodLogs || [])];
  const customs = { ...(opts.profile?.customBiomarkers || {}) };
  const deletedCustom: Record<string, number> = {
    ...(opts.profile?.deletedCustomBiomarkerKeys || {}),
  };
  let applied = 0;

  // First apply full normalize when any fix/drop_value selected
  if (selected.some((p) => p.kind === 'fix_value' || p.kind === 'drop_value')) {
    const { updatedHistory } = normalizeHistoricalTelemetryErrors(history, opts.profile);
    history = updatedHistory;
    applied += selected.filter((p) => p.kind === 'fix_value' || p.kind === 'drop_value').length;
  }

  selected.forEach((p) => {
    if (p.kind === 'drop_history_log' && p.logId) {
      history = history.filter((h) => h.id !== p.logId);
      applied++;
    }
    if (p.kind === 'drop_custom_key' && p.key) {
      delete customs[p.key];
      deletedCustom[p.key] = Date.now();
      delete biomarkers[p.key];
      history = history.map((h) => {
        if (h.biomarkers && p.key! in h.biomarkers) {
          const next = { ...h.biomarkers };
          delete next[p.key!];
          return { ...h, biomarkers: next };
        }
        return h;
      });
      applied++;
    }
    if (p.kind === 'drop_value' && p.key && !p.logId) {
      delete biomarkers[p.key];
      applied++;
    }
    if (p.kind === 'merge_food' && p.foodIdsToRemove?.length) {
      const remove = new Set(p.foodIdsToRemove);
      foodLogs = foodLogs.filter((f) => !remove.has(f.id));
      applied++;
    }
  });

  // Always re-dedupe foods after merge actions
  if (selected.some((p) => p.kind === 'merge_food')) {
    foodLogs = mergeFoodLogsDeduped(foodLogs, []);
  }

  // Recompute current biomarkers from history (prefer non-improbable)
  const recomputed: Record<string, any> = {};
  [...history]
    .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)))
    .forEach((log) => {
      Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
        const custom = customs[k];
        const def = biomarkerDefinitions.find((d: any) => d.key === k);
        const range = custom?.normalRange || def?.normalRange;
        const num = typeof v === 'number' ? v : parseFloat(String(v));
        if (!isNaN(num) && isBiomarkerValueImprobable(k, num, range)) return;
        recomputed[k] = v;
      });
    });

  const cleanedCatalog = cleanupInventedBiomarkerCatalog({
    ...opts.profile,
    customBiomarkers: customs,
    deletedCustomBiomarkerKeys: deletedCustom,
  }, history);

  return {
    biomarkerHistory: history.filter((h) => Object.keys(h.biomarkers || {}).length > 0),
    biomarkers: { ...biomarkers, ...recomputed },
    foodLogs,
    profileUpdates: {
      customBiomarkers: cleanedCatalog.profile.customBiomarkers,
      deletedCustomBiomarkerKeys: cleanedCatalog.profile.deletedCustomBiomarkerKeys,
      ...(cleanedCatalog.profile.customRanges ? { customRanges: cleanedCatalog.profile.customRanges } : {}),
    },
    applied,
  };
}
