import { auth, db } from '../firebase';
import { doc, setDoc, getDocs, collection, deleteDoc } from 'firebase/firestore';
import { supabase, isSupabaseConfigured } from '../utils/supabaseClient';
import { sanitizeForFirestore } from '../utils/firestoreUtils';
import { JobStore } from './JobStore';
import { AgentJob } from './types';

const backendDeleteTried = new Set<string>();

function forgetDeletedOnBackend(jobId: string, userId: string) {
  if (!jobId || backendDeleteTried.has(jobId)) return;
  backendDeleteTried.add(jobId);
  deleteJobFromBackend(jobId, userId).catch(() => {});
}

async function fetchAndPopulateR2Job(jobId: string) {
  try {
    const baseUrl = typeof window !== 'undefined' ? '' : 'http://localhost:3000';
    const r2Controller = new AbortController();
    const r2TimeoutId = setTimeout(() => r2Controller.abort(), 20000);
    let r: Response;
    try {
      r = await fetch(`${baseUrl}/api/jobs/status?jobId=${jobId}&full=true`, { signal: r2Controller.signal });
    } finally {
      clearTimeout(r2TimeoutId);
    }
    if (r.ok) {
      const contentType = r.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const fetchedWrapper = await r.json();
        if (fetchedWrapper && fetchedWrapper.jobs && fetchedWrapper.jobs.length > 0) {
          const backendJob = fetchedWrapper.jobs[0];
          if (backendJob && backendJob.clean_result && !backendJob.clean_result.is_r2) {
            const existing = JobStore.getJob(jobId);
            if (existing && (!existing.result || (existing.result as any).is_r2)) {
              const updatedResult = backendJob.clean_result;
              JobStore.updateJob(jobId, {
                result: updatedResult,
                mealBuild: updatedResult.mealBuild || existing.mealBuild,
                photoUrl: updatedResult.photoUrl || existing.photoUrl,
                debugUrl: updatedResult.debugUrl || existing.debugUrl
              });
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[SupabaseJobSync] Async R2 fetch via backend failed for ${jobId}:`, err);
  }
}

export function processJobRows(rows: any[], userId: string = 'anonymous'): void {
  if (!rows || !Array.isArray(rows)) return;

  for (const row of rows) {
    if (!row || !row.id || JobStore.isJobDeleted(row.id)) {
      if (row && row.id && JobStore.isJobDeleted(row.id)) {
        forgetDeletedOnBackend(row.id, userId);
      }
      continue;
    }
    const existing = JobStore.getJob(row.id);
    const cleanRes = row.clean_result || undefined;
    const photoUrl = row.photo_url || cleanRes?.photoUrl;
    const debugUrl = row.debug_url || cleanRes?.debugUrl;
    if (cleanRes) {
      if (photoUrl) cleanRes.photoUrl = photoUrl;
      if (debugUrl) cleanRes.debugUrl = debugUrl;
    }

    if (!existing) {
      const cleanResObj = cleanRes || {};
      let initialMessages: any[] = [];
      if (row.status === 'awaiting_user' && cleanResObj) {
        const clarifyMsg = cleanResObj.message || row.status_message || 'Confirm how much you ate';
        initialMessages = [{
          id: `msg_assistant_clarify_${row.id}`,
          role: 'assistant',
          content: clarifyMsg,
          timestamp: new Date().toISOString(),
          isLive: false,
          agentType: 'food',
          data: {
            needsPortionClarify: true,
            portionClarify: cleanResObj.portionClarify,
            scoutItems: cleanResObj.scoutItems || [],
            photoUrl: row.photo_url || cleanResObj.photoUrl,
            debugUrl: row.debug_url || cleanResObj.debugUrl,
            agentResult: {
              backendLogs: cleanResObj.backendLogs || '',
              globalLiveLogs: cleanResObj.backendLogs || '',
              scoutItems: cleanResObj.scoutItems || [],
              activeStage: 'portion_clarify',
            },
          },
        }];
      }
      JobStore.createJob({
        id: row.id,
        kind: row.kind || 'food_log',
        mode: row.mode || 'review',
        status: row.status,
        progressPercent: row.progress_percent || 0,
        statusMessage: row.status_message || '',
        error: row.status === 'failed' ? { class: 'permanent', message: row.status_message || cleanRes?.message || 'Analysis failed on server' } : undefined,
        messages: cleanRes?.messages || initialMessages,
        result: cleanRes,
        mealBuild: cleanRes?.mealBuild,
        photoUrl: photoUrl || row.photo_url || cleanRes?.photoUrl,
        debugUrl: debugUrl || row.debug_url || cleanRes?.debugUrl,
        inputSnapshot: {
          text: row.raw_text || cleanRes?.raw_text || '',
          hasImage: !!(photoUrl || row.photo_url || cleanRes?.photoUrl)
        },
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        serverSubmittedAt: Date.now(),
      } as any);
      
      if (cleanRes && cleanRes.is_r2) {
        fetchAndPopulateR2Job(row.id);
      }
    } else {
      let syncStatus = row.status;
      // Guard: if the job was previously succeeded/awaiting_user and the server now reports
      // queued/running, this is an edit-turn in-flight transient state. Lock the displayed
      // status to prevent a downgrade, and — critically — preserve the existing result so
      // we don't overwrite job.result with the stale first-pass clean_result that the
      // server still has while the edit is being processed.
      const isEditInFlightTransient =
        (existing.status === 'succeeded' || existing.status === 'awaiting_user') &&
        (row.status === 'queued' || row.status === 'running');
      if (isEditInFlightTransient) {
        syncStatus = existing.status;
      }
      const updatePayload: any = {
        status: syncStatus,
        progressPercent: row.progress_percent,
        statusMessage: row.status_message,
        serverSubmittedAt: existing.serverSubmittedAt || Date.now(),
        error: row.status === 'failed'
          ? { class: 'permanent', message: row.status_message || cleanRes?.message || existing.error?.message || 'Analysis failed on server' }
          : row.status === 'succeeded'
            ? undefined
            : existing.error,
        // When we detected an edit-in-flight transient, preserve the existing result entirely
        // to avoid clobbering it with the stale first-pass data still in the DB row.
        // For normal updates (server reached succeeded or cleanRes is fresh inline data), apply cleanRes.
        result: isEditInFlightTransient
          ? existing.result
          : ((cleanRes && !cleanRes.is_r2) ? cleanRes : (existing.result || cleanRes)),
        mealBuild: isEditInFlightTransient
          ? existing.mealBuild
          : (cleanRes?.mealBuild || existing.mealBuild),
        photoUrl: photoUrl || row.photo_url || cleanRes?.photoUrl || existing.photoUrl,
        debugUrl: debugUrl || row.debug_url || cleanRes?.debugUrl || existing.debugUrl
      };
      if (photoUrl || row.photo_url || cleanRes?.photoUrl) {
        updatePayload.inputSnapshot = {
          ...(existing.inputSnapshot || {}),
          hasImage: true
        };
      }
      if (row.status === 'awaiting_user' && cleanRes && (!existing.messages || existing.messages.length === 0)) {
        const clarifyMsg = cleanRes.message || row.status_message || 'Confirm how much you ate';
        updatePayload.messages = [{
          id: `msg_assistant_clarify_${row.id}`,
          role: 'assistant',
          content: clarifyMsg,
          timestamp: new Date().toISOString(),
          isLive: false,
          agentType: 'food',
          data: {
            needsPortionClarify: true,
            portionClarify: cleanRes.portionClarify,
            scoutItems: cleanRes.scoutItems || [],
            photoUrl: row.photo_url || cleanRes.photoUrl,
            debugUrl: row.debug_url || cleanRes.debugUrl,
            agentResult: {
              backendLogs: cleanRes.backendLogs || '',
              globalLiveLogs: cleanRes.backendLogs || '',
              scoutItems: cleanRes.scoutItems || [],
              activeStage: 'portion_clarify',
            },
          },
        }];
      }
      JobStore.updateJob(row.id, updatePayload);

      // Fetch R2 result whenever the new clean_result is stored in R2 — regardless of
      // whether the existing result is populated (covers edit-turn where prior turn
      // already populated existing.result with non-R2 data).
      if (cleanRes && cleanRes.is_r2 && !isEditInFlightTransient) {
        fetchAndPopulateR2Job(row.id);
      }
    }
  }
}

export async function hydrateUserJobs(userId: string = 'anonymous', isFull: boolean = true): Promise<void> {
  const effectiveUserId = (userId && userId !== 'anonymous') ? userId : (auth.currentUser?.uid || 'anonymous');
  let loadedRows: any[] = [];

  // 1. Try server route /api/jobs/status
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(`/api/jobs/status?userId=${encodeURIComponent(effectiveUserId)}&full=${isFull}`, { signal: controller.signal });
      if (res.ok) {
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const { jobs } = await res.json();
          if (Array.isArray(jobs) && jobs.length > 0) {
            loadedRows = jobs;
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (e: any) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      console.debug('[SupabaseJobSync] User offline, skipping job hydration');
      return;
    }
    console.debug('[SupabaseJobSync] Server /api/jobs/status deferred:', e?.message || e);
  }

  // 2. Direct Supabase Client fallback
  if (loadedRows.length === 0 && isSupabaseConfigured && supabase && effectiveUserId !== 'anonymous') {
    try {
      const { data, error } = await supabase
        .from('agent_jobs')
        .select('*')
        .eq('user_id', effectiveUserId)
        .order('updated_at', { ascending: false })
        .limit(20);
      if (!error && Array.isArray(data) && data.length > 0) {
        loadedRows = data;
      }
    } catch (sbErr) {
      console.debug('[SupabaseJobSync] Direct Supabase hydrate error:', sbErr);
    }
  }

  // 3. Firebase Firestore mirror fallback (cross-network guarantee)
  if (loadedRows.length === 0 && effectiveUserId !== 'anonymous' && db) {
    try {
      const snapshot = await getDocs(collection(db, 'users', effectiveUserId, 'inbox_jobs'));
      const fsRows: any[] = [];
      snapshot.forEach(docSnap => {
        if (docSnap.exists()) {
          fsRows.push(docSnap.data());
        }
      });
      if (fsRows.length > 0) {
        loadedRows = fsRows;
      }
    } catch (fsErr) {
      console.debug('[SupabaseJobSync] Firestore inbox_jobs hydrate error:', fsErr);
    }
  }

  if (loadedRows.length > 0) {
    processJobRows(loadedRows, effectiveUserId);
  }
}

export function fetchJobsFromSupabase(userId?: string) {
  return hydrateUserJobs(userId);
}

export function initSupabaseJobSync(userId?: string): () => void {
  // Always hydrate initial jobs from server API / cloud on mount (deferred to avoid blocking TTI)
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => { hydrateUserJobs(userId).catch(() => {}); }, { timeout: 2000 });
  } else {
    setTimeout(() => { hydrateUserJobs(userId).catch(() => {}); }, 1500);
  }

  // Fallback poll: the realtime channel below is a single WebSocket subscription with
  // no reconnect logic. On flaky mobile connections it can silently drop, leaving jobs
  // stuck at their last-seen progress forever even though the backend actually finished.
  // Re-hydrate from the server periodically so any job stuck in a non-terminal status
  // eventually catches up regardless of realtime channel health.
  const fallbackPollInterval = setInterval(() => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return;
    }
    
    const now = Date.now();
    let hasActiveJob = false;
    
    JobStore.getAllJobs().forEach((j: any) => {
      if (j.status === 'running' || j.status === 'pending') {
        const startedAt = new Date(j.createdAt || j.updatedAt || now).getTime();
        if (now - startedAt > 10 * 60 * 1000) {
          JobStore.updateJob(j.id, { status: 'failed', statusMessage: 'Job timed out after 10 minutes' });
        } else {
          hasActiveJob = true;
        }
      }
    });

    if (hasActiveJob) {
      hydrateUserJobs(userId, false).catch(() => {});
    }
  }, 8000);

  if (!isSupabaseConfigured) {
    console.log('[SupabaseJobSync] Supabase not configured, realtime job sync disabled');
    return () => clearInterval(fallbackPollInterval);
  }

  // Tracks the most recent `updated_at` timestamp successfully applied per job, so that
  // a slow/in-flight R2 fetch for an older update cannot overwrite a newer update that
  // finished (and was applied) first. Prevents out-of-order state application caused by
  // the unawaited async R2 fetch inside the realtime handler below.
  const lastAppliedUpdatedAt = new Map<string, string>();

  const channel = supabase.channel('public:agent_jobs')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'agent_jobs',
        filter: userId ? `user_id=eq.${userId}` : undefined,
      },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          const oldRow = payload.old as any;
          if (oldRow && oldRow.id) {
            JobStore.deleteJob(oldRow.id);
          }
          return;
        }
        const row = payload.new as any;
        if (!row || !row.id || JobStore.isJobDeleted(row.id)) {
          if (row && row.id && JobStore.isJobDeleted(row.id)) {
            forgetDeletedOnBackend(row.id, userId || 'anonymous');
          }
          return;
        }

        const processRow = async () => {
          const rowUpdatedAt = row.updated_at || '';

          let cleanRes = row.clean_result;
          const existingJobForR2Check = JobStore.getJob(row.id);

          // Only reuse the cached non-R2 result (skip R2 fetch) if the job status hasn't
          // changed to 'succeeded' on this event — i.e. don't skip when this event is the
          // completion of an edit turn (queued/running → succeeded), because in that case
          // existingJobForR2Check.result contains the stale first-pass data, not the edit result.
          const isCompletionEvent = row.status === 'succeeded' &&
            existingJobForR2Check &&
            (existingJobForR2Check.status === 'queued' || existingJobForR2Check.status === 'running');
          if (!isCompletionEvent && cleanRes && typeof cleanRes === 'object' && cleanRes.is_r2 && existingJobForR2Check?.result && !existingJobForR2Check.result.is_r2) {
             cleanRes = existingJobForR2Check.result;
          } else if (cleanRes && typeof cleanRes === 'object' && cleanRes.is_r2 && cleanRes.r2_url) {
            try {
              // Bypassing client-side CORS issues by fetching through our own backend proxy endpoint
              const baseUrl = typeof window !== 'undefined' ? '' : 'http://localhost:3000';
              const r2Controller = new AbortController();
              const r2TimeoutId = setTimeout(() => r2Controller.abort(), 6000);
              let r: Response;
              try {
                r = await fetch(`${baseUrl}/api/jobs/status?jobId=${row.id}&full=true`, { signal: r2Controller.signal });
              } finally {
                clearTimeout(r2TimeoutId);
              }
              if (r.ok) {
                const contentType = r.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                  const fetchedWrapper = await r.json();
                  if (fetchedWrapper && fetchedWrapper.jobs && fetchedWrapper.jobs.length > 0) {
                    // Our backend automatically unwraps the R2 result when fetching
                    const backendJob = fetchedWrapper.jobs[0];
                    if (backendJob && backendJob.clean_result) {
                      cleanRes = backendJob.clean_result;
                    }
                  }
                }
              }
            } catch (err) {
              console.warn('[SupabaseJobSync] Realtime R2 fetch via backend failed:', err);
            }
          }

          // Guard against out-of-order application: if a newer update for this job was
          // already applied while this row's (possibly slow) R2 fetch was in flight, skip
          // this stale write instead of overwriting the newer state.
          const alreadyApplied = lastAppliedUpdatedAt.get(row.id);
          if (alreadyApplied && rowUpdatedAt && alreadyApplied > rowUpdatedAt) {
            console.log(`[SupabaseJobSync] Skipping stale update for job ${row.id}`);
            return;
          }
          if (rowUpdatedAt) {
            lastAppliedUpdatedAt.set(row.id, rowUpdatedAt);
          }

          const existingJob = JobStore.getJob(row.id);
          const updatedFields: Partial<AgentJob> = {
            status: row.status,
            progressPercent: row.progress_percent,
            statusMessage: row.status_message,
          };

          if (cleanRes) {
            updatedFields.result = {
              ...(existingJob?.result || {}),
              ...cleanRes,
              photoUrl: row.photo_url || cleanRes.photoUrl || existingJob?.result?.photoUrl,
              debugUrl: row.debug_url || cleanRes.debugUrl || existingJob?.result?.debugUrl,
              mealBuild: cleanRes.mealBuild || existingJob?.result?.mealBuild,
            };
            if (cleanRes.mealBuild) {
              updatedFields.mealBuild = cleanRes.mealBuild;
            }
            if (row.photo_url || cleanRes.photoUrl) {
              updatedFields.photoUrl = row.photo_url || cleanRes.photoUrl;
            }
            if (row.debug_url || cleanRes.debugUrl) {
              updatedFields.debugUrl = row.debug_url || cleanRes.debugUrl;
            }
          }

          if (row.status === 'awaiting_user' && cleanRes) {
            const clarifyMsg = cleanRes.message || row.status_message || 'Confirm how much you ate';
            const nonLive = (existingJob?.messages || []).filter((m: any) => !m.isLive);
            const alreadyHasClarify = nonLive.some((m: any) => m.id === `msg_assistant_clarify_${row.id}`);
            if (!alreadyHasClarify) {
              updatedFields.messages = [
                ...nonLive,
                {
                  id: `msg_assistant_clarify_${row.id}`,
                  role: 'assistant',
                  content: clarifyMsg,
                  timestamp: new Date().toISOString(),
                  isLive: false,
                  agentType: 'food',
                  data: {
                    needsPortionClarify: true,
                    portionClarify: cleanRes.portionClarify,
                    scoutItems: cleanRes.scoutItems || [],
                    photoUrl: row.photo_url || cleanRes.photoUrl,
                    debugUrl: row.debug_url || cleanRes.debugUrl,
                    agentResult: {
                      backendLogs: cleanRes.backendLogs || '',
                      globalLiveLogs: cleanRes.backendLogs || '',
                      scoutItems: cleanRes.scoutItems || [],
                      activeStage: 'portion_clarify',
                    },
                  },
                },
              ];
            }
          }

          if (row.status === 'failed') {
            updatedFields.error = {
              class: 'permanent',
              message: row.status_message || 'Analysis failed on server',
            };
          }

          JobStore.updateJob(row.id, updatedFields);
        };

        processRow().catch((err) => {
          console.error('[SupabaseJobSync] Error processing realtime row:', err);
        });
      }
    )
    .subscribe();

  return () => {
    clearInterval(fallbackPollInterval);
    try {
      supabase.removeChannel(channel).catch(() => {});
    } catch (_) {}
  };
}

export async function upsertJobToSupabase(
  job: AgentJob,
  userId: string = 'anonymous',
  photoUrl?: string,
  debugUrl?: string,
  cleanResult?: any
): Promise<void> {
  const effectiveUserId = (userId && userId !== 'anonymous') ? userId : (auth.currentUser?.uid || 'anonymous');
  try {
    let finalCleanResult = cleanResult || job.result || null;
    if (job.mealBuild) {
      finalCleanResult = {
        ...(finalCleanResult || {}),
        mealBuild: undefined,
      };
    }

    if (job.messages && job.messages.length > 0) {
      finalCleanResult = {
        ...(finalCleanResult || {}),
        messages: job.messages.map((m: any) => {
          const stripped = { ...m };
          delete stripped.imageUrl;
          delete stripped.imageUrls;
          return stripped;
        })
      };
    }

    const payload = {
      id: job.id,
      user_id: effectiveUserId,
      kind: job.kind,
      mode: job.mode || 'review',
      status: job.status,
      progress_percent: job.progressPercent || 0,
      status_message: job.statusMessage || '',
      photo_url: photoUrl || job.result?.photoUrl || null,
      debug_url: debugUrl || job.result?.debugUrl || null,
      clean_result: finalCleanResult,
      updated_at: new Date().toISOString(),
    };
    
    // 1. Push through backend server endpoint
    let serverUpsertSuccess = false;
    try {
      const res = await fetch('/api/jobs/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth.currentUser ? { Authorization: `Bearer ${await auth.currentUser.getIdToken()}` } : {}) },
        body: JSON.stringify({ payload }),
      });
      if (res.ok) {
        serverUpsertSuccess = true;
      }
    } catch (backendErr: any) {
      console.debug('[SupabaseJobSync] Backend /api/jobs/upsert not reachable, using direct cloud sync:', backendErr?.message || backendErr);
    }

    // 2. Direct Supabase Client fallback
    if (!serverUpsertSuccess && isSupabaseConfigured && supabase) {
      try {
        const { error } = await supabase.from('agent_jobs').upsert(payload);
        if (!error) serverUpsertSuccess = true;
      } catch (sbErr) {
        console.debug('[SupabaseJobSync] Direct Supabase upsert fallback error:', sbErr);
      }
    }

    // 3. Firebase Firestore mirror (guarantees cross-network sync between mobile & desktop)
    if (effectiveUserId && effectiveUserId !== 'anonymous' && db) {
      try {
        const cleanPayload = sanitizeForFirestore(payload);
        await setDoc(doc(db, 'users', effectiveUserId, 'inbox_jobs', payload.id), cleanPayload, { merge: true });
      } catch (fsErr) {
        console.debug('[SupabaseJobSync] Firestore inbox_jobs write skipped/failed:', fsErr);
      }
    }
  } catch (err: any) {
    const isFetchErr = err && (err.name === 'TypeError' || (err.message && err.message.includes('Failed to fetch')));
    if (isFetchErr) {
      console.debug('[SupabaseJobSync] Job upsert deferred (offline/network timeout):', err.message || err);
    } else {
      console.warn('[SupabaseJobSync] Failed to upsert job to backend/Supabase:', err);
    }
  }
}

export async function deleteJobFromBackend(
  jobId: string,
  userId: string = 'anonymous'
): Promise<void> {
  if (!jobId) return;
  const effectiveUserId = (userId && userId !== 'anonymous') ? userId : (auth.currentUser?.uid || 'anonymous');

  try {
    const baseUrl = typeof window !== 'undefined' ? '' : 'http://localhost:3000';
    await fetch(`${baseUrl}/api/jobs/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth.currentUser ? { Authorization: `Bearer ${await auth.currentUser.getIdToken()}` } : {}) },
      body: JSON.stringify({ jobId, userId: effectiveUserId }),
    }).catch(() => {});

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from('agent_jobs').delete().eq('id', jobId);
      } catch (_) {}
    }

    if (effectiveUserId && effectiveUserId !== 'anonymous' && db) {
      try {
        await deleteDoc(doc(db, 'users', effectiveUserId, 'inbox_jobs', jobId));
      } catch (_) {}
    }
  } catch (err: any) {
    const isFetchErr = err && (err.name === 'TypeError' || (err.message && err.message.includes('Failed to fetch')));
    if (isFetchErr) {
      console.debug('[SupabaseJobSync] Job delete deferred (offline/network timeout):', err.message || err);
    } else {
      console.warn('[SupabaseJobSync] Error deleting job from backend:', err);
    }
  }
}