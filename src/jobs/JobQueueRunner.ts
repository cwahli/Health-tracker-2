import { JobStore } from './JobStore';
import { AgentJob } from './types';
import { uploadPhotoToR2, uploadDebugPayloadToR2 } from '../utils/r2Storage';
import { upsertJobToSupabase } from './SupabaseJobSync';
import { ImageStore } from './ImageStore';
import { auth } from '../firebase';

export type JobExecutor = (job: AgentJob, abortSignal: AbortSignal) => Promise<void>;



class JobQueueRunnerImpl {
  private isRunning = false;
  private consecutiveFailures = 0;
  private circuitBreakerPaused = false;
  private executor: JobExecutor = async (job, signal) => {
    throw new Error('Default local executor is disabled. Jobs are processed server-side.');
  };

  private resolveSleep: (() => void) | null = null;

  private handleVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.wake();
    }
  };

  setExecutor(executor: JobExecutor) {
    this.executor = executor;
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.loop();
  }

  stop() {
    this.isRunning = false;
    this.circuitBreakerPaused = false;
    this.consecutiveFailures = 0;
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  wake() {
    if (this.resolveSleep) {
      const r = this.resolveSleep;
      this.resolveSleep = null;
      r();
    }
  }

  private async loop() {
    while (this.isRunning) {
      if (this.circuitBreakerPaused) {
        await this.sleep(5000);
        continue;
      }

      const queue = JobStore.getQueue();
      const now = new Date();

      const jobToRun = queue.find(
        (job) => !job.retryNotBefore || new Date(job.retryNotBefore) <= now
      );

      if (!jobToRun) {
        await this.sleep(1000);
        continue;
      }

      await this.runJob(jobToRun);
    }
  }

  private async runJob(job: AgentJob) {
    const controller = new AbortController();
    JobStore.updateJob(job.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
      abortController: controller,
    });

    try {
      await this.executor(job, controller.signal);
      
      const currentJobState = JobStore.getJob(job.id);
      if (currentJobState?.status === 'awaiting_user') {
        this.consecutiveFailures = 0;
        return;
      }
      if (currentJobState?.status === 'failed' || currentJobState?.status === 'cancelled') {
        if (currentJobState.status === 'failed') {
          this.consecutiveFailures++;
        } else {
          this.consecutiveFailures = 0;
        }
        return;
      }

      JobStore.updateJob(job.id, {
        status: 'succeeded',
        error: undefined,
        finishedAt: new Date().toISOString(),
        progressPercent: 100,
        retryNotBefore: undefined,
      });
      this.consecutiveFailures = 0;

      // Hybrid Cloud Storage (R3): Upload photo and debug payload to Cloudflare R2 & upsert clean result to Supabase
      const updatedJob = JobStore.getJob(job.id) || job;
      let photoUrl: string | undefined = updatedJob.result?.photoUrl;
      let debugUrl: string | undefined = updatedJob.result?.debugUrl;

      // Skip client double R2 upload & client upsert if server-owned job
      const isServerOwned = (job.kind === 'food_log' || job.kind === 'food_compare') && (photoUrl || debugUrl || updatedJob.result?.pendingFoodLog);
      if (isServerOwned) {
        return;
      }

      try {
        if (!photoUrl && !isServerOwned) {
          const images = await ImageStore.getImages(job.id);
          if (images && images.length > 0) {
            const firstImg = typeof images[0] === 'string' ? images[0] : '';
            if (firstImg) {
              photoUrl = await uploadPhotoToR2(job.id, firstImg);
            }
          }
        }

        if (updatedJob.result) {
          const debugData = {
            jobId: job.id,
            liveThoughts: updatedJob.liveThoughts,
            statusMessage: updatedJob.statusMessage,
            messages: updatedJob.messages,
            result: updatedJob.result,
          };
          debugUrl = await uploadDebugPayloadToR2(job.id, debugData);
        }

        let strippedResult = undefined;
        if (updatedJob.result) {
          strippedResult = { ...updatedJob.result };
          if (strippedResult.raw) delete strippedResult.raw;
          if (strippedResult.data?.raw) delete strippedResult.data.raw;
        }

        const cleanResult = strippedResult ? {
          ...strippedResult,
          photoUrl: photoUrl || strippedResult.photoUrl,
          debugUrl: debugUrl || strippedResult.debugUrl,
          mealBuild: strippedResult.mealBuild, // ensure mealBuild is persisted
        } : undefined;

        if (cleanResult) {
          JobStore.updateJob(job.id, {
            result: cleanResult,
          });
        }

        await upsertJobToSupabase(updatedJob, auth.currentUser?.uid || 'anonymous', photoUrl, debugUrl, cleanResult);
      } catch (r3Err) {
        console.warn('[JobQueueRunner] R3 hybrid storage post-processing warning:', r3Err);
      }
    } catch (error: any) {
      if (error.message === 'AbortError') {
        JobStore.updateJob(job.id, {
          status: 'cancelled',
          finishedAt: new Date().toISOString(),
        });
      } else {
        const AGENT_DELAYED_RETRY = false; // flag default off to avoid stacked 60s/300s retries
        const currentStep = job.stepKey || 'default';
        const currentAttempts = (job.attemptByStep?.[currentStep] || 0) + 1;
        const isTransient = error.class === 'transient';

        if (isTransient && currentAttempts < 3) {
          const delaySeconds = 3;
          const retryTime = new Date(Date.now() + delaySeconds * 1000);

          JobStore.updateJob(job.id, {
            status: 'queued',
            attemptByStep: {
              ...(job.attemptByStep || {}),
              [currentStep]: currentAttempts,
            },
            retryNotBefore: retryTime.toISOString(),
            statusMessage: `Rate limit / transient error (${error.message || 'Retrying'}). Auto-retrying in ${delaySeconds}s (attempt ${currentAttempts + 1}/3)...`,
          });
        } else {
          JobStore.updateJob(job.id, {
            status: 'failed',
            finishedAt: new Date().toISOString(),
            error: {
              class: error.class || 'permanent',
              message: error.message || 'Unknown error',
              scoutItems: error.scoutItems,
              scoutContentType: error.scoutContentType,
              portionClarify: error.portionClarify,
            },
          });
          
          if (error.class === 'permanent' || error.class === undefined) {
            this.consecutiveFailures++;
            if (this.consecutiveFailures >= 3) {
              this.circuitBreakerPaused = true;
              // Stub: unpause after 30 seconds
              setTimeout(() => {
                this.circuitBreakerPaused = false;
                this.consecutiveFailures = 0;
              }, 30000);
            }
          }
        }
      }
    } finally {
      // Clear the abort controller to prevent memory leaks
      JobStore.updateJob(job.id, { abortController: undefined });
    }
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      this.resolveSleep = resolve;
      setTimeout(() => {
        if (this.resolveSleep === resolve) {
          this.resolveSleep = null;
        }
        resolve();
      }, ms);
    });
  }
}

export const JobQueueRunner = new JobQueueRunnerImpl();

/* Cold R2 upload on fail uploadDebugPayloadToR2 status: 'failed' uploadDebugPayloadToR2 */
