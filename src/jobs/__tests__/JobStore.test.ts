import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobStore, isJobBlank } from '../JobStore';
import { ImageStore } from '../ImageStore';

vi.mock('idb-keyval', () => {
  const store = new Map();
  return {
    set: async (key: string, val: any) => store.set(key, val),
    get: async (key: string) => store.get(key),
    del: async (key: string) => store.delete(key),
    clear: async () => store.clear(),
  };
});

describe('JobStore', () => {
  beforeEach(() => {
    // Reset JobStore completely for isolated test runs
    JobStore.clearForTests();
  });

  it('creates, updates and deletes a job', async () => {
    const job = JobStore.createJob({ id: 'j1' });
    expect(job.status).toBe('draft');

    JobStore.updateJob('j1', { status: 'queued' });
    expect(JobStore.getJob('j1')?.status).toBe('queued');

    await JobStore.deleteJob('j1');
    expect(JobStore.getJob('j1')).toBeUndefined();
  });

  it('maintains FIFO order in getQueue', () => {
    JobStore.createJob({ id: 'j1' });
    JobStore.createJob({ id: 'j2' });
    
    JobStore.updateJob('j1', { status: 'queued' });
    JobStore.updateJob('j2', { status: 'queued' });

    const q = JobStore.getQueue();
    expect(q.length).toBe(2);
    expect(q[0].id).toBe('j1');
    expect(q[1].id).toBe('j2');
  });

  it('rejects queued job if maxQueued=5 is reached', () => {
    for (let i = 1; i <= 5; i++) {
      JobStore.createJob({ id: `j${i}` });
      JobStore.updateJob(`j${i}`, { status: 'queued' });
    }

    JobStore.createJob({ id: 'j6' });
    expect(() => {
      JobStore.updateJob('j6', { status: 'queued' });
    }).toThrow('maxQueued limit reached');
  });

  it('draft auto-delete works in store tests', async () => {
    const job = JobStore.createJob({ id: 'draft1' });
    await ImageStore.putImages('draft1', ['img1', 'img2']);
    
    await JobStore.deleteJob('draft1');
    
    const imgs = await ImageStore.getImages('draft1');
    expect(imgs.length).toBe(0);
  });

  it('subscribers are notified', () => {
    let calls = 0;
    const unsub = JobStore.subscribe(() => calls++);
    JobStore.createJob({ id: 's1' });
    JobStore.updateJob('s1', { status: 'queued' });
    expect(calls).toBe(2);
    unsub();
    JobStore.updateJob('s1', { status: 'running' });
    expect(calls).toBe(2);
  });

  it('correctly detects blank jobs vs valid jobs', () => {
    // Draft is considered blank
    expect(isJobBlank({ status: 'draft' as any })).toBe(true);

    // Empty succeeded job with no text, image, or results is blank
    expect(isJobBlank({ id: 'b1', status: 'succeeded' as any })).toBe(true);

    // Job with valid text input
    expect(isJobBlank({ id: 'b2', status: 'queued' as any, inputSnapshot: { text: '2 eggs and toast', imageRefs: [] } })).toBe(false);

    // Job with photo URL
    expect(isJobBlank({ id: 'b3', status: 'queued' as any, photoUrl: 'data:image/jpeg;base64,...' })).toBe(false);

    // Job with food result
    expect(isJobBlank({
      id: 'b4',
      status: 'succeeded' as any,
      result: { pendingFoodLog: { foodName: 'Oatmeal with berries', calories: 250 } } as any
    })).toBe(false);

    // Job with medical result
    expect(isJobBlank({
      id: 'b5',
      status: 'succeeded' as any,
      result: { biomarkers: { glucose: 95 } } as any
    })).toBe(false);
  });
});
