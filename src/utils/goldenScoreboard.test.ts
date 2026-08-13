import { describe, it, expect } from 'vitest';
import {
  parseKnownFails,
  parseTensions,
  extractMealLines,
  evaluateLogOutcomes,
  evaluateMealLines,
  buildScoreboard,
} from './goldenScoreboard';

const picnicLog = `
[backend] [Brand Menu Match] Matched stored brand item for "granola" -> "Co-op Blueberry Granola Yogurt Pot" (co_op)
[backend] [ResolveClass] HIT_UNIQUE for "mixed berries" -> Beverages, POWERADE, Zero, Mixed Berry
[backend] [Food Resolver Fallback] Created category fallback for gap "plain yogurt"
[backend] [Reconcile] item="Vegetarian wrap" action=scale foundation=778.7 budget=450 final=450 factor=0.578
[backend] [ReceiptInvariant] FAIL item="Croissants" rowSum=441.6 itemCal=492
[backend] [ReceiptInvariant] REPAIRED rows→softBudget factor=1.114 itemCal=492
[backend] [MatchPriority] Bound direct Curator query match id=2710321 ("Popsicle, no sugar added") for component "sugar"
`;

describe('goldenScoreboard parser', () => {
  it('captures declared never-match and log events', () => {
    const rows = parseKnownFails(picnicLog);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('never_powerade');
    expect(ids).toContain('never_popsicle');
    expect(ids).toContain('never_coop_granola');
    expect(ids).toContain('log_category_fallback');
    expect(ids).toContain('log_receipt_repair');
    expect(ids).toContain('log_scout_scale');
  });

  it('surfaces scale / receipt tensions for investigation', () => {
    const t = parseTensions(picnicLog);
    expect(t.some((x) => x.note.includes('scaled'))).toBe(true);
    expect(t.some((x) => x.note.includes('Line sum'))).toBe(true);
  });

  it('does not pass meal totals when one line is under and another over', () => {
    const expected = [
      { name: 'Wrap', weightGrams: 250, calories: 480, protein: 15, carbohydrates: 40, totalFat: 26, sodium: 700, scored: true },
      { name: 'Salad', weightGrams: 350, calories: 490, protein: 50, carbohydrates: 11, totalFat: 26, sodium: 180, scored: true },
    ];
    const actual = [
      { name: 'Wrap', weightGrams: 250, calories: 400, protein: 15, carbohydrates: 40, totalFat: 26, sodium: 700, scored: true },
      { name: 'Salad', weightGrams: 350, calories: 570, protein: 50, carbohydrates: 11, totalFat: 26, sodium: 180, scored: true },
    ];
    const r = evaluateMealLines(expected, actual);
    expect(r.pass).toBe(false);
    expect(r.misses.some((m) => /Wrap calories/.test(m))).toBe(true);
  });

  it('log replay flips never-match to pass when signature is gone', () => {
    const drafted = parseKnownFails(picnicLog);
    const cleaned = evaluateLogOutcomes(drafted, 'happy path, no forbidden binds');
    expect(cleaned.every((o) => o.pass === true)).toBe(true);
  });

  it('extracts meal lines from itemsBreakdown', () => {
    const lines = extractMealLines({
      itemsBreakdown: [{ canonicalDbName: 'Ham', weightGrams: 120, calories: 145, nutrients: { protein: 25 } }],
    });
    expect(lines[0].name).toBe('Ham');
    expect(lines[0].calories).toBe(145);
    expect(lines[0].protein).toBe(25);
  });

  it('user extra issues land as custom outcomes', () => {
    const board = buildScoreboard({ logText: '', extraIssues: ['falafel bound to wrap'] });
    expect(board.outcomes.some((o) => o.source === 'user' && /falafel/.test(o.label))).toBe(true);
  });
});
