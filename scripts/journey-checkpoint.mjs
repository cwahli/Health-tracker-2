#!/usr/bin/env node
/**
 * LangGraph-style checkpointer without LangGraph.
 * Snapshots standing journeys' instruction/schema files + the packet
 * so a Builder overwrite is recoverable (time travel).
 *
 *   node scripts/journey-checkpoint.mjs save <slug> <node>
 *   node scripts/journey-checkpoint.mjs restore <slug> <node>
 *   node scripts/journey-checkpoint.mjs list <slug>
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const cmd = process.argv[2];
const slug = process.argv[3];
const node = process.argv[4] || 'manual';

function die(msg) {
  console.error(msg);
  process.exit(1);
}

if (!cmd || !['save', 'restore', 'list'].includes(cmd)) {
  die('Usage: node scripts/journey-checkpoint.mjs save|restore|list <slug> [node]');
}
if (!slug) die('slug required');

const standing = JSON.parse(fs.readFileSync(path.join(root, 'docs/agent/standing.json'), 'utf8'));
const files = new Set(['docs/agent/standing.json']);
for (const j of standing.journeys || []) {
  if (j.instruction_file) files.add(j.instruction_file);
  if (j.schema_file) files.add(j.schema_file);
}
const packet = path.join('specs', 'active', `${slug}.md`);
if (fs.existsSync(path.join(root, packet))) files.add(packet);

const dir = path.join(root, 'specs', 'checkpoints', slug, node);

if (cmd === 'list') {
  const base = path.join(root, 'specs', 'checkpoints', slug);
  if (!fs.existsSync(base)) {
    console.log('(none)');
    process.exit(0);
  }
  for (const n of fs.readdirSync(base)) console.log(n);
  process.exit(0);
}

if (cmd === 'save') {
  fs.mkdirSync(dir, { recursive: true });
  const manifest = [];
  for (const rel of files) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const dest = path.join(dir, rel.replace(/[\\/]/g, '__'));
    fs.copyFileSync(abs, dest);
    manifest.push(rel);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ slug, node, at: new Date().toISOString(), files: manifest }, null, 2));
  console.log(`CHECKPOINT saved ${slug}/${node} (${manifest.length} files)`);
  process.exit(0);
}

if (!fs.existsSync(path.join(dir, 'manifest.json'))) die(`no checkpoint ${slug}/${node}`);
const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
for (const rel of man.files) {
  const src = path.join(dir, rel.replace(/[\\/]/g, '__'));
  const dest = path.join(root, rel);
  if (!fs.existsSync(src)) continue;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`restored ${rel}`);
}
console.log(`CHECKPOINT restored ${slug}/${node}`);
process.exit(0);
