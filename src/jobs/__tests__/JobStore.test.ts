import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobStore, isJobBlank, isStalePriorTurn } from '../JobStore';
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

  it('re-queues a succeeded meal for an edit turn and then allows running', () => {
    JobStore.createJob({
      id: 'edit1',
      status: 'succeeded',
      result: {
        pendingFoodLog: {
          name: 'Ikan Bakar Set with Cah Kangkung and Es Teh Manis',
          nutrients: { calories: 695, protein: 43.7 },
          itemsBreakdown: [
            { name: 'Es Teh Manis', nutrients: { calories: 84 } },
            { name: 'Cah Kangkung', nutrients: { calories: 142 } },
            { name: 'Ikan Bakar Set with Rice and Sambal', nutrients: { calories: 469 } },
          ],
        },
      },
      inputSnapshot: { text: 'Analyze this meal photo.', imageRefs: [], mode: 'review' },
    });

    // 1. Client submit: queued + clientSubmitPending
    JobStore.updateJob('edit1', {
      status: 'queued',
      mode: 'edit',
      inputSnapshot: { text: 'the tea is unsweetened', imageRefs: [], mode: 'edit' },
      clientSubmitPending: true,
      serverSubmittedAt: Date.now(),
      statusMessage: 'Updating meal...',
    });
    expect(JobStore.getJob('edit1')?.status).toBe('queued');

    // 2. Submit finished: queued without clientSubmitPending. Prior-turn
    // pendingFoodLog is still on the job — must NOT force succeeded.
    JobStore.updateJob('edit1', {
      status: 'queued',
      clientSubmitPending: false,
      statusMessage: 'Updating meal...',
      serverSubmittedAt: Date.now(),
    });
    expect(JobStore.getJob('edit1')?.status).toBe('queued');

    // 3. Queue runner picks it up
    JobStore.updateJob('edit1', { status: 'running', statusMessage: 'Updating meal...' });
    expect(JobStore.getJob('edit1')?.status).toBe('running');
  });

  it('does not let stale sync downgrade a finished job to queued', () => {
    JobStore.createJob({
      id: 'done1',
      status: 'succeeded',
      result: { pendingFoodLog: { name: 'Oatmeal', nutrients: { calories: 250 } } },
      inputSnapshot: { text: 'oatmeal', imageRefs: [] },
    });

    JobStore.updateJob('done1', { status: 'queued', statusMessage: 'Analyzing on server...' });
    expect(JobStore.getJob('done1')?.status).toBe('succeeded');
  });

  it('allows retry of a succeeded job when attemptCount increases', () => {
    JobStore.createJob({
      id: 'retry1',
      status: 'succeeded',
      attemptCount: 1,
      result: { pendingFoodLog: { name: 'Soup', degradedStages: ['dietitian'] } },
    });

    JobStore.updateJob('retry1', {
      status: 'queued',
      attemptCount: 2,
      clientSubmitPending: false,
      statusMessage: 'Retrying AI advice (Attempt 2)...',
    });
    expect(JobStore.getJob('retry1')?.status).toBe('queued');
  });

  it('keeps Updating state when a succeeded echo still has the prior meal', () => {
    const prior = { pendingFoodLog: { name: 'Meal', nutrients: { calories: 660 }, itemsBreakdown: [{ name: 'Sweet Iced Tea', nutrients: { calories: 104 } }] } };
    JobStore.createJob({
      id: 'turn-same',
      status: 'succeeded',
      result: prior,
      finishedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    JobStore.updateJob('turn-same', {
      status: 'queued',
      clientSubmitPending: true,
      inFlightTurnAt: Date.now(),
      finishedAt: undefined,
      inputSnapshot: { text: 'the tea is unsweetened', imageRefs: [], mode: 'edit' },
      mode: 'edit',
    });
    JobStore.updateJob('turn-same', {
      status: 'succeeded',
      result: { pendingFoodLog: { name: 'Meal', nutrients: { calories: 660 }, itemsBreakdown: [{ name: 'Sweet Iced Tea', nutrients: { calories: 104 } }] } },
      messages: [{ role: 'assistant', content: 'old' }],
      inFlightTurnAt: undefined,
      finishedAt: new Date().toISOString(),
    });
    const job = JobStore.getJob('turn-same');
    expect(job?.status).toBe('queued');
    expect(job?.inFlightTurnAt).toBeGreaterThan(0);
    expect(job?.result?.pendingFoodLog?.nutrients?.calories).toBe(660);

    JobStore.updateJob('turn-same', {
      status: 'succeeded',
      result: { pendingFoodLog: { name: 'Grilled Fish and Water Spinach Meal', nutrients: { calories: 650 }, itemsBreakdown: [{ name: 'Unsweetened Iced Tea', nutrients: { calories: 0 } }] } },
      inFlightTurnAt: undefined,
      finishedAt: new Date().toISOString(),
    });
    const done = JobStore.getJob('turn-same');
    expect(done?.status).toBe('succeeded');
    expect(done?.inFlightTurnAt).toBeUndefined();
    expect(done?.result?.pendingFoodLog?.nutrients?.calories).toBe(650);
  });

  it('keeps an in-flight edit turn even if a status-only succeeded echo arrives', () => {
    JobStore.createJob({
      id: 'turn1',
      status: 'succeeded',
      result: { pendingFoodLog: { name: 'Meal', nutrients: { calories: 660 } } },
      finishedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    JobStore.updateJob('turn1', {
      status: 'queued',
      clientSubmitPending: true,
      inFlightTurnAt: Date.now(),
      finishedAt: undefined,
      inputSnapshot: { text: 'the tea is unsweetened', imageRefs: [], mode: 'edit' },
    });
    expect(JobStore.getJob('turn1')?.status).toBe('queued');
    expect(JobStore.getJob('turn1')?.inFlightTurnAt).toBeGreaterThan(0);

    JobStore.updateJob('turn1', { status: 'succeeded', statusMessage: 'Analysis complete' });
    expect(JobStore.getJob('turn1')?.status).toBe('queued');
    expect(JobStore.getJob('turn1')?.inFlightTurnAt).toBeGreaterThan(0);
  });

  it('detects stale prior-turn succeeded rows while an edit is in flight', () => {
    const submittedAt = Date.now();
    const existing = {
      status: 'queued' as const,
      serverSubmittedAt: submittedAt,
      clientSubmitPending: false,
    };
    const oldStamp = new Date(submittedAt - 60_000).toISOString();
    expect(isStalePriorTurn(existing, 'succeeded', oldStamp)).toBe(true);
    expect(isStalePriorTurn(existing, 'queued', oldStamp)).toBe(false);

    const freshStamp = new Date(submittedAt + 30_000).toISOString();
    expect(isStalePriorTurn(existing, 'succeeded', freshStamp)).toBe(false);

    const finished = { status: 'succeeded' as const, serverSubmittedAt: submittedAt, clientSubmitPending: false };
    expect(isStalePriorTurn(finished, 'succeeded', oldStamp)).toBe(false);
  });
});
