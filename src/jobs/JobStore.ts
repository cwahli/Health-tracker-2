import { AgentJob } from './types';
import { ImageStore } from './ImageStore';
import { MealBuild } from '../mealBuild/types';
import { rebaseUserEdit } from '../mealBuild/consolidate';
import { deleteJobFromBackend, upsertJobToSupabase } from './SupabaseJobSync';

type Listener = () => void;

function serializeJobs(jobs: AgentJob[]): string {
  return JSON.stringify(jobs, (key, value) => {
    if (key === 'abortController') return undefined;
    if (typeof value === 'string' && (value.startsWith('data:image/') || (value.length > 50000 && value.includes('base64')))) {
      return 'Image reference preserved';
    }
    return value;
  });
}

export function isJobBlank(job: Partial<AgentJob> | undefined | null): boolean {
  if (!job) return true;
  // Draft jobs are unsubmitted client-side composer states, not background AI analysis tasks
  if (job.status === 'draft') return true;

  const hasText = !!(
    job.inputSnapshot?.text &&
    job.inputSnapshot.text.trim() &&
    job.inputSnapshot.text.trim() !== 'Analyze this meal photo.'
  );

  const hasImage = !!(
    job.photoUrl ||
    job.debugUrl ||
    job.inputSnapshot?.hasImage ||
    (job.inputSnapshot?.imageRefs && job.inputSnapshot.imageRefs.length > 0) ||
    (job.inputSnapshot?.imageUrls && job.inputSnapshot.imageUrls.length > 0)
  );

  const pendingLog =
    job.result?.pendingFoodLog ||
    job.result?.clean_result?.pendingFoodLog ||
    job.result?.raw?.data ||
    job.result?.data ||
    job.result?.foodData ||
    job.result?.mealBuild?.content ||
    job.mealBuild?.content ||
    job.messages?.find((m: any) => m.pendingFoodLog)?.pendingFoodLog ||
    job.messages?.find((m: any) => m.data?.pendingFoodLog)?.data?.pendingFoodLog;

  const hasFoodData = !!(
    pendingLog?.foodName ||
    pendingLog?.name ||
    pendingLog?.title ||
    pendingLog?.summary ||
    (pendingLog?.items && pendingLog.items.length > 0) ||
    (pendingLog?.itemsBreakdown && pendingLog.itemsBreakdown.length > 0) ||
    (pendingLog?.calories && pendingLog.calories > 0) ||
    (job.result?.items && job.result.items.length > 0) ||
    (job.result?.scoutItems && job.result.scoutItems.length > 0) ||
    (job.mealBuild?.items && job.mealBuild.items.length > 0) ||
    (job.mealBuild?.content?.name && job.mealBuild.content.name !== 'Meal')
  );

  const hasMedicalData = !!(
    (job.result?.biomarkers && Object.keys(job.result.biomarkers).length > 0) ||
    job.result?.extractedData ||
    job.result?.doctorSummary
  );

  const hasSummary = !!(
    job.result?.summary ||
    job.result?.doctorSummary ||
    (typeof job.result?.text === 'string' && job.result.text.trim().length > 0) ||
    (typeof job.result?.message === 'string' && job.result.message.trim().length > 0)
  );

  const hasResult = hasFoodData || hasMedicalData || hasSummary;
  const isActivelyProcessing =
    job.status === 'queued' ||
    job.status === 'running' ||
    job.status === 'processing' ||
    job.status === 'awaiting_user';

  const hasMeaningfulMessages = !!(
    job.messages &&
    job.messages.length > 0 &&
    job.messages.some((m: any) => m.content?.trim() || m.pendingFoodLog || m.data?.pendingFoodLog)
  );

  const hasError = !!job.error?.message;

  // If it has NO input AND NO result AND is NOT actively processing AND has NO error AND has NO meaningful messages -> it's blank
  if (!hasText && !hasImage && !hasResult && !isActivelyProcessing && !hasError && !hasMeaningfulMessages) {
    return true;
  }

  // If status is 'succeeded' or 'cancelled' but it has zero food/medical result and zero text/image input -> it's a blank phantom job
  if ((job.status === 'succeeded' || job.status === 'cancelled') && !hasText && !hasImage && !hasResult) {
    return true;
  }

  return false;
}

class JobStoreImpl {
  private jobs: Map<string, AgentJob> = new Map();
  private deletedJobIds: Set<string> = new Set();
  private listeners: Set<Listener> = new Set();
  private maxQueued = 5;

  constructor() {
    this.loadJobs();
    // Cleanup orphaned images from past sessions (Phase 3 TTL)
    setTimeout(() => {
      this.cleanupOldJobs();
    }, 1000);
  }

  isJobDeleted(id: string): boolean {
    return this.deletedJobIds.has(id);
  }

  private loadJobs() {
    try {
      if (typeof localStorage === 'undefined') return;
      const storedDeleted = localStorage.getItem('jobstore_deleted_ids');
      if (storedDeleted) {
        try {
          const parsed = JSON.parse(storedDeleted) as string[];
          if (Array.isArray(parsed)) {
            this.deletedJobIds = new Set(parsed);
          }
        } catch (e) {
          console.warn('Error loading deleted job IDs:', e);
        }
      }

      const stored = localStorage.getItem('jobstore_jobs');
      if (stored) {
        const parsed = JSON.parse(stored) as AgentJob[];
        for (const job of parsed) {
          delete job.abortController;
          // Draft jobs are ephemeral composer sessions and should not be restored as persistent background jobs
          if (job.status === 'draft') {
            continue;
          }
          if (isJobBlank(job)) {
            continue;
          }
          if (job.status === 'running') {
            const hasServerJob = !!(job.result?.jobId || job.requestId);
            if (!hasServerJob) {
              job.status = 'cancelled';
              job.finishedAt = new Date().toISOString();
              job.cancelReason = 'Analysis interrupted by browser reload';
            }
          }
          if (!this.deletedJobIds.has(job.id)) {
            this.jobs.set(job.id, job);
          }
        }
      }
    } catch (e) {
      console.warn('Error loading jobs from localStorage:', e);
    }
  }

  private saveDeletedJobIds() {
    try {
      if (typeof localStorage === 'undefined') return;
      const arr = Array.from(this.deletedJobIds).slice(-500);
      localStorage.setItem('jobstore_deleted_ids', JSON.stringify(arr));
    } catch {
      // Silently catch quota errors
    }
  }

  private saveJobs() {
    try {
      if (typeof localStorage === 'undefined') return;
      const allJobs = Array.from(this.jobs.values());
      let json = serializeJobs(allJobs);

      try {
        localStorage.setItem('jobstore_jobs', json);
        return;
      } catch (quotaError) {
        // Separate active vs completed jobs
        const activeJobs = allJobs.filter(j => j.status === 'queued' || j.status === 'running' || j.status === 'draft');
        const finishedJobs = allJobs
          .filter(j => j.status === 'succeeded' || j.status === 'failed' || j.status === 'cancelled')
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        // Keep at most 2 most recent finished jobs when quota is tight and strip heavy logs/messages
        const keptFinished = finishedJobs.slice(0, 2).map(j => ({
          ...j,
          liveThoughts: undefined,
          messages: j.messages ? j.messages.slice(-2) : []
        }));
        const keptJobs = [...activeJobs, ...keptFinished];

        // Purge pruned jobs from in-memory map and ImageStore
        const keptIds = new Set(keptJobs.map(j => j.id));
        for (const [id] of this.jobs) {
          if (!keptIds.has(id)) {
            this.jobs.delete(id);
            ImageStore.purgeImages(id).catch(() => {});
          }
        }

        try {
          json = serializeJobs(keptJobs);
          localStorage.setItem('jobstore_jobs', json);
        } catch {
          // If still exceeding, save minimal job records with only core fields
          const minimalJobs = keptJobs.map(j => ({
            id: j.id,
            kind: j.kind,
            mode: j.mode,
            status: j.status,
            progressPercent: j.progressPercent,
            createdAt: j.createdAt,
            finishedAt: j.finishedAt
          }));
          try {
            localStorage.setItem('jobstore_jobs', JSON.stringify(minimalJobs));
          } catch {
            // Silently retain in-memory state if localStorage is completely filled
          }
        }
      }
    } catch {
      // Silently catch unexpected errors
    }
  }

  private async cleanupOldJobs() {
    const now = Date.now();
    const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours for succeeded jobs
    const failedMaxAgeMs = 2 * 60 * 60 * 1000; // 2 hours for failed/cancelled jobs
    const finishedJobs: AgentJob[] = [];

    for (const job of this.jobs.values()) {
      if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
        finishedJobs.push(job);
      }
    }

    // Sort by createdAt descending
    finishedJobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const jobsToDelete: string[] = [];

    // Delete any lingering blank jobs or stale drafts
    for (const job of this.jobs.values()) {
      if (isJobBlank(job)) {
        jobsToDelete.push(job.id);
      }
    }

    // Delete jobs older than 24 hours OR beyond the 15 most recent finished jobs
    finishedJobs.forEach((job, index) => {
      const createdAtTime = new Date(job.createdAt).getTime();
      const isFailed = job.status === 'failed' || job.status === 'cancelled';
      const isExpired = now - createdAtTime > (isFailed ? failedMaxAgeMs : maxAgeMs);
      const isExcess = index >= 15;
      if (isExpired || isExcess) {
        jobsToDelete.push(job.id);
      }
    });

    for (const id of jobsToDelete) {
      this.jobs.delete(id);
      await ImageStore.purgeImages(id);
    }

    if (jobsToDelete.length > 0) {
      this.saveJobs();
      this.notify();
    }

    // Also purge orphaned images from ImageStore older than 24 hours
    await ImageStore.purgeAllOldImages(maxAgeMs);
  }

  createJob(params: Partial<AgentJob> & { id: string }): AgentJob {
    if (params.id && this.deletedJobIds.has(params.id)) {
      // Do not recreate or resurrect a deleted job
      return { id: params.id, status: 'cancelled', ...params } as AgentJob;
    }
    const job: AgentJob = {
      kind: 'food_log',
      status: 'draft',
      stepIndex: 0,
      stepTotal: 1,
      progressPercent: 0,
      messages: [],
      inputSnapshot: { text: '', imageRefs: [] },
      attemptByStep: {},
      attemptCount: params.attemptCount || 1,
      maxAttempts: params.maxAttempts || 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...params,
      id: params.id,
    };
    this.jobs.set(job.id, job);
    this.saveJobs();
    this.notify();
    return job;
  }

  updateJob(id: string, patch: Partial<AgentJob>) {
    if (this.deletedJobIds.has(id)) {
      if (this.jobs.has(id)) {
        this.jobs.delete(id);
        this.saveJobs();
        this.notify();
      }
      return;
    }
    const job = this.jobs.get(id);
    if (!job) return;

    if (patch.status === 'queued') {
      const queuedCount = this.getQueue().length;
      if (job.status !== 'queued' && queuedCount >= this.maxQueued) {
        throw new Error('maxQueued limit reached');
      }
    }

    Object.assign(job, { ...patch, updatedAt: new Date().toISOString() });
    this.saveJobs();
    this.notify();

    // Auto-sync completed / ready jobs to cloud so they appear across all user devices
    if (patch.status === 'succeeded' || patch.status === 'awaiting_user' || (job.status === 'succeeded' && patch.result)) {
      upsertJobToSupabase(job).catch(() => {});
    }
  }

  async deleteJob(id: string) {
    if (id) {
      this.deletedJobIds.add(id);
      this.saveDeletedJobIds();
    }
    if (this.jobs.has(id)) {
      this.jobs.delete(id);
      this.saveJobs();
      this.notify();
    } else {
      this.notify();
    }
    // Draft cleanup auto-purges associated ImageStore entries
    await ImageStore.purgeImages(id);
    // Asynchronously delete job from backend / Supabase
    deleteJobFromBackend(id).catch((err) => console.warn('Failed to dispatch backend job deletion:', err));
  }

  rebaseJobMealEdit(
    id: string,
    localUserPatch: Partial<MealBuild>,
    serverMeal: MealBuild
  ): { rebasedMeal: MealBuild; success: boolean } {
    const existingJob = this.getJob(id);
    const currentAttempt = (existingJob?.mealBuild?.stageLedger?.filter((s) => s.actor === 'user')?.length || 0) + 1;
    const result = rebaseUserEdit(serverMeal, localUserPatch, currentAttempt);
    if (existingJob) {
      this.updateJob(id, {
        mealBuild: result.rebasedMeal,
        result: {
          ...(existingJob.result || {}),
          mealBuild: result.rebasedMeal,
        },
      });
    }
    return result;
  }

  getJob(id: string): AgentJob | undefined {
    if (this.deletedJobIds.has(id)) return undefined;
    return this.jobs.get(id);
  }

  getAllJobs(): AgentJob[] {
    return Array.from(this.jobs.values())
      .filter((j) => !this.deletedJobIds.has(j.id))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  getQueue(): AgentJob[] {
    return this.getAllJobs().filter((j) => j.status === 'queued');
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clearForTests() {
    this.jobs.clear();
    this.deletedJobIds.clear();
    this.listeners.clear();
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }
}

export const JobStore = new JobStoreImpl();
