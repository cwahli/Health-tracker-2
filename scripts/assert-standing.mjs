#!/usr/bin/env node
/**
 * Guard (no LLM). Enforces docs/agent/standing.json.
 * Fail = a journey was swapped or a must-keep feature dropped.
 * Restore from git; do not edit standing.json to match the new code.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const standingPath = path.join(root, 'docs/agent/standing.json');
let failed = 0;

function pass(id) {
  console.log(`PASS ${id}`);
}
function fail(id, msg) {
  failed += 1;
  console.error(`FAIL ${id}: ${msg}`);
}
function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    fail('missing_file', rel);
    return '';
  }
  return fs.readFileSync(abs, 'utf8');
}

const standing = JSON.parse(fs.readFileSync(standingPath, 'utf8'));

const instructionTexts = {};
for (const j of standing.journeys || []) {
  const text = read(j.instruction_file);
  instructionTexts[j.id] = text;
  for (const needle of j.must_in_instruction || []) {
    if (!text.includes(needle)) fail(`${j.id}_instruction_missing`, `${needle} in ${j.instruction_file}`);
    else pass(`${j.id}_has:${needle.slice(0, 24)}`);
  }
  for (const needle of j.must_not_in_instruction || []) {
    if (text.includes(needle)) fail(`${j.id}_instruction_leaked`, `${needle} must not appear in ${j.instruction_file}`);
    else pass(`${j.id}_not:${needle.slice(0, 24)}`);
  }
  const schemaText = read(j.schema_file);
  for (const needle of j.must_in_schema_file || []) {
    if (!schemaText.includes(needle)) fail(`${j.id}_schema_missing`, `${needle} in ${j.schema_file}`);
    else pass(`${j.id}_schema:${needle.slice(0, 32)}`);
  }
  for (const site of j.call_sites || []) {
    const src = read(site);
    for (const needle of j.call_sites_must_contain || []) {
      if (!src.includes(needle)) fail(`${j.id}_call_site`, `${needle} in ${site}`);
      else pass(`${j.id}_wired:${path.basename(site)}`);
    }
  }
}

for (const pair of standing.sibling_pairs || []) {
  const a = instructionTexts[pair.a] || '';
  const b = instructionTexts[pair.b] || '';
  if (a && b && a === b) fail('sibling_identical', `${pair.a} instruction === ${pair.b} instruction`);
  else if (a && b) pass(`siblings_distinct:${pair.a}/${pair.b}`);
}

for (const feat of standing.features || []) {
  const map = feat.files_must_contain || {};
  for (const [file, needles] of Object.entries(map)) {
    const src = read(file);
    for (const needle of needles) {
      if (!src.includes(needle)) fail(`${feat.id}`, `${needle} missing from ${file}`);
      else pass(`${feat.id}:${path.basename(file)}`);
    }
  }
}

if (failed) {
  console.error(`\n${failed} standing invariant(s) failed. Restore the journey/feature from git. Do not weaken docs/agent/standing.json.`);
  process.exit(1);
}
console.log('\nPASS standing');
process.exit(0);
