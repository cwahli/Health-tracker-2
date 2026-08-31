#!/usr/bin/env node
/**
 * F-9 PR1 gate. Exit 0 only when the session contract helper + test + card wire exist.
 * Grok-owned docs/assert-dev-serves-vite are already in tree; this gate is Gemini's.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
let failed = 0;
function ok(cond, id, msg) {
  if (cond) console.log(`PASS ${id}`);
  else {
    failed += 1;
    console.error(`FAIL ${id}: ${msg}`);
  }
}

const previewPath = path.join(root, 'src/jobs/jobPreview.ts');
ok(fs.existsSync(previewPath), 'preview_file', 'missing src/jobs/jobPreview.ts');
if (fs.existsSync(previewPath)) {
  const preview = read('src/jobs/jobPreview.ts');
  for (const fn of ['isTurnInFlight', 'previewStatus', 'previewStatusLabel', 'isEditJob']) {
    ok(preview.includes(`export function ${fn}`), `export_${fn}`, `jobPreview.ts must export ${fn}`);
  }
}

const testPath = path.join(root, 'src/jobs/__tests__/JobSession.contract.test.ts');
ok(fs.existsSync(testPath), 'contract_file', 'missing src/jobs/__tests__/JobSession.contract.test.ts');
if (fs.existsSync(testPath)) {
  const test = read('src/jobs/__tests__/JobSession.contract.test.ts');
  ok(/Updating meal/.test(test), 'label_updating', 'contract test must assert Updating meal');
  ok(/Analysis completed/.test(test), 'label_done', 'contract test must assert Analysis completed');
  ok(/Unsweetened/.test(test), 'unsweetened', 'contract test must use the unsweetened-tea fixture');
  ok(/previewStatusLabel/.test(test), 'uses_helper', 'contract test must call previewStatusLabel');
}

const card = read('src/components/TaskPlaceholderCard.tsx');
ok(/from '\.\.\/jobs\/jobPreview'/.test(card), 'card_import', 'TaskPlaceholderCard must import ../jobs/jobPreview');
ok(/previewStatusLabel/.test(card) && /previewStatus\(/.test(card), 'card_calls', 'TaskPlaceholderCard must call previewStatus + previewStatusLabel');

ok(fs.existsSync(path.join(root, 'src/jobs/mergeFoodEditMessages.ts')), 'merge_kept', 'do not delete mergeFoodEditMessages.ts');
ok(!/inFlightTurnAt2/.test(card), 'no_sibling_flag', 'do not invent inFlightTurnAt2');

const foodCalcHot = ['server_meal_edit.ts', 'agents/dietitianInstructions.ts', 'server_food_analyze_run.ts'];
// Presence is fine; this pack must not *require* editing them. Warn-only via comments in pack.

process.exit(failed ? 1 : 0);
