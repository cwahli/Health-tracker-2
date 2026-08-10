import { JobStore } from './JobStore';
import { AgentJob } from './types';
import { uploadPhotoToR2, uploadDebugPayloadToR2 } from '../utils/r2Storage';
import { upsertJobToSupabase } from './SupabaseJobSync';
import { ImageStore } from './ImageStore';
import { auth } from '../firebase';

export type JobExecutor = (job: AgentJob, abortSignal: AbortSignal) => Promise<void>;

import { executeFoodAgent } from './FoodAgentExecutor';

class JobQueueRunnerImpl {
  private isRunning = false;
  private consecutiveFailures = 0;
  private circuitBreakerPaused = false;
  private executor: JobExecutor = async (job, signal) => {
    if (job.kind === 'food_log' || job.kind === 'food_compare') {
      const rawImages = (await ImageStore.getImages(job.id)) || [];
      const stringImages: string[] = await Promise.all(
        rawImages.map(async (img) => {
          if (typeof img === 'string') return img;
          if (img && typeof img === 'object') {
            const blob = img instanceof Blob ? img : new Blob([img as any], { type: (img as any).type || 'image/jpeg' });
            return new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => resolve('');
              reader.readAsDataURL(blob);
            });
          }
          return '';
        })
      );
      const cleanImages = stringImages.filter(Boolean);
      const isDietitianResume = job.resumeStage === 'dietitian';
      const executorInput = {
        jobId: job.id,
        text: job.inputSnapshot?.text || '',
        images: cleanImages,
        mode: (job.mode as 'review' | 'compare' | 'edit') || 'review',
        lockedModeFamily: job.lockedModeFamily,
        profile: job.inputSnapshot?.profile || {},
        modelId: job.inputSnapshot?.modelId || 'gemini-3.5-flash-lite',
        requestId: job.requestId || job.id,
        checkpoint: job.checkpoint,
        signal,
        activeScoutItems: job.checkpoint?.scoutItems,
        scoutContentType: job.checkpoint?.scoutContentType,
        skipScout: !!job.checkpoint?.scoutItems || isDietitianResume,
        portionChoices: (job.inputSnapshot as any)?.portionChoices,
        messages: job.messages || [],
      };

      for await (const event of executeFoodAgent(executorInput)) {
        if (event.type === 'progress') {
          JobStore.updateJob(job.id, {
            stepKey: event.stepKey || job.stepKey,
            progressPercent: event.progressPercent !== undefined ? event.progressPercent : job.progressPercent,
            statusMessage: event.statusMessage || job.statusMessage,
          });
        } else if (event.type === 'checkpoint') {
          import('../mealBuild/consolidate').then(({ consolidateMeal }) => {
             const m = job.mealBuild || { id: job.id, schemaVersion: 1, version: 1, items: [], status: 'draft', createdAt: new Date().toISOString() } as any;
             const updated = consolidateMeal(m, { items: event.checkpoint?.scoutItems || [] }, 'scout');
             JobStore.updateJob(job.id, {
               checkpoint: event.checkpoint,
               mealBuild: updated,
               stepKey: 'scout',
               progressPercent: 35,
               statusMessage: 'Scout checkpoint saved',
             });
          });
        } else if (event.type === 'partial') {
          JobStore.updateJob(job.id, {
            liveThoughts: event.partialThoughts,
          });
        } else if (event.type === 'done') {
          const res = event.data || {};
          const mb = res.mealBuild || res.data?.mealBuild || job.mealBuild;
          
          if (res.portionClarify || res.needsPortionClarify) {
            JobStore.updateJob(job.id, {
              status: 'awaiting_user',
              result: res,
              mealBuild: mb,
              statusMessage: 'Please confirm portion size',
            });
          } else {
            JobStore.updateJob(job.id, {
              result: res,
              mealBuild: mb,
              progressPercent: 100,
              statusMessage: 'Analysis completed',
            });
          }
        } else if (event.type === 'error') {
          const err = new Error(event.message || 'Execution error');
          (err as any).class = event.errorClass || 'transient';
          if (event.checkpoint) {
            (err as any).scoutItems = event.checkpoint.scoutItems;
            (err as any).scoutContentType = event.checkpoint.scoutContentType;
          }
          if (event.portionClarify) {
            (err as any).portionClarify = event.portionClarify;
          }
          throw err;
        }
      }
    }
  };

  private resolveSleep: (() => void) | null = null;
  private handleVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      console.log('[JobQueueRunner] Document became visible. Waking queue runner...');
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

      JobStore.updateJob(job.id, {
        status: 'succeeded',
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
