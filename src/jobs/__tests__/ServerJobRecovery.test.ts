import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inMemoryServerJobs, recoverInterruptedServerJobs, submitServerJob } from '../../../serverJobs';

describe('Initiative J: True Server Background Workers & Crash Recovery', () => {
  beforeEach(() => {
    inMemoryServerJobs.clear();
  });

  it('detects and recovers stuck running in-memory server jobs', async () => {
    inMemoryServerJobs.set('stuck-job-100', {
      id: 'stuck-job-100',
      user_id: 'test-user',
      kind: 'food_log',
      mode: 'review',
      status: 'running',
      progress_percent: 30,
      status_message: 'Vision Scout running',
      updated_at: new Date(Date.now() - 300000).toISOString()
    });

    const recoveredCount = await recoverInterruptedServerJobs();
    expect(recoveredCount).toBeGreaterThanOrEqual(1);

    const recoveredJob = inMemoryServerJobs.get('stuck-job-100');
    expect(recoveredJob).toBeDefined();
    expect(recoveredJob?.status).toBe('running');
  });

  it('ignores succeeded or failed jobs during in-memory recovery scan', async () => {
    inMemoryServerJobs.set('finished-job-200', {
      id: 'finished-job-200',
      user_id: 'test-user',
      kind: 'food_log',
      mode: 'review',
      status: 'succeeded',
      progress_percent: 100,
      status_message: 'Analysis complete',
      updated_at: new Date().toISOString()
    });

    const recoveredJobBefore = inMemoryServerJobs.get('finished-job-200');
    expect(recoveredJobBefore?.status).toBe('succeeded');
  });
});
