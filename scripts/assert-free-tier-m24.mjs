#!/usr/bin/env node
/**
 * M24 — Profile single-writer (Supabase only; no Firestore profile dual-write storm).
 *   node scripts/assert-free-tier-m24.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root =
  fs.existsSync(path.join(process.cwd(), 'package.json')) &&
  fs.existsSync(path.join(process.cwd(), 'src/App.tsx'))
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

console.log('\n=== M24 Profile single-writer ===\n');
const app = read('src/App.tsx');
const sync = read('src/utils/syncUtils.ts');

if (!app.includes('[FreeTier] profile firestore write disabled') && !app.includes('[FreeTier] profile single-writer')) {
  fail('App.tsx missing profile single-writer marker');
} else ok('profile single-writer marker');

// Hot path: setDoc(doc(db, 'users', uid), sanitizeForFirestore(profileForCloud) must not remain as primary cloud path
const dualProfile =
  /setDoc\s*\(\s*doc\s*\(\s*db\s*,\s*['"]users['"]\s*,\s*uid\s*\)\s*,\s*sanitizeForFirestore\s*\(\s*profileForCloud/.test(app) ||
  /setDoc\s*\(\s*doc\s*\(\s*db\s*,\s*['"]users['"]\s*,\s*uid\s*\)\s*,\s*sanitizeForFirestore\s*\(\s*localProfileForCloud/.test(app);
if (dualProfile) {
  fail('App.tsx still setDocs full profileForCloud to Firestore users/{uid}');
} else ok('no full profileForCloud setDoc to Firestore');

// Dashboard / reports / foodImages high-churn paths should be gated or removed
if (/setDoc\s*\(\s*doc\s*\(\s*db\s*,\s*['"]users['"]\s*,\s*uid\s*,\s*['"]foodImages['"]/.test(app) &&
    !app.includes('[FreeTier] foodImages firestore write disabled')) {
  fail('App.tsx still writes foodImages to Firestore without kill marker');
} else ok('foodImages Firestore write disabled or absent');

if (!sync.includes('upsertProfileToSupabase')) {
  fail('upsertProfileToSupabase missing from syncUtils');
} else ok('Supabase profile upsert helper present');

// Must still call upsertProfileToSupabase from App for profile persistence
if (!app.includes('upsertProfileToSupabase')) {
  fail('App.tsx must still upsert profiles to Supabase');
} else ok('App still uses upsertProfileToSupabase');

console.log('\n=== Result ===');
if (failed) {
  console.error(`\nFAILED ${failed}:`);
  failures.forEach((f) => console.error(' -', f));
  process.exit(1);
}
console.log('\nAll M24 checks passed.\n');
process.exit(0);
