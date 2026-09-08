import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  mergeArmC, runArmCWorkers, runSequential, validateTurnVerdict, writeSeqDebug, tagBlindDishes, adviceWords, MEAL02_GT, KNOWN_GAPS, type ArmCDish,
} from './armC-pipeline';

/**
 * Arm C Meal_02 (auto-split 5+4): winner of the A/B/C probe series.
 * Deterministic path runs on committed fixtures; set ARM_C_LIVE=1 to spend
 * Gemini (~18k tokens, ~15-30s) and re-run both workers live in parallel.
 * Assertions are tolerance-based per golden convention: structure hard,
 * nutrient direction soft, never exact vectors.
 */
const FIX = (n: string) => JSON.parse(fs.readFileSync(path.resolve(`prototype/tests/fixtures/${n}`), 'utf8')) as ArmCDish[];

test.describe('Arm C Meal_02 auto-split (fixtures)', () => {
  test('merge by refId verifies structure and scores in tolerance', async () => {
    const merged = mergeArmC([...FIX('armC_w1.json'), ...FIX('armC_w2r.json')]);

    // Structure: hard gates (no dupes, global indices, full photo coverage)
    expect(merged.dupes, 'double-claimed refIds').toEqual([]);
    expect(merged.badIndices.map((d) => d.refId), 'non-global sourceImageIndex').toEqual([]);
    const covered = new Set(merged.dishes.map((d) => d.sourceImageIndex));
    expect([...covered].sort((a, b) => (a ?? 0) - (b ?? 0)), 'photo coverage 0-8').toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(merged.missing.sort(), 'missing entities beyond known gaps').toEqual([...KNOWN_GAPS].sort());

    // Verdict + advice grain on every dish
    for (const d of merged.dishes) {
      expect(['good', 'neutral', 'warning', 'alert'], `${d.refId} verdict level`).toContain(d.verdictLevel);
      const w = adviceWords(d);
      expect.soft(w >= 35 && w <= 70, `${d.refId} advice ${w}w`).toBe(true);
    }

    // Nutrients: TS-derived kcal direction (measured 80.8% as-run)
    const t = merged.totals;
    expect(t.kcal / MEAL02_GT.kcal, `kcal ${t.kcal.toFixed(0)} vs ${MEAL02_GT.kcal}`).toBeGreaterThanOrEqual(0.8);
    expect.soft(t.sodium / MEAL02_GT.sodium, `sodium ${t.sodium.toFixed(0)}`).toBeGreaterThanOrEqual(0.9);
    expect.soft(t.grams / MEAL02_GT.grams, `grams ${t.grams.toFixed(0)}`).toBeGreaterThanOrEqual(0.9);
  });
});

test.describe('Sequential blind (fixtures, agent verdict + validation net)', () => {
  test('W2-authored turn verdict validates clean', async () => {
    const w1 = JSON.parse(fs.readFileSync(path.resolve('prototype/tests/fixtures/blind_w1.json'), 'utf8'));
    const w2 = JSON.parse(fs.readFileSync(path.resolve('prototype/tests/fixtures/seq_w2.json'), 'utf8'));
    expect(w1.perImage.map((p: any) => p.imageIndex).sort(), 'W1 perImage').toEqual([0, 1, 2, 3, 4]);
    expect(w2.perImage.map((p: any) => p.imageIndex).sort(), 'W2 perImage').toEqual([5, 6, 7, 8]);

    const issues = validateTurnVerdict(
      { label: w2.turnVerdict.label, level: w2.turnVerdict.level, advice: w2.turnAdvice },
      [...w1.dishes, ...w2.dishes],
    );
    expect(issues, 'verdict validation net').toEqual([]);
    console.log(`SEQ verdict: [${w2.turnVerdict.level}] ${w2.turnVerdict.label}`);
  });
});
test.describe('Sequential full journey (SEQ_LIVE=1 → debug file)', () => {
  test('live W1→W2 journey renders the debug file', async () => {
    test.skip(process.env.SEQ_LIVE !== '1', 'Set SEQ_LIVE=1 to spend Gemini on the sequential full journey');
    test.setTimeout(600000);
    const { w1, w2 } = await runSequential();
    console.log(`W1 dishes=${w1.payload.dishes.length} tokens=${w1.tokens.total} ms=${w1.ms}`);
    console.log(`W2 dishes=${w2.payload.dishes.length} tokens=${w2.tokens.total} ms=${w2.ms}`);
    expect(w1.payload.perImage.map((p) => p.imageIndex).sort(), 'W1 perImage').toEqual([0, 1, 2, 3, 4]);
    expect(w2.payload.perImage.map((p) => p.imageIndex).sort(), 'W2 perImage').toEqual([5, 6, 7, 8]);

    const tagged = tagBlindDishes([...w1.payload.dishes, ...w2.payload.dishes]);
    console.log(`tagged refIds: ${tagged.map((d) => d.refId).join(',')}`);
    const merged = mergeArmC(tagged);
    // Structure first: entity floor + every photo yields >=1 dish + no ", " mega-blobs
    const perPhoto = new Map<number, number>();
    for (const d of merged.dishes) perPhoto.set(d.sourceImageIndex ?? -1, (perPhoto.get(d.sourceImageIndex ?? -1) ?? 0) + 1);
    const emptyPhotos = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((i) => !perPhoto.get(i));
    const blobDishes = merged.dishes.filter((d) => (d.estimatedWeightGrams ?? 0) >= 600 || (d.dishName || '').split(/[+,]/).length > 3);
    expect(merged.dishes.length, `entity floor (got ${merged.dishes.length})`).toBeGreaterThanOrEqual(12);
    expect(emptyPhotos, 'photos yielding zero dishes').toEqual([]);
    expect(blobDishes.map((d) => d.dishName), 'mega-blob dishes').toEqual([]);
    const issues = validateTurnVerdict(
      { label: w2.payload.turnVerdict.label, level: w2.payload.turnVerdict.level, advice: w2.payload.turnAdvice },
      merged.dishes,
    );
    console.log(`SEQ verdict: [${w2.payload.turnVerdict.level}] ${w2.payload.turnVerdict.label} | issues: ${issues.join('; ') || 'none'}`);
    const md = writeSeqDebug(w1, w2, merged, issues);
    fs.writeFileSync(path.resolve('prototype/tests/captures/meal02-seq-debug.md'), md);
    console.log(`DEBUG written (${md.length} chars)`);
    expect(issues, 'verdict validation net').toEqual([]);
  });
});
test.describe('Arm C Meal_02 live', () => {
  test('parallel 5+4 workers verify clean when ARM_C_LIVE=1', async () => {
    test.skip(process.env.ARM_C_LIVE !== '1', 'Set ARM_C_LIVE=1 to spend Gemini on the Arm C live run');
    test.setTimeout(600000);
    const { w1, w2 } = await runArmCWorkers();
    console.log(`W1 dishes=${w1.payload.dishes.length} tokens=${w1.tokens.total} ms=${w1.ms}`);
    console.log(`W2 dishes=${w2.payload.dishes.length} tokens=${w2.tokens.total} ms=${w2.ms}`);
    console.log(`TOTAL tokens=${w1.tokens.total + w2.tokens.total}`);

    // perImage must list exactly the worker's global photos (FIX-1/FIX-2)
    expect(w1.payload.perImage.map((p) => p.imageIndex).sort(), 'W1 perImage').toEqual([0, 1, 2, 3, 4]);
    expect(w2.payload.perImage.map((p) => p.imageIndex).sort(), 'W2 perImage').toEqual([5, 6, 7, 8]);

    const merged = mergeArmC([...w1.payload.dishes, ...w2.payload.dishes]);
    expect(merged.dupes, 'double-claimed refIds').toEqual([]);
    expect(merged.badIndices.map((d) => d.refId), 'non-global sourceImageIndex').toEqual([]);
    expect(merged.dishes.length, 'dish count').toBeGreaterThanOrEqual(15);
    expect.soft(merged.totals.kcal / MEAL02_GT.kcal, 'kcal direction').toBeGreaterThanOrEqual(0.75);

    fs.writeFileSync(path.resolve('prototype/tests/captures/armC-live-w1.json'), JSON.stringify(w1.payload.dishes));
    fs.writeFileSync(path.resolve('prototype/tests/captures/armC-live-w2.json'), JSON.stringify(w2.payload.dishes));
  });
});
