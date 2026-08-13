/**
 * Golden inbox API. Heavy blobs on R2. Tiny rows in golden_cases.
 * Replay does not call Gemini.
 */
import type { Express, Request, Response } from 'express';
import {
  buildScoreboard,
  evaluateLogOutcomes,
  evaluateMealLines,
  extractMealLines,
  scoreboardSummary,
  type GoldenAttempt,
  type GoldenMealLine,
  type GoldenOutcome,
  type GoldenScoreboard,
} from './src/utils/goldenScoreboard.js';
import { lookupCanonicalBaseFood } from './server_food_db.js';
import { d1Query } from './server_d1.js';

function nowIso() {
  return new Date().toISOString();
}

function mapCaseRow(row: any) {
  if (!row) return row;
  return {
    ...row,
    all_green: row.all_green === 1 || row.all_green === true,
    pass_count: Number(row.pass_count || 0),
    fail_count: Number(row.fail_count || 0),
    iteration: Number(row.iteration || 0),
  };
}

async function gcInsert(fields: { tag_id?: string | null; job_id?: string | null; title: string; r2_prefix: string }) {
  const r = await d1Query<{ id: string }>(
    `INSERT INTO golden_cases (tag_id, job_id, title, status, r2_prefix, updated_at)
     VALUES (?, ?, ?, 'open', ?, ?)
     RETURNING id`,
    [fields.tag_id || null, fields.job_id || null, fields.title, fields.r2_prefix, nowIso()]
  );
  if (!r.success || !r.results[0]?.id) return { error: r.error || 'D1 insert failed', id: null as string | null };
  return { error: null as string | null, id: r.results[0].id };
}

async function gcGet(id: string) {
  const r = await d1Query(`SELECT * FROM golden_cases WHERE id = ? LIMIT 1`, [id]);
  if (!r.success) return { error: r.error, data: null };
  return { error: null as string | null, data: r.results[0] ? mapCaseRow(r.results[0]) : null };
}

async function gcList(status?: string | null) {
  const r = status
    ? await d1Query(
        `SELECT id, tag_id, job_id, title, status, r2_prefix, pass_count, fail_count, iteration, all_green, last_replay_at, created_at, updated_at
         FROM golden_cases WHERE status = ? ORDER BY updated_at DESC LIMIT 50`,
        [status]
      )
    : await d1Query(
        `SELECT id, tag_id, job_id, title, status, r2_prefix, pass_count, fail_count, iteration, all_green, last_replay_at, created_at, updated_at
         FROM golden_cases ORDER BY updated_at DESC LIMIT 50`
      );
  if (!r.success) return { error: r.error, data: [] as any[] };
  return { error: null as string | null, data: r.results.map(mapCaseRow) };
}

async function gcListOpen() {
  const r = await d1Query(
    `SELECT * FROM golden_cases WHERE status IN ('open', 'in_progress') ORDER BY updated_at DESC LIMIT 1`
  );
  if (!r.success) return { error: r.error, data: null };
  return { error: null as string | null, data: r.results[0] ? mapCaseRow(r.results[0]) : null };
}

async function gcUpdate(id: string, patch: Record<string, any>) {
  const cols = Object.keys(patch);
  if (!cols.length) return { error: null as string | null };
  const sets = cols.map((c) => `${c} = ?`).join(', ');
  const vals = cols.map((c) => {
    const v = patch[c];
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
  const r = await d1Query(`UPDATE golden_cases SET ${sets} WHERE id = ?`, [...vals, id]);
  return { error: r.success ? null : r.error };
}

export type GoldenRouteDeps = {
  getS3Client?: () => any;
  bucketName?: string;
  publicUrlBase?: string;
};

function r2Base(deps: GoldenRouteDeps) {
  return (deps.publicUrlBase || process.env.CLOUDFLARE_R2_PUBLIC_URL || '').replace(/\/$/, '');
}

async function putR2(deps: GoldenRouteDeps, key: string, body: string | Buffer, contentType: string) {
  const client = deps.getS3Client?.();
  const bucket = deps.bucketName || process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
  const url = `${r2Base(deps)}/${key}`;
  if (!client) return { key, url, ok: false };
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: payload, ContentType: contentType }));
  return { key, url, ok: true };
}

async function getR2Text(deps: GoldenRouteDeps, key: string): Promise<string | null> {
  const client = deps.getS3Client?.();
  const bucket = deps.bucketName || process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
  if (!client) return null;
  try {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const stream = res.Body as any;
    if (stream?.transformToString) return await stream.transformToString();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(chunks).toString('utf8');
  } catch {
    return null;
  }
}

function casePrefix(id: string) {
  return `golden/${id}`;
}

async function loadBoard(deps: GoldenRouteDeps, id: string): Promise<GoldenScoreboard | null> {
  const raw = await getR2Text(deps, `${casePrefix(id)}/scoreboard.json`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function loadAttempts(deps: GoldenRouteDeps, id: string): Promise<GoldenAttempt[]> {
  const raw = await getR2Text(deps, `${casePrefix(id)}/attempts.json`);
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function replayIdentity(outcomes: GoldenOutcome[]): GoldenOutcome[] {
  return outcomes.map((o) => {
    if (!o.enabled || o.kind !== 'identity' || !o.query || o.expected == null) return o;
    const hit = lookupCanonicalBaseFood(String(o.query));
    const actual = hit?.fdcId != null ? String(hit.fdcId) : null;
    return { ...o, actual, pass: actual === String(o.expected) };
  });
}

export function registerGoldenRoutes(app: Express, deps: GoldenRouteDeps = {}) {
  app.get('/api/golden/health', async (_req: Request, res: Response) => {
    const ping = await d1Query<{ n: number }>(`SELECT COUNT(*) AS n FROM golden_cases`);
    res.status(ping.success ? 200 : 500).json({
      d1: ping.success,
      rows: ping.results?.[0]?.n ?? null,
      error: ping.error || null,
      r2: Boolean(deps.getS3Client?.() && (deps.bucketName || process.env.CLOUDFLARE_R2_BUCKET_NAME)),
    });
  });

  app.post('/api/golden/preview', (req: Request, res: Response) => {
    const board = buildScoreboard({
      logText: req.body?.logText || req.body?.backendLogs || '',
      foodLog: req.body?.foodLog || req.body?.pendingFoodLog,
      extraIssues: req.body?.extraIssues || [],
    });
    res.json(board);
  });

  app.post('/api/golden/cases', async (req: Request, res: Response) => {
    try {
      const jobId = String(req.body?.jobId || req.body?.job_id || '').trim() || null;
      const title = String(req.body?.title || jobId || 'Golden meal').slice(0, 200);
      const tagId = req.body?.tag_id || req.body?.tagId || null;
      const logText = String(req.body?.logText || req.body?.backendLogs || '');
      const scout = req.body?.scout || req.body?.scoutItems || null;
      const foodLog = req.body?.foodLog || req.body?.pendingFoodLog || null;
      const extraIssues: string[] = Array.isArray(req.body?.extraIssues) ? req.body.extraIssues : [];
      const expectedMeal: GoldenMealLine[] | undefined = req.body?.expectedMeal;
      const incomingQuery = String(req.body?.originalQuery || req.body?.query || '').trim();
      const incomingPhotos: string[] = Array.isArray(req.body?.photos) ? req.body.photos : [];

      const board = buildScoreboard({ logText, foodLog, extraIssues });
      if (Array.isArray(expectedMeal) && expectedMeal.length) {
        board.expectedMeal = expectedMeal;
      }
      if (Array.isArray(req.body?.outcomes) && req.body.outcomes.length) {
        board.outcomes = req.body.outcomes;
      }

      const pendingPrefix = `golden/pending-${Date.now()}`;
      const ins = await gcInsert({ tag_id: tagId, job_id: jobId, title, r2_prefix: pendingPrefix });
      if (ins.error || !ins.id) {
        return res.status(500).json({ error: ins.error || 'failed to insert golden_cases on D1' });
      }

      const id = ins.id;
      const prefix = casePrefix(id);
      await gcUpdate(id, { r2_prefix: prefix, updated_at: nowIso() });

      await putR2(deps, `${prefix}/scoreboard.json`, JSON.stringify(board, null, 2), 'application/json');
      if (scout) {
        await putR2(deps, `${prefix}/scout.json`, JSON.stringify(scout, null, 2), 'application/json');
      }
      if (logText) {
        await putR2(deps, `${prefix}/backend.log`, logText.slice(0, 400_000), 'text/plain');
      }

      const storedPhotos: string[] = [];
      for (let i = 0; i < incomingPhotos.slice(0, 8).length; i++) {
        const p = incomingPhotos[i];
        if (typeof p === 'string' && /^https?:\/\//i.test(p)) {
          storedPhotos.push(p);
          continue;
        }
        const m = typeof p === 'string' ? p.match(/^data:image\/([\w+]+);base64,(.+)$/) : null;
        if (!m) continue;
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1].replace('+', '');
        const key = `${prefix}/photos/${i}.${ext}`;
        const up = await putR2(deps, key, Buffer.from(m[2], 'base64'), `image/${m[1]}`);
        storedPhotos.push(up.url);
      }
      const fixture = {
        query: incomingQuery,
        photos: storedPhotos,
        photoUrl: storedPhotos[0] || null,
        jobId,
        capturedAt: new Date().toISOString(),
      };
      await putR2(deps, `${prefix}/fixture.json`, JSON.stringify(fixture, null, 2), 'application/json');
      await putR2(deps, `${prefix}/attempts.json`, '[]', 'application/json');
      await putR2(
        deps,
        `${prefix}/learnings.md`,
        `# ${title}\n\nJob: ${jobId || 'n/a'}\nCreated: ${new Date().toISOString()}\n\n## Attempts\n\n_(none yet)_\n`,
        'text/markdown'
      );

      const first = evaluateLogOutcomes(board.outcomes, logText);
      const meal = evaluateMealLines(board.expectedMeal, extractMealLines(foodLog));
      const ident = replayIdentity(first);
      const sum = scoreboardSummary(ident, meal.misses);
      await gcUpdate(id, {
        pass_count: sum.passCount,
        fail_count: sum.failCount,
        all_green: sum.allGreen,
        last_replay_at: nowIso(),
        updated_at: nowIso(),
      });

      res.json({
        id,
        r2_prefix: prefix,
        ...sum,
        outcomes: ident,
        mealMisses: meal.misses,
        tensions: board.tensions,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'create golden failed' });
    }
  });

  app.get('/api/golden/cases', async (req: Request, res: Response) => {
    try {
      const status = req.query.status ? String(req.query.status) : null;
      const { data, error } = await gcList(status);
      if (error) return res.status(500).json({ error });
      res.json({ cases: data || [] });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'list failed' });
    }
  });

  app.get('/api/golden/cases/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { data, error } = await gcGet(id);
      if (error || !data) return res.status(404).json({ error: error || 'not found' });
      const board = await loadBoard(deps, id);
      const attempts = await loadAttempts(deps, id);
      const learnings = await getR2Text(deps, `${casePrefix(id)}/learnings.md`);
      const fixtureRaw = await getR2Text(deps, `${casePrefix(id)}/fixture.json`);
      let fixture = null;
      try {
        fixture = fixtureRaw ? JSON.parse(fixtureRaw) : null;
      } catch {
        fixture = null;
      }
      res.json({
        ...data,
        board,
        attempts,
        learnings,
        fixture,
        logUrl: `${r2Base(deps)}/${casePrefix(id)}/backend.log`,
        scoutUrl: `${r2Base(deps)}/${casePrefix(id)}/scout.json`,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'get failed' });
    }
  });

  app.get('/api/golden/studio-brief', async (_req: Request, res: Response) => {
    try {
      const { data, error } = await gcListOpen();
      if (error) return res.status(500).json({ error });
      if (!data) return res.json({ empty: true, markdown: 'No open golden cases.' });
      const board = await loadBoard(deps, data.id);
      const attempts = await loadAttempts(deps, data.id);
      const learnings = await getR2Text(deps, `${casePrefix(data.id)}/learnings.md`);
      const fixtureRaw = await getR2Text(deps, `${casePrefix(data.id)}/fixture.json`);
      let fixture: any = null;
      try {
        fixture = fixtureRaw ? JSON.parse(fixtureRaw) : null;
      } catch {
        fixture = null;
      }
      const reds = (board?.outcomes || []).filter((o) => o.enabled && o.pass === false);
      const md = [
        `# Studio brief — ${data.title}`,
        '',
        `Case: ${data.id}`,
        `Job: ${data.job_id || 'n/a'}`,
        `Iteration: ${data.iteration}`,
        `Score: ${data.pass_count} pass / ${data.fail_count} fail`,
        '',
        '## Original user input (already captured — do not ask them to re-upload)',
        `Query: ${fixture?.query ? JSON.stringify(fixture.query) : '(empty prompt — photo-only)'}`,
        `Photos: ${(fixture?.photos || []).length}`,
        ...((fixture?.photos || []).map((u: string, i: number) => `- photo ${i + 1}: ${u}`)),
        `Scout JSON: ${r2Base(deps)}/${casePrefix(data.id)}/scout.json`,
        `Backend log: ${r2Base(deps)}/${casePrefix(data.id)}/backend.log`,
        '',
        '## Rules',
        '- Do NOT change expected meal numbers or delete outcome rows.',
        '- Do NOT claim COMPLETE. Replay decides pass/fail.',
        '- Read Attempts / Learnings before changing code. Do not retry a failed approach.',
        '- After edits: POST /api/golden/cases/' + data.id + '/attempt then POST .../replay.',
        '- Full live re-test (optional): POST analyze with the photos + query above. Then POST replay with the new log + foodLog.',
        '',
        '## Red outcomes',
        reds.length ? reds.map((o) => `- [${o.kind}] ${o.label} (expected ${o.expected}, actual ${o.actual ?? 'null'})`).join('\n') : '- (none marked fail — check meal lines)',
        '',
        '## Expected meal (user-locked lines only)',
        ...(board?.expectedMeal || [])
          .filter((l) => l.scored)
          .map((l) => `- ${l.name}: ${l.weightGrams ?? '?'}g / ${l.calories ?? '—'} kcal`),
        '',
        '## Last attempts (do not repeat)',
        ...(attempts.slice(-8).map((a) => `- #${a.n} ${a.tried} → learned: ${a.learned}`)),
        '',
        '## Learnings',
        learnings || '(none)',
      ].join('\n');
      res.type('text/markdown').send(md);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'brief failed' });
    }
  });

  app.post('/api/golden/cases/:id/replay', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { data, error } = await gcGet(id);
      if (error || !data) return res.status(404).json({ error: error || 'not found' });
      const board = await loadBoard(deps, id);
      if (!board) return res.status(404).json({ error: 'scoreboard missing on R2' });

      const freshLog = typeof req.body?.logText === 'string' ? req.body.logText : await getR2Text(deps, `${casePrefix(id)}/backend.log`);
      const freshFood = req.body?.foodLog || null;

      let outcomes = evaluateLogOutcomes(board.outcomes, freshLog || '');
      outcomes = replayIdentity(outcomes);
      const actualLines = freshFood ? extractMealLines(freshFood) : board.observedMeal;
      const meal = evaluateMealLines(board.expectedMeal, actualLines);
      const sum = scoreboardSummary(outcomes, meal.misses);

      board.outcomes = outcomes;
      await putR2(deps, `${casePrefix(id)}/scoreboard.json`, JSON.stringify(board, null, 2), 'application/json');
      if (typeof req.body?.logText === 'string' && req.body.logText) {
        await putR2(deps, `${casePrefix(id)}/backend.log`, req.body.logText.slice(0, 400_000), 'text/plain');
      }

      const status = sum.allGreen ? 'green' : data.status === 'promoted' ? 'promoted' : 'open';
      await gcUpdate(id, {
        pass_count: sum.passCount,
        fail_count: sum.failCount,
        all_green: sum.allGreen,
        status,
        last_replay_at: nowIso(),
        updated_at: nowIso(),
      });

      res.json({ id, ...sum, mealMisses: meal.misses, outcomes, status });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'replay failed' });
    }
  });

  app.post('/api/golden/cases/:id/attempt', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { data, error } = await gcGet(id);
      if (error || !data) return res.status(404).json({ error: error || 'not found' });

      const attempts = await loadAttempts(deps, id);
      const n = attempts.length + 1;
      const row: GoldenAttempt = {
        n,
        at: new Date().toISOString(),
        actor: req.body?.actor === 'human' ? 'human' : 'studio',
        tried: String(req.body?.tried || '').slice(0, 2000),
        learned: String(req.body?.learned || '').slice(0, 2000),
        next: String(req.body?.next || '').slice(0, 2000),
        createdNewIssue: req.body?.createdNewIssue ? String(req.body.createdNewIssue).slice(0, 500) : undefined,
      };
      attempts.push(row);
      await putR2(deps, `${casePrefix(id)}/attempts.json`, JSON.stringify(attempts, null, 2), 'application/json');

      const prev = (await getR2Text(deps, `${casePrefix(id)}/learnings.md`)) || '';
      const block = [
        '',
        `## Attempt ${n} (${row.at})`,
        `- Actor: ${row.actor}`,
        `- Tried: ${row.tried}`,
        `- Learned: ${row.learned}`,
        `- Next: ${row.next}`,
        row.createdNewIssue ? `- Created new issue: ${row.createdNewIssue}` : '',
        n >= 5 && row.createdNewIssue
          ? `- **Do not retry this class of change** — past ${n} iterations already spawned a new bug.`
          : '',
      ]
        .filter(Boolean)
        .join('\n');
      await putR2(deps, `${casePrefix(id)}/learnings.md`, `${prev.trim()}\n${block}\n`, 'text/markdown');

      await gcUpdate(id, {
        iteration: n,
        status: 'in_progress',
        updated_at: nowIso(),
      });

      res.json({ ok: true, attempt: row, iteration: n });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'attempt failed' });
    }
  });

  app.post('/api/golden/cases/:id/promote', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { data } = await gcGet(id);
      if (!data) return res.status(404).json({ error: 'not found' });
      if (!data.all_green) return res.status(409).json({ error: 'Replay is not all-green. Promote is disabled.' });
      await gcUpdate(id, { status: 'promoted', updated_at: nowIso() });
      res.json({ ok: true, status: 'promoted' });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'promote failed' });
    }
  });
}
