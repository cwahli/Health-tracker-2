import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const DIR = path.join(__dirname, '..', 'golden', 'meal', 'Meal_01');
const exp = JSON.parse(fs.readFileSync(path.join(DIR, 'expected.json'), 'utf-8'));
const turn01 = fs.readFileSync(path.join(DIR, 'ideal_debug_turn01.md'), 'utf-8');
const turn02 = fs.readFileSync(path.join(DIR, 'ideal_debug_turn02.md'), 'utf-8');
const turn03 = fs.readFileSync(path.join(DIR, 'ideal_debug_turn03.md'), 'utf-8');
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

describe('Golden Meal_01 — fixtures', () => {
  it('has 5 photos ≤200KB with no content hints in names', () => {
    for (let n = 1; n <= 5; n++) {
      const f = path.join(DIR, `photo_0${n}.jpg`);
      expect(fs.existsSync(f), f).toBe(true);
      expect(fs.statSync(f).size).toBeLessThanOrEqual(200 * 1024);
    }
  });

  it('totals equal dish column sums across all 32 nutrient keys', () => {
    const keys = Object.keys(exp.totals.nutrients);
    expect(keys).toHaveLength(32);
    for (const k of keys) {
      const sum = exp.dishes.reduce((a: number, d: any) => a + d.nutrients[k], 0);
      expect(sum).toBeCloseTo(exp.totals.nutrients[k], 2);
    }
  });

  it('pack-default ledger matches whole-pack math', () => {
    expect(exp.packDefaultLedger.nutrients.calories).toBeCloseTo(4240.6, 1);
    expect(exp.dishes[0].weightGrams).toBe(450);
  });

  it('advice bands hold (35–70 words) and verdict levels are valid', () => {
    for (const [label, adv, det] of [
      ['pack', exp.packDefaultLedger.readyAdvice, exp.packDefaultLedger.verdict],
      ['final', exp.finalAdvice, exp.finalVerdict],
      ['turn3', exp.turn3.advice, exp.turn3.verdict],
    ] as const) {
      expect(words(adv), label).toBeGreaterThanOrEqual(35);
      expect(words(adv), label).toBeLessThanOrEqual(70);
      expect(['good', 'warning', 'alert', 'neutral'], label).toContain(det.level);
      expect(words(det.label), label).toBeGreaterThanOrEqual(3);
      expect(words(det.label), label).toBeLessThanOrEqual(6);
    }
  });

  it('turn-3 ledger reconciles from turn-2 minus sop/minus jajanan plus soto/trimmed', () => {
    const t = exp.totals.nutrients, t3 = exp.turn3.totals;
    const sop = exp.dishes[0].nutrients, jaj = exp.dishes[1].nutrients;
    const [newJaj, soto] = exp.turn3.dishUpdates;
    for (const k of Object.keys(t)) {
      expect(t[k] - sop[k] - jaj[k] + soto.nutrients[k] + newJaj.nutrients[k]).toBeCloseTo(t3[k], 2);
    }
    expect(exp.turn3.expectedTotalsKcal).toBeCloseTo(1351.74, 2);
  });

  it('TARGET STATUS block matches renderedTargetStatus in all turn docs', () => {
    const block = exp.patientContext.renderedTargetStatus.split('\n')[1];
    expect(turn01.split(block).length - 1).toBe(1);
    expect(turn02.split(block).length - 1).toBe(2);
  });

  it('turn-2/3 patch instructions are byte-identical and advice is embedded', () => {
    const fence = (md: string, marker: string) => {
      const i = md.indexOf(marker);
      const f1 = md.indexOf('```', i);
      return md.slice(f1, md.indexOf('```', f1 + 3) + 3);
    };
    expect(fence(turn03, '### Dispatch t3/dietitian')).toBe(fence(turn02, '### Dispatch t2/scout'));
    for (const adv of [exp.packDefaultLedger.readyAdvice, exp.finalAdvice, exp.turn3.advice]) {
      expect(turn01 + turn02 + turn03).toContain(adv);
    }
    expect(exp.turn3.dishUpdates.map((d: any) => d.dishName).sort())
      .toEqual(['Jajanan Trio', 'Soto Santan Sapi']);
  });
});
