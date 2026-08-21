/**
 * Q-6.4 item 6 — leftover D1 golden_cases → issue_tags #n.
 * Does not Promote. Does not mint disk inbox/. Dupes link; promoted rows skip create.
 */
import { hydrateWorkItem } from './bugWorkItem';

export type InboxCaseLite = {
  id: string;
  tag_id?: string | null;
  job_id?: string | null;
  title?: string | null;
  status?: string | null;
};

export type TagLite = {
  id: string;
  title?: string | null;
  work_item?: any;
};

export type InboxMigratePlan = {
  caseId: string;
  action: 'already_linked' | 'link_existing' | 'skip_promoted' | 'create_tag';
  tagId?: string;
  title?: string;
  jobId?: string | null;
  remaining?: string[];
  reason: string;
};

function tagJobIds(tag: TagLite): string[] {
  const w = hydrateWorkItem(tag);
  const ids = [
    w.current_evidence?.job_id,
    ...(w.hold_refs || []),
    ...(w.commits || []).map((c) => c.evidence?.job_id),
  ];
  return [...new Set(ids.map((x) => String(x || '').trim()).filter(Boolean))];
}

function titleKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function planInboxMigration(cases: InboxCaseLite[], tags: TagLite[]): InboxMigratePlan[] {
  const byId = new Map((tags || []).map((t) => [t.id, t]));
  const byJob = new Map<string, TagLite>();
  for (const t of tags || []) {
    for (const jid of tagJobIds(t)) byJob.set(jid, t);
  }

  const out: InboxMigratePlan[] = [];
  const createdJobs = new Set<string>();

  for (const c of cases || []) {
    const caseId = String(c.id || '');
    if (!caseId) continue;
    const jobId = c.job_id ? String(c.job_id) : null;
    const status = String(c.status || '').toLowerCase();
    const title = String(c.title || '').trim();

    if (c.tag_id && byId.has(String(c.tag_id))) {
      out.push({
        caseId,
        action: 'already_linked',
        tagId: String(c.tag_id),
        jobId,
        title,
        reason: 'golden_cases.tag_id already points at an issue_tags row',
      });
      continue;
    }

    const hit = jobId ? byJob.get(jobId) : undefined;
    if (hit) {
      out.push({
        caseId,
        action: 'link_existing',
        tagId: hit.id,
        jobId,
        title,
        reason: `job_id ${jobId} already on ${hit.id}`,
      });
      continue;
    }

    if (status === 'promoted') {
      out.push({
        caseId,
        action: 'skip_promoted',
        jobId,
        title,
        reason: 'official golden — do not mint a sibling #n',
      });
      continue;
    }

    if (jobId && createdJobs.has(jobId)) {
      out.push({
        caseId,
        action: 'skip_promoted',
        jobId,
        title,
        reason: 'duplicate D1 row for a job already planned as create_tag',
      });
      continue;
    }

    const sameTitle = title
      ? (tags || []).find((t) => titleKey(t.title || '') && titleKey(t.title || '') === titleKey(title))
      : undefined;
    if (sameTitle) {
      out.push({
        caseId,
        action: 'link_existing',
        tagId: sameTitle.id,
        jobId,
        title,
        reason: `title matches existing card ${sameTitle.id}`,
      });
      continue;
    }

    if (jobId) createdJobs.add(jobId);
    out.push({
      caseId,
      action: 'create_tag',
      jobId,
      title: title || `Inbox leftover ${caseId.slice(0, 8)}`,
      remaining: [`Inbox leftover: ${title || caseId}`],
      reason: 'no matching #n — create foodcart card',
    });
  }

  return out;
}
