import { describe, it, expect, beforeEach } from 'vitest';
import { inMemoryServerJobs, publishResultReady, getInMemoryServerJob } from './serverJobs';

describe('publishResultReady (display as soon as meal exists)', () => {
  beforeEach(() => {
    inMemoryServerJobs.clear();
  });

  it('flips running → succeeded with pendingFoodLog before any R2 wait', () => {
    inMemoryServerJobs.set('job_now', {
      id: 'job_now',
      status: 'running',
      progress_percent: 15,
      status_message: 'Vision Scout starting...',
      clean_result: null,
      sessionEvents: [],
    });
    const published = publishResultReady('job_now', {
      pendingFoodLog: { name: 'Soto', nutrients: { calories: 571 } },
      message: 'You got 28g of protein.',
    });
    expect(published).toBe(true);
    const job = getInMemoryServerJob('job_now');
    expect(job.status).toBe('succeeded');
    expect(job.progress_percent).toBe(100);
    expect(job.clean_result.pendingFoodLog.nutrients.calories).toBe(571);
    expect(job.sessionEvents.some((e: any) => e.action === 'result_ready')).toBe(true);
  });

  it('does not republish once a meal is already on the job', () => {
    inMemoryServerJobs.set('job_once', {
      id: 'job_once',
      status: 'succeeded',
      clean_result: { pendingFoodLog: { name: 'Soto', nutrients: { calories: 571 } } },
    });
    expect(
      publishResultReady('job_once', {
        pendingFoodLog: { name: 'Soto', nutrients: { calories: 999 } },
      })
    ).toBe(false);
    expect(getInMemoryServerJob('job_once').clean_result.pendingFoodLog.nutrients.calories).toBe(571);
  });
});
