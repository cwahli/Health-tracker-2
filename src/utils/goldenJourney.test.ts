import { describe, it, expect } from 'vitest';
import {
  buildJourney,
  buildAutoInvariants,
  buildTransportInvariants,
  parseResolutionDiagnostics,
  groupJourneyByDish,
  snapshotVisibleInvariants,
  sanitizeJobErrorText,
  journeyResolvedCount,
  journeyPhaseCounts,
} from './goldenJourney';
import { buildScoreboard } from './goldenScoreboard';

const picnicLog = `
[backend] [Brand Menu Match] Matched stored brand item for "granola" -> "Co-op Blueberry Granola Yogurt Pot" (co_op)
[backend] [ResolveClass] HIT_UNIQUE for "mixed berries" -> Beverages, POWERADE, Zero, Mixed Berry
[backend] [Food Resolver Fallback] Created category fallback for gap "plain yogurt"
[backend] [Reconcile] item="Vegetarian wrap" action=scale foundation=778.7 budget=450 final=450 factor=0.578
[backend] [ReceiptInvariant] FAIL item="Croissants" rowSum=441.6 itemCal=492
[backend] [ReceiptInvariant] REPAIRED rows→softBudget factor=1.114 itemCal=492
[backend] [MatchPriority] Bound direct Curator query match id=2710321 ("Popsicle, no sugar added") for component "sugar"
[backend] [Component Resolution Diagnostic] item="Granola" (scoutIndex=0) component[0] query="granola" -> canonicalMatch=none bestMatch.source=brand_official bestMatch.id=coop_pot
[backend] [Component Resolution Diagnostic] item="Granola" (scoutIndex=0) component[1] query="plain yogurt" -> canonicalMatch=none bestMatch.source=null bestMatch.id=null
[backend] [Component Resolution Diagnostic] item="Granola" (scoutIndex=0) component[2] query="mixed berries" -> canonicalMatch=none bestMatch.source=usda bestMatch.id=174113
[backend] [Component Resolution Diagnostic] item="Vegetarian wrap" (scoutIndex=1) component[0] query="falafel" -> canonicalMatch=none bestMatch.source=internal_catalog bestMatch.id=falafel_canonical
[backend] [Dietitian Reality Check] Caloric density for "Vegetarian wrap" (312 kcal/100g) was implausible. Rescaled 778 kcal -> 450 kcal for 250g.
`;

const scout = {
  items: [
    {
      originalName: 'Granola',
      keyword: 'granola yogurt pot',
      estimatedWeightGrams: 280,
      estimatedCalories: 420,
      components: [
        { searchQuery: 'granola', volumePercentage: 30 },
        { searchQuery: 'plain yogurt', volumePercentage: 50 },
        { searchQuery: 'mixed berries', volumePercentage: 20 },
      ],
    },
    {
      originalName: 'Vegetarian wrap',
      keyword: 'vegetarian wrap',
      estimatedWeightGrams: 250,
      components: [{ searchQuery: 'falafel', volumePercentage: 40 }, { searchQuery: 'hummus', volumePercentage: 20 }],
    },
  ],
};

describe('goldenJourney — scout identity phases', () => {
  it('parses component resolution diagnostics', () => {
    const d = parseResolutionDiagnostics(picnicLog);
    expect(d.map((x) => x.query)).toEqual(['granola', 'plain yogurt', 'mixed berries', 'falafel']);
    expect(d[1].source).toBeNull();
  });

  it('walks scout components from scouted → no_match / mismatch / fallback / catalog', () => {
    const rows = buildJourney({ logText: picnicLog, scout });
    const byQ = Object.fromEntries(rows.map((r) => [r.query, r]));
    expect(byQ['plain yogurt'].phase).toBe('fallback'); // log also has category fallback
    expect(byQ['mixed berries'].phase).toBe('mismatch');
    expect(byQ['granola'].phase).toBe('mismatch'); // named never-bind: Co-op pot
    expect(byQ['falafel'].phase).toBe('catalog');
    expect(byQ['falafel'].identityPass).toBe(true);
    expect(byQ['hummus'].phase).toBe('scouted'); // scouted, no diagnostic
    expect(byQ['hummus'].identityPass).toBe(false);
  });

  it('fills scouted rows from saved foodLog dbSource when logs are missing', () => {
    const rows = buildJourney({
      scout: {
        items: [
          {
            originalName: 'butter croissant',
            components: [
              { searchQuery: 'wheat flour' },
              { searchQuery: 'strawberry' },
              { searchQuery: 'milk' },
            ],
          },
        ],
      },
      foodLog: {
        itemsBreakdown: [
          {
            name: 'Croissant',
            components: [
              { name: 'wheat flour', dbSource: 'internal_catalog', dbId: '172242' },
              { name: 'strawberry', dbSource: 'category_fallback' },
              { name: 'milk', dbSource: 'usda', fdcId: '746782' },
            ],
          },
        ],
      },
    });
    const byQ = Object.fromEntries(rows.map((r) => [r.query, r]));
    expect(byQ['wheat flour'].phase).toBe('catalog');
    expect(byQ['wheat flour'].identityPass).toBe(true);
    expect(byQ['strawberry'].phase).toBe('fallback');
    expect(byQ['milk'].phase).toBe('usda_live');
    expect(byQ['milk'].identityPass).toBe(false);
    expect(journeyPhaseCounts(rows).fallback).toBe(1);
    expect(journeyResolvedCount(rows)).toBe(2);
  });

  it('treats dietitian rescale as a blocker on that dish', () => {
    const rows = buildJourney({ logText: picnicLog, scout });
    const wrap = rows.filter((r) => r.dish === 'Vegetarian wrap');
    expect(wrap.some((r) => r.blockers.includes('dietitian_adjusted'))).toBe(true);
    expect(wrap.some((r) => r.blockers.includes('scaled'))).toBe(true);
  });
});

describe('goldenJourney — printed-label meals', () => {
  it('treats hard_lock dishes as label_truth even without Component Resolution Diagnostic', () => {
    const log = `
[backend] [Reconcile] item="Prawn Layered Pasta Salad" action=hard_lock foundation=374 budget=374 final=374 factor=1.000
[backend] [Truth Direct Injection] "Prawn Layered Pasta Salad": Using direct nutrients (374 kcal) from label
[backend] [Reconcile] item="Serrano Ham Gran Reserva 50% Duroc Breed" action=hard_lock foundation=246 budget=246 final=246 factor=1.000
[backend] [Dietitian Reality Check] Heuristic checks skipped for "Prawn Layered Pasta Salad" — dbSource is "label".
`;
    const scout = {
      items: [
        {
          originalName: 'Prawn Layered Pasta Salad',
          components: [{ searchQuery: 'cooked pasta' }, { searchQuery: 'cooked prawns' }],
        },
        { originalName: 'Serrano Ham Gran Reserva 50% Duroc Breed', components: [{ searchQuery: 'serrano ham' }] },
      ],
    };
    const rows = buildJourney({ logText: log, scout });
    expect(rows.every((r) => r.phase === 'label_truth')).toBe(true);
    expect(rows.every((r) => r.identityPass)).toBe(true);
    expect(rows.some((r) => r.blockers.includes('dietitian_adjusted'))).toBe(false);
  });
});

describe('goldenJourney — auto invariants (no user text)', () => {
  it('flags fallback, scale, receipt repair, and dietitian rewrite from the log', () => {
    const journey = buildJourney({ logText: picnicLog, scout });
    const inv = buildAutoInvariants({ logText: picnicLog, scout, journey, foodLog: { itemsBreakdown: [] } });
    const ids = inv.filter((i) => !i.pass).map((i) => i.id);
    expect(ids).toContain('res_no_category_fallback');
    expect(ids).toContain('math_no_scout_scale');
    expect(ids).toContain('math_receipt_invariant');
    expect(ids).toContain('diet_no_reality_rewrite');
    expect(ids).toContain('id_scout_items_present');
    expect(ids).toContain('id_all_components_identified');
    expect(ids).toContain('math_trial_balance');
  });

  it('flags zero-macro items, blank fields, and rewritten truth', () => {
    const foodLog = {
      calories: 900,
      itemsBreakdown: [
        {
          originalName: 'Granola',
          weightGrams: 280,
          calories: 0,
          nutrients: { calories: 0, protein: 0, carbohydrates: 0, totalFat: 0 },
        },
        {
          originalName: 'Vegetarian wrap',
          weightGrams: 250,
          dbSource: 'label',
          lockedNutrientKeys: ['calories'],
          truthNutrients: { calories: 480 },
          nutrients: { calories: 390, protein: 15, carbohydrates: 40, totalFat: 18 },
        },
      ],
    };
    const inv = buildAutoInvariants({ foodLog, journey: [] });
    const ids = inv.filter((i) => !i.pass).map((i) => i.id);
    expect(ids).toContain('math_no_zero_macro_items');
    expect(ids).toContain('truth_not_recalculated');
    expect(ids).toContain('math_meal_total_matches_items');
    expect(ids).toContain('shape_label_blank_vegetarian_wrap');
  });

  it('hooks into buildScoreboard so snapshot does not need typed extras', () => {
    const board = buildScoreboard({ logText: picnicLog, scout, foodLog: { itemsBreakdown: [] } });
    expect(board.journey?.length).toBeGreaterThan(3);
    expect(board.outcomes.some((o) => /plain yogurt/.test(o.label))).toBe(true);
    expect(board.outcomes.some((o) => /Dietitian must not rewrite/.test(o.label))).toBe(true);
    expect(board.outcomes.every((o) => o.source !== 'user')).toBe(true);
  });
});

const prawnHappyLog = `
[backend] [Brand DB Match] Found official restaurant/brand menu item for "Serrano Ham Gran Reserva 50% Duroc Breed" -> "Serrano Ham Gran Reserva 50% Duroc Breed" (aromas_del_sur)
[backend] [Brand DB Match] Found official restaurant/brand menu item for "serrano ham" -> "Serrano Ham Gran Reserva 50% Duroc Breed" (aromas_del_sur)
[backend] [Brand DB Match] Found official restaurant/brand menu item for "cooked ham" -> "Co-op Formed Ham" (co_op_formed_ham)
[backend] [Truth Merge] Database match calories (246) deviate too much from OCR label (102). Refusing to merge DB macros.
[backend] [Truth Data Backfill] "Pink Iced Ring Doughnut": filled missing fields via ingredient_decomposition; locked truth keys=[calories]; estimated=[protein, totalFat, saturatedFat, sodium, carbohydrates, totalFibre, addedSugar, solubleFibre, potassium].
[backend] [Salt->Sodium Conversion] "Serrano Ham Gran Reserva 50% Duroc Breed": Transcribed salt 4.70g (per 100g serving) -> Converted to 1880mg sodium per serving.
[backend] [Reconcile] item="Prawn Layered Pasta Salad" action=hard_lock foundation=374 budget=374 final=374 factor=1.000
[backend] [Truth Direct Injection] "Prawn Layered Pasta Salad": Using direct nutrients (374 kcal) from label
[backend] [LocalDictionaryMatch] Resolved locally for "pink sugar icing" -> FDC 169652 ("sugar frosting or icing")
[backend] [CuratorAction] pick_existing for "pink sugar icing" -> 169652
[backend] [Food Resolver Fallback] Created category fallback for gap "pink sugar icing"
[backend] [Dietitian Reality Check] Heuristic checks skipped for "Prawn Layered Pasta Salad" — dbSource is "label".
`;

const prawnScout = {
  items: [
    {
      originalName: 'Prawn Layered Pasta Salad',
      components: [
        { searchQuery: 'cooked pasta' },
        { searchQuery: 'mixed vegetables' },
        { searchQuery: 'iceberg lettuce' },
        { searchQuery: 'cooked prawns' },
      ],
    },
    { originalName: 'Serrano Ham Gran Reserva', components: [{ searchQuery: 'serrano ham' }] },
    { originalName: 'Pink Iced Ring Doughnut', components: [{ searchQuery: 'ring doughnut' }, { searchQuery: 'pink sugar icing' }] },
    { originalName: 'Reformed Ham Cured', components: [{ searchQuery: 'cooked ham' }] },
  ],
};

describe('goldenJourney — label merge dropped a scout food', () => {
  it('flags a reformed-ham label glued onto serrano', () => {
    const log = `
[backend] [Label Merge] Matched label "Reformed Ham Nutrition Facts Label" (sourceImageIndex=0) -> "Gran Reserva Serrano Ham 50% Duroc Breed" (sourceImageIndex=4).
[backend] [scout_answer] Scout identified 3 item(s)
`;
    const inv = buildAutoInvariants({ logText: log, scout: { items: [] }, journey: [] });
    const row = inv.find((i) => i.id === 'id_label_merge_collapsed');
    expect(row?.pass).toBe(false);
    expect(row?.label).toMatch(/Reformed Ham/);
    expect(row?.label).toMatch(/Serrano/);
  });
});

describe('goldenJourney — leftover stall must not mask a finished meal', () => {
  it('drops stall errorText when the log already completed', () => {
    expect(
      sanitizeJobErrorText(
        'Stream stalled: No response from analysis engine within 90s.',
        prawnHappyLog,
        'succeeded'
      )
    ).toBe('');
    const inv = buildTransportInvariants({
      logText: prawnHappyLog,
      errorText: 'Stream stalled: No response from analysis engine within 90s.',
      jobStatus: 'succeeded',
    });
    expect(inv.some((i) => i.id === 'tr_stage_died')).toBe(false);
  });

  it('still flags a real stall when the job never finished', () => {
    const inv = buildTransportInvariants({
      logText: '[Vision Scout] waiting for first token',
      errorText: 'Stream stalled: No response from analysis engine within 90s.',
      jobStatus: 'failed',
    });
    expect(inv.some((i) => i.id === 'tr_stage_died')).toBe(true);
  });
});

describe('goldenJourney — uncaptured log issues', () => {
  it('does not treat leftover fallback as identity after curator pick_existing', () => {
    const rows = buildJourney({ logText: prawnHappyLog, scout: prawnScout });
    const icing = rows.find((r) => r.query === 'pink sugar icing');
    expect(icing?.phase).toBe('catalog');
    expect(icing?.identityPass).toBe(true);
    const pasta = rows.find((r) => r.query === 'cooked pasta');
    expect(pasta?.phase).toBe('label_truth');
  });

  it('captures truth-merge false match, estimated doughnut macros, and duplicate brand hits', () => {
    const journey = buildJourney({ logText: prawnHappyLog, scout: prawnScout });
    const inv = buildAutoInvariants({ logText: prawnHappyLog, scout: prawnScout, journey });
    const ids = inv.filter((i) => !i.pass).map((i) => i.id);
    expect(ids).toContain('res_truth_merge_db_mismatch');
    expect(ids.some((id) => id.startsWith('res_dup_brand_'))).toBe(true);
    const doughnut = inv.find((i) => String(i.id).startsWith('truth_estimated_macros_'));
    expect(doughnut?.pass).toBe(true);
    expect(doughnut?.label).toMatch(/derived from base food/i);
    expect(inv.find((i) => i.id === 'res_truth_merge_db_mismatch')?.label).toMatch(/246.*102/);
  });

  it('passes truth-merge when the printed 102 kcal stayed on reformed ham, not Serrano', () => {
    const log = `[backend] [Truth Merge] Database match calories (150) deviate too much from OCR label (102). Refusing to merge DB macros.`;
    const inv = buildAutoInvariants({
      logText: log,
      foodLog: {
        itemsBreakdown: [
          { originalName: 'Gran Reserva Serrano Ham 50% Duroc Breed', calories: 246 },
          { originalName: 'Reformed Ham Nutrition Facts Label', calories: 102 },
        ],
      },
    });
    const row = inv.find((i) => i.id === 'res_truth_merge_db_mismatch');
    expect(row?.pass).toBe(true);
    expect(row?.label).toMatch(/kept the label/i);
  });

  it('groups pasta salad ingredients under one dish heading', () => {
    const journey = buildJourney({ logText: prawnHappyLog, scout: prawnScout });
    const groups = groupJourneyByDish(journey);
    const pasta = groups.find((g) => /Prawn Layered Pasta Salad/i.test(g.dish));
    expect(pasta?.rows.map((r) => r.query)).toEqual([
      'cooked pasta',
      'mixed vegetables',
      'iceberg lettuce',
      'cooked prawns',
    ]);
  });

  it('hides passing / redundant snapshot titles when the journey already shows fallback', () => {
    const journey = buildJourney({ logText: prawnHappyLog, scout: prawnScout });
    const inv = buildAutoInvariants({ logText: prawnHappyLog, scout: prawnScout, journey });
    const shown = snapshotVisibleInvariants(inv, journey);
    expect(shown.some((i) => i.id === 'id_all_components_identified')).toBe(false);
    expect(shown.some((i) => i.id === 'res_no_category_fallback')).toBe(false);
    expect(shown.some((i) => i.id === 'res_truth_merge_db_mismatch')).toBe(true);
  });
});
