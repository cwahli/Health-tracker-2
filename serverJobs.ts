import { uploadPhotoToR2, uploadDebugPayloadToR2 } from './src/utils/r2Storage';
import { supabase, isSupabaseConfigured } from './src/utils/supabaseClient';
import { supabaseAdmin } from './supabaseAdmin';

export interface ServerJobPayload {
  jobId: string;
  idempotencyKey?: string;
  userId?: string;
  kind: string;
  mode: string;
  text?: string;
  images?: string[]; // base64 or data URLs
  imageUrls?: string[];
  history?: any[];
  userProfile?: any;
  engine?: string;
  biomarkersNeedingImprovement?: any[];
  remainingAllowance?: any;
  activeMeal?: any;
  foodLogs?: any[];
  userSelectedMode?: string;
  activeScoutItems?: any[];
  portionChoices?: any;
  skipScout?: boolean;
  scoutContentType?: 'ambiguous' | 'branded_single' | 'whole_food' | 'recipe';
  resolvedDbCandidates?: any[];
  priorLogsUrl?: string;
  photoUrl?: string;
  requestId?: string;
  clientConsoleLogs?: string[];
  networkErrors?: string[];
  userActionBreadcrumbs?: any[];
  lastUserAction?: any;
}

export const inMemoryServerJobs = new Map<string, any>();
export const recentSubmissionsMap = new Map<string, { jobId: string; timestamp: number; status: string }>();

// Clean up old idempotency entries periodically (> 60s)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of recentSubmissionsMap.entries()) {
      if (now - entry.timestamp > 60000) {
        recentSubmissionsMap.delete(key);
      }
    }
  }, 30000);
}

export async function checkOrRegisterIdempotentSubmission(payload: ServerJobPayload): Promise<{ isDuplicate: boolean; jobId: string; status?: string }> {
  const userId = payload.userId || 'anonymous';
  const rawText = (payload.text || '').trim().toLowerCase();
  const imgCount = (payload.images?.length || 0) + (payload.imageUrls?.length || 0);
  const modeKey = payload.userSelectedMode || payload.mode || 'review';

  // Explicit idempotencyKey or content fingerprint key (12s window)
  const key = payload.idempotencyKey || `${userId}:${rawText}:${imgCount}:${modeKey}:${Math.floor(Date.now() / 12000)}`;

  const existing = recentSubmissionsMap.get(key);
  if (existing && (Date.now() - existing.timestamp < 12000)) {
    const memJob = inMemoryServerJobs.get(existing.jobId);
    const currentStatus = memJob?.status || existing.status || 'queued';
    console.log(`[ServerJobs Idempotency] Blocked duplicate submission key="${key}". Reusing active jobId="${existing.jobId}" (status="${currentStatus}")`);
    return { isDuplicate: true, jobId: existing.jobId, status: currentStatus };
  }

  recentSubmissionsMap.set(key, {
    jobId: payload.jobId,
    timestamp: Date.now(),
    status: 'queued'
  });

  return { isDuplicate: false, jobId: payload.jobId };
}

export function getInMemoryServerJob(jobId: string) {
  return inMemoryServerJobs.get(jobId) || null;
}

export function listInMemoryServerJobs(userId?: string) {
  const jobs = Array.from(inMemoryServerJobs.values());
  if (userId) {
    return jobs.filter(j => j.user_id === userId);
  }
  return jobs;
}

export function deleteInMemoryServerJob(jobId: string) {
  inMemoryServerJobs.delete(jobId);
}

export async function recoverInterruptedServerJobs(): Promise<number> {
  console.log('[ServerJobs Worker] Checking for interrupted server jobs to recover...');
  let recoveredCount = 0;

  try {
    // 1. Check in-memory running jobs
    for (const [id, job] of inMemoryServerJobs.entries()) {
      if (job.status === 'running' || job.status === 'pending') {
        console.log(`[ServerJobs Worker] Recovering in-memory job ${id}...`);
        job.status_message = 'Resuming analysis after process restart...';
        job.updated_at = new Date().toISOString();
        recoveredCount++;
        // Re-trigger execution
        submitServerJob({
          jobId: id,
          userId: job.user_id,
          kind: job.kind,
          mode: job.mode,
          text: job.inputSnapshot?.message,
          imageUrls: job.photo_url ? [job.photo_url] : [],
        }).catch(e => console.error(`[ServerJobs Worker] Error resuming job ${id}:`, e));
      }
    }

    // 2. Check Supabase running jobs if configured
    if (isSupabaseConfigured) {
      const { data: stuckJobs, error } = await supabaseAdmin
        .from('agent_jobs')
        .select('*')
        .in('status', ['running', 'pending']);

      if (error) {
        console.error('[ServerJobs Worker] Failed to query stuck jobs from Supabase:', error);
      } else if (stuckJobs && stuckJobs.length > 0) {
        for (const dbJob of stuckJobs) {
          if (!inMemoryServerJobs.has(dbJob.id)) {
            console.log(`[ServerJobs Worker] Recovering Supabase job ${dbJob.id}...`);
            inMemoryServerJobs.set(dbJob.id, {
              ...dbJob,
              status: 'running',
              status_message: 'Resuming analysis after process restart...',
              updated_at: new Date().toISOString()
            });
            recoveredCount++;

            submitServerJob({
              jobId: dbJob.id,
              userId: dbJob.user_id,
              kind: dbJob.kind,
              mode: dbJob.mode,
              text: dbJob.input_snapshot?.message || dbJob.clean_result?.text || '',
              imageUrls: dbJob.photo_url ? [dbJob.photo_url] : [],
              activeMeal: dbJob.clean_result?.mealBuild || dbJob.clean_result?.pendingFoodLog
            }).catch(e => console.error(`[ServerJobs Worker] Error resuming Supabase job ${dbJob.id}:`, e));
          }
        }
      }
    }
  } catch (err) {
    console.error('[ServerJobs Worker] Recovery loop encountered error:', err);
  }

  return recoveredCount;
}

export async function submitServerJob(payload: ServerJobPayload): Promise<void> {
  const { jobId, userId = 'anonymous', kind, mode, text, images = [], imageUrls = [] } = payload;
  const dbKind = kind || 'food_log';
  const dbMode = mode || 'review';

  let initialStatusMessage = 'Starting cloud food analysis...';
  if (payload.portionChoices && typeof payload.portionChoices === 'object' && Array.isArray(payload.activeScoutItems)) {
    const parts: string[] = [];
    Object.entries(payload.portionChoices).forEach(([key, value]) => {
      const idx = Number(key);
      const matchedItem = !isNaN(idx) ? payload.activeScoutItems[idx] : payload.activeScoutItems.find((i: any) => i.id === key || i.name === key || i.keyword === key);
      const itemName = matchedItem?.originalName || matchedItem?.name || matchedItem?.keyword || matchedItem?.description || 'Item';
      parts.push(`"${value}g portion" of ${itemName}`);
    });
    if (parts.length > 0) {
      initialStatusMessage = `Adjusting for ${parts.join(', ')}...`;
    } else {
      initialStatusMessage = 'Adjusting portion sizes...';
    }
  }

  // In-memory record for offline / Supabase-unconfigured environments
  const existingMemJob = inMemoryServerJobs.get(jobId);
  const turn1Logs: string[] = (existingMemJob?.turn1Logs && existingMemJob.turn1Logs.length > 0)
    ? existingMemJob.turn1Logs
    : ((existingMemJob?.accumulatedLogs && existingMemJob.accumulatedLogs.length > 0)
      ? existingMemJob.accumulatedLogs
      : []);

  const initialJobRecord = {
    id: jobId,
    user_id: userId,
    kind: dbKind,
    mode: dbMode,
    status: 'running',
    progress_percent: 5,
    status_message: initialStatusMessage,
    turn1Logs,
    accumulatedLogs: turn1Logs,
    photo_url: payload.photoUrl || existingMemJob?.photo_url || (imageUrls && imageUrls[0]) || null,
    updated_at: new Date().toISOString()
  };
  inMemoryServerJobs.set(jobId, initialJobRecord);

  // 1. Initial status write to Supabase (fire-and-forget: must never block the
  // /api/jobs/submit response, or a slow/unreachable Supabase call turns into
  // a platform-level 502 on the outer request instead of a clean in-app error)
  if (isSupabaseConfigured) {
    (async () => {
      try {
        const { turn1Logs, accumulatedLogs, ...dbRecord } = initialJobRecord;
        const { error } = await supabaseAdmin.from('agent_jobs').upsert(dbRecord, { onConflict: 'id' });
        if (error) {
          console.error('[ServerJobs] initial upsert failed:', error);
        }
      } catch (e: any) {
        console.error('[ServerJobs] initial upsert threw:', e);
      }
    })();
  }

  // 2. Asynchronous cloud execution (fire & forget on server process)
  setImmediate(async () => {
    let lastProgressUpdate = 0;
    const progressThrottleMs = 1500;
    let accumulatedLogs: string[] = turn1Logs.length > 0
      ? [...turn1Logs, '\n--- USER CONFIRMED PORTION SIZES (TURN 2) ---\n']
      : [];
    let photoUrl = imageUrls[0] || payload.photoUrl || existingMemJob?.photo_url || '';
    let currentProgress = 5;
    let currentStatusMessage = 'Starting cloud food analysis...';
    let finalData: any = null;
    let persistSucceeded: ((finalPayload: any) => Promise<void>) | null = null;

    const updateSupabaseProgress = async (progress: number, message: string) => {
      currentProgress = progress;
      currentStatusMessage = message;
      const memJob = inMemoryServerJobs.get(jobId);
      if (memJob) {
        memJob.progress_percent = progress;
        memJob.status_message = message;
        memJob.photo_url = photoUrl || null;
        memJob.updated_at = new Date().toISOString();
      }
      const now = Date.now();
      if (now - lastProgressUpdate > progressThrottleMs) {
        lastProgressUpdate = now;
        if (isSupabaseConfigured) {
          try {
            await supabaseAdmin.from('agent_jobs').update({
              progress_percent: progress,
              status_message: message,
              photo_url: photoUrl || null,
              updated_at: new Date().toISOString()
            }).eq('id', jobId);
          } catch (e) {
            console.error('[ServerJobs] Failed to update progress:', e);
          }
        }
      }
    };

    try {
      // Step A: Upload photos to Cloudflare R2
      if (!photoUrl && images.length > 0) {
        photoUrl = await uploadPhotoToR2(jobId, images[0]);
      }

      if (payload.portionChoices) {
        await updateSupabaseProgress(15, initialStatusMessage);
      } else {
        await updateSupabaseProgress(15, 'Vision Scout starting...');
      }

      // Prepare request body for loopback / in-process execution
      const port = process.env.PORT || 3000;
      const baseUrl = process.env.INTERNAL_BASE_URL || `http://127.0.0.1:${port}`;
      const bodyData = {
        message: text || '',
        images: images,
        imageUrls: photoUrl ? [photoUrl] : imageUrls,
        history: payload.history || [],
        userProfile: payload.userProfile || null,
        engine: payload.engine || 'gemini-3.5-flash-lite',
        biomarkersNeedingImprovement: payload.biomarkersNeedingImprovement || [],
        remainingAllowance: payload.remainingAllowance || null,
        activeMeal: payload.activeMeal || null,
        foodLogs: payload.foodLogs || [],
        userSelectedMode: payload.userSelectedMode || mode || 'review',
        activeScoutItems: payload.activeScoutItems || [],
        portionChoices: payload.portionChoices,
        skipScout: payload.skipScout,
        scoutContentType: payload.scoutContentType,
        // Task 6: Carry pre-resolved DB candidates from turn-1 portionClarify payload so
        // turn-2 skips the DB re-scan and uses the already-resolved context.
        resolvedDbCandidates: payload.resolvedDbCandidates || [],
      };
      // Note: priorLogsUrl is kept in payload separately for log stitching in persistSucceeded.

      // Server background job worker invocation via loopback with AbortController timeout
      const controller = new AbortController();
      const globalTimeout = setTimeout(() => {
        controller.abort(new Error('Analysis request timed out after 180s.'));
      }, 180000);

      let chunkTimer: NodeJS.Timeout | null = null;
      const resetChunkTimer = () => {
        if (chunkTimer) clearTimeout(chunkTimer);
        chunkTimer = setTimeout(() => {
          controller.abort(new Error('Stream stalled: No response from analysis engine for 45s.'));
        }, 45000);
      };

      resetChunkTimer();

      let response: Response;
      try {
        response = await fetch(`${baseUrl}/api/gemini/food-analyze?stream=true`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-ID': 'server-job-' + jobId
          },
          body: JSON.stringify(bodyData),
          signal: controller.signal
        });
      } catch (fetchErr: any) {
        try {
          response = await fetch(`http://localhost:${port}/api/gemini/food-analyze?stream=true`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Session-ID': 'server-job-' + jobId
            },
            body: JSON.stringify(bodyData),
            signal: controller.signal
          });
        } catch (retryErr: any) {
          if (chunkTimer) clearTimeout(chunkTimer);
          clearTimeout(globalTimeout);
          throw retryErr;
        }
      }

      if (!response.ok) {
        if (chunkTimer) clearTimeout(chunkTimer);
        clearTimeout(globalTimeout);
        throw new Error(`Local food-analyze failed with status ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        if (chunkTimer) clearTimeout(chunkTimer);
        clearTimeout(globalTimeout);
        throw new Error('Response body stream is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      finalData = null;

      try {
        while (true) {
          const { done, value } = await reader.read();
          resetChunkTimer();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;

            const rawData = trimmed.slice(6);
            if (!rawData) continue;

            try {
              const parsed = JSON.parse(rawData);
              if (parsed.error) {
                const errMsg = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error);
                accumulatedLogs.push(`[error] ${errMsg}`);
                throw new Error(errMsg);
              }
              if (parsed.type === 'log') {
                accumulatedLogs.push(`[${parsed.logType || 'info'}] ${parsed.message}`);
                
                if (parsed.logType === 'status') {
                  let prog = currentProgress;
                  const msg = parsed.message || '';
                  if (msg.toLowerCase().includes('scout')) {
                    prog = Math.max(prog, 30);
                  } else if (msg.toLowerCase().includes('database') || msg.toLowerCase().includes('usda') || msg.toLowerCase().includes('search')) {
                    prog = Math.max(prog, 50);
                  } else if (msg.toLowerCase().includes('dietitian') || msg.toLowerCase().includes('nutritionist')) {
                    prog = Math.max(prog, 70);
                  } else if (msg.toLowerCase().includes('final')) {
                    prog = Math.max(prog, 90);
                  }
                  await updateSupabaseProgress(prog, msg);
                }
              } else if ((parsed.final === true || parsed.type === 'done') && parsed.result) {
                finalData = parsed.result;
              }
            } catch (err: any) {
              if (err.message && !err.message.includes('JSON')) {
                throw err;
              }
              // ignore JSON parse error on incomplete chunks
            }
          }
        }

        if (buffer && buffer.trim()) {
          const remainingLines = buffer.split('\n');
          for (const line of remainingLines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              const rawData = trimmed.slice(6);
              if (rawData) {
                try {
                  const parsed = JSON.parse(rawData);
                  if ((parsed.final === true || parsed.type === 'done') && parsed.result) {
                    finalData = parsed.result;
                  }
                } catch {}
              }
            }
          }
        }
      } finally {
        if (chunkTimer) clearTimeout(chunkTimer);
        clearTimeout(globalTimeout);
      }

      if (!finalData) {
        const lastErr = [...accumulatedLogs].reverse().find(l => l.startsWith('[error]'));
        if (lastErr) {
          throw new Error(lastErr.replace(/^\[error\]\s*/, ''));
        }
        throw new Error('Stream finished but no final result data was received');
      }

      if (finalData.needsPortionClarify) {
        let logsUrl = '';
        try {
          const { uploadLogsToR2 } = await import('./src/utils/r2Storage.js');
          logsUrl = await uploadLogsToR2(jobId, accumulatedLogs.join('\n'));
        } catch (r2LogErr) {
          console.warn('[ServerJobs] Failed uploading portion clarify logs to R2:', r2LogErr);
        }

        finalData.backendLogsUrl = logsUrl || undefined;
        finalData.backendLogs = logsUrl ? `[Logs stored in R2: ${logsUrl}]` : accumulatedLogs.join('\n').slice(0, 5000);
        if (finalData.agentResult) {
          finalData.agentResult.backendLogsUrl = logsUrl || undefined;
          finalData.agentResult.backendLogs = finalData.backendLogs;
        }

        const memJob = inMemoryServerJobs.get(jobId);
        if (memJob) {
          memJob.status = 'awaiting_user';
          memJob.status_message = finalData.message || 'Please clarify portion sizes.';
          memJob.clean_result = finalData;
          memJob.turn1Logs = [...accumulatedLogs];
          memJob.accumulatedLogs = [...accumulatedLogs];
          memJob.photo_url = photoUrl || memJob.photo_url;
          memJob.updated_at = new Date().toISOString();
        }
        if (isSupabaseConfigured) {
          let lightweightFinalData = { ...finalData };
          try {
            const { uploadJobResultToR2 } = await import('./src/utils/r2Storage.js');
            const publicUrl = await uploadJobResultToR2(jobId, finalData);
            if (publicUrl) {
              lightweightFinalData = {
                is_r2: true,
                r2_url: publicUrl,
                backendLogsUrl: logsUrl || undefined,
                mode: finalData.mode || 'review',
                text: finalData.text || '',
                message: finalData.message || 'Please clarify portion sizes.',
                needsPortionClarify: true,
                portionClarify: finalData.portionClarify,
                scoutItems: finalData.scoutItems,
                agentResult: {
                  scoutItems: finalData.scoutItems,
                  activeStage: 'portion_clarify',
                },
              };
            }
          } catch (r2Err) {
            console.error('[ServerJobs] R2 save for portion clarify failed:', r2Err);
          }

          await supabaseAdmin.from('agent_jobs').update({
            status: 'awaiting_user',
            status_message: finalData.message || 'Please clarify portion sizes.',
            clean_result: lightweightFinalData, // contains lightweight R2 reference
            updated_at: new Date().toISOString()
          }).eq('id', jobId);
        }
        return;
      }

      // Helper to write successful outcome to Supabase
      persistSucceeded = async (finalPayload: any) => {
        const foodLog = finalPayload?.pendingFoodLog || finalPayload?.data || null;
        const pendingFoodLog = foodLog || (finalPayload?.name && finalPayload?.nutrients ? finalPayload : null);
        if (pendingFoodLog && typeof pendingFoodLog === 'object') {
          // Replace base64 strings with public R2 URL or remove them
          if (pendingFoodLog.imageUrl && String(pendingFoodLog.imageUrl).startsWith('data:')) {
            pendingFoodLog.imageUrl = photoUrl || '';
          }
          if (Array.isArray(pendingFoodLog.imageUrls)) {
            pendingFoodLog.imageUrls = pendingFoodLog.imageUrls.map((url: any) => 
              String(url).startsWith('data:') ? (photoUrl || '') : url
            ).filter(Boolean);
          }
          delete pendingFoodLog.imageBase64;
          delete pendingFoodLog.images;
        }

        let logsUrl = '';
        const rawLogsText = accumulatedLogs.join('\n');
        try {
          const { uploadLogsToR2 } = await import('./src/utils/r2Storage.js');
          logsUrl = await uploadLogsToR2(jobId, rawLogsText);
        } catch (r2LogErr) {
          console.warn('[ServerJobs] Failed uploading execution logs to R2:', r2LogErr);
        }

        // Task 7: Stitch turn-1 logs header so the full two-turn trace is visible in the log viewer.
        const priorLogsUrl: string = (payload as any).priorLogsUrl || '';
        const priorLogsNote = priorLogsUrl
          ? `[Turn 1 Scout + DB logs: ${priorLogsUrl}]\n--- TURN 2 (Portion Confirm) ---\n`
          : '';

        const cleanResult: any = {
          pendingFoodLog: pendingFoodLog,
          message: finalPayload?.message || finalPayload?.text || '',
          text: finalPayload?.text || finalPayload?.message || '',
          dietitianScratchpad: finalPayload?.dietitianScratchpad || '',
          mode: finalPayload?.mode || mode || 'review',
          comparison: finalPayload?.comparison || undefined,
          comparisonSet: finalPayload?.comparisonSet || undefined,
          scoutItems: finalPayload?.scoutItems || undefined,
          scoutContentType: finalPayload?.scoutContentType || undefined,
          photoUrl: photoUrl || undefined,
          debugUrl: undefined as string | undefined,
          backendLogsUrl: logsUrl || undefined,
          backendLogs: logsUrl ? `[Logs stored in R2: ${logsUrl}]` : priorLogsNote + rawLogsText.slice(0, 5000),
          mealBuild: finalPayload?.mealBuild,
          degradedStages: finalPayload?.degradedStages,
          lastUserAction: payload.lastUserAction || (text ? { action: 'chat_submit', prompt: text, timestamp: new Date().toISOString() } : undefined),
          clientConsoleLogs: payload.clientConsoleLogs || [],
          networkErrors: payload.networkErrors || [],
          userActionBreadcrumbs: payload.userActionBreadcrumbs || [],
        };

        try {
          const debugUrl = await uploadDebugPayloadToR2(jobId, {
            jobId,
            userId,
            kind,
            mode,
            text,
            photoUrl,
            result: cleanResult,
            backendLogsUrl: logsUrl || undefined,
            backendLogs: rawLogsText,
            completedAt: new Date().toISOString(),
            lastUserAction: cleanResult.lastUserAction,
            clientConsoleLogs: payload.clientConsoleLogs,
            networkErrors: payload.networkErrors,
            userActionBreadcrumbs: payload.userActionBreadcrumbs
          });
          if (debugUrl) cleanResult.debugUrl = debugUrl;
        } catch (r2Err) {
          console.warn('[ServerJobs] R2 debug upload failed (non-fatal):', r2Err);
        }

        const memJob = inMemoryServerJobs.get(jobId);
        if (memJob) {
          memJob.status = 'succeeded';
          memJob.progress_percent = 100;
          memJob.status_message = 'Analysis complete';
          memJob.photo_url = photoUrl || null;
          memJob.debug_url = cleanResult.debugUrl || null;
          memJob.clean_result = cleanResult;
          memJob.updated_at = new Date().toISOString();
        }

        if (isSupabaseConfigured) {
          let lightweightResult = { ...cleanResult };
          try {
            const { uploadJobResultToR2 } = await import('./src/utils/r2Storage.js');
            const publicUrl = await uploadJobResultToR2(jobId, cleanResult);
            if (publicUrl) {
              lightweightResult = {
                is_r2: true,
                r2_url: publicUrl,
                backendLogsUrl: logsUrl || undefined,
                mode: cleanResult.mode || 'review',
                text: cleanResult.text || '',
                message: cleanResult.message || 'Analysis complete',
              };
            }
          } catch (r2Err) {
            console.error('[ServerJobs] R2 save for success failed:', r2Err);
          }

          await supabaseAdmin.from('agent_jobs').update({
            status: 'succeeded',
            progress_percent: 100,
            status_message: 'Analysis complete',
            photo_url: photoUrl || null,
            debug_url: cleanResult.debugUrl || null,
            clean_result: lightweightResult, // lightweight R2 reference in DB!
            updated_at: new Date().toISOString(),
          }).eq('id', jobId);
        }
      };

      if (persistSucceeded) {
        await persistSucceeded(finalData);
      }

    } catch (err: any) {
      console.error(`[ServerJobs] Job ${jobId} failed:`, err);
      accumulatedLogs.push(`[error] Job execution failed: ${err.message || String(err)}`);

      if (finalData) {
        try {
          accumulatedLogs.push('[ServerJobs] Recovering: final result was present despite later error — marking succeeded.');
          if (persistSucceeded) {
            await persistSucceeded(finalData);
          }
          return;
        } catch (recoverErr: any) {
          console.error('[ServerJobs] Recover-as-success failed:', recoverErr);
        }
      }

      let logsUrl = '';
      const rawErrorLogs = accumulatedLogs.join('\n');
      try {
        const { uploadLogsToR2 } = await import('./src/utils/r2Storage.js');
        logsUrl = await uploadLogsToR2(jobId, rawErrorLogs);
      } catch (r2LogErr) {
        console.warn('[ServerJobs] Failed uploading error logs to R2:', r2LogErr);
      }

      const errorCleanResult: any = {
        message: err.message || 'Server analysis failed or timed out',
        error: err.message || 'Unknown error',
        backendLogsUrl: logsUrl || undefined,
        backendLogs: logsUrl ? `[Logs stored in R2: ${logsUrl}]` : rawErrorLogs.slice(0, 5000),
        photoUrl: photoUrl || undefined,
        scoutItems: finalData?.scoutItems,
      };
      if (finalData?.pendingFoodLog || finalData?.data) {
        errorCleanResult.pendingFoodLog = finalData.pendingFoodLog || finalData.data;
      }
      try {
        const debugUrl = await uploadDebugPayloadToR2(jobId, {
          jobId,
          userId,
          kind,
          mode,
          text,
          photoUrl,
          result: errorCleanResult,
          backendLogsUrl: logsUrl || undefined,
          backendLogs: rawErrorLogs,
          failedAt: new Date().toISOString(),
        });
        if (debugUrl) errorCleanResult.debugUrl = debugUrl;
      } catch (r2Fail) {
        console.warn('[ServerJobs] R2 debug upload on fail (non-fatal):', r2Fail);
      }

      const memJob = inMemoryServerJobs.get(jobId);
      if (memJob) {
        memJob.status = 'failed';
        memJob.status_message = err.message || 'Server analysis failed';
        memJob.photo_url = photoUrl || null;
        memJob.clean_result = errorCleanResult;
        memJob.updated_at = new Date().toISOString();
      }

      if (isSupabaseConfigured) {
        try {
          await supabaseAdmin.from('agent_jobs').update({
            status: 'failed',
            status_message: err.message || 'Server analysis failed',
            photo_url: photoUrl || null,
            debug_url: errorCleanResult.debugUrl || null,
            clean_result: errorCleanResult,
            updated_at: new Date().toISOString(),
          }).eq('id', jobId);
        } catch (uErr) {
          console.error('[ServerJobs] Failed to update error state in Supabase:', uErr);
        }
      }
    }
  });
}
