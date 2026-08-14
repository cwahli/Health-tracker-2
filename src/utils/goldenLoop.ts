/**
 * Guarded golden loop. One pipeline cycle per call.
 * Call again only after a recorded attempt (code/catalog change).
 * Never re-runs the same red fingerprint forever.
 */
import { loopRedClass } from './goldenStudio';

export const GOLDEN_LOOP_MAX_ITERS = 5;
export const GOLDEN_LOOP_TRANSPORT_RETRIES = 1;

export type GoldenLoopStopReason =
  | 'green'
  | 'max_iterations'
  | 'no_progress'
  | 'transport'
  | 'no_scout'
  | 'locked'
  | 'needs_attempt'
  | 'needs_new_analyze';

export type GoldenLoopDecision =
  | { action: 'continue'; reason: null }
  | { action: 'stop'; reason: GoldenLoopStopReason };

export type GoldenLoopState = {
  fingerprints: string[];
  pipelineRuns: number;
  lastStop: GoldenLoopStopReason | null;
  lastLoopAt: string | null;
  lastAttemptAt: string | null;
  locked: boolean;
};

export function emptyLoopState(): GoldenLoopState {
  return {
    fingerprints: [],
    pipelineRuns: 0,
    lastStop: null,
    lastLoopAt: null,
    lastAttemptAt: null,
    locked: false,
  };
}

export function fingerprintReds(input: {
  outcomes?: Array<{ id?: string; label?: string; pass?: boolean | null; enabled?: boolean }>;
  mealMisses?: string[];
  journey?: Array<{ id?: string; identityPass?: boolean }>;
  /** When set, accept-only reds are omitted so a doughnut kcal-only row cannot loop forever. */
  omitAccept?: boolean;
}): string {
  const redOut = (input.outcomes || [])
    .filter((o) => o.enabled !== false && o.pass === false)
    .filter((o) => {
      if (input.omitAccept === false) return true;
      return loopRedClass(String(o.id || ''), String(o.label || '')) !== 'accept';
    })
    .map((o) => String(o.id || ''))
    .filter(Boolean)
    .sort();
  const redJourney = (input.journey || [])
    .filter((j) => j.identityPass === false)
    .map((j) => String(j.id || ''))
    .filter(Boolean)
    .sort();
  const misses = (input.mealMisses || []).slice().sort();
  return JSON.stringify({ o: redOut, j: redJourney, m: misses });
}

export function decideLoop(input: {
  allGreen: boolean;
  fingerprint: string;
  previousFingerprints?: string[];
  iteration: number;
  maxIterations?: number;
  transportFailed?: boolean;
  hasScout?: boolean;
  locked?: boolean;
  hasNewAttemptSinceLastLoop?: boolean;
  alreadyRanThisFingerprint?: boolean;
  /** False when leftover reds need a human NEW Analyze (or are accept-only). */
  mayLoop?: boolean;
}): GoldenLoopDecision {
  if (input.locked) return { action: 'stop', reason: 'locked' };
  if (input.hasScout === false) return { action: 'stop', reason: 'no_scout' };
  if (input.allGreen) return { action: 'stop', reason: 'green' };
  if (input.mayLoop === false) return { action: 'stop', reason: 'needs_new_analyze' };
  if (input.transportFailed) return { action: 'stop', reason: 'transport' };

  const max = Math.max(1, Math.min(input.maxIterations ?? GOLDEN_LOOP_MAX_ITERS, GOLDEN_LOOP_MAX_ITERS));
  if (input.iteration >= max) return { action: 'stop', reason: 'max_iterations' };

  const prev = input.previousFingerprints || [];
  const sameAsLast = prev.length > 0 && prev[prev.length - 1] === input.fingerprint;
  if (sameAsLast && input.hasNewAttemptSinceLastLoop === false) {
    return { action: 'stop', reason: 'needs_attempt' };
  }
  if (sameAsLast || input.alreadyRanThisFingerprint) {
    return { action: 'stop', reason: 'no_progress' };
  }

  return { action: 'continue', reason: null };
}

export function nextLoopState(
  prev: GoldenLoopState,
  update: {
    fingerprint: string;
    stop: GoldenLoopStopReason | null;
    pipelineRan: boolean;
    attemptAt?: string | null;
  }
): GoldenLoopState {
  const fingerprints = [...(prev.fingerprints || []), update.fingerprint].slice(-12);
  const locked =
    update.stop === 'max_iterations' ||
    update.stop === 'no_progress' ||
    update.stop === 'locked' ||
    (prev.locked && update.stop !== 'green');
  return {
    fingerprints,
    pipelineRuns: (prev.pipelineRuns || 0) + (update.pipelineRan ? 1 : 0),
    lastStop: update.stop,
    lastLoopAt: new Date().toISOString(),
    lastAttemptAt: update.attemptAt ?? prev.lastAttemptAt,
    locked: update.stop === 'green' ? false : locked,
  };
}

export function loopStopMessage(reason: GoldenLoopStopReason | null): string {
  switch (reason) {
    case 'green':
      return 'All blocking checks green (accept-only rows do not count).';
    case 'needs_new_analyze':
      return 'Loop will not run. Remaining reds are frozen in scout (or accept-only). Human: NEW Analyze with the same photos. Studio must not POST /loop again.';
    case 'max_iterations':
      return `Stopped after ${GOLDEN_LOOP_MAX_ITERS} pipeline runs. Record what you learned and open a new issue if the class of bug is different.`;
    case 'no_progress':
      return 'Same reds as last run — the loop will not repeat the same attempt. Change catalog/code, log an attempt, then run again.';
    case 'needs_attempt':
      return 'Last run already produced this board. Write an attempt (what you changed) before running the loop again.';
    case 'transport':
      return 'Pipeline replay hit quota/stall/timeout. Not a food bug. Switch model or wait, then retry once.';
    case 'no_scout':
      return 'No frozen scout — cannot loop. Fix Vision Scout / quota first.';
    case 'locked':
      return 'Loop is locked after repeated no-progress. Unlock only after a new attempt is logged.';
    default:
      return 'Still red — fix, log an attempt, run again.';
  }
}
