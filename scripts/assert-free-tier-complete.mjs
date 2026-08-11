#!/usr/bin/env node
/**
 * Master gate — Free-tier reliability program COMPLETE.
 * Runs M23→M28 nested asserts. Exit 0 only if ALL pass.
 *
 *   node scripts/assert-free-tier-complete.mjs
 *
 * Studio: do NOT claim COMPLETE until this exits 0.
 * Do NOT weaken nested asserts.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root =
  fs.existsSync(path.join(process.cwd(), 'package.json'))
    ? process.cwd()
    : path.join(__dirname, '..');

const phases = [
  'assert-free-tier-m23.mjs',
  'assert-free-tier-m24.mjs',
  'assert-free-tier-m25.mjs',
  'assert-free-tier-m26.mjs',
  'assert-free-tier-m27.mjs',
  'assert-free-tier-m28.mjs',
];

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║  FREE-TIER RELIABILITY — MASTER COMPLETE GATE    ║');
console.log('╚══════════════════════════════════════════════════╝\n');
console.log(`root=${root}\n`);

let failed = 0;
const results = [];

for (const name of phases) {
  const full = path.join(root, 'scripts', name);
  process.stdout.write(`→ ${name} ... `);
  if (!fs.existsSync(full)) {
    console.log('MISSING');
    failed++;
    results.push({ name, status: 'MISSING' });
    continue;
  }
  const r = spawnSync(process.execPath, [full], { cwd: root, encoding: 'utf8' });
  if (r.status === 0) {
    console.log('PASS');
    results.push({ name, status: 'PASS' });
  } else {
    console.log('FAIL');
    failed++;
    results.push({ name, status: 'FAIL' });
    if (r.stdout) {
      const tail = r.stdout.trim().split('\n').slice(-12).join('\n');
      console.log(tail);
    }
    if (r.stderr) {
      const tail = r.stderr.trim().split('\n').slice(-8).join('\n');
      if (tail) console.error(tail);
    }
  }
}

// Regression suite names (Studio must run these too; we only check files exist here)
console.log('\n→ regression test files present');
const tests = [
  'src/utils/syncUtils.regression.test.ts',
  'src/utils/firestoreUtils.test.ts',
];
for (const t of tests) {
  if (fs.existsSync(path.join(root, t))) console.log(`  PASS  ${t}`);
  else {
    console.error(`  FAIL  missing ${t}`);
    failed++;
  }
}

console.log('\n=== Master STATUS ===');
results.forEach((r) => console.log(`  ${r.status.padEnd(6)} ${r.name}`));

if (failed) {
  console.error(`\nMASTER FAIL — ${failed} phase(s)/check(s) not green.`);
  console.error('Continue from first FAIL. Do not claim COMPLETE.\n');
  process.exit(1);
}

console.log('\nMASTER PASS — free-tier reliability core (M23–M28) green.\n');
console.log('Still out of scope (not required for this COMPLETE):');
console.log('  · Cloudflare D1 migration');
console.log('  · Full server.ts router split');
console.log('  · Playwright E2E');
console.log('  · Cloudflare Pages CDN');
console.log('');
process.exit(0);
