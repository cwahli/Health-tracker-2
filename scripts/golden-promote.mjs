#!/usr/bin/env node
/**
 * Move a green inbox case into the official golden set.
 *
 *   node scripts/golden-promote.mjs <jobId> [folder-name]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const GOLDEN = path.join(ROOT, 'tests', 'Golden_meal');
const INBOX = path.join(GOLDEN, 'inbox');

const jobId = process.argv[2];
if (!jobId) {
  console.error('Usage: node scripts/golden-promote.mjs <jobId> [folder-name]');
  process.exit(1);
}

const src = path.join(INBOX, jobId);
if (!fs.existsSync(src)) {
  console.error(`No inbox case: ${src}`);
  process.exit(1);
}

const caseJson = JSON.parse(fs.readFileSync(path.join(src, 'case.json'), 'utf-8'));
if (caseJson.status !== 'ready_to_promote' && caseJson.status !== 'open') {
  console.error(`Case status is ${caseJson.status}. Expected open or ready_to_promote.`);
  process.exit(1);
}

const manifestPath = path.join(GOLDEN, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const nextNum = manifest.goldens.length + 1;
const slug = (process.argv[3] || caseJson.mealName || jobId)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 48);
const dirName = `${nextNum}. ${slug}`;
const dest = path.join(GOLDEN, dirName);
fs.mkdirSync(dest, { recursive: true });

for (const name of fs.readdirSync(src)) {
  fs.copyFileSync(path.join(src, name), path.join(dest, name));
}

const expected = {
  id: `G${nextNum}`,
  title: caseJson.mealName || slug,
  mode: 'new_log',
  promotedFrom: jobId,
  passes: [{ id: 'replay', prompt: '', photos: [], kind: 'replay_scout' }],
  resolveLocks: caseJson.expectResolve || [],
  catalogGaps: [],
  neverMatch: caseJson.neverMatch || [],
  invariants: ['Promoted from inbox after replay went green'],
};

fs.writeFileSync(path.join(dest, 'expected.json'), JSON.stringify(expected, null, 2));
if (!fs.existsSync(path.join(dest, 'Instruction.md'))) {
  fs.writeFileSync(
    path.join(dest, 'Instruction.md'),
    `Promoted from inbox ${jobId}.\nReplay scout.json. See expected.json.\n`
  );
}

manifest.goldens.push({
  id: `G${nextNum}`,
  dir: dirName,
  mode: 'new_log',
  title: expected.title,
});
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

fs.rmSync(src, { recursive: true, force: true });
console.log(`Promoted ${jobId} → tests/Golden_meal/${dirName}/`);
console.log('Re-run: npx vitest run tests/golden_meals.test.ts tests/golden_inbox.test.ts');
