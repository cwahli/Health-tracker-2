#!/usr/bin/env node
/**
 * M22 — Meal Build true-completion hard gate.
 * Fails if M21.1-only “markers” exist without real wiring (dead projectors,
 * missing edit mealBuild, no stage lifecycle, no StageLimits, etc.).
 *
 *   node scripts/assert-meal-build-m22.mjs
 * Must also keep M21.1 green:
 *   node scripts/assert-meal-build-m21-1.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root =
  fs.existsSync(path.join(process.cwd(), 'package.json')) &&
  fs.existsSync(path.join(process.cwd(), 'src/mealBuild'))
    ? process.cwd()
    : path.join(__dirname, '..');

let failed = 0;
const failures = [];

function ok(m) {
  console.log(`  PASS  ${m}`);
}
function fail(m) {
  failed++;
  failures.push(m);
  console.error(`  FAIL  ${m}`);
}
function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}
function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
function mustExist(rel) {
  if (!exists(rel)) fail(`missing ${rel}`);
  else ok(`exists ${rel}`);
}

console.log('\n=== M22 Meal Build TRUE COMPLETION gate ===\n');
console.log(`root=${root}\n`);

// 0) M21.1 must still pass
console.log('0) Nested M21.1 gate');
const m211 = path.join(root, 'scripts/assert-meal-build-m21-1.mjs');
if (!fs.existsSync(m211)) {
  fail('assert-meal-build-m21-1.mjs missing — run M21.1 first');
} else {
  const r = spawnSync(process.execPath, [m211], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) {
    fail('assert-meal-build-m21-1.mjs failed — fix M21.1 before M22');
    if (r.stdout) console.log(r.stdout.split('\n').slice(-15).join('\n'));
  } else ok('M21.1 nested gate exit 0');
}

const server = exists('server.ts') ? read('server.ts') : '';
const orch = exists('server_meal_orchestrator.ts') ? read('server_meal_orchestrator.ts') : '';
const adapters = exists('src/mealBuild/adapters.ts') ? read('src/mealBuild/adapters.ts') : '';
const cons = exists('src/mealBuild/consolidate.ts') ? read('src/mealBuild/consolidate.ts') : '';
const types = exists('src/mealBuild/types.ts') ? read('src/mealBuild/types.ts') : '';
const proj = exists('src/mealBuild/projectors.ts') ? read('src/mealBuild/projectors.ts') : '';
const jobs = exists('serverJobs.ts') ? read('serverJobs.ts') : '';
const runner = exists('src/jobs/JobQueueRunner.ts') ? read('src/jobs/JobQueueRunner.ts') : '';
const exec = exists('src/jobs/FoodAgentExecutor.ts') ? read('src/jobs/FoodAgentExecutor.ts') : '';
const card = exists('src/components/TaskPlaceholderCard.tsx') ? read('src/components/TaskPlaceholderCard.tsx') : '';

// --- Files ---
console.log('\n1) M22 required files');
[
  'plan/MEAL_BUILD_DURABLE_STATE.md',
  exists('archive/studio/retired-2026-09/M22_MEAL_BUILD_TRUE_COMPLETE.md')
    ? 'archive/studio/retired-2026-09/M22_MEAL_BUILD_TRUE_COMPLETE.md'
    : 'archive/M22_MEAL_BUILD_TRUE_COMPLETE.md',
  'scripts/assert-meal-build-m22.mjs',
  'src/mealBuild/__tests__/m22_completion.test.ts',
  'src/mealBuild/stageLifecycle.ts',
].forEach(mustExist);

// --- H1 Live projectors (not dead) ---
console.log('\n2) Dietitian projector MUST feed the LLM (not dead assignment)');
if (!server.includes('projectDietitianInput')) {
  fail('server.ts missing projectDietitianInput');
} else ok('projectDietitianInput imported/used name');

// Projection must appear in prompt construction — unique markers required
const liveProjMarkers = [
  '[MealBuild] projector dietitian applied',
  'dietitianProjection.macroTotals',
  'JSON.stringify(dietitianProjection)',
  'dietitianProjection.itemsSummary',
];
const hasLive =
  liveProjMarkers.some((m) => server.includes(m)) ||
  /promptText\s*[\+]=.*dietitianProjection|dietitianProjection[\s\S]{0,200}promptText|systemInstruction[\s\S]{0,300}dietitianProjection/.test(
    server
  );
if (!hasLive) {
  fail(
    'dietitianProjection must be APPLIED to prompt/systemInstruction (add log "[MealBuild] projector dietitian applied" and use macroTotals/itemsSummary)'
  );
} else ok('dietitian projection applied to prompt path');

// Forbid dead-only pattern: assign then never reference again before llm call
// Soft: require applied marker
if (server.includes('const dietitianProjection = projectDietitianInput') && !server.includes('[MealBuild] projector dietitian applied')) {
  fail('dead projector call: has assignment but missing applied marker');
}

// --- H2 All exit paths mealBuild ---
console.log('\n3) mealBuild on edit/modify + Mode D stream');
if (!server.includes('[MealBuild] edit-path') && !server.includes('attachHappyPathMealBuild') /* edit can reuse */) {
  // require explicit edit marker
  if (!server.includes('[MealBuild] edit-path')) {
    fail('modify/edit success must attach mealBuild and log "[MealBuild] edit-path"');
  }
} else if (server.includes('[MealBuild] edit-path')) {
  ok('edit-path mealBuild marker');
} else {
  fail('modify/edit success must log "[MealBuild] edit-path" with mealBuild');
}

// Mode D stream: either write final with comparisonSet or document non-stream only with marker
if (!server.includes('comparisonSet')) {
  fail('comparisonSet must be on evaluation responses');
} else ok('comparisonSet present');

if (
  server.includes("mode === \"evaluation\"") &&
  !/comparisonSet[\s\S]{0,400}final:\s*true|final:\s*true[\s\S]{0,400}comparisonSet|isStream[\s\S]{0,800}comparisonSet/.test(
    server
  )
) {
  // require stream-safe evaluation
  if (!server.includes('[MealBuild] mode=D stream') && !server.includes('[MealBuild] mode=D')) {
    fail('Mode D must support stream final with comparisonSet (log mode=D stream or include in final SSE)');
  } else {
    // mode=D exists; check stream write near evaluation
    const evalIdx = server.indexOf('[MealBuild] mode=D');
    const slice = server.slice(evalIdx, evalIdx + 1200);
    if (slice.includes('isStream') && slice.includes('final') && slice.includes('comparisonSet')) {
      ok('Mode D stream-aware slice');
    } else if (slice.includes('return res.json') && !slice.includes('isStream')) {
      fail('Mode D only res.json — add stream final branch with comparisonSet + log "[MealBuild] mode=D stream"');
    } else ok('Mode D attachment present (review stream manually if needed)');
  }
} else ok('Mode D stream/final includes comparisonSet pattern');

// --- H3 Stage lifecycle module ---
console.log('\n4) Stage lifecycle + StageLimits + history');
const life = exists('src/mealBuild/stageLifecycle.ts') ? read('src/mealBuild/stageLifecycle.ts') : '';
if (!life.includes('checkStageLimits') && !life.includes('StageLimits')) {
  fail('stageLifecycle.ts must implement checkStageLimits / StageLimits');
} else ok('StageLimits in stageLifecycle');
if (!life.includes('recordStageEvent') && !life.includes('beginStage') && !life.includes('endStage')) {
  fail('stageLifecycle must export beginStage/endStage or recordStageEvent');
} else ok('stage lifecycle record helpers');

// Used from server or orchestrator
const lifeUse = server + orch + jobs;
if (!/beginStage\s*\(|endStage\s*\(|recordStageEvent\s*\(|checkStageLimits\s*\(/.test(lifeUse)) {
  fail('stageLifecycle helpers must be called from server/orchestrator/serverJobs');
} else ok('stageLifecycle production call site');

// Unique markers
if (!lifeUse.includes('[MealBuild] stage ') && !lifeUse.includes('[MealBuild] stage-limits')) {
  fail('must log "[MealBuild] stage " or "[MealBuild] stage-limits" on stage transitions/limits');
} else ok('stage lifecycle log markers');

// --- H4 Progressive scout checkpoint → mealBuild with stageKey ---
console.log('\n5) Progressive meal updates (scout + calc)');
if (!runner.includes('mealBuild') || !runner.includes('scout')) {
  fail('JobQueueRunner must update mealBuild on scout checkpoint');
} else ok('client scout→mealBuild');
if (!cons.includes('makeStageKey') && !life.includes('makeStageKey') && !cons.includes('stageKey')) {
  fail('stageKey support required');
} else ok('stageKey support');

// --- H5 OCC expectedVersion path ---
console.log('\n6) OCC expectedVersion on writes');
if (!cons.includes('expectedVersion') && !cons.includes('rebaseUserEdit')) {
  fail('consolidate OCC expectedVersion / rebaseUserEdit required');
} else ok('OCC helpers exist');
// Production use of expectedVersion or rebase
if (!/expectedVersion|rebaseJobMealEdit|rebaseUserEdit/.test(runner + jobs + server + (exists('src/jobs/JobStore.ts') ? read('src/jobs/JobStore.ts') : ''))) {
  fail('OCC rebase/expectedVersion must be used outside pure consolidate only');
} else ok('OCC used on client or server path');

// --- H6 Cold debug + expired URL tolerance ---
console.log('\n7) Cold debug package + expired handling');
const cold =
  (exists('src/utils/debugPayload.ts') ? read('src/utils/debugPayload.ts') : '') +
  (exists('src/mealBuild/coldDebug.ts') ? read('src/mealBuild/coldDebug.ts') : '') +
  orch +
  server;
if (!/buildColdDebugPackage|ColdDebugPackage|coldDebugPackage/.test(cold)) {
  fail('must have buildColdDebugPackage (src/mealBuild/coldDebug.ts or debugPayload)');
} else ok('cold debug builder exists');
if (!card.includes('expired') && !card.includes('coldDebug') && !/debugUrl|coldDebugUrl/.test(card)) {
  // soft: serverJobs or debugPayload
  if (!cold.includes('expired') && !cold.includes('forensic')) {
    fail('UI or debug helper must tolerate expired cold debug (message contains expired/forensic)');
  } else ok('expired/forensic handling in debug layer');
} else ok('UI mentions debug expiry or urls');

// R2 lifecycle documented
const plan = exists('plan/MEAL_BUILD_DURABLE_STATE.md') ? read('plan/MEAL_BUILD_DURABLE_STATE.md') : '';
if (!plan.includes('14') && !plan.includes('30 days') && !plan.includes('lifecycle')) {
  fail('plan must document R2 debug lifecycle');
} else ok('plan R2 lifecycle noted');

// --- H7 Chaos tests file ---
console.log('\n8) Chaos / resilience unit tests');
mustExist('src/mealBuild/__tests__/m22_completion.test.ts');
if (exists('src/mealBuild/__tests__/m22_completion.test.ts')) {
  const t = read('src/mealBuild/__tests__/m22_completion.test.ts');
  for (const needle of [
    'stageKey',
    'zombie',
    'rebase',
    'circuit',
    'empty',
    'partial',
    'projector',
  ]) {
    if (!t.toLowerCase().includes(needle.toLowerCase()) && !t.includes(needle)) {
      // allow some flexibility
      if (['stageKey', 'zombie', 'circuit', 'partial'].includes(needle) && !t.includes(needle)) {
        fail(`m22_completion.test.ts should cover «${needle}»`);
      }
    } else ok(`test mentions ${needle}`);
  }
}

// --- H8 Dual path serverJobs mealBuild on success AND error salvage ---
console.log('\n9) serverJobs dual-path durability');
if (!jobs.includes('mealBuild')) fail('serverJobs mealBuild');
else ok('serverJobs mealBuild');
if (!jobs.includes('degradedStages') && !jobs.includes('mealBuild')) {
  fail('serverJobs should persist degradedStages when present');
} else ok('serverJobs degraded/meal fields');

// --- Forbidden ---
console.log('\n10) Hygiene');
if (/from ['"]@temporal|langgraph|LangGraph/.test(server + orch)) fail('no Temporal/LangGraph');
else ok('no forbidden frameworks');
if (!exists('scripts/assert-meal-build-m22.mjs')) fail('self missing');
else ok('assert-m22 present');

// Weaken detection: assert must still contain fail( for dead projector
const assertBody = read('scripts/assert-meal-build-m22.mjs');
if (!assertBody.includes('projector dietitian applied')) {
  fail('assert-m22 was weakened (lost applied projector check)');
} else ok('assert-m22 still enforces live projector');

console.log('\n=== RESULT ===');
if (failed > 0) {
  console.error(`\nM22 GATE FAILED (${failed} checks)\n`);
  failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}`));
  console.error('\nFix then: node scripts/assert-meal-build-m22.mjs');
  console.error('Do NOT claim COMPLETE until exit 0.\n');
  process.exit(1);
}
console.log('\nM22 STRUCTURAL GATE PASSED.');
console.log('Still required: vitest m22 + m21_1 + mealBuild + food-calc + tsc (pack §F).\n');
process.exit(0);
