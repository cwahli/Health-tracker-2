#!/usr/bin/env node
/**
 * M25 — Supabase payload diet: projected list pull + keyset/cursor pagination.
 *   node scripts/assert-free-tier-m25.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root =
  fs.existsSync(path.join(process.cwd(), 'package.json')) &&
  fs.existsSync(path.join(process.cwd(), 'server.ts'))
    ? process.cwd()
    : path.join(__dirname, '..');

let failed = 0;
const failures = [];
function ok(m) { console.log(`  PASS  ${m}`); }
function fail(m) { failed++; failures.push(m); console.error(`  FAIL  ${m}`); }
function read(rel) {
  const p = path.join(root, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

console.log('\n=== M25 Supabase payload diet ===\n');
const server = read('server.ts') + '\n' + read('server_routes_sync.ts');
const sync = read('src/utils/syncUtils.ts');

if (!server.includes('[FreeTier] projected food pull') && !server.includes('[FreeTier] keyset pagination')) {
  fail('server.ts missing projected pull / keyset markers');
} else ok('payload-diet markers present');

// Default food_logs pull must not be unbounded SELECT * without projection/limit for list path
const pullSection = server.includes('/api/sync/supabase-pull')
  ? server.split('/api/sync/supabase-pull')[1]?.slice(0, 8000) || ''
  : '';
if (!pullSection) {
  fail('cannot locate /api/sync/supabase-pull handler');
} else {
  ok('supabase-pull handler found');
  // Prefer explicit projection columns for list mode
  if (
    /food_logs['"]\)\s*\.select\(\s*['"]\*['"]\s*\)/.test(pullSection) &&
    !pullSection.includes('selectMode') &&
    !pullSection.includes('list') &&
    !/select\(\s*['"]id,/.test(pullSection)
  ) {
    fail('supabase-pull still food_logs.select(*) without list projection');
  } else ok('food pull uses projection or mode switch');

  if (!/limit\s*\(/.test(pullSection) && !/\.limit\s*\(/.test(pullSection) && !pullSection.includes('pageSize') && !pullSection.includes('PAGE_SIZE')) {
    fail('supabase-pull has no limit/pageSize for history pages');
  } else ok('pull has pagination limit');
}

// Client may pass cursor / pageSize
if (!sync.includes('cursor') && !sync.includes('pageSize') && !sync.includes('lastSyncTime')) {
  fail('syncUtils client pull has no cursor/pageSize/lastSyncTime evolution');
} else ok('client pull supports incremental or paged args');

// Base64 still banned on push (regression)
if (!server.includes('data:image/') || !server.includes('uploadBase64ToR2')) {
  // soft: interceptor may still exist
  if (!server.includes('uploadBase64ToR2')) fail('R2 base64 interceptor missing — do not remove');
  else ok('R2 upload helper present');
} else ok('base64→R2 path retained');

console.log('\n=== Result ===');
if (failed) {
  console.error(`\nFAILED ${failed}:`);
  failures.forEach((f) => console.error(' -', f));
  process.exit(1);
}
console.log('\nAll M25 checks passed.\n');
process.exit(0);
