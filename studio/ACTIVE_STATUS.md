# Active Status

**Handover (WIP):** [`AI_HANDOVER.md`](../AI_HANDOVER.md)  
**Plans (architecture):** [`plan/`](../plan/) — verify freshness; status board may lag git  
**Process:** [`AGENTS.md`](../AGENTS.md) · [`docs/agent/`](../docs/agent/)

## Git note

Do **not** assume 100% parity without `git fetch` + audit. Desktop may be **ahead/behind** origin with local governance WIP until **M20** ships via AI Studio.

## Active pack

| Pack | Role |
|------|------|
| None | Waiting for next pack |
| None | Waiting for next pack |
| None | Waiting for next pack |

## Governance gates (run before claiming M20 DONE)

```bash
node scripts/assert-agent-governance.mjs
npx vitest run \
  src/utils/syncUtils.regression.test.ts \
  src/utils/biomarkerIdentity.test.ts \
  src/utils/biomarkerSanitize.test.ts \
  server_vision_scout.test.ts \
  server_budget_reconcile.test.ts \
  server_portion_clarify.test.ts \
  server_nutrient_aggregation.test.ts
node scripts/assert-biomarker-flow.mjs
```

## Product baseline gates (optional after ship; historical)

```bash
node scripts/assert-b11d-b13-b8c.mjs
node scripts/assert-bug-tracking-complete.mjs
node scripts/assert-unified-modal-m3-executor.mjs
node scripts/assert-label-truth-locks.mjs
node scripts/assert-backlog-b1-portion-clarify.mjs
node scripts/assert-backlog-b5-refine.mjs
node scripts/assert-backlog-b2-b7.mjs
node scripts/assert-backlog-b14-cold-b9b.mjs
```

## Feature board (high level)

See `AI_HANDOVER.md` § initiatives. Product tracks (modal, food-calc, K, images) were largely green on Desktop as of 2026-08-08 audit; **re-verify after merge**.  
**New:** agent governance docs + regression suites — **pending GitHub** until M20.
