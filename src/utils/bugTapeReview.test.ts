import { describe, it, expect } from 'vitest';
import {
  failingAutoWorkLines,
  overlayAutoRemaining,
  reviewGate,
  isHumanCheckLine,
  checkLane,
  restageBoardFromCatalog,
  planReanalyzeStages,
  uniqueTapeCheckRows,
  retainTapeChecks,
} from './bugTapeReview';
import { emptyWorkItem, buildContinueJob } from './bugWorkItem';

describe('automatic vs human tape review', () => {
  it('treats contrast/a11y remaining as human', () => {
    expect(isHumanCheckLine('WCAG contrast on the green tick')).toBe(true);
    expect(isHumanCheckLine('Category fallback used for: strawberry')).toBe(false);
  });

  it('overlayAutoRemaining replaces honor-system Done with failing auto checks', () => {
    const item = emptyWorkItem({
      remaining: [],
      done: ['Croissant: 9 micro keys at 0'],
      queue: 'in_progress',
    });
    const next = overlayAutoRemaining(item, {
      invariants: [
        { id: 'id_ok', label: 'Every scout dish is still in the final meal', pass: true, group: 'identity' },
        { id: 'math_trial_balance', label: 'Trial balance drifted: Scout opening kcal vs saved table', pass: false, group: 'math' },
      ],
      autoSpot: [{ text: 'Croissant: 9 micro keys at 0', parked: false }],
    });
    expect(next.remaining).toEqual([
      'Trial balance drifted: Scout opening kcal vs saved table',
      'Croissant: 9 micro keys at 0',
    ]);
    expect(next.checks?.length).toBe(3);
    expect(reviewGate(next)).toBe('agent');
  });

  it('retainTapeChecks keeps a pinned roster through a hollow golden tape', () => {
    const pinned = [
      { id: 'id_ok', label: 'Every scout dish is still in the final meal', pass: true },
      { id: 'res_no_category_fallback', label: 'Category fallback used for: strawberry', pass: false },
      { id: 'math_trial_balance', label: 'Trial balance drifted: Scout opening kcal vs saved table (2280 → 2592)', pass: false },
    ];
    const hollow = retainTapeChecks(pinned, [
      {
        id: 'math_trial_balance',
        label: 'Trial balance incomplete (foundation, reconcile, dietitian_payload not in log)',
        pass: false,
      },
    ], { hydrated: false });
    expect(hollow).toEqual(pinned);
    const cleared = retainTapeChecks(pinned, [
      { id: 'id_ok', label: 'Every scout dish is still in the final meal', pass: true },
      { id: 'math_trial_balance', label: 'Trial balance books agree', pass: true },
    ], { hydrated: true });
    expect(cleared).toHaveLength(3);
    expect(cleared.find((c) => c.id === 'res_no_category_fallback')?.pass).toBe(true);
    expect(cleared.find((c) => c.id === 'math_trial_balance')?.pass).toBe(true);
  });

  it('retainTapeChecks preserves user-added journey checks as failing when tape has no match', () => {
    const pinned = [
      { id: 'id_ok', label: 'Every scout dish is still in the final meal', pass: true },
      { id: 'user_custom_bug', label: 'Nutrients missing on expanded view', pass: false, group: 'user' },
    ];
    const tapeChecks = [{ id: 'id_ok', label: 'Every scout dish is still in the final meal', pass: true }];
    const result = retainTapeChecks(pinned, tapeChecks, { hydrated: true });
    expect(result).toHaveLength(2);
    const userCheck = result.find((c) => c.id === 'user_custom_bug');
    expect(userCheck?.pass).toBe(false);
    expect(userCheck?.status).toBe('fail');
  });

  it('continue job stops for human when only visual remaining is open', () => {
    const job = buildContinueJob({
      id: 't',
      work_item: {
        public_n: 11,
        remaining: ['WCAG contrast on Done button'],
        done: [],
        queue: 'in_progress',
      },
    });
    expect(job.stop).toBe(true);
    expect(job.keep_going).toBe(false);
    expect(job.say).toMatch(/automatic checks are green/i);
    expect(job.active_line).toBeNull();
  });

  it('failingAutoWorkLines skips passing invariants', () => {
    const lines = failingAutoWorkLines({
      invariants: [
        { label: 'Every scout dish is still in the final meal', pass: true, group: 'identity' },
        { label: 'Must not scale foundation toward scout kcal', pass: false, group: 'math' },
      ],
    });
    expect(lines).toEqual(['Must not scale foundation toward scout kcal']);
  });

  it('lanes: identity/resolve are catalog; math/micros/merge need pipeline', () => {
    expect(checkLane('Category fallback used for: strawberry', { group: 'resolve' })).toBe('catalog');
    expect(checkLane('Fruit Salad: strawberry, blueberry share canonical id 171711')).toBe('catalog');
    expect(checkLane('Trial balance drifted: Scout opening kcal vs saved table', { group: 'math' })).toBe(
      'pipeline'
    );
    expect(checkLane('Croissant: 9 micro keys at 0', { code: 'MICROS_ZERO' })).toBe('pipeline');
    expect(checkLane('Scout label "Cobb Salad Label" was merged into "Cobb Salad"', { id: 'id_label_merge_collapsed' })).toBe(
      'pipeline'
    );
    expect(checkLane('WCAG contrast')).toBe('human');
  });

  it('catalog restage greens lookup identity and keeps trial-balance / micros for skipScout', () => {
    const old = {
      invariants: [
        {
          id: 'id_scout_items_present',
          group: 'identity',
          label: 'Every scout dish is still in the final meal',
          pass: true,
          expected: '3',
          actual: '3',
        },
        {
          id: 'id_all_components_identified',
          group: 'resolve',
          label: 'All scout components identified (catalog or printed/brand)',
          pass: false,
          expected: 'catalog',
          actual: 'fallback',
        },
        {
          id: 'res_no_category_fallback',
          group: 'resolve',
          label: 'Category fallback used for: strawberry, cooked bacon',
          pass: false,
          expected: 'absent',
          actual: 'strawberry, cooked bacon',
        },
        {
          id: 'math_trial_balance',
          group: 'math',
          label: 'Trial balance drifted: Scout opening kcal vs saved table (2280 → 2836)',
          pass: false,
          expected: 'agree',
          actual: '2280 vs 2836',
        },
        {
          id: 'id_label_merge_collapsed',
          group: 'identity',
          label: 'Scout label "Cobb Salad Label" was merged into "Cobb Salad" — a separate food disappeared',
          pass: false,
          expected: 'one label per dish',
          actual: 'merged',
        },
      ],
      autoSpot: [
        { text: 'Fruit Salad: strawberry, blueberry, raspberry share canonical id 171711', code: 'SIBLING_ID_COLLISION' },
        { text: 'Croissant: 9 micro keys at 0', code: 'MICROS_ZERO' },
        { text: 'mixed fruit cup: fallback', code: 'JOURNEY_FALLBACK' },
      ],
    };
    const journey = [
      {
        id: 'j_0',
        dish: 'Fruit Salad',
        query: 'strawberry',
        scoutIndex: 0,
        componentIndex: 0,
        phase: 'catalog' as const,
        source: 'internal_catalog',
        matchId: '167762',
        matchName: 'strawberry',
        identityPass: true,
        blockers: [],
      },
      {
        id: 'j_1',
        dish: 'Fruit Salad',
        query: 'blueberry',
        scoutIndex: 0,
        componentIndex: 1,
        phase: 'catalog' as const,
        source: 'internal_catalog',
        matchId: '171711',
        matchName: 'blueberry',
        identityPass: true,
        blockers: [],
      },
      {
        id: 'j_2',
        dish: 'Fruit Salad',
        query: 'cooked bacon',
        scoutIndex: 1,
        componentIndex: 0,
        phase: 'catalog' as const,
        source: 'internal_catalog',
        matchId: '172550',
        matchName: 'cooked_bacon',
        identityPass: true,
        blockers: [],
      },
    ];
    const next = restageBoardFromCatalog(old, journey);
    const byId = Object.fromEntries((next.invariants || []).map((i: any) => [i.id, i]));
    expect(byId.id_all_components_identified.pass).toBe(true);
    expect(byId.id_every_component_resolved.pass).toBe(true);
    expect(byId.res_no_category_fallback).toBeUndefined();
    expect(byId.math_trial_balance.pass).toBe(false);
    expect(byId.id_label_merge_collapsed.pass).toBe(false);
    expect(next.replayMode).toBe('catalog');
    const spots = (next.autoSpot || []).map((h: any) => h.text);
    expect(spots.some((t: string) => /171711/.test(t))).toBe(false);
    expect(spots.some((t: string) => /micro keys/.test(t))).toBe(true);
    const item = overlayAutoRemaining(
      emptyWorkItem({ remaining: ['Category fallback used for: strawberry, cooked bacon'], queue: 'in_progress' }),
      next
    );
    expect(item.remaining.some((r) => /fallback used for: strawberry/i.test(r))).toBe(false);
    expect(item.remaining.some((r) => /Trial balance/.test(r))).toBe(true);
    expect(item.remaining.some((r) => /micro keys/.test(r))).toBe(true);
    expect(planReanalyzeStages(next).pipeline).toBe(true);
  });

  it('uniqueTapeCheckRows drops duplicate wrap/macaroni fallback and overlapping trial-balance lines', () => {
    const rows = uniqueTapeCheckRows({
      invariants: [
        { id: 'id_ok', label: 'Every scout dish is still in the final meal', pass: true, group: 'identity' },
        {
          id: 'id_all_components_identified',
          label: 'All scout components identified (catalog or printed/brand)',
          pass: false,
          group: 'resolve',
        },
        {
          id: 'res_no_category_fallback',
          label: 'Category fallback used for: strawberry, gherkin, ranch dressing',
          pass: false,
          group: 'resolve',
        },
        {
          id: 'math_trial_balance',
          label: 'Trial balance drifted: Scout opening kcal vs saved table (2280 → 2582)',
          pass: false,
          group: 'math',
        },
        {
          id: 'ledger_scout_est_vs_saved_table',
          label: 'Scout opening kcal vs saved table (2280 → 2582)',
          pass: false,
          group: 'math',
        },
        {
          id: 'math_no_scout_scale',
          label: 'Must not scale foundation toward scout kcal',
          pass: false,
          group: 'math',
        },
        {
          id: 'ledger_reconcile_scale',
          label: 'Backend reconcile scaled item kcal',
          pass: false,
          group: 'math',
        },
      ],
      autoSpot: [
        { id: 'a', code: 'JOURNEY_FALLBACK', text: 'crispy chicken wrap: fallback' },
        { id: 'b', code: 'JOURNEY_FALLBACK', text: 'crispy chicken wrap: fallback' },
        { id: 'c', code: 'JOURNEY_FALLBACK', text: 'macaroni and cheese: fallback' },
        { id: 'd', code: 'JOURNEY_FALLBACK', text: 'macaroni and cheese: fallback' },
        { id: 'e', code: 'JOURNEY_MISMATCH', text: 'crispy chicken wrap: mismatch' },
        { id: 'f', code: 'MICROS_ZERO', text: 'butter croissant: 9 micro keys at 0' },
        { id: 'g', code: 'FALLBACK_SKEW', text: 'gherkin: category fallback 150 kcal/100g > 45 pickle' },
      ],
    });
    const labels = rows.map((r) => r.label);
    expect(labels.filter((l) => /fallback$/i.test(l) && /wrap|macaroni/i.test(l))).toEqual([]);
    expect(labels.filter((l) => /mismatch/i.test(l))).toEqual([]);
    expect(labels.filter((l) => /Scout opening kcal vs saved table/.test(l) && !/Trial balance/.test(l))).toEqual([]);
    expect(labels.filter((l) => /reconcile scaled/i.test(l))).toEqual([]);
    expect(labels.some((l) => /Trial balance drifted/.test(l))).toBe(true);
    expect(labels.some((l) => /Must not scale/.test(l))).toBe(true);
    expect(labels.some((l) => /micro keys/.test(l))).toBe(true);
    expect(labels.some((l) => /gherkin: category fallback 150/.test(l))).toBe(true);
    expect(rows.filter((r) => !r.pass).length).toBeLessThanOrEqual(7);
  });

  it('planReanalyzeStages skips live pipeline when only human remaining is open', () => {
    expect(
      planReanalyzeStages({
        invariants: [{ id: 'ok', label: 'Every scout dish is still in the final meal', pass: true, group: 'identity' }],
        autoSpot: [],
      }).pipeline
    ).toBe(false);
  });
});
