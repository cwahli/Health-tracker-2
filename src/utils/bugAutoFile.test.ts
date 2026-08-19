import { describe, it, expect } from 'vitest';
import {
  applyAutoFile,
  classifyGoldenReds,
  classifyJobResult,
  shouldHoldR2,
} from './bugAutoFile';
import { emptyWorkItem } from './bugWorkItem';

describe('bugAutoFile Q-6.5 / Q-6.6', () => {
  it('skips a clean successful meal', () => {
    expect(
      classifyJobResult({
        jobId: 'job_ok',
        status: 'succeeded',
        text: 'Chicken wrap',
        pendingFoodLog: { name: 'Chicken wrap', itemsBreakdown: [{ name: 'wrap' }] },
        result: { pendingFoodLog: { name: 'Chicken wrap', itemsBreakdown: [{ name: 'wrap' }] } },
      })
    ).toBeNull();
  });

  it('files DISH_DROP when scout has a food the table dropped', () => {
    const c = classifyJobResult({
      jobId: 'job_drop',
      status: 'succeeded',
      text: 'Sweet Chilli Chicken Wrap',
      debugUrl: 'https://r2/debug-job_drop.json',
      pendingFoodLog: {
        name: 'Sweet Chilli Chicken Wrap',
        itemsBreakdown: [{ name: 'wrap' }],
      },
      result: {
        scoutItems: [{ originalName: 'Sweet Chilli Chicken Wrap' }, { originalName: 'Fries' }],
        pendingFoodLog: {
          name: 'Sweet Chilli Chicken Wrap',
          itemsBreakdown: [{ name: 'wrap' }],
        },
      },
    });
    expect(c?.class).toBe('DISH_DROP');
    expect(c?.evidence.job_id).toBe('job_drop');
    expect(c?.evidence.hold).toBe(true);
    expect(c?.remaining.some((r) => /fries/i.test(r))).toBe(true);
  });

  it('files failed quota as CALL_BUDGET', () => {
    const c = classifyJobResult({
      jobId: 'job_q',
      status: 'failed',
      error: '429 RESOURCE_EXHAUSTED quota exceeded on gemini-2.5-flash',
      text: 'Salad',
    });
    expect(c?.class).toBe('CALL_BUDGET');
  });

  it('merges the same class+query in one week; unknown class is unmatched', () => {
    const first = classifyJobResult({
      jobId: 'job_1',
      status: 'succeeded',
      text: 'Sweet Chilli Chicken Wrap',
      result: {
        scoutItems: [{ originalName: 'Wrap' }, { originalName: 'Slaw' }],
        pendingFoodLog: { name: 'Sweet Chilli Chicken Wrap', itemsBreakdown: [{ name: 'Wrap' }] },
      },
    })!;
    const d1 = applyAutoFile([], first, []);
    expect(d1.action).toBe('new');
    expect(d1.item.unmatched).toBe(false);
    expect(d1.item.public_n).toBe(1);

    const second = classifyJobResult({
      jobId: 'job_2',
      status: 'succeeded',
      text: 'sweet chilli chicken wrap',
      result: {
        scoutItems: [{ originalName: 'Wrap' }, { originalName: 'Slaw' }],
        pendingFoodLog: { name: 'sweet chilli chicken wrap', itemsBreakdown: [{ name: 'Wrap' }] },
      },
    })!;
    const d2 = applyAutoFile([{ id: 'tag-1', work_item: d1.item }], second, [d1.item.public_n]);
    expect(d2.action).toBe('merge');
    expect(d2.item.burns).toEqual([]);
    expect(d2.item.occurrences).toBeGreaterThanOrEqual(2);
    expect(d2.item.hold_refs).toContain('job_2');

    const stray = classifyJobResult({
      jobId: 'job_x',
      status: 'failed',
      error: 'something odd happened in the UI',
    })!;
    const d3 = applyAutoFile([], stray, [1]);
    expect(d3.action).toBe('unmatched');
    expect(d3.item.unmatched).toBe(true);
  });

  it('files golden pipeline reds and skips all-green', () => {
    expect(classifyGoldenReds({ caseId: 'g1', outcomes: [{ id: 'kcal', pass: true, enabled: true }] })).toBeNull();
    const c = classifyGoldenReds({
      caseId: 'g8',
      query: 'Sweet Chilli Chicken Wrap',
      jobId: 'job_g8',
      outcomes: [{ id: 'presence', label: 'missing item: slaw', pass: false, enabled: true }],
    });
    expect(c?.class).toBe('DISH_DROP');
    expect(c?.evidence.job_id).toBe('job_g8');
  });

  it('holds R2 while the card is open and releases when done', () => {
    const open = emptyWorkItem({
      queue: 'ready',
      hold_refs: ['job_brand2', 'bugs/foodcart/t/reports/r1'],
    });
    expect(shouldHoldR2(open, ['job_brand2'])).toBe(true);
    expect(shouldHoldR2(open, ['bugs/foodcart/t/reports/r1/shot-01.jpg'])).toBe(true);
    expect(shouldHoldR2(open, ['unrelated-key'])).toBe(false);
    expect(shouldHoldR2({ ...open, queue: 'done' }, ['job_brand2'])).toBe(false);
  });
});
