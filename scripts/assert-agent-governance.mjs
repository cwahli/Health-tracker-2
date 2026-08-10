#!/usr/bin/env node
/**
 * Gate for agent governance + domain regression foundation (M20).
 * Ensures process docs + regression tests exist and key contracts are present.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let pass = true;
const fail = (m) => {
  console.error('❌', m);
  pass = false;
};
const ok = (m) => console.log('✅', m);

const mustExist = [
  'AGENTS.md',
  'AI_HANDOVER.md',
  'docs/agent/README.md',
  'docs/agent/PACKS.md',
  'docs/agent/TEMPLATES.md',
  'docs/agent/DOMAIN_REGRESSION_MAP.md',
  'docs/agent/domains/food-calc.md',
  'docs/agent/domains/biomarkers.md',
  'docs/agent/domains/sync.md',
  'src/utils/syncUtils.regression.test.ts',
  'src/utils/biomarkerIdentity.test.ts',
  'server_portion_clarify.test.ts',
];

for (const f of mustExist) {
  if (!fs.existsSync(path.join(root, f))) fail(`missing file: ${f}`);
  else ok(`exists: ${f}`);
}

const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// AGENTS.md contracts
const agents = read('AGENTS.md');
if (!/AI Studio only|commits only via AI Studio|Commit.*AI Studio/i.test(agents) && !/GitHub: commits only via AI Studio/i.test(agents)) {
  fail('AGENTS.md must state commits/pushes are AI Studio only');
} else ok('AGENTS.md: commit via AI Studio');

if (!/Protected|before.?after|confirmation/i.test(agents)) {
  fail('AGENTS.md must protect process docs with confirmation + before/after');
} else ok('AGENTS.md: protected docs policy');

if (!/AI_HANDOVER\.md/.test(agents) || !/plan\//.test(agents)) {
  fail('AGENTS.md must distinguish AI_HANDOVER vs plan/');
} else ok('AGENTS.md: document roles');

if (!/evolution|fossilize|not a freeze|Evolution allowed/i.test(agents)) {
  fail('AGENTS.md must allow rulebook evolution (not rigid freeze)');
} else ok('AGENTS.md: evolution-friendly L9');

// Rulebooks not pure freeze language only
const food = read('docs/agent/domains/food-calc.md');
if (!/Evolution|deliberately|default/i.test(food)) {
  fail('food-calc rulebook should allow deliberate evolution');
} else ok('food-calc: evolution-aware');

// Code contracts for regression foundation
const sync = read('src/utils/syncUtils.ts');
if (!/export function mergeDeleteMaps/.test(sync)) fail('syncUtils must export mergeDeleteMaps');
else ok('mergeDeleteMaps exported');
if (!/export function filterLogsByTombstone/.test(sync)) fail('syncUtils must export filterLogsByTombstone');
else ok('filterLogsByTombstone exported');

const scout = read('server_vision_scout.ts');
if (!/estimatedCalories:\s*vItem\.estimatedCalories\s*\?\?\s*lItem\.estimatedCalories/.test(scout)) {
  fail('mergeScoutItems must preserve vision estimatedCalories');
} else ok('mergeScoutItems estimatedCalories preserve');
if (!/components:/.test(scout) || !/vItem\.components/.test(scout)) {
  fail('mergeScoutItems must preserve vision components');
} else ok('mergeScoutItems components preserve');

const bio = read('src/utils/biomarkers.ts');
if (!/return clean \|\| rawKey/.test(bio)) {
  fail('getMappedBiomarkerKey should canonicalize unknown keys to clean slug');
} else ok('getMappedBiomarkerKey clean slug fallback');

// Handover points at M20 or governance
const hand = read('AI_HANDOVER.md');
if (!/M20_AGENT_GOVERNANCE|docs\/agent|AI Studio only/i.test(hand)) {
  fail('AI_HANDOVER should reference governance / Studio ship path');
} else ok('AI_HANDOVER governance pointers');

if (!pass) {
  console.error('=== GATE FAILED ===');
  process.exit(1);
}
console.log('=== ALL ASSERTIONS PASSED (exit 0) ===');
process.exit(0);
