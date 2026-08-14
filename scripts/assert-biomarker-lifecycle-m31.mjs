/**
 * M31 master gate — start with P0 locks (A1–A4, A6).
 * Studio extends this file as P4–P8 land. Do not weaken checks to force pass.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failed = 0;
function ok(cond, id, msg) {
  if (cond) {
    console.log(`PASS ${id}`);
  } else {
    failed += 1;
    console.error(`FAIL ${id}: ${msg}`);
  }
}

const home = read('src/components/HomeTab.tsx');
const dict = read('src/components/BiomarkerDictionaryModal.tsx');
const life = read('src/utils/biomarkerLifecycle.ts');
const lifeTest = read('src/utils/biomarkerLifecycle.test.ts');
const logChat = read('src/components/LogChat.tsx');
const app = read('src/App.tsx');
const server = read('server.ts');

// A1
for (const s of [
  'Auto-Fix Historical Scaling',
  'Inspect Card',
  'Review in Medical History',
  'Edit Logs in Medical History',
]) {
  ok(!home.includes(s), 'A1', `Home still contains "${s}"`);
}

// A2
for (const s of [
  'Auto-Calibrate',
  'Auto-Fill Defaults',
  'Quick Approve',
  'Approve Selected',
  'Save & Approve',
]) {
  ok(!dict.includes(s), 'A2', `Dictionary still contains "${s}"`);
}

// A3
ok(life.includes('export function buildReviewCommandsFromHistory'), 'A3', 'missing buildReviewCommandsFromHistory');
ok(life.includes('export function enrichReviewModificationCommands'), 'A3', 'missing enrichReviewModificationCommands');
ok(logChat.includes('enrichReviewModificationCommands'), 'A3', 'LogChat does not call enrich');
ok(app.includes('enrichReviewModificationCommands'), 'A3', 'App does not call enrich');
ok(server.includes('enrichReviewModificationCommands'), 'A3', 'server.ts does not call enrich');

// A4
ok(dict.includes('isPendingCatalogApproval'), 'A4', 'Dictionary does not use isPendingCatalogApproval');

// A6 — lock convert numbers (do not “improve”)
for (const n of ['1.293', '1.411', '3.362', '79.56', '13.68']) {
  ok(lifeTest.includes(n), 'A6', `lifecycle test missing locked convert ${n}`);
}

if (failed) {
  console.error(`\nM31 assert failed: ${failed} check(s)`);
  process.exit(1);
}
console.log('\nM31 P0 locks passed (A1–A4, A6). Extend this file as P4–P8 land.');
process.exit(0);
