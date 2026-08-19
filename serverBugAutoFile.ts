/**
 * Persist Q-6 auto-file onto issue_tags.work_item (pointers only).
 */
import { normalizeTagKey, titleFromKey } from './serverIssueBacklog.js';
import {
  applyAutoFile,
  classifyGoldenReds,
  classifyJobResult,
  type AutoFileCandidate,
} from './src/utils/bugAutoFile';
import { hydrateWorkItem } from './src/utils/bugWorkItem';

const LOG = '[bug-auto-file]';

async function persistWorkItem(tagId: string, item: ReturnType<typeof hydrateWorkItem>): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import('./supabaseAdmin.js');
    const { error } = await supabaseAdmin.from('issue_tags').update({ work_item: item }).eq('id', tagId);
    if (error) {
      console.warn(`${LOG} persist skipped:`, error.message);
      return false;
    }
    return true;
  } catch (e: any) {
    console.warn(`${LOG} persist failed:`, e?.message || e);
    return false;
  }
}

async function loadOpenTags(): Promise<any[]> {
  const { supabaseAdmin } = await import('./supabaseAdmin.js');
  const { data, error } = await supabaseAdmin
    .from('issue_tags')
    .select('*')
    .in('status', ['to_fix', 'in_progress'])
    .limit(200);
  if (error) {
    console.warn(`${LOG} load tags:`, error.message);
    return [];
  }
  return data || [];
}

export async function persistAutoFile(candidate: AutoFileCandidate): Promise<{
  ok: boolean;
  action: string;
  tag_id?: string;
  public_n?: number;
  unmatched?: boolean;
}> {
  const tags = await loadOpenTags();
  const usedNs = tags.map((t) => hydrateWorkItem(t).public_n).filter((n) => n > 0);
  const decision = applyAutoFile(tags, candidate, usedNs);
  const { supabaseAdmin } = await import('./supabaseAdmin.js');

  if (decision.existing?.id) {
    await persistWorkItem(decision.existing.id, decision.item);
    return {
      ok: true,
      action: decision.action,
      tag_id: decision.existing.id,
      public_n: decision.item.public_n,
      unmatched: !!decision.item.unmatched,
    };
  }

  const rawTitle = (candidate.bug || candidate.query || 'Auto-filed job').slice(0, 200);
  const title_key = normalizeTagKey(rawTitle) || rawTitle.toLowerCase().slice(0, 160);
  const title = titleFromKey(title_key, rawTitle);
  const { data: created, error } = await supabaseAdmin
    .from('issue_tags')
    .insert({
      title,
      title_key,
      category: candidate.category || 'foodcart',
      status: 'to_fix',
      comments: [],
    })
    .select('id')
    .single();
  if (error || !created?.id) {
    console.warn(`${LOG} insert tag:`, error?.message || 'no id');
    return { ok: false, action: 'insert_failed' };
  }
  await persistWorkItem(created.id, decision.item);
  return {
    ok: true,
    action: decision.action,
    tag_id: created.id,
    public_n: decision.item.public_n,
    unmatched: !!decision.item.unmatched,
  };
}

export async function tryAutoFileJob(input: Parameters<typeof classifyJobResult>[0]): Promise<{
  ok: boolean;
  skipped?: boolean;
  action?: string;
  tag_id?: string;
  public_n?: number;
  unmatched?: boolean;
}> {
  try {
    const candidate = classifyJobResult(input);
    if (!candidate) return { ok: true, skipped: true };
    return persistAutoFile(candidate);
  } catch (e: any) {
    console.warn(`${LOG} job:`, e?.message || e);
    return { ok: false, action: 'error' };
  }
}

export async function tryAutoFileGolden(input: Parameters<typeof classifyGoldenReds>[0]): Promise<{
  ok: boolean;
  skipped?: boolean;
  action?: string;
  tag_id?: string;
  public_n?: number;
  unmatched?: boolean;
}> {
  try {
    const candidate = classifyGoldenReds(input);
    if (!candidate) return { ok: true, skipped: true };
    return persistAutoFile(candidate);
  } catch (e: any) {
    console.warn(`${LOG} golden:`, e?.message || e);
    return { ok: false, action: 'error' };
  }
}
