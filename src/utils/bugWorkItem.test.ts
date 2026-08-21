import { describe, it, expect } from 'vitest';
import {
  applyAttempt,
  appendEvidenceCommit,
  assignMissingPublicNs,
  assignPublicN,
  buildContinueJob,
  buildStartPayload,
  applySnapRemaining,
  emptyWorkItem,
  fingerprint,
  formatContinuePrompt,
  inferLineClass,
  linePhotosForText,
  hydrateWorkItem,
  isBurned,
  matchRemainingLine,
  pickContinueTag,
  pickNextOtherTag,
  pickQueueTag,
  restoreRemainingFromAutoSpot,
  triesMatchingLine,
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
    expect(a1.item.queue).toBe('in_progress');
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
    expect(a2.item.queue).toBe('in_progress');
    expect(a2.item.remaining).toEqual([]);
    expect(a2.item.parked).toEqual(['no label table']);
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
    expect(start.continue.active_line).toBe('no label table');
    expect(start.how_to_end).toMatch(/line/);
  });

  it('green-tick status=fixed wins over a leftover ready queue', () => {
    const item = hydrateWorkItem({
      status: 'fixed',
      work_item: { public_n: 8, queue: 'ready', remaining: ['still listed'] },
    });
    expect(item.queue).toBe('done');
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

  it('applySnapRemaining appends remaining texts and line photo pointers', () => {
    const base = emptyWorkItem({ remaining: ['yolk bind'] });
    const next = applySnapRemaining(base, {
      remaining: ['yolk bind', 'croissant pack 6 vs 1'],
      remaining_lines: [
        { text: 'croissant pack 6 vs 1', comment: 'shot 02', photo_urls: ['bugs/foodcart/t/reports/r/shot-02.jpg'] },
      ],
      symptom: 'ignored because remaining arrived',
    });
    expect(next.remaining).toEqual(['yolk bind', 'croissant pack 6 vs 1']);
    expect(linePhotosForText(next.current_evidence, 'croissant pack 6 vs 1')?.photo_urls?.[0]).toMatch(/shot-02/);
  });

  it('continue job is the first remaining line, not the whole meal', () => {
    const tag = {
      id: 'tag-11',
      title: 'Fruit Salad + Croissant + 3 more',
      work_item: {
        public_n: 11,
        remaining: ['berries share 171711', 'gherkin fallback 150', 'dropped red onion'],
        done: [],
        burns: [],
        commits: [],
        queue: 'ready',
      },
    };
    const job = buildContinueJob(tag);
    expect(job.stop).toBe(false);
    expect(job.active_line).toBe('berries share 171711');
    expect(job.class_hint).toBe('FALSE_FRIEND');
    expect(job.next_if_pass).toBe('gherkin fallback 150');
    expect(job.do_not.some((d) => /CANONICAL_BASE_FOODS/.test(d))).toBe(true);
    const prompt = formatContinuePrompt(job);
    expect(prompt).toMatch(/AGENTS\.md L15/);
    expect(prompt).toMatch(/GET http:\/\/127\.0\.0\.1:3000\/api\/bugs\/next/);
    expect(job.keep_going).toBe(true);
    expect(job.drain).toBe(true);
    expect(job.say).toMatch(/^DRAIN #11 /);
    expect(prompt).toMatch(/Drain automatic tape checks/);
    expect(prompt).toMatch(/do not wait for the human/i);
    expect(prompt).toMatch(/work bug/);
    expect(prompt).toMatch(/next bug/);
    expect(prompt).toMatch(/work 11 or work #11/);
    expect(prompt).toMatch(/Not a bare "continue"/);
    expect(prompt).not.toMatch(/Check this bug and fix it/);
    expect(prompt).not.toMatch(/BUG_CONTINUE_GEMINI/);
    expect(prompt).not.toMatch(/One trigger = one line/);
    expect(prompt).toMatch(/409 paint\/weak_test\/paint_fdc\/wrong_file/);
    expect(prompt).toMatch(/Tried on this line only/);
  });

  it('triesMatchingLine keeps croissant attempts off a cobb remaining row', () => {
    const croissant = {
      at: 't',
      actor: 'agent',
      hyp: 'Enrich croissant micros',
      file: 'server_food_db.ts',
      test: 'bakery class',
      result: 'pass',
      burned: false,
      line: 'Croissant: 9 micro keys at 0',
    };
    const cobb = {
      at: 't2',
      actor: 'agent',
      hyp: 'Cobb fallback to catalog',
      file: 'server_food_catalog.ts',
      test: 'resolveInternalFood',
      result: 'pass',
      burned: false,
      line: 'Cobb Salad: fallback',
    };
    expect(triesMatchingLine([croissant, cobb], 'Croissant: 9 micro keys at 0')).toHaveLength(1);
    expect(triesMatchingLine([croissant, cobb], 'Cobb Salad: fallback')[0].file).toBe(
      'server_food_catalog.ts'
    );
    const unscoped = { ...croissant, line: undefined, hyp: 'Populate canonical bakery micronutrients' };
    expect(
      triesMatchingLine([unscoped], 'Fruit Salad: strawberry, blueberry, raspberry share canonical id 171711')
    ).toEqual([]);
  });

  it('restoreRemainingFromAutoSpot moves honor-system Done back when the tape still flags it', () => {
    const item = hydrateWorkItem({
      work_item: {
        remaining: [],
        done: ['Croissant: 9 micro keys at 0', 'cobb salad: mismatch'],
        queue: 'in_progress',
      },
    });
    const next = restoreRemainingFromAutoSpot(item, [
      { text: 'Croissant: 9 micro keys at 0' },
      { text: 'Curator skipped pick_existing for 17 queries' },
      { text: 'Scouted only strawberry', parked: false },
      { text: 'gherkin fallback 150', parked: true },
    ]);
    expect(next.remaining).toEqual([
      'Croissant: 9 micro keys at 0',
      'Curator skipped pick_existing for 17 queries',
    ]);
    expect(next.done).toEqual(['cobb salad: mismatch']);
    expect(next.queue).toBe('in_progress');
  });

  it('two misses on one line parks it and keeps sibling remaining on the same card', () => {
    let item = hydrateWorkItem({
      work_item: {
        public_n: 11,
        remaining: ['Croissant: 9 micro keys at 0', 'berries share 171711'],
        done: [],
        parked: [],
        queue: 'in_progress',
      },
    });
    item = applyAttempt(item, {
      hyp: 'catalog micros',
      file: 'server_food_db.ts',
      test: 'server_food_db.test.ts',
      result: 'pass',
      burned: false,
      line: 'Croissant: 9 micro keys at 0',
    }).item;
    expect(item.remaining[0]).toMatch(/Croissant/);
    const parked = applyAttempt(item, {
      hyp: 'still catalog micros',
      file: 'server_food_db.ts',
      test: 'server_food_db.test.ts',
      result: 'pass',
      burned: false,
      line: 'Croissant: 9 micro keys at 0',
    });
    expect(parked.parked_line).toMatch(/Croissant/);
    expect(parked.item.remaining).toEqual(['berries share 171711']);
    expect(parked.item.parked[0]).toMatch(/Croissant/);
    expect(parked.item.queue).toBe('in_progress');
    const cont = buildContinueJob({ id: 'tag-11', work_item: parked.item, title: 'picnic' });
    expect(cont.stop).toBe(false);
    expect(cont.keep_going).toBe(true);
    expect(cont.active_line).toBe('berries share 171711');
    expect(cont.say).toMatch(/DRAIN #11/);
  });

  it('pass with line moves that remaining row to done and keeps the card open', () => {
    const open = hydrateWorkItem({
      work_item: {
        public_n: 11,
        remaining: ['berries share 171711', 'gherkin fallback 150'],
        done: [],
        queue: 'ready',
      },
    });
    const next = applyAttempt(open, {
      hyp: 'berry catch-all steals strawberry',
      file: 'server_food_db.ts',
      test: 'sibling berries do not share canonical id',
      result: 'pass',
      burned: false,
      line: 'berries share 171711',
    });
    expect(next.advanced_line).toBe('berries share 171711');
    expect(next.item.remaining).toEqual(['gherkin fallback 150']);
    expect(next.item.done).toEqual(['berries share 171711']);
    expect(next.item.queue).toBe('in_progress');
    const cont = buildContinueJob({ id: 'tag-11', work_item: next.item, title: 'picnic' });
    expect(cont.active_line).toBe('gherkin fallback 150');
    expect(cont.stop).toBe(false);
  });

  it('refuses honor-system pass that paints remaining (filename test, this-meal FDC, wrong file)', () => {
    const picnic = hydrateWorkItem({
      work_item: {
        public_n: 11,
        remaining: [
          'Croissant: 9 micro keys at 0',
          'Fruit Salad: strawberry, blueberry, raspberry share canonical id 171711',
        ],
        done: [],
        queue: 'in_progress',
      },
    });
    const weak = applyAttempt(picnic, {
      hyp: 'Enrich croissant canonical bakery items',
      file: 'server_food_db.ts',
      test: 'server_food_db.test.ts',
      result: 'pass',
      burned: false,
      line: 'Croissant: 9 micro keys at 0',
    });
    expect(weak.rejected).toBe('weak_test');
    expect(weak.advanced_line).toBeNull();
    expect(weak.item.remaining[0]).toMatch(/Croissant/);
    expect(weak.item.done).toEqual([]);

    const fdc = applyAttempt(picnic, {
      hyp: 'Reordered berry lookups',
      file: 'server_food_db.ts',
      test: 'strawberry, blueberry, and raspberry do not share canonical FDC ID 171711',
      result: 'pass',
      burned: false,
      line: 'Fruit Salad: strawberry, blueberry, raspberry share canonical id 171711',
    });
    expect(fdc.rejected).toBe('paint_fdc');
    expect(fdc.item.remaining).toHaveLength(2);

    const wrong = applyAttempt(picnic, {
      hyp: 'fill croissant micros in catalog',
      file: 'server_food_db.ts',
      test: 'bakery items of this class keep micros through aggregation',
      result: 'pass',
      burned: false,
      line: 'Croissant: 9 micro keys at 0',
    });
    expect(wrong.rejected).toBe('wrong_file');
    expect(wrong.item.remaining[0]).toMatch(/Croissant/);
    expect(wrong.item.commits.at(-1)?.summary).toMatch(/refused wrong_file/);
    expect(wrong.item.commits.at(-1)?.attempt?.result).toBe('refused:wrong_file');
  });

  it('last remaining pass does not mark the card done', () => {
    const open = hydrateWorkItem({
      work_item: { remaining: ['dropped red onion'], done: [], queue: 'in_progress' },
    });
    const next = applyAttempt(open, {
      hyp: 'restore onion from visualIngredients',
      file: 'server_vision_scout.ts',
      test: 'new salad garnish is not dropped',
      result: 'pass',
      burned: false,
      line: 'dropped red onion',
    });
    expect(next.item.remaining).toEqual([]);
    expect(next.item.done).toEqual(['dropped red onion']);
    expect(next.item.queue).toBe('in_progress');
    const cont = buildContinueJob({ id: 't', work_item: next.item });
    expect(cont.stop).toBe(true);
    expect(cont.say).toMatch(/automatic checks are green/i);
  });

  it('pickContinueTag prefers in_progress remaining over another ready card', () => {
    const tags = [
      {
        id: 'bmi',
        created_at: '2026-08-01',
        work_item: { queue: 'ready', remaining: ['bmi reinit'], occurrences: 99, burns: [], commits: [] },
      },
      {
        id: 'picnic',
        created_at: '2026-08-10',
        work_item: {
          queue: 'in_progress',
          remaining: ['gherkin fallback 150'],
          occurrences: 1,
          burns: [],
          commits: [{ id: 'c1', at: '2026-08-21T12:00:00.000Z', actor: 'gemini', kind: 'agent', summary: 'done: berries' }],
        },
      },
    ];
    expect(pickContinueTag(tags)?.id).toBe('picnic');
    expect(pickNextOtherTag(tags)?.id).toBe('bmi');
    expect(pickQueueTag(tags, { mode: 'current' })?.id).toBe('picnic');
    expect(pickQueueTag(tags, { mode: 'next' })?.id).toBe('bmi');
    expect(pickQueueTag(tags, { n: 11 })?.id).toBeUndefined();
  });

  it('work 11 picks that public_n', () => {
    const tags = [
      { id: 'bmi', created_at: '2026-08-01', work_item: { public_n: 2, queue: 'ready', remaining: ['bmi'], burns: [], commits: [] } },
      { id: 'picnic', created_at: '2026-08-10', work_item: { public_n: 11, queue: 'ready', remaining: ['micros'], burns: [], commits: [] } },
    ];
    expect(pickQueueTag(tags, { n: 11 })?.id).toBe('picnic');
    expect(pickQueueTag(tags, { n: '11' })?.id).toBe('picnic');
  });

  it('infers class from remaining text', () => {
    expect(inferLineClass('CURATOR_SKIP pick_existing')).toBe('OPENING_WRONG');
    expect(inferLineClass('SIBLING_ID_COLLISION 171711')).toBe('FALSE_FRIEND');
    expect(matchRemainingLine(['berries share 171711', 'gherkin'], '171711')).toBe('berries share 171711');
  });
});
