#!/usr/bin/env node
/**
 * Unattended queue: only work that already has a gate.
 * Items without a named test / standing row are NOT eligible — those need a human
 * sentence (and usually a standing row) first.
 *
 *   node scripts/discover-gated-work.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const standing = JSON.parse(fs.readFileSync(path.join(root, 'docs/agent/standing.json'), 'utf8'));

function run(label, args) {
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  return { label, status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

const standingRun = run('standing', [path.join(root, 'scripts/assert-standing.mjs')]);
const eligible = [];
const blocked = [];

if (standingRun.status !== 0) {
  eligible.push({
    id: 'standing-repair',
    class: 'FEATURE_DROP',
    why: 'assert-standing failed — restore or re-wire; do not edit standing.json to pass',
    gate: 'node scripts/journey-guard.mjs standing-repair',
    auto_go: true,
    frozen: ['docs/agent/standing.json', 'scripts/assert-standing.mjs', 'scripts/journey-guard.mjs'],
  });
}

for (const j of standing.journeys || []) {
  blocked.push({
    id: `do-not-swap:${j.id}`,
    why: `${j.label} instruction/schema are Frozen on any unattended run that is not explicitly that journey`,
  });
}

console.log('=== unattended-eligible (has a gate) ===');
if (eligible.length === 0) {
  console.log('(none — standing is green. Do not invent a night job. Wait for a red named test, a standing FAIL, or a human sentence.)');
} else {
  console.log(JSON.stringify(eligible, null, 2));
}

console.log('\n=== never auto-go ===');
console.log(JSON.stringify([
  { id: 'learn-from-other-journey', why: 'needs human go — sibling freeze' },
  { id: 'App.tsx / JobStore / LogChat', why: 'job-lifecycle; L1 blast radius' },
  { id: 'no-named-gate', why: 'babysitting lives here; promote a standing row or vitest first' },
  { id: 'npm test / POST /loop', why: 'forbidden inner loop' },
  ...blocked,
], null, 2));

process.exit(standingRun.status === 0 ? 0 : 0);
