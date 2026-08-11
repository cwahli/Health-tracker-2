#!/usr/bin/env node
/**
 * M27 — Firebase ID token verification on sync/job write proxies.
 *   node scripts/assert-free-tier-m27.mjs
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

console.log('\n=== M27 Authn on proxies ===\n');
const server = read('server.ts');
const sync = read('src/utils/syncUtils.ts');
const jobSync = read('src/jobs/SupabaseJobSync.ts');

if (!server.includes('verifyIdToken') && !server.includes('verifyFirebaseIdToken') && !fs.existsSync(path.join(root, 'server_auth.ts'))) {
  fail('no Firebase ID token verification helper on server');
} else ok('token verification helper present');

// supabase-push must verify auth (or call shared middleware)
const pushChunk = server.split('supabase-push')[1]?.slice(0, 2500) || '';
if (pushChunk && !/verifyIdToken|verifyFirebaseIdToken|requireAuth|authUid/.test(pushChunk) && !server.includes('[FreeTier] requireAuth supabase-push')) {
  fail('/api/sync/supabase-push does not show auth verification near handler');
} else ok('supabase-push auth wiring');

// Client should send Authorization Bearer
if (!/Authorization|getIdToken|Bearer/.test(sync) && !/Authorization|getIdToken|Bearer/.test(jobSync)) {
  fail('client sync/job upsert does not send Authorization / id token');
} else ok('client sends auth token for sync or jobs');

if (!server.includes('[FreeTier] requireAuth') && !server.includes('verifyFirebaseIdToken')) {
  fail('missing [FreeTier] requireAuth or verifyFirebaseIdToken marker');
} else ok('auth markers present');

console.log('\n=== Result ===');
if (failed) {
  console.error(`\nFAILED ${failed}:`);
  failures.forEach((f) => console.error(' -', f));
  process.exit(1);
}
console.log('\nAll M27 checks passed.\n');
process.exit(0);
