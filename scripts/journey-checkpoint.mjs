#!/usr/bin/env node
/**
 * Stanford SHEPHERD-style Reversible Checkpointer & LangGraph-style time travel.
 * Snapshots standing journeys' files, packet, and git execution tree state
 * so a Builder failure is reversible in milliseconds ([revert] & [fork]).
 *
 *   node scripts/journey-checkpoint.mjs save <slug> <node>
 *   node scripts/journey-checkpoint.mjs restore <slug> <node> [--git]
 *   node scripts/journey-checkpoint.mjs fork <slug> <from_node> <new_node>
 *   node scripts/journey-checkpoint.mjs list <slug>
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const cmd = process.argv[2];
const slug = process.argv[3];
const node = process.argv[4] || 'manual';
const extra = process.argv[5] || null;

function die(msg) {
  console.error(msg);
  process.exit(1);
}

if (!cmd || !['save', 'restore', 'fork', 'list'].includes(cmd)) {
  die('Usage: node scripts/journey-checkpoint.mjs save|restore|fork|list <slug> [node|from_node] [new_node]');
}
if (!slug) die('slug required');

function getGitState() {
  try {
    const head = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
    let stashCommit = null;
    try {
      const stash = execSync('git stash create', { cwd: root, encoding: 'utf8' }).trim();
      if (stash) stashCommit = stash;
    } catch {
      // clean working tree
    }
    return { head, stashCommit };
  } catch {
    return { head: null, stashCommit: null };
  }
}

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
  const git = getGitState();
  if (git.head) {
    try {
      const targetCommit = git.stashCommit || git.head;
      execSync(`git tag -f checkpoint/${slug}/${node} ${targetCommit} 2>/dev/null || true`, { cwd: root });
    } catch {
      // tag optional
    }
  }
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ slug, node, at: new Date().toISOString(), git, files: manifest }, null, 2),
  );
  console.log(`CHECKPOINT saved ${slug}/${node} (${manifest.length} files, git: ${git.head?.slice(0, 7) || 'n/a'})`);
  process.exit(0);
}

if (cmd === 'restore') {
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) die(`no checkpoint ${slug}/${node}`);
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

  // Optional full git tree revert if requested or flag passed
  const doGitRevert = process.argv.includes('--git') || process.env.SHEPHERD_GIT_REVERT === '1';
  if (doGitRevert && man.git?.head) {
    try {
      if (man.git.stashCommit) {
        execSync(`git reset --hard ${man.git.head} && git stash apply ${man.git.stashCommit}`, { cwd: root });
      } else {
        execSync(`git reset --hard ${man.git.head} && git clean -fd`, { cwd: root });
      }
      console.log(`[SHEPHERD revert] restored git tree to ${man.git.head.slice(0, 7)}`);
    } catch (e) {
      console.warn(`[SHEPHERD revert] git rollback skipped: ${e.message}`);
    }
  }

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
}

if (cmd === 'fork') {
  // SHEPHERD Counterfactual Fork: restore from_node, clean dirty state, and save new_node
  const fromNode = node;
  const newNode = extra;
  if (!newNode) die('Usage: node scripts/journey-checkpoint.mjs fork <slug> <from_node> <new_node>');

  const fromDir = path.join(root, 'specs', 'checkpoints', slug, fromNode);
  if (!fs.existsSync(path.join(fromDir, 'manifest.json'))) die(`no checkpoint ${slug}/${fromNode}`);

  console.log(`[SHEPHERD fork] reverting to ${slug}/${fromNode} before branching to ${newNode}...`);
  execSync(`node scripts/journey-checkpoint.mjs restore ${slug} ${fromNode}`, { cwd: root, stdio: 'inherit' });
  execSync(`node scripts/journey-checkpoint.mjs save ${slug} ${newNode}`, { cwd: root, stdio: 'inherit' });
  console.log(`[SHEPHERD fork] Clean counterfactual branch ready at ${slug}/${newNode}`);
  process.exit(0);
}
