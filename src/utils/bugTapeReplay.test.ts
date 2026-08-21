import { describe, it, expect } from 'vitest';
import { buildTapeReplayBody, tapeReplayTouchesQueue, reanalyzeJobId } from './bugTapeReplay';
import { jobFitsSnap } from './bugDomainPacks';
import { applySnapRemaining, linePhotosForText, emptyWorkItem } from './bugWorkItem';

describe('Q-6.4 item 7 tape actions (Promote deferred)', () => {
  it('snap tape is on for food and off for Home', () => {
    expect(jobFitsSnap({ category: 'foodcart', activeTab: 'food', jobKind: 'food_log' })).toBe(true);
    expect(jobFitsSnap({ category: 'Home', activeTab: 'home', jobKind: 'food_log' })).toBe(false);
  });

  it('remaining sync keeps per-line photo pointers', () => {
    const next = applySnapRemaining(emptyWorkItem({ remaining: ['zeros'] }), {
      remaining: ['zeros', 'pack 6 vs 1'],
      remaining_lines: [
        { text: 'pack 6 vs 1', comment: 'shot 02', photo_urls: ['bugs/foodcart/t/reports/r/shot-02.jpg'] },
      ],
    });
    expect(next.remaining).toEqual(['zeros', 'pack 6 vs 1']);
    expect(linePhotosForText(next.current_evidence, 'pack 6 vs 1')?.photo_urls?.[0]).toMatch(/shot-02/);
  });

  it('catalog replay body does not set done / remaining / all_green', () => {
    const body = buildTapeReplayBody({
      mode: 'catalog',
      jobId: 'job_picnic',
      scout: { items: [{ originalName: 'Fruit Cup' }] },
    });
    expect(body.replayMode).toBe('catalog');
    expect(tapeReplayTouchesQueue(body)).toBe(false);
    expect(body).not.toHaveProperty('queue');
    expect(body).not.toHaveProperty('remaining');
    expect(body).not.toHaveProperty('all_green');
  });

  it('re-analyze only opens a saved job_id (no new pipeline)', () => {
    expect(reanalyzeJobId({ job_id: 'job_1787' })).toBe('job_1787');
    expect(reanalyzeJobId({})).toBeNull();
  });
});
