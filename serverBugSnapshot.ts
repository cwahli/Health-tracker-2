/**
 * Initiative K — Bug snapshot packs on R2 + brief API + triage digest.
 * Mount: registerBugSnapshotRoutes(app, { callUnifiedLLM, getS3Client, ... })
 */

import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import {
  bugTagR2Prefix,
  bugReportR2Prefix,
  bugShotKey,
  bugManifestKey,
  bugMetaKey,
  bugIdentifiedProblemsKey,
  cleanBugLogText,
  budgetPayloadForDigest,
  buildBugTriageSystemPrompt,
  buildBugTriageUserPrompt,
  briefFromTag,
  parseDataUrl,
  BUG_SNAPSHOT_MAX_SHOTS,
  BUG_SNAPSHOT_LOG,
  BUG_TRIAGE_LOG,
  AGENT_STRUCTURE_DEFAULT,
  TIER1_MAX_SHOTS,
  type BugSnapshotManifest,
} from './src/utils/bugSnapshot.js';
import { domainPackForAgent, buildOverviewMarkdown } from './src/utils/bugDomainPacks.js';
import { stripHeavyImages } from './src/utils/debugPayload.js';
import { normalizeTagKey } from './serverIssueBacklog.js';

export type BugSnapshotDeps = {
  callUnifiedLLM?: (args: any) => Promise<any>;
  getS3Client?: () => any;
  bucketName?: string;
  publicUrlBase?: string;
  addDebugLog?: (msg: string, sessionId?: string) => void;
};

async function putR2Object(
  deps: BugSnapshotDeps,
  key: string,
  body: Buffer | string,
  contentType: string
): Promise<{ key: string; url: string; ok: boolean }> {
  const base = (deps.publicUrlBase || process.env.CLOUDFLARE_R2_PUBLIC_URL || '').replace(/\/$/, '');
  const url = base ? `${base}/${key}` : `r2://${key}`;
  const client = deps.getS3Client?.();
  const bucket = deps.bucketName || process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
  if (!client) {
    console.warn(`${BUG_SNAPSHOT_LOG} R2 client missing; returning synthetic url key=${key}`);
    return { key, url, ok: false };
  }
  try {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buf,
        ContentType: contentType,
      })
    );
    return { key, url, ok: true };
  } catch (err: any) {
    console.error(`${BUG_SNAPSHOT_LOG} put failed key=${key}`, err?.message || err);
    return { key, url, ok: false };
  }
}

async function getR2ObjectText(deps: BugSnapshotDeps, key: string): Promise<string | null> {
  const client = deps.getS3Client?.();
  const bucket = deps.bucketName || process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
  if (!client) return null;
  try {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const stream = res.Body as any;
    if (stream && typeof stream.transformToString === 'function') {
      return await stream.transformToString();
    }
    if (stream && typeof stream.transformToByteArray === 'function') {
      const bytes = await stream.transformToByteArray();
      return Buffer.from(bytes).toString('utf8');
    }
    return null;
  } catch {
    return null;
  }
}

/** Binary-safe variant for images — transformToString() corrupts JPEG/PNG bytes. */
async function getR2ObjectBuffer(deps: BugSnapshotDeps, key: string): Promise<Buffer | null> {
  const client = deps.getS3Client?.();
  const bucket = deps.bucketName || process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
  if (!client) return null;
  try {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const stream = res.Body as any;
    if (stream && typeof stream.transformToByteArray === 'function') {
      const bytes = await stream.transformToByteArray();
      return Buffer.from(bytes);
    }
    if (stream && typeof stream.on === 'function') {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return Buffer.concat(chunks);
    }
    return null;
  } catch {
    return null;
  }
}

function contentTypeForArtifact(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.json')) return 'application/json';
  return 'text/plain';
}

async function deleteR2Object(deps: BugSnapshotDeps, key: string): Promise<boolean> {
  const client = deps.getS3Client?.();
  const bucket = deps.bucketName || process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
  if (!client) return false;
  try {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Read identified_problems with column fallback into comments marker. */
function readIdentifiedProblems(tag: any): string {
  if (tag?.identified_problems && String(tag.identified_problems).trim()) {
    return String(tag.identified_problems);
  }
  const comments = Array.isArray(tag?.comments) ? tag.comments : [];
  const marker = comments.find((c: any) => c?.kind === 'identified_problems');
  return marker?.body ? String(marker.body) : '';
}

async function writeIdentifiedProblems(
  supabaseAdmin: any,
  tagId: string,
  text: string,
  existing: any
): Promise<{ ok: boolean; via: string; tag?: any }> {
  const trimmed = String(text || '').trim().slice(0, 50_000);
  // Prefer real column
  const { data, error } = await supabaseAdmin
    .from('issue_tags')
    .update({ identified_problems: trimmed })
    .eq('id', tagId)
    .select('*')
    .maybeSingle();
  if (!error && data) {
    return { ok: true, via: 'column', tag: data };
  }
  // Fallback: special comment entry
  const comments = Array.isArray(existing?.comments) ? [...existing.comments] : [];
  const without = comments.filter((c: any) => c?.kind !== 'identified_problems');
  without.push({
    id: crypto.randomUUID(),
    kind: 'identified_problems',
    body: trimmed,
    created_at: new Date().toISOString(),
  });
  const { data: data2, error: err2 } = await supabaseAdmin
    .from('issue_tags')
    .update({ comments: without })
    .eq('id', tagId)
    .select('*')
    .maybeSingle();
  if (err2) return { ok: false, via: 'failed' };
  return { ok: true, via: 'comments_fallback', tag: data2 };
}

/** In-memory durable triage job status (survives until process restart; instance pack stays on R2). */
export type BugTriageJobState = {
  id: string;
  tagId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  modelId: string;
  reportId?: string;
  error?: string;
  identified_problems?: string;
  system_instruction?: string;
  prompt_text?: string;
  createdAt: string;
  updatedAt: string;
  ms?: number;
};

const triageJobs = new Map<string, BugTriageJobState>();

export function registerBugSnapshotRoutes(app: Express, deps: BugSnapshotDeps = {}) {
  const log = deps.addDebugLog || ((m: string) => console.log(m));

  async function executeTriageForTag(
    tagId: string,
    modelId: string,
    reportIds: string[] = [],
    jobId?: string
  ): Promise<{
    ok: boolean;
    identified_problems?: string;
    system_instruction?: string;
    prompt_text?: string;
    error?: string;
    ms?: number;
    via?: string;
    reports_used?: string[];
    preserved?: string;
  }> {
    const started = Date.now();
    const mark = (patch: Partial<BugTriageJobState>) => {
      if (!jobId) return;
      const cur = triageJobs.get(jobId);
      if (!cur) return;
      triageJobs.set(jobId, { ...cur, ...patch, updatedAt: new Date().toISOString() });
    };
    mark({ status: 'running' });

    if (!deps.callUnifiedLLM) {
      mark({ status: 'failed', error: 'callUnifiedLLM not wired' });
      return { ok: false, error: 'callUnifiedLLM not wired' };
    }

    const { supabaseAdmin } = await import('./supabaseAdmin.js');
    let { data: tag, error } = await supabaseAdmin.from('issue_tags').select('*').eq('id', tagId).maybeSingle();
    if (error || !tag) {
      mark({ status: 'failed', error: error?.message || 'tag not found' });
      return { ok: false, error: error?.message || 'tag not found' };
    }

    const cat = tag.category || 'foodcart';
    const prior = readIdentifiedProblems(tag);
    const { data: linkRows } = await supabaseAdmin
      .from('issue_tag_links')
      .select('issue_id')
      .eq('tag_id', tagId);
    const issueIds = (linkRows || []).map((l: any) => l.issue_id);
    if (!issueIds.length) {
      mark({ status: 'failed', error: 'No reports linked' });
      return { ok: false, error: 'No reports linked to this bug', preserved: prior };
    }

    const { data: issues } = await supabaseAdmin
      .from('issue_backlog')
      .select('id, user_note, payload, created_at')
      .in('id', issueIds)
      .order('created_at', { ascending: false })
      .limit(5);

    let selected = issues || [];
    if (reportIds.length) {
      selected = selected.filter(
        (i: any) => reportIds.includes(i.id) || reportIds.includes(i.payload?.reportId)
      );
      if (!selected.length) selected = (issues || []).slice(0, 2);
    } else {
      selected = selected.slice(0, 2);
    }

    let logs = '';
    let payloadJson = '';
    let domainPackJson = '';
    let domJson = '';
    let a11yText = '';
    let networkJson = '';
    let overviewMd = '';
    let nutritionTableMd = '';
    let debugJobJson = '';
    let env: any = null;
    let userSymptom = '';
    const usedReportIds: string[] = [];

    for (const iss of selected) {
      usedReportIds.push(iss.id);
      if (iss.user_note) userSymptom += (userSymptom ? '\n' : '') + iss.user_note;
      const p = iss.payload || {};
      env = env || p.env || null;
      if (p.dom) domJson = JSON.stringify(p.dom);
      if (p.a11y?.textOutline) a11yText = p.a11y.textOutline;
      if (p.domain_pack) domainPackJson = domainPackForAgent(p.domain_pack);
      if (p.network) networkJson = JSON.stringify(p.network);
      if (p.nutrition_table_md) nutritionTableMd = p.nutrition_table_md;
      if (p.debug_payload || p.debug_job) {
        debugJobJson = JSON.stringify(stripHeavyImages(p.debug_payload || p.debug_job), null, 2);
      }
      const rid = p.reportId;
      if (rid) {
        const prefix = bugReportR2Prefix(cat, tagId, rid);
        for (const a11yName of ['accessibility_tree.txt', 'a11y_tree.txt']) {
          const a11yR2 = await getR2ObjectText(deps, `${prefix}/${a11yName}`);
          if (a11yR2) {
            a11yText = a11yR2;
            break;
          }
        }
        const dpR2 = await getR2ObjectText(deps, `${prefix}/domain_pack.json`);
        if (dpR2) {
          try {
            domainPackJson = domainPackForAgent(JSON.parse(dpR2));
          } catch {
            domainPackJson = dpR2.slice(0, 10_000);
          }
        }
        const ovR2 = await getR2ObjectText(deps, `${prefix}/overview.md`);
        if (ovR2) overviewMd = ovR2;
        const fromR2 = await getR2ObjectText(deps, `${prefix}/console.logs.txt`) || await getR2ObjectText(deps, `${prefix}/logs.txt`);
        if (fromR2) logs += (logs ? '\n---\n' : '') + fromR2;
        const netR2 = await getR2ObjectText(deps, `${prefix}/network.recent.json`);
        if (netR2) networkJson = netR2;
        if (!domainPackJson) {
          const payR2 = await getR2ObjectText(deps, `${prefix}/payload.json`);
          if (payR2) payloadJson += (payloadJson ? '\n' : '') + budgetPayloadForDigest(payR2);
        }
        // Probe nutrition table markdown & debug job JSON from R2
        if (!nutritionTableMd) {
          const r2Files = Array.isArray(p.r2_files) ? p.r2_files : [];
          for (const f of r2Files) {
            if (f.name?.endsWith('.md') && f.name !== 'overview.md' && f.name !== 'identified_problems.md') {
              const md = await getR2ObjectText(deps, f.key || `${prefix}/${f.name}`);
              if (md) {
                nutritionTableMd = md;
                break;
              }
            }
          }
        }
        if (!debugJobJson) {
          const r2Files = Array.isArray(p.r2_files) ? p.r2_files : [];
          for (const f of r2Files) {
            if (f.name?.startsWith('debug-') && f.name?.endsWith('.json')) {
              const dbg = await getR2ObjectText(deps, f.key || `${prefix}/${f.name}`);
              if (dbg) {
                debugJobJson = dbg;
                break;
              }
            }
          }
        }
        if (!nutritionTableMd && (p.nutrition_table_md || (p as any).nutritionTableMd)) {
          nutritionTableMd = String(p.nutrition_table_md || (p as any).nutritionTableMd);
        }
        if (!debugJobJson && (p.debug_payload || p.debug_job)) {
          try {
            debugJobJson = JSON.stringify(p.debug_payload || p.debug_job, null, 2);
          } catch {
            /* ignore */
          }
        }
      }
      if (!domainPackJson && !payloadJson && p) {
        payloadJson += (payloadJson ? '\n' : '') + budgetPayloadForDigest(p);
      }
      if (!logs && (p.debugLogText || p.backendLogs)) {
        logs += cleanBugLogText(String(p.debugLogText || p.backendLogs || ''), 12000);
      }
    }

    const shotTotal = selected.reduce((n: number, i: any) => n + (i.payload?.shot_count || 0), 0);
    const system = buildBugTriageSystemPrompt();
    const user = buildBugTriageUserPrompt({
      tagTitle: tag.title,
      category: cat,
      userSymptom,
      priorIdentified: prior,
      stillOpen: tag.whats_still_open || '',
      env,
      logs,
      payloadJson,
      domainPackJson,
      domJson: a11yText ? undefined : domJson,
      a11yText,
      networkJson,
      overviewMd,
      nutritionTableMd,
      debugJson: debugJobJson,
      shotCount: Math.min(shotTotal, TIER1_MAX_SHOTS),
      reportIds: usedReportIds,
    });

    log(
      `${BUG_TRIAGE_LOG} model=${modelId} structure=${AGENT_STRUCTURE_DEFAULT} a11y=${a11yText ? 'yes' : 'no'} domain_pack=${domainPackJson ? 'yes' : 'no'} tag=${tagId} job=${jobId || 'sync'}`
    );

    let textOut = '';
    try {
      const result = await deps.callUnifiedLLM({
        modelId,
        systemInstruction: system,
        promptText: user,
        skipThinking: true,
        maxOutputTokens: 4096,
      });
      if (typeof result === 'string') textOut = result;
      else if (result?.text) textOut = result.text;
      else if (result?.response?.text) textOut = result.response.text;
      else if (typeof result?.candidates?.[0]?.content?.parts?.[0]?.text === 'string') {
        textOut = result.candidates[0].content.parts.map((p: any) => p.text || '').join('');
      } else textOut = String(result ?? '').slice(0, 8000);
    } catch (llmErr: any) {
      const msg = llmErr?.message || String(llmErr);
      log(`${BUG_TRIAGE_LOG} LLM failed: ${msg}`);
      mark({ status: 'failed', error: msg });
      return { ok: false, error: msg, preserved: prior, ms: Date.now() - started };
    }

    textOut = String(textOut || '').trim();
    if (!textOut) {
      mark({ status: 'failed', error: 'empty triage result' });
      return { ok: false, error: 'empty triage result', preserved: prior, ms: Date.now() - started };
    }

    const written = await writeIdentifiedProblems(supabaseAdmin, tagId, textOut, tag);
    if (!written.ok) {
      mark({ status: 'failed', error: 'failed to save identified_problems' });
      return { ok: false, error: 'failed to save identified_problems', ms: Date.now() - started };
    }

    // summary.md + identified_problems.md (Tier-2 default)
    await putR2Object(deps, bugIdentifiedProblemsKey(cat, tagId), textOut, 'text/markdown');
    await putR2Object(
      deps,
      `${bugTagR2Prefix(cat, tagId)}/summary.md`,
      textOut,
      'text/markdown'
    );
    await putR2Object(
      deps,
      bugMetaKey(cat, tagId),
      JSON.stringify(
        {
          tagId,
          title: tag.title,
          category: cat,
          identified_problems: textOut,
          whats_still_open: tag.whats_still_open || '',
          updated_at: new Date().toISOString(),
          triage_model: modelId,
          r2_prefix: bugTagR2Prefix(cat, tagId),
          summary_path: `${bugTagR2Prefix(cat, tagId)}/summary.md`,
        },
        null,
        2
      ),
      'application/json'
    );

    const ms = Date.now() - started;
    mark({
      status: 'succeeded',
      identified_problems: textOut,
      system_instruction: system,
      prompt_text: user,
      ms,
    });
    log(`${BUG_TRIAGE_LOG} model=${modelId} ok via=${written.via} ms=${ms}`);
    return {
      ok: true,
      identified_problems: textOut,
      via: written.via,
      ms,
      reports_used: usedReportIds,
      system_instruction: system,
      prompt_text: user,
    };
  }

  /**
   * POST /api/bugs/snapshot
   * Body: { category, tag_id?, new_bug_title?, user_symptom?, shots: dataUrl[],
   *         payload?, logs?, dom?, env?, firebase_uid?, dish_query?, chain_key? }
   */
  app.post('/api/bugs/snapshot', async (req: Request, res: Response) => {
    try {
      const {
        category = 'foodcart',
        tag_id,
        new_bug_title,
        user_symptom,
        shots = [],
        payload,
        logs,
        dom,
        env,
        firebase_uid,
        dish_query,
        chain_key,
        sessionId,
        domain_pack: domainPackBody,
        a11y: a11yBody,
        network: networkBody,
      } = req.body || {};

      const shotList = Array.isArray(shots) ? shots.slice(0, BUG_SNAPSHOT_MAX_SHOTS) : [];
      if (shotList.length === 0 && !payload && !logs && !domainPackBody && !a11yBody) {
        return res.status(400).json({
          error: 'Provide at least one screenshot, a11y, domain pack, payload, or logs',
        });
      }

      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      const cat = String(category || 'foodcart');
      let tagId = tag_id && tag_id !== 'new_bug' ? String(tag_id) : null;
      let tagTitle = new_bug_title ? String(new_bug_title).trim() : null;

      if (!tagId && tagTitle) {
        const title_key = normalizeTagKey(tagTitle) || tagTitle.toLowerCase().slice(0, 160);
        const { data: existingTag } = await supabaseAdmin
          .from('issue_tags')
          .select('id, title')
          .eq('title_key', title_key)
          .maybeSingle();
        if (existingTag?.id) {
          tagId = existingTag.id;
          tagTitle = existingTag.title;
        } else {
          const { data: created, error: cErr } = await supabaseAdmin
            .from('issue_tags')
            .insert({
              title: tagTitle.slice(0, 200),
              title_key,
              category: cat,
              status: 'to_fix',
              comments: [],
            })
            .select('id, title')
            .single();
          if (cErr || !created) {
            return res.status(500).json({ error: cErr?.message || 'failed to create bug tag' });
          }
          tagId = created.id;
        }
      }

      if (!tagId) {
        return res.status(400).json({ error: 'tag_id or new_bug_title required' });
      }

      const reportId = crypto.randomUUID();
      const symptom = user_symptom != null ? String(user_symptom).trim() : '';
      const safePayload = stripHeavyImages(payload && typeof payload === 'object' ? payload : {});
      const logText = cleanBugLogText(String(logs || ''), 180_000);
      const domObj = dom && typeof dom === 'object' ? dom : null;
      const a11yObj = a11yBody && typeof a11yBody === 'object' ? a11yBody : req.body?.a11y_tree || null;
      const domainPack =
        domainPackBody && typeof domainPackBody === 'object' ? domainPackBody : safePayload?.domain_pack || null;
      const networkObj = Array.isArray(networkBody) ? networkBody : req.body?.network || null;

      // Insert issue_backlog report
      const row = {
        status: 'to_fix',
        issue_type: 'general_bug',
        severity: 'medium',
        country_code: null,
        chain_key: chain_key || null,
        dish_query:
          dish_query ||
          domainPack?.summaryLine ||
          `snapshot ${new Date().toISOString().slice(0, 16)}`,
        context: 'bug_snapshot',
        source_url: null,
        user_note: symptom || null,
        firebase_uid: firebase_uid || null,
        payload: {
          ...safePayload,
          bug_snapshot: true,
          reportId,
          tagId,
          category: cat,
          env: env || null,
          dom: domObj,
          a11y: a11yObj
            ? {
                textOutline: a11yObj.textOutline || null,
                landmarks: a11yObj.landmarks || null,
                headings: a11yObj.headings || null,
                // tree kept for cold storage; agents use textOutline first
                hasTree: !!(a11yObj.tree || a11yObj),
              }
            : null,
          domain_pack: domainPack,
          network: networkObj,
          structure_default: AGENT_STRUCTURE_DEFAULT,
          r2_prefix: bugReportR2Prefix(cat, tagId, reportId),
          shot_count: shotList.length,
          serverMeta: { receivedAt: new Date().toISOString(), sessionId: sessionId || null },
        },
        ever_tagged: true,
      };

      let issue: { id: string; created_at?: string } | null = null;
      {
        const ins = await supabaseAdmin
          .from('issue_backlog')
          .insert(row)
          .select('id, created_at')
          .single();
        if (ins.error && /ever_tagged/i.test(String(ins.error.message || ''))) {
          const { ever_tagged: _, ...row2 } = row as any;
          const r2 = await supabaseAdmin.from('issue_backlog').insert(row2).select('id, created_at').single();
          if (r2.error || !r2.data) {
            return res.status(500).json({ error: r2.error?.message || ins.error.message });
          }
          issue = r2.data;
        } else if (ins.error || !ins.data) {
          return res.status(500).json({ error: ins.error?.message || 'insert report failed' });
        } else {
          issue = ins.data;
        }
      }

      const issueId = issue!.id;

      await supabaseAdmin
        .from('issue_tag_links')
        .upsert({ tag_id: tagId, issue_id: issueId }, { onConflict: 'tag_id,issue_id' });

      // Upload artifacts to R2
      const shotMeta: BugSnapshotManifest['shots'] = [];
      const files: BugSnapshotManifest['files'] = [];

      for (let i = 0; i < shotList.length; i++) {
        const dataUrl = String(shotList[i] || '');
        const parsed = parseDataUrl(dataUrl);
        if (!parsed) continue;
        const ext = parsed.contentType.includes('png') ? 'png' : 'jpg';
        const key = bugShotKey(cat, tagId, reportId, i + 1, ext);
        const body = Buffer.from(parsed.base64, 'base64');
        const up = await putR2Object(deps, key, body, parsed.contentType);
        shotMeta.push({ key, bytes: body.length, contentType: parsed.contentType });
        if (!up.ok) log(`${BUG_SNAPSHOT_LOG} shot upload soft-fail key=${key}`);
      }

      // 1. Debug payload (e.g. debug-job_....json)
      const debugPayload =
        req.body?.debug_payload ||
        req.body?.debugPayload ||
        safePayload?.debug_payload ||
        safePayload?.debug_job ||
        null;
      if (debugPayload) {
        const debugJobId = String(debugPayload.jobId || reportId).replace(/[^a-zA-Z0-9_\-]/g, '_');
        const dbgKey = `${bugReportR2Prefix(cat, tagId, reportId)}/debug-${debugJobId}.json`;
        await putR2Object(deps, dbgKey, JSON.stringify(stripHeavyImages(debugPayload), null, 2), 'application/json');
        files.push({ name: `debug-${debugJobId}.json`, key: dbgKey });
      }

      // 2. Nutrition calculation table (e.g. 01_00 - <meal_name>.md / nutrition_table.md)
      const nutritionTableMd =
        req.body?.nutrition_table_md ||
        req.body?.nutritionTableMd ||
        safePayload?.nutrition_table_md ||
        null;
      const mealFileName = req.body?.meal_file_name || safePayload?.meal_file_name || 'nutrition_table.md';
      if (nutritionTableMd) {
        const cleanName = mealFileName.endsWith('.md') ? mealFileName : `${mealFileName}.md`;
        const mdKey = `${bugReportR2Prefix(cat, tagId, reportId)}/${cleanName}`;
        await putR2Object(deps, mdKey, String(nutritionTableMd), 'text/markdown');
        files.push({ name: cleanName, key: mdKey });
      }

      if (Object.keys(safePayload || {}).length > 0) {
        const key = `${bugReportR2Prefix(cat, tagId, reportId)}/payload.json`;
        const body = JSON.stringify(safePayload, null, 2);
        await putR2Object(deps, key, body, 'application/json');
        files.push({ name: 'payload.json', key });
      }
      if (logText) {
        const cKey = `${bugReportR2Prefix(cat, tagId, reportId)}/console.logs.txt`;
        await putR2Object(deps, cKey, logText, 'text/plain');
        files.push({ name: 'console.logs.txt', key: cKey });
      }
      if (domObj) {
        const key = `${bugReportR2Prefix(cat, tagId, reportId)}/dom.simplified.json`;
        await putR2Object(deps, key, JSON.stringify(domObj, null, 2), 'application/json');
        files.push({ name: 'dom.simplified.json', key });
      }
      if (a11yObj) {
        const outline =
          a11yObj.textOutline ||
          (typeof a11yObj === 'string' ? a11yObj : JSON.stringify(a11yObj).slice(0, 12_000));
        if (outline) {
          const txtKey = `${bugReportR2Prefix(cat, tagId, reportId)}/accessibility_tree.txt`;
          await putR2Object(deps, txtKey, String(outline), 'text/plain');
          files.push({ name: 'accessibility_tree.txt', key: txtKey });
        }
      }
      if (domainPack) {
        const dpKey = `${bugReportR2Prefix(cat, tagId, reportId)}/domain_pack.json`;
        await putR2Object(deps, dpKey, JSON.stringify(domainPack, null, 2), 'application/json');
        files.push({ name: 'domain_pack.json', key: dpKey });
      }
      if (networkObj && Array.isArray(networkObj) && networkObj.length > 0) {
        const netKey = `${bugReportR2Prefix(cat, tagId, reportId)}/network.recent.json`;
        await putR2Object(deps, netKey, JSON.stringify(networkObj, null, 2), 'application/json');
        files.push({ name: 'network.recent.json', key: netKey });
      }
      // overview.md — a11y-first checklist for all agents
      {
        const netFails = Array.isArray(networkObj)
          ? networkObj.filter((n: any) => n.error || (n.status && n.status >= 400)).length
          : 0;
        const overview = buildOverviewMarkdown({
          category: cat,
          tagId,
          reportId,
          userSymptom: symptom,
          env,
          domainPack,
          a11yOutline: a11yObj?.textOutline || '',
          shotCount: shotList.length,
          networkFailCount: netFails,
          hasLogs: !!logText,
        });
        const oKey = `${bugReportR2Prefix(cat, tagId, reportId)}/overview.md`;
        await putR2Object(deps, oKey, overview, 'text/markdown');
        files.push({ name: 'overview.md', key: oKey });
      }
      if (env) {
        const envKey = `${bugReportR2Prefix(cat, tagId, reportId)}/env.json`;
        await putR2Object(deps, envKey, JSON.stringify(env, null, 2), 'application/json');
        files.push({ name: 'env.json', key: envKey });
      }
      if (symptom) {
        const key = `${bugReportR2Prefix(cat, tagId, reportId)}/note.txt`;
        await putR2Object(deps, key, symptom, 'text/plain');
        files.push({ name: 'note.txt', key });
      }

      const manifest: BugSnapshotManifest = {
        version: 1,
        reportId,
        tagId,
        category: cat,
        createdAt: new Date().toISOString(),
        userSymptom: symptom || undefined,
        env: env || undefined,
        shots: shotMeta,
        files,
      };
      const mKey = bugManifestKey(cat, tagId, reportId);
      await putR2Object(deps, mKey, JSON.stringify(manifest, null, 2), 'application/json');
      files.push({ name: 'manifest.json', key: mKey });

      // Tag meta snapshot (brief pointers)
      const { data: tagRow } = await supabaseAdmin.from('issue_tags').select('*').eq('id', tagId).maybeSingle();
      const meta = {
        tagId,
        title: tagRow?.title || tagTitle,
        category: cat,
        identified_problems: readIdentifiedProblems(tagRow),
        whats_still_open: tagRow?.whats_still_open || '',
        updated_at: new Date().toISOString(),
        last_report_id: reportId,
        r2_prefix: bugTagR2Prefix(cat, tagId),
      };
      await putR2Object(deps, bugMetaKey(cat, tagId), JSON.stringify(meta, null, 2), 'application/json');

      // Patch issue payload with R2 keys
      try {
        await supabaseAdmin
          .from('issue_backlog')
          .update({
            payload: {
              ...(row.payload as any),
              r2_manifest_key: mKey,
              r2_shots: shotMeta,
              r2_files: files,
            },
          })
          .eq('id', issueId);
      } catch {
        /* ignore */
      }

      if (symptom && tagRow) {
        const prev = Array.isArray(tagRow.comments) ? [...tagRow.comments] : [];
        prev.push({
          id: crypto.randomUUID(),
          body: `[snapshot] ${symptom.slice(0, 500)}`,
          created_at: new Date().toISOString(),
        });
        await supabaseAdmin.from('issue_tags').update({ comments: prev }).eq('id', tagId);
      }

      // Archive older instances: mark previous linked reports; keep last 3 active
      try {
        const { data: linkRows } = await supabaseAdmin
          .from('issue_tag_links')
          .select('issue_id')
          .eq('tag_id', tagId);
        const otherIds = (linkRows || []).map((l: any) => l.issue_id).filter((id: string) => id !== issueId);
        if (otherIds.length) {
          const { data: others } = await supabaseAdmin
            .from('issue_backlog')
            .select('id, payload, created_at')
            .in('id', otherIds)
            .order('created_at', { ascending: false });
          const list = others || [];
          // First previous → archive pointer file
          for (let i = 0; i < list.length; i++) {
            const o = list[i];
            const p = o.payload || {};
            const archivedAt = new Date().toISOString();
            const nextPayload = {
              ...p,
              archived: true,
              archived_at: p.archived_at || archivedAt,
            };
            await supabaseAdmin.from('issue_backlog').update({ payload: nextPayload }).eq('id', o.id);
            if (i >= 3 && p.reportId) {
              // Cap: prune R2 for very old instances (beyond 3 previous)
              const keys: string[] = [];
              if (Array.isArray(p.r2_shots)) for (const s of p.r2_shots) if (s?.key) keys.push(s.key);
              if (Array.isArray(p.r2_files)) for (const f of p.r2_files) if (f?.key) keys.push(f.key);
              for (const k of keys) await deleteR2Object(deps, k);
              await supabaseAdmin
                .from('issue_backlog')
                .update({
                  payload: {
                    ...nextPayload,
                    obsolete: true,
                    pruned_at: archivedAt,
                    r2_shots: [],
                    r2_files: [],
                  },
                })
                .eq('id', o.id);
            } else if (p.reportId) {
              const noteKey = `${bugTagR2Prefix(cat, tagId)}/archive/${archivedAt.slice(0, 19).replace(/[:.]/g, '-')}/${p.reportId}/ARCHIVED.txt`;
              await putR2Object(
                deps,
                noteKey,
                `Archived when new instance ${reportId} was created.\nOriginal prefix: ${p.r2_prefix || ''}\n`,
                'text/plain'
              );
            }
          }
        }
      } catch (archErr: any) {
        log(`${BUG_SNAPSHOT_LOG} archive soft-fail: ${archErr?.message || archErr}`);
      }

      log(`${BUG_SNAPSHOT_LOG} saved report=${issueId} tag=${tagId} shots=${shotMeta.length}`);

      // Optional auto-triage job (client may also call /triage)
      let triage_job_id: string | null = null;
      const autoTriage = req.body?.auto_triage === true || req.body?.auto_triage === '1';
      if (autoTriage && deps.callUnifiedLLM) {
        const modelId = String(req.body?.modelId || req.body?.model || 'gemini-3.5-flash-lite');
        triage_job_id = `triage_${tagId}_${Date.now()}`;
        triageJobs.set(triage_job_id, {
          id: triage_job_id,
          tagId,
          status: 'queued',
          modelId,
          reportId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        // Fire-and-forget; instance already durable
        setImmediate(() => {
          executeTriageForTag(tagId, modelId, [issueId], triage_job_id!).catch((e) => {
            log(`${BUG_TRIAGE_LOG} auto job failed: ${e?.message || e}`);
          });
        });
      }

      res.json({
        success: true,
        id: issueId,
        reportId,
        tag_id: tagId,
        r2_prefix: bugReportR2Prefix(cat, tagId, reportId),
        shots: shotMeta.length,
        files: files.map((f) => f.name),
        structure_default: AGENT_STRUCTURE_DEFAULT,
        domain: domainPack?.domain || null,
        capture_checklist: {
          a11y: !!a11yObj,
          domain_pack: !!domainPack,
          shots: shotMeta.length,
          logs: !!logText,
          network: Array.isArray(networkObj) ? networkObj.length : 0,
        },
        triage_job_id,
      });
    } catch (err: any) {
      console.error(`${BUG_SNAPSHOT_LOG} exception`, err);
      res.status(500).json({ error: err?.message || 'snapshot failed' });
    }
  });

  /** GET /api/bugs/triage-jobs/:jobId — durable triage status for placeholder/retry UI */
  app.get('/api/bugs/triage-jobs/:jobId', (req: Request, res: Response) => {
    const job = triageJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'job not found (may have restarted server)' });
    res.json({ job });
  });

  /** GET /api/bugs/:tagId/triage-jobs — recent jobs for a tag */
  app.get('/api/bugs/:tagId/triage-jobs', (req: Request, res: Response) => {
    const tagId = req.params.tagId;
    const jobs = [...triageJobs.values()]
      .filter((j) => j.tagId === tagId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10);
    res.json({ jobs });
  });

  /** GET /api/bugs/open — brief-only list for coding agents */
  app.get('/api/bugs/open', async (_req: Request, res: Response) => {
    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      let tags: any[] | null = null;
      const r1 = await supabaseAdmin
        .from('issue_tags')
        .select(
          'id, created_at, title, title_key, category, status, resolution_note, whats_still_open, identified_problems, comments, resolved_at'
        )
        .eq('status', 'to_fix')
        .order('created_at', { ascending: false })
        .limit(100);
      tags = r1.data;
      let error = r1.error;

      if (error && /identified_problems/i.test(String(error.message || ''))) {
        const r2 = await supabaseAdmin
          .from('issue_tags')
          .select(
            'id, created_at, title, title_key, category, status, resolution_note, whats_still_open, comments, resolved_at'
          )
          .eq('status', 'to_fix')
          .order('created_at', { ascending: false })
          .limit(100);
        tags = r2.data;
        error = r2.error;
      }
      if (error) return res.status(500).json({ error: error.message });

      const tagIds = (tags || []).map((t: any) => t.id);
      let links: any[] = [];
      if (tagIds.length) {
        const { data: linkRows } = await supabaseAdmin
          .from('issue_tag_links')
          .select('tag_id, issue_id')
          .in('tag_id', tagIds);
        links = linkRows || [];
      }

      const bugs = (tags || []).map((t: any) => {
        const linked = links.filter((l) => l.tag_id === t.id).length;
        return briefFromTag({
          ...t,
          identified_problems: readIdentifiedProblems(t),
          linked_count: linked,
        });
      });

      res.json({
        bugs,
        count: bugs.length,
        note: 'Brief only. Use GET /api/bugs/:tagId/artifacts for deep fetch.',
        generated_at: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'bugs open failed' });
    }
  });

  /** GET /api/bugs/:tagId — one brief + report manifests (no full payloads) */
  app.get('/api/bugs/:tagId', async (req: Request, res: Response) => {
    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      const tagId = req.params.tagId;
      let { data: tag, error } = await supabaseAdmin
        .from('issue_tags')
        .select('*')
        .eq('id', tagId)
        .maybeSingle();
      if (error && /identified_problems/i.test(String(error.message || ''))) {
        const r2 = await supabaseAdmin.from('issue_tags').select('*').eq('id', tagId).maybeSingle();
        tag = r2.data;
        error = r2.error;
      }
      if (error || !tag) return res.status(404).json({ error: error?.message || 'not found' });

      const { data: linkRows } = await supabaseAdmin
        .from('issue_tag_links')
        .select('issue_id')
        .eq('tag_id', tagId);
      const issueIds = (linkRows || []).map((l: any) => l.issue_id);
      let reports: any[] = [];
      if (issueIds.length) {
        const { data: issues } = await supabaseAdmin
          .from('issue_backlog')
          .select('id, created_at, status, dish_query, user_note, context, payload')
          .in('id', issueIds)
          .order('created_at', { ascending: false });
        reports = (issues || []).map((i: any) => ({
          id: i.id,
          created_at: i.created_at,
          status: i.status,
          dish_query: i.dish_query,
          user_note: i.user_note,
          context: i.context,
          reportId: i.payload?.reportId || null,
          r2_prefix: i.payload?.r2_prefix || null,
          r2_manifest_key: i.payload?.r2_manifest_key || null,
          shot_count: i.payload?.shot_count ?? i.payload?.r2_shots?.length ?? 0,
          obsolete: i.payload?.obsolete === true,
        }));
      }

      res.json({
        bug: briefFromTag({
          ...tag,
          identified_problems: readIdentifiedProblems(tag),
          linked_count: reports.length,
        }),
        reports,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'bug get failed' });
    }
  });

  /**
   * GET /api/bugs/:tagId/artifacts?reportId=&name=
   * name: manifest.json | logs.txt | payload.json | dom.simplified.json | note.txt | shot-01.jpg
   */
  app.get('/api/bugs/:tagId/artifacts', async (req: Request, res: Response) => {
    try {
      const tagId = req.params.tagId;
      const reportId = String(req.query.reportId || '');
      const name = String(req.query.name || 'manifest.json');
      if (!reportId) return res.status(400).json({ error: 'reportId required' });

      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      const { data: tag } = await supabaseAdmin
        .from('issue_tags')
        .select('id, category')
        .eq('id', tagId)
        .maybeSingle();
      if (!tag) return res.status(404).json({ error: 'tag not found' });
      const cat = tag.category || 'foodcart';

      let key = `${bugReportR2Prefix(cat, tagId, reportId)}/${name.replace(/\.\./g, '')}`;
      // Allow full key if provided
      if (String(req.query.key || '').startsWith('bugs/')) {
        key = String(req.query.key);
      }

      const isImage = /\.(jpg|jpeg|png)$/i.test(name) || /\.(jpg|jpeg|png)$/i.test(key);
      if (isImage) {
        const buf = await getR2ObjectBuffer(deps, key);
        if (!buf) return res.status(404).json({ error: 'artifact not found or R2 unavailable', key });
        res.set('Cache-Control', 'private, max-age=3600');
        return res.type(contentTypeForArtifact(name)).send(buf);
      }

      const text = await getR2ObjectText(deps, key);
      if (text == null) {
        return res.status(404).json({ error: 'artifact not found or R2 unavailable', key });
      }
      if (name.endsWith('.json') || key.endsWith('.json')) {
        try {
          return res.json({ key, data: JSON.parse(text) });
        } catch {
          return res.json({ key, text });
        }
      }
      res.type('text/plain').send(text);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'artifact failed' });
    }
  });

  /** POST /api/bugs/:tagId/triage — digest agent → identified_problems (+ summary.md) */
  app.post('/api/bugs/:tagId/triage', async (req: Request, res: Response) => {
    try {
      const tagId = req.params.tagId;
      const modelId = String(req.body?.modelId || req.body?.model || 'gemini-3.5-flash-lite');
      const reportIds: string[] = Array.isArray(req.body?.reportIds) ? req.body.reportIds : [];
      const asyncMode = req.body?.async === true || req.body?.async === '1';

      const jobId = `triage_${tagId}_${Date.now()}`;
      triageJobs.set(jobId, {
        id: jobId,
        tagId,
        status: 'queued',
        modelId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      if (asyncMode) {
        setImmediate(() => {
          executeTriageForTag(tagId, modelId, reportIds, jobId).catch((e) => {
            log(`${BUG_TRIAGE_LOG} async failed: ${e?.message || e}`);
          });
        });
        return res.json({
          success: true,
          async: true,
          triage_job_id: jobId,
          status: 'queued',
          message: 'Triage started; poll GET /api/bugs/triage-jobs/:jobId',
        });
      }

      const result = await executeTriageForTag(tagId, modelId, reportIds, jobId);
      if (!result.ok) {
        return res.status(500).json({
          error: result.error || 'triage failed',
          preserved_identified_problems: result.preserved,
          triage_job_id: jobId,
        });
      }
      res.json({
        success: true,
        tag_id: tagId,
        modelId,
        via: result.via,
        identified_problems: result.identified_problems,
        system_instruction: result.system_instruction,
        prompt_text: result.prompt_text,
        ms: result.ms,
        reports_used: result.reports_used,
        triage_job_id: jobId,
        summary_path: `bugs/.../summary.md`,
      });
    } catch (err: any) {
      console.error(`${BUG_TRIAGE_LOG} exception`, err);
      res.status(500).json({ error: err?.message || 'triage failed' });
    }
  });

  /** POST /api/bugs/:tagId/reports/:issueId/prune — mark obsolete + delete R2 keys */
  app.post('/api/bugs/:tagId/reports/:issueId/prune', async (req: Request, res: Response) => {
    try {
      const { tagId, issueId } = req.params;
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      const { data: issue, error } = await supabaseAdmin
        .from('issue_backlog')
        .select('id, payload')
        .eq('id', issueId)
        .maybeSingle();
      if (error || !issue) return res.status(404).json({ error: error?.message || 'report not found' });

      const { data: tag } = await supabaseAdmin
        .from('issue_tags')
        .select('id, category')
        .eq('id', tagId)
        .maybeSingle();
      const cat = tag?.category || 'foodcart';
      const p = issue.payload || {};
      const keys: string[] = [];
      if (Array.isArray(p.r2_shots)) {
        for (const s of p.r2_shots) if (s?.key) keys.push(s.key);
      }
      if (Array.isArray(p.r2_files)) {
        for (const f of p.r2_files) if (f?.key) keys.push(f.key);
      }
      if (p.r2_manifest_key) keys.push(p.r2_manifest_key);
      if (p.reportId) {
        keys.push(bugManifestKey(cat, tagId, p.reportId));
      }

      let deleted = 0;
      for (const k of [...new Set(keys)]) {
        if (await deleteR2Object(deps, k)) deleted++;
      }

      await supabaseAdmin
        .from('issue_backlog')
        .update({
          payload: {
            ...p,
            obsolete: true,
            pruned_at: new Date().toISOString(),
            r2_shots: [],
            r2_files: [],
          },
        })
        .eq('id', issueId);

      log(`${BUG_SNAPSHOT_LOG} pruned issue=${issueId} deleted=${deleted}`);
      res.json({ success: true, deleted, issueId });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'prune failed' });
    }
  });
}
