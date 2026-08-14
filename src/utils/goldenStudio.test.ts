import { describe, it, expect } from 'vitest';
import { buildGoldenChecklist, classifyStudioRed, formatGoldenShare, replayTapeBanner, statusForGoldenCheck, studioLoopPlan } from './goldenStudio';

describe('classifyStudioRed', () => {
  it('tells studio a label-merge needs a new Analyze, not log replay', () => {
    const c = classifyStudioRed('id_label_merge_collapsed', 'Scout label merged into Serrano');
    expect(c.next).toMatch(/NEW Analyze/i);
    expect(c.next).not.toMatch(/^Replay log/);
    expect(c.youDo).toMatch(/NEW Analyze/i);
    expect(c.kind).toBe('new_analyze');
  });

  it('treats kcal-only doughnut estimates as accept, not a code hunt', () => {
    const c = classifyStudioRed('truth_estimated_macros_x', 'ingredient_decomposition');
    expect(c.next).toMatch(/derived from base food|printed kcal/i);
    expect(c.kind).toBe('accept');
    expect(c.youDo).toMatch(/nothing|supposed to work/i);
  });

  it('tells studio Replay log cannot clear a weight overwrite', () => {
    const c = classifyStudioRed(
      'id_weight_anchor_overwrite_mango_lassi',
      'User weights 500g then 1000g were both applied to "mango lassi yogurt drink"'
    );
    expect(c.next).toMatch(/NEW Analyze/i);
    expect(c.next).toMatch(/stays red/i);
    expect(c.kind).toBe('new_analyze');
  });
});

describe('goldenChecklist', () => {
  it('keeps a cleared check as Fixed and a weight overwrite as Need Analyze', () => {
    expect(statusForGoldenCheck('res_truth_merge_db_mismatch', 'kept the label', true)).toBe('fixed');
    expect(
      statusForGoldenCheck(
        'id_weight_anchor_overwrite_mango',
        'User weights 500g then 1000g were both applied to mango lassi',
        false
      )
    ).toBe('need_analyze');
    const list = buildGoldenChecklist({
      outcomes: [
        { id: 'res_truth_merge_db_mismatch', label: 'kept the label', pass: true, kind: 'log_event' },
        { id: 'id_weight_anchor_overwrite_x', label: 'User weights 500g then 1000g overwrote', pass: false, kind: 'identity' },
      ],
    });
    expect(list.find((r) => r.id === 'res_truth_merge_db_mismatch')?.status).toBe('fixed');
    expect(list.find((r) => r.id.startsWith('id_weight'))?.status).toBe('need_analyze');
  });
});

describe('replayTapeBanner', () => {
  it('does not mention Lassi on a ham label-merge case', () => {
    const text = replayTapeBanner([
      { id: 'id_label_merge_collapsed', label: 'Scout label Reformed Ham merged into Serrano' },
    ]);
    expect(text).toMatch(/original tape/i);
    expect(text).toMatch(/NEW Analyze/i);
    expect(text).not.toMatch(/500ml|Lassi/i);
  });
});

describe('studioLoopPlan', () => {
  it('after a NEW Analyze, a leftover search-vs-label fight is not “click Analyze again”', () => {
    const plan = studioLoopPlan(
      [
        {
          id: 'res_truth_merge_db_mismatch',
          label: 'DB match 150 kcal rejected vs OCR label 102 kcal',
          pass: false,
          enabled: true,
        },
        {
          id: 'truth_estimated_macros_doughnut',
          label: 'ingredient_decomposition',
          pass: false,
          enabled: true,
        },
      ],
      { mealMisses: ['missing item "Ham" (presence only)'], replayMode: 'analyze' }
    );
    expect(plan.mayLoop).toBe(false);
    expect(plan.instructions).toMatch(/already ran/i);
    expect(plan.instructions).not.toMatch(/click NEW Analyze on this card/i);
  });

  it('does not let Studio loop a picnic case that only has scout + accept reds', () => {
    const plan = studioLoopPlan([
      { id: 'id_label_merge_collapsed', label: 'Scout label merged into Serrano', pass: false, enabled: true },
      { id: 'res_truth_merge_db_mismatch', label: 'DB match 246 vs OCR 102', pass: false, enabled: true },
      {
        id: 'truth_estimated_macros_doughnut',
        label: 'Pink Iced Ring Doughnut ingredient_decomposition',
        pass: false,
        enabled: true,
      },
    ]);
    expect(plan.mayLoop).toBe(false);
    expect(plan.promoteGreen).toBe(false);
    expect(plan.studioMayClaim).toBe('pipeline_done_human_analyze');
    expect(plan.instructions).toMatch(/Do NOT POST \/loop/i);
  });

  it('treats accept-only leftover as code-green', () => {
    const plan = studioLoopPlan([
      {
        id: 'truth_estimated_macros_doughnut',
        label: 'only [calories] locked; ingredient_decomposition',
        pass: false,
        enabled: true,
      },
    ]);
    expect(plan.mayLoop).toBe(false);
    expect(plan.promoteGreen).toBe(true);
    expect(plan.studioMayClaim).toBe('complete');
  });
});

describe('formatGoldenShare', () => {
  it('copies a compact highlight a human can paste', () => {
    const md = formatGoldenShare({
      id: 'abc',
      title: 'Prawn Layered Pasta Salad + Serrano',
      jobId: 'job_1',
      replayMode: 'log',
      query: 'Analyze this meal photo.',
      photoCount: 6,
      pending: [
        { group: 'identity', label: 'label merge', youDo: 'You: NEW Analyze' },
      ],
    });
    expect(md).toContain('Case: abc');
    expect(md).toContain('You: NEW Analyze');
    expect(md).toContain('Photos: 6');
  });
});
