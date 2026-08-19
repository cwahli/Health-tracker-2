import { describe, it, expect } from 'vitest';
import {
  applyAttempt,
  appendEvidenceCommit,
  assignMissingPublicNs,
  assignPublicN,
  buildStartPayload,
  emptyWorkItem,
  fingerprint,
  hydrateWorkItem,
  isBurned,
  prefillBug,
  sortReadyQueue,
  BURN_BUDGET,
} from './bugWorkItem';

describe('bugWorkItem Q-6', () => {
  it('prefills Bug from snap and never wipes existing text', () => {
    expect(prefillBug('', 'nutrition labels are missing with branded food')).toContain('nutrition labels');
    expect(prefillBug('labels still missing + crop gone', 'new snap text')).toBe(
      'labels still missing + crop gone'
    );
  });

  it('fingerprint merges same class + query in the same ISO week', () => {
    expect(fingerprint('DISH_DROP', 'Sweet Chilli Chicken Wrap', '2026-08-03')).toBe(
      fingerprint('dish_drop', 'sweet chilli chicken wrap', '2026-08-09')
    );
    expect(fingerprint('DISH_DROP', 'Sweet Chilli Chicken Wrap', '2026-08-03')).not.toBe(
      fingerprint('DISH_DROP', 'Sweet Chilli Chicken Wrap', '2026-08-17')
    );
  });

  it('assigns the next public_n and never overwrites an existing one', () => {
    expect(assignPublicN(emptyWorkItem(), [1, 18]).public_n).toBe(19);
    expect(assignPublicN(emptyWorkItem({ public_n: 5 }), [1, 18]).public_n).toBe(5);
  });

  it('backfills missing public_n oldest-first without colliding with #1', () => {
    const out = assignMissingPublicNs([
      { id: 'wrap', created_at: '2026-08-10', work_item: { public_n: 0 } },
      { id: 'first', created_at: '2026-08-01', work_item: { public_n: 1 } },
      { id: 'label', created_at: '2026-08-12', work_item: {} },
    ]);
    expect(out.map((r) => `${r.id}#${r.item.public_n}`)).toEqual(['wrap#2', 'label#3']);
  });

  it('sorts ready queue: occurrences then severity then oldest', () => {
    const tags = [
      {
        id: 'old-wrap',
        created_at: '2026-08-01',
        status: 'to_fix',
        work_item: { queue: 'ready', occurrences: 2, class: 'DISH_DROP', burns: [], commits: [] },
      },
      {
        id: 'hot-wrap',
        created_at: '2026-08-10',
        status: 'to_fix',
        work_item: { queue: 'ready', occurrences: 8, class: 'DISH_DROP', burns: [], commits: [] },
      },
      {
        id: 'hdl',
        created_at: '2026-08-02',
        status: 'to_fix',
        work_item: { queue: 'ready', occurrences: 8, class: 'APPLY_MISS', burns: [], commits: [] },
      },
      {
        id: 'blocked',
        created_at: '2026-07-01',
        status: 'to_fix',
        work_item: { queue: 'blocked', occurrences: 99, class: 'DISH_DROP', burns: [], commits: [] },
      },
    ];
    const ordered = sortReadyQueue(tags).map((t) => t.id);
    expect(ordered).toEqual(['hdl', 'hot-wrap', 'old-wrap']);
    expect(ordered).not.toContain('blocked');
  });

  it('keeps ALL burns; 2 burns blocks; retry of same hyp is rejected', () => {
    let item = hydrateWorkItem({
      id: 't',
      title: 'labels',
      work_item: { bug: 'labels missing', remaining: ['no label table'], queue: 'ready' },
    });
    const a1 = applyAttempt(item, {
      hyp: 'tesco includes()',
      file: 'FoodCard.tsx',
      test: 'NutritionLabelTable brand',
      result: 'still_red',
      burned: true,
      actor: 'studio',
    });
    expect(a1.item.burns).toHaveLength(1);
    expect(a1.item.queue).toBe('ready');
    expect(isBurned(a1.item.burns, 'tesco includes()', 'FoodCard.tsx', 'NutritionLabelTable brand')).toBe(true);

    const again = applyAttempt(a1.item, {
      hyp: 'tesco includes()',
      file: 'FoodCard.tsx',
      test: 'NutritionLabelTable brand',
      result: 'still_red',
      burned: true,
    });
    expect(again.rejected).toBe('already_burned');
    expect(again.item.burns).toHaveLength(1);

    const a2 = applyAttempt(a1.item, {
      hyp: 'empty table if brand set',
      file: 'NutritionLabelTable.tsx',
      test: 'NutritionLabelTable brand',
      result: 'still_red',
      burned: true,
      actor: 'studio',
    });
    expect(a2.item.burns).toHaveLength(2);
    expect(a2.item.queue).toBe('blocked');
    expect(a2.item.burns.length).toBeGreaterThanOrEqual(BURN_BUDGET);
  });

  it('new meal updates current evidence without dropping burns', () => {
    let item = hydrateWorkItem({ title: 'labels', work_item: { bug: 'labels missing', remaining: ['no table'] } });
    item = applyAttempt(item, {
      hyp: 'tesco includes()',
      file: 'FoodCard.tsx',
      test: 't',
      result: 'still_red',
      burned: true,
    }).item;
    item = appendEvidenceCommit(item, {
      actor: 'you',
      kind: 'retest',
      summary: 'second branded pack',
      evidence: { job_id: 'job_brand2', photo_urls: ['p2.jpg'], debug_url: 'debug/brand2.json' },
      remaining: ['no table', 'crop missing'],
    });
    expect(item.burns).toHaveLength(1);
    expect(item.current_evidence?.job_id).toBe('job_brand2');
    expect(item.hold_refs).toContain('job_brand2');
    expect(item.commits.length).toBeGreaterThanOrEqual(2);
  });

  it('start payload is NOW + full burns + how to end', () => {
    const tag = {
      id: 'uuid-18',
      title: 'labels',
      work_item: {
        public_n: 18,
        bug: 'Nutrition labels still missing; crop gone. Do not retry tesco includes().',
        class: 'CLONE_UI',
        remaining: ['no label table', 'crop missing'],
        burns: [
          {
            at: 't',
            actor: 'studio',
            hyp: 'tesco includes()',
            file: 'FoodCard.tsx',
            test: 'brand label',
            result: 'still_red',
            burned: true,
          },
        ],
        commits: [],
        current_evidence: { job_id: 'job_brand2' },
        queue: 'ready',
      },
    };
    const start = buildStartPayload(tag);
    expect(start.say).toBe('Next bug');
    expect(start.now.public_id).toBe('#18');
    expect(start.now.bug).toMatch(/still missing/);
    expect(start.now.tried).toHaveLength(1);
    expect(start.now.tried[0]).toMatch(/DO NOT RETRY/);
    expect(start.now.burns_used).toBe('1/2');
    expect(start.how_to_end).toContain('/attempts');
  });

  it('does not mark done from a pass while remaining is open', () => {
    const open = hydrateWorkItem({
      work_item: { bug: 'labels missing', remaining: ['no label table'], queue: 'ready' },
    });
    const stillOpen = applyAttempt(open, {
      hyp: 'chat all done',
      file: 'FoodCard.tsx',
      test: 'brand label',
      result: 'pass',
      burned: false,
    });
    expect(stillOpen.item.queue).not.toBe('done');

    const closed = applyAttempt(
      hydrateWorkItem({ work_item: { bug: 'labels missing', remaining: [], queue: 'ready' } }),
      { hyp: 'named test', file: 'NutritionLabelTable.tsx', test: 'brand label', result: 'pass', burned: false }
    );
    expect(closed.item.queue).toBe('done');
  });
});
