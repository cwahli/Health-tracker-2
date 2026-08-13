#!/usr/bin/env node
/**
 * Turn a failing meal debug export into an inbox golden.
 *
 *   node scripts/golden-from-debug.mjs path/to/debug-job_….md
 *   node scripts/golden-from-debug.mjs path/to/debug.json
 *
 * Writes tests/Golden_meal/inbox/<jobId>/
 *   scout.json   — frozen Vision Scout output (replay, no Gemini)
 *   case.json    — queries, observed bad binds, expected IDs to satisfy
 *
 * Then loop:  npm run golden:inbox
 * When green: node scripts/golden-promote.mjs <jobId>
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const INBOX = path.join(ROOT, 'tests', 'Golden_meal', 'inbox');

const FORBIDDEN_NAME_HINTS = [
  'powerade', 'popsicle', 'snow cone', 'italian ice', 'taro, leaves', 'taro leaves',
  'sweet potato leaves', 'onion powder', 'dark choc almond', 'water, bottled',
  'water, carbonated', 'vegetarian falafel wrap ingredients', 'instant oatmeal',
];

function extractBalancedObject(text, startIdx) {
  const i = text.indexOf('{', startIdx);
  if (i < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(i, j + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function parseDebugMarkdown(raw) {
  const jobId = (raw.match(/Job ID:\s*`?(job_[a-z0-9_]+)`?/i) || raw.match(/(job_\d+_[a-z0-9]+)/i) || [])[1]
    || `job_${Date.now()}`;

  const scoutMarker = raw.indexOf('[UnifiedLLM-Response:scout]');
  const scout = scoutMarker >= 0 ? extractBalancedObject(raw, scoutMarker) : null;

  const curatorMarker = raw.indexOf('[UnifiedLLM-Response:food_resolver]');
  const curator = curatorMarker >= 0 ? extractBalancedObject(raw, curatorMarker) : null;

  const bindings = [];
  const bindRe = /component\[(\d+)\] query="([^"]+)"\s*->\s*canonicalMatch=(\S+)\s*bestMatch\.source=(\S+)\s*bestMatch\.id=(\S+)/g;
  let m;
  while ((m = bindRe.exec(raw))) {
    bindings.push({
      componentIndex: Number(m[1]),
      query: m[2],
      canonicalMatch: m[3] === 'none' ? null : m[3].replace(/^"|"$/g, ''),
      source: m[4] === 'null' ? null : m[4],
      id: m[5] === 'null' ? null : m[5],
    });
  }

  const fallbacks = [];
  const fbRe = /\[Food Resolver Fallback\] Created category fallback for gap "([^"]+)"/g;
  while ((m = fbRe.exec(raw))) fallbacks.push(m[1]);

  const forbiddenObserved = [];
  const uniqueBindRe = /HIT_UNIQUE for "([^"]+)"\s*->\s*([^\n]+)/g;
  while ((m = uniqueBindRe.exec(raw))) {
    const name = m[2];
    if (FORBIDDEN_NAME_HINTS.some((h) => name.toLowerCase().includes(h))) {
      forbiddenObserved.push({ query: m[1], name: name.trim(), via: 'HIT_UNIQUE' });
    }
  }
  const boundNameRe = /Bound direct Curator query match id=(\S+) \("([^"]+)"\) for component "([^"]+)"/g;
  while ((m = boundNameRe.exec(raw))) {
    const name = m[2];
    if (FORBIDDEN_NAME_HINTS.some((h) => name.toLowerCase().includes(h))) {
      forbiddenObserved.push({ query: m[3], id: m[1], name, via: 'curator_bind' });
    }
  }

  const mealName = (raw.match(/\*\*Meal Name:\*\*\s*(.+)/) || [])[1]?.trim() || null;
  const calories = Number((raw.match(/\*\*Calories\*\*\s*\|\s*\*\*(\d+)/) || [])[1]) || null;

  return { jobId, scout, curator, bindings, fallbacks, forbiddenObserved, mealName, calories };
}

function queriesFromScout(scout) {
  const out = [];
  for (const item of scout?.items || []) {
    for (const c of item.components || []) {
      const q = typeof c === 'string' ? c : c.searchQuery || c.name;
      if (q) out.push(String(q));
    }
    if ((!item.components || item.components.length < 2) && (item.keyword || item.originalName)) {
      out.push(String(item.keyword || item.originalName));
    }
  }
  return [...new Set(out)];
}

function expectationsFromCurator(curator) {
  const expect = [];
  for (const a of curator?.actions || []) {
    const query = a.query;
    const id = a.parametricFdcId != null ? String(a.parametricFdcId) : (a.chosenFdcId != null ? String(a.chosenFdcId) : null);
    if (query && id && /^\d{5,8}$/.test(id)) {
      expect.push({
        query,
        expectFdcId: id,
        from: 'curator_parametric',
        foodName: a.parametricFoodName || null,
      });
    }
  }
  return expect;
}

function neverMatchFromObserved(forbiddenObserved) {
  const byQuery = new Map();
  for (const f of forbiddenObserved) {
    const cur = byQuery.get(f.query) || { query: f.query, forbiddenIds: [], forbiddenNames: [] };
    if (f.id) cur.forbiddenIds.push(String(f.id));
    if (f.name) cur.forbiddenNames.push(f.name);
    byQuery.set(f.query, cur);
  }
  return [...byQuery.values()];
}

const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.error('Usage: node scripts/golden-from-debug.mjs <debug-job.md|debug.json>');
  process.exit(1);
}

const raw = fs.readFileSync(src, 'utf-8');
let parsed;
if (src.endsWith('.json')) {
  const json = JSON.parse(raw);
  parsed = {
    jobId: json.jobId || json.job_id || `job_${Date.now()}`,
    scout: json.scout || json.meal?.scoutSnapshot || json.visionScout || null,
    curator: json.curator || null,
    bindings: json.bindings || [],
    fallbacks: json.fallbacks || [],
    forbiddenObserved: json.forbiddenObserved || [],
    mealName: json.mealName || json.meal?.name || null,
    calories: json.calories || null,
  };
} else {
  parsed = parseDebugMarkdown(raw);
}

const jobId = String(parsed.jobId).replace(/[^a-zA-Z0-9_]/g, '_') || `job_${Date.now()}`;
const dest = path.join(INBOX, jobId);
fs.mkdirSync(dest, { recursive: true });

if (parsed.scout) {
  fs.writeFileSync(path.join(dest, 'scout.json'), JSON.stringify(parsed.scout, null, 2));
}

const queries = queriesFromScout(parsed.scout);
const expectFromCurator = expectationsFromCurator(parsed.curator);
const neverMatch = neverMatchFromObserved(parsed.forbiddenObserved);

const caseJson = {
  id: jobId,
  status: 'open',
  sourceFile: path.resolve(src),
  capturedAt: new Date().toISOString(),
  mealName: parsed.mealName,
  observedCalories: parsed.calories,
  queries,
  expectResolve: expectFromCurator,
  neverMatch,
  observedBindings: parsed.bindings,
  categoryFallbacks: parsed.fallbacks,
  notes: [
    'Open inbox case. Replay with: npm run golden:inbox',
    'Fill expectResolve[].expectFdcId when you know the right USDA id.',
    'When vitest is green, run: node scripts/golden-promote.mjs ' + jobId,
  ],
};

fs.writeFileSync(path.join(dest, 'case.json'), JSON.stringify(caseJson, null, 2));
fs.copyFileSync(src, path.join(dest, path.basename(src)));

console.log(`Inbox case written: tests/Golden_meal/inbox/${jobId}/`);
console.log(`  queries: ${queries.length}`);
console.log(`  expectResolve (from curator): ${expectFromCurator.length}`);
console.log(`  neverMatch: ${neverMatch.length}`);
console.log(`  categoryFallbacks: ${parsed.fallbacks.length}`);
console.log(`Next: npm run golden:inbox`);
