#!/usr/bin/env node
/** F-10 PR1 gate. Named files only. Do not run npm test. */
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

const helper = path.join(root, 'src/mealBuild/shouldExpandMealAgent.ts');
ok(fs.existsSync(helper), 'helper_file', 'missing src/mealBuild/shouldExpandMealAgent.ts');
if (fs.existsSync(helper)) {
  const src = read('src/mealBuild/shouldExpandMealAgent.ts');
  ok(/export function shouldExpandMealAgent/.test(src), 'export_fn', 'must export shouldExpandMealAgent');
  ok(/hasReceipt/.test(src) && /hasBarcode/.test(src), 'inputs', 'must key off receipt/barcode + counts');
  ok(!/status ===/.test(src), 'no_model_status', 'helper must not branch on a model status string');
}

const test = path.join(root, 'src/mealBuild/__tests__/shouldExpandMealAgent.test.ts');
ok(fs.existsSync(test), 'test_file', 'missing shouldExpandMealAgent.test.ts');

ok(!fs.existsSync(path.join(root, 'fix_f10.mjs')), 'no_oneshot', 'do not leave one-shot patch_*.mjs / fix_*.mjs');

process.exit(failed ? 1 : 0);
