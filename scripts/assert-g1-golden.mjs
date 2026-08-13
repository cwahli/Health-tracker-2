#!/usr/bin/env node
/**
 * Master gate for studio/M31_G1_GOLDEN_LOOP.md
 * Exit 0 only when G1 replay is green.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const g1 = path.join(root, 'tests', 'Golden_meal', '1. Multi-food log');

function mustExist(p, label) {
  if (!fs.existsSync(p)) {
    console.error(`G1 gate FAIL: missing ${label}: ${p}`);
    process.exit(1);
  }
}

mustExist(path.join(g1, 'expected.json'), 'expected.json');
mustExist(path.join(g1, 'scout.json'), 'scout.json');
mustExist(path.join(root, 'tests', 'golden_g1.test.ts'), 'golden_g1.test.ts');

const expected = JSON.parse(fs.readFileSync(path.join(g1, 'expected.json'), 'utf8'));
if (!Array.isArray(expected.mustResolve) || expected.mustResolve.length < 8) {
  console.error('G1 gate FAIL: expected.json mustResolve is missing (need yogurt/raisins/almonds/croissant/falafel/hummus/feta/…)');
  process.exit(1);
}

const run = spawnSync('npx', ['vitest', 'run', 'tests/golden_g1.test.ts'], {
  cwd: root,
  encoding: 'utf8',
  stdio: 'inherit',
});

if (run.status !== 0) {
  console.error('G1 gate FAIL: golden_g1.test.ts is red. Fill CANONICAL_BASE_FOODS + lookupCanonicalBaseFood and re-run.');
  process.exit(1);
}

console.log('G1 gate PASS: picnic replay is green.');
process.exit(0);
