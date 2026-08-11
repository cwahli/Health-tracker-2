#!/usr/bin/env node
/**
 * M23 — Free-tier Firestore write kill-switch hard gate.
 *   node scripts/assert-free-tier-m23.mjs
 *
 * Before M23 implementation this script is expected to FAIL.
 * After R1–R5 it must exit 0.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root =
  fs.existsSync(path.join(process.cwd(), 'package.json')) &&
  fs.existsSync(path.join(process.cwd(), 'src/components/LogChat.tsx'))
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
function read(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

console.log('\n=== M23 Free-tier Firestore write kill-switch ===\n');
console.log(`root=${root}\n`);

const logChat = read('src/components/LogChat.tsx');
const tracker = read('src/components/ApiCallTrackerModal.tsx');
const syncUtils = read('src/utils/syncUtils.ts');
const plan = read('plan/RELIABILITY_FREE_TIER_PLAN.md');
const pack =
  read('studio/M23_FIRESTORE_WRITE_KILL_SWITCH.md') ||
  read('archive/studio/completed-2026-08/M23_FIRESTORE_WRITE_KILL_SWITCH.md');

// 1) Docs present
console.log('1) Pack + plan present');
if (!plan.includes('M23')) fail('plan/RELIABILITY_FREE_TIER_PLAN.md missing M23 program');
else ok('reliability plan mentions M23');
if (!pack.includes('chat cloud write disabled')) fail('M23 pack missing or incomplete');
else ok('M23 pack present');

// 2) Chat kill-switch
console.log('\n2) Chat Firestore auto-write disabled');
if (!logChat.includes('[FreeTier] chat cloud write disabled')) {
  fail('LogChat missing marker [FreeTier] chat cloud write disabled');
} else ok('chat kill-switch marker');

if (/sanitizeForFirestore\(\s*prunedObject\s*\)/.test(logChat) && /await\s+setDoc\s*\(/.test(logChat)) {
  fail('LogChat still setDocs pruned conversation object to Firestore — remove cloud save path');
} else ok('no prunedObject conversation setDoc');

if (/setDoc\s*\(\s*docRef\s*,/.test(logChat) && logChat.includes('conversations')) {
  // docRef used for conversation write
  const cloudDisabledEarly =
    logChat.includes('[FreeTier] chat cloud write disabled') &&
    !/await\s+setDoc\s*\(\s*docRef/.test(logChat);
  if (!cloudDisabledEarly && /await\s+setDoc\s*\(\s*docRef/.test(logChat)) {
    fail('LogChat still has await setDoc(docRef) for conversations');
  } else if (/await\s+setDoc\s*\(\s*docRef/.test(logChat)) {
    fail('LogChat still has await setDoc(docRef)');
  } else ok('no await setDoc(docRef)');
} else if (/await\s+setDoc\s*\(/.test(logChat) && /'conversations'|"conversations"/.test(logChat)) {
  fail('LogChat still setDocs into conversations');
} else ok('conversation setDoc path clear');

if (
  /trackApiCall\(\s*['"]firebase_write['"]\s*,\s*`Firestore Write - Save Chat Session/.test(logChat) ||
  /trackApiCall\(\s*['"]firebase_write['"]\s*,\s*'Firestore Write - Save Chat Session/.test(logChat)
) {
  fail('LogChat still tracks firebase_write Save Chat Session — remove with cloud write');
} else ok('no Save Chat Session firebase_write tracker');

// 3) Telemetry
console.log('\n3) Telemetry Firestore batch disabled');
if (!tracker.includes('[FreeTier] telemetry cloud write disabled')) {
  fail('ApiCallTrackerModal missing telemetry kill-switch marker');
} else ok('telemetry kill-switch marker');
if (/writeBatch\s*\(\s*db\s*\)/.test(tracker) && /api_events/.test(tracker)) {
  fail('ApiCallTrackerModal still writeBatch to api_events');
} else ok('no api_events writeBatch');
if (/Firestore Write - Sync API Call Telemetry Batch/.test(tracker) && /writeBatch\s*\(/.test(tracker)) {
  fail('telemetry still claims Firestore batch sync with writeBatch present');
} else ok('telemetry cloud batch path cleared');

// 4) Food/biomarker Supabase-only remains
console.log('\n4) Food/biomarker Supabase-only');
if (!syncUtils.includes('Firebase backup writes for food/biomarker logs removed')) {
  fail('syncUtils missing Supabase-only food/biomarker comment — do not reintroduce Firestore backup');
} else ok('food/biomarker Supabase-only comment present');
const syncFn =
  syncUtils.split('export const syncLogsWithTimeBuckets')[1]?.split('export const fetchAllConsolidatedLogs')[0] ||
  '';
if (/setDoc\s*\(/.test(syncFn) || /writeBatch\s*\(/.test(syncFn)) {
  fail('syncLogsWithTimeBuckets appears to write Firestore again');
} else ok('syncLogsWithTimeBuckets has no setDoc/writeBatch');

// 5) IDB still used for chat
console.log('\n5) Local chat persist kept');
if (!/safeIdbSet\s*\(/.test(logChat) && !/idbSet\s*\(/.test(logChat)) {
  fail('LogChat must still persist chat to IndexedDB');
} else ok('IndexedDB chat persist present');

console.log('\n=== Result ===');
if (failed) {
  console.error(`\nFAILED ${failed} check(s):`);
  failures.forEach((f) => console.error(' -', f));
  process.exit(1);
}
console.log('\nAll M23 checks passed.\n');
process.exit(0);
