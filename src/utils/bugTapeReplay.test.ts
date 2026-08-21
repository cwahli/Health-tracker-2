import { describe, it, expect } from 'vitest';
import {
  buildTapeReplayBody,
  tapeReplayTouchesQueue,
  reanalyzeJobId,
  tapeFromJobRecord,
  scoreLocalTape,
  pickTapeBoard,
} from './bugTapeReplay';
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

  it('re-analyze uses a saved job_id (no new pipeline)', () => {
    expect(reanalyzeJobId({ job_id: 'job_1787' })).toBe('job_1787');
    expect(reanalyzeJobId({})).toBeNull();
  });

  it('tapeFromJobRecord reads scout and foodLog off clean_result', () => {
    const tape = tapeFromJobRecord({
      id: 'job_picnic',
      debug_url: 'https://example/debug/job_picnic.json',
      clean_result: {
        pendingFoodLog: { name: 'Fruit Salad', items: [{ name: 'croissant' }] },
        scoutItems: [{ originalName: 'butter croissant' }],
        backendLogs: '[Logs stored in R2: https://example/logs/job_picnic.log]',
        backendLogsUrl: 'https://example/logs/job_picnic.log',
      },
    });
    expect(tape.jobId).toBe('job_picnic');
    expect((tape.foodLog as any).name).toBe('Fruit Salad');
    expect((tape.scout as any[])[0].originalName).toBe('butter croissant');
    expect(tape.logsUrl).toMatch(/logs\/job_picnic/);
  });

  it('scoreLocalTape overlays foodLog binds so scout is not 0/N scouted-only', () => {
    const board = scoreLocalTape({
      scout: {
        items: [
          {
            originalName: 'butter croissant',
            estimatedCalories: 400,
            components: [{ searchQuery: 'wheat flour' }, { searchQuery: 'strawberry' }],
          },
        ],
      },
      foodLog: {
        itemsBreakdown: [
          {
            name: 'Croissant',
            calories: 618,
            components: [
              { name: 'wheat flour', dbSource: 'internal_catalog' },
              { name: 'strawberry', dbSource: 'category_fallback' },
            ],
          },
        ],
      },
    });
    const byQ = Object.fromEntries((board.journey || []).map((r: any) => [r.query, r]));
    expect(byQ['wheat flour'].phase).toBe('catalog');
    expect(byQ['strawberry'].phase).toBe('fallback');
    expect(board.ledger?.books?.some((b: any) => b.id === 'saved_table' && b.kcal)).toBe(true);
    expect((board.autoSpot || []).length).toBeGreaterThan(0);
  });

  it('pickTapeBoard keeps the board with resolved journey rows', () => {
    const empty = { journey: [{ phase: 'scouted' }, { phase: 'scouted' }], invariants: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
    const scored = { journey: [{ phase: 'catalog' }, { phase: 'usda_live' }], invariants: new Array(8).fill({ id: 'x' }) };
    expect(pickTapeBoard(empty, scored).journey[0].phase).toBe('catalog');
  });
});
