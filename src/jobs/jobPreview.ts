import { AgentJob, JobStatus } from './types';

export function isTurnInFlight(
  job: Pick<AgentJob, 'status' | 'inFlightTurnAt' | 'finishedAt'> & { currentTurn?: number }
): boolean {
  if (typeof job.inFlightTurnAt === 'number') {
    return !job.finishedAt || new Date(job.finishedAt).getTime() < job.inFlightTurnAt;
  }
  if (typeof job.currentTurn === 'number') {
    return job.status === 'queued' || job.status === 'running' || job.status === 'processing';
  }
  return job.status === 'queued' || job.status === 'running' || job.status === 'processing';
}

export function previewStatus(job: AgentJob): AgentJob['status'] {
  if (isTurnInFlight(job) && (job.status === 'succeeded' || job.status === 'awaiting_user')) {
    return 'running';
  }
  return job.status;
}

export function isEditJob(job: Pick<AgentJob, 'mode' | 'inputSnapshot' | 'messages'>): boolean {
  return (
    job.inputSnapshot?.mode === 'edit' ||
    job.mode === 'edit' ||
    job.mode === 'modify' ||
    !!(job.messages && job.messages.filter((m: any) => !m.isLive).length > 2)
  );
}

function isPreviewFailed(job: AgentJob, lastMsgContent?: string): boolean {
  const effectiveStatus = previewStatus(job);
  if (effectiveStatus === 'failed' || effectiveStatus === 'cancelled' || effectiveStatus === 'cancel_requested') {
    return true;
  }
  if (effectiveStatus === 'succeeded') return false;
  return (
    !!job.error ||
    (typeof job.statusMessage === 'string' && /(?:timed out|analysis failed|server error)/i.test(job.statusMessage) && !/analysis complete/i.test(job.statusMessage)) ||
    (typeof job.result?.message === 'string' && /(?:timed out|analysis failed)/i.test(job.result.message)) ||
    (typeof job.result?.error === 'string' && !!job.result.error) ||
    (typeof lastMsgContent === 'string' && /(?:timed out|analysis failed|server error)/i.test(lastMsgContent) && !job.result?.pendingFoodLog && !job.result?.modificationCommand && !job.result?.extractedData)
  );
}

export function previewStatusLabel(
  job: AgentJob,
  opts?: { queuedAhead?: number; lastMsgContent?: string }
): string {
  const effectiveStatus = previewStatus(job);
  const edit = isEditJob(job);
  if (effectiveStatus === 'succeeded' && Array.isArray(job.result?.degradedStages) && job.result.degradedStages.includes('dietitian')) {
    return 'AI advice pending';
  }
  if (isPreviewFailed(job, opts?.lastMsgContent)) {
    return 'Analysis failed';
  }
  const statusKey = effectiveStatus as JobStatus;
  switch (statusKey) {
    case 'queued': {
      if (edit) return 'Updating meal • Queued';
      const ahead = opts?.queuedAhead ?? 0;
      return ahead > 0 ? `Waiting — ${ahead} ahead` : 'Uploaded • Queued on server';
    }
    case 'running':
    case 'processing':
      return edit ? 'Updating meal...' : `Attempt ${job.attemptCount || 1} of ${job.maxAttempts || 3}`;
    case 'failed':
      return 'Analysis failed';
    case 'cancelled':
    case 'cancel_requested':
      return 'Analysis cancelled';
    case 'awaiting_user':
      return 'Action required';
    case 'succeeded':
      return 'Analysis completed';
    default:
      return 'Processing...';
  }
}
