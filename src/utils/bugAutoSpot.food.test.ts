import { describe, it, expect } from 'vitest';
import { autoSpotFood } from './bugAutoSpot';
import { buildScoreboard } from './goldenScoreboard';

const tenZeroMicros = {
  potassium: 0,
  magnesium: 0,
  calcium: 0,
  iron: 0,
  zinc: 0,
  selenium: 0,
  iodine: 0,
  phosphorus: 0,
  vitaminD: 0,
  vitaminC: 0,
};

describe('autoSpotFood', () => {
  it('flags MICROS_ZERO on a new label item with ≥8 zero micros', () => {
    const hits = autoSpotFood({
      foodLog: {
        itemsBreakdown: [
          { originalName: 'Brand granola yogurt', dbSource: 'label', nutrients: tenZeroMicros },
        ],
      },
    });
    expect(hits.remaining.some((h) => h.code === 'MICROS_ZERO')).toBe(true);
  });

  it('does not flag a USDA staple that simply omits micros', () => {
    const hits = autoSpotFood({
      foodLog: {
        itemsBreakdown: [{ originalName: 'Banana', dbSource: 'usda', nutrients: { calories: 89, potassium: 358 } }],
      },
    });
    expect(hits.remaining.some((h) => h.code === 'MICROS_ZERO')).toBe(false);
  });

  it('flags BRAND_LEAK when a generic fruit inherits a chain', () => {
    const hits = autoSpotFood({
      foodLog: {
        name: 'Sainsbury oats + plum',
        itemsBreakdown: [
          {
            originalName: 'Sainsbury oats',
            chainName: 'Sainsbury',
            dbSource: 'composite',
            components: [
              { name: 'oats', chainName: 'Sainsbury' },
              { name: 'fresh plum', chainName: 'Sainsbury' },
            ],
          },
        ],
      },
    });
    expect(hits.remaining.some((h) => h.code === 'BRAND_LEAK' && /plum/i.test(h.text))).toBe(true);
  });

  it('flags STAPLE_COMPOSITE for dough-only baguette, not a mixed salad', () => {
    const baguette = autoSpotFood({
      foodLog: {
        itemsBreakdown: [
          {
            originalName: 'Baguette',
            hasComponents: true,
            dbSource: 'composite',
            components: [{ name: 'Wheat flour' }, { name: 'Water' }, { name: 'Salt' }, { name: 'Yeast' }],
          },
        ],
      },
    });
    expect(baguette.remaining.some((h) => h.code === 'STAPLE_COMPOSITE')).toBe(true);

    const salad = autoSpotFood({
      foodLog: {
        itemsBreakdown: [
          {
            originalName: 'Chicken salad',
            hasComponents: true,
            components: [{ name: 'chicken' }, { name: 'tomato' }, { name: 'olive oil' }],
          },
        ],
      },
    });
    expect(salad.remaining.some((h) => h.code === 'STAPLE_COMPOSITE')).toBe(false);
  });

  it('flags PORTION_PACK when pack servings dwarf the photo/scout count', () => {
    const hits = autoSpotFood({
      scout: { items: [{ originalName: 'Butter croissant' }] },
      foodLog: {
        itemsBreakdown: [{ originalName: 'Butter croissant', servingsPerPack: 6, quantity: 1 }],
      },
    });
    expect(hits.remaining.some((h) => h.code === 'PORTION_PACK')).toBe(true);
  });

  it('does not treat Scouted only as remaining; does flag fallback', () => {
    const scouted = autoSpotFood({
      journey: [
        {
          id: 'j_0_0_oats',
          dish: 'oats',
          query: 'oats',
          scoutIndex: 0,
          componentIndex: 0,
          phase: 'scouted',
          source: null,
          matchId: null,
          matchName: null,
          identityPass: false,
          blockers: [],
        },
      ],
    });
    expect(scouted.remaining.some((h) => /scouted only/i.test(h.text))).toBe(false);
    expect(scouted.remaining.some((h) => h.code.startsWith('JOURNEY_'))).toBe(false);

    const fallback = autoSpotFood({
      journey: [
        {
          id: 'j_0_0_yogurt',
          dish: 'yogurt',
          query: 'plain yogurt',
          scoutIndex: 0,
          componentIndex: 0,
          phase: 'fallback',
          source: 'category',
          matchId: null,
          matchName: null,
          identityPass: false,
          blockers: [],
        },
      ],
    });
    expect(fallback.remaining.some((h) => h.code === 'JOURNEY_FALLBACK')).toBe(true);
  });

  it('parks ledger SILENT_REPAIR instead of remaining', () => {
    const hits = autoSpotFood({
      logText: '[Dietitian Reality Check] Adjusted calories for "wrap"\n[Reconcile] item="wrap" action=scale foundation=800 budget=450 final=450 factor=0.56',
      foodLog: { itemsBreakdown: [{ originalName: 'wrap', calories: 450 }] },
    });
    expect(hits.parked.some((h) => h.code === 'LEDGER_SILENT_REPAIR')).toBe(true);
    expect(hits.remaining.some((h) => h.code === 'LEDGER_SILENT_REPAIR')).toBe(false);
  });

  it('buildScoreboard exposes remaining autoSpot and still omits Scouted only', () => {
    const board = buildScoreboard({
      logText: '[backend] [Reconcile] item="Brand granola yogurt" action=hard_lock foundation=120 budget=120 final=120 factor=1.000',
      foodLog: {
        itemsBreakdown: [
          { originalName: 'Brand granola yogurt', dbSource: 'label', nutrients: tenZeroMicros },
        ],
      },
      scout: { items: [{ originalName: 'Brand granola yogurt', components: [{ searchQuery: 'granola' }] }] },
    });
    expect(board.autoSpot?.some((h) => h.code === 'MICROS_ZERO')).toBe(true);
    expect(board.autoSpot?.some((h) => /scouted only/i.test(h.text))).toBe(false);
  });
});
