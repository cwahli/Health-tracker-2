/**
 * Q-6.5 / Q-6.6 — classify a finished job or golden reds onto one work item.
 * Evidence is pointers only. Clean successes are skipped.
 */
import {
  appendEvidenceCommit,
  assignPublicN,
  emptyWorkItem,
  fingerprint,
  hydrateWorkItem,
  prefillBug,
  type BugEvidence,
  type BugWorkItem,
} from './bugWorkItem';

export type AutoFileCandidate = {
  source: 'job' | 'golden';
  class?: string;
  query: string;
  bug: string;
  remaining: string[];
  evidence: BugEvidence;
  category: string;
};

export type AutoFileDecision = {
  action: 'merge' | 'unmatched' | 'new';
  item: BugWorkItem;
  existing: any | null;
  fingerprint: string;
};

export function classFromText(blob: string): string | undefined {
  const t = String(blob || '').toLowerCase();
  if (!t.trim()) return undefined;
  if (/429|resource_exhausted|quota exceeded|quota cooldown/.test(t)) return 'CALL_BUDGET';
  if (/stream stalled|timed out|timeout|503|unavailable|no tokens/.test(t)) return 'INFRA_LATENCY';
  if (/missing item|dish.?drop|dropped dish|disappeared|scout.*not in/.test(t)) return 'DISH_DROP';
  if (/false.?friend|wrong (item|fdc|food)|mapped to the wrong/.test(t)) return 'FALSE_FRIEND';
  if (/opening.?wrong|wrong opening|first dish/.test(t)) return 'OPENING_WRONG';
  if (/silent.?repair|atwater|rescal/.test(t)) return 'SILENT_REPAIR';
  if (/nutrition label|brand(ed)? food|label table|clone.?ui/.test(t)) return 'CLONE_UI';
  if (/apply.?miss|update_biomarker failed|did not apply/.test(t)) return 'APPLY_MISS';
  if (/call.?budget|too many (calls|requests)/.test(t)) return 'CALL_BUDGET';
  return undefined;
}

function foodName(item: any): string {
  return String(item?.originalName || item?.name || item?.query || item?.title || '').trim();
}

function isLabelRow(item: any): boolean {
  return /nutrition facts|nutrition label|back of package/i.test(foodName(item));
}

export function classifyJobResult(input: {
  jobId?: string;
  status?: string;
  kind?: string;
  text?: string;
  error?: string;
  debugUrl?: string;
  photoUrls?: string[];
  pendingFoodLog?: any;
  result?: any;
}): AutoFileCandidate | null {
  const result = input.result || {};
  const meal = input.pendingFoodLog || result.pendingFoodLog || result.data || {};
  const query =
    String(input.text || meal.name || meal.query || result.text || '')
      .trim()
      .slice(0, 160) || '';
  const errors: any[] = [];
  const rawErrs = result.pipelineErrors || meal.pipelineErrors;
  if (Array.isArray(rawErrs)) errors.push(...rawErrs);
  else if (rawErrs) errors.push(rawErrs);
  if (input.error) errors.push({ message: input.error, level: 'error' });
  if (result.error) errors.push({ message: typeof result.error === 'string' ? result.error : result.error.message, level: 'error' });

  const hard = errors.filter((e) => {
    const level = String(e?.level || 'error').toLowerCase();
    if (level === 'warning') return false;
    const msg = String(typeof e === 'string' ? e : e?.message || '');
    return !!msg.trim();
  });

  const scout = Array.isArray(result.scoutItems)
    ? result.scoutItems
    : Array.isArray(meal.scoutItems)
      ? meal.scoutItems
      : [];
  const dishes = Array.isArray(meal.itemsBreakdown) ? meal.itemsBreakdown : [];
  const foodScout = scout.filter((s: any) => !isLabelRow(s));
  const dishDrop = foodScout.length > 0 && dishes.length > 0 && foodScout.length > dishes.length;

  let cls = classFromText(
    [input.error, result.error, query, ...hard.map((e) => (typeof e === 'string' ? e : e?.message || e?.class || ''))]
      .filter(Boolean)
      .join(' ')
  );
  if (!cls && dishDrop) cls = 'DISH_DROP';
  if (!cls && /failed|error/.test(String(input.status || '')) && hard.length) {
    cls = classFromText(hard.map((e) => (typeof e === 'string' ? e : e?.message)).join(' ')) || 'INFRA_LATENCY';
  }

  const remaining: string[] = [];
  if (dishDrop) {
    const dishNames = dishes.map((d: any) => foodName(d).toLowerCase()).filter((n: string) => n.length > 0);
    for (const s of foodScout) {
      const n = foodName(s);
      if (n && !dishNames.some((d) => d.includes(n.toLowerCase()) || n.toLowerCase().includes(d))) {
        remaining.push(`dropped: ${n}`);
      }
    }
    if (!remaining.length) remaining.push(`scout ${foodScout.length} vs dishes ${dishes.length}`);
  }
  for (const e of hard.slice(0, 4)) {
    const msg = String(typeof e === 'string' ? e : e?.message || '').slice(0, 200);
    if (msg && !remaining.includes(msg)) remaining.push(msg);
  }

  if (!cls && !remaining.length && !hard.length) return null;

  const bug = prefillBug(
    '',
    remaining[0] || cls || input.error || 'Job finished with an unclassified problem'
  );

  return {
    source: 'job',
    class: cls,
    query,
    bug,
    remaining: remaining.slice(0, 8),
    category: /medical|biomarker/.test(String(input.kind || '')) ? 'biomarker' : 'foodcart',
    evidence: {
      job_id: input.jobId || null,
      debug_url: input.debugUrl || result.debugUrl || null,
      photo_urls: Array.isArray(input.photoUrls) ? input.photoUrls.filter(Boolean).map(String) : [],
      hold: true,
    },
  };
}

export function classifyGoldenReds(input: {
  caseId: string;
  title?: string;
  query?: string;
  jobId?: string;
  debugUrl?: string;
  photoUrls?: string[];
  outcomes?: Array<{ id?: string; label?: string; pass?: boolean | null; enabled?: boolean }>;
  mealMisses?: string[];
}): AutoFileCandidate | null {
  const reds = (input.outcomes || []).filter((o) => o.enabled !== false && o.pass === false);
  const misses = (input.mealMisses || []).filter(Boolean);
  if (!reds.length && !misses.length) return null;

  const blob = [...reds.map((r) => `${r.id || ''} ${r.label || ''}`), ...misses].join(' ');
  const cls = classFromText(blob) || (misses.some((m) => /missing item/i.test(m)) ? 'DISH_DROP' : undefined);
  const remaining = [
    ...reds.slice(0, 6).map((r) => String(r.label || r.id || '').slice(0, 200)),
    ...misses.slice(0, 4),
  ].filter(Boolean);

  return {
    source: 'golden',
    class: cls,
    query: String(input.query || input.title || input.caseId).slice(0, 160),
    bug: remaining[0] || input.title || `Golden ${input.caseId} still red`,
    remaining,
    category: 'foodcart',
    evidence: {
      job_id: input.jobId || input.caseId,
      debug_url: input.debugUrl || null,
      photo_urls: input.photoUrls || [],
      hold: true,
    },
  };
}

export function applyAutoFile(tags: any[], candidate: AutoFileCandidate, usedNs: number[] = []): AutoFileDecision {
  const canMatch = !!(candidate.class && candidate.query);
  const fp = fingerprint(candidate.class || 'UNMATCHED', candidate.query || candidate.evidence.job_id || 'unknown');
  const existing = canMatch
    ? tags.find((t) => {
        const w = hydrateWorkItem(t);
        return w.queue !== 'done' && w.fingerprint === fp;
      })
    : null;

  const base = existing
    ? hydrateWorkItem(existing)
    : emptyWorkItem({
        class: candidate.class,
        fingerprint: fp,
        unmatched: !canMatch,
        queue: 'ready',
      });
  const numbered = assignPublicN(base, usedNs);
  let item = appendEvidenceCommit(numbered, {
    actor: candidate.source === 'golden' ? 'golden' : 'auto',
    kind: 'auto',
    summary: candidate.bug.slice(0, 200),
    evidence: candidate.evidence,
    remaining: candidate.remaining.length ? candidate.remaining : undefined,
  });
  item.bug = prefillBug(item.bug, candidate.bug);
  item.class = item.class || candidate.class;
  item.fingerprint = fp;
  item.unmatched = existing ? !!item.unmatched : !canMatch;
  if (candidate.evidence.job_id) {
    item.hold_refs = [...new Set([...(item.hold_refs || []), candidate.evidence.job_id, candidate.evidence.debug_url].filter(Boolean))] as string[];
  }

  return {
    action: existing ? 'merge' : canMatch ? 'new' : 'unmatched',
    item,
    existing: existing || null,
    fingerprint: fp,
  };
}

export function isWorkItemOpen(item: BugWorkItem): boolean {
  return item.queue !== 'done';
}

/** Skip R2 GC while the card is open and any ref is held. */
export function shouldHoldR2(item: BugWorkItem, refs: Array<string | null | undefined>): boolean {
  if (!isWorkItemOpen(item)) return false;
  const holds = (item.hold_refs || []).map(String).filter(Boolean);
  if (!holds.length) return false;
  const check = refs.map((r) => String(r || '')).filter(Boolean);
  if (!check.length) return false;
  return check.some((ref) => holds.some((h) => h === ref || ref.includes(h) || h.includes(ref)));
}
