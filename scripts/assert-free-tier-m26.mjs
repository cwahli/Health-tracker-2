#!/usr/bin/env node
/**
 * M26 — Thin agent_jobs: no fat mealBuild/scratchpad in JSONB; progress throttle.
 *   node scripts/assert-free-tier-m26.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root =
  fs.existsSync(path.join(process.cwd(), 'package.json')) &&
  fs.existsSync(path.join(process.cwd(), 'src/jobs/SupabaseJobSync.ts'))
    ? process.cwd()
    : path.join(__dirname, '..');

let failed = 0;
const failures = [];
function ok(m) { console.log(`  PASS  ${m}`); }
function fail(m) { failed++; failures.push(m); console.error(`  FAIL  ${m}`); }
function read(rel) {
  const p = path.join(root, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

console.log('\n=== M26 Thin agent_jobs ===\n');
const jobSync = read('src/jobs/SupabaseJobSync.ts');
const serverJobs = read('serverJobs.ts');
const server = read('server.ts');

if (!jobSync.includes('[FreeTier] thin clean_result') && !serverJobs.includes('[FreeTier] thin clean_result')) {
  fail('missing thin clean_result marker in job path');
} else ok('thin clean_result marker');

// upsert must not blindly embed full mealBuild into clean_result without R2 offload path
if (/mealBuild:\s*job\.mealBuild/.test(jobSync) && !jobSync.includes('mealBuildUrl') && !jobSync.includes('is_r2')) {
  // Prefer stripping mealBuild from DB payload
  if (jobSync.includes('finalCleanResult') && jobSync.includes('mealBuild') && !jobSync.includes('[FreeTier] thin clean_result')) {
    fail('SupabaseJobSync still packs mealBuild into clean_result without thin marker');
  }
}

// Progress throttle should be >= 5000ms after M26 (was 1500)
const throttleMatch = serverJobs.match(/progressThrottleMs\s*=\s*(\d+)/);
if (throttleMatch) {
  const ms = parseInt(throttleMatch[1], 10);
  if (ms < 5000) fail(`progressThrottleMs=${ms} too aggressive; require >= 5000`);
  else ok(`progressThrottleMs=${ms} >= 5000`);
} else {
  fail('progressThrottleMs not found in serverJobs.ts');
}

// Prefer strip helper or lightweight clean_result
if (
  !serverJobs.includes('lightweight') &&
  !serverJobs.includes('is_r2') &&
  !jobSync.includes('stripHeavy') &&
  !serverJobs.includes('[FreeTier] thin clean_result')
) {
  fail('no lightweight/R2 clean_result pattern found');
} else ok('lightweight/R2 job result pattern present');

console.log('\n=== Result ===');
if (failed) {
  console.error(`\nFAILED ${failed}:`);
  failures.forEach((f) => console.error(' -', f));
  process.exit(1);
}
console.log('\nAll M26 checks passed.\n');
process.exit(0);
