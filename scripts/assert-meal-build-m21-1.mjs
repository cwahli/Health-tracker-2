#!/usr/bin/env node
/**
 * M21.1 — Hard gate for Meal Build completion gaps.
 * Fails current origin if happy-path mealBuild, Mode D groups adapter,
 * projector call sites, history/debug field alignment are missing.
 *
 * Run: node scripts/assert-meal-build-m21-1.mjs
 * Exit 0 only when ALL checks pass. Do not weaken checks to force green.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Prefer cwd when run from repo root (AI Studio / local); else script parent.
const root = fs.existsSync(path.join(process.cwd(), 'package.json')) &&
  fs.existsSync(path.join(process.cwd(), 'src/mealBuild'))
  ? process.cwd()
  : path.join(__dirname, '..');

let failed = 0;
const failures = [];

function ok(msg) {
  console.log(`  PASS  ${msg}`);
}
function fail(msg) {
  failed++;
  failures.push(msg);
  console.error(`  FAIL  ${msg}`);
}
function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}
function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
function mustExist(rel) {
  if (!exists(rel)) fail(`missing file: ${rel}`);
  else ok(`exists ${rel}`);
}
function mustInclude(rel, needles, label) {
  if (!exists(rel)) {
    fail(`${label || rel}: file missing`);
    return;
  }
  const c = read(rel);
  const arr = Array.isArray(needles) ? needles : [needles];
  for (const n of arr) {
    if (typeof n === 'string') {
      if (!c.includes(n)) fail(`${rel}: missing string «${n}» (${label || ''})`);
      else ok(`${rel}: has «${n.slice(0, 60)}${n.length > 60 ? '…' : ''}»`);
    } else if (n instanceof RegExp) {
      if (!n.test(c)) fail(`${rel}: missing regex ${n} (${label || ''})`);
      else ok(`${rel}: matches ${n}`);
    }
  }
}
function mustNotInclude(rel, needles, label) {
  if (!exists(rel)) return;
  const c = read(rel);
  for (const n of needles) {
    if (c.includes(n)) fail(`${rel}: forbidden «${n}» (${label || ''})`);
  }
}

console.log('\n=== M21.1 Meal Build completion gate ===\n');

// --- Files ---
console.log('1) Required files');
[
  'plan/MEAL_BUILD_DURABLE_STATE.md',
  'src/mealBuild/types.ts',
  'src/mealBuild/consolidate.ts',
  'src/mealBuild/adapters.ts',
  'src/mealBuild/projectors.ts',
  'src/mealBuild/fieldInventory.ts',
  'server_meal_orchestrator.ts',
  'scripts/assert-meal-build-m21-1.mjs',
  'src/mealBuild/__tests__/m21_1_completion.test.ts',
].forEach(mustExist);

// --- A. Happy-path mealBuild (not only catch) ---
console.log('\n2) Happy-path mealBuild on food success (not only dietitian catch)');
const server = exists('server.ts') ? read('server.ts') : '';
const orch = exists('server_meal_orchestrator.ts') ? read('server_meal_orchestrator.ts') : '';

// Unique markers Studio must add on success path
const happyMarkers = [
  '[MealBuild] happy-path',
  'attachHappyPathMealBuild',
];
let happyOnServer = happyMarkers.some((m) => server.includes(m));
let happyInOrch = orch.includes('attachHappyPathMealBuild') || orch.includes('buildHappyPathMealBuild');
if (!happyOnServer) {
  fail('server.ts must call happy-path MealBuild attach (add log "[MealBuild] happy-path" + attachHappyPathMealBuild near new_log success)');
} else {
  ok('server.ts has happy-path MealBuild marker');
}
if (!happyInOrch && !server.includes('function attachHappyPathMealBuild')) {
  // allow function in server or orchestrator
  fail('attachHappyPathMealBuild (or buildHappyPathMealBuild) must exist in server_meal_orchestrator.ts');
} else {
  ok('happy-path builder exists');
}

// Degrade path must remain
if (!server.includes('markDietitianDegraded') || !server.includes('[Dietitian Degrade]')) {
  fail('server.ts must keep dietitian degrade salvage path');
} else {
  ok('dietitian degrade path still present');
}

// mealBuild must appear more than once in server (degrade + happy) — soft heuristic
const mealBuildHits = (server.match(/mealBuild/g) || []).length;
if (mealBuildHits < 4) {
  fail(`server.ts mealBuild references too few (${mealBuildHits}); expect happy-path + degrade + payloads`);
} else {
  ok(`server.ts mealBuild hits=${mealBuildHits}`);
}

// --- B. Mode D groups (live API) ---
console.log('\n3) Mode D comparison.groups → ComparisonSet');
const adapters = exists('src/mealBuild/adapters.ts') ? read('src/mealBuild/adapters.ts') : '';
if (!/comparison\.groups|groups\s*\|\||Array\.isArray\(\s*comparison\.groups/.test(adapters) && !adapters.includes("comparison.groups")) {
  // require explicit groups handling
  if (!adapters.includes('groups')) {
    fail('adapters.ts fromEvaluationComparison must accept comparison.groups (live server Mode D shape)');
  } else {
    ok('adapters mentions groups');
  }
} else {
  ok('adapters handles groups');
}
// Must not ONLY support options
if (adapters.includes('comparison.options') && !adapters.includes('groups')) {
  fail('adapters only options without groups — live server uses groups');
}
mustInclude('src/mealBuild/__tests__/m21_1_completion.test.ts', [
  'groups',
  'fromEvaluationComparison',
  'optionMeals',
], 'Mode D groups test');

// UI must read groups OR options
const card = exists('src/components/TaskPlaceholderCard.tsx') ? read('src/components/TaskPlaceholderCard.tsx') : '';
if (!/comparison\?\.groups|comparison\.groups/.test(card) && !card.includes('comparisonSet')) {
  // still require groups fallback
  if (!card.includes('groups')) {
    fail('TaskPlaceholderCard must render Mode D comparison.groups (or comparisonSet.optionMeals from groups adapter)');
  } else ok('TaskPlaceholderCard mentions groups');
} else {
  ok('TaskPlaceholderCard Mode D groups/comparisonSet aware');
}

// evaluation return should attach comparisonSet marker
if (!server.includes('[MealBuild] mode=D') && !server.includes('comparisonSet')) {
  fail('server.ts evaluation path must attach comparisonSet / log "[MealBuild] mode=D"');
} else {
  ok('server Mode D meal-build attachment marker');
}

// --- C. Projectors wired (call sites) ---
console.log('\n4) Stage projectors have production call sites');
const proj = exists('src/mealBuild/projectors.ts') ? read('src/mealBuild/projectors.ts') : '';
if (!proj.includes('projectDietitianInput')) fail('projectors.ts missing projectDietitianInput');
else ok('projectDietitianInput defined');

// Must be imported AND invoked outside test files
const serverPlusJobs =
  server +
  (exists('serverJobs.ts') ? read('serverJobs.ts') : '') +
  (exists('src/jobs/FoodAgentExecutor.ts') ? read('src/jobs/FoodAgentExecutor.ts') : '') +
  orch;

if (!/projectDietitianInput\s*\(/.test(serverPlusJobs)) {
  fail('projectDietitianInput( must be called from server/orchestrator/jobs (not only unit tests)');
} else {
  ok('projectDietitianInput( call site found');
}
if (!serverPlusJobs.includes('[MealBuild] projector dietitian') && !serverPlusJobs.includes('projectDietitianInput(')) {
  // already covered
} else if (serverPlusJobs.includes('[MealBuild] projector dietitian')) {
  ok('projector dietitian log marker');
}

// --- D. History + debug field alignment ---
console.log('\n5) historyLog + debugPayload field alignment');
const types = exists('src/mealBuild/types.ts') ? read('src/mealBuild/types.ts') : '';
const debug = exists('src/utils/debugPayload.ts') ? read('src/utils/debugPayload.ts') : '';
const cons = exists('src/mealBuild/consolidate.ts') ? read('src/mealBuild/consolidate.ts') : '';

// debug report must tolerate type/timestamp OR code unified on kind/at
const debugHandlesBoth =
  (debug.includes('entry.kind') || debug.includes('entry.type')) &&
  (debug.includes('entry.at') || debug.includes('entry.timestamp'));
const debugUnified =
  debug.includes('entry.kind || entry.type') ||
  debug.includes('entry.type || entry.kind') ||
  debug.includes('entry.at || entry.timestamp') ||
  debug.includes('entry.timestamp || entry.at');

if (!debugHandlesBoth) {
  fail('debugPayload history rendering missing kind/type and at/timestamp');
} else if (!debugUnified && debug.includes('entry.kind') && !debug.includes('entry.type')) {
  fail('debugPayload only reads entry.kind/at but consolidate uses type/timestamp — unify or dual-read');
} else {
  ok('debugPayload history field handling');
}

if (!cons.includes('appendHistory')) fail('consolidate must export appendHistory');
else ok('appendHistory present');

// degrade path should append history
if (!orch.includes('appendHistory') && !server.includes('appendHistory')) {
  fail('markDietitianDegraded or degrade path must appendHistory for errors');
} else {
  ok('appendHistory used outside pure tests');
}

// --- E. Dual path / job result ---
console.log('\n6) Client dual path mealBuild on done');
const runner = exists('src/jobs/JobQueueRunner.ts') ? read('src/jobs/JobQueueRunner.ts') : '';
const executor = exists('src/jobs/FoodAgentExecutor.ts') ? read('src/jobs/FoodAgentExecutor.ts') : '';
if (!runner.includes('mealBuild') && !executor.includes('mealBuild')) {
  fail('JobQueueRunner or FoodAgentExecutor must persist mealBuild from server result');
} else {
  ok('client path knows mealBuild');
}
// on done event must merge mealBuild from result
if (!/mealBuild.*event|event\.data\.mealBuild|result\.mealBuild|finalResData\.mealBuild/.test(runner + executor + (exists('src/App.tsx') ? read('src/App.tsx') : ''))) {
  // App.tsx had mealBuild on finalResData in audit
  if (!(exists('src/App.tsx') && read('src/App.tsx').includes('mealBuild'))) {
    fail('done/success path must copy result.mealBuild onto job');
  } else ok('App or runner copies mealBuild');
} else {
  ok('done path copies mealBuild');
}

// serverJobs clean_result mealBuild
const jobs = exists('serverJobs.ts') ? read('serverJobs.ts') : '';
if (!jobs.includes('mealBuild')) fail('serverJobs must persist mealBuild in clean_result');
else ok('serverJobs mealBuild');

// --- F. Stale narrative UI ---
console.log('\n7) staleDietitianNarrative user-visible');
const uiBlob =
  (exists('src/components/TaskPlaceholderCard.tsx') ? read('src/components/TaskPlaceholderCard.tsx') : '') +
  (exists('src/App.tsx') ? read('src/App.tsx') : '');
if (!uiBlob.includes('staleDietitianNarrative')) {
  fail('UI must surface staleDietitianNarrative (badge or dim advice + refresh)');
} else {
  ok('staleDietitianNarrative in UI');
}

// --- G. Anti-framework / no weaken ---
console.log('\n8) Hygiene');
if (server.includes('from "temporal"') || server.includes('langgraph')) {
  fail('must not add Temporal/LangGraph product dependency');
} else ok('no Temporal/LangGraph');

// m21-1 test file must include zombie + groups + happy attach unit
mustInclude('src/mealBuild/__tests__/m21_1_completion.test.ts', [
  'zombie',
  'groups',
  'happy',
], 'completion tests');

// --- Summary ---
console.log('\n=== RESULT ===');
if (failed > 0) {
  console.error(`\nM21.1 GATE FAILED (${failed} checks)\n`);
  failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}`));
  console.error('\nFix failures then re-run: node scripts/assert-meal-build-m21-1.mjs');
  console.error('Do NOT claim COMPLETE until exit 0.\n');
  process.exit(1);
}
console.log('\nM21.1 GATE PASSED — all structural checks green.');
console.log('Still required: vitest m21_1_completion + food-calc suite + tsc (see pack §F).\n');
process.exit(0);
