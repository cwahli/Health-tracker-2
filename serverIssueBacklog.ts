export const DEFAULT_ISSUE_TYPE = 'general_bug';
/**
 * Issue backlog + shared issue tags (fix items).
 * Mount with: registerIssueBacklogRoutes(app, { addDebugLog, getSessionLogs })
 *
 * Model:
 * - issue_backlog = one flagged log/report (diagnostic payload + user_note)
 * - issue_tags = one sentence/bug to fix (shared across many logs)
 * - issue_tag_links = M:N assignment
 * - Fix notes / comments live on tags; tick hard-deletes the tag from DB
 */

import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import { normalizeChainKey } from './serverBrandMenu.js';

async function uploadBacklogPayloadToR2(id: string, payload: any): Promise<string> {
  try {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || 'd17eecca64f82625d29dc38b14f46c14';
    const CLOUDFLARE_R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
    const CLOUDFLARE_R2_PUBLIC_URL = (process.env.CLOUDFLARE_R2_PUBLIC_URL || 'https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev').replace(/\/$/, '');
    const CLOUDFLARE_R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '';
    const CLOUDFLARE_R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';

    const publicUrl = `${CLOUDFLARE_R2_PUBLIC_URL}/backlogs/${id}.json`;
    if (!CLOUDFLARE_R2_ACCESS_KEY_ID || !CLOUDFLARE_R2_SECRET_ACCESS_KEY) {
      console.warn('[Backlog R2] Credentials missing, skipping R2 upload');
      return publicUrl;
    }

    const s3Endpoint = `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const client = new S3Client({
      region: 'auto',
      endpoint: s3Endpoint,
      credentials: {
        accessKeyId: CLOUDFLARE_R2_ACCESS_KEY_ID,
        secretAccessKey: CLOUDFLARE_R2_SECRET_ACCESS_KEY,
      },
    });

    const body = Buffer.from(JSON.stringify(payload, null, 2));

    const command = new PutObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: `backlogs/${id}.json`,
      Body: body,
      ContentType: 'application/json',
    });
    await client.send(command);
    return publicUrl;
  } catch (err) {
    console.error('[Backlog R2] Upload failed:', err);
    return '';
  }
}

async function fetchPayloadFromR2(id: string): Promise<any> {
  try {
    const CLOUDFLARE_R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '';
    const CLOUDFLARE_R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';

    if (CLOUDFLARE_R2_ACCESS_KEY_ID && CLOUDFLARE_R2_SECRET_ACCESS_KEY) {
      try {
        const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
        const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || 'd17eecca64f82625d29dc38b14f46c14';
        const CLOUDFLARE_R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
        const s3Endpoint = `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
        const client = new S3Client({
          region: 'auto',
          endpoint: s3Endpoint,
          credentials: {
            accessKeyId: CLOUDFLARE_R2_ACCESS_KEY_ID,
            secretAccessKey: CLOUDFLARE_R2_SECRET_ACCESS_KEY,
          },
        });
        const command = new GetObjectCommand({
          Bucket: CLOUDFLARE_R2_BUCKET_NAME,
          Key: `backlogs/${id}.json`,
        });
        const response = await client.send(command);
        if (response.Body) {
          const bodyString = await response.Body.transformToString();
          return JSON.parse(bodyString);
        }
      } catch (s3Err) {
        // Fallback to fetch
      }
    }

    const CLOUDFLARE_R2_PUBLIC_URL = (process.env.CLOUDFLARE_R2_PUBLIC_URL || 'https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev').replace(/\/$/, '');
    const url = `${CLOUDFLARE_R2_PUBLIC_URL}/backlogs/${id}.json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      return await res.json();
    }
  } catch (err: any) {
    const isNetworkErr = err && (err.name === 'TimeoutError' || err.name === 'AbortError' || err.name === 'TypeError' || (err.message && (err.message.includes('timeout') || err.message.includes('fetch failed'))));
    if (isNetworkErr) {
      console.debug(`[Backlog R2] Payload fetch skipped or unavailable for ${id}: ${err?.message || err}`);
    } else {
      console.warn(`[Backlog R2] Failed to fetch payload for ${id}:`, err?.message || err);
    }
  }
  return null;
}

const ISSUE_TYPES = new Set([
  'incorrect_answer',
  'wrong_item',
  'missing_link',
  'link_unfetchable',
  'low_confidence',
  'bad_extract',
  'general_bug',
  'other',
]);

export function normalizeTagKey(raw: string): string {
  let t = String(raw || '')
    .toLowerCase()
    .replace(/['"“”‘’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  if (
    /view nutrition|nutrition label|nutrients? (aren.?t|not) shown|not showing the nutrient|nutrition link not show/.test(
      t
    )
  ) {
    return 'view nutrition labels missing or empty';
  }
  if (/link to yolk|yolk missing|official (menu|nutrition).*missing|missing.*official|missing_link/.test(t)) {
    return 'link to yolk official menu missing';
  }
  if (
    /multiple time|called multiple|duplicate|same answer|live unfiltered|streaming|extra long|timeout|abort/.test(t)
  ) {
    return 'duplicate streaming or multiple agent calls';
  }
  if (/using yolk data|yolk data|official yolk|menu_official|chain source/.test(t)) {
    return 'calculation should use yolk official data';
  }
  if (/calculation incorrect|incorrect calc|wrong nutrient|nutrient.*wrong|carbs? (0|zero)|protein thrash/.test(t)) {
    return 'calculation incorrect';
  }
  if (/can you review|^review$|please review/.test(t) && t.length < 40) return '';
  // Drop short filler fragments that are not standalone bugs
  if (/^(it needs to be shown|also|can you review|please review|thanks|thank you)\.?$/.test(t)) return '';
  if (t.length < 12 && !/calc|link|yolk|view|stream|timeout|carb|protein/.test(t)) return '';
  return t.slice(0, 160);
}

export function titleFromKey(titleKey: string, originalLine: string): string {
  const map: Record<string, string> = {
    'view nutrition labels missing or empty': 'View nutrition labels missing or empty',
    'link to yolk official menu missing': 'Link to YOLK official menu missing',
    'duplicate streaming or multiple agent calls': 'Duplicate streaming / multiple agent calls',
    'calculation should use yolk official data': 'Calculation should use YOLK official data',
    'calculation incorrect': 'Calculation incorrect',
  };
  if (map[titleKey]) return map[titleKey];
  const cleaned = String(originalLine || '')
    .replace(/^[•\-\*\d.)\s]+/, '')
    .trim();
  if (cleaned.length >= 6) return cleaned.slice(0, 200);
  return titleKey.charAt(0).toUpperCase() + titleKey.slice(1);
}

export function parseNoteIntoTagTitles(userNote: string | null | undefined): string[] {
  if (!userNote || !String(userNote).trim()) return [];
  const chunks: string[] = [];
  for (const para of String(userNote).split(/\n+/)) {
    const p = para.trim().replace(/^[•\-\*]\s+/, '');
    if (!p) continue;
    // Prefer newline-separated bug lines; only sentence-split when a line is very long
    if (p.length > 140 && /[.!?]\s+/.test(p)) {
      for (const s of p.split(/(?<=[.!?])\s+(?=[A-Z"“])/)) {
        const t = s.trim();
        if (t.length >= 8) chunks.push(t);
      }
    } else {
      chunks.push(p);
    }
  }
  // Second pass: also pick up known multi-issue paragraphs that mix bugs with "Also,"
  const expanded: string[] = [];
  for (const c of chunks) {
    if (/\balso\b/i.test(c) && c.length > 80) {
      const parts = c.split(/\bAlso,?\s+/i).map((x) => x.trim()).filter(Boolean);
      expanded.push(...parts);
    } else {
      expanded.push(c);
    }
  }
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const line of expanded) {
    const key = normalizeTagKey(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    titles.push(titleFromKey(key, line));
  }
  return titles;
}

async function ensureTagsForIssue(
  supabaseAdmin: any,
  issueId: string,
  userNote: string | null | undefined,
  issueType?: string | null
): Promise<string[]> {
  const titles = parseNoteIntoTagTitles(userNote);
  // Always ensure type-based tag when note empty but type is specific
  if (titles.length === 0 && issueType === 'missing_link') {
    titles.push(titleFromKey('link to yolk official menu missing', 'Link to official menu missing'));
  }
  if (titles.length === 0 && issueType === 'incorrect_answer') {
    titles.push(titleFromKey('calculation incorrect', 'Calculation incorrect'));
  }

  const tagIds: string[] = [];
  for (const title of titles) {
    const title_key = normalizeTagKey(title) || title.toLowerCase().slice(0, 160);
    if (!title_key) continue;

    let tagId: string | null = null;
    const { data: existing } = await supabaseAdmin
      .from('issue_tags')
      .select('id')
      .eq('title_key', title_key)
      .maybeSingle();

    if (existing?.id) {
      tagId = existing.id;
      // Re-open if previously soft-closed (we hard-delete normally; keep for safety)
      await supabaseAdmin
        .from('issue_tags')
        .update({ status: 'to_fix', resolved_at: null })
        .eq('id', tagId)
        .eq('status', 'fixed');
    } else {
      const { data: created, error } = await supabaseAdmin
        .from('issue_tags')
        .insert({ title, title_key, status: 'to_fix' })
        .select('id')
        .single();
      if (error) {
        // race: unique conflict
        const { data: again } = await supabaseAdmin
          .from('issue_tags')
          .select('id')
          .eq('title_key', title_key)
          .maybeSingle();
        tagId = again?.id || null;
      } else {
        tagId = created?.id || null;
      }
    }

    if (tagId) {
      tagIds.push(tagId);
      const { error: linkErr } = await supabaseAdmin
        .from('issue_tag_links')
        .upsert({ tag_id: tagId, issue_id: issueId }, { onConflict: 'tag_id,issue_id' });
      if (linkErr) console.warn('[issue_tag_links] upsert:', linkErr.message);
    }
  }

  if (tagIds.length > 0) {
    // Mark report so when all tags are fixed/removed it becomes a deletion candidate
    const { error: everErr } = await supabaseAdmin
      .from('issue_backlog')
      .update({ ever_tagged: true })
      .eq('id', issueId);
    if (everErr) console.warn('[issue_backlog] ever_tagged update:', everErr.message);
  }
  return tagIds;
}

/** Create or reuse a tag by free-text title (manual admin path). */
async function upsertTagByTitle(supabaseAdmin: any, titleRaw: string): Promise<{ id: string; title: string; title_key: string } | null> {
  const title = String(titleRaw || '').trim().slice(0, 200);
  if (title.length < 3) return null;
  const title_key = normalizeTagKey(title) || title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 160);
  if (!title_key) return null;

  const { data: existing } = await supabaseAdmin
    .from('issue_tags')
    .select('id, title, title_key')
    .eq('title_key', title_key)
    .maybeSingle();
  if (existing?.id) {
    await supabaseAdmin
      .from('issue_tags')
      .update({ status: 'to_fix', resolved_at: null })
      .eq('id', existing.id)
      .eq('status', 'fixed');
    return { id: existing.id, title: existing.title || titleFromKey(title_key, title), title_key };
  }

  const display = titleFromKey(title_key, title);
  const { data: created, error } = await supabaseAdmin
    .from('issue_tags')
    .insert({ title: display, title_key, status: 'to_fix' })
    .select('id, title, title_key')
    .single();
  if (error) {
    const { data: again } = await supabaseAdmin
      .from('issue_tags')
      .select('id, title, title_key')
      .eq('title_key', title_key)
      .maybeSingle();
    return again?.id ? { id: again.id, title: again.title, title_key: again.title_key } : null;
  }
  return created;
}

async function loadBugTagsWithLinks(supabaseAdmin: any) {
  let tags: any[] = [];
  let links: any[] = [];
  try {
    let { data: tagRows, error: tErr } = await supabaseAdmin
      .from('issue_tags')
      .select('id, created_at, title, title_key, category, status, resolution_note, whats_still_open, comments, resolved_at')
      .eq('status', 'to_fix')
      .order('created_at', { ascending: false })
      .limit(200);
    if (tErr) {
      // Fallback if category or whats_still_open not yet migrated
      const { data: tagRowsFallback } = await supabaseAdmin
        .from('issue_tags')
        .select('id, created_at, title, title_key, status, resolution_note, comments, resolved_at')
        .eq('status', 'to_fix')
        .order('created_at', { ascending: false })
        .limit(200);
      tagRows = tagRowsFallback || [];
    }
    tags = (tagRows || []).map((t: any) => ({
      ...t,
      category: t.category || 'foodcart',
      whats_still_open: t.whats_still_open || '',
    }));
    if (tags.length > 0) {
      const { data: linkRows } = await supabaseAdmin
        .from('issue_tag_links')
        .select('tag_id, issue_id')
        .in(
          'tag_id',
          tags.map((t: any) => t.id)
        );
      links = linkRows || [];
    }
  } catch {
    tags = [];
    links = [];
  }
  return { tags, links };
}

export type IssueBacklogDeps = {
  addDebugLog?: (msg: string, sessionId?: string) => void;
  getSessionLogs?: (sessionId: string) => any[];
  globalDebugLogs?: any[];
  sessionDebugLogs?: Record<string, any[]>;
};

export function registerIssueBacklogRoutes(app: Express, deps: IssueBacklogDeps = {}) {
  const addDebugLog = deps.addDebugLog || ((m: string) => console.log(m));

  app.get('/api/bug-tracker/overview', async (_req: Request, res: Response) => {
    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');

      let issues: any[] | null = null;
      let iErr: any = null;
      {
        const r = await supabaseAdmin
          .from('issue_backlog')
          .select(
            'id, created_at, status, issue_type, severity, country_code, chain_key, dish_query, context, source_url, user_note, resolution_note, ever_tagged, payload'
          )
          .order('created_at', { ascending: false })
          .limit(200);
        issues = r.data;
        iErr = r.error;
        // Backward-compatible if ever_tagged column not yet migrated
        if (iErr && /ever_tagged/i.test(String(iErr.message || ''))) {
          const r2 = await supabaseAdmin
            .from('issue_backlog')
            .select(
              'id, created_at, status, issue_type, severity, country_code, chain_key, dish_query, context, source_url, user_note, resolution_note, payload'
            )
            .order('created_at', { ascending: false })
            .limit(200);
          issues = r2.data;
          iErr = r2.error;
        }
      }
      if (iErr) return res.status(500).json({ error: iErr.message });

      if (issues && Array.isArray(issues)) {
        issues = await Promise.all(issues.map(async (issue: any) => {
          if (issue.payload && typeof issue.payload === 'object' && (issue.payload as any).is_r2) {
            const r2Payload = await fetchPayloadFromR2(issue.id);
            if (r2Payload) {
              return { ...issue, payload: r2Payload };
            }
          }
          return issue;
        }));
      }

      const { tags, links } = await loadBugTagsWithLinks(supabaseAdmin);
      const issuesById = new Map((issues || []).map((i: any) => [i.id, i]));

      const bugTags = tags.map((t: any) => {
        const linkedIds = links.filter((l: any) => l.tag_id === t.id).map((l: any) => l.issue_id);
        const linkedIssues = linkedIds
          .map((id: any) => issuesById.get(id))
          .filter(Boolean)
          .map((i: any) => ({
            id: i.id,
            created_at: i.created_at,
            status: i.status,
            issue_type: i.issue_type,
            context: i.context,
            chain_key: i.chain_key,
            dish_query: i.dish_query,
            user_note: i.user_note,
          }));
        return { ...t, linked_issue_ids: linkedIds, linked_issues: linkedIssues, linked_count: linkedIds.length };
      });

      // A report is a deletion candidate once it had a tag and now has none left.
      // Prefer ever_tagged; also treat any report that is currently unlinked but previously appeared in links is hard without history —
      // ever_tagged is the source of truth (set on every successful tag link).
      const linkedIssueIdSet = new Set(links.map((l: any) => l.issue_id));
      const deletionCandidates = (issues || []).filter(
        (i: any) => (i.ever_tagged === true || i.ever_tagged === 'true') && !linkedIssueIdSet.has(i.id)
      );

      // Preview of note → tag titles (for manual UI) without writing
      const reportNotePreviews = (issues || []).map((i: any) => ({
        id: i.id,
        suggested_titles: parseNoteIntoTagTitles(i.user_note),
      }));

      res.json({
        bugTags,
        allReports: issues || [],
        deletionCandidates,
        reportNotePreviews,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'bug tracker overview failed' });
    }
  });

  app.post('/api/issues/flag', async (req: Request, res: Response) => {
    try {
      const sessionId =
        (req.headers['x-session-id'] as string) ||
        (req.query.sessionId as string) ||
        'global';
      const {
        issue_type,
        custom_issue_type,
        tag_id,
        new_bug_title,
        category,
        severity = 'medium',
        country_code,
        chain_key,
        dish_query,
        context,
        source_url,
        user_note,
        firebase_uid,
        payload,
        register_source_url,
        register_display_name,
        register_source_kind,
      } = req.body || {};

      if (!issue_type || !ISSUE_TYPES.has(String(issue_type))) {
        return res.status(400).json({
          error: `issue_type required. Allowed: ${Array.from(ISSUE_TYPES).join(', ')}`,
        });
      }

      let safePayload: any = payload && typeof payload === 'object' ? payload : {};
      try {
        const s = JSON.stringify(safePayload);
        if (s.length > 1_000_000) {
          safePayload = {
            truncated: true,
            originalBytes: s.length,
            debugLogText:
              typeof safePayload.debugLogText === 'string'
                ? safePayload.debugLogText.slice(-120_000)
                : undefined,
            answerPreview:
              safePayload.answer != null
                ? JSON.stringify(safePayload.answer).slice(0, 80_000)
                : undefined,
            query: safePayload.query || null,
          };
        }
      } catch {
        safePayload = { error: 'payload_not_serializable' };
      }

      try {
        if (!safePayload.debugLogText && !safePayload.debugLogLines) {
          let logs = deps.globalDebugLogs || [];
          if (sessionId !== 'global' && deps.sessionDebugLogs?.[sessionId]) {
            logs = deps.sessionDebugLogs[sessionId];
          }
          if (Array.isArray(logs) && logs.length > 0) {
            safePayload.debugLogLines = logs.slice(-500);
            safePayload.debugLogText = logs
              .slice(-500)
              .map((l: any) => `[${l.timestamp || ''}] ${l.message || l}`)
              .join('\n');
            safePayload.debugLogsFromServer = true;
          }
        }
      } catch {
        /* ignore */
      }

      try {
        const lines: any[] = Array.isArray(safePayload.debugLogLines)
          ? safePayload.debugLogLines
          : String(safePayload.debugLogText || '')
              .split('\n')
              .filter(Boolean)
              .map((message: string) => ({ message }));
        if (!Array.isArray(safePayload.pipelineErrors) || safePayload.pipelineErrors.length === 0) {
          const pipelineErrors: any[] = [];
          const pipelineWarnings: any[] = [];
          for (const l of lines) {
            const message = String(l?.message ?? l ?? '');
            const lower = message.toLowerCase();
            const base = { message: message.slice(0, 2000), timestamp: l?.timestamp };
            if (/fatal|aborterror|operation was aborted|timed out|timeout|exception| failed|error:/.test(lower)) {
              pipelineErrors.push({
                ...base,
                level: 'error',
                kind: /abort|timeout/.test(lower)
                  ? 'llm_timeout'
                  : /blocked|captcha/.test(lower)
                    ? 'provider_blocked'
                    : 'error',
              });
            } else if (
              /blocked|captcha|discarded unusable|atwater|rescaling|deviation|direct injection|first-principles/.test(
                lower
              )
            ) {
              pipelineWarnings.push({
                ...base,
                level: 'warning',
                kind: /atwater|rescaling/.test(lower)
                  ? 'atwater_rescale'
                  : /captcha|blocked/.test(lower)
                    ? 'search_blocked'
                    : /discarded/.test(lower)
                      ? 'web_hit_discarded'
                      : /direct injection|first-principles/.test(lower)
                        ? 'nutrient_injection'
                        : 'warning',
              });
            }
          }
          safePayload.pipelineErrors = pipelineErrors;
          safePayload.pipelineWarnings = pipelineWarnings;
        }
      } catch {
        /* ignore */
      }

      try {
        if (!safePayload.nutrientCalculation && safePayload.answer && typeof safePayload.answer === 'object') {
          const answer: any = safePayload.answer;
          const items = Array.isArray(answer.itemsBreakdown) ? answer.itemsBreakdown : [];
          safePayload.nutrientCalculation = {
            grandTotal: answer.nutrients || null,
            receiptTableMarkdown: answer.receiptTable || null,
            items: items.map((it: any, idx: number) => ({
              index: idx,
              scoutIndex: it.scoutIndex ?? idx,
              name: it.originalLocalName || it.canonicalDbName || it.name,
              weightGrams: it.weightGrams,
              dbSource: it.dbSource,
              dbId: it.dbId,
              matchReasonInfo: it.matchReasonInfo || null,
              primaryBase100g: it.primaryBase100g || null,
              cookingAdded: it.cookingAdded || null,
              components: it.components || null,
              itemTotals: {
                calories: it.calories,
                protein: it.protein,
                totalFat: it.totalFat,
                saturatedFat: it.saturatedFat,
                carbohydrates: it.carbohydrates,
                sodium: it.sodium,
              },
            })),
          };
        }
      } catch {
        /* ignore */
      }

      safePayload.serverMeta = {
        sessionId,
        receivedAt: new Date().toISOString(),
      };

      const { supabaseAdmin } = await import('./supabaseAdmin.js');

      const noteText = user_note != null ? String(user_note).trim() || null : null;

      const lightweightPayload = {
        is_r2: true,
        r2_url: null as string | null,
        pipelineErrorsCount: safePayload.pipelineErrors?.length || 0,
        pipelineWarningsCount: safePayload.pipelineWarnings?.length || 0,
        dishQuery: dish_query || null,
      };

      const row = {
        status: 'to_fix',
        issue_type: String(issue_type),
        severity: ['low', 'medium', 'high'].includes(severity) ? severity : 'medium',
        country_code: country_code || null,
        chain_key: chain_key || null,
        dish_query: dish_query || null,
        context: context || 'unknown',
        source_url: source_url || register_source_url || null,
        user_note: noteText,
        firebase_uid: firebase_uid || null,
        payload: lightweightPayload,
      };

      const { data, error } = await supabaseAdmin
        .from('issue_backlog')
        .insert(row)
        .select('id, status, created_at, user_note')
        .single();

      if (error) {
        console.error('[issue_backlog] insert error:', error.message);
        addDebugLog(
          `[IssueBacklog] FAILED to insert issue_type=${issue_type}: ${error.message}`,
          sessionId !== 'global' ? sessionId : undefined
        );
        return res.status(500).json({ error: error.message });
      }

      if (data && data.id) {
        try {
          const publicUrl = await uploadBacklogPayloadToR2(data.id, safePayload);
          if (publicUrl) {
            await supabaseAdmin
              .from('issue_backlog')
              .update({
                payload: {
                  ...lightweightPayload,
                  r2_url: publicUrl,
                },
              })
              .eq('id', data.id);
          }
        } catch (r2Err: any) {
          console.error('[IssueBacklog R2] Async upload failed:', r2Err.message);
        }
      }

      // Link or create requested tag / bug
      let tagIds: string[] = [];
      try {
        const reqTagId = tag_id && tag_id !== 'new_bug' ? String(tag_id) : null;
        const newTitle = new_bug_title ? String(new_bug_title).trim() : null;
        const cat = category || 'foodcart';

        if (newTitle) {
          // Create new bug tag explicitly
          const title_key = normalizeTagKey(newTitle) || newTitle.toLowerCase().slice(0, 160);
          let createdTagId: string | null = null;
          const { data: existingTag } = await supabaseAdmin
            .from('issue_tags')
            .select('id, comments')
            .eq('title_key', title_key)
            .maybeSingle();

          if (existingTag?.id) {
            createdTagId = existingTag.id;
          } else {
            const initialComments = noteText
              ? [{ id: crypto.randomUUID(), body: noteText, created_at: new Date().toISOString() }]
              : [];
            const { data: createdTag } = await supabaseAdmin
              .from('issue_tags')
              .insert({
                title: newTitle,
                title_key,
                category: cat,
                status: 'to_fix',
                comments: initialComments,
              })
              .select('id')
              .single();
            createdTagId = createdTag?.id || null;
          }

          if (createdTagId) {
            tagIds.push(createdTagId);
            await supabaseAdmin
              .from('issue_tag_links')
              .upsert({ tag_id: createdTagId, issue_id: data.id }, { onConflict: 'tag_id,issue_id' });
            await supabaseAdmin
              .from('issue_backlog')
              .update({ ever_tagged: true })
              .eq('id', data.id);
          }
        } else if (reqTagId) {
          // Link existing tag ID
          tagIds.push(reqTagId);
          await supabaseAdmin
            .from('issue_tag_links')
            .upsert({ tag_id: reqTagId, issue_id: data.id }, { onConflict: 'tag_id,issue_id' });
          await supabaseAdmin
            .from('issue_backlog')
            .update({ ever_tagged: true })
            .eq('id', data.id);

          // If noteText is provided, attach it as a comment on the identified bug tag
          if (noteText) {
            const { data: existingTag } = await supabaseAdmin
              .from('issue_tags')
              .select('id, comments')
              .eq('id', reqTagId)
              .maybeSingle();
            if (existingTag) {
              const prevComments = Array.isArray(existingTag.comments) ? [...existingTag.comments] : [];
              prevComments.push({
                id: crypto.randomUUID(),
                body: noteText,
                created_at: new Date().toISOString(),
              });
              await supabaseAdmin
                .from('issue_tags')
                .update({ comments: prevComments })
                .eq('id', reqTagId);
            }
          }
        } else {
          // Fall back to auto-linking from note/type
          tagIds = await ensureTagsForIssue(supabaseAdmin, data.id, noteText, issue_type);
        }
      } catch (tagErr: any) {
        console.warn('[issue_tags] ensure failed (run SQL migration?):', tagErr?.message);
      }

      const urlToRegister = register_source_url || (issue_type === 'missing_link' ? source_url : null);
      if (urlToRegister && chain_key) {
        try {
          const sourceRow = {
            country_code: country_code || 'GB',
            chain_key: String(chain_key).toLowerCase(),
            display_name: register_display_name || chain_key,
            url: String(urlToRegister),
            source_kind: register_source_kind || 'unknown',
            status: 'pending',
            priority: 100,
            enabled: true,
            meta: { registered_from: 'issue_flag', issue_id: data.id },
            updated_at: new Date().toISOString(),
          };
          const { error: srcErr } = await supabaseAdmin
            .from('chain_menu_sources')
            .upsert(sourceRow, { onConflict: 'country_code,chain_key,url' });
          if (srcErr) console.warn('[chain_menu_sources] upsert warning:', srcErr.message);
        } catch (regErr: any) {
          console.warn('[chain_menu_sources] register failed:', regErr?.message);
        }
      }

      addDebugLog(
        `[IssueBacklog] Saved id=${data.id} type=${issue_type} tags=${tagIds.length} note=${noteText ? 'yes' : 'no'}`,
        sessionId !== 'global' ? sessionId : undefined
      );

      res.json({
        success: true,
        id: data.id,
        status: data.status || 'to_fix',
        created_at: data.created_at,
        user_note: data.user_note,
        tag_ids: tagIds,
      });
    } catch (err: any) {
      console.error('[issue_backlog] exception:', err);
      res.status(500).json({ error: err?.message || 'Failed to flag issue' });
    }
  });

  app.get('/api/nutrition-data/overview', async (req: Request, res: Response) => {
    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      const country = String(req.query.country || 'GB');

      const { data: sources, error: sErr } = await supabaseAdmin
        .from('chain_menu_sources')
        .select('*')
        .order('chain_key', { ascending: true });
      if (sErr) return res.status(500).json({ error: sErr.message });

      const { data: issues, error: iErr } = await supabaseAdmin
        .from('issue_backlog')
        .select(
          'id, created_at, status, issue_type, severity, country_code, chain_key, dish_query, source_url, user_note, resolution_note'
        )
        .order('created_at', { ascending: false })
        .limit(100);
      if (iErr) return res.status(500).json({ error: iErr.message });

      const { tags, links } = await loadBugTagsWithLinks(supabaseAdmin);

      const issuesById = new Map((issues || []).map((i: any) => [i.id, i]));
      const issueTags = tags.map((t) => {
        const linkedIds = links.filter((l) => l.tag_id === t.id).map((l) => l.issue_id);
        const linkedIssues = linkedIds
          .map((id) => issuesById.get(id))
          .filter(Boolean)
          .map((i: any) => ({
            id: i.id,
            created_at: i.created_at,
            status: i.status,
            issue_type: i.issue_type,
            chain_key: i.chain_key,
            dish_query: i.dish_query,
            user_note: i.user_note,
          }));
        return {
          ...t,
          linked_issue_ids: linkedIds,
          linked_issues: linkedIssues,
          linked_count: linkedIds.length,
        };
      });

      let cachedFoods: any[] = [];
      try {
        const { data: foods } = await supabaseAdmin
          .from('food_cache')
          .select('id, provider, query_or_id, name, nutrients, fetched_at, expires_at, meta')
          .order('fetched_at', { ascending: false })
          .limit(200);
        cachedFoods = foods || [];
      } catch {
        cachedFoods = [];
      }

      // Deduplicate sources by normalized chain_key so each chain appears exactly once
      const rawSources = sources || [];
      const deduplicatedSourcesMap = new Map<string, any>();
      for (const s of rawSources) {
        const k = normalizeChainKey(s.chain_key || s.display_name || '');
        if (!k) continue;
        if (!deduplicatedSourcesMap.has(k)) {
          deduplicatedSourcesMap.set(k, { ...s, chain_key: k });
        } else {
          const existing = deduplicatedSourcesMap.get(k);
          if (s.status === 'ready' && existing.status !== 'ready') {
            deduplicatedSourcesMap.set(k, { ...s, chain_key: k });
          }
        }
      }
      const chainSources = Array.from(deduplicatedSourcesMap.values());
      const notFetched = chainSources.filter(
        (s: any) => s.status === 'pending' || s.status === 'failed' || !s.last_success_at
      );
      const ready = chainSources.filter((s: any) => s.status === 'ready' && s.enabled);

      let chainItemCounts: Record<string, { synced: number; pending: number; total: number }> = {};
      try {
        const { data: menuRows } = await supabaseAdmin
          .from('brand_menu_items')
          .select('chain_key')
          .eq('country_code', country);
        (menuRows || []).forEach((r: any) => {
          const k = normalizeChainKey(r.chain_key);
          if (!k) return;
          if (!chainItemCounts[k]) chainItemCounts[k] = { synced: 0, pending: 0, total: 0 };
          chainItemCounts[k].synced++;
          chainItemCounts[k].total++;
        });
        const { loadLocalItems } = await import('./serverBrandMenu.js');
        const localItems = loadLocalItems().filter((it: any) => it.country_code === country);
        localItems.forEach((it: any) => {
          const k = normalizeChainKey(it.chain_key);
          if (!k) return;
          if (!chainItemCounts[k]) chainItemCounts[k] = { synced: 0, pending: 0, total: 0 };
          chainItemCounts[k].pending++;
          chainItemCounts[k].total++;
        });
      } catch (e) {
        console.warn('[nutrition-data/overview] chainItemCounts failed:', e);
      }

      res.json({
        country,
        chainSources,
        chainReady: ready,
        chainNotFetched: notFetched,
        chainItemCounts,
        /** Primary backlog: shared fix tags (one sentence = one tag) */
        issueTags,
        /** Raw flagged log reports (payload diagnostics) */
        issueBacklog: issues || [],
        baseFoodCache: cachedFoods,
        notes: {
          baseFoods:
            'USDA basics are not fully mirrored in Supabase. baseFoodCache only lists optional short-TTL cache rows if food_cache exists.',
          chainMenus:
            'chain_menu_sources stores URLs only. Menu item nutrients appear only after an adapter ingest sets status=ready.',
          issueTags:
            'Each sentence in a flag note is a shared fix tag. Tick deletes the tag from the database. Fix notes live on the tag, not on each log.',
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'overview failed' });
    }
  });

  app.get('/api/issues/:id', async (req: Request, res: Response) => {
    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      const { data, error } = await supabaseAdmin
        .from('issue_backlog')
        .select('*')
        .eq('id', req.params.id)
        .single();
      if (error) return res.status(404).json({ error: error.message });

      if (data && data.payload && typeof data.payload === 'object' && (data.payload as any).is_r2) {
        const r2Payload = await fetchPayloadFromR2(data.id);
        if (r2Payload) {
          data.payload = r2Payload;
        }
      }

      let tags: any[] = [];
      try {
        const { data: linkRows } = await supabaseAdmin
          .from('issue_tag_links')
          .select('tag_id')
          .eq('issue_id', req.params.id);
        const ids = (linkRows || []).map((l: any) => l.tag_id);
        if (ids.length) {
          const { data: tagRows } = await supabaseAdmin.from('issue_tags').select('*').in('id', ids);
          tags = tagRows || [];
        }
      } catch {
        tags = [];
      }

      res.json({ issue: data, tags });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'load failed' });
    }
  });

  app.get('/api/issues', async (req: Request, res: Response) => {
    try {
      const status = (req.query.status as string) || 'to_fix';
      const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      let q = supabaseAdmin
        .from('issue_backlog')
        .select(
          'id, created_at, status, issue_type, severity, country_code, chain_key, dish_query, context, source_url, user_note, firebase_uid, resolution_note'
        )
        .order('created_at', { ascending: false })
        .limit(limit);
      if (status && status !== 'all') q = q.eq('status', status);
      const { data, error } = await q;
      if (error) return res.status(500).json({ error: error.message });
      res.json({ issues: data || [] });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to list issues' });
    }
  });

  /** Create a bug tag manually (optional link to a report). */
  app.post('/api/issue-tags', async (req: Request, res: Response) => {
    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      const title = String(req.body?.title || '').trim();
      const issueId = req.body?.issue_id ? String(req.body.issue_id) : null;
      const progress = req.body?.resolution_note != null ? String(req.body.resolution_note).trim() : '';
      if (title.length < 3) return res.status(400).json({ error: 'title required (min 3 chars)' });

      const tag = await upsertTagByTitle(supabaseAdmin, title);
      if (!tag) return res.status(400).json({ error: 'could not create tag from title' });

      if (progress) {
        const { data: cur } = await supabaseAdmin.from('issue_tags').select('resolution_note').eq('id', tag.id).single();
        const line = `[${new Date().toISOString()}] ${progress}`;
        const next =
          cur?.resolution_note && String(cur.resolution_note).trim()
            ? `${cur.resolution_note}\n\n${line}`
            : line;
        await supabaseAdmin.from('issue_tags').update({ resolution_note: next }).eq('id', tag.id);
      }

      if (issueId) {
        await supabaseAdmin
          .from('issue_tag_links')
          .upsert({ tag_id: tag.id, issue_id: issueId }, { onConflict: 'tag_id,issue_id' });
        await supabaseAdmin.from('issue_backlog').update({ ever_tagged: true }).eq('id', issueId);
      }

      const { data: full } = await supabaseAdmin.from('issue_tags').select('*').eq('id', tag.id).single();
      res.json({ success: true, tag: full || tag });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'create tag failed' });
    }
  });

  /** Link an existing tag to a report (history for that bug). */
  app.post('/api/issue-tags/:id/link', async (req: Request, res: Response) => {
    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      const tagId = req.params.id;
      const issueId = String(req.body?.issue_id || '').trim();
      if (!issueId) return res.status(400).json({ error: 'issue_id required' });

      const { data: tag, error: tErr } = await supabaseAdmin.from('issue_tags').select('id').eq('id', tagId).maybeSingle();
      if (tErr || !tag) return res.status(404).json({ error: 'tag not found' });

      const { error } = await supabaseAdmin
        .from('issue_tag_links')
        .upsert({ tag_id: tagId, issue_id: issueId }, { onConflict: 'tag_id,issue_id' });
      if (error) return res.status(500).json({ error: error.message });

      await supabaseAdmin.from('issue_backlog').update({ ever_tagged: true }).eq('id', issueId);
      res.json({ success: true, tag_id: tagId, issue_id: issueId });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'link failed' });
    }
  });

  /** Unlink tag from one report (does not delete the tag). */
  app.delete('/api/issue-tags/:id/links/:issueId', async (req: Request, res: Response) => {
    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      const { id: tagId, issueId } = req.params;
      const { error } = await supabaseAdmin
        .from('issue_tag_links')
        .delete()
        .eq('tag_id', tagId)
        .eq('issue_id', issueId);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true, tag_id: tagId, issue_id: issueId });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'unlink failed' });
    }
  });

  /** Extract bug tags from one report's flag note (manual per-report rebuild). */
  app.post('/api/issues/:id/extract-tags', async (req: Request, res: Response) => {
    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      const id = req.params.id;
      const { data: iss, error } = await supabaseAdmin
        .from('issue_backlog')
        .select('id, user_note, issue_type, resolution_note')
        .eq('id', id)
        .single();
      if (error || !iss) return res.status(404).json({ error: error?.message || 'report not found' });

      // Optional override: body.titles array of free-text titles
      let titles = Array.isArray(req.body?.titles)
        ? req.body.titles.map((t: any) => String(t || '').trim()).filter((t: string) => t.length >= 3)
        : parseNoteIntoTagTitles(iss.user_note);

      if (!titles.length && iss.issue_type === 'missing_link') {
        titles = [titleFromKey('link to yolk official menu missing', 'Link to official menu missing')];
      }

      const tagIds: string[] = [];
      for (const title of titles) {
        const tag = await upsertTagByTitle(supabaseAdmin, title);
        if (!tag) continue;
        tagIds.push(tag.id);
        await supabaseAdmin
          .from('issue_tag_links')
          .upsert({ tag_id: tag.id, issue_id: id }, { onConflict: 'tag_id,issue_id' });
      }
      if (tagIds.length) {
        await supabaseAdmin.from('issue_backlog').update({ ever_tagged: true }).eq('id', id);
      }

      // Optional: move this report's resolution_note onto tags that have none
      if (iss.resolution_note && tagIds.length) {
        for (const tid of tagIds) {
          const { data: tag } = await supabaseAdmin
            .from('issue_tags')
            .select('id, resolution_note')
            .eq('id', tid)
            .single();
          if (tag && !String(tag.resolution_note || '').trim()) {
            await supabaseAdmin
              .from('issue_tags')
              .update({ resolution_note: String(iss.resolution_note) })
              .eq('id', tid);
          }
        }
      }

      res.json({
        success: true,
        issue_id: id,
        titles,
        tag_ids: tagIds,
        suggested_from_note: parseNoteIntoTagTitles(iss.user_note),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'extract-tags failed' });
    }
  });

  /** Hard-delete a shared fix tag from the database (tick / mark fixed). Links cascade. */
  app.delete('/api/issue-tags/:id', async (req: Request, res: Response) => {
    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      const id = req.params.id;
      const { data: existing, error: loadErr } = await supabaseAdmin
        .from('issue_tags')
        .select('id, title')
        .eq('id', id)
        .maybeSingle();
      if (loadErr || !existing) return res.status(404).json({ error: loadErr?.message || 'tag not found' });

      const { error } = await supabaseAdmin.from('issue_tags').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true, deleted: true, id, title: existing.title });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'delete tag failed' });
    }
  });

  /** Append fix note or update fields on a tag (not on the log report). */
  app.patch('/api/issue-tags/:id', async (req: Request, res: Response) => {
    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      const id = req.params.id;
      const { resolution_note, append_note, title, whats_still_open, status, identified_problems } = req.body || {};
      const { data: existing, error: loadErr } = await supabaseAdmin
        .from('issue_tags')
        .select('*')
        .eq('id', id)
        .single();
      if (loadErr || !existing) return res.status(404).json({ error: loadErr?.message || 'not found' });

      const patch: any = {};
      if (title != null && String(title).trim()) {
        patch.title = String(title).trim().slice(0, 200);
        patch.title_key = normalizeTagKey(patch.title) || existing.title_key;
      }
      if (whats_still_open != null) {
        patch.whats_still_open = String(whats_still_open).trim();
      }
      if (status != null && String(status).trim()) {
        patch.status = String(status).trim();
      }
      if (resolution_note != null && String(resolution_note).trim()) {
        const stamp = new Date().toISOString();
        const line = `[${stamp}] ${String(resolution_note).trim()}`;
        patch.resolution_note =
          append_note !== false && existing.resolution_note
            ? `${existing.resolution_note}\n\n${line}`
            : line;
      }
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: 'Provide resolution_note, whats_still_open, status, title, or identified_problems' });
      }
      const { data, error } = await supabaseAdmin.from('issue_tags').update(patch).eq('id', id).select('*').single();
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true, tag: data });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'update tag failed' });
    }
  });

  app.post('/api/issue-tags/:id/comments', async (req: Request, res: Response) => {
    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      const id = req.params.id;
      const body = String(req.body?.body || '').trim();
      if (!body) return res.status(400).json({ error: 'body required' });
      const { data: existing, error: loadErr } = await supabaseAdmin
        .from('issue_tags')
        .select('id, comments')
        .eq('id', id)
        .single();
      if (loadErr || !existing) return res.status(404).json({ error: loadErr?.message || 'not found' });
      const comments = Array.isArray(existing.comments) ? [...existing.comments] : [];
      const comment = {
        id: crypto.randomUUID(),
        body: body.slice(0, 4000),
        created_at: new Date().toISOString(),
      };
      comments.push(comment);
      const { data, error } = await supabaseAdmin
        .from('issue_tags')
        .update({ comments })
        .eq('id', id)
        .select('*')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true, tag: data, comment });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'add comment failed' });
    }
  });

  app.delete('/api/issue-tags/:id/comments/:commentId', async (req: Request, res: Response) => {
    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      const { id, commentId } = req.params;
      const { data: existing, error: loadErr } = await supabaseAdmin
        .from('issue_tags')
        .select('id, comments')
        .eq('id', id)
        .single();
      if (loadErr || !existing) return res.status(404).json({ error: loadErr?.message || 'not found' });
      const prev = Array.isArray(existing.comments) ? existing.comments : [];
      const comments = prev.filter((c: any) => c && c.id !== commentId);
      if (comments.length === prev.length) return res.status(404).json({ error: 'comment not found' });
      const { data, error } = await supabaseAdmin
        .from('issue_tags')
        .update({ comments })
        .eq('id', id)
        .select('*')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true, tag: data });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'delete comment failed' });
    }
  });

  /** Hard-delete a flagged log report (payload) from the database. */
  app.delete('/api/issues/:id', async (req: Request, res: Response) => {
    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      const id = req.params.id;
      const { error } = await supabaseAdmin.from('issue_backlog').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true, deleted: true, id });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'delete issue failed' });
    }
  });

  /**
   * Rebuild tags from existing user_note rows (one-time / repair).
   * Moves log resolution_note onto matching tags when tag has no note yet.
   */
  app.post('/api/issue-tags/rebuild-from-notes', async (_req: Request, res: Response) => {
    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      const { data: issues, error } = await supabaseAdmin
        .from('issue_backlog')
        .select('id, user_note, issue_type, resolution_note, status')
        .order('created_at', { ascending: true });
      if (error) {
        return res.status(500).json({
          error: error.message,
          hint: 'Check Supabase credentials and that issue_backlog exists.',
        });
      }

      let linked = 0;
      let issuesWithTags = 0;
      const perIssue: any[] = [];
      const tagNoteBuckets: Record<string, string[]> = {};
      const errors: string[] = [];

      for (const iss of issues || []) {
        try {
          const ids = await ensureTagsForIssue(supabaseAdmin, iss.id, iss.user_note, iss.issue_type);
          linked += ids.length;
          if (ids.length) issuesWithTags++;
          perIssue.push({
            id: iss.id,
            titles: parseNoteIntoTagTitles(iss.user_note),
            tag_ids: ids,
          });
          if (iss.resolution_note) {
            for (const tid of ids) {
              if (!tagNoteBuckets[tid]) tagNoteBuckets[tid] = [];
              tagNoteBuckets[tid].push(String(iss.resolution_note));
            }
          }
        } catch (e: any) {
          errors.push(`${iss.id}: ${e?.message || e}`);
        }
      }

      // Attach progress notes to tags once (dedupe identical blobs)
      let notesMoved = 0;
      for (const [tid, notes] of Object.entries(tagNoteBuckets)) {
        const unique = Array.from(new Set(notes.map((n) => n.trim()).filter(Boolean)));
        if (!unique.length) continue;
        const { data: tag } = await supabaseAdmin
          .from('issue_tags')
          .select('id, resolution_note')
          .eq('id', tid)
          .single();
        if (!tag) continue;
        if (tag.resolution_note && String(tag.resolution_note).trim()) continue;
        const best = unique.sort((a, b) => b.length - a.length)[0];
        await supabaseAdmin.from('issue_tags').update({ resolution_note: best }).eq('id', tid);
        notesMoved++;
      }

      // Clear per-log resolution notes so progress lives on tags
      await supabaseAdmin
        .from('issue_backlog')
        .update({ resolution_note: null })
        .not('resolution_note', 'is', null);

      const { count: tagCount } = await supabaseAdmin
        .from('issue_tags')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'to_fix');

      res.json({
        success: true,
        issues_scanned: (issues || []).length,
        issues_with_tags: issuesWithTags,
        links_created_or_seen: linked,
        tag_notes_seeded: notesMoved,
        open_tags: tagCount ?? null,
        per_issue: perIssue,
        errors: errors.length ? errors : undefined,
      });
    } catch (err: any) {
      console.error('[rebuild-from-notes]', err);
      res.status(500).json({
        error: err?.message || 'rebuild failed — run issue_tags SQL migration first',
        hint: 'Supabase SQL: create issue_tags + issue_tag_links (+ ever_tagged on issue_backlog).',
      });
    }
  });
}

// K5 checks
function backlogExtras() {
  // domain_summary
  // r2_shots
}
