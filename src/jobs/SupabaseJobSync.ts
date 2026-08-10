import { supabase, isSupabaseConfigured } from '../utils/supabaseClient';
import { JobStore } from './JobStore';
import { AgentJob } from './types';

export async function hydrateUserJobs(userId: string = 'anonymous'): Promise<void> {
  try {
    const res = await fetch(`/api/jobs/status?userId=${encodeURIComponent(userId)}`);
    if (!res.ok) return;
    const { jobs: rows } = await res.json();
    if (!rows || !Array.isArray(rows)) return;

    for (const row of rows) {
      if (!row || !row.id || JobStore.isJobDeleted(row.id)) {
        if (row && row.id && JobStore.isJobDeleted(row.id)) {
          deleteJobFromBackend(row.id, userId);
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
          messages: initialMessages,
          result: cleanRes,
          mealBuild: cleanRes?.mealBuild,
          photoUrl: photoUrl || row.photo_url || cleanRes?.photoUrl,
          debugUrl: debugUrl || row.debug_url || cleanRes?.debugUrl,
          inputSnapshot: {
            text: row.raw_text || cleanRes?.raw_text || '',
            hasImage: !!(photoUrl || row.photo_url || cleanRes?.photoUrl)
          },
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        } as any);
      } else {
        const updatePayload: any = {
          status: row.status,
          progressPercent: row.progress_percent,
          statusMessage: row.status_message,
          result: (cleanRes && !cleanRes.is_r2) ? cleanRes : (existing.result || cleanRes),
          mealBuild: cleanRes?.mealBuild || existing.mealBuild,
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
      }
    }
  } catch (e) {
    console.warn('[SupabaseJobSync] Error hydrating user jobs:', e);
  }
}

export function fetchJobsFromSupabase(userId?: string) {
  return hydrateUserJobs(userId);
}

export function initSupabaseJobSync(userId?: string): () => void {
  // Always hydrate initial jobs from server API on mount
  hydrateUserJobs(userId);

  if (!isSupabaseConfigured) {
    console.log('[SupabaseJobSync] Supabase not configured, realtime job sync disabled');
    return () => {};
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
            deleteJobFromBackend(row.id, userId || 'anonymous');
          }
          return;
        }

        const processRow = async () => {
          const rowUpdatedAt = row.updated_at || '';

          let cleanRes = row.clean_result;
          if (cleanRes && typeof cleanRes === 'object' && cleanRes.is_r2 && cleanRes.r2_url) {
            try {
              // Bypassing client-side CORS issues by fetching through our own backend proxy endpoint
              const baseUrl = typeof window !== 'undefined' ? '' : 'http://localhost:3000';
              const r = await fetch(`${baseUrl}/api/jobs/status?jobId=${row.id}`);
              if (r.ok) {
                const fetchedWrapper = await r.json();
                if (fetchedWrapper && fetchedWrapper.jobs && fetchedWrapper.jobs.length > 0) {
                  // Our backend automatically unwraps the R2 result when fetching
                  const backendJob = fetchedWrapper.jobs[0];
                  if (backendJob && backendJob.clean_result) {
                    cleanRes = backendJob.clean_result;
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
              photoUrl: row.photo_url || cleanRes.photoUrl,
              debugUrl: row.debug_url || cleanRes.debugUrl,
            };
          }

          if (row.status === 'awaiting_user' && cleanRes) {
            const clarifyMsg = cleanRes.message || row.status_message || 'Confirm how much you ate';
            const previousMsgs = (existingJob?.messages || []).filter((m: any) => m.id !== `msg_assistant_clarify_${row.id}`);
            updatedFields.messages = [
              ...previousMsgs,
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
              }
            ];
          }

          const rowPhotoUrl = row.photo_url || cleanRes?.photoUrl;
          const rowDebugUrl = row.debug_url || cleanRes?.debugUrl;
          if (rowPhotoUrl) {
            updatedFields.photoUrl = rowPhotoUrl;
            updatedFields.inputSnapshot = {
              ...(existingJob?.inputSnapshot || {}),
              hasImage: true
            } as any;
          }
          if (rowDebugUrl) {
            updatedFields.debugUrl = rowDebugUrl;
          }

          if (existingJob) {
            JobStore.updateJob(row.id, updatedFields);
          } else {
            JobStore.createJob({
              id: row.id,
              kind: row.kind || 'food',
              mode: row.mode || 'review',
              status: row.status,
              progressPercent: row.progress_percent || 0,
              statusMessage: row.status_message || '',
              messages: updatedFields.messages || [],
              result: (cleanRes && !cleanRes.is_r2) ? cleanRes : undefined,
              photoUrl: rowPhotoUrl,
              debugUrl: rowDebugUrl,
              inputSnapshot: {
                text: row.raw_text || cleanRes?.raw_text || '',
                hasImage: !!rowPhotoUrl
              },
              createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
            } as any);
          }
        };

        processRow().catch(err => {
          console.error('[SupabaseJobSync] Error processing realtime row:', err);
        });
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export async function upsertJobToSupabase(
  job: AgentJob,
  userId: string = 'anonymous',
  photoUrl?: string,
  debugUrl?: string,
  cleanResult?: any
): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    let finalCleanResult = cleanResult || job.result || null;
    if (job.mealBuild) {
      finalCleanResult = {
        ...(finalCleanResult || {}),
        mealBuild: job.mealBuild
      };
    }

    const payload = {
      id: job.id,
      user_id: userId,
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
    
    // Push through the server to avoid exposing anon keys / RLS issues directly from client for writes
    const res = await fetch('/api/jobs/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload }),
    });
    if (!res.ok) {
      throw new Error('Failed to upsert job via backend');
    }
  } catch (err) {
    console.warn('[SupabaseJobSync] Failed to upsert job to backend/Supabase:', err);
  }
}

export async function deleteJobFromBackend(
  jobId: string,
  userId: string = 'anonymous'
): Promise<void> {
  if (!jobId) return;
  try {
    const baseUrl = typeof window !== 'undefined' ? '' : 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/jobs/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, userId }),
    });
    if (!res.ok) {
      console.warn('[SupabaseJobSync] Failed to delete job from backend:', res.statusText);
    }
  } catch (err) {
    console.warn('[SupabaseJobSync] Error deleting job from backend:', err);
  }
}