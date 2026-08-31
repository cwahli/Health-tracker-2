#!/usr/bin/env node
/**
 * F-9.1: tsx / npm run dev must not serve dist/ (hashed assets, Cache-Control 1y).
 * That trap made edit-preview patches look like they did nothing after refresh.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const src = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
let failed = 0;
function ok(cond, id, msg) {
  if (cond) console.log(`PASS ${id}`);
  else {
    failed += 1;
    console.error(`FAIL ${id}: ${msg}`);
  }
}

ok(/runningViaTsx/.test(src), 'tsx_detect', 'server.ts must detect tsx via argv/execArgv');
ok(/forceVite/.test(src) && /FORCE_VITE/.test(src), 'force_vite', 'server.ts must honor FORCE_VITE=1 or tsx');
ok(/serveDist = hasBuiltDist && !forceVite/.test(src), 'serve_dist_guard', 'serveDist must be hasBuiltDist && !forceVite');
ok(/\[boot\] frontend=/.test(src), 'boot_log', 'boot log must print frontend=vite|dist');

process.exit(failed ? 1 : 0);
