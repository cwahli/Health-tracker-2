import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobStore } from '../JobStore';
import { previewStatus, previewStatusLabel } from '../jobPreview';
import { mergeFoodEditMessages } from '../mergeFoodEditMessages';

vi.mock('idb-keyval', () => {
  const store = new Map();
  return {
    set: async (key: string, val: any) => store.set(key, val),
    get: async (key: string) => store.get(key),
    del: async (key: string) => store.delete(key),
    clear: async () => store.clear(),
  };
});

const prior = {
  pendingFoodLog: {
    name: 'Meal',
    nutrients: { calories: 660 },
    itemsBreakdown: [{ name: 'Sweet Iced Tea', nutrients: { calories: 104 } }],
  },
};

const next = {
  pendingFoodLog: {
    name: 'Grilled Fish and Water Spinach Meal',
    nutrients: { calories: 650 },
    itemsBreakdown: [{ name: 'Unsweetened Iced Tea', nutrients: { calories: 0 } }],
  },
};

describe('JobSession contract (STALE_TURN)', () => {
  beforeEach(() => {
    JobStore.clearForTests();
  });

  it('edit submit shows Updating meal while the prior meal is still on the job', () => {
    JobStore.createJob({
      id: 'tea1',
      status: 'succeeded',
      result: prior,
      finishedAt: new Date(Date.now() - 60_000).toISOString(),
      inputSnapshot: { text: 'Analyze this meal photo.', imageRefs: [], mode: 'review' },
    });
    JobStore.updateJob('tea1', {
      status: 'queued',
      mode: 'edit',
      clientSubmitPending: true,
      inFlightTurnAt: Date.now(),
      finishedAt: undefined,
      inputSnapshot: { text: 'the tea is unsweetened', imageRefs: [], mode: 'edit' },
      statusMessage: 'Updating meal...',
    });
    const job = JobStore.getJob('tea1')!;
    expect(previewStatus(job) === 'queued' || previewStatus(job) === 'running' || previewStatus(job) === 'processing').toBe(true);
    expect(previewStatusLabel(job)).toMatch(/Updating meal/);
    expect(job.result?.pendingFoodLog?.nutrients?.calories).toBe(660);
  });

  it('same-meal succeeded echo does not complete the turn', () => {
    JobStore.createJob({
      id: 'tea2',
      status: 'succeeded',
      result: prior,
      finishedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    JobStore.updateJob('tea2', {
      status: 'queued',
      mode: 'edit',
      clientSubmitPending: true,
      inFlightTurnAt: Date.now(),
      finishedAt: undefined,
      inputSnapshot: { text: 'the tea is unsweetened', imageRefs: [], mode: 'edit' },
    });
    JobStore.updateJob('tea2', {
      status: 'succeeded',
      result: prior,
      messages: [{ role: 'assistant', content: 'old' }],
      inFlightTurnAt: undefined,
      finishedAt: new Date().toISOString(),
    });
    const job = JobStore.getJob('tea2')!;
    expect(job.inFlightTurnAt).toBeGreaterThan(0);
    expect(previewStatusLabel(job)).toMatch(/Updating meal/);
    expect(previewStatus(job)).not.toBe('succeeded');
  });

  it('new Unsweetened snapshot completes to Analysis completed', () => {
    JobStore.createJob({
      id: 'tea3',
      status: 'succeeded',
      result: prior,
      finishedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    JobStore.updateJob('tea3', {
      status: 'queued',
      mode: 'edit',
      clientSubmitPending: true,
      inFlightTurnAt: Date.now(),
      finishedAt: undefined,
      inputSnapshot: { text: 'the tea is unsweetened', imageRefs: [], mode: 'edit' },
    });
    JobStore.updateJob('tea3', {
      status: 'succeeded',
      result: next,
      inFlightTurnAt: undefined,
      finishedAt: new Date().toISOString(),
    });
    const done = JobStore.getJob('tea3')!;
    expect(previewStatus(done)).toBe('succeeded');
    expect(previewStatusLabel(done)).toBe('Analysis completed');
    expect(done.result?.pendingFoodLog?.itemsBreakdown?.[0]?.name).toMatch(/Unsweetened/);
    expect(done.result?.pendingFoodLog?.nutrients?.calories).toBe(650);
  });

  it('keeps one food card on merge', () => {
    const original = {
      id: 'a1',
      role: 'assistant',
      pendingFoodLog: prior.pendingFoodLog,
      data: { pendingFoodLog: prior.pendingFoodLog },
    };
    const user = { id: 'u2', role: 'user', content: 'the tea is unsweetened' };
    const assistant = {
      id: 'a2',
      role: 'assistant',
      content: 'Unsweetened Iced Tea is 0 kcal',
      pendingFoodLog: next.pendingFoodLog,
      data: { pendingFoodLog: next.pendingFoodLog, mode: 'modify' },
    };
    const merged = mergeFoodEditMessages([original, user], assistant);
    expect(merged.filter((m: any) => m.data?.pendingFoodLog || m.pendingFoodLog)).toHaveLength(1);
  });
});
