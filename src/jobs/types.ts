import { MealBuild } from '../mealBuild/types';

export type JobStatus = 'draft' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancel_requested' | 'cancelled' | 'awaiting_user' | 'processing';
export type ErrorClass = 'permanent' | 'transient' | 'retriable_from_checkpoint';
export type JobKind = 'food_log' | 'food_compare' | 'front_desk' | 'medical' | string;

export interface AgentJob {
  id: string;
  viewed?: boolean;
  kind: JobKind;
  mode?: string;
  lockedModeFamily?: string;
  status: JobStatus;
  stepIndex: number;
  stepTotal: number;
  stepKey?: string;
  progressPercent: number;
  statusMessage?: string;
  messages: any[];
  inputSnapshot: {
    text: string;
    imageRefs: string[];
    profile?: any;
    modelId?: string;
    imageDates?: any[];
    [key: string]: any;
  };
  checkpoint?: any;
  mealBuild?: MealBuild;
  resumeStage?: string;
  liveThoughts?: {
    scout?: string;
    dietitian?: string;
    backendLogs?: string;
    dbSearchLog?: string;
    activeStage?: string;
    globalLiveLogs?: string;
  };
  savedToLog?: boolean;
  result?: any;
  error?: {
    class: ErrorClass;
    message: string;
    scoutItems?: any[];
    scoutContentType?: string;
    portionClarify?: any;
  };
  requestId?: string;
  attemptByStep: Record<string, number>;
  attemptCount?: number;
  maxAttempts?: number;
  creditReserved?: number;
  creditSettled?: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  photoUrl?: string;
  debugUrl?: string;
  retryNotBefore?: string;
  serverSubmittedAt?: number; // ISO date string
  /** Client is already POSTing /api/jobs/submit — runner must not submit a second analyze. */
  clientSubmitPending?: boolean;
  /** Epoch ms when the current edit/analyze turn started. Preview stays in processing until a later finishedAt. */
  inFlightTurnAt?: number;
  /** Session turn. Increments on every submit. Incoming rows with a smaller turn are ignored. */
  currentTurn?: number;
  lastProgressAt?: string;
  abortController?: AbortController;
  cancelReason?: string;
}

/* 'awaiting_user' */
