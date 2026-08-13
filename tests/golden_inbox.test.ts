import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { lookupCanonicalBaseFood } from '../server_food_db.js';
import { buildFoodSearchQuerySet } from '../server_query_set.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INBOX = path.join(__dirname, 'Golden_meal', 'inbox');

type InboxCase = {
  id: string;
  status: string;
  queries?: string[];
  expectResolve?: Array<{ query: string; expectFdcId: string; foodName?: string | null }>;
  neverMatch?: Array<{ query: string; forbiddenIds?: string[]; forbiddenNames?: string[] }>;
};

function listInboxCases(): Array<{ dir: string; spec: InboxCase; scout: any | null }> {
  if (!fs.existsSync(INBOX)) return [];
  return fs
    .readdirSync(INBOX, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => {
      const dir = path.join(INBOX, d.name);
      const specPath = path.join(dir, 'case.json');
      if (!fs.existsSync(specPath)) return null;
      const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
      const scoutPath = path.join(dir, 'scout.json');
      const scout = fs.existsSync(scoutPath) ? JSON.parse(fs.readFileSync(scoutPath, 'utf-8')) : null;
      return { dir, spec, scout };
    })
    .filter(Boolean) as Array<{ dir: string; spec: InboxCase; scout: any | null }>;
}

function isForbidden(rule: NonNullable<InboxCase['neverMatch']>[number], hit: { fdcId?: string; name?: string } | null) {
  if (!hit) return false;
  const id = String(hit.fdcId || '');
  const name = String(hit.name || '').toLowerCase();
  if ((rule.forbiddenIds || []).some((x) => String(x) === id)) return true;
  return (rule.forbiddenNames || []).some((n) => name.includes(n.toLowerCase()));
}

const cases = listInboxCases();

describe('Golden inbox — failing meals replayed until green', () => {
  it('inbox folder is optional; empty inbox is a pass', () => {
    expect(Array.isArray(cases)).toBe(true);
  });

  if (cases.length === 0) {
    it('no open inbox cases', () => {
      expect(cases).toHaveLength(0);
    });
    return;
  }

  for (const { spec, scout } of cases) {
    describe(`${spec.id} (${spec.status})`, () => {
      it('has a frozen scout snapshot to replay (no live agent)', () => {
        expect(scout, 'run golden-from-debug on a debug export that includes scout JSON').toBeTruthy();
        expect(Array.isArray(scout.items)).toBe(true);
        expect(scout.items.length).toBeGreaterThan(0);
      });

      it('component queries do not resolve to the observed forbidden USDA/brand rows', () => {
        const violations: string[] = [];
        for (const rule of spec.neverMatch || []) {
          const hit = lookupCanonicalBaseFood(rule.query);
          if (isForbidden(rule, hit)) {
            violations.push(`${rule.query} -> ${hit?.fdcId}`);
          }
        }
        expect(violations).toEqual([]);
      });

      it('curator/user expected FDC ids resolve from the catalog (this stays red until you add the row)', () => {
        const misses: string[] = [];
        for (const exp of spec.expectResolve || []) {
          const hit = lookupCanonicalBaseFood(exp.query);
          if (!hit || String(hit.fdcId) !== String(exp.expectFdcId)) {
            misses.push(`"${exp.query}" -> ${hit?.fdcId ?? 'null'} (want ${exp.expectFdcId}${exp.foodName ? ` ${exp.foodName}` : ''})`);
          }
        }
        expect(misses, 'Add these to CANONICAL_BASE_FOODS or aliases, then re-run npm run golden:inbox').toEqual([]);
      });

      it('query set still extracts components from the frozen scout', () => {
        if (!scout) return;
        const queries = buildFoodSearchQuerySet(scout.items);
        expect(queries.length).toBeGreaterThan(0);
      });
    });
  }
});
