import { describe, it, expect } from 'vitest';
import { pickSnapshotJob } from './goldenFixture';

describe('pickSnapshotJob', () => {
  it('picks a new success over an older stalled failure', () => {
    const jobs = [
      {
        id: 'job_100_fail',
        kind: 'food',
        status: 'failed',
        updatedAt: '2026-08-13T10:00:00.000Z',
        error: { message: 'Stream stalled: No response from analysis engine within 90s.' },
      },
      {
        id: 'job_200_ok',
        kind: 'food',
        status: 'succeeded',
        updatedAt: '2026-08-13T10:05:00.000Z',
        result: { pendingFoodLog: { name: 'Picnic' } },
      },
    ];
    expect(pickSnapshotJob(jobs)?.id).toBe('job_200_ok');
  });

  it('picks a newer failure over an older success', () => {
    const jobs = [
      { id: 'job_100_ok', kind: 'food', status: 'succeeded', updatedAt: '2026-08-13T10:00:00.000Z' },
      { id: 'job_200_fail', kind: 'food', status: 'failed', updatedAt: '2026-08-13T10:06:00.000Z' },
    ];
    expect(pickSnapshotJob(jobs)?.id).toBe('job_200_fail');
  });
});
