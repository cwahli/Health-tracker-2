import { Router } from 'express';
import { verifyFirebaseIdToken } from './server_auth.js';
import { supabaseAdmin } from './supabaseAdmin.js';
import { uploadPhotoToR2 } from './src/utils/r2Storage.js';

export const jobsRouter = Router();

/**
 * Express router for /api/jobs/* operations
 */
jobsRouter.post('/api/jobs/upsert', async (req, res) => {
  const diag4Start = Date.now();
  try {
    const authData = await verifyFirebaseIdToken(req);
    console.log('[FreeTier] requireAuth jobs-upsert');

    const { payload } = req.body;
    if (!payload || !payload.id || !payload.user_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const payloadSize = JSON.stringify(payload).length;
    console.log(`[DIAG4] /api/jobs/upsert starting for job ${payload.id}, payload size ${payloadSize} bytes`);

    const { error } = await supabaseAdmin.from('agent_jobs').upsert(payload, { onConflict: 'id' });

    console.log(`[DIAG4] /api/jobs/upsert supabaseAdmin.upsert finished for job ${payload.id} in ${Date.now() - diag4Start}ms`);

    if (error) {
      console.error('Failed to upsert job to Supabase via server:', error);
      return res.status(500).json({ error: error.message });
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error(`[DIAG4] /api/jobs/upsert failed after ${Date.now() - diag4Start}ms:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

jobsRouter.post('/api/jobs/delete', async (req, res) => {
  const { jobId } = req.body || {};
  if (!jobId) {
    return res.status(400).json({ error: 'jobId is required' });
  }
  // Q-6.6: diary/job delete must not prune R2 debug while a work item holds this job.
  // This route only drops the agent_jobs row — R2 keys stay. Do not add DeleteObject here.
  try {
    await verifyFirebaseIdToken(req).catch(() => null);
    const { deleteInMemoryServerJob } = await import('./serverJobs.js');
    deleteInMemoryServerJob(String(jobId));
  } catch (memErr: any) {
    console.warn('[jobs/delete] in-memory delete skipped:', memErr?.message || memErr);
  }
  try {
    const { supabaseAdmin, isSupabaseConfigured } = await import('./supabaseAdmin.js');
    if (isSupabaseConfigured) {
      const { error } = await supabaseAdmin.from('agent_jobs').delete().eq('id', String(jobId));
      if (error) console.warn('[jobs/delete] supabase:', error.message);
    }
  } catch (dbErr: any) {
    console.warn('[jobs/delete] supabase skipped:', dbErr?.message || dbErr);
  }
  res.json({ success: true });
});

jobsRouter.post('/api/jobs/submit', async (req, res) => {
  try {
    const { jobId, userId, kind, mode, text, history, userProfile, engine, biomarkersNeedingImprovement, remainingAllowance, activeMeal, foodLogs, userSelectedMode, activeScoutItems } = req.body;
    let { images, imageUrls } = req.body;
    if (!jobId) {
      return res.status(400).json({ error: 'jobId is required' });
    }

    if (images && Array.isArray(images) && images.length > 0) {
      imageUrls = Array.isArray(imageUrls) ? [...imageUrls] : [];
      for (let i = 0; i < images.length; i++) {
        if (typeof images[i] === 'string' && images[i].startsWith('data:image/')) {
          console.log(`[POST /api/jobs/submit] Uploading image ${i} to R2 for job ${jobId}...`);
          try {
            const r2Url = await uploadPhotoToR2(`${jobId}_${i}`, images[i]);
            if (r2Url && r2Url.startsWith('http')) {
              imageUrls.push(r2Url);
            } else {
              imageUrls.push(images[i]);
            }
          } catch (e) {
            console.error(`[POST /api/jobs/submit] Failed to upload image ${i} to R2`, e);
            imageUrls.push(images[i]);
          }
        }
      }
    }

    const { checkOrRegisterIdempotentSubmission, submitServerJob } = await import('./serverJobs.js');

    const idempResult = await checkOrRegisterIdempotentSubmission({
      ...req.body,
      jobId,
      userId: userId || 'anonymous',
      kind,
      mode,
      text,
      images,
      imageUrls
    });

    if (idempResult.isDuplicate) {
      return res.json({
        success: true,
        jobId: idempResult.jobId,
        status: idempResult.status || 'queued',
        duplicatePrevented: true,
        message: 'Duplicate submission blocked by idempotency lock; reusing existing job.'
      });
    }

    await submitServerJob({
      ...req.body,
      jobId,
      userId: userId || 'anonymous',
    });
    res.json({ success: true, jobId, status: 'queued' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to submit job to cloud' });
  }
});

jobsRouter.get('/api/jobs/status', async (req, res) => {
  try {
    const { jobId, userId } = req.query;
    const { getInMemoryServerJob, listInMemoryServerJobs } = await import('./serverJobs.js');

    if (jobId) {
      let memJob = getInMemoryServerJob(String(jobId));
      if (memJob) {
        if (req.query.full === 'true' && memJob.clean_result && (memJob.clean_result as any).is_r2) {
          try {
            const { fetchJobResultFromR2 } = await import('./src/utils/r2Storage.js');
            const fullResult = await fetchJobResultFromR2(String(jobId));
            if (fullResult) {
              memJob = { ...memJob, clean_result: fullResult };
            }
          } catch (e) {
            console.error(`[JobsStatus] Failed to transparently fetch R2 clean_result for memJob ${jobId}:`, e);
          }
        }
        return res.json({ jobs: [memJob] });
      }
    }

    const { isSupabaseConfigured } = await import('./src/utils/supabaseClient.js');
    if (!isSupabaseConfigured) {
      if (jobId) {
        const memJob = getInMemoryServerJob(String(jobId));
        return res.json({ jobs: memJob ? [memJob] : [] });
      }
      return res.json({ jobs: listInMemoryServerJobs(userId ? String(userId) : undefined) });
    }

    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      const isFull = req.query.full === 'true';
      const columns = isFull ? '*' : 'id, status, progress_percent, status_message, updated_at';
      let query = supabaseAdmin.from('agent_jobs').select(columns);
      if (jobId) {
        query = query.eq('id', String(jobId));
      } else if (userId) {
        query = query.eq('user_id', String(userId));
      } else {
        return res.status(400).json({ error: 'jobId or userId parameter is required' });
      }
      query = query.order('updated_at', { ascending: false }).limit(20);

      const queryPromise = Promise.resolve(query);
      const timeoutPromise = new Promise<{ data: any; error: any }>((_, reject) =>
        setTimeout(() => reject(new Error('Supabase query timed out after 3500ms')), 3500)
      );
      const { data, error } = await Promise.race([queryPromise, timeoutPromise]);
      if (error) throw error;

      if (data && data.length > 0) {
        const now = Date.now();
        const staleThresholdMs = 300000; // was 180000 (3 min); large multi-item edits can legitimately take longer
        const processedJobs = await Promise.all((data || []).map(async (job: any) => {
          if (job.clean_result && typeof job.clean_result === 'object' && (job.clean_result as any).is_r2) {
            try {
              const { fetchJobResultFromR2 } = await import('./src/utils/r2Storage.js');
              const r2Promise = fetchJobResultFromR2(job.id);
              const r2Timeout = new Promise<null>((resolve) =>
                setTimeout(() => resolve(null), 5000)
              );
              const fullResult = await Promise.race([r2Promise, r2Timeout]);
              if (fullResult) {
                job.clean_result = fullResult;
              }
            } catch (r2FetchErr) {
              console.error(`[JobsStatus] Failed to transparently fetch R2 clean_result for ${job.id}:`, r2FetchErr);
            }
          }

          if (job.status === 'running' && job.updated_at) {
            const updatedAtTime = new Date(job.updated_at).getTime();
            if (now - updatedAtTime > staleThresholdMs) {
              console.warn(`[JobsStatus] Auto-failing stale running job ${job.id} (updated ${Math.round((now - updatedAtTime) / 1000)}s ago)`);
              const failedJob = {
                ...job,
                status: 'failed',
                status_message: 'Analysis timed out on server (>3 min). Tap Retry to try again.',
                updated_at: new Date().toISOString()
              };
              Promise.resolve(
                supabaseAdmin.from('agent_jobs').update({
                  status: 'failed',
                  status_message: 'Analysis timed out on server (>3 min). Tap Retry to try again.',
                  updated_at: new Date().toISOString()
                }).eq('id', job.id)
              ).catch((uErr: any) => {
                console.error('[JobsStatus] Failed to update stale job status in DB:', uErr);
              });
              return failedJob;
            }
          }
          return job;
        }));

        return res.json({ jobs: processedJobs });
      }
    } catch (dbErr) {
      console.warn('[JobsStatus] Supabase query failed or timed out, falling back to in-memory store:', dbErr);
    }

    if (jobId) {
      const memJob = getInMemoryServerJob(String(jobId));
      return res.json({ jobs: memJob ? [memJob] : [] });
    }
    return res.json({ jobs: listInMemoryServerJobs(userId ? String(userId) : undefined) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch job status' });
  }
});

jobsRouter.all('/api/jobs/debug', async (req, res) => {
  try {
    const jobId = req.body?.jobId || req.query.jobId;
    const userId = req.body?.userId || req.query.userId;
    const format = req.body?.format || req.query.format;
    const clientSessionEvents = Array.isArray(req.body?.clientSessionEvents) ? req.body.clientSessionEvents : [];
    const clientConsoleLogs = Array.isArray(req.body?.clientConsoleLogs) ? req.body.clientConsoleLogs : [];
    const networkErrors = Array.isArray(req.body?.networkErrors) ? req.body.networkErrors : [];
    const userActionBreadcrumbs = Array.isArray(req.body?.userActionBreadcrumbs) ? req.body.userActionBreadcrumbs : [];
    const lastUserAction = req.body?.lastUserAction;

    if (!jobId) {
      return res.status(400).json({ error: 'jobId parameter is required' });
    }

    const cleanJobId = String(jobId).trim();
    const rawJobId = cleanJobId.replace(/^clarify_/, '');
    const { getInMemoryServerJob } = await import('./serverJobs.js');
    let job: any = getInMemoryServerJob(cleanJobId) || getInMemoryServerJob(rawJobId);

    if (!job) {
      const { isSupabaseConfigured } = await import('./src/utils/supabaseClient.js');
      if (isSupabaseConfigured) {
        try {
          const { supabaseAdmin } = await import('./supabaseAdmin.js');
          let query = supabaseAdmin
            .from('agent_jobs')
            .select('*')
            .in('id', [cleanJobId, rawJobId]);
          if (userId && String(userId) !== 'anonymous') {
            query = query.eq('user_id', String(userId));
          }
          const { data, error } = await query.maybeSingle();
          if (!error && data) {
            job = data;
          }
        } catch (dbErr) {
          console.warn('[JobsDebug] Supabase lookup error:', dbErr);
        }
      }
    }

    let debugPayload = null;
    const { fetchDebugPayloadFromR2, fetchLogsFromR2 } = await import('./src/utils/r2Storage.js');

    try {
      debugPayload = await fetchDebugPayloadFromR2(cleanJobId, userId ? String(userId) : undefined);
    } catch (r2Err) {
      console.warn('[JobsDebug] R2 direct debug payload fetch failed:', r2Err);
    }

    if (!debugPayload && job?.debug_url) {
      try {
        const response = await fetch(job.debug_url);
        if (response.ok) {
          debugPayload = await response.json();
        }
      } catch (err) {
        console.warn('Failed to fetch from debug_url, using DB fallback:', err);
      }
    }

    if (!debugPayload) {
      if (!job) {
        if (format === 'markdown' || format === 'md') {
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="debug-${cleanJobId}.md"`);
          return res.send(`# Diagnostic Log: ${cleanJobId}\n\n- **Status**: Local/Offline entry\n- **Details**: No server execution trace found in remote storage for ID \`${cleanJobId}\`.\n- **Generated At**: ${new Date().toISOString()}\n`);
        }
        return res.status(404).json({ error: 'Job or debug payload not found', jobId: cleanJobId });
      }
      const accumulated = Array.isArray(job.accumulatedLogs) ? job.accumulatedLogs.join('\n') : (Array.isArray(job.turn1Logs) ? job.turn1Logs.join('\n') : '');
      debugPayload = {
        jobId: job.id,
        userId: job.user_id,
        kind: job.kind,
        mode: job.mode,
        status: job.status,
        photoUrl: job.photo_url,
        debugUrl: job.debug_url,
        result: job.clean_result,
        sessionEvents: job.clean_result?.sessionEvents || (job as any).sessionEvents,
        lastUserAction: job.clean_result?.lastUserAction || (job as any).lastUserAction,
        userActionBreadcrumbs: job.clean_result?.userActionBreadcrumbs || (job as any).userActionBreadcrumbs,
        clientConsoleLogs: job.clean_result?.clientConsoleLogs || (job as any).clientConsoleLogs,
        networkErrors: job.clean_result?.networkErrors || (job as any).networkErrors,
        conversationHistory: job.clean_result?.conversationHistory || (job as any).conversationHistory,
        backendLogsUrl: job.clean_result?.backendLogsUrl || undefined,
        backendLogs: job.clean_result?.backendLogs || accumulated || '',
        createdAt: job.created_at,
        updatedAt: job.updated_at,
        source: 'server-job'
      };
    }

    if (!debugPayload.backendLogs || String(debugPayload.backendLogs).startsWith('[Logs stored in R2') || String(debugPayload.backendLogs).startsWith('http')) {
      try {
        const logsFromR2 = await fetchLogsFromR2(cleanJobId);
        if (logsFromR2) {
          debugPayload.backendLogs = logsFromR2;
        }
      } catch (logFetchErr) {
        console.warn(`[JobsDebug] Failed to fetch full logs from R2 for ${cleanJobId}:`, logFetchErr);
      }
    }

    if ((!debugPayload.backendLogs || String(debugPayload.backendLogs).startsWith('[Logs stored in R2')) && job && Array.isArray(job.accumulatedLogs)) {
      debugPayload.backendLogs = job.accumulatedLogs.join('\n');
    }

    // Merge server session events with client session events
    const serverSessionEvents = Array.isArray(debugPayload.sessionEvents)
      ? debugPayload.sessionEvents
      : (Array.isArray(debugPayload.result?.sessionEvents) ? debugPayload.result.sessionEvents : []);
    const rawMergedEvents = [...serverSessionEvents, ...clientSessionEvents];
    const seenEventKeys = new Set<string>();
    const uniqueSessionEvents: any[] = [];
    rawMergedEvents.sort((a, b) => (new Date(a.ts || 0).getTime()) - (new Date(b.ts || 0).getTime()));
    for (const ev of rawMergedEvents) {
      const key = `${ev.ts}_${ev.writer}_${ev.action}_${ev.status}`;
      if (!seenEventKeys.has(key)) {
        seenEventKeys.add(key);
        uniqueSessionEvents.push(ev);
      }
    }

    // Merge console logs, network errors, breadcrumbs
    const serverConsoleLogs = Array.isArray(debugPayload.clientConsoleLogs)
      ? debugPayload.clientConsoleLogs
      : (Array.isArray(debugPayload.result?.clientConsoleLogs) ? debugPayload.result.clientConsoleLogs : []);
    const mergedConsoleLogs = Array.from(new Set([...serverConsoleLogs, ...clientConsoleLogs]));

    const serverNetworkErrors = Array.isArray(debugPayload.networkErrors)
      ? debugPayload.networkErrors
      : (Array.isArray(debugPayload.result?.networkErrors) ? debugPayload.result.networkErrors : []);
    const mergedNetworkErrors = Array.from(new Set([...serverNetworkErrors, ...networkErrors]));

    const serverBreadcrumbs = Array.isArray(debugPayload.userActionBreadcrumbs)
      ? debugPayload.userActionBreadcrumbs
      : (Array.isArray(debugPayload.result?.userActionBreadcrumbs) ? debugPayload.result.userActionBreadcrumbs : []);
    const mergedBreadcrumbs = [...serverBreadcrumbs, ...userActionBreadcrumbs];

    const effectiveLastUserAction = lastUserAction || debugPayload.lastUserAction || debugPayload.result?.lastUserAction;

    const { stripHeavyImages, buildDebugMarkdownReport } = await import('./src/utils/debugPayload.js');
    const safePayload = stripHeavyImages(debugPayload);

    if (format === 'markdown' || format === 'md') {
      const mdReport = buildDebugMarkdownReport({
        jobId: cleanJobId,
        status: safePayload.status,
        mode: safePayload.mode,
        agentType: safePayload.result?.agentType || safePayload.inputSnapshot?.agentType,
        message: safePayload.result?.message || safePayload.result?.text,
        backendLogs: safePayload.backendLogs,
        pendingFoodLog: safePayload.result?.pendingFoodLog || null,
        scoutItems: safePayload.result?.scoutItems,
        scoutInternalReasoning: safePayload.result?.scoutInternalReasoning || safePayload.result?.scoutReasoning || safePayload.result?.internalReasoning,
        rawScout: safePayload.result?.rawScout || safePayload.result?.scoutResult,
        scoutContentType: safePayload.result?.scoutContentType || safePayload.result?.visionScoutContentType,
        diningEnvironment: safePayload.result?.diningEnvironment || safePayload.result?.pendingFoodLog?.diningEnvironment,
        receiptTable: safePayload.result?.receiptTable || safePayload.result?.pendingFoodLog?.receiptTable,
        error: safePayload.error,
        debugUrl: safePayload.debugUrl,
        photoUrl: safePayload.photoUrl,
        lastUserAction: effectiveLastUserAction,
        sessionEvents: uniqueSessionEvents,
        userActionBreadcrumbs: mergedBreadcrumbs,
        clientConsoleLogs: mergedConsoleLogs,
        networkErrors: mergedNetworkErrors,
        usdaSearchResults: safePayload.result?.usdaSearchResults,
        brandSearchResults: safePayload.result?.brandSearchResults,
        comprehensiveNutrients: safePayload.result?.comprehensiveNutrients || safePayload.result?.pendingFoodLog?.nutrients,
        stageLedger: safePayload.result?.stageLedger,
        historyLog: safePayload.result?.historyLog,
        ingestTrace: safePayload.result?.ingestTrace,
        report: safePayload.result?.report,
        conversationHistory: safePayload.conversationHistory || safePayload.result?.conversationHistory
      });
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="debug-${cleanJobId}.md"`);
      return res.send(mdReport);
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="debug-${cleanJobId}.json"`);
    return res.json({
      ...safePayload,
      sessionEvents: uniqueSessionEvents,
      clientConsoleLogs: mergedConsoleLogs,
      networkErrors: mergedNetworkErrors,
      userActionBreadcrumbs: mergedBreadcrumbs,
      lastUserAction: effectiveLastUserAction
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch debug payload' });
  }
});

jobsRouter.post(['/api/jobs/prune-debug-logs', '/api/debug-logs/prune'], async (req, res) => {
  try {
    const { userId, maxRetention } = req.body || {};
    const effectiveRetention = typeof maxRetention === 'number' && maxRetention > 0 ? maxRetention : 10;
    const { pruneUserDebugLogs } = await import('./src/utils/debugLogRetention.js');

    if (userId) {
      const result = await pruneUserDebugLogs(String(userId), { maxRetention: effectiveRetention });
      return res.json(result);
    }

    // If no specific userId, query distinct firebase_uids or current authenticated user
    const { supabaseAdmin } = await import('./supabaseAdmin.js');
    const { data: foods } = await supabaseAdmin.from('food_logs').select('firebase_uid');
    const uids = Array.from(new Set((foods || []).map((f: any) => f.firebase_uid).filter(Boolean)));

    let totalPruned = 0;
    let totalKept = 0;
    let totalProtected = 0;
    const userResults: Record<string, any> = {};

    for (const uid of uids) {
      const resForUser = await pruneUserDebugLogs(uid, { maxRetention: effectiveRetention });
      totalPruned += resForUser.prunedCount;
      totalKept += resForUser.keptCount;
      totalProtected += resForUser.bugProtectedCount;
      userResults[uid] = resForUser;
    }

    return res.json({
      success: true,
      maxRetention: effectiveRetention,
      usersCount: uids.length,
      totalPruned,
      totalKept,
      totalProtected,
      userResults,
    });
  } catch (err: any) {
    console.error('[API] /api/debug-logs/prune error:', err);
    res.status(500).json({ error: err?.message || 'Failed to prune debug logs' });
  }
});

jobsRouter.get('/api/debug-logs/protected-refs', async (_req, res) => {
  try {
    const { getBugTrackerProtectedRefs } = await import('./src/utils/debugLogRetention.js');
    const { supabaseAdmin } = await import('./supabaseAdmin.js');
    const refs = await getBugTrackerProtectedRefs(supabaseAdmin);
    return res.json({ refs: Array.from(refs) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to get protected refs' });
  }
});

// READ-ONLY DIAGNOSTIC — inspects the per-user in-flight job lock plus in-memory and
// Supabase job state for a given uid. Added to investigate a bug where jobs across
// unrelated features (e.g. biomarker "Start" and food logging) appear to queue behind
// each other and get stuck for several minutes. Defaults to the cwah uid so it can be
// hit directly from a mobile browser with no params. Does not mutate any state.
jobsRouter.get('/api/debug/job-lock-check', async (req, res) => {
  try {
    const uid = String(req.query.uid || 'hiJun2hTdDTk2igwerun2LKvwb42');

    const {
      activeUserJobLocks,
      recentSubmissionsMap,
      listInMemoryServerJobs,
    } = await import('./serverJobs.js');

    const lock = activeUserJobLocks.get(uid) || null;
    const lockAgeMs = lock ? Date.now() - lock.timestamp : null;

    const memJobs = listInMemoryServerJobs(uid).map((j: any) => ({
      id: j.id,
      kind: j.kind,
      mode: j.mode,
      status: j.status,
      status_message: j.status_message,
      progress_percent: j.progress_percent,
      updated_at: j.updated_at,
      ageMsSinceUpdate: j.updated_at ? Date.now() - new Date(j.updated_at).getTime() : null,
    }));

    const recentSubmissions: any[] = [];
    for (const [key, entry] of recentSubmissionsMap.entries()) {
      if (key.startsWith(uid + ':') || entry.jobId?.includes(uid)) {
        recentSubmissions.push({ key, ...entry, ageMsSinceSubmit: Date.now() - entry.timestamp });
      }
    }

    let supabaseJobs: any[] = [];
    let supabaseError: string | null = null;
    try {
      const { supabaseAdmin, isSupabaseConfigured } = await import('./supabaseAdmin.js');
      if (isSupabaseConfigured) {
        const { data, error } = await supabaseAdmin
          .from('agent_jobs')
          .select('id, kind, mode, status, status_message, progress_percent, updated_at')
          .eq('user_id', uid)
          .order('updated_at', { ascending: false })
          .limit(10);
        if (error) supabaseError = error.message;
        supabaseJobs = data || [];
      }
    } catch (sbErr: any) {
      supabaseError = sbErr?.message || String(sbErr);
    }

    res.json({
      queriedUid: uid,
      lock: lock ? { jobId: lock.jobId, ageMs: lockAgeMs, ageSeconds: Math.round((lockAgeMs || 0) / 1000) } : null,
      inMemoryJobsForUser: memJobs,
      recentSubmissionsForUser: recentSubmissions,
      supabase: { rows: supabaseJobs, error: supabaseError },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err), stack: err?.stack });
  }
});


