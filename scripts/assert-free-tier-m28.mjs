#!/usr/bin/env node
/**
 * M28 — Gemini generateContent retry with exponential backoff.
 *   node scripts/assert-free-tier-m28.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root =
  fs.existsSync(path.join(process.cwd(), 'package.json'))
    ? process.cwd()
    : path.join(__dirname, '..');

let failed = 0;
const failures = [];
function ok(m) { console.log(`  PASS  ${m}`); }
function fail(m) { failed++; failures.push(m); console.error(`  FAIL  ${m}`); }
function exists(rel) { return fs.existsSync(path.join(root, rel)); }
function read(rel) {
  const p = path.join(root, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

console.log('\n=== M28 Gemini retry wrapper ===\n');

const helperPaths = [
  'server_gemini_retry.ts',
  'src/utils/geminiRetry.ts',
  'server_llm_retry.ts',
];
const helper = helperPaths.find((p) => exists(p));
if (!helper) {
  fail('missing gemini retry helper module (server_gemini_retry.ts or src/utils/geminiRetry.ts)');
} else ok(`retry helper exists: ${helper}`);

const helperSrc = helper ? read(helper) : '';
if (helperSrc && !/backoff|attempt|retry/i.test(helperSrc)) {
  fail('retry helper lacks backoff/attempt/retry logic');
} else if (helperSrc) ok('retry helper has retry/backoff logic');

const server = read('server.ts');
const jobs = read('serverJobs.ts');
const combined = server + jobs + helperSrc;
if (!combined.includes('[FreeTier] gemini retry') && !combined.includes('withGeminiRetry') && !combined.includes('generateContentWithRetry')) {
  fail('no production marker/call for gemini retry wrapper');
} else ok('gemini retry used or marked in production path');

// At least one call site import
if (helper && !server.includes(path.basename(helper).replace(/\.ts$/, '')) && !server.includes('withGeminiRetry') && !server.includes('generateContentWithRetry') && !jobs.includes('withGeminiRetry')) {
  // soft fail if import path differs
  if (!/geminiRetry|gemini_retry|llm_retry|withGeminiRetry/.test(server + jobs)) {
    fail('server/serverJobs do not import/use retry helper');
  } else ok('retry helper referenced from server paths');
} else ok('retry wiring present');

console.log('\n=== Result ===');
if (failed) {
  console.error(`\nFAILED ${failed}:`);
  failures.forEach((f) => console.error(' -', f));
  process.exit(1);
}
console.log('\nAll M28 checks passed.\n');
process.exit(0);
