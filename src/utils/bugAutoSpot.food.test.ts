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
          id: 'j_0_0_onion',
          dish: 'macaroni and cheese',
          query: 'crispy onion',
          scoutIndex: 0,
          componentIndex: 0,
          phase: 'fallback',
          source: 'category',
          matchId: null,
          matchName: null,
          identityPass: false,
          blockers: [],
        },
        {
          id: 'j_0_1_mayo',
          dish: 'macaroni and cheese',
          query: 'spicy mayonnaise',
          scoutIndex: 0,
          componentIndex: 1,
          phase: 'fallback',
          source: 'category',
          matchId: null,
          matchName: null,
          identityPass: false,
          blockers: [],
        },
        {
          id: 'j_0_0_yogurt',
          dish: 'yogurt',
          query: 'plain yogurt',
          scoutIndex: 1,
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
    const mac = fallback.remaining.filter((h) => /macaroni and cheese: fallback/i.test(h.text));
    expect(mac).toHaveLength(1);
    expect(mac[0].text).toMatch(/crispy onion/);
    expect(mac[0].text).toMatch(/spicy mayonnaise/);
  });

  it('parks ledger SILENT_REPAIR instead of remaining', () => {
    const hits = autoSpotFood({
      logText: '[Dietitian Reality Check] Adjusted calories for "wrap"\n[Reconcile] item="wrap" action=scale foundation=800 budget=450 final=450 factor=0.56',
      foodLog: { itemsBreakdown: [{ originalName: 'wrap', calories: 450 }] },
    });
    expect(hits.parked.some((h) => h.code === 'LEDGER_SILENT_REPAIR')).toBe(true);
    expect(hits.remaining.some((h) => h.code === 'LEDGER_SILENT_REPAIR')).toBe(false);
  });

  it('flags CURATOR_SKIP from pick_existing skip lines (not one meal’s FDC list)', () => {
    const hits = autoSpotFood({
      logText: `
[backend] [CuratorAction] No pick_existing action found for "fresh kiwifruit". Skipping.
[backend] [CuratorAction] No pick_existing action found for "pickled onion". Skipping.
[backend] [CuratorAction] No pick_existing action found for "fresh kiwifruit". Skipping.
`,
    });
    const row = hits.remaining.find((h) => h.code === 'CURATOR_SKIP');
    expect(row).toBeTruthy();
    expect(row?.class).toBe('OPENING_WRONG');
    expect(row?.text).toMatch(/2 quer/i);
    expect(row?.text).toMatch(/kiwifruit/i);
    expect(hits.remaining.filter((h) => h.code === 'CURATOR_SKIP')).toHaveLength(1);
  });

  it('flags SIBLING_ID_COLLISION when distinct berries share one canonical id', () => {
    const fromLog = autoSpotFood({
      logText: `
[backend] [Component Resolution Diagnostic] item="Fruit Cup" (scoutIndex=0) component[0] query="fresh strawberries" -> canonicalMatch="171711" bestMatch.source=null bestMatch.id=null
[backend] [Component Resolution Diagnostic] item="Fruit Cup" (scoutIndex=0) component[1] query="fresh blueberries" -> canonicalMatch="171711" bestMatch.source=null bestMatch.id=null
[backend] [Component Resolution Diagnostic] item="Fruit Cup" (scoutIndex=0) component[2] query="fresh raspberries" -> canonicalMatch="171711" bestMatch.source=null bestMatch.id=null
`,
    });
    expect(fromLog.remaining.some((h) => h.code === 'SIBLING_ID_COLLISION' && /171711/.test(h.text))).toBe(true);

    const fromItems = autoSpotFood({
      foodLog: {
        itemsBreakdown: [
          {
            originalName: 'Yogurt fruit pot',
            components: [
              { name: 'fresh blackberries', fdcId: '146437' },
              { name: 'fresh cherries', fdcId: '146437' },
            ],
          },
        ],
      },
    });
    expect(fromItems.remaining.some((h) => h.code === 'SIBLING_ID_COLLISION' && /146437/.test(h.text))).toBe(true);
  });

  it('does not flag two spellings of the same fruit sharing an id', () => {
    const hits = autoSpotFood({
      foodLog: {
        itemsBreakdown: [
          {
            originalName: 'Berry cup',
            components: [
              { name: 'fresh strawberry', fdcId: '167762' },
              { name: 'strawberries', fdcId: '167762' },
            ],
          },
        ],
      },
    });
    expect(hits.remaining.some((h) => h.code === 'SIBLING_ID_COLLISION')).toBe(false);
  });

  it('flags FALLBACK_SKEW for pickle/avocado density, not a reasonable chicken fallback', () => {
    const pickle = autoSpotFood({
      logText: `[backend] [Food Resolver Fallback] Created category fallback for gap "pickled cucumber": {"calories":150,"protein":7,"totalFat":5.5,"carbohydrates":18}`,
    });
    expect(pickle.remaining.some((h) => h.code === 'FALLBACK_SKEW' && /pickle/i.test(h.text))).toBe(true);

    const avocado = autoSpotFood({
      logText: `[backend] [Food Resolver Fallback] Created category fallback for gap "avocado raw": {"calories":40,"protein":1,"totalFat":0.2,"carbohydrates":9}`,
    });
    expect(avocado.remaining.some((h) => h.code === 'FALLBACK_SKEW' && /avocado/i.test(h.text))).toBe(true);

    const chicken = autoSpotFood({
      logText: `[backend] [Food Resolver Fallback] Created category fallback for gap "grilled chicken breast": {"calories":165,"protein":31,"totalFat":3.6,"carbohydrates":0}`,
    });
    expect(chicken.remaining.some((h) => h.code === 'FALLBACK_SKEW')).toBe(false);
  });

  it('flags COMPONENT_DROP when a visual ingredient is missing from scout and receipt', () => {
    const hits = autoSpotFood({
      scout: {
        items: [
          {
            originalName: 'Cobb salad',
            visualIngredients: [
              'feta cheese',
              'avocado',
              'bacon',
              'chicken',
              'red onion',
              'cherry tomato',
              'eggs',
              'mix leaves',
            ],
            components: [
              { searchQuery: 'mix greens salad leaves' },
              { searchQuery: 'grilled chicken breast' },
              { searchQuery: 'avocado raw' },
              { searchQuery: 'feta cheese' },
              { searchQuery: 'hard boiled egg' },
              { searchQuery: 'cherry tomato' },
              { searchQuery: 'bacon bits' },
            ],
          },
        ],
      },
      foodLog: {
        itemsBreakdown: [
          {
            originalName: 'Cobb salad',
            components: [
              { name: 'mix greens salad leaves' },
              { name: 'grilled chicken breast' },
              { name: 'avocado raw' },
              { name: 'feta cheese' },
              { name: 'hard boiled egg' },
              { name: 'cherry tomato' },
              { name: 'bacon bits' },
            ],
          },
        ],
      },
    });
    expect(hits.remaining.some((h) => h.code === 'COMPONENT_DROP' && /red onion/i.test(h.text))).toBe(true);
  });

  it('does not flag COMPONENT_DROP when visual names are covered by components', () => {
    const hits = autoSpotFood({
      scout: {
        items: [
          {
            originalName: 'Garden salad',
            visualIngredients: ['chicken', 'tomato', 'lettuce'],
            components: [
              { searchQuery: 'grilled chicken breast' },
              { searchQuery: 'cherry tomato' },
              { searchQuery: 'romaine lettuce' },
            ],
          },
        ],
      },
    });
    expect(hits.remaining.some((h) => h.code === 'COMPONENT_DROP')).toBe(false);
  });

  it('spots curator skip, berry id collision, pickle fallback skew, and onion drop on one tape', () => {
    const hits = autoSpotFood({
      logText: `
[backend] [CuratorAction] No pick_existing action found for "fresh strawberries". Skipping.
[backend] [CuratorAction] No pick_existing action found for "gherkin". Skipping.
[backend] [Food Resolver Fallback] Created category fallback for gap "gherkin": {"calories":150,"protein":7,"totalFat":5.5,"carbohydrates":18}
[backend] [Component Resolution Diagnostic] item="Fruit Cup" (scoutIndex=0) component[0] query="fresh strawberries" -> canonicalMatch="171711" bestMatch.source=null bestMatch.id=null
[backend] [Component Resolution Diagnostic] item="Fruit Cup" (scoutIndex=0) component[1] query="fresh blueberries" -> canonicalMatch="171711" bestMatch.source=null bestMatch.id=null
`,
      scout: {
        items: [
          {
            originalName: 'Cobb salad',
            visualIngredients: ['chicken', 'red onion', 'mix leaves'],
            components: [{ searchQuery: 'grilled chicken breast' }, { searchQuery: 'mix greens salad leaves' }],
          },
        ],
      },
    });
    expect(hits.remaining.some((h) => h.code === 'CURATOR_SKIP')).toBe(true);
    expect(hits.remaining.some((h) => h.code === 'SIBLING_ID_COLLISION')).toBe(true);
    expect(hits.remaining.some((h) => h.code === 'FALLBACK_SKEW' && /gherkin/i.test(h.text))).toBe(true);
    expect(hits.remaining.some((h) => h.code === 'COMPONENT_DROP' && /red onion/i.test(h.text))).toBe(true);
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
