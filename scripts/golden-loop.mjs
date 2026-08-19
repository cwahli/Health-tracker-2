#!/usr/bin/env node
/**
 * One guarded golden loop cycle (skipScout pipeline, no new photos).
 * Exit 0 = green, 2 = stopped (max / no progress / locked / transport), 1 = still red (fix then re-run).
 *
 *   node scripts/golden-loop.mjs <caseId>
 */
const id = process.argv[2];
if (!id) {
  console.error('Usage: node scripts/golden-loop.mjs <golden-case-id>');
  process.exit(1);
}
const base = (process.env.GOLDEN_API_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const res = await fetch(`${base}/api/golden/cases/${encodeURIComponent(id)}/loop`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
});
const json = await res.json().catch(() => ({}));
console.log(JSON.stringify(json, null, 2));
if (res.status === 410 || json.error === 'loop_refused' || json.stopReason === 'loop_refused') {
  console.error('POST /loop refused. Say Next bug (GET /api/bugs/next). End with POST /api/bugs/:id/attempts.');
  process.exit(2);
}
if (json.allGreen || json.stopReason === 'green') process.exit(0);
if (['max_iterations', 'no_progress', 'locked', 'transport', 'no_scout', 'needs_attempt'].includes(json.stopReason)) {
  process.exit(2);
}
process.exit(1);
