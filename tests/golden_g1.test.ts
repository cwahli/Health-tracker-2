/**
 * G1 picnic — first red-until-green golden.
 * Frozen scout from job_1786572302915_mu1hm85cf. No Gemini.
 *
 *   npx vitest run tests/golden_g1.test.ts
 *   node scripts/assert-g1-golden.mjs
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { lookupCanonicalBaseFood } from '../server_food_db.js';
import { buildFoodSearchQuerySet } from '../server_query_set.js';
import { detectWeightRefineIntent } from '../server_refine_scale.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const G1 = path.join(__dirname, 'Golden_meal', '1. Multi-food log');

const expected = JSON.parse(fs.readFileSync(path.join(G1, 'expected.json'), 'utf-8'));
const scout = JSON.parse(fs.readFileSync(path.join(G1, 'scout.json'), 'utf-8'));

function resolve(query: string) {
  return lookupCanonicalBaseFood(query);
}

describe('G1 picnic replay (no live agent)', () => {
  it('has a frozen 4-item scout snapshot', () => {
    expect(scout.items.map((i: any) => i.originalName)).toEqual([
      'Granola',
      'Vegetarian wrap',
      'Chicken Avocado Salad Bowl',
      'Croissants',
    ]);
  });

  it('already-known locks still resolve', () => {
    const misses: string[] = [];
    for (const lock of expected.resolveLocks) {
      const hit = resolve(lock.query);
      if (!hit || String(hit.fdcId) !== String(lock.expectFdcId)) {
        misses.push(`"${lock.query}" -> ${hit?.fdcId ?? 'null'} (want ${lock.expectFdcId})`);
      }
    }
    expect(misses).toEqual([]);
  });

  it('mustResolve queries hit the catalog (RED until Studio fills the dictionary)', () => {
    const misses: string[] = [];
    for (const lock of expected.mustResolve || []) {
      const hit = resolve(lock.query);
      if (!hit || String(hit.fdcId) !== String(lock.expectFdcId)) {
        misses.push(`"${lock.query}" -> ${hit?.fdcId ?? 'null'} (want ${lock.expectFdcId})`);
      }
    }
    expect(
      misses,
      'Add these rows to CANONICAL_BASE_FOODS + lookupCanonicalBaseFood, then re-run this file'
    ).toEqual([]);
  });

  it('never-match: catalog must not return Powerade / popsicle / taro / Co-op pot / wrap-as-falafel', () => {
    const violations: string[] = [];
    for (const rule of expected.neverMatch) {
      const hit = resolve(rule.query);
      if (!hit) continue;
      const id = String(hit.fdcId);
      const name = String((hit as any).name || (hit as any).foodType || '').toLowerCase();
      if ((rule.forbiddenIds || []).some((x: string) => String(x) === id)) {
        violations.push(`${rule.query} id ${id}`);
      }
      if ((rule.forbiddenNames || []).some((n: string) => name.includes(n.toLowerCase()))) {
        violations.push(`${rule.query} name ${name}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('query set uses components, not parent dish titles', () => {
    const queries = buildFoodSearchQuerySet(scout.items);
    expect(queries).toContain('plain yogurt');
    expect(queries).toContain('falafel');
    expect(queries).toContain('grilled chicken breast');
    expect(queries.some((q: string) => /chicken avocado salad/i.test(q))).toBe(false);
  });

  it('croissant second pass is an edit, not a pack refine', () => {
    expect(detectWeightRefineIntent('I ate this croissant').isRefine).toBe(false);
  });
});
