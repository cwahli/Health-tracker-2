/**
 * Q-6 work item: one card for snap / auto / golden.
 * NOW = Bug field + remaining + current evidence + ALL burns.
 * Commits = loop history. Agent iteration ≠ a new food/medical job.
 */

export const BURN_BUDGET = 2;

export type BugQueueStatus = 'ready' | 'in_progress' | 'blocked' | 'done';

export type BugAttempt = {
  at: string;
  actor: string;
  hyp: string;
  file: string;
  test: string;
  result: string;
  burned: boolean;
  note?: string;
};

export type RemainingLinePhoto = {
  text: string;
  comment?: string;
  photo_urls?: string[];
  source?: string;
};

export type BugEvidence = {
  job_id?: string | null;
  report_id?: string | null;
  debug_url?: string | null;
  photo_urls?: string[];
  r2_prefix?: string | null;
  browser_log?: string | null;
  last_actions?: string | null;
  error_status?: string | null;
  hold?: boolean;
  scout_url?: string | null;
  fixture_query?: string | null;
  expected_dishes?: string[];
  /** Per remaining-line pins. Card-level photo_urls stay. */
  line_photos?: RemainingLinePhoto[];
};

export type BugCommit = {
  id: string;
  at: string;
  actor: string;
  kind: 'snap' | 'auto' | 'agent' | 'retest' | 'note';
  summary: string;
  evidence?: BugEvidence | null;
  attempt?: BugAttempt | null;
};

export type BugWorkItem = {
  public_n: number;
  bug: string;
  class?: string;
  fingerprint?: string;
  occurrences: number;
  queue: BugQueueStatus;
  remaining: string[];
  parked: string[];
  done: string[];
  burns: BugAttempt[];
  commits: BugCommit[];
  current_evidence: BugEvidence | null;
  hold_refs: string[];
  unmatched?: boolean;
};

export const CLASS_SEVERITY: Record<string, number> = {
  APPLY_MISS: 10,
  DISH_DROP: 20,
  FALSE_FRIEND: 30,
  OPENING_WRONG: 40,
  SILENT_REPAIR: 50,
  CALL_BUDGET: 60,
  INFRA_LATENCY: 65,
  F_1: 70,
  IDENTITY_FALSE_FRIEND: 80,
  CLONE_UI: 90,
  UNMATCHED: 900,
};

export function emptyWorkItem(partial?: Partial<BugWorkItem>): BugWorkItem {
  return {
    public_n: 0,
    bug: '',
    occurrences: 1,
    queue: 'ready',
    remaining: [],
    parked: [],
    done: [],
    burns: [],
    commits: [],
    current_evidence: null,
    hold_refs: [],
    unmatched: false,
    ...partial,
  };
}

/** Snap note / title → Bug field. Never wipe an existing Bug string. */
export function prefillBug(existing: string | undefined, snapText: string): string {
  const cur = (existing || '').trim();
  if (cur) return cur;
  return String(snapText || '').trim();
}

/** ISO week key so 5 meals in one week merge; next week is a new fingerprint. */
export function isoWeekKey(at?: string | Date): string {
  const d = at ? new Date(at) : new Date();
  if (Number.isNaN(d.getTime())) return 'unknown';
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function fingerprint(cls: string, queryOrKey: string, at?: string | Date): string {
  const c = String(cls || 'other').trim().toUpperCase().replace(/\s+/g, '_');
  const q = String(queryOrKey || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
  return `${c}|${q || 'unknown'}|${isoWeekKey(at)}`;
}

export function isBurned(burns: BugAttempt[], hyp: string, file: string, test: string): boolean {
  const h = norm(hyp);
  const f = norm(file);
  const t = norm(test);
  return (burns || []).some((b) => {
    if (!b.burned) return false;
    if (h && norm(b.hyp) === h) return true;
    if (f && t && norm(b.file) === f && norm(b.test) === t) return true;
    return false;
  });
}

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function hydrateWorkItem(tag: any): BugWorkItem {
  const raw = tag?.work_item;
  const parsed: Partial<BugWorkItem> =
    raw && typeof raw === 'object' ? raw : typeof raw === 'string' ? safeJson(raw) : {};
  const bug = prefillBug(parsed.bug, tag?.bug_text || tag?.identified_problems || tag?.title || '');
  const status = mapLegacyStatus(tag?.status, parsed.queue);
  return emptyWorkItem({
    ...parsed,
    public_n: Number(parsed.public_n || tag?.public_n || 0),
    bug,
    queue: status,
    occurrences: Number(parsed.occurrences || tag?.linked_count || 1) || 1,
    burns: Array.isArray(parsed.burns) ? parsed.burns : [],
    commits: Array.isArray(parsed.commits) ? parsed.commits : [],
  });
}

function mapLegacyStatus(legacy?: string, queue?: BugQueueStatus): BugQueueStatus {
  // Green tick writes status=fixed. That wins over a stale work_item.queue of ready.
  if (legacy === 'fixed' || legacy === 'ignored') return 'done';
  if (queue === 'blocked' || queue === 'done' || queue === 'in_progress' || queue === 'ready') return queue;
  if (legacy === 'in_progress') return 'in_progress';
  return 'ready';
}

function safeJson(s: string): Partial<BugWorkItem> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export function getLastActionedDate(tag: any, hydrate: (t: any) => BugWorkItem = hydrateWorkItem as any): Date | null {
  if (!tag) return null;
  const item = hydrate(tag);
  let maxTime = 0;

  const datesToCheck: (string | number | undefined | null)[] = [
    tag?.updated_at,
    tag?.created_at,
    tag?.last_commit?.at,
    tag?.updatedAt,
    tag?.createdAt,
  ];

  if (Array.isArray(item.commits)) {
    for (const c of item.commits) {
      if (c?.at) datesToCheck.push(c.at);
      if (c?.attempt?.at) datesToCheck.push(c.attempt.at);
    }
  }

  if (Array.isArray(item.burns)) {
    for (const b of item.burns) {
      if (b?.at) datesToCheck.push(b.at);
    }
  }

  if (Array.isArray(tag?.commits)) {
    for (const c of tag.commits) {
      if (c?.at) datesToCheck.push(c.at);
      if (c?.attempt?.at) datesToCheck.push(c.attempt.at);
    }
  }

  for (const d of datesToCheck) {
    if (!d) continue;
    const t = new Date(d).getTime();
    if (!isNaN(t) && t > maxTime) {
      maxTime = t;
    }
  }

  return maxTime > 0 ? new Date(maxTime) : null;
}

export function sortByLastActioned<T>(
  tags: T[],
  hydrate: (t: T) => BugWorkItem = hydrateWorkItem as any
): T[] {
  return [...tags].sort((a, b) => {
    const da = getLastActionedDate(a, hydrate)?.getTime() || 0;
    const db = getLastActionedDate(b, hydrate)?.getTime() || 0;
    return db - da; // Descending: newest / most recently actioned first
  });
}

export function formatLastActioned(date: Date | null): string {
  if (!date) return 'No actions';

  const now = new Date();
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  let relative = '';
  if (diffMins < 1) relative = 'just now';
  else if (diffMins < 60) relative = `${diffMins}m ago`;
  else if (diffHours < 24) relative = `${diffHours}h ago`;
  else relative = `${diffDays}d ago`;

  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

  return `${relative} (${dateStr} ${timeStr})`;
}

export function sortReadyQueue<T extends { created_at?: string }>(
  tags: T[],
  hydrate: (t: T) => BugWorkItem = hydrateWorkItem as any
): T[] {
  const ready = tags.filter((t) => hydrate(t).queue === 'ready');
  return ready.sort((a, b) => {
    const wa = hydrate(a);
    const wb = hydrate(b);
    if (wb.occurrences !== wa.occurrences) return wb.occurrences - wa.occurrences;
    const sa = CLASS_SEVERITY[wa.class || ''] ?? 500;
    const sb = CLASS_SEVERITY[wb.class || ''] ?? 500;
    if (sa !== sb) return sa - sb;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
}

export function publicId(item: BugWorkItem, tagId?: string): string {
  if (item.public_n > 0) return `#${item.public_n}`;
  return `#${String(tagId || 'bug').slice(0, 8)}`;
}

export function assignPublicN(item: BugWorkItem, used: number[]): BugWorkItem {
  if (item.public_n > 0) return item;
  const max = used.reduce((m, n) => Math.max(m, n), 0);
  return { ...item, public_n: max + 1 };
}

/** Oldest unnumbered cards get the next integers. Existing #n are never reused. */
export function assignMissingPublicNs(tags: any[]): Array<{ id: string; item: BugWorkItem }> {
  const used = (tags || []).map((t) => hydrateWorkItem(t).public_n).filter((n) => n > 0);
  const need = (tags || [])
    .filter((t) => t?.id && !hydrateWorkItem(t).public_n)
    .slice()
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const acc = [...used];
  const out: Array<{ id: string; item: BugWorkItem }> = [];
  for (const t of need) {
    const item = assignPublicN(hydrateWorkItem(t), acc);
    acc.push(item.public_n);
    out.push({ id: t.id, item });
  }
  return out;
}

export function lastCommit(item: BugWorkItem): BugCommit | null {
  const list = item.commits || [];
  return list.length ? list[list.length - 1] : null;
}

export function applyAttempt(
  item: BugWorkItem,
  attempt: {
    at?: string;
    actor?: string;
    hyp: string;
    file: string;
    test: string;
    result: string;
    burned?: boolean;
    note?: string;
  }
): { item: BugWorkItem; rejected?: string } {
  if (item.queue === 'done') return { item, rejected: 'card_done' };
  if (isBurned(item.burns, attempt.hyp, attempt.file, attempt.test)) {
    return { item, rejected: 'already_burned' };
  }
  const row: BugAttempt = {
    at: attempt.at || new Date().toISOString(),
    actor: attempt.actor || 'agent',
    hyp: attempt.hyp,
    file: attempt.file,
    test: attempt.test,
    result: attempt.result,
    burned: !!attempt.burned,
    note: attempt.note,
  };
  const burns = row.burned ? [...item.burns, row] : item.burns;
  const commit: BugCommit = {
    id: `c${item.commits.length + 1}`,
    at: row.at,
    actor: row.actor,
    kind: 'agent',
    summary: row.burned ? `burn: ${row.hyp}` : `attempt: ${row.hyp}`,
    evidence: item.current_evidence,
    attempt: row,
  };
  let queue: BugQueueStatus = item.queue;
  if (row.burned && burns.filter((b) => b.burned).length >= BURN_BUDGET) queue = 'blocked';
  if (!row.burned && /green|pass/.test(String(row.result)) && item.remaining.length === 0) {
    queue = 'done';
  }
  return {
    item: {
      ...item,
      burns,
      commits: [...item.commits, commit],
      queue,
    },
  };
}

/** Merge snap remaining texts + per-line photo pointers. Remaining stays string[]. */
export function applySnapRemaining(
  item: BugWorkItem,
  opts: { remaining?: string[]; remaining_lines?: RemainingLinePhoto[]; symptom?: string }
): BugWorkItem {
  const incoming = (opts.remaining || []).map((s) => String(s).trim()).filter(Boolean);
  let remaining = item.remaining.slice();
  if (incoming.length) {
    for (const r of incoming) {
      if (!remaining.some((x) => x.toLowerCase() === r.toLowerCase())) remaining.push(r);
    }
  } else if (!remaining.length && opts.symptom) {
    remaining = [String(opts.symptom).slice(0, 300)];
  }
  const lines = (opts.remaining_lines || [])
    .map((l) => ({
      text: String(l?.text || '').trim(),
      comment: l?.comment ? String(l.comment) : undefined,
      photo_urls: Array.isArray(l?.photo_urls) ? l.photo_urls.map(String).filter(Boolean) : [],
      source: l?.source ? String(l.source) : undefined,
    }))
    .filter((l) => l.text);
  let evidence = item.current_evidence;
  if (lines.length) {
    evidence = {
      ...(evidence || {}),
      line_photos: [...(evidence?.line_photos || []), ...lines],
    };
  }
  return { ...item, remaining, current_evidence: evidence };
}

export function linePhotosForText(evidence: BugEvidence | null | undefined, text: string): RemainingLinePhoto | undefined {
  const needle = String(text || '').trim().toLowerCase();
  if (!needle || !evidence?.line_photos?.length) return undefined;
  return evidence.line_photos.find((l) => {
    const t = String(l.text || '').trim().toLowerCase();
    return t === needle || needle.startsWith(t) || t.startsWith(needle.split(' — ')[0]);
  });
}

export function appendEvidenceCommit(
  item: BugWorkItem,
  opts: { actor: string; kind: BugCommit['kind']; summary: string; evidence: BugEvidence; remaining?: string[] }
): BugWorkItem {
  const commit: BugCommit = {
    id: `c${item.commits.length + 1}`,
    at: new Date().toISOString(),
    actor: opts.actor,
    kind: opts.kind,
    summary: opts.summary,
    evidence: opts.evidence,
  };
  const hold = [...new Set([...(item.hold_refs || []), opts.evidence.job_id, opts.evidence.debug_url].filter(Boolean))] as string[];
  const queue: BugQueueStatus = item.queue === 'done' ? 'ready' : item.queue;
  return {
    ...item,
    queue,
    occurrences: item.occurrences + (item.commits.length ? 1 : 0),
    current_evidence: opts.evidence,
    commits: [...item.commits, commit],
    remaining: opts.remaining || item.remaining,
    hold_refs: hold,
  };
}

export type BugNow = {
  public_id: string;
  bug: string;
  class?: string;
  remaining: string[];
  done: string[];
  parked: string[];
  current_evidence: BugEvidence | null;
  tried: string[];
  burns_used: string;
  queue: BugQueueStatus;
  do_not: string[];
};

export function buildNow(tag: any): BugNow {
  const item = hydrateWorkItem(tag);
  const burned = item.burns.filter((b) => b.burned);

  const allAttempts: BugAttempt[] = [...item.burns];
  if (Array.isArray(item.commits)) {
    for (const c of item.commits) {
      if (
        c?.attempt &&
        !allAttempts.some(
          (a) => a.hyp === c.attempt?.hyp && a.file === c.attempt?.file && a.test === c.attempt?.test
        )
      ) {
        allAttempts.push(c.attempt);
      }
    }
  }

  const triedStrings = allAttempts.map((b) => {
    if (b.burned) {
      return `${b.hyp} | ${b.file} | ${b.test} | ${b.result || 'burned'} | DO NOT RETRY`;
    }
    const statusText = b.result ? ` | [${b.result}]` : '';
    const noteText = b.note ? ` (${b.note})` : '';
    return `${b.hyp} | ${b.file} | ${b.test}${statusText}${noteText}`;
  });

  return {
    public_id: publicId(item, tag?.id),
    bug: item.bug,
    class: item.class,
    remaining: item.remaining,
    done: item.done,
    parked: item.parked,
    current_evidence: item.current_evidence,
    tried: triedStrings,
    burns_used: `${burned.length}/${BURN_BUDGET}`,
    queue: item.queue,
    do_not: [
      'POST /api/golden/cases/:id/loop',
      'edit expected.json to paint green',
      'retry any line in tried',
      'mark done from chat without the predicted test flipping',
    ],
  };
}

export function buildStartPayload(tag: any): {
  say: string;
  now: BugNow;
  commits: BugCommit[];
  how_to_end: string;
  tag_id: string;
} {
  const item = hydrateWorkItem(tag);
  const id = tag?.id || '';
  return {
    say: 'Next bug',
    tag_id: id,
    now: buildNow(tag),
    commits: item.commits,
    how_to_end: `POST /api/bugs/${id}/attempts { hyp, file, test, result, burned, note }`,
  };
}
